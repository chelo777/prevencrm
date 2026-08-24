import type { LeadRepository, StaleLead } from "./types";

// Reclamo de leads sin trabajar.
//
// Antes: se liberaba el lead y se lo reasignaba automáticamente a otro asesor.
// Eso movía el problema de escritorio sin hacerlo visible — el lead seguía
// circulando y nadie se enteraba de que alguien no lo estaba trabajando.
//
// Ahora: el lead queda SIN ASIGNAR, en la cola del admin, y cada admin recibe
// el aviso de que se liberó y de quién lo tenía. El admin decide si lo trabaja
// él o se lo reasigna a alguien desde la bandeja.

export interface FreedLead {
  leadId: string;
  contactId: string | null;
  contactName: string | null;
  previousAgentId: string;
  previousAgentName: string | null;
}

export interface ReclaimResult {
  candidates: number;
  reclaimed: number;
  /** Leads liberados en esta corrida — insumo del push agrupado. */
  freed: FreedLead[];
}

function buildNotice(freed: FreedLead): { title: string; body: string } {
  const quien = freed.previousAgentName?.trim() || "un asesor";
  const lead = freed.contactName?.trim() || "Sin nombre";
  return {
    title: "Lead liberado por falta de trabajo",
    body: `${lead} volvió a la cola: ${quien} no lo trabajó. Está sin asignar.`,
  };
}

export async function reclaimStaleLeads(
  repo: LeadRepository,
  opts: { reclaimAfterIso: string; dryRun: boolean },
): Promise<ReclaimResult> {
  const stale = await repo.listStaleAssignedLeads(opts.reclaimAfterIso);
  if (opts.dryRun) return { candidates: stale.length, reclaimed: 0, freed: [] };

  // Los avisos van a todos los owner/admin. Se resuelve una vez por corrida,
  // no por lead.
  const admins = await repo.listAccountAdmins();
  const nameCache = new Map<string, string | null>();

  const freed: FreedLead[] = [];
  for (const s of stale) {
    await repo.unassignDeal(s.dealId);
    // El contador de recibidos es derivado: este evento "descuenta" el lead
    // al asesor que no lo trabajó.
    await repo.recordAssignEvent(s.assignedAgentId, s.dealId, "lead_reclaimed");

    freed.push({
      leadId: s.leadId,
      contactId: s.contactId ?? null,
      contactName: s.contactName ?? null,
      previousAgentId: s.assignedAgentId,
      previousAgentName: await agentName(repo, nameCache, s.assignedAgentId),
    });
  }

  // Una notificación por lead: el admin necesita poder abrir cada uno. El
  // push agrupado lo manda el llamador con `freed`.
  for (const f of freed) {
    const { title, body } = buildNotice(f);
    for (const adminId of admins) {
      await repo.notifyLeadReclaimed({
        userId: adminId,
        leadId: f.leadId,
        contactId: f.contactId,
        title,
        body,
      });
    }
  }

  return { candidates: stale.length, reclaimed: freed.length, freed };
}

async function agentName(
  repo: LeadRepository,
  cache: Map<string, string | null>,
  userId: string,
): Promise<string | null> {
  const hit = cache.get(userId);
  if (hit !== undefined) return hit;
  const name = await repo.getAgentName(userId);
  cache.set(userId, name);
  return name;
}

export type { StaleLead };
