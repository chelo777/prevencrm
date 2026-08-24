import { describe, it, expect } from "vitest";
import { reclaimStaleLeads } from "./reclaim";
import { FakeRepo } from "./leads.test-helpers";

// Un lead asignado que nadie trabaja vuelve a la cola del admin. NO se
// reasigna solo a otro asesor: eso movía el problema de escritorio en vez de
// hacerlo visible. Queda sin dueño y el admin recibe el aviso para decidir.

const OPTS = { reclaimAfterIso: "2000-01-01T00:00:00Z", dryRun: false };

function repoConStale() {
  const repo = new FakeRepo();
  repo.deals.push({ id: "d1", assigned: "u1" } as never);
  repo.stale = [{ leadId: "l1", dealId: "d1", assignedAgentId: "u1" }];
  return repo;
}

describe("reclaimStaleLeads", () => {
  it("dry-run: cuenta candidatos pero no toca nada", async () => {
    const repo = repoConStale();
    const res = await reclaimStaleLeads(repo, { ...OPTS, dryRun: true });

    expect(res.candidates).toBe(1);
    expect(res.reclaimed).toBe(0);
    expect(repo.deals[0].assigned).toBe("u1"); // intacto
    expect(repo.notifications).toHaveLength(0); // tampoco avisa
  });

  it("libera el lead y lo deja SIN asignar", async () => {
    const repo = repoConStale();
    const res = await reclaimStaleLeads(repo, OPTS);

    expect(res.reclaimed).toBe(1);
    expect(repo.deals[0].assigned).toBeNull();
    expect(repo.events).toContainEqual({
      userId: "u1",
      dealId: "d1",
      kind: "lead_reclaimed",
    });
  });

  it("NUNCA lo reasigna a otro asesor, aunque haya elegibles", async () => {
    const repo = repoConStale();
    // u2 está disponible y antes se lo llevaba automáticamente.
    await reclaimStaleLeads(repo, OPTS);

    expect(repo.deals[0].assigned).toBeNull();
    expect(repo.events.filter((e) => e.kind === "lead_assigned")).toHaveLength(0);
  });

  it("avisa a cada admin de la cuenta, diciendo a quién se le quitó", async () => {
    const repo = repoConStale();
    repo.admins = ["admin1", "admin2"];
    repo.agentNames = { u1: "Fabiana Soldavini" };

    await reclaimStaleLeads(repo, OPTS);

    expect(repo.notifications).toHaveLength(2);
    const [n] = repo.notifications;
    expect(n.userId).toBe("admin1");
    expect(n.leadId).toBe("l1");
    // El admin tiene que poder leer de quién era sin abrir nada.
    expect(n.body).toContain("Fabiana Soldavini");
  });

  it("sin admins no rompe: el lead igual queda liberado", async () => {
    const repo = repoConStale();
    repo.admins = [];

    const res = await reclaimStaleLeads(repo, OPTS);

    expect(res.reclaimed).toBe(1);
    expect(repo.deals[0].assigned).toBeNull();
    expect(repo.notifications).toHaveLength(0);
  });

  it("informa los leads liberados para el push agrupado", async () => {
    const repo = new FakeRepo();
    repo.admins = ["admin1"];
    repo.deals.push({ id: "d1", assigned: "u1" } as never);
    repo.deals.push({ id: "d2", assigned: "u2" } as never);
    repo.stale = [
      { leadId: "l1", dealId: "d1", assignedAgentId: "u1" },
      { leadId: "l2", dealId: "d2", assignedAgentId: "u2" },
    ];

    const res = await reclaimStaleLeads(repo, OPTS);

    expect(res.reclaimed).toBe(2);
    // Una notificación por lead (para poder abrir cada uno) pero el llamador
    // manda UN push con este resumen.
    expect(res.freed.map((f) => f.leadId)).toEqual(["l1", "l2"]);
    expect(repo.notifications).toHaveLength(2);
  });
});
