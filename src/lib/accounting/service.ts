// ============================================================
// Servicio de contabilidad: orquesta el puerto y devuelve todo calculado.
//
// Depende SOLO de AccountingRepository, así el panel (adaptador Supabase) y
// los tests (fake en memoria) comparten exactamente la misma lógica.
// ============================================================

import {
  aggregateByBuyer,
  aggregateGlobal,
  computeAllPackageMetrics,
} from "./metrics";
import type {
  AccountingRepository,
  BuyerTotals,
  CampaignRow,
  CreatePackageInput,
  GlobalTotals,
  LeadPackage,
  PackageMetrics,
  PackagePayment,
} from "./types";

export interface AccountingSnapshot {
  packages: PackageMetrics[];
  buyers: BuyerTotals[];
  totals: GlobalTotals;
  payments: PackagePayment[];
  /** Todas las campañas con insight (medidas o no), con leads y CPL. */
  campaigns: CampaignRow[];
}

/** Foto completa de la contabilidad de la cuenta, ya calculada. */
export async function loadAccountingSnapshot(
  repo: AccountingRepository,
): Promise<AccountingSnapshot> {
  const [packages, payments, deliveredLeads, leadCounts, insights] =
    await Promise.all([
      repo.listPackages(),
      repo.listPayments(),
      repo.listDeliveredLeads(),
      repo.leadCountByCampaign(),
      repo.listCampaignInsights(),
    ]);

  const metrics = computeAllPackageMetrics(
    packages,
    payments,
    deliveredLeads,
    insights,
    leadCounts,
  );

  // Tabla de campañas: incluye las apagadas, para poder prenderlas.
  const campaigns: CampaignRow[] = insights
    .map((i) => {
      const leads = leadCounts[i.metaCampaignId] ?? 0;
      return {
        ...i,
        leads,
        cpl: leads > 0 && i.spend ? Math.round(i.spend / leads) : null,
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));

  return {
    packages: metrics,
    buyers: aggregateByBuyer(metrics),
    totals: aggregateGlobal(metrics, insights, leadCounts),
    payments,
    campaigns,
  };
}

/**
 * Baja definitiva de una tanda.
 *
 * Distinto de cancelar (`status = 'cancelled'`), que la deja a la vista como
 * anulada: esto la borra para limpiar una carga equivocada. Se lleva sus
 * pagos, pero jamás los leads — un lead entregado es un dato real del
 * negocio, solo deja de pertenecer a una tanda.
 *
 * El orden importa y por eso vive acá y no en el adaptador: primero soltar
 * los leads, después borrar. Al revés, la FK `leads.package_id` (sin
 * cascade) rechaza el DELETE de cualquier tanda que ya haya entregado.
 */
export async function deletePackage(
  repo: AccountingRepository,
  packageId: string,
): Promise<void> {
  const exists = (await repo.listPackages()).some((p) => p.id === packageId);
  if (!exists) throw new Error("Tanda no encontrada");

  await repo.unlinkLeadsFromPackage(packageId);
  await repo.deletePackage(packageId);
}

/** Alta de tanda: el ordinal ("Paula #3") lo resuelve el repositorio. */
export async function createPackage(
  repo: AccountingRepository,
  input: CreatePackageInput,
): Promise<LeadPackage> {
  const ordinal = await repo.nextOrdinal(input.buyerUserId);
  return repo.createPackage({ ...input, ordinal });
}
