// ============================================================
// Servicio de ingesta (claim-first). Orquesta un NormalizedLead a
// través del puerto LeadRepository. NO es una función pura: hace
// escrituras — pero depende solo del puerto, así se testea con un
// fake en memoria (ingest.test.ts).
//
// Orden que cierra la falla fundacional del consejo (B1):
//   1. CLAIM   reservar meta_lead_id (ON CONFLICT DO NOTHING)
//   2. contacto (checkpoint: lead.contact_id)
//   3. deal     (checkpoint: lead.deal_id vía createDeal)
//   4. asignar  least-loaded (idempotente)
//   5. finalize status='processed' + atribución + raw
// Ante crash entre 2 y 5, el próximo ciclo reclama el mismo id, ve
// 'claimed' con contact_id/deal_id ya seteados y retoma sin duplicar.
// ============================================================

import { pickLeastRecentlyServed } from "./rotation";
import type {
  ClaimedLead,
  EligibleAgent,
  IngestResult,
  LeadRepository,
  NormalizedLead,
  OpenPackage,
} from "./types";
import { assignByQuota, assignFromPool } from "./assign";

export interface IngestOptions {
  /** Auto-asignar (config de la fuente). */
  autoAssign: boolean;
  /**
   * Cómo repartir (handoff §4). `least_loaded` (default) usa el pozo común;
   * `quota` reparte contra las tandas compradas y sella leads.package_id.
   * Se elige por configuración de la fuente; ninguna reemplaza a la otra.
   */
  assignmentStrategy?: "least_loaded" | "quota";
  /** Mapa lead_status -> stage_id (config de la fuente). */
  statusToStage?: Record<string, string>;
}

/** Resuelve la etapa para un lead_status: exacto, luego case-insensitive. */
export function resolveStage(
  statusRaw: string | null,
  map?: Record<string, string>,
): string | null {
  if (!statusRaw || !map) return null;
  const key = statusRaw.trim();
  if (map[key]) return map[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.trim().toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Elige al asesor que hace MÁS TIEMPO que no recibe un lead (rotación 1-a-1).
 *
 * Antes ganaba el de menos leads recibidos en el ciclo, y eso hacía que quien
 * arrancaba un ciclo nuevo acaparara la ráfaga hasta emparejarse con el
 * resto. El pozo común y el reparto por tandas siguen ahora la misma regla:
 * el reparto no cambia de comportamiento según haya tandas cargadas o no.
 */
export function pickLeastLoaded(
  agents: EligibleAgent[],
): EligibleAgent | null {
  return pickLeastRecentlyServed(
    agents,
    (a) => a.lastAssignedAt,
    // Sin fecha de alta a mano: el userId da un orden estable y arbitrario
    // para los que nunca recibieron, y el azar rompe el empate igual.
    (a) => a.userId,
  );
}

/**
 * Rotación 1-a-1 entre tandas abiertas: gana la que hace MÁS TIEMPO que no
 * recibe. Las que ya llegaron al cupo quedan fuera (el llamador las cierra).
 *
 * Antes ganaba la de menos entregados, y con una tanda en 0/50 y otra en
 * 35/50 la primera se llevaba 35 leads seguidos mientras la segunda quedaba
 * seca. `delivered` ahora sólo decide si queda cupo, no el turno.
 */
export function pickByQuota(packages: OpenPackage[]): OpenPackage | null {
  const withRoom = packages.filter((p) => p.delivered < p.leadsTarget);
  return pickLeastRecentlyServed(
    withRoom,
    (p) => p.lastDeliveredAt,
    (p) => p.createdAt,
  );
}

export async function ingestLead(
  repo: LeadRepository,
  lead: NormalizedLead,
  opts: IngestOptions,
): Promise<IngestResult> {
  // 1. CLAIM — reserva la clave antes de crear nada.
  const claimed = await repo.claimLead(lead.metaLeadId);
  if (!claimed.isNew && claimed.status === "processed") {
    return syncSheetStage(repo, claimed, lead, opts);
  }
  const resuming = !claimed.isNew;

  // 2. Contacto (reusa el ya creado si estamos reanudando).
  let contactId = claimed.contactId;
  if (!contactId) {
    const contact = await repo.findOrCreateContact({
      phoneE164: lead.phoneE164,
      phoneRaw: lead.phoneRaw,
      name: lead.name,
      email: lead.email,
    });
    contactId = contact.id;
    await repo.setLeadContact(claimed.leadId, contactId);
  }

  // Custom fields (preguntas, ciudad, CP) + nota (Comentarios).
  if (Object.keys(lead.customFields).length > 0) {
    await repo.setCustomValues(contactId, lead.customFields);
  }
  if (lead.comments) {
    await repo.addNote(contactId, lead.comments);
  }

  // 3. Deal (reusa el ya creado si estamos reanudando).
  let dealId = claimed.dealId;
  let initialStageId = claimed.syncedStageId;
  if (!dealId) {
    const deal = await repo.createDeal({
      leadId: claimed.leadId,
      contactId,
      title: lead.name || lead.phoneRaw || "Lead de Meta",
      stageId: resolveStage(lead.statusRaw, opts.statusToStage),
    });
    dealId = deal.id;
    initialStageId = deal.stageId;
  }

  // 4. Asignación (idempotente + registra el evento de tanda). Con `quota`,
  //    si no hay tanda abierta el lead queda SIN asignar a propósito: es la
  //    cola de admin y la señal de que se compra tráfico no vendido (§4.6).
  if (opts.autoAssign) {
    if (opts.assignmentStrategy === "quota") {
      await assignByQuota(repo, claimed.leadId, dealId);
    } else {
      await assignFromPool(repo, dealId);
    }
  }

  // 5. Finalize.
  await repo.finalizeLead(claimed.leadId, {
    attribution: lead.attribution,
    leadCreatedTime: lead.leadCreatedTime,
    rawPayload: lead.raw,
    phoneValid: lead.phoneValid,
    sheetStatus: lead.statusRaw?.trim() || null,
    syncedStageId: initialStageId,
  });

  return {
    outcome: resuming ? "resumed" : "processed",
    leadId: claimed.leadId,
  };
}

/**
 * Lead ya procesado: si el lead_status de la hoja cambió, refleja el
 * cambio en la etapa del deal — salvo que un humano ya lo haya movido
 * en el Kanban (deal.stage != synced_stage), en cuyo caso la planilla
 * pierde el control de ese deal para siempre (synced_stage = null).
 */
async function syncSheetStage(
  repo: LeadRepository,
  claimed: ClaimedLead,
  lead: NormalizedLead,
  opts: IngestOptions,
): Promise<IngestResult> {
  const skipped: IngestResult = { outcome: "skipped_duplicate", leadId: claimed.leadId };
  const status = lead.statusRaw?.trim() || null;
  if (!status || status === (claimed.sheetStatus ?? "")) return skipped;
  if (!claimed.dealId) return skipped;

  // Control manual permanente (o legado sin tracking).
  if (!claimed.syncedStageId) {
    await repo.recordSheetStatus(claimed.leadId, status, null);
    return { ...skipped, reason: "deal en control manual" };
  }

  const target = resolveStage(status, opts.statusToStage);
  if (!target) {
    await repo.recordSheetStatus(claimed.leadId, status, claimed.syncedStageId);
    return { ...skipped, reason: "estado sin mapeo" };
  }

  const current = await repo.getDealStage(claimed.dealId);
  if (current !== claimed.syncedStageId) {
    // Alguien lo movió en el CRM: la planilla deja de mandar.
    await repo.recordSheetStatus(claimed.leadId, status, null);
    return { ...skipped, reason: "deal en control manual" };
  }
  if (current === target) {
    await repo.recordSheetStatus(claimed.leadId, status, target);
    return skipped;
  }

  await repo.moveDealStage(claimed.dealId, target);
  await repo.recordSheetStatus(claimed.leadId, status, target);
  return { outcome: "stage_synced", leadId: claimed.leadId };
}
