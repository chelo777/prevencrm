// ============================================================
// Adaptador Supabase del puerto LeadRepository (service-role).
//
// Corre con la clave de servicio (bypassa RLS) desde el cron y el
// script histórico. Cada instancia está ligada a una fuente
// (account_id, owner_user_id, pipeline destino).
//
// Reusa la dedupe de contactos de 022 (findExistingContact) para no
// fragmentar contactos entre formularios (B4).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import type {
  AssignEventKind,
  ClaimedLead,
  ColumnMapping,
  EligibleAgent,
  LeadAttribution,
  LeadRepository,
  LeadSourceConfig,
  StaleLead,
} from "./types";

const DEAL_CURRENCY = "ARS";
/** Umbral de "sin trabajar" para el reclamo (días). */
const STALE_DAYS = 3;
/** Tope de candidatos procesados por corrida del reclamo (acota el N+1). */
const RECLAIM_BATCH = 50;

export function createLeadRepository(
  admin: SupabaseClient,
  source: LeadSourceConfig,
): LeadRepository {
  const { accountId, ownerUserId, id: sourceId, pipelineId, defaultStageId } = source;

  /** Cache de custom_field ids por field_name (dentro de una corrida). */
  const fieldCache = new Map<string, string>();

  async function ensureCustomField(fieldName: string): Promise<string> {
    const cached = fieldCache.get(fieldName);
    if (cached) return cached;

    const { data: existing } = await admin
      .from("custom_fields")
      .select("id")
      .eq("account_id", accountId)
      .eq("field_name", fieldName)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      fieldCache.set(fieldName, existing.id as string);
      return existing.id as string;
    }

    const { data: created, error } = await admin
      .from("custom_fields")
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        field_name: fieldName,
        field_type: "text",
      })
      .select("id")
      .single();
    if (error) throw error;
    fieldCache.set(fieldName, created.id as string);
    return created.id as string;
  }

  return {
    async claimLead(metaLeadId: string): Promise<ClaimedLead> {
      // INSERT ... ON CONFLICT DO NOTHING (ignoreDuplicates).
      const { data: inserted, error } = await admin
        .from("leads")
        .upsert(
          {
            account_id: accountId,
            source_id: sourceId,
            meta_lead_id: metaLeadId,
            status: "claimed",
          },
          { onConflict: "account_id,meta_lead_id", ignoreDuplicates: true },
        )
        .select("id, status, contact_id, deal_id, sheet_status, synced_stage_id");
      if (error) throw error;

      if (inserted && inserted.length > 0) {
        const row = inserted[0];
        return {
          leadId: row.id as string,
          status: row.status as "claimed" | "processed",
          isNew: true,
          dealId: (row.deal_id as string | null) ?? null,
          contactId: (row.contact_id as string | null) ?? null,
          sheetStatus: (row.sheet_status as string | null) ?? null,
          syncedStageId: (row.synced_stage_id as string | null) ?? null,
        };
      }

      // Conflicto: ya existía. Traer el estado actual para reanudar/saltar.
      const { data: found, error: findErr } = await admin
        .from("leads")
        .select("id, status, contact_id, deal_id, sheet_status, synced_stage_id")
        .eq("account_id", accountId)
        .eq("meta_lead_id", metaLeadId)
        .single();
      if (findErr) throw findErr;
      return {
        leadId: found.id as string,
        status: found.status as "claimed" | "processed",
        isNew: false,
        dealId: (found.deal_id as string | null) ?? null,
        contactId: (found.contact_id as string | null) ?? null,
        sheetStatus: (found.sheet_status as string | null) ?? null,
        syncedStageId: (found.synced_stage_id as string | null) ?? null,
      };
    },

    async findOrCreateContact({ phoneE164, phoneRaw, name, email }) {
      const phoneToStore = phoneE164 || phoneRaw || "";

      if (phoneToStore) {
        const existing = await findExistingContact(admin, accountId, phoneToStore);
        if (existing) return { id: existing.id };
      }

      const insertRow = {
        account_id: accountId,
        user_id: ownerUserId,
        phone: phoneToStore,
        name: name ?? null,
        email: email ?? null,
      };
      const { data, error } = await admin
        .from("contacts")
        .insert(insertRow)
        .select("id")
        .single();

      if (error) {
        // Carrera: otro proceso lo insertó entre el find y el insert.
        if (isUniqueViolation(error) && phoneToStore) {
          const again = await findExistingContact(admin, accountId, phoneToStore);
          if (again) return { id: again.id };
        }
        throw error;
      }
      return { id: data.id as string };
    },

    async setCustomValues(contactId, values) {
      for (const [label, value] of Object.entries(values)) {
        if (!value) continue;
        const fieldId = await ensureCustomField(label);
        const { error } = await admin.from("contact_custom_values").upsert(
          {
            contact_id: contactId,
            custom_field_id: fieldId,
            value,
          },
          { onConflict: "contact_id,custom_field_id" },
        );
        if (error) throw error;
      }
    },

    async addNote(contactId, text) {
      if (!text) return;
      const { error } = await admin.from("contact_notes").insert({
        account_id: accountId,
        contact_id: contactId,
        user_id: ownerUserId,
        note_text: text,
      });
      if (error) throw error;
    },

    async createDeal({ leadId, contactId, title, stageId }) {
      const stage = stageId ?? defaultStageId;
      const { data, error } = await admin
        .from("deals")
        .insert({
          account_id: accountId,
          user_id: ownerUserId,
          pipeline_id: pipelineId,
          stage_id: stage,
          contact_id: contactId,
          title: title || "Lead de Meta",
          value: 0,
          currency: DEAL_CURRENCY,
          // 002 restringe deals.status a open/won/lost.
          status: "open",
        })
        .select("id")
        .single();
      if (error) throw error;

      // Checkpoint de reanudación: linkear el deal al lead enseguida.
      await admin.from("leads").update({ deal_id: data.id }).eq("id", leadId);
      return { id: data.id as string, stageId: stage };
    },

    async setLeadContact(leadId, contactId) {
      const { error } = await admin
        .from("leads")
        .update({ contact_id: contactId })
        .eq("id", leadId);
      if (error) throw error;
    },

    async listEligibleAgents(): Promise<EligibleAgent[]> {
      const { data: members, error: membersError } = await admin
        .from("profiles")
        .select("user_id, lead_cap, receiving_since")
        .eq("account_id", accountId)
        .eq("is_lead_buyer", true)
        .eq("receiving_leads", true)
        .eq("blocked", false);
      if (membersError) throw membersError;
      const rows = (members ?? []) as { user_id: string; lead_cap: number | null; receiving_since: string | null }[];
      if (rows.length === 0) return [];

      // Carga actual = deals abiertos del pipeline por asesor.
      const { data: openDeals, error: openDealsError } = await admin
        .from("deals").select("assigned_agent_id")
        .eq("account_id", accountId).eq("pipeline_id", pipelineId)
        .eq("status", "open").not("assigned_agent_id", "is", null);
      if (openDealsError) throw openDealsError;
      const load = new Map<string, number>();
      for (const d of openDeals ?? []) {
        const a = d.assigned_agent_id as string; load.set(a, (load.get(a) ?? 0) + 1);
      }

      const out: EligibleAgent[] = [];
      for (const r of rows) {
        if (r.lead_cap != null) {
          const since = r.receiving_since ?? "1970-01-01";
          const { count: assigned, error: assignedError } = await admin.from("activity_log")
            .select("id", { count: "exact", head: true })
            .eq("user_id", r.user_id).eq("action", "lead_assigned").gte("created_at", since);
          if (assignedError) throw assignedError;
          const { count: reclaimed, error: reclaimedError } = await admin.from("activity_log")
            .select("id", { count: "exact", head: true })
            .eq("user_id", r.user_id).eq("action", "lead_reclaimed").gte("created_at", since);
          if (reclaimedError) throw reclaimedError;
          const received = (assigned ?? 0) - (reclaimed ?? 0);
          if (received >= r.lead_cap) continue; // auto-apagado por cupo
        }
        out.push({ userId: r.user_id, openDeals: load.get(r.user_id) ?? 0 });
      }
      return out;
    },

    async assignDealIfUnassigned(dealId, userId) {
      const { data, error } = await admin
        .from("deals")
        .update({ assigned_agent_id: userId })
        .eq("id", dealId)
        .is("assigned_agent_id", null)
        .select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },

    async recordAssignEvent(userId: string, dealId: string, kind: AssignEventKind) {
      const { error } = await admin.from("activity_log").insert({
        account_id: accountId, user_id: userId, deal_id: dealId, action: kind, meta: {},
      });
      if (error) throw error;
    },

    async unassignDeal(dealId: string) {
      const { error } = await admin.from("deals").update({ assigned_agent_id: null }).eq("id", dealId);
      if (error) throw error;
    },

    async listStaleAssignedLeads(reclaimAfterIso: string): Promise<StaleLead[]> {
      const { data: initial, error: initialError } = await admin.from("pipeline_stages")
        .select("id").eq("pipeline_id", pipelineId).order("position", { ascending: true }).limit(1).maybeSingle();
      if (initialError) throw initialError;
      const initialStageId = initial?.id as string | undefined;
      if (!initialStageId) return [];
      const cutoffIso = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
      const { data: deals, error: dealsError } = await admin.from("deals")
        .select("id, assigned_agent_id, created_at, contact_id")
        .eq("account_id", accountId).eq("pipeline_id", pipelineId).eq("stage_id", initialStageId)
        .not("assigned_agent_id", "is", null)
        .gt("created_at", reclaimAfterIso)   // gate: excluye backlog histórico
        .lt("created_at", cutoffIso)          // más viejo que el umbral de reclamo
        .limit(RECLAIM_BATCH);                // batch limit
      if (dealsError) throw dealsError;
      const out: StaleLead[] = [];
      for (const d of deals ?? []) {
        // "Trabajado" = nota manual o click-to-chat en contact_notes DESPUÉS de crearse el deal.
        // (activity_log no sirve: la auto-asignación del router también registra "lead_assigned" ahí,
        // lo que marcaría todo lead recién asignado como "trabajado" al instante.)
        const contactId = d.contact_id as string | null;
        if (contactId) {
          const { count, error: nErr } = await admin
            .from("contact_notes")
            .select("id", { count: "exact", head: true })
            .eq("contact_id", contactId)
            .gt("created_at", d.created_at as string);
          if (nErr) throw nErr;
          if ((count ?? 0) > 0) continue; // trabajado: nota post-asignación (incluye click-to-chat)
        }
        const { data: lead, error: leadError } = await admin.from("leads").select("id").eq("deal_id", d.id as string).maybeSingle();
        if (leadError) throw leadError;
        if (lead) out.push({ leadId: lead.id as string, dealId: d.id as string, assignedAgentId: d.assigned_agent_id as string });
      }
      return out;
    },

    async getDealStage(dealId) {
      const { data, error } = await admin
        .from("deals")
        .select("stage_id")
        .eq("id", dealId)
        .maybeSingle();
      if (error) throw error;
      return (data?.stage_id as string | null) ?? null;
    },

    async moveDealStage(dealId, stageId) {
      const { error } = await admin
        .from("deals")
        .update({ stage_id: stageId, updated_at: new Date().toISOString() })
        .eq("id", dealId);
      if (error) throw error;
    },

    async recordSheetStatus(leadId, sheetStatus, syncedStageId) {
      const { error } = await admin
        .from("leads")
        .update({
          sheet_status: sheetStatus,
          synced_stage_id: syncedStageId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
      if (error) throw error;
    },

    async finalizeLead(leadId, data) {
      const a: LeadAttribution = data.attribution;
      const { error } = await admin
        .from("leads")
        .update({
          status: "processed",
          phone_valid: data.phoneValid,
          sheet_status: data.sheetStatus,
          synced_stage_id: data.syncedStageId,
          platform: a.platform,
          is_organic: a.isOrganic,
          campaign_id: a.campaignId,
          campaign_name: a.campaignName,
          adset_id: a.adsetId,
          adset_name: a.adsetName,
          ad_id: a.adId,
          ad_name: a.adName,
          form_id: a.formId,
          form_name: a.formName,
          lead_created_time: data.leadCreatedTime,
          raw_payload: data.rawPayload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
      if (error) throw error;
    },

    async quarantine(rawRow, reason) {
      const { error } = await admin.from("lead_intake_errors").insert({
        account_id: accountId,
        source_id: sourceId,
        raw_row: rawRow,
        reason,
      });
      if (error) throw error;
    },
  };
}

// ------------------------------------------------------------
// Carga de fuentes activas (para el cron).
// ------------------------------------------------------------
export async function loadActiveGoogleSheetSources(
  admin: SupabaseClient,
): Promise<LeadSourceConfig[]> {
  const { data, error } = await admin
    .from("lead_sources")
    .select(
      "id, account_id, owner_user_id, name, spreadsheet_id, sheet_gid, column_mapping, pipeline_id, default_stage_id, auto_assign",
    )
    .eq("kind", "google_sheet")
    .eq("active", true);
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    ownerUserId: r.owner_user_id as string,
    name: r.name as string,
    spreadsheetId: (r.spreadsheet_id as string | null) ?? null,
    sheetGid: (r.sheet_gid as string | null) ?? null,
    columnMapping: (r.column_mapping as ColumnMapping) ?? {},
    pipelineId: r.pipeline_id as string,
    defaultStageId: r.default_stage_id as string,
    autoAssign: (r.auto_assign as boolean) ?? true,
  }));
}

// ------------------------------------------------------------
// Fuentes meta_api (polling directo a la Graph API).
// ------------------------------------------------------------
export interface MetaApiSourceConfig {
  id: string;
  accountId: string;
  ownerUserId: string;
  name: string;
  pageId: string;
  /** Ids elegidos; [] = todos los formularios ACTIVE de la página. */
  formIds: string[];
  columnMapping: ColumnMapping;
  pipelineId: string;
  defaultStageId: string;
  autoAssign: boolean;
}

export async function loadActiveMetaApiSources(
  admin: SupabaseClient,
): Promise<MetaApiSourceConfig[]> {
  const { data, error } = await admin
    .from("lead_sources")
    .select(
      "id, account_id, owner_user_id, name, meta_page_id, meta_form_ids, column_mapping, pipeline_id, default_stage_id, auto_assign",
    )
    .eq("kind", "meta_api")
    .eq("active", true);
  if (error) throw error;

  return (data ?? []).flatMap((r) => {
    if (!r.meta_page_id) return [];
    return [
      {
        id: r.id as string,
        accountId: r.account_id as string,
        ownerUserId: r.owner_user_id as string,
        name: r.name as string,
        pageId: r.meta_page_id as string,
        formIds: Array.isArray(r.meta_form_ids) ? (r.meta_form_ids as string[]) : [],
        columnMapping: (r.column_mapping as ColumnMapping) ?? {},
        pipelineId: r.pipeline_id as string,
        defaultStageId: r.default_stage_id as string,
        autoAssign: (r.auto_assign as boolean) ?? true,
      },
    ];
  });
}

/** Adapta una fuente meta_api al shape que espera createLeadRepository. */
export function metaSourceAsLeadSource(s: MetaApiSourceConfig): LeadSourceConfig {
  return {
    id: s.id,
    accountId: s.accountId,
    ownerUserId: s.ownerUserId,
    name: s.name,
    spreadsheetId: null,
    sheetGid: null,
    columnMapping: s.columnMapping,
    pipelineId: s.pipelineId,
    defaultStageId: s.defaultStageId,
    autoAssign: s.autoAssign,
  };
}

// ------------------------------------------------------------
// Bitácora de corrida del cron (health-check, B12).
// ------------------------------------------------------------
export interface SyncRunTotals {
  rowsRead: number;
  claimed: number;
  processed: number;
  quarantined: number;
  stageSynced: number;
  errors: number;
  ok: boolean;
  message?: string;
}

export async function recordSyncRun(
  admin: SupabaseClient,
  accountId: string | null,
  sourceId: string | null,
  startedAt: string,
  totals: SyncRunTotals,
): Promise<void> {
  await admin.from("lead_sync_runs").insert({
    account_id: accountId,
    source_id: sourceId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    rows_read: totals.rowsRead,
    claimed: totals.claimed,
    processed: totals.processed,
    quarantined: totals.quarantined,
    stage_synced: totals.stageSynced,
    errors: totals.errors,
    ok: totals.ok,
    message: totals.message ?? null,
  });
}
