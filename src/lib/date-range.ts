// ============================================================
// Presets de fecha del panel de contabilidad — lógica pura.
//
// El rango viaja en la URL (?desde=&hasta=&periodo=) para que el server
// component lo resuelva y la vista sea compartible/recargable.
// ============================================================

/**
 * Intervalo de fechas inclusivo (YYYY-MM-DD). Vive acá, con el módulo que lo
 * resuelve, y no en un dominio concreto: lo usan tanto Contabilidad como la
 * bandeja de leads.
 */
export interface DateRange {
  since: string | null;
  until: string | null;
}

export type PeriodPreset =
  | "todo"
  | "hoy"
  | "7d"
  | "30d"
  | "mes"
  | "mes-pasado"
  | "custom";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  todo: "Todo",
  hoy: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
  "mes-pasado": "Mes pasado",
  custom: "Personalizado",
};

/** Presets que se muestran como botones (custom se activa con las fechas). */
export const PERIOD_OPTIONS: PeriodPreset[] = [
  "todo",
  "hoy",
  "7d",
  "30d",
  "mes",
  "mes-pasado",
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resuelve un preset a fechas concretas. `now` se inyecta para poder testear
 * sin depender del reloj.
 */
export function resolvePeriod(preset: PeriodPreset, now: Date): DateRange {
  const today = iso(now);
  switch (preset) {
    case "hoy":
      return { since: today, until: today };
    case "7d":
      return { since: iso(new Date(now.getTime() - 6 * 86400_000)), until: today };
    case "30d":
      return { since: iso(new Date(now.getTime() - 29 * 86400_000)), until: today };
    case "mes": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { since: iso(first), until: today };
    }
    case "mes-pasado": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return { since: iso(first), until: iso(last) };
    }
    case "todo":
    case "custom":
    default:
      return { since: null, until: null };
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lee el rango de los search params. Las fechas explícitas mandan sobre el
 * preset (así un link con ?desde=&hasta= se abre en ese rango exacto).
 */
export function rangeFromParams(
  params: { periodo?: string | null; desde?: string | null; hasta?: string | null },
  now: Date,
): { preset: PeriodPreset; range: DateRange } {
  const desde = params.desde && DATE_RE.test(params.desde) ? params.desde : null;
  const hasta = params.hasta && DATE_RE.test(params.hasta) ? params.hasta : null;

  if (desde || hasta) {
    // Rango invertido: lo damos vuelta en vez de devolver vacío.
    const range =
      desde && hasta && desde > hasta
        ? { since: hasta, until: desde }
        : { since: desde, until: hasta };
    return { preset: "custom", range };
  }

  const preset = (params.periodo ?? "todo") as PeriodPreset;
  const valid = PERIOD_OPTIONS.includes(preset) ? preset : "todo";
  return { preset: valid, range: resolvePeriod(valid, now) };
}

/** Texto del período para la cabecera ("Todo el histórico", "01/08 → 09/08"). */
export function rangeLabel(preset: PeriodPreset, range: DateRange): string {
  if (preset !== "custom" && preset !== "todo") return PERIOD_LABELS[preset];
  if (!range.since && !range.until) return "Todo el histórico";
  const fmt = (d: string | null) =>
    d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "…";
  return `${fmt(range.since)} → ${fmt(range.until)}`;
}
