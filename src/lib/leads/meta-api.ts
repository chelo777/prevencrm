// ============================================================
// Adaptador directo a la Meta Graph API (Lead Ads, polling).
//
// Sin Google en el medio: el cron pide los leads de los formularios
// de la página con un token de SYSTEM USER (env META_LEADS_ACCESS_TOKEN,
// nunca en DB) canjeado por el page token en runtime.
//
// El mapeo reusa el diccionario de headers de mapping.ts: los `name`
// de field_data son los mismos slugs que los headers de las planillas
// (full_name, phone_number, ¿qué_edad_tenés?, ...). El id se prefija
// "l:" para que el claim-first dedupe contra las fuentes de planilla.
// ============================================================

import type { ColumnMapping, LeadAttribution, NormalizedLead } from "./types";
import { HEADER_DICT, normalizeHeader, toLabel } from "./mapping";
import { normalizeArgentinePhone } from "./phone";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Lead crudo tal como lo devuelve GET /{form_id}/leads. */
export interface MetaApiLead {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  is_organic?: boolean | string;
  platform?: string;
  field_data?: { name?: string; values?: unknown[] }[];
}

export interface MetaForm {
  id: string;
  name: string;
  status: string;
  leadsCount: number;
}

export function getMetaLeadsTokenConfigured(): boolean {
  return Boolean(process.env.META_LEADS_ACCESS_TOKEN);
}

function loadToken(): string {
  const t = process.env.META_LEADS_ACCESS_TOKEN;
  if (!t) throw new Error("META_LEADS_ACCESS_TOKEN no está configurada");
  return t;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number; type?: string };
  };
  if (!res.ok || json.error) {
    const e = json.error;
    throw new Error(
      `Graph error ${e?.code ?? res.status}: ${e?.message ?? "respuesta inválida de Meta"}`,
    );
  }
  return json;
}

// Cache por proceso de page tokens (el system token no expira; el page
// token derivado tampoco mientras el system user tenga acceso).
const pageTokenCache = new Map<string, string>();

export async function getPageAccessToken(pageId: string): Promise<string> {
  const cached = pageTokenCache.get(pageId);
  if (cached) return cached;
  const json = await graphGet<{ access_token?: string }>(pageId, {
    fields: "access_token",
    access_token: loadToken(),
  });
  if (!json.access_token) {
    throw new Error(
      "El token no puede administrar esa página (falta el activo en el system user)",
    );
  }
  pageTokenCache.set(pageId, json.access_token);
  return json.access_token;
}

/** Nombre visible de la página (para el wizard). */
export async function fetchPageName(pageId: string): Promise<string | null> {
  const pageToken = await getPageAccessToken(pageId);
  const json = await graphGet<{ name?: string }>(pageId, {
    fields: "name",
    access_token: pageToken,
  });
  return json.name ?? null;
}

/** Lista los formularios de la página (con conteo de leads). */
export async function fetchPageForms(pageId: string): Promise<MetaForm[]> {
  const pageToken = await getPageAccessToken(pageId);
  const json = await graphGet<{
    data?: { id?: string; name?: string; status?: string; leads_count?: number }[];
  }>(`${pageId}/leadgen_forms`, {
    fields: "id,name,status,leads_count",
    limit: "100",
    access_token: pageToken,
  });
  return (json.data ?? []).flatMap((f) =>
    f.id
      ? [
          {
            id: f.id,
            name: f.name ?? f.id,
            status: f.status ?? "UNKNOWN",
            leadsCount: f.leads_count ?? 0,
          },
        ]
      : [],
  );
}

const LEAD_FIELDS =
  "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data";

/** Una página de leads del formulario (descendente por fecha). */
export async function fetchFormLeads(
  formId: string,
  pageToken: string,
  after?: string | null,
): Promise<{ leads: MetaApiLead[]; after: string | null }> {
  const params: Record<string, string> = {
    fields: LEAD_FIELDS,
    limit: "100",
    access_token: pageToken,
  };
  if (after) params.after = after;
  const json = await graphGet<{
    data?: MetaApiLead[];
    paging?: { cursors?: { after?: string }; next?: string };
  }>(`${formId}/leads`, params);
  return {
    leads: json.data ?? [],
    after: json.paging?.next ? (json.paging?.cursors?.after ?? null) : null,
  };
}

// ------------------------------------------------------------
// Mapeo puro API -> NormalizedLead (testeado en leads.test.ts).
// ------------------------------------------------------------

/** Campos de contacto que salen de field_data (el resto es custom). */
const CONTACT_FIELDS = ["name", "email", "phone", "city", "postalCode", "comments"] as const;

function parseIso(v: string | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function parseOrganic(v: boolean | string | undefined): boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  return /^(true|1|yes|si|sí)$/i.test(v.trim());
}

export function mapApiLead(
  raw: MetaApiLead,
  formName: string | null,
  mapping?: ColumnMapping,
): NormalizedLead {
  const ignored = new Set((mapping?.ignore ?? []).map(normalizeHeader));
  const customNames = mapping?.custom ?? {};

  // field_data -> valores por header normalizado.
  const values = new Map<string, { header: string; value: string }>();
  for (const f of raw.field_data ?? []) {
    const header = (f.name ?? "").toString();
    const norm = normalizeHeader(header);
    if (!norm) continue;
    const value = (f.values ?? [])
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean)
      .join(", ");
    values.set(norm, { header, value });
  }

  const takeCanonical = (field: (typeof CONTACT_FIELDS)[number]): string | null => {
    for (const alias of HEADER_DICT[field] ?? []) {
      const hit = values.get(alias);
      if (hit) {
        values.delete(alias);
        return hit.value || null;
      }
    }
    return null;
  };

  const name = takeCanonical("name");
  const email = takeCanonical("email");
  const phoneRaw = takeCanonical("phone");
  const city = takeCanonical("city");
  const cp = takeCanonical("postalCode");
  const comments = takeCanonical("comments");
  const phone = normalizeArgentinePhone(phoneRaw);

  // Lo que queda de field_data -> custom fields (con renombres/ignore).
  const customFields: Record<string, string> = {};
  if (city) customFields["Ciudad"] = city;
  if (cp) customFields["Código Postal"] = cp;
  for (const [norm, { header, value }] of values) {
    if (!value || ignored.has(norm)) continue;
    const label = customNames[norm] ?? toLabel(header);
    if (!label) continue;
    customFields[label] = value;
  }

  const attribution: LeadAttribution = {
    platform: raw.platform ?? null,
    isOrganic: parseOrganic(raw.is_organic),
    campaignId: raw.campaign_id ?? null,
    campaignName: raw.campaign_name ?? null,
    adsetId: raw.adset_id ?? null,
    adsetName: raw.adset_name ?? null,
    adId: raw.ad_id ?? null,
    adName: raw.ad_name ?? null,
    formId: raw.form_id ?? null,
    formName,
  };

  // raw_payload plano (mismo formato conceptual que las planillas).
  const rawObj: Record<string, string> = {
    id: raw.id,
    created_time: raw.created_time ?? "",
    ad_id: raw.ad_id ?? "",
    ad_name: raw.ad_name ?? "",
    adset_id: raw.adset_id ?? "",
    adset_name: raw.adset_name ?? "",
    campaign_id: raw.campaign_id ?? "",
    campaign_name: raw.campaign_name ?? "",
    form_id: raw.form_id ?? "",
    form_name: formName ?? "",
    is_organic: String(raw.is_organic ?? ""),
    platform: raw.platform ?? "",
  };
  for (const f of raw.field_data ?? []) {
    const header = (f.name ?? "").toString();
    if (!header) continue;
    rawObj[header] = (f.values ?? []).map((v) => (v == null ? "" : String(v))).join(", ");
  }

  return {
    // Prefijo "l:" = mismo formato que las planillas -> dedupe entre canales.
    metaLeadId: `l:${raw.id}`,
    name,
    phoneRaw,
    phoneE164: phone.e164,
    phoneValid: phone.valid,
    email,
    attribution,
    leadCreatedTime: parseIso(raw.created_time),
    customFields,
    comments,
    statusRaw: null, // la API no trae estado: el CRM manda desde el día cero
    raw: rawObj,
  };
}
