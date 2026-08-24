import { describe, it, expect } from "vitest";
import { pickByQuota } from "./ingest";
import { assignByQuota } from "./assign";
import { ingestLead } from "./ingest";
import { FakeRepo } from "./leads.test-helpers";
import type { NormalizedLead, OpenPackage } from "./types";

// Reparto por cupo de tanda (handoff §4). Tests obligatorios del spec.

const pkg = (over: Partial<OpenPackage> = {}): OpenPackage & { status: "open" } => ({
  packageId: over.packageId ?? "pk1",
  buyerUserId: over.buyerUserId ?? "ale",
  leadsTarget: over.leadsTarget ?? 50,
  delivered: over.delivered ?? 0,
  createdAt: over.createdAt ?? "2026-08-01T00:00:00Z",
  lastDeliveredAt: over.lastDeliveredAt ?? null,
  status: "open",
});

function lead(n: number): NormalizedLead {
  return {
    metaLeadId: `l:${n}`,
    name: `Lead ${n}`,
    phoneRaw: `p:+54911000000${n}`,
    phoneE164: `+54911000000${n}`,
    phoneValid: true,
    email: null,
    attribution: {
      platform: null,
      isOrganic: null,
      campaignId: null,
      campaignName: null,
      adsetId: null,
      adsetName: null,
      adId: null,
      adName: null,
      formId: null,
      formName: null,
    },
    leadCreatedTime: null,
    customFields: {},
    comments: null,
    statusRaw: null,
    raw: {},
  };
}

const QUOTA = { autoAssign: true, assignmentStrategy: "quota" as const };

describe("pickByQuota (rotación 1-a-1)", () => {
  it("gana la que hace más tiempo que no recibe, no la de menos entregados", () => {
    // "b" es la que menos acumuló, pero acaba de recibir. El turno es de "a",
    // que hace más que no recibe aunque lleve 10 entregados.
    const pick = pickByQuota([
      pkg({ packageId: "a", delivered: 10, lastDeliveredAt: "2026-08-22T08:00:00Z" }),
      pkg({ packageId: "b", delivered: 3, lastDeliveredAt: "2026-08-22T12:00:00Z" }),
      pkg({ packageId: "c", delivered: 7, lastDeliveredAt: "2026-08-22T10:00:00Z" }),
    ]);
    expect(pick?.packageId).toBe("a");
  });

  it("una tanda que nunca recibió va antes que cualquiera que ya recibió", () => {
    const pick = pickByQuota([
      pkg({ packageId: "vieja", delivered: 35, lastDeliveredAt: "2020-01-01T00:00:00Z" }),
      pkg({ packageId: "estrenada", delivered: 0, lastDeliveredAt: null }),
    ]);
    expect(pick?.packageId).toBe("estrenada");
  });

  it("entre las que nunca recibieron → la tanda más vieja", () => {
    const pick = pickByQuota([
      pkg({ packageId: "nueva", createdAt: "2026-08-05T00:00:00Z" }),
      pkg({ packageId: "vieja", createdAt: "2026-08-01T00:00:00Z" }),
    ]);
    expect(pick?.packageId).toBe("vieja");
  });

  it("descarta las que llegaron al cupo", () => {
    expect(pickByQuota([pkg({ delivered: 50, leadsTarget: 50 })])).toBeNull();
  });

  it("sin tandas → null", () => {
    expect(pickByQuota([])).toBeNull();
  });

  // ── El caso reportado ──
  it("una tanda 0/50 NO deja seca a una 35/50: se alternan de a uno", async () => {
    const repo = new FakeRepo();
    repo.packages = [
      pkg({ packageId: "nueva", buyerUserId: "nueva-asesora", delivered: 0 }),
      pkg({
        packageId: "encurso",
        buyerUserId: "asesora-con-35",
        delivered: 35,
        lastDeliveredAt: "2026-08-21T00:00:00Z",
      }),
    ];

    const recibieron: string[] = [];
    for (let i = 0; i < 6; i++) {
      repo.deals.push({ id: `d${i}`, assigned: null, stageId: "s1" });
      const who = await assignByQuota(repo, `lead${i}`, `d${i}`);
      recibieron.push(who!);
    }

    // Antes: los 6 iban a la tanda nueva (y los 29 siguientes también).
    expect(recibieron).toEqual([
      "nueva-asesora",
      "asesora-con-35",
      "nueva-asesora",
      "asesora-con-35",
      "nueva-asesora",
      "asesora-con-35",
    ]);
  });
});

describe("assignByQuota", () => {
  it("asigna a la compradora y SELLA leads.package_id", async () => {
    const repo = new FakeRepo();
    repo.packages = [pkg({ packageId: "pk1", buyerUserId: "ale" })];
    repo.deals.push({ id: "d1", assigned: null, stageId: "s1" });

    const who = await assignByQuota(repo, "lead1", "d1");

    expect(who).toBe("ale");
    expect(repo.deals[0].assigned).toBe("ale");
    expect(repo.sealed.get("lead1")).toBe("pk1");
    expect(repo.events).toEqual([
      { userId: "ale", dealId: "d1", kind: "lead_assigned" },
    ]);
  });

  it("cierra la tanda que llegó al cupo (idempotente)", async () => {
    const repo = new FakeRepo();
    repo.packages = [
      pkg({ packageId: "llena", delivered: 50, leadsTarget: 50 }),
      pkg({ packageId: "libre", delivered: 0, createdAt: "2026-08-02T00:00:00Z" }),
    ];
    repo.deals.push({ id: "d1", assigned: null, stageId: "s1" });

    await assignByQuota(repo, "lead1", "d1");

    expect(repo.packages.find((p) => p.packageId === "llena")?.status).toBe(
      "completed",
    );
    expect(repo.sealed.get("lead1")).toBe("libre");
  });

  it("deal ya asignado → no sella tanda (no se le entregó nada)", async () => {
    const repo = new FakeRepo();
    repo.packages = [pkg()];
    repo.deals.push({ id: "d1", assigned: "otra", stageId: "s1" });

    const who = await assignByQuota(repo, "lead1", "d1");

    expect(who).toBeNull();
    expect(repo.sealed.size).toBe(0);
    expect(repo.packages[0].delivered).toBe(0);
  });
});

describe("ingesta con estrategia quota", () => {
  it("respeta el cupo: la tanda recibe EXACTAMENTE su target y deja de recibir", async () => {
    const repo = new FakeRepo();
    repo.packages = [pkg({ packageId: "pk1", leadsTarget: 3 })];

    for (let i = 1; i <= 5; i++) {
      await ingestLead(repo, lead(i), QUOTA);
    }

    expect(repo.packages[0].delivered).toBe(3);
    expect(repo.packages[0].status).toBe("completed");
    expect(repo.sealed.size).toBe(3);
    // Los 2 sobrantes quedaron sin asignar (cola de admin).
    expect(repo.deals.filter((d) => d.assigned === null)).toHaveLength(2);
  });

  it("rotación pareja entre 3 tandas abiertas", async () => {
    const repo = new FakeRepo();
    repo.packages = [
      pkg({ packageId: "a", buyerUserId: "ale", createdAt: "2026-08-01T00:00:00Z" }),
      pkg({ packageId: "b", buyerUserId: "fabi", createdAt: "2026-08-02T00:00:00Z" }),
      pkg({ packageId: "c", buyerUserId: "paula", createdAt: "2026-08-03T00:00:00Z" }),
    ];

    for (let i = 1; i <= 9; i++) {
      await ingestLead(repo, lead(i), QUOTA);
    }

    // 9 leads entre 3 tandas: 3 cada una, sin importar el orden interno.
    for (const p of repo.packages) expect(p.delivered).toBe(3);
  });

  it("sin tandas abiertas → el lead queda SIN asignar y no explota", async () => {
    const repo = new FakeRepo();
    repo.packages = [];

    const result = await ingestLead(repo, lead(1), QUOTA);

    expect(result.outcome).toBe("processed");
    expect(repo.deals[0].assigned).toBeNull();
    expect(repo.sealed.size).toBe(0);
  });

  it("tanda de comprador NO habilitado nunca recibe (el repo no la lista)", async () => {
    const repo = new FakeRepo();
    // El adaptador real filtra is_lead_buyer/receiving_leads/blocked; el fake
    // lo representa dejando la tanda fuera de listOpenPackages.
    repo.packages = [pkg({ packageId: "deshabilitada" })];
    repo.packages[0].status = "completed";

    await ingestLead(repo, lead(1), QUOTA);

    expect(repo.deals[0].assigned).toBeNull();
    expect(repo.sealed.size).toBe(0);
  });

  it("reingestar el mismo meta_lead_id no duplica ni re-sella", async () => {
    const repo = new FakeRepo();
    repo.packages = [pkg({ packageId: "pk1", leadsTarget: 10 })];

    await ingestLead(repo, lead(1), QUOTA);
    const second = await ingestLead(repo, lead(1), QUOTA);

    expect(second.outcome).toBe("skipped_duplicate");
    expect(repo.deals).toHaveLength(1);
    expect(repo.sealed.size).toBe(1);
    expect(repo.packages[0].delivered).toBe(1);
  });

  it("la estrategia default (least_loaded) sigue intacta: no toca tandas", async () => {
    const repo = new FakeRepo();
    repo.packages = [pkg()];

    await ingestLead(repo, lead(1), { autoAssign: true });

    expect(repo.sealed.size).toBe(0);
    expect(repo.deals[0].assigned).toBe("u1"); // el menos cargado del pozo
  });
});
