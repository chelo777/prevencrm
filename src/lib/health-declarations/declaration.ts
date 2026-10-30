// ============================================================
// Declaración de salud: preguntas, validación y texto para WhatsApp.
//
// Compartido por el formulario público (/ds/[token]) y el endpoint que
// lo guarda: el cliente valida para marcar lo que falta, el servidor
// vuelve a validar con la MISMA función y arma el texto — nunca confía
// en un resumen que venga del navegador.
//
// Un formulario para todos: cada integrante elige Hombre/Mujer y las
// preguntas de mujer (embarazo, anticonceptivo, FUM) aparecen solo ahí.
// Así una declaración de grupo familiar cubre a la pareja y a los hijos
// sin mandar dos enlaces.
// ============================================================

export type YesNo = "si" | "no";
export type Sex = "m" | "f";
export type Relation = "titular" | "pareja" | "hijo" | "otro";

export interface YesNoAnswer {
  value: YesNo | null;
  detail: string;
}

export interface Question {
  key: string;
  /** Texto de la pregunta en el formulario. */
  label: string;
  /** Versión corta para el resumen de WhatsApp. */
  short: string;
  /** Qué pedir cuando la respuesta es "Sí". */
  detailLabel: string;
  /** Solo para mujeres. */
  female?: boolean;
}

export const QUESTIONS: Question[] = [
  {
    key: "medication",
    label: "¿Tomás alguna medicación crónica?",
    short: "Medicación crónica",
    detailLabel: "¿Cuál?",
  },
  {
    key: "preexisting",
    label:
      "¿Alguna enfermedad preexistente? (diabetes, coronaria, de la piel, huesos, pulmones, etc.)",
    short: "Enfermedad preexistente",
    detailLabel: "¿Cuál?",
  },
  {
    key: "disability",
    label: "¿Algún grado de discapacidad?",
    short: "Discapacidad",
    detailLabel: "¿Cuál y en qué grado?",
  },
  {
    key: "surgerySequelae",
    label:
      "¿Alguna cirugía que haya dejado secuelas o requiera tratamiento posterior?",
    short: "Cirugía con secuelas / tratamiento",
    detailLabel: "¿Cuál y qué tratamiento?",
  },
  {
    key: "surgeryCommon",
    label: "¿Alguna cirugía como vesícula, apéndice o cesárea?",
    short: "Cirugía (vesícula, apéndice, cesárea)",
    detailLabel: "¿Cuál? Mes y año, y si quedaron secuelas",
  },
  {
    key: "pendingTreatment",
    label: "¿Algún tratamiento pendiente?",
    short: "Tratamiento pendiente",
    detailLabel: "¿Cuál?",
  },
  {
    key: "glasses",
    label: "¿Usás lentes?",
    short: "Lentes",
    detailLabel: "Cirugía ocular u otro problema de visión (opcional)",
  },
  {
    key: "pregnancy",
    label: "¿Embarazo en curso?",
    short: "Embarazo en curso",
    detailLabel: "¿De cuántas semanas?",
    female: true,
  },
  {
    key: "contraceptive",
    label: "¿Tenés algún dispositivo anticonceptivo colocado?",
    short: "Dispositivo anticonceptivo",
    detailLabel: "¿Cuál?",
    female: true,
  },
];

export const GLASSES_OPTIONS = ["Miopía", "Astigmatismo", "Presbicia"] as const;

export const CONTRACEPTIVE_OPTIONS = [
  "DIU de cobre",
  "DIU hormonal (Mirena)",
  "Implante subdérmico",
  "Otro",
] as const;

/** Graduación en dioptrías por ojo (texto tal como figura en la receta). */
export interface EyeRx {
  /** Ojo derecho. */
  od: string;
  /** Ojo izquierdo. */
  oi: string;
}

export const RELATION_LABEL: Record<Relation, string> = {
  titular: "Titular",
  pareja: "Pareja",
  hijo: "Hijo/a",
  otro: "Otro familiar",
};

export interface Member {
  relation: Relation;
  name: string;
  sex: Sex | null;
  age: string;
  heightCm: string;
  weightKg: string;
  answers: Record<string, YesNoAnswer>;
  /** Tipo de lente; solo si glasses = "si". */
  glassesTypes: string[];
  /** Graduación por tipo elegido (clave = el tipo). Opcional. */
  glassesRx: Record<string, EyeRx>;
  /** Solo mujeres con contraceptive = "si". */
  contraceptiveType: string;
  /** Mes y año de colocación, "YYYY-MM". */
  contraceptiveMonth: string;
  /** Fecha de última menstruación (YYYY-MM-DD); solo mujeres. */
  lastPeriod: string;
}

export interface Declaration {
  members: Member[];
  /** "¿Tenés hijos? ¿Tienen cobertura? Edades" — una vez, del titular. */
  children: YesNoAnswer;
}

export const MAX_MEMBERS = 8;

/**
 * Días que el enlace sigue mostrando la declaración ya respondida (para
 * que el prospecto pueda reenviarla). Después muestra solo "ya la
 * enviaste": un enlace reenviado o encontrado en el teléfono no expone
 * datos de salud para siempre. El asesor la sigue viendo en el CRM.
 */
export const SUMMARY_VISIBLE_DAYS = 7;

export function isSummaryVisible(submittedAt: string | null, now: number): boolean {
  if (!submittedAt) return false;
  return now - new Date(submittedAt).getTime() < SUMMARY_VISIBLE_DAYS * 86_400_000;
}
const MAX_TEXT = 300;

export function questionsFor(sex: Sex | null): Question[] {
  return QUESTIONS.filter((q) => !q.female || sex === "f");
}

export function emptyMember(relation: Relation): Member {
  return {
    relation,
    name: "",
    sex: null,
    age: "",
    heightCm: "",
    weightKg: "",
    answers: Object.fromEntries(
      QUESTIONS.map((q) => [q.key, { value: null, detail: "" }]),
    ),
    glassesTypes: [],
    glassesRx: {},
    contraceptiveType: "",
    contraceptiveMonth: "",
    lastPeriod: "",
  };
}

export function emptyDeclaration(): Declaration {
  return {
    members: [emptyMember("titular")],
    children: { value: null, detail: "" },
  };
}

// ------------------------------------------------------------
// Validación
// ------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
}

function yesNo(v: unknown): YesNoAnswer {
  const o = (v ?? {}) as { value?: unknown; detail?: unknown };
  const value = o.value === "si" || o.value === "no" ? o.value : null;
  return { value, detail: value === "si" ? str(o.detail) : "" };
}

/** Número con coma o punto ("51,5", "3.850"). */
function isNumberish(v: string): boolean {
  return /^\d{1,3}([.,]\d{1,3})?$/.test(v);
}

/** Dioptrías como en la receta: "-2,50", "+1.75", "0,5". */
function isDiopter(v: string): boolean {
  return /^[+-]?\d{1,2}([.,]\d{1,2})?$/.test(v);
}

function isYearMonth(v: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Normaliza lo que llega del navegador a un `Declaration` limpio (corta
 * textos, descarta claves desconocidas, borra respuestas que no aplican
 * al sexo elegido) y lista lo que falta completar.
 */
export function parseDeclaration(input: unknown): {
  declaration: Declaration;
  errors: string[];
} {
  const raw = (input ?? {}) as { members?: unknown; children?: unknown };
  const rawMembers = Array.isArray(raw.members)
    ? raw.members.slice(0, MAX_MEMBERS)
    : [];
  const errors: string[] = [];

  const members: Member[] = rawMembers.map((m, i) => {
    const o = (m ?? {}) as Record<string, unknown>;
    const relation: Relation =
      i === 0
        ? "titular"
        : o.relation === "pareja" || o.relation === "hijo"
          ? o.relation
          : "otro";
    const sex: Sex | null = o.sex === "m" || o.sex === "f" ? o.sex : null;
    const rawAnswers = (o.answers ?? {}) as Record<string, unknown>;
    const answers: Record<string, YesNoAnswer> = {};
    for (const q of questionsFor(sex)) answers[q.key] = yesNo(rawAnswers[q.key]);

    const glassesTypes =
      answers.glasses?.value === "si" && Array.isArray(o.glassesTypes)
        ? GLASSES_OPTIONS.filter((g) => (o.glassesTypes as unknown[]).includes(g))
        : [];
    const rawRx = (o.glassesRx ?? {}) as Record<string, unknown>;
    const glassesRx: Record<string, EyeRx> = {};
    const rxErrors: string[] = [];
    for (const g of glassesTypes) {
      const e = (rawRx[g] ?? {}) as { od?: unknown; oi?: unknown };
      const od = str(e.od).replace(/\s/g, "");
      const oi = str(e.oi).replace(/\s/g, "");
      if ((od && !isDiopter(od)) || (oi && !isDiopter(oi))) {
        rxErrors.push(`la graduación de ${g} no es válida (ej. -2,50)`);
      }
      if (od || oi) glassesRx[g] = { od, oi };
    }

    const usesContraceptive = sex === "f" && answers.contraceptive?.value === "si";
    const contraceptiveType =
      usesContraceptive &&
      (CONTRACEPTIVE_OPTIONS as readonly string[]).includes(o.contraceptiveType as string)
        ? (o.contraceptiveType as string)
        : "";
    const contraceptiveMonth = usesContraceptive ? str(o.contraceptiveMonth) : "";
    // El detalle libre del anticonceptivo solo cuenta para "Otro".
    if (usesContraceptive && contraceptiveType !== "Otro") {
      answers.contraceptive.detail = "";
    }

    const lastPeriod = sex === "f" ? str(o.lastPeriod) : "";

    const member: Member = {
      relation,
      name: str(o.name),
      sex,
      age: str(o.age),
      heightCm: str(o.heightCm),
      weightKg: str(o.weightKg),
      answers,
      glassesTypes: [...glassesTypes],
      glassesRx,
      contraceptiveType,
      contraceptiveMonth: isYearMonth(contraceptiveMonth) ? contraceptiveMonth : "",
      lastPeriod: isIsoDate(lastPeriod) ? lastPeriod : "",
    };

    const who = memberTitle(member, i);
    if (i > 0 && !member.name) errors.push(`${who}: falta el nombre`);
    if (!sex) errors.push(`${who}: elegí Hombre o Mujer`);
    if (!/^\d{1,3}$/.test(member.age)) errors.push(`${who}: falta la edad`);
    if (!isNumberish(member.heightCm)) errors.push(`${who}: falta la altura`);
    if (!isNumberish(member.weightKg)) errors.push(`${who}: falta el peso`);
    for (const q of questionsFor(sex)) {
      if (!answers[q.key].value) errors.push(`${who}: falta responder “${q.short}”`);
    }
    if (answers.glasses?.value === "si" && glassesTypes.length === 0) {
      errors.push(`${who}: marcá si es miopía, astigmatismo o presbicia`);
    }
    for (const e of rxErrors) errors.push(`${who}: ${e}`);
    if (usesContraceptive) {
      if (!contraceptiveType) errors.push(`${who}: elegí qué anticonceptivo tenés`);
      else if (contraceptiveType === "Otro" && !answers.contraceptive.detail) {
        errors.push(`${who}: contá qué anticonceptivo tenés`);
      }
      if (!member.contraceptiveMonth) {
        errors.push(`${who}: falta el mes y año de colocación del anticonceptivo`);
      }
    }
    return member;
  });

  if (members.length === 0) errors.push("Faltan los datos del titular");

  const children = yesNo(raw.children);
  if (!children.value) errors.push('Falta responder "Hijos / cobertura"');

  return { declaration: { members, children }, errors };
}

// ------------------------------------------------------------
// Texto para WhatsApp (y para la nota del contacto)
// ------------------------------------------------------------

export function memberTitle(m: Member, index: number): string {
  if (index === 0) return m.name ? `Titular — ${m.name}` : "Titular";
  const base = `${RELATION_LABEL[m.relation]}${m.name ? ` — ${m.name}` : ""}`;
  return base;
}

function answerText(a: YesNoAnswer | undefined, extra?: string): string {
  if (!a?.value) return "—";
  if (a.value === "no") return "NO";
  const detail = [extra, a.detail].filter(Boolean).join(". ");
  return detail ? `SÍ — ${detail}` : "SÍ";
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function glassesText(m: Member): string {
  return m.glassesTypes
    .map((g) => {
      const rx = m.glassesRx[g];
      const eyes = [rx?.od && `OD ${rx.od}`, rx?.oi && `OI ${rx.oi}`].filter(Boolean);
      return eyes.length ? `${g} (${eyes.join(" · ")})` : g;
    })
    .join(", ");
}

function contraceptiveText(m: Member): string {
  const what =
    m.contraceptiveType === "Otro"
      ? m.answers.contraceptive?.detail || "Otro"
      : m.contraceptiveType;
  const [y, mo] = m.contraceptiveMonth.split("-");
  return [what, m.contraceptiveMonth && `colocado ${mo}/${y}`].filter(Boolean).join(", ");
}

function unit(v: string, u: string): string {
  return v ? `${v} ${u}` : "—";
}

/**
 * Resumen legible en WhatsApp (negritas con *) y en la nota del CRM.
 * `name` es el nombre del contacto en el CRM, para el encabezado.
 */
export function formatDeclaration(
  d: Declaration,
  opts: { name?: string | null; date?: Date } = {},
): string {
  const date = (opts.date ?? new Date()).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const lines: string[] = ["*Declaración de salud*"];
  lines.push([opts.name?.trim(), date].filter(Boolean).join(" · "));

  d.members.forEach((m, i) => {
    lines.push("");
    const sex = m.sex === "f" ? "Mujer" : m.sex === "m" ? "Hombre" : "";
    lines.push(`*${memberTitle(m, i)}*${sex ? ` (${sex})` : ""}`);
    lines.push(
      `Edad, altura y peso: ${unit(m.age, "años")} - ${unit(m.heightCm, "cm")} - ${unit(m.weightKg, "kg")}`,
    );
    for (const q of questionsFor(m.sex)) {
      const a = m.answers[q.key];
      if (q.key === "contraceptive" && a?.value === "si") {
        lines.push(`${q.short}: SÍ — ${contraceptiveText(m)}`);
        continue;
      }
      const extra = q.key === "glasses" && m.glassesTypes.length ? glassesText(m) : undefined;
      lines.push(`${q.short}: ${answerText(a, extra)}`);
    }
    if (m.sex === "f") {
      lines.push(
        `Última menstruación: ${m.lastPeriod ? formatDate(m.lastPeriod) : "—"}`,
      );
    }
  });

  lines.push("");
  lines.push(`*Hijos / cobertura:* ${answerText(d.children)}`);
  return lines.join("\n");
}
