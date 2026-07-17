import type { LeadRepository } from "./types";
import { pickLeastLoaded } from "./ingest";

/** Reparto único (ingesta y reclamo). Asigna el deal al asesor elegible menos
 *  cargado (excluyendo `excludeUserId`), registra el evento y devuelve su id. */
export async function assignFromPool(
  repo: LeadRepository, dealId: string, excludeUserId?: string,
): Promise<string | null> {
  const agents = (await repo.listEligibleAgents()).filter((a) => a.userId !== excludeUserId);
  const pick = pickLeastLoaded(agents);
  if (!pick) return null;
  const ok = await repo.assignDealIfUnassigned(dealId, pick.userId);
  if (!ok) return null;
  await repo.recordAssignEvent(pick.userId, dealId, "lead_assigned");
  return pick.userId;
}
