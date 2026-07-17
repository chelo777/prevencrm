import { describe, it, expect } from "vitest";
import { reclaimStaleLeads } from "./reclaim";
import { FakeRepo } from "./leads.test-helpers";

const OPTS = { reclaimAfterIso: "2000-01-01T00:00:00Z", dryRun: false };

describe("reclaimStaleLeads", () => {
  it("dry-run: cuenta candidatos pero NO reasigna", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d1", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l1", dealId: "d1", assignedAgentId: "u1" }];
    const res = await reclaimStaleLeads(repo, { ...OPTS, dryRun: true });
    expect(res.candidates).toBe(1);
    expect(res.reclaimed).toBe(0);
    expect(repo.deals[0].assigned).toBe("u1"); // intacto
  });
  it("reasigna a otro y registra reclaim+assign", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d1", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l1", dealId: "d1", assignedAgentId: "u1" }];
    const res = await reclaimStaleLeads(repo, OPTS);
    expect(res.reclaimed).toBe(1);
    expect(res.reassigned).toBe(1);
    expect(repo.deals[0].assigned).toBe("u2");
    expect(repo.events).toContainEqual({ userId: "u1", dealId: "d1", kind: "lead_reclaimed" });
    expect(repo.events).toContainEqual({ userId: "u2", dealId: "d1", kind: "lead_assigned" });
  });
  it("sin otro elegible: reclama pero queda sin asignar", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d2", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l2", dealId: "d2", assignedAgentId: "u1" }];
    repo.eligible = [{ userId: "u1", openDeals: 0 }]; // solo el original
    const res = await reclaimStaleLeads(repo, OPTS);
    expect(res.reclaimed).toBe(1);
    expect(res.reassigned).toBe(0);
    expect(repo.deals[0].assigned).toBeNull();
  });
});
