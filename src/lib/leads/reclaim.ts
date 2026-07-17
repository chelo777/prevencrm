import type { LeadRepository } from "./types";
import { assignFromPool } from "./assign";

/** Devuelve al pozo los leads sin trabajar y los reasigna a otro elegible.
 *  El contador es derivado, así que el evento lead_reclaimed ya "descuenta"
 *  al original y lead_assigned "suma" al nuevo (los emite assignFromPool y este). */
export async function reclaimStaleLeads(
  repo: LeadRepository,
  opts: { reclaimAfterIso: string; dryRun: boolean },
): Promise<{ candidates: number; reclaimed: number; reassigned: number }> {
  const stale = await repo.listStaleAssignedLeads(opts.reclaimAfterIso);
  if (opts.dryRun) return { candidates: stale.length, reclaimed: 0, reassigned: 0 };

  let reclaimed = 0,
    reassigned = 0;
  for (const s of stale) {
    await repo.unassignDeal(s.dealId);
    await repo.recordAssignEvent(s.assignedAgentId, s.dealId, "lead_reclaimed");
    reclaimed++;
    const who = await assignFromPool(repo, s.dealId, s.assignedAgentId);
    if (who) reassigned++;
  }
  return { candidates: stale.length, reclaimed, reassigned };
}
