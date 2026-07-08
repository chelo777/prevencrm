import { describe, expect, it } from "vitest";
import { renderQuickMessage } from "./render";

describe("renderQuickMessage", () => {
  it("reemplaza nombre, primer nombre y campaña", () => {
    expect(
      renderQuickMessage(
        "Hola {{primer_nombre}}! Vi tu consulta de {{campaña}}. ¿Sos {{nombre}}?",
        { nombre: "María González", campania: "[PS] Dependencia 2026" },
      ),
    ).toBe(
      "Hola María! Vi tu consulta de [PS] Dependencia 2026. ¿Sos María González?",
    );
  });

  it("tolera espacios en las llaves y campana sin ñ", () => {
    expect(
      renderQuickMessage("Hola {{ primer_nombre }} — {{campana}}", {
        nombre: "Juan Pérez",
        campania: "Prepaga",
      }),
    ).toBe("Hola Juan — Prepaga");
  });

  it("limpia el espacio sobrante cuando falta un dato", () => {
    expect(
      renderQuickMessage("Hola {{primer_nombre}}! ¿Cómo estás?", {
        nombre: null,
      }),
    ).toBe("Hola! ¿Cómo estás?");
  });

  it("respeta saltos de línea del cuerpo", () => {
    expect(
      renderQuickMessage("Hola {{primer_nombre}}.\n\nTe escribo por tu plan.", {
        nombre: "Ana",
      }),
    ).toBe("Hola Ana.\n\nTe escribo por tu plan.");
  });

  it("deja intacto un cuerpo sin variables", () => {
    expect(renderQuickMessage("Buen día, ¿seguís interesado?", {})).toBe(
      "Buen día, ¿seguís interesado?",
    );
  });
});
