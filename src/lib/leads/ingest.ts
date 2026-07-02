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

import type {
  AssignableAgent,
  IngestResult,
  LeadRepository,
  NormalizedLead,
} from "./types";

export interface IngestOptions {
  /** Auto-asignar por least-loaded (config de la fuente). */
  autoAssign: boolean;
}

/** Elige el asesor con menos deals abiertos; desempata al azar. */
export function pickLeastLoaded(
  agents: AssignableAgent[],
): AssignableAgent | null {
  if (agents.length === 0) return null;
  const min = Math.min(...agents.map((a) => a.openDeals));
  const pool = agents.filter((a) => a.openDeals === min);
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function ingestLead(
  repo: LeadRepository,
  lead: NormalizedLead,
  opts: IngestOptions,
): Promise<IngestResult> {
  // 1. CLAIM — reserva la clave antes de crear nada.
  const claimed = await repo.claimLead(lead.metaLeadId);
  if (!claimed.isNew && claimed.status === "processed") {
    return { outcome: "skipped_duplicate", leadId: claimed.leadId };
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
  if (!dealId) {
    const deal = await repo.createDeal({
      leadId: claimed.leadId,
      contactId,
      title: lead.name || lead.phoneRaw || "Lead de Meta",
    });
    dealId = deal.id;
  }

  // 4. Asignación least-loaded (idempotente: solo si sin asignar).
  if (opts.autoAssign) {
    const agents = await repo.listAssignableAgents();
    const pick = pickLeastLoaded(agents);
    if (pick) {
      await repo.assignDealIfUnassigned(dealId, pick.userId);
    }
  }

  // 5. Finalize.
  await repo.finalizeLead(claimed.leadId, {
    attribution: lead.attribution,
    leadCreatedTime: lead.leadCreatedTime,
    rawPayload: lead.raw,
    phoneValid: lead.phoneValid,
  });

  return {
    outcome: resuming ? "resumed" : "processed",
    leadId: claimed.leadId,
  };
}
