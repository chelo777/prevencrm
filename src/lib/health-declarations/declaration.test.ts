import { describe, expect, it } from "vitest";
import {
  emptyDeclaration,
  emptyMember,
  formatDeclaration,
  isSummaryVisible,
  parseDeclaration,
  QUESTIONS,
  type Declaration,
  type Member,
} from "./declaration";
import {
  generateDeclarationToken,
  hashDeclarationToken,
  isPlausibleDeclarationToken,
} from "./token";

function filled(sex: "m" | "f", overrides: Partial<Member> = {}): Member {
  const m = emptyMember("titular");
  m.sex = sex;
  m.age = "35";
  m.heightCm = "178";
  m.weightKg = "82,5";
  for (const q of QUESTIONS) m.answers[q.key] = { value: "no", detail: "" };
  if (sex === "f") m.lastPeriod = "2026-10-10";
  return { ...m, ...overrides };
}

function declaration(members: Member[]): Declaration {
  return { members, children: { value: "no", detail: "" } };
}

describe("parseDeclaration", () => {
  it("acepta una declaración completa de hombre", () => {
    const { errors } = parseDeclaration(declaration([filled("m")]));
    expect(errors).toEqual([]);
  });

  it("lista lo que falta en una declaración vacía", () => {
    const { errors } = parseDeclaration(emptyDeclaration());
    expect(errors).toContain("Titular: elegí Hombre o Mujer");
    expect(errors).toContain("Titular: falta la edad");
    expect(errors).toContain('Falta responder "Hijos / cobertura"');
  });

  it("a una mujer le exige las preguntas de mujer", () => {
    const m = filled("f");
    m.answers.pregnancy = { value: null, detail: "" };
    const { errors } = parseDeclaration(declaration([m]));
    expect(errors).toEqual(["Titular: falta responder “Embarazo en curso”"]);
  });

  it("a un hombre le descarta respuestas de mujer que lleguen igual", () => {
    const m = filled("m");
    m.answers.pregnancy = { value: "si", detail: "12 semanas" };
    m.lastPeriod = "2026-10-10";
    const { declaration: d } = parseDeclaration(declaration([m]));
    expect(d.members[0].answers.pregnancy).toBeUndefined();
    expect(d.members[0].lastPeriod).toBe("");
  });

  it("el detalle solo se guarda si la respuesta es Sí", () => {
    const m = filled("m");
    m.answers.medication = { value: "no", detail: "quedó escrito" };
    const { declaration: d } = parseDeclaration(declaration([m]));
    expect(d.members[0].answers.medication.detail).toBe("");
  });

  it("el primer integrante es siempre el titular y los demás piden nombre", () => {
    const pareja = filled("f", { relation: "titular", name: "" });
    const { declaration: d, errors } = parseDeclaration(
      declaration([filled("m"), pareja]),
    );
    expect(d.members[0].relation).toBe("titular");
    expect(d.members[1].relation).toBe("otro");
    expect(errors).toContain("Otro familiar: falta el nombre");
  });

  it("corta textos largos y limita la cantidad de integrantes", () => {
    const m = filled("m");
    m.answers.medication = { value: "si", detail: "x".repeat(5000) };
    const { declaration: d } = parseDeclaration(
      declaration(Array.from({ length: 20 }, () => m)),
    );
    expect(d.members).toHaveLength(8);
    expect(d.members[0].answers.medication.detail).toHaveLength(300);
  });

  it("no acepta tipos de lente inventados", () => {
    const m = filled("m", { glassesTypes: ["Miopía", "<script>"] });
    m.answers.glasses = { value: "si", detail: "" };
    const { declaration: d } = parseDeclaration(declaration([m]));
    expect(d.members[0].glassesTypes).toEqual(["Miopía"]);
  });
});

describe("formatDeclaration", () => {
  it("arma un texto legible con el grupo familiar", () => {
    const titular = filled("m", { name: "Juan" });
    titular.answers.glasses = { value: "si", detail: "" };
    titular.glassesTypes = ["Miopía", "Astigmatismo"];
    const pareja = filled("f", { relation: "pareja", name: "María" });
    pareja.answers.contraceptive = { value: "si", detail: "DIU, marzo 2024" };
    const d = declaration([titular, pareja]);
    d.children = { value: "si", detail: "2 hijos, 5 y 8 años, sin cobertura" };

    const text = formatDeclaration(d, {
      name: "Juan Pérez",
      date: new Date("2026-10-29T15:00:00Z"),
    });

    expect(text).toContain("*Declaración de salud*\nJuan Pérez · 29/10/2026");
    expect(text).toContain("*Titular — Juan* (Hombre)");
    expect(text).toContain("Edad, altura y peso: 35 años - 178 cm - 82,5 kg");
    expect(text).toContain("Medicación crónica: NO");
    expect(text).toContain("Lentes: SÍ — Miopía, Astigmatismo");
    expect(text).toContain("*Pareja — María* (Mujer)");
    expect(text).toContain("Dispositivo anticonceptivo: SÍ — DIU, marzo 2024");
    expect(text).toContain("Última menstruación: 10/10/2026");
    expect(text).toContain(
      "*Hijos / cobertura:* SÍ — 2 hijos, 5 y 8 años, sin cobertura",
    );
    // Al hombre no se le pregunta por embarazo.
    expect(text.split("Embarazo en curso")).toHaveLength(2);
  });
});

describe("token", () => {
  it("genera tokens de 22 caracteres válidos y distintos", () => {
    const a = generateDeclarationToken();
    const b = generateDeclarationToken();
    expect(isPlausibleDeclarationToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashDeclarationToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rechaza tokens con forma inválida", () => {
    expect(isPlausibleDeclarationToken("corto")).toBe(false);
    expect(isPlausibleDeclarationToken("a".repeat(21) + "/")).toBe(false);
  });
});

describe("isSummaryVisible", () => {
  const submitted = "2026-10-01T12:00:00Z";
  const day = 86_400_000;
  const t0 = new Date(submitted).getTime();

  it("se ve durante los primeros 7 días", () => {
    expect(isSummaryVisible(submitted, t0 + 6 * day)).toBe(true);
  });

  it("deja de verse a los 7 días", () => {
    expect(isSummaryVisible(submitted, t0 + 7 * day)).toBe(false);
  });

  it("sin fecha de respuesta no se ve", () => {
    expect(isSummaryVisible(null, t0)).toBe(false);
  });
});
