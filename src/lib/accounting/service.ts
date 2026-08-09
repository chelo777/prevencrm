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

  return {
    packages: metrics,
    buyers: aggregateByBuyer(metrics),
    totals: aggregateGlobal(metrics, insights),
    payments,
  };
}

/** Alta de tanda: el ordinal ("Paula #3") lo resuelve el repositorio. */
export async function createPackage(
  repo: AccountingRepository,
  input: CreatePackageInput,
): Promise<LeadPackage> {
  const ordinal = await repo.nextOrdinal(input.buyerUserId);
  return repo.createPackage({ ...input, ordinal });
}
