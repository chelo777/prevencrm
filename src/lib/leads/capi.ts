// ============================================================
// Meta Conversions API (CAPI) — feedback de conversión.
//
// Reemplaza la actualización manual de conversión de las hojas.
// Disparo: el deal del lead llega a la etapa configurada (ej.
// "Calificado"). Reconciliación idempotente: se envía UNA vez por
// (lead, event_name) — nunca reversa (conversiones monótonas, B5).
//
// COMPLIANCE (B8): el payload lleva SOLO identificadores hasheados
// (email, teléfono, nombre) + metadata del evento. JAMÁS respuestas
// del formulario ni datos de salud. La allowlist está codificada acá.
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

  return data;
}

export interface SendConversionInput {
  datasetId: string;
  accessToken: string;
  eventName: string;
  eventId: string;
  eventTimeSec: number;
  userData: Record<string, string[]>;
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

  const payload = {
    data: [
      {
        event_name: input.eventName,
        event_time: input.eventTimeSec,
        event_id: input.eventId, // dedup server-side
        action_source: "system_generated",
        user_data: input.userData,
      },
    ],
  };

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
  const { data: deals } = await admin
    .from("deals")
    .select("id")
    .eq("account_id", config.account_id)
    .in("stage_id", stageIds);
  const dealIds = (deals ?? []).map((d) => d.id as string);
  if (dealIds.length === 0) return totals;

  // Leads de esos deals.
  const { data: leads } = await admin
    .from("leads")
    .select("id, deal_id, contact_id")
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
      const { data: contact } = await admin
        .from("contacts")
        .select("email, phone, name")
        .eq("id", lead.contact_id as string)
        .maybeSingle();
      if (contact) {
        capiContact = {
          email: (contact.email as string | null) ?? null,
          phone: (contact.phone as string | null) ?? null,
          name: (contact.name as string | null) ?? null,
        };
      }
    }

    const result = await sendConversion({
      datasetId: config.dataset_id,
      accessToken,
      eventName: config.event_name,
      eventId,
      eventTimeSec: Math.floor(Date.now() / 1000),
      userData: buildUserData(capiContact),
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
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!accessToken) return totals; // CAPI no configurada — no-op silencioso.

  const { data: configs } = await admin
    .from("lead_capi_config")
    .select("account_id, dataset_id, trigger_stage_name, event_name, active")
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
