import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPushConfigured,
  sendPushToUsers,
  type PushPayload,
} from "./webpush";

// Alertas de leads nuevos, disparadas al final de cada corrida del
// cron de ingesta. Agrupadas a propósito: si una corrida trae 8 leads
// el agente recibe UN push ("8 leads nuevos"), no ocho.

export interface LeadForAlert {
  leadId: string;
  name: string | null;
  campaign: string | null;
}

/** Mensaje conciso del push. Pura — testeada en push.test.ts. */
export function buildLeadAlert(leads: LeadForAlert[]): PushPayload {
  if (leads.length === 1) {
    const name = leads[0].name?.trim() || "Sin nombre";
    const campaign = leads[0].campaign?.trim();
    return {
      title: "Nuevo lead",
      body: campaign ? `${name} — ${campaign}` : name,
      // Deep-link al detalle de ESE lead: /leads lee ?lead y abre el
      // panel. Con varios leads no se puede apuntar a uno → /leads pelado.
      url: `/leads?lead=${leads[0].leadId}`,
      tag: "new-lead",
    };
  }
  return {
    title: "Leads nuevos",
    body: `${leads.length} leads nuevos te esperan`,
    url: "/leads",
    tag: "new-lead",
  };
}

interface LeadAlertRow {
  id: string;
  campaign_name: string | null;
  form_name: string | null;
  contact: { name: string | null } | null;
  deal: { assigned_agent_id: string | null } | null;
}

/**
 * Notifica los leads nuevos (status `processed`) creados en la cuenta
 * desde `sinceIso`: un push por agente asignado con SUS leads; los sin
 * asignar van a owners/admins de la cuenta. No-op sin claves VAPID.
 */
export async function notifyNewLeads(
  admin: SupabaseClient,
  accountId: string,
  sinceIso: string,
): Promise<void> {
  if (!isPushConfigured()) return;

  const { data: rows } = await admin
    .from("leads")
    .select(
      "id, campaign_name, form_name, contact:contacts(name), deal:deals(assigned_agent_id)",
    )
    .eq("account_id", accountId)
    .eq("status", "processed")
    .gte("created_at", sinceIso);
  if (!rows || rows.length === 0) return;

  // Agrupar por agente asignado; null → owners/admins.
  const byAgent = new Map<string | null, LeadForAlert[]>();
  for (const row of rows as unknown as LeadAlertRow[]) {
    const agent = row.deal?.assigned_agent_id ?? null;
    const list = byAgent.get(agent) ?? [];
    list.push({
      leadId: row.id,
      name: row.contact?.name ?? null,
      campaign: row.campaign_name ?? row.form_name,
    });
    byAgent.set(agent, list);
  }

  let fallback: string[] | null = null;
  for (const [agent, leads] of byAgent) {
    let recipients: string[];
    if (agent) {
      recipients = [agent];
    } else {
      if (!fallback) {
        const { data: adminRows } = await admin
          .from("profiles")
          .select("user_id")
          .eq("account_id", accountId)
          .in("account_role", ["owner", "admin"]);
        fallback = (adminRows ?? []).map((r) => r.user_id as string);
      }
      recipients = fallback;
    }
    await sendPushToUsers(admin, recipients, buildLeadAlert(leads));
  }
}

/**
 * Push agrupado de leads liberados por falta de trabajo, para los admins.
 *
 * Uno por corrida, no uno por lead: si el cron libera 5, el admin recibe
 * "5 leads volvieron a la cola", igual que con los leads nuevos.
 */
export function buildReclaimAlert(
  freed: { leadId: string; contactName: string | null; previousAgentName: string | null }[],
): PushPayload {
  if (freed.length === 1) {
    const f = freed[0];
    const lead = f.contactName?.trim() || "Sin nombre";
    const quien = f.previousAgentName?.trim();
    return {
      title: "Lead liberado",
      body: quien ? `${lead} — ${quien} no lo trabajó` : `${lead} volvió a la cola`,
      url: `/leads?lead=${f.leadId}`,
      tag: "lead-reclaimed",
    };
  }
  return {
    title: `${freed.length} leads liberados`,
    body: "Volvieron a la cola por falta de trabajo. Están sin asignar.",
    // Con varios no se puede apuntar a uno: la bandeja filtrada por sin asignar.
    url: "/leads?asesora=none",
    tag: "lead-reclaimed",
  };
}

export async function notifyReclaimedLeads(
  admin: SupabaseClient,
  adminUserIds: string[],
  freed: { leadId: string; contactName: string | null; previousAgentName: string | null }[],
): Promise<void> {
  if (!isPushConfigured() || freed.length === 0 || adminUserIds.length === 0) return;
  await sendPushToUsers(admin, adminUserIds, buildReclaimAlert(freed));
}
