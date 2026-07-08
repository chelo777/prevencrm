import Link from "next/link";
import { AlertTriangle, Settings2 } from "lucide-react";
import { getCurrentAccount } from "@/lib/auth/account";
import { WhatsAppButton } from "./whatsapp-button";
import { LeadFilters } from "./filters";

export const dynamic = "force-dynamic";

// Bandeja de leads de Meta. Server component: lee el estado actual y
// lo renderiza; los trozos cliente son el botón de WhatsApp
// (click-to-chat + traza) y los filtros por etapa/etiqueta, que viven
// en la URL y se aplican en la consulta (paginado de a 50).

const PER_PAGE = 50;

interface TagChip {
  id: string;
  name: string;
  color: string;
}

interface LeadRow {
  id: string;
  meta_lead_id: string;
  phone_valid: boolean;
  created_at: string;
  campaign_name: string | null;
  form_name: string | null;
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    contact_tags: { tags: TagChip | null }[] | null;
  } | null;
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

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const { supabase, accountId } = await getCurrentAccount();
  const params = await searchParams;

  const stageFilter =
    typeof params.etapa === "string" && params.etapa ? params.etapa : null;
  const tagFilter =
    typeof params.etiqueta === "string" && params.etiqueta
      ? params.etiqueta
      : null;
  const pageNum = Math.max(
    1,
    Number(typeof params.pagina === "string" ? params.pagina : "1") || 1,
  );
  const from = (pageNum - 1) * PER_PAGE;

  // Catálogos para los filtros (etapas de los pipelines de la cuenta
  // y etiquetas visibles según RLS).
  const [{ data: pipelines }, { data: tagRows }] = await Promise.all([
    supabase
      .from("pipelines")
      .select("id, stages:pipeline_stages(id, name, position)")
      .eq("account_id", accountId),
    supabase.from("tags").select("id, name").order("name"),
  ]);
  const stages = (pipelines ?? [])
    .flatMap((p) => (p.stages ?? []) as { id: string; name: string; position: number }[])
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: s.name }));
  const tagOptions = (tagRows ?? []).map((t) => ({ id: t.id, name: t.name }));

  // El embed de contact_tags(tags(*)) trae SIEMPRE el set completo de
  // etiquetas para mostrar; `tag_filter` es un inner join aparte usado
  // solo como WHERE (mismo patrón que /api/v1/contacts).
  const contactEmbed = tagFilter
    ? "contact:contacts!inner(id, name, phone, contact_tags(tags(id, name, color)), tag_filter:contact_tags!inner(tag_id))"
    : "contact:contacts(id, name, phone, contact_tags(tags(id, name, color)))";
  const dealEmbed = stageFilter
    ? "deal:deals!inner(id, assigned_agent_id, stage_id, stage:pipeline_stages(name, color))"
    : "deal:deals(id, assigned_agent_id, stage:pipeline_stages(name, color))";

  let query = supabase
    .from("leads")
    .select(
      `id, meta_lead_id, phone_valid, created_at, campaign_name, form_name, ${contactEmbed}, ${dealEmbed}`,
      { count: "exact" },
    )
    .eq("account_id", accountId);
  if (stageFilter) query = query.eq("deal.stage_id", stageFilter);
  if (tagFilter) query = query.eq("contact.tag_filter.tag_id", tagFilter);

  const { data: leads, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + PER_PAGE - 1);

  const { count: quarantineCount } = await supabase
    .from("lead_intake_errors")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("resolved", false);

  const rows = (leads ?? []) as unknown as LeadRow[];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const hasFilters = Boolean(stageFilter || tagFilter);

  function pageHref(n: number): string {
    const sp = new URLSearchParams();
    if (stageFilter) sp.set("etapa", stageFilter);
    if (tagFilter) sp.set("etiqueta", tagFilter);
    if (n > 1) sp.set("pagina", String(n));
    const qs = sp.toString();
    return qs ? `/leads?${qs}` : "/leads";
  }

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LeadFilters stages={stages} tags={tagOptions} />
        <span className="text-sm text-muted-foreground">
          {total} lead{total === 1 ? "" : "s"}
          {hasFilters ? " con estos filtros" : ""}
        </span>
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
              <th className="px-4 py-3 font-medium">Etiquetas</th>
              <th className="px-4 py-3 font-medium">Campaña</th>
              <th className="px-4 py-3 font-medium">Ingresó</th>
              <th className="px-4 py-3 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  {hasFilters ? (
                    <>Ningún lead coincide con los filtros.</>
                  ) : (
                    <>
                      Todavía no hay leads. Dá de alta una{" "}
                      <Link href="/leads/sources" className="text-primary underline">
                        fuente
                      </Link>{" "}
                      y esperá el próximo ciclo de sincronización.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((lead) => {
                const leadTags = (lead.contact?.contact_tags ?? [])
                  .map((ct) => ct.tags)
                  .filter((t): t is TagChip => Boolean(t));
                return (
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
                    <td className="px-4 py-3">
                      {leadTags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex max-w-48 flex-wrap gap-1">
                          {leadTags.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                              style={{
                                backgroundColor: `${tag.color}22`,
                                color: tag.color,
                              }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > PER_PAGE && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Mostrando {total === 0 ? 0 : from + 1}–
            {Math.min(from + PER_PAGE, total)} de {total}
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Link
                href={pageHref(pageNum - 1)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-foreground hover:bg-muted"
              >
                ← Anterior
              </Link>
            )}
            {pageNum < totalPages && (
              <Link
                href={pageHref(pageNum + 1)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-foreground hover:bg-muted"
              >
                Siguiente →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
