// ============================================================
// Gasto por campaña desde la Graph API (handoff §6.1) → campaign_insights.
//
// No hace falta configurar el ad account: los leads YA guardan `campaign_id`,
// así que pedimos el insight de cada campaña conocida (`/{campaign_id}/insights`)
// con el mismo token de system user que ya usa la ingesta (scope ads_read).
//
// Ventana: `date_preset=maximum` (lifetime). Tiene que ser lifetime porque el
// denominador del prorrateo son TODOS los leads que la campaña trajo al CRM;
// mezclar spend de 30 días con leads de siempre daría un costo por lead falso.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface InsightsTotals {
  campaigns: number;
  updated: number;
  failed: number;
}

interface InsightRow {
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  frequency?: string;
}

const num = (v: string | undefined): number | null =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

/** Insight lifetime de UNA campaña. `null` si Meta no devuelve filas. */
async function fetchCampaignInsight(
  campaignId: string,
  token: string,
): Promise<InsightRow | null> {
  const params = new URLSearchParams({
    fields: "campaign_name,spend,impressions,reach,clicks,ctr,cpm,frequency",
    date_preset: "maximum",
    access_token: token,
  });
  const res = await fetch(`${GRAPH}/${campaignId}/insights?${params}`);
  const json = (await res.json().catch(() => ({}))) as {
    data?: InsightRow[];
    error?: { message?: string; code?: number };
  };
  if (!res.ok || json.error) {
    throw new Error(
      `Graph error ${json.error?.code ?? res.status}: ${json.error?.message ?? "insights"}`,
    );
  }
  return json.data?.[0] ?? null;
}

/**
 * Refresca campaign_insights de todas las cuentas que tengan leads con
 * atribución de campaña. Best-effort por campaña: una que falle no voltea el
 * resto (ni la corrida del cron).
 */
export async function syncCampaignInsights(
  admin: SupabaseClient,
): Promise<InsightsTotals> {
  const totals: InsightsTotals = { campaigns: 0, updated: 0, failed: 0 };
  const token = process.env.META_LEADS_ACCESS_TOKEN;
  if (!token) return totals; // sin token no hay insights — no-op silencioso.

  const { data: rows, error } = await admin
    .from("leads")
    .select("account_id, campaign_id")
    .not("campaign_id", "is", null);
  if (error) throw error;

  // (account_id, campaign_id) únicos.
  const pairs = new Map<string, { accountId: string; campaignId: string }>();
  for (const r of rows ?? []) {
    const accountId = r.account_id as string;
    const campaignId = r.campaign_id as string;
    pairs.set(`${accountId}:${campaignId}`, { accountId, campaignId });
  }
  totals.campaigns = pairs.size;

  for (const { accountId, campaignId } of pairs.values()) {
    try {
      const insight = await fetchCampaignInsight(campaignId, token);
      if (!insight) continue; // campaña sin entrega todavía.
      const { error: upsertErr } = await admin.from("campaign_insights").upsert(
        {
          account_id: accountId,
          meta_campaign_id: campaignId,
          campaign_name: insight.campaign_name ?? null,
          spend: num(insight.spend),
          impressions: num(insight.impressions),
          reach: num(insight.reach),
          clicks: num(insight.clicks),
          ctr: num(insight.ctr),
          cpm: num(insight.cpm),
          frequency: num(insight.frequency),
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "account_id,meta_campaign_id" },
      );
      if (upsertErr) throw upsertErr;
      totals.updated++;
    } catch (err) {
      totals.failed++;
      console.error(`[insights] campaña ${campaignId}:`, err);
    }
  }

  return totals;
}
