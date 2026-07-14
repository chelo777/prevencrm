import { describe, expect, it } from "vitest";
import { buildLeadAlert } from "./lead-alerts";

describe("buildLeadAlert", () => {
  it("1 lead: nombre — campaña, deep-link al lead", () => {
    expect(
      buildLeadAlert([
        {
          leadId: "lead-1",
          name: "María González",
          campaign: "[PS] Dependencia 2026",
        },
      ]),
    ).toEqual({
      title: "Nuevo lead",
      body: "María González — [PS] Dependencia 2026",
      url: "/leads?lead=lead-1",
      tag: "new-lead",
    });
  });

  it("1 lead sin campaña: solo el nombre", () => {
    expect(
      buildLeadAlert([{ leadId: "l", name: "Juan Pérez", campaign: null }])
        .body,
    ).toBe("Juan Pérez");
  });

  it("1 lead sin nombre: fallback legible", () => {
    expect(
      buildLeadAlert([{ leadId: "l", name: "   ", campaign: null }]).body,
    ).toBe("Sin nombre");
  });

  it("varios leads: un solo resumen con el conteo, /leads pelado", () => {
    const alert = buildLeadAlert([
      { leadId: "a", name: "A", campaign: null },
      { leadId: "b", name: "B", campaign: null },
      { leadId: "c", name: "C", campaign: null },
    ]);
    expect(alert.title).toBe("Leads nuevos");
    expect(alert.body).toContain("3");
    expect(alert.url).toBe("/leads");
    expect(alert.tag).toBe("new-lead");
  });
});
