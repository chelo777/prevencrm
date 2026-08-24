import { describe, expect, it } from "vitest";
import { buildLeadAlert, buildReclaimAlert } from "./lead-alerts";

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

describe("buildReclaimAlert", () => {
  it("un lead: nombra el contacto y a quién se le quitó", () => {
    const p = buildReclaimAlert([
      { leadId: "l1", contactName: "Ana Pérez", previousAgentName: "Fabiana" },
    ]);
    expect(p.title).toBe("Lead liberado");
    expect(p.body).toContain("Ana Pérez");
    expect(p.body).toContain("Fabiana");
    expect(p.url).toBe("/leads?lead=l1");
  });

  it("varios: un solo push agrupado, sin deep-link a uno", () => {
    const p = buildReclaimAlert([
      { leadId: "l1", contactName: "Ana", previousAgentName: "Fabiana" },
      { leadId: "l2", contactName: "Beto", previousAgentName: "Alexis" },
    ]);
    expect(p.title).toBe("2 leads liberados");
    expect(p.url).toBe("/leads?asesora=none");
  });

  it("sin nombre de contacto no rompe el mensaje", () => {
    const p = buildReclaimAlert([
      { leadId: "l1", contactName: null, previousAgentName: null },
    ]);
    expect(p.body).toContain("Sin nombre");
  });
});
