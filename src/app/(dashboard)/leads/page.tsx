import Link from "next/link";
import { AlertTriangle, Settings2 } from "lucide-react";
import { getCurrentAccount } from "@/lib/auth/account";
import { WhatsAppButton } from "./whatsapp-button";

export const dynamic = "force-dynamic";

// Bandeja de leads de Meta. Server component: lee el estado actual y
// lo renderiza; el botón de WhatsApp (click-to-chat + traza) es el
// único trozo cliente.

interface LeadRow {
  id: string;
  meta_lead_id: string;
  phone_valid: boolean;
  created_at: string;
  campaign_name: string | null;
  form_name: string | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
  deal: {
    id: string;
    assigned_agent_id: string | null;
    stage: { name: string; color: string } | null;
  } | null;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function LeadsPage() {
  const { supabase, accountId } = await getCurrentAccount();

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, meta_lead_id, phone_valid, created_at, campaign_name, form_name, contact:contacts(id, name, phone), deal:deals(id, assigned_agent_id, stage:pipeline_stages(name, color))",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(100);

  const { count: quarantineCount } = await supabase
    .from("lead_intake_errors")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("resolved", false);

  const rows = (leads ?? []) as unknown as LeadRow[];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Leads entrantes de Meta Lead Ads.
          </p>
        </div>
        <Link
          href="/leads/sources"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          <Settings2 className="h-4 w-4" />
          Fuentes
        </Link>
      </div>

      {quarantineCount ? (
        <Link
          href="/leads/sources"
          className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {quarantineCount} fila{quarantineCount === 1 ? "" : "s"} en cuarentena
          (sin id de lead válido). Revisá las fuentes.
        </Link>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-medium">Contacto</th>
              <th className="px-4 py-3 font-medium">Etapa</th>
              <th className="px-4 py-3 font-medium">Campaña</th>
              <th className="px-4 py-3 font-medium">Ingresó</th>
              <th className="px-4 py-3 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay leads. Dá de alta una{" "}
                  <Link href="/leads/sources" className="text-primary underline">
                    fuente
                  </Link>{" "}
                  y esperá el próximo ciclo de sincronización.
                </td>
              </tr>
            ) : (
              rows.map((lead) => (
                <tr key={lead.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {lead.contact?.name || "Sin nombre"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {lead.contact?.phone || "—"}
                      {!lead.phone_valid && (
                        <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                          revisar teléfono
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {lead.deal?.stage ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                        style={{
                          backgroundColor: `${lead.deal.stage.color}22`,
                          color: lead.deal.stage.color,
                        }}
                      >
                        {lead.deal.stage.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.campaign_name || lead.form_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmtDate(lead.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <WhatsAppButton
                      leadId={lead.id}
                      phone={lead.contact?.phone ?? null}
                      name={lead.contact?.name ?? null}
                      disabled={!lead.phone_valid}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
