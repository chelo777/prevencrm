// ============================================================
// Meta Conversions API (CAPI) — feedback de conversión.
//
// Reemplaza la actualización manual de conversión de las hojas.
// Disparo: el deal del lead llega a la etapa configurada (ej.
// "Calificado"). Reconciliación idempotente: se envía UNA vez por
// (lead, event_name) — nunca reversa (conversiones monótonas, B5).
//
// COMPLIANCE (B8): el payload lleva SOLO identificadores de matching de
// Meta, hasheados (email, teléfono, nombre, ciudad, código postal) +
// external_id (id de contacto hasheado) + metadata del evento. JAMÁS
// respuestas del formulario ni datos de salud (tratamiento, situación
// laboral, edad, cantidad de personas, etc.). La allowlist está codificada
// acá: ciudad/CP se leen SOLO de los custom fields "Ciudad" y "Código
// Postal", nunca del resto.
//
// Env: META_CAPI_ACCESS_TOKEN (el token NUNCA se guarda en la DB).
// ============================================================

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeArgentinePhone } from "./phone";

const GRAPH_VERSION = "v19.0";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Normaliza + hashea un identificador según requisitos de Meta. */
function hashField(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return sha256(normalized);
}

export interface CapiContact {
  email: string | null;
  phone: string | null;
  name: string | null;
  /** UUID del contacto → external_id (hasheado). Mejora el match quality. */
  externalId?: string | null;
  /** Ciudad (custom field "Ciudad"). Se normaliza a-z sin acentos y hashea. */
  city?: string | null;
  /** Código postal (custom field "Código Postal"). Alfanumérico, hasheado. */
  zip?: string | null;
}

/** Ciudad al formato de Meta: minúsculas, sin acentos, solo letras. */
function normalizeCity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos (María → maria)
    .toLowerCase()
    .replace(/[^a-z]/g, ""); // sin espacios, dígitos ni puntuación
}

/** CP al formato de Meta: minúsculas, sin espacios (AR: "2000", "s2000der"). */
function normalizeZip(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/** Construye user_data con la ALLOWLIST (nada de salud). */
export function buildUserData(contact: CapiContact): Record<string, string[]> {
  const data: Record<string, string[]> = {};

  const em = hashField(contact.email);
  if (em) data.em = [em];

  // Teléfono: dígitos E.164 sin '+', hasheado.
  if (contact.phone) {
    const digits = normalizeArgentinePhone(contact.phone).digits;
    if (digits) data.ph = [sha256(digits)];
  }

  if (contact.name) {
    const parts = contact.name.trim().split(/\s+/);
    const fn = hashField(parts[0]);
    if (fn) data.fn = [fn];
    if (parts.length > 1) {
      const ln = hashField(parts.slice(1).join(" "));
      if (ln) data.ln = [ln];
    }
  }

  // external_id: id interno del contacto (hasheado). Nunca sale en claro.
  if (contact.externalId) {
    const ext = contact.externalId.trim().toLowerCase();
    if (ext) data.external_id = [sha256(ext)];
  }

  // Ubicación (matching de Meta, NO datos de salud).
  if (contact.city) {
    const ct = normalizeCity(contact.city);
    if (ct) data.ct = [sha256(ct)];
  }
  if (contact.zip) {
    const zp = normalizeZip(contact.zip);
    if (zp) data.zp = [sha256(zp)];
  }

  return data;
}

export interface SendConversionInput {
  datasetId: string;
  accessToken: string;
  eventName: string;
  eventId: string;
  eventTimeSec: number;
  userData: Record<string, string[]>;
  /** meta_lead_id del lead (acepta prefijo "l:"). Obligatorio para la
   *  optimización Conversion Leads: ata el evento al lead/anuncio exacto. */
  leadId?: string | null;
  /** VBO: capitas del deal. Si es null/undefined, NO se manda custom_data
   *  (nunca se sella un value=1 basura). */
  value?: number | null;
}

/** Payload del evento (puro, testeable). */
export function buildEventPayload(input: SendConversionInput): {
  data: Record<string, unknown>[];
} {
  const user_data: Record<string, unknown> = { ...input.userData };
  if (input.leadId) {
    const numeric = input.leadId.replace(/^l:/i, "").trim();
    if (/^\d+$/.test(numeric)) {
      // Meta espera un entero; si excede la precisión segura de JS se
      // manda como string (Meta lo tolera y evita corromper el id).
      const n = Number(numeric);
      user_data.lead_id = Number.isSafeInteger(n) ? n : numeric;
    }
  }
  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: input.eventTimeSec,
    event_id: input.eventId, // dedup server-side
    action_source: "system_generated",
    user_data,
  };
  if (input.value != null) event.custom_data = { value: input.value, currency: "ARS" };
  return { data: [event] };
}

export interface SendConversionResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Envía un evento de conversión a la Meta Conversions API. */
export async function sendConversion(
  input: SendConversionInput,
): Promise<SendConversionResult> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
    input.datasetId,
  )}/events?access_token=${encodeURIComponent(input.accessToken)}`;

  const payload = buildEventPayload(input);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { ok: res.ok, status: res.status, body };
}

// ------------------------------------------------------------
// Reconciliación (idempotente) por cuenta.
// ------------------------------------------------------------
export interface CapiReconcileTotals {
  candidates: number;
  sent: number;
  failed: number;
  skipped: number;
}

interface CapiConfigRow {
  account_id: string;
  dataset_id: string | null;
  trigger_stage_name: string;
  event_name: string;
  active: boolean;
  send_value: boolean;
}

/**
 * Para una cuenta con CAPI activo: encuentra los leads cuyo deal llegó
 * a la etapa disparadora y todavía no tienen el evento enviado, y los
 * manda. Todo protegido por lead_capi_events (una fila por evento).
 */
export async function reconcileCapiForAccount(
  admin: SupabaseClient,
  config: CapiConfigRow,
  accessToken: string,
): Promise<CapiReconcileTotals> {
  const totals: CapiReconcileTotals = { candidates: 0, sent: 0, failed: 0, skipped: 0 };
  if (!config.active || !config.dataset_id) return totals;

  // Etapas de la cuenta que coinciden con el nombre disparador.
  const { data: pipelines } = await admin
    .from("pipelines")
    .select("id")
    .eq("account_id", config.account_id);
  const pipelineIds = (pipelines ?? []).map((p) => p.id as string);
  if (pipelineIds.length === 0) return totals;

  const { data: stages } = await admin
    .from("pipeline_stages")
    .select("id")
    .in("pipeline_id", pipelineIds)
    .eq("name", config.trigger_stage_name);
  const stageIds = (stages ?? []).map((s) => s.id as string);
  if (stageIds.length === 0) return totals;

  // Deals que ya están en la etapa disparadora.
  // IDs de los custom fields de ubicación (matching de Meta). Solo estos
  // dos — jamás los campos de salud. Se resuelven una vez por cuenta.
  const { data: locFields } = await admin
    .from("custom_fields")
    .select("id, field_name")
    .eq("account_id", config.account_id)
    .in("field_name", ["Ciudad", "Código Postal"]);
  const cityFieldId =
    (locFields ?? []).find((f) => f.field_name === "Ciudad")?.id as string | undefined;
  const zipFieldId =
    (locFields ?? []).find((f) => f.field_name === "Código Postal")?.id as
      | string
      | undefined;

  const { data: deals } = await admin
    .from("deals")
    .select("id, capitas")
    .eq("account_id", config.account_id)
    .in("stage_id", stageIds);
  const dealIds = (deals ?? []).map((d) => d.id as string);
  if (dealIds.length === 0) return totals;
  const capitasByDeal = new Map<string, number | null>(
    (deals ?? []).map((d) => [d.id as string, (d.capitas as number | null) ?? null]),
  );

  // Leads de esos deals.
  const { data: leads } = await admin
    .from("leads")
    .select("id, deal_id, contact_id, meta_lead_id")
    .eq("account_id", config.account_id)
    .in("deal_id", dealIds);

  for (const lead of leads ?? []) {
    const leadId = lead.id as string;
    const eventId = `${leadId}:${config.event_name}`;

    // ¿Ya enviado? (idempotencia por UNIQUE(lead_id, event_name)).
    const { data: existing } = await admin
      .from("lead_capi_events")
      .select("id, status")
      .eq("lead_id", leadId)
      .eq("event_name", config.event_name)
      .maybeSingle();
    if (existing?.status === "sent") {
      totals.skipped++;
      continue;
    }

    totals.candidates++;

    // Reserva la fila del evento (pending) — evita doble envío entre corridas.
    if (!existing) {
      const { error: insErr } = await admin.from("lead_capi_events").insert({
        account_id: config.account_id,
        lead_id: leadId,
        event_name: config.event_name,
        event_id: eventId,
        status: "pending",
      });
      // Si otro proceso la insertó en paralelo, seguimos (la traerá el próximo).
      if (insErr) {
        totals.skipped++;
        continue;
      }
    }

    // PII del contacto (allowlist).
    let capiContact: CapiContact = { email: null, phone: null, name: null };
    if (lead.contact_id) {
      const contactId = lead.contact_id as string;
      const { data: contact } = await admin
        .from("contacts")
        .select("email, phone, name")
        .eq("id", contactId)
        .maybeSingle();

      // Ciudad y CP desde los custom fields de ubicación (nunca salud).
      let city: string | null = null;
      let zip: string | null = null;
      const locIds = [cityFieldId, zipFieldId].filter(Boolean) as string[];
      if (locIds.length > 0) {
        const { data: vals } = await admin
          .from("contact_custom_values")
          .select("custom_field_id, value")
          .eq("contact_id", contactId)
          .in("custom_field_id", locIds);
        for (const v of vals ?? []) {
          if (v.custom_field_id === cityFieldId) city = (v.value as string | null) ?? null;
          if (v.custom_field_id === zipFieldId) zip = (v.value as string | null) ?? null;
        }
      }

      capiContact = {
        email: (contact?.email as string | null) ?? null,
        phone: (contact?.phone as string | null) ?? null,
        name: (contact?.name as string | null) ?? null,
        externalId: contactId,
        city,
        zip,
      };
    }

    const result = await sendConversion({
      datasetId: config.dataset_id,
      accessToken,
      eventName: config.event_name,
      eventId,
      eventTimeSec: Math.floor(Date.now() / 1000),
      userData: buildUserData(capiContact),
      leadId: (lead.meta_lead_id as string | null) ?? null,
      // Solo eventos de valor (send_value) Y con capitas cargadas. Si null,
      // NO se manda value (nunca se sella value=1 basura).
      value: config.send_value ? (capitasByDeal.get(lead.deal_id as string) ?? null) : null,
    });

    await admin
      .from("lead_capi_events")
      .update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date().toISOString() : null,
        response: result.body as object,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", leadId)
      .eq("event_name", config.event_name);

    if (result.ok) totals.sent++;
    else totals.failed++;
  }

  return totals;
}

/** Reconciliación de CAPI para todas las cuentas con config activa. */
export async function reconcileAllCapi(
  admin: SupabaseClient,
): Promise<CapiReconcileTotals> {
  const totals: CapiReconcileTotals = { candidates: 0, sent: 0, failed: 0, skipped: 0 };
  // Fallback: el token de leads (system user con ads_management) sirve
  // también para CAPI si el dataset es un activo del mismo negocio.
  const accessToken =
    process.env.META_CAPI_ACCESS_TOKEN ?? process.env.META_LEADS_ACCESS_TOKEN;
  if (!accessToken) return totals; // CAPI no configurada — no-op silencioso.

  const { data: configs } = await admin
    .from("lead_capi_config")
    .select("account_id, dataset_id, trigger_stage_name, event_name, active, send_value")
    .eq("active", true);

  for (const config of (configs ?? []) as CapiConfigRow[]) {
    const t = await reconcileCapiForAccount(admin, config, accessToken);
    totals.candidates += t.candidates;
    totals.sent += t.sent;
    totals.failed += t.failed;
    totals.skipped += t.skipped;
  }
  return totals;
}
