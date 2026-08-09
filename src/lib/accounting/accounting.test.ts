import { describe, it, expect } from "vitest";
import {
  aggregateByBuyer,
  aggregateGlobal,
  campaignCostPerLead,
  computeAllPackageMetrics,
  computePackageMetrics,
  packageMetaCost,
  paymentStatusOf,
} from "./metrics";
import { createPackage, loadAccountingSnapshot } from "./service";
import { FakeAccountingRepo, makePackage } from "./accounting.test-helpers";
import { hasMinRole } from "@/lib/auth/roles";
import type { DeliveredLead, PackagePayment } from "./types";

const pay = (packageId: string, amount: number): PackagePayment => ({
  id: `p_${packageId}_${amount}`,
  packageId,
  paidOn: "2026-08-01",
  amount,
  note: null,
});

// ------------------------------------------------------------
// Saldo y estado de pago
// ------------------------------------------------------------
describe("saldo y estado de pago", () => {
  it("sin pagos → DEBE, saldo = precio", () => {
    const m = computePackageMetrics(makePackage(), [], [], new Map());
    expect(m.paid).toBe(0);
    expect(m.balance).toBe(300000);
    expect(m.paymentStatus).toBe("DEBE");
    expect(m.pricePerLead).toBe(6000); // 300.000 / 50
  });

  it("pagos parciales suman y quedan en PARCIAL", () => {
    const m = computePackageMetrics(
      makePackage(),
      [pay("pkg_1", 100000), pay("pkg_1", 50000)],
      [],
      new Map(),
    );
    expect(m.paid).toBe(150000);
    expect(m.balance).toBe(150000);
    expect(m.paidPct).toBeCloseTo(0.5);
    expect(m.paymentStatus).toBe("PARCIAL");
  });

  it("pago exacto → PAGADO con saldo 0", () => {
    const m = computePackageMetrics(makePackage(), [pay("pkg_1", 300000)], [], new Map());
    expect(m.balance).toBe(0);
    expect(m.paymentStatus).toBe("PAGADO");
  });

  it("pago EXCEDENTE → saldo negativo (a favor), sigue PAGADO", () => {
    const m = computePackageMetrics(makePackage(), [pay("pkg_1", 350000)], [], new Map());
    expect(m.balance).toBe(-50000); // saldo a favor de la compradora
    expect(m.paymentStatus).toBe("PAGADO");
  });

  it("paymentStatusOf cubre los tres casos", () => {
    expect(paymentStatusOf(100, 0)).toBe("DEBE");
    expect(paymentStatusOf(100, 40)).toBe("PARCIAL");
    expect(paymentStatusOf(100, 100)).toBe("PAGADO");
    expect(paymentStatusOf(100, 120)).toBe("PAGADO");
  });
});

// ------------------------------------------------------------
// Prorrateo de costo Meta
// ------------------------------------------------------------
describe("prorrateo de costo Meta", () => {
  // Campaña A: gastó 100.000 y trajo 100 leads → 1.000 por lead.
  const insights = [{ metaCampaignId: "A", campaignName: "A", spend: 100000 }];
  const counts = { A: 100 };

  it("costo por lead = spend / leads totales de la campaña", () => {
    const cpl = campaignCostPerLead(insights, counts);
    expect(cpl.get("A")).toBe(1000);
  });

  it("dos tandas que COMPARTEN campaña se reparten el gasto por lead recibido", () => {
    const delivered: DeliveredLead[] = [
      ...Array.from({ length: 30 }, () => ({ packageId: "pkg_1", campaignId: "A" })),
      ...Array.from({ length: 20 }, () => ({ packageId: "pkg_2", campaignId: "A" })),
    ];
    const metrics = computeAllPackageMetrics(
      [
        makePackage({ id: "pkg_1" }),
        makePackage({ id: "pkg_2", ordinal: 2 }),
      ],
      [],
      delivered,
      insights,
      counts,
    );
    const p1 = metrics.find((m) => m.packageId === "pkg_1")!;
    const p2 = metrics.find((m) => m.packageId === "pkg_2")!;
    expect(p1.delivered).toBe(30);
    expect(p1.metaCost).toBe(30000); // 30 × 1.000
    expect(p2.metaCost).toBe(20000); // 20 × 1.000
    // El gasto atribuido no supera lo gastado en la campaña.
    expect(p1.metaCost + p2.metaCost).toBeLessThanOrEqual(100000);
    expect(p1.margin).toBe(270000); // 300.000 − 30.000
  });

  it("lead sin campaña, o de campaña sin insight, suma 0", () => {
    const cpl = campaignCostPerLead(insights, counts);
    expect(
      packageMetaCost(
        [
          { packageId: "pkg_1", campaignId: null },
          { packageId: "pkg_1", campaignId: "DESCONOCIDA" },
        ],
        cpl,
      ),
    ).toBe(0);
  });

  it("campaña con spend pero 0 leads no explota (no divide por cero)", () => {
    const cpl = campaignCostPerLead(insights, { A: 0 });
    expect(cpl.has("A")).toBe(false);
  });
});

// ------------------------------------------------------------
// Tanda cancelada
// ------------------------------------------------------------
describe("tanda cancelada", () => {
  const packages = [
    makePackage({ id: "pkg_1" }),
    makePackage({ id: "pkg_2", ordinal: 2, status: "cancelled" }),
  ];
  const payments = [pay("pkg_1", 100000), pay("pkg_2", 30000)];

  it("sale de 'a cobrar' y de la deuda", () => {
    const metrics = computeAllPackageMetrics(packages, payments, [], [], {});
    const totals = aggregateGlobal(metrics, []);
    expect(totals.toCollect).toBe(300000); // solo la tanda viva
    expect(totals.owed).toBe(200000); // 300.000 − 100.000, la cancelada no suma
  });

  it("conserva su historial de pagos en lo cobrado", () => {
    const metrics = computeAllPackageMetrics(packages, payments, [], [], {});
    const totals = aggregateGlobal(metrics, []);
    expect(totals.collected).toBe(130000); // 100.000 + 30.000 (la plata entró)
  });

  it("no infla lo comprado de la compradora", () => {
    const metrics = computeAllPackageMetrics(packages, payments, [], [], {});
    const [buyer] = aggregateByBuyer(metrics);
    expect(buyer.packages).toBe(2);
    expect(buyer.openPackages).toBe(1);
    expect(buyer.totalPurchased).toBe(300000);
    expect(buyer.totalPaid).toBe(130000);
  });
});

// ------------------------------------------------------------
// Totales globales
// ------------------------------------------------------------
describe("totales globales", () => {
  it("margen = a cobrar − gasto Meta TOTAL (incluye tráfico no vendido)", () => {
    const metrics = computeAllPackageMetrics([makePackage()], [], [], [], {});
    const totals = aggregateGlobal(metrics, [
      { metaCampaignId: "A", campaignName: "A", spend: 80000 },
      { metaCampaignId: "B", campaignName: "B", spend: 20000 },
    ]);
    expect(totals.metaSpend).toBe(100000);
    expect(totals.margin).toBe(200000);
  });

  it("un saldo a favor no descuenta la deuda de otra tanda", () => {
    const metrics = computeAllPackageMetrics(
      [makePackage({ id: "pkg_1" }), makePackage({ id: "pkg_2", ordinal: 2 })],
      [pay("pkg_1", 400000)], // sobrepagada
      [],
      [],
      {},
    );
    const totals = aggregateGlobal(metrics, []);
    expect(totals.owed).toBe(300000); // solo lo que debe pkg_2
  });
});

// ------------------------------------------------------------
// Servicio sobre el puerto (FakeRepo)
// ------------------------------------------------------------
describe("servicio", () => {
  it("arma la foto completa desde el puerto", async () => {
    const repo = new FakeAccountingRepo();
    repo.packages = [makePackage({ id: "pkg_1" })];
    repo.payments = [pay("pkg_1", 120000)];
    repo.delivered = [{ packageId: "pkg_1", campaignId: "A" }];
    repo.counts = { A: 10 };
    repo.insights = [{ metaCampaignId: "A", campaignName: "A", spend: 50000 }];

    const snap = await loadAccountingSnapshot(repo);
    expect(snap.packages).toHaveLength(1);
    expect(snap.packages[0].metaCost).toBe(5000); // 1 lead × (50.000/10)
    expect(snap.buyers[0].totalPaid).toBe(120000);
    expect(snap.totals.toCollect).toBe(300000);
    expect(snap.totals.metaSpend).toBe(50000);
  });

  it("el ordinal se autoincrementa por compradora", async () => {
    const repo = new FakeAccountingRepo();
    const input = { leadsTarget: 50, price: 300000, committedAt: null };
    const a1 = await createPackage(repo, { ...input, buyerUserId: "ale" });
    const a2 = await createPackage(repo, { ...input, buyerUserId: "ale" });
    const f1 = await createPackage(repo, { ...input, buyerUserId: "fabi" });
    expect(a1.ordinal).toBe(1);
    expect(a2.ordinal).toBe(2);
    expect(f1.ordinal).toBe(1); // por compradora, no global
  });
});

// ------------------------------------------------------------
// Roles: la contabilidad es admin-only
// ------------------------------------------------------------
describe("gate de rol", () => {
  it("una asesora (agent) NO pasa el gate admin de las rutas de contabilidad", () => {
    expect(hasMinRole("agent", "admin")).toBe(false);
    expect(hasMinRole("viewer", "admin")).toBe(false);
  });

  it("owner y admin sí", () => {
    expect(hasMinRole("admin", "admin")).toBe(true);
    expect(hasMinRole("owner", "admin")).toBe(true);
  });
});
