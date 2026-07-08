import { describe, expect, it } from "vitest";
import { buildLeadAlert } from "./lead-alerts";

describe("buildLeadAlert", () => {
  it("1 lead: nombre — campaña, apunta a /leads", () => {
    expect(
      buildLeadAlert([
        { name: "María González", campaign: "[PS] Dependencia 2026" },
      ]),
    ).toEqual({
      title: "Nuevo lead",
      body: "María González — [PS] Dependencia 2026",
      url: "/leads",
      tag: "new-lead",
    });
  });

  it("1 lead sin campaña: solo el nombre", () => {
    expect(buildLeadAlert([{ name: "Juan Pérez", campaign: null }]).body).toBe(
      "Juan Pérez",
    );
  });

  it("1 lead sin nombre: fallback legible", () => {
    expect(buildLeadAlert([{ name: "   ", campaign: null }]).body).toBe(
      "Sin nombre",
    );
  });

  it("varios leads: un solo resumen con el conteo", () => {
    const alert = buildLeadAlert([
      { name: "A", campaign: null },
      { name: "B", campaign: null },
      { name: "C", campaign: null },
    ]);
    expect(alert.title).toBe("Leads nuevos");
    expect(alert.body).toContain("3");
    expect(alert.tag).toBe("new-lead");
  });
});
