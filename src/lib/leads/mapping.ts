// ============================================================
// Mapeo de filas de una hoja de Meta a NormalizedLead.
//
// Regla de oro (verificación de las hojas reales, 2026-07-01):
//   * El `id` del lead se detecta POR CONTENIDO (`^l:\d+$`), NUNCA por
//     header. La Hoja 2 tiene el id real bajo un header corrupto ("¡")
//     y una columna decoy literalmente llamada "id" pero VACÍA. Mapear
//     por nombre daría meta_lead_id NULL -> cero dedupe -> duplicados.
//   * El teléfono también se detecta por contenido (prefijo "p:").
//   * El resto se mapea por header; lo desconocido -> custom fields.
// ============================================================

import type {
  CanonicalField,
  ColumnMapping,
  ColumnSuggestion,
  LeadAttribution,
  MappingSuggestion,
  NormalizedLead,
  RawSheetData,
} from "./types";
import { normalizeArgentinePhone } from "./phone";

const META_LEAD_ID_RE = /^l:\d+$/;
const META_PHONE_RE = /^p:/i;
/** Prefijo tipo "ag:", "ca:", "fm:" que Meta antepone en algunos ids. */
const ID_PREFIX_RE = /^[a-z]{1,4}:/i;

/** Normaliza un header para comparar: minúsculas + trim + espacios simples. */
export function normalizeHeader(h: string): string {
  return (h ?? "").toString().trim().toLowerCase().replace(/\s+/g, "_");
}

/** Diccionarios de headers canónicos (ya normalizados). */
export const HEADER_DICT: Record<string, string[]> = {
  name: ["full_name", "name", "nombre", "nombre_completo", "nombre_y_apellido"],
  email: ["email", "e-mail", "e_mail", "correo", "correo_electronico"],
  phone: ["phone_number", "phone", "telefono", "teléfono", "celular", "whatsapp"],
  city: ["city", "ciudad", "localidad"],
  postalCode: ["código_postal", "codigo_postal", "post_code", "postal_code", "cp", "zip"],
  comments: ["comentarios", "comments", "comment", "observaciones", "notas"],
  status: ["lead_status", "estado", "status"],
  createdTime: ["created_time", "fecha", "timestamp", "fecha_creacion"],
  platform: ["platform", "plataforma"],
  isOrganic: ["is_organic"],
  campaignId: ["campaign_id"],
  campaignName: ["campaign_name"],
  adsetId: ["adset_id"],
  adsetName: ["adset_name"],
  adId: ["ad_id"],
  adName: ["ad_name"],
  formId: ["form_id"],
  formName: ["form_name"],
};

export interface ResolvedColumns {
  metaLeadId: number;
  name: number;
  email: number;
  phone: number;
  city: number;
  postalCode: number;
  comments: number;
  status: number;
  createdTime: number;
  platform: number;
  isOrganic: number;
  campaignId: number;
  campaignName: number;
  adsetId: number;
  adsetName: number;
  adId: number;
  adName: number;
  formId: number;
  formName: number;
  /** Columnas sobrantes -> custom fields (con su header legible). */
  customHeaders: { index: number; label: string }[];
}

export interface MapResult {
  lead?: NormalizedLead;
  error?: string;
}

/**
 * Detecta la columna del `id` del lead por CONTENIDO. Recorre cada
 * columna y elige la que tenga mayoría de valores `l:\d+` entre sus
 * celdas no vacías. La columna decoy vacía queda descartada (no tiene
 * celdas no vacías). Devuelve el índice o -1.
 */
export function detectColumnByContent(
  rows: string[][],
  test: (v: string) => boolean,
  colCount: number,
): number {
  let best = -1;
  let bestMatches = 0;
  for (let c = 0; c < colCount; c++) {
    let matches = 0;
    let nonEmpty = 0;
    for (const row of rows) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      nonEmpty++;
      if (test(v)) matches++;
    }
    if (nonEmpty > 0 && matches / nonEmpty >= 0.8 && matches > bestMatches) {
      best = c;
      bestMatches = matches;
    }
  }
  return best;
}

function headerIndex(
  normalizedHeaders: string[],
  aliases: string[],
): number {
  for (let i = 0; i < normalizedHeaders.length; i++) {
    if (aliases.includes(normalizedHeaders[i])) return i;
  }
  return -1;
}

/** De-slugifica un header a etiqueta legible para el custom field. */
export function toLabel(header: string): string {
  return (header ?? "")
    .replace(/[¿?¡!]/g, "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resuelve una sola vez las columnas de la hoja. `mapping.canonical`
 * (override manual) tiene prioridad sobre la auto-detección.
 */
export function resolveColumns(
  raw: RawSheetData,
  mapping?: ColumnMapping,
): ResolvedColumns {
  const norm = raw.headers.map(normalizeHeader);
  const colCount = raw.headers.length;
  const override = mapping?.canonical ?? {};

  const byHeader = (field: string): number => {
    // Override manual por nombre de header.
    const ov = (override as Record<string, string>)[field];
    if (ov) {
      const idx = norm.indexOf(normalizeHeader(ov));
      if (idx >= 0) return idx;
    }
    return headerIndex(norm, HEADER_DICT[field] ?? []);
  };

  // id y phone: contenido primero (robusto a headers mentirosos).
  let metaLeadId = detectColumnByContent(
    raw.rows,
    (v) => META_LEAD_ID_RE.test(v),
    colCount,
  );
  if (metaLeadId < 0) metaLeadId = byHeader("metaLeadId");

  let phone = detectColumnByContent(
    raw.rows,
    (v) => META_PHONE_RE.test(v),
    colCount,
  );
  if (phone < 0) phone = byHeader("phone");

  const resolved: ResolvedColumns = {
    metaLeadId,
    phone,
    name: byHeader("name"),
    email: byHeader("email"),
    city: byHeader("city"),
    postalCode: byHeader("postalCode"),
    comments: byHeader("comments"),
    status: byHeader("status"),
    createdTime: byHeader("createdTime"),
    platform: byHeader("platform"),
    isOrganic: byHeader("isOrganic"),
    campaignId: byHeader("campaignId"),
    campaignName: byHeader("campaignName"),
    adsetId: byHeader("adsetId"),
    adsetName: byHeader("adsetName"),
    adId: byHeader("adId"),
    adName: byHeader("adName"),
    formId: byHeader("formId"),
    formName: byHeader("formName"),
    customHeaders: [],
  };

  // Todo lo no reclamado por un canónico -> custom field.
  const ignored = new Set((mapping?.ignore ?? []).map(normalizeHeader));
  const customNames = mapping?.custom ?? {};
  const claimed = new Set<number>(
    Object.values(resolved).filter((v): v is number => typeof v === "number" && v >= 0),
  );
  for (let i = 0; i < colCount; i++) {
    if (claimed.has(i)) continue;
    if (ignored.has(norm[i])) continue;
    const label = customNames[norm[i]] ?? toLabel(raw.headers[i]);
    if (!label) continue; // header vacío (columna decoy / trailing)
    resolved.customHeaders.push({ index: i, label });
  }

  return resolved;
}

/**
 * Sugerencias de mapeo para el wizard: clasifica cada columna con la
 * heurística existente (id/tel por contenido, resto por diccionario) y
 * junta los valores distintos de la columna de estado.
 */
export function suggestMapping(
  raw: RawSheetData,
  mapping?: ColumnMapping,
): MappingSuggestion {
  const cols = resolveColumns(raw, mapping);
  const samples = (i: number): string[] =>
    raw.rows
      .map((r) => (r[i] ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);

  const byIndex = new Map<number, ColumnSuggestion>();
  for (const [key, value] of Object.entries(cols)) {
    if (key === "customHeaders" || typeof value !== "number" || value < 0) continue;
    const field = key as CanonicalField;
    byIndex.set(value, {
      index: value,
      header: raw.headers[value] ?? "",
      samples: samples(value),
      kind: "canonical",
      field,
    });
  }
  for (const { index, label } of cols.customHeaders) {
    byIndex.set(index, {
      index,
      header: raw.headers[index] ?? "",
      samples: samples(index),
      kind: "custom",
      label,
    });
  }

  const columns: ColumnSuggestion[] = [];
  for (let i = 0; i < raw.headers.length; i++) {
    const found = byIndex.get(i);
    if (found) {
      columns.push(found);
      continue;
    }
    const header = (raw.headers[i] ?? "").trim();
    const hasData = raw.rows.some((r) => (r[i] ?? "").trim() !== "");
    if (!header && !hasData) continue; // columna totalmente vacía: no molestar
    columns.push({ index: i, header, samples: samples(i), kind: "ignore" });
  }

  const statusValues =
    cols.status >= 0
      ? [...new Set(raw.rows.map((r) => (r[cols.status] ?? "").trim()).filter(Boolean))]
      : [];

  return { columns, statusValues };
}

function stripIdPrefix(v: string): string {
  return v.replace(ID_PREFIX_RE, "").trim();
}

function parseIso(v: string): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  const epoch = Number(v);
  if (Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch * (epoch < 1e12 ? 1000 : 1)).toISOString();
  }
  return null;
}

function parseBool(v: string): boolean | null {
  if (!v) return null;
  return /^(true|1|yes|si|sí)$/i.test(v.trim());
}

/**
 * Crea un mapeador para la hoja: resuelve columnas una vez y expone
 * `mapRow` que convierte cada fila en NormalizedLead o en un error
 * (fila a cuarentena).
 */
export function createLeadMapper(raw: RawSheetData, mapping?: ColumnMapping) {
  const cols = resolveColumns(raw, mapping);

  function mapRow(row: string[]): MapResult {
    const at = (i: number): string => (i >= 0 ? (row[i] ?? "").trim() : "");

    const metaLeadId = at(cols.metaLeadId);
    if (!metaLeadId || !META_LEAD_ID_RE.test(metaLeadId)) {
      return { error: "Sin id de lead válido (l:...) en la fila" };
    }

    const raw_obj: Record<string, string> = {};
    for (let i = 0; i < raw.headers.length; i++) {
      const key = raw.headers[i] || `col_${i}`;
      raw_obj[key] = (row[i] ?? "").trim();
    }

    const phoneRaw = at(cols.phone) || null;
    const phone = normalizeArgentinePhone(phoneRaw);

    const attribution: LeadAttribution = {
      platform: stripIdPrefix(at(cols.platform)) || null,
      isOrganic: parseBool(at(cols.isOrganic)),
      campaignId: stripIdPrefix(at(cols.campaignId)) || null,
      campaignName: at(cols.campaignName) || null,
      adsetId: stripIdPrefix(at(cols.adsetId)) || null,
      adsetName: at(cols.adsetName) || null,
      adId: stripIdPrefix(at(cols.adId)) || null,
      adName: at(cols.adName) || null,
      formId: stripIdPrefix(at(cols.formId)) || null,
      formName: at(cols.formName) || null,
    };

    const customFields: Record<string, string> = {};
    const city = at(cols.city);
    if (city) customFields["Ciudad"] = city;
    const cp = at(cols.postalCode);
    if (cp) customFields["Código Postal"] = cp;
    for (const { index, label } of cols.customHeaders) {
      const v = (row[index] ?? "").trim();
      if (v) customFields[label] = v;
    }

    const lead: NormalizedLead = {
      metaLeadId,
      name: at(cols.name) || null,
      phoneRaw: phoneRaw ? phoneRaw.replace(/^\s*p:\s*/i, "").trim() : null,
      phoneE164: phone.e164,
      phoneValid: phone.valid,
      email: at(cols.email) || null,
      attribution,
      leadCreatedTime: parseIso(at(cols.createdTime)),
      customFields,
      comments: at(cols.comments) || null,
      statusRaw: at(cols.status) || null,
      raw: raw_obj,
    };
    return { lead };
  }

  return { columns: cols, mapRow };
}
