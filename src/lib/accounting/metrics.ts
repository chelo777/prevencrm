// ============================================================
// Cálculo de la contabilidad — funciones PURAS (sin I/O, testeables).
//
// Todo se calcula server-side y viaja ya resuelto al cliente: el panel no
// recalcula plata.
// ============================================================

import type {
  BuyerTotals,
  CampaignInsight,
  DeliveredLead,
  GlobalTotals,
  LeadPackage,
  PackageMetrics,
  PackagePayment,
  PaymentStatus,
} from "./types";

/** Redondeo a 2 decimales — evita que el binario de JS arrastre 0.30000000004. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Estado de pago derivado:
 *   PAGADO  saldo <= 0 (incluye el pago excedente → saldo a favor)
 *   DEBE    no pagó nada
 *   PARCIAL pagó algo pero no cubre el precio
 * Una tanda de precio 0 se considera PAGADA (no hay nada que cobrar).
 */
export function paymentStatusOf(price: number, paid: number): PaymentStatus {
  if (paid >= price) return "PAGADO";
  if (paid <= 0) return "DEBE";
  return "PARCIAL";
}

/**
 * Costo Meta por lead de cada campaña:
 *
 *     costoPorLead(campaña) = spend(campaña) ÷ leads_totales(campaña)
 *
 * El denominador son TODOS los leads que esa campaña trajo al CRM (estén o no
 * en una tanda): el gasto se repartió entre todos ellos, no solo entre los
 * vendidos. Campañas sin spend o sin leads quedan fuera (costo 0), así una
 * campaña sin insight todavía no ensucia el margen con un NaN.
 */
export function campaignCostPerLead(
  insights: CampaignInsight[],
  leadCountByCampaign: Record<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const ins of insights) {
    // Campaña no medida: sus leads no cargan costo (ver `tracked`, 052).
    if (!ins.tracked) continue;
    const spend = ins.spend ?? 0;
    const total = leadCountByCampaign[ins.metaCampaignId] ?? 0;
    if (spend <= 0 || total <= 0) continue;
    out.set(ins.metaCampaignId, spend / total);
  }
  return out;
}

/**
 * Costo Meta atribuido a una tanda: PRORRATEO POR LEAD.
 *
 *     costo(tanda) = Σ  costoPorLead(campaña del lead)
 *                   leads entregados en la tanda
 *
 * Ejemplo: campaña A gastó 100.000 y trajo 100 leads → 1.000 por lead. Si la
 * tanda recibió 30 leads de A, su costo atribuido es 30.000. Dos tandas que
 * comparten campaña se reparten el gasto en proporción a los leads que recibió
 * cada una. Un lead sin campaña (o de campaña sin insight) suma 0.
 */
export function packageMetaCost(
  deliveredLeads: DeliveredLead[],
  costPerLead: Map<string, number>,
): number {
  let total = 0;
  for (const lead of deliveredLeads) {
    if (!lead.campaignId) continue;
    total += costPerLead.get(lead.campaignId) ?? 0;
  }
  return round2(total);
}

/** Métricas de UNA tanda. `payments` y `leads` ya vienen filtrados por tanda. */
export function computePackageMetrics(
  pkg: LeadPackage,
  payments: PackagePayment[],
  deliveredLeads: DeliveredLead[],
  costPerLead: Map<string, number>,
): PackageMetrics {
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const delivered = deliveredLeads.length;
  const metaCost = packageMetaCost(deliveredLeads, costPerLead);

  return {
    packageId: pkg.id,
    buyerUserId: pkg.buyerUserId,
    ordinal: pkg.ordinal,
    status: pkg.status,
    currency: pkg.currency,
    committedAt: pkg.committedAt,
    createdAt: pkg.createdAt,

    price: pkg.price,
    leadsTarget: pkg.leadsTarget,
    pricePerLead: pkg.leadsTarget > 0 ? round2(pkg.price / pkg.leadsTarget) : 0,
    delivered,
    deliveredPct: pkg.leadsTarget > 0 ? delivered / pkg.leadsTarget : 0,

    paid,
    balance: round2(pkg.price - paid),
    paidPct: pkg.price > 0 ? paid / pkg.price : 1,
    paymentStatus: paymentStatusOf(pkg.price, paid),

    metaCost,
    margin: round2(pkg.price - metaCost),
  };
}

/** Métricas de todas las tandas, resolviendo los cruces una sola vez. */
export function computeAllPackageMetrics(
  packages: LeadPackage[],
  payments: PackagePayment[],
  deliveredLeads: DeliveredLead[],
  insights: CampaignInsight[],
  leadCountByCampaign: Record<string, number>,
): PackageMetrics[] {
  const costPerLead = campaignCostPerLead(insights, leadCountByCampaign);

  const paymentsByPackage = new Map<string, PackagePayment[]>();
  for (const p of payments) {
    const list = paymentsByPackage.get(p.packageId);
    if (list) list.push(p);
    else paymentsByPackage.set(p.packageId, [p]);
  }

  const leadsByPackage = new Map<string, DeliveredLead[]>();
  for (const l of deliveredLeads) {
    const list = leadsByPackage.get(l.packageId);
    if (list) list.push(l);
    else leadsByPackage.set(l.packageId, [l]);
  }

  return packages.map((pkg) =>
    computePackageMetrics(
      pkg,
      paymentsByPackage.get(pkg.id) ?? [],
      leadsByPackage.get(pkg.id) ?? [],
      costPerLead,
    ),
  );
}

/**
 * Agregado por compradora.
 *
 * Las tandas CANCELADAS no suman a lo comprado ni a la deuda (no hay nada que
 * cobrar), pero SÍ conservan sus pagos en `totalPaid`: esa plata entró de
 * verdad y tiene que seguir viéndose.
 */
export function aggregateByBuyer(metrics: PackageMetrics[]): BuyerTotals[] {
  const byBuyer = new Map<string, PackageMetrics[]>();
  for (const m of metrics) {
    const list = byBuyer.get(m.buyerUserId);
    if (list) list.push(m);
    else byBuyer.set(m.buyerUserId, [m]);
  }

  const out: BuyerTotals[] = [];
  for (const [buyerUserId, list] of byBuyer) {
    const active = list.filter((m) => m.status !== "cancelled");
    const totalPurchased = round2(
      active.reduce((s, m) => s + m.price, 0),
    );
    // Los pagos de tandas canceladas cuentan: el dinero entró.
    const totalPaid = round2(list.reduce((s, m) => s + m.paid, 0));
    out.push({
      buyerUserId,
      packages: list.length,
      openPackages: list.filter((m) => m.status === "open").length,
      totalPurchased,
      totalPaid,
      balance: round2(totalPurchased - totalPaid),
      delivered: active.reduce((s, m) => s + m.delivered, 0),
      metaCost: round2(active.reduce((s, m) => s + m.metaCost, 0)),
      margin: round2(active.reduce((s, m) => s + m.margin, 0)),
      paymentStatus: paymentStatusOf(totalPurchased, totalPaid),
    });
  }
  return out.sort((a, b) => b.balance - a.balance);
}

/**
 * Totales globales de la cabecera.
 *
 * `metaSpend` es el gasto REAL de las campañas MEDIDAS (tracked), no solo el
 * atribuido a tandas: si se compra tráfico que todavía no está vendido, el
 * margen tiene que mostrarlo (es la señal de negocio del handoff §4). Las
 * campañas apagadas quedan fuera por completo.
 * `owed` ignora los saldos a favor (una tanda sobrepagada no descuenta la
 * deuda de otra).
 */
export function aggregateGlobal(
  metrics: PackageMetrics[],
  insights: CampaignInsight[],
): GlobalTotals {
  const active = metrics.filter((m) => m.status !== "cancelled");
  const toCollect = round2(active.reduce((s, m) => s + m.price, 0));
  const collected = round2(metrics.reduce((s, m) => s + m.paid, 0));
  const owed = round2(
    active.reduce((s, m) => s + Math.max(0, m.balance), 0),
  );
  const metaSpend = round2(
    insights.filter((i) => i.tracked).reduce((s, i) => s + (i.spend ?? 0), 0),
  );

  return {
    toCollect,
    collected,
    owed,
    metaSpend,
    margin: round2(toCollect - metaSpend),
  };
}
