// ============================================================
// Filtro de la bandeja de leads — definición ÚNICA y pura.
//
// Vive en la URL (`?etapa=&etiqueta=&asesora=&dup=&periodo=&desde=&hasta=`)
// y la usan dos consumidores que NO pueden divergir:
//   - la página, para listar;
//   - /api/leads/bulk, para saber sobre qué filas opera "seleccionar todos".
// Si cada uno interpretara los params por su cuenta, "seleccioné 1057" y
// "se modificaron 1057" podrían no ser el mismo conjunto.
// ============================================================

import { rangeFromParams, type PeriodPreset } from "@/lib/date-range";
import type { AccountRole } from "@/lib/auth/roles";

export interface LeadFilter {
  stageId: string | null;
  tagId: string | null;
  /** user_id del asesor, o "none" para los leads SIN asignar. */
  assignedTo: string | null;
  onlyDuplicates: boolean;
  period: PeriodPreset;
  /** Fechas ya resueltas (YYYY-MM-DD), inclusive ambas. */
  since: string | null;
  until: string | null;
}

type RawParams = Record<string, string | string[] | undefined>;

/** `?etapa=a&etapa=b` llega como array: no es un filtro válido, se ignora. */
function str(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v ? v : null;
}

export function parseLeadFilter(
  params: RawParams,
  now: Date = new Date(),
): LeadFilter {
  const { preset, range } = rangeFromParams(
    { periodo: str(params.periodo), desde: str(params.desde), hasta: str(params.hasta) },
    now,
  );
  return {
    stageId: str(params.etapa),
    tagId: str(params.etiqueta),
    assignedTo: str(params.asesora),
    onlyDuplicates: str(params.dup) === "1",
    period: preset,
    since: range.since,
    until: range.until,
  };
}

/**
 * SEGUNDA PUERTA del control de acceso.
 *
 * La RLS (037) es el muro real: un agent no puede leer ni escribir un deal
 * que no tenga asignado. Pero de eso NO se sigue que el servidor deba
 * ejecutar la consulta que le pidan: un agent que manipule la URL o el body
 * y pida "todos los leads" tiene que terminar operando sobre los suyos —
 * explícitamente, acá, y no por el efecto colateral de una policy.
 *
 * Por eso el filtro se acota SIEMPRE server-side antes de tocar la base, y
 * es idempotente: volver a aplicarlo nunca ensancha el alcance.
 *
 * `admin`/`owner` pasan sin recortes: ven y operan sobre toda la cuenta.
 */
export function scopeFilterToRole(
  filter: LeadFilter,
  role: AccountRole,
  userId: string,
): LeadFilter {
  if (role === "admin" || role === "owner") return filter;

  return {
    ...filter,
    // Su pedido se descarta: ni otro asesor, ni "sin asignar", ni "todos".
    assignedTo: userId,
    // "Solo duplicados" es una vista de admin (barre toda la cuenta).
    onlyDuplicates: false,
  };
}

/** ¿El filtro deja algo afuera? (para el cartel de "no hay resultados"). */
export function hasActiveFilters(filter: LeadFilter): boolean {
  return Boolean(
    filter.stageId ||
      filter.tagId ||
      filter.assignedTo ||
      filter.onlyDuplicates ||
      filter.since ||
      filter.until,
  );
}

/**
 * Texto legible del alcance, para que la confirmación de una acción masiva
 * diga sobre qué se aplica y no sólo "1057 leads".
 */
export function describeFilter(
  filter: LeadFilter,
  names: { stageName?: string; tagName?: string; agentName?: string; periodLabel?: string } = {},
): string {
  const parts: string[] = [];
  if (filter.stageId) parts.push(`etapa ${names.stageName ?? filter.stageId}`);
  if (filter.tagId) parts.push(`etiqueta ${names.tagName ?? filter.tagId}`);
  if (filter.assignedTo === "none") parts.push("sin asignar");
  else if (filter.assignedTo) parts.push(`de ${names.agentName ?? filter.assignedTo}`);
  if (filter.onlyDuplicates) parts.push("duplicados");
  if (names.periodLabel && filter.period !== "todo") parts.push(names.periodLabel);
  else if (filter.since || filter.until) {
    parts.push([filter.since, filter.until].filter(Boolean).join(" → "));
  }

  return parts.length === 0 ? "todos los leads" : parts.join(", ");
}

/**
 * Traduce el filtro a un query de PostgREST sobre `leads`.
 *
 * El llamador arma el `select` (los embeds cambian según haya o no filtro de
 * etapa/etiqueta) y pasa acá el builder ya iniciado. Que la traducción viva
 * en un solo lugar es lo que garantiza que listar y operar en masa toquen
 * exactamente las mismas filas.
 *
 * `dupContactIds` sólo hace falta si `onlyDuplicates` está activo: es el
 * barrido de teléfonos repetidos que resuelve la página.
 */
export function applyLeadFilter<
  Q extends {
    eq(col: string, val: unknown): Q;
    is(col: string, val: unknown): Q;
    in(col: string, vals: unknown[]): Q;
    gte(col: string, val: unknown): Q;
    lte(col: string, val: unknown): Q;
  },
>(query: Q, filter: LeadFilter, dupContactIds: Set<string> | null): Q {
  let q = query;

  if (filter.stageId) q = q.eq("deal.stage_id", filter.stageId);
  if (filter.tagId) q = q.eq("contact.tag_filter.tag_id", filter.tagId);

  if (filter.assignedTo === "none") q = q.is("deal.assigned_agent_id", null);
  else if (filter.assignedTo) q = q.eq("deal.assigned_agent_id", filter.assignedTo);

  if (filter.onlyDuplicates) {
    // Un IN vacío en PostgREST no filtra: traería la tabla entera. Con un id
    // imposible el filtro falla CERRADO (ningún resultado), que es lo seguro.
    const ids = dupContactIds && dupContactIds.size > 0
      ? [...dupContactIds]
      : ["00000000-0000-0000-0000-000000000000"];
    q = q.in("contact_id", ids);
  }

  if (filter.since) q = q.gte("created_at", filter.since);
  // `until` es inclusive y created_at es timestamp: hay que cubrir el día entero.
  if (filter.until) q = q.lte("created_at", `${filter.until}T23:59:59.999Z`);

  return q;
}
