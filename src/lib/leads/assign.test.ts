import { describe, it, expect } from "vitest";
import { assignFromPool } from "./assign";
import { FakeRepo } from "./leads.test-helpers";

describe("assignFromPool", () => {
  it("asigna al least-loaded y registra el evento", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d1" } as never);
    const who = await assignFromPool(repo, "d1");
    expect(who).toBe("u1"); // openDeals 0
    expect(repo.events).toContainEqual({ userId: "u1", dealId: "d1", kind: "lead_assigned" });
  });
  it("excluye al asesor indicado (reclamo)", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d2" } as never);
    const who = await assignFromPool(repo, "d2", "u1");
    expect(who).toBe("u2");
  });
  it("devuelve null si no hay elegibles", async () => {
    const repo = new FakeRepo();
    repo.eligible = [];
    repo.deals.push({ id: "d3" } as never);
    expect(await assignFromPool(repo, "d3")).toBeNull();
  });
});
