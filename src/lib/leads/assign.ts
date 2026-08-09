import type { LeadRepository } from "./types";
import { pickByQuota, pickLeastLoaded } from "./ingest";

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

/**
 * Reparto por cupo de tanda (handoff §4). Cierra las tandas que ya llegaron a
 * su cupo, elige la de rotación pareja, asigna el deal a su compradora y SELLA
 * `leads.package_id` (la trazabilidad que consume la contabilidad).
 *
 * Devuelve el user_id de la compradora, o null si no había tanda abierta —
 * en ese caso el lead queda sin asignar a propósito (cola de admin).
 */
export async function assignByQuota(
  repo: LeadRepository,
  leadId: string,
  dealId: string,
): Promise<string | null> {
  const packages = await repo.listOpenPackages();

  // Cerrar las que llegaron al cupo — idempotente, no depende de este lead.
  for (const pkg of packages) {
    if (pkg.delivered >= pkg.leadsTarget) {
      await repo.markPackageCompleted(pkg.packageId);
    }
  }

  const pick = pickByQuota(packages);
  if (!pick) return null;

  const ok = await repo.assignDealIfUnassigned(dealId, pick.buyerUserId);
  // El deal ya tenía dueño: no sellamos la tanda (no se le entregó nada).
  if (!ok) return null;

  await repo.sealLeadPackage(leadId, pick.packageId);
  await repo.recordAssignEvent(pick.buyerUserId, dealId, "lead_assigned");
  return pick.buyerUserId;
}
