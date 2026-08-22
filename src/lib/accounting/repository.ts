// ============================================================
// Adaptador Supabase del puerto AccountingRepository.
//
// Recibe el cliente YA scopeado del llamador: las rutas API pasan el cliente
// de sesión (RLS admin-only es el muro real) y el cron pasa service role.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountingRepository,
  CampaignInsight,
  CreatePackageInput,
  CreatePaymentInput,
  DateRange,
  DeliveredLead,
  LeadPackage,
  PackagePayment,
  PackageStatus,
  UpdatePackageInput,
} from "./types";

type Row = Record<string, unknown>;

function toPackage(r: Row): LeadPackage {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    buyerUserId: r.buyer_user_id as string,
    ordinal: Number(r.ordinal),
    leadsTarget: Number(r.leads_target),
    price: Number(r.price),
    currency: (r.currency as string) ?? "ARS",
    status: r.status as PackageStatus,
    committedAt: (r.committed_at as string | null) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

function toPayment(r: Row): PackagePayment {
  return {
    id: r.id as string,
    packageId: r.package_id as string,
    paidOn: r.paid_on as string,
    amount: Number(r.amount),
    note: (r.note as string | null) ?? null,
  };
}

const NO_RANGE: DateRange = { since: null, until: null };

export function createAccountingRepository(
  supabase: SupabaseClient,
  accountId: string,
  range: DateRange = NO_RANGE,
): AccountingRepository {
  const hasRange = Boolean(range.since || range.until);
  // `until` es inclusive: sobre timestamps hay que cubrir el día entero.
  const untilTs = range.until ? `${range.until}T23:59:59.999Z` : null;

  return {
    async listPackages() {
      let q = supabase
        .from("lead_packages")
        .select("*")
        .eq("account_id", accountId);
      if (range.since) q = q.gte("created_at", range.since);
      if (untilTs) q = q.lte("created_at", untilTs);
      const { data, error } = await q.order("buyer_user_id").order("ordinal");
      if (error) throw error;
      return (data ?? []).map(toPackage);
    },

    async listPayments() {
      // Los pagos no tienen account_id: se acotan por sus paquetes (que sí lo
      // tienen) — el mismo gate que aplica la RLS.
      const { data: pkgs, error: pkgErr } = await supabase
        .from("lead_packages")
        .select("id")
        .eq("account_id", accountId);
      if (pkgErr) throw pkgErr;
      const ids = (pkgs ?? []).map((p) => p.id as string);
      if (ids.length === 0) return [];

      let q = supabase
        .from("lead_package_payments")
        .select("*")
        .in("package_id", ids);
      if (range.since) q = q.gte("paid_on", range.since);
      if (range.until) q = q.lte("paid_on", range.until);
      const { data, error } = await q.order("paid_on");
      if (error) throw error;
      return (data ?? []).map(toPayment);
    },

    async listDeliveredLeads() {
      let q = supabase
        .from("leads")
        .select("package_id, campaign_id")
        .eq("account_id", accountId)
        .not("package_id", "is", null);
      if (range.since) q = q.gte("created_at", range.since);
      if (untilTs) q = q.lte("created_at", untilTs);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(
        (r): DeliveredLead => ({
          packageId: r.package_id as string,
          campaignId: (r.campaign_id as string | null) ?? null,
        }),
      );
    },

    async leadCountByCampaign() {
      // Denominador del prorrateo. Escaneo de UNA columna de texto sobre los
      // leads de la cuenta (mismo criterio que el chequeo de duplicados de
      // /leads): liviano y sin traer payloads.
      let q = supabase
        .from("leads")
        .select("campaign_id")
        .eq("account_id", accountId)
        .not("campaign_id", "is", null);
      if (range.since) q = q.gte("created_at", range.since);
      if (untilTs) q = q.lte("created_at", untilTs);
      const { data, error } = await q;
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data ?? []) {
        const id = r.campaign_id as string;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    },

    async listCampaignInsights() {
      // Catálogo: nombre y si se mide. El gasto sale de acá solo cuando NO hay
      // rango (es el lifetime que reporta Meta).
      const { data, error } = await supabase
        .from("campaign_insights")
        .select("meta_campaign_id, campaign_name, spend, impressions, clicks, tracked")
        .eq("account_id", accountId);
      if (error) throw error;
      const base = (data ?? []).map(
        (r): CampaignInsight => ({
          metaCampaignId: r.meta_campaign_id as string,
          campaignName: (r.campaign_name as string | null) ?? null,
          spend: r.spend == null ? null : Number(r.spend),
          tracked: (r.tracked as boolean | null) ?? true,
          impressions: r.impressions == null ? null : Number(r.impressions),
          clicks: r.clicks == null ? null : Number(r.clicks),
        }),
      );
      if (!hasRange) return base;

      // Con rango, el gasto se recompone sumando los días del período.
      let dq = supabase
        .from("campaign_insights_daily")
        .select("meta_campaign_id, spend, impressions, clicks")
        .eq("account_id", accountId);
      if (range.since) dq = dq.gte("day", range.since);
      if (range.until) dq = dq.lte("day", range.until);
      const { data: daily, error: dailyErr } = await dq;
      if (dailyErr) throw dailyErr;

      const agg = new Map<string, { spend: number; impressions: number; clicks: number }>();
      for (const d of daily ?? []) {
        const id = d.meta_campaign_id as string;
        const acc = agg.get(id) ?? { spend: 0, impressions: 0, clicks: 0 };
        acc.spend += Number(d.spend ?? 0);
        acc.impressions += Number(d.impressions ?? 0);
        acc.clicks += Number(d.clicks ?? 0);
        agg.set(id, acc);
      }
      return base.map((c) => {
        const a = agg.get(c.metaCampaignId);
        return {
          ...c,
          spend: a ? a.spend : 0, // sin días en el período: no gastó nada
          impressions: a ? a.impressions : 0,
          clicks: a ? a.clicks : 0,
        };
      });
    },

    async nextOrdinal(buyerUserId: string) {
      const { data, error } = await supabase
        .from("lead_packages")
        .select("ordinal")
        .eq("account_id", accountId)
        .eq("buyer_user_id", buyerUserId)
        .order("ordinal", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.ordinal) + 1 : 1;
    },

    async createPackage(input: CreatePackageInput & { ordinal: number }) {
      const { data, error } = await supabase
        .from("lead_packages")
        .insert({
          account_id: accountId,
          buyer_user_id: input.buyerUserId,
          ordinal: input.ordinal,
          leads_target: input.leadsTarget,
          price: input.price,
          committed_at: input.committedAt,
        })
        .select("*")
        .single();
      if (error) throw error;
      return toPackage(data);
    },

    async updatePackage(id: string, input: UpdatePackageInput) {
      const patch: Row = {};
      if (input.leadsTarget !== undefined) patch.leads_target = input.leadsTarget;
      if (input.price !== undefined) patch.price = input.price;
      if (input.committedAt !== undefined) patch.committed_at = input.committedAt;
      if (input.status !== undefined) {
        patch.status = input.status;
        patch.completed_at =
          input.status === "completed" ? new Date().toISOString() : null;
      }
      const { data, error } = await supabase
        .from("lead_packages")
        .update(patch)
        .eq("id", id)
        .eq("account_id", accountId)
        .select("*")
        .single();
      if (error) throw error;
      return toPackage(data);
    },

    async unlinkLeadsFromPackage(id) {
      // `leads.package_id` no cascadea a propósito: borrar una tanda nunca
      // puede borrar leads. Se sueltan y el lead sigue vivo, sin tanda.
      const { data, error } = await supabase
        .from("leads")
        .update({ package_id: null })
        .eq("account_id", accountId)
        .eq("package_id", id)
        .select("id");
      if (error) throw error;
      return (data ?? []).length;
    },

    async deletePackage(id) {
      // Los pagos se van solos (FK ON DELETE CASCADE, migración 049).
      const { error } = await supabase
        .from("lead_packages")
        .delete()
        .eq("id", id)
        .eq("account_id", accountId);
      if (error) throw error;
    },

    async createPayment(input: CreatePaymentInput) {
      const { data, error } = await supabase
        .from("lead_package_payments")
        .insert({
          package_id: input.packageId,
          paid_on: input.paidOn,
          amount: input.amount,
          note: input.note,
        })
        .select("*")
        .single();
      if (error) throw error;
      return toPayment(data);
    },

    async setCampaignTracked(metaCampaignId: string, tracked: boolean) {
      const { error } = await supabase
        .from("campaign_insights")
        .update({ tracked })
        .eq("account_id", accountId)
        .eq("meta_campaign_id", metaCampaignId);
      if (error) throw error;
    },
  };
}
