import Link from "next/link";
import { AlertTriangle, Settings2 } from "lucide-react";
import { getCurrentAccount } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { WhatsAppButton } from "./whatsapp-button";
import { LeadFilters } from "./filters";
import { StageSelect, type StageOption } from "./stage-select";
import { LeadDetailProvider } from "./lead-detail-provider";
import { LeadNameCell } from "./lead-name-cell";
import { AssigneeSelect, type Asesora } from "./assignee-select";
import { DeleteLeadButton } from "./delete-lead-button";

export const dynamic = "force-dynamic";

// Bandeja de leads de Meta. Server component: lee el estado actual y
// lo renderiza; los trozos cliente son el botón de WhatsApp, el select
// de etapa (update optimista como el Kanban) y los filtros por
// etapa/etiqueta en la URL (paginado de a 50).
//
// Responsive: en el teléfono la tabla se reduce a lo accionable —
// contacto (con etiquetas debajo), etapa editable y WhatsApp solo
// ícono. Campaña, fecha y la columna de etiquetas aparecen recién en
// pantallas anchas; nunca hay scroll horizontal.

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
    stage_id: string;
    assigned_agent_id: string | null;
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

function TagList({ tags }: { tags: TagChip[] }) {
  return (
    <div className="flex max-w-48 flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
          style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
}

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const { supabase, accountId, role } = await getCurrentAccount();
  const params = await searchParams;

  // Administrar fuentes es solo admin+. Para una asesora (agent) ocultamos
  // el botón Fuentes, el aviso de cuarentena y el link del estado vacío.
  // El mismo umbral habilita ver/gestionar la asignación de cada lead.
  const isAdmin = hasMinRole(role, "admin");
  const canManageSources = isAdmin;

  const stageFilter =
    typeof params.etapa === "string" && params.etapa ? params.etapa : null;
  const tagFilter =
    typeof params.etiqueta === "string" && params.etiqueta
      ? params.etiqueta
      : null;
  // Filtro por asesora (solo admin). "none" = leads sin asignar.
  const asesoraFilter =
    isAdmin && typeof params.asesora === "string" && params.asesora
      ? params.asesora
      : null;
  // Filtro "Solo duplicados" (solo admin): ver dupContactIds más abajo.
  const dupFilter = isAdmin && params.dup === "1";
  const pageNum = Math.max(
    1,
    Number(typeof params.pagina === "string" ? params.pagina : "1") || 1,
  );
  const from = (pageNum - 1) * PER_PAGE;

  // Catálogos: etapas de los pipelines de la cuenta (alimentan el
  // filtro Y el select inline de cada fila) y etiquetas visibles.
  const [{ data: pipelines }, { data: tagRows }] = await Promise.all([
    supabase
      .from("pipelines")
      .select("id, stages:pipeline_stages(id, name, color, position)")
      .eq("account_id", accountId),
    supabase.from("tags").select("id, name").order("name"),
  ]);
  const stages: StageOption[] = (pipelines ?? [])
    .flatMap(
      (p) =>
        (p.stages ?? []) as {
          id: string;
          name: string;
          color: string;
          position: number;
        }[],
    )
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const tagOptions = (tagRows ?? []).map((t) => ({ id: t.id, name: t.name }));

  // Asesoras compradoras (is_lead_buyer) — solo para admin: alimentan la
  // columna "Asignada a", el filtro y el selector de reasignación inline.
  const asesoras: Asesora[] = isAdmin
    ? (
        (
          await supabase
            .from("profiles")
            .select("user_id, full_name")
            .eq("account_id", accountId)
            .eq("is_lead_buyer", true)
            .order("full_name")
        ).data ?? []
      ).map((a) => ({
        user_id: a.user_id as string,
        full_name: (a.full_name as string | null) ?? null,
      }))
    : [];
  const asesoraName = new Map(
    asesoras.map((a) => [a.user_id, a.full_name || a.user_id.slice(0, 8)]),
  );

  // Duplicados por teléfono (solo admin): un mismo phone_normalized con
  // más de un lead. La ingesta dedupea el CONTACTO por teléfono, así que
  // detectamos agrupando por ese teléfono normalizado y armamos el set de
  // contact_id que lo comparten. Query liviana de toda la cuenta (sin
  // paginar) — solo trae contact_id + teléfono, nada de payloads grandes.
  const dupContactIds = new Set<string>();
  if (isAdmin) {
    const { data: allLeadsPhones } = await supabase
      .from("leads")
      .select("contact_id, contact:contacts(phone_normalized)")
      .eq("account_id", accountId);
    // Contamos LEADS por teléfono normalizado (no contactos): "un mismo
    // teléfono con más de un lead" es la definición pedida.
    const leadCountByPhone = new Map<string, number>();
    const contactIdsByPhone = new Map<string, Set<string>>();
    for (const row of (allLeadsPhones ?? []) as unknown as {
      contact_id: string | null;
      contact: { phone_normalized: string | null } | null;
    }[]) {
      const phone = row.contact?.phone_normalized;
      if (!phone || !row.contact_id) continue;
      leadCountByPhone.set(phone, (leadCountByPhone.get(phone) ?? 0) + 1);
      if (!contactIdsByPhone.has(phone))
        contactIdsByPhone.set(phone, new Set());
      contactIdsByPhone.get(phone)!.add(row.contact_id);
    }
    for (const [phone, count] of leadCountByPhone) {
      if (count > 1) {
        for (const cid of contactIdsByPhone.get(phone) ?? [])
          dupContactIds.add(cid);
      }
    }
  }
  const dupCount = dupContactIds.size;

  // El embed de contact_tags(tags(*)) trae SIEMPRE el set completo de
  // etiquetas para mostrar; `tag_filter` es un inner join aparte usado
  // solo como WHERE (mismo patrón que /api/v1/contacts).
  const contactEmbed = tagFilter
    ? "contact:contacts!inner(id, name, phone, contact_tags(tags(id, name, color)), tag_filter:contact_tags!inner(tag_id))"
    : "contact:contacts(id, name, phone, contact_tags(tags(id, name, color)))";
  const needInnerDeal = Boolean(stageFilter || asesoraFilter);
  const dealEmbed = needInnerDeal
    ? "deal:deals!inner(id, stage_id, assigned_agent_id)"
    : "deal:deals(id, stage_id, assigned_agent_id)";

  let query = supabase
    .from("leads")
    .select(
      `id, meta_lead_id, phone_valid, created_at, campaign_name, form_name, ${contactEmbed}, ${dealEmbed}`,
      { count: "exact" },
    )
    .eq("account_id", accountId);
  if (stageFilter) query = query.eq("deal.stage_id", stageFilter);
  if (tagFilter) query = query.eq("contact.tag_filter.tag_id", tagFilter);
  if (asesoraFilter === "none")
    query = query.is("deal.assigned_agent_id", null);
  else if (asesoraFilter)
    query = query.eq("deal.assigned_agent_id", asesoraFilter);
  if (dupFilter) {
    // Set vacío = ningún duplicado; forzamos un contact_id imposible para
    // que la query no devuelva nada en vez de traer todo.
    query = query.in(
      "contact_id",
      dupContactIds.size > 0 ? [...dupContactIds] : ["00000000-0000-0000-0000-000000000000"],
    );
  }

  const { data: leads, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + PER_PAGE - 1);

  const { count: quarantineCount } = await supabase
    .from("lead_intake_errors")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("resolved", false);

  // Deep-link ?lead=<id> (desde el push de nuevo lead): resolvemos el
  // contacto para abrir el panel al montar. El lead puede no estar en la
  // página actual del paginado, por eso el fetch puntual bajo RLS.
  const deepLinkLead =
    typeof params.lead === "string" && params.lead ? params.lead : null;
  let deepLinkContactId: string | null = null;
  if (deepLinkLead) {
    const { data: dl } = await supabase
      .from("leads")
      .select("contact_id")
      .eq("id", deepLinkLead)
      .eq("account_id", accountId)
      .maybeSingle();
    deepLinkContactId = (dl?.contact_id as string | null) ?? null;
  }

  const rows = (leads ?? []) as unknown as LeadRow[];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const hasFilters = Boolean(
    stageFilter || tagFilter || asesoraFilter || dupFilter,
  );

  function pageHref(n: number): string {
    const sp = new URLSearchParams();
    if (stageFilter) sp.set("etapa", stageFilter);
    if (tagFilter) sp.set("etiqueta", tagFilter);
    if (asesoraFilter) sp.set("asesora", asesoraFilter);
    if (dupFilter) sp.set("dup", "1");
    if (n > 1) sp.set("pagina", String(n));
    const qs = sp.toString();
    return qs ? `/leads?${qs}` : "/leads";
  }

  // Toggle del filtro "Solo duplicados" (admin-only), preservando el resto
  // de los filtros activos en la URL.
  function dupToggleHref(): string {
    const sp = new URLSearchParams();
    if (stageFilter) sp.set("etapa", stageFilter);
    if (tagFilter) sp.set("etiqueta", tagFilter);
    if (asesoraFilter) sp.set("asesora", asesoraFilter);
    if (!dupFilter) sp.set("dup", "1");
    const qs = sp.toString();
    return qs ? `/leads?${qs}` : "/leads";
  }

  return (
    <LeadDetailProvider initialContactId={deepLinkContactId}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Leads entrantes de Meta Lead Ads.
          </p>
        </div>
        {canManageSources && (
          <Link
            href="/leads/sources"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Settings2 className="h-4 w-4" />
            Fuentes
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <LeadFilters
            stages={stages}
            tags={tagOptions}
            asesoras={asesoras.map((a) => ({
              id: a.user_id,
              name: a.full_name || a.user_id.slice(0, 8),
            }))}
          />
          {isAdmin && (
            <Link
              href={dupToggleHref()}
              className={
                dupFilter
                  ? "rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-500"
                  : "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted"
              }
            >
              {dupFilter
                ? "Quitar filtro de duplicados"
                : `Solo duplicados (${dupCount})`}
            </Link>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {total} lead{total === 1 ? "" : "s"}
          {hasFilters ? " con estos filtros" : ""}
        </span>
      </div>

      {canManageSources && quarantineCount ? (
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
              <th className="px-3 py-3 font-medium sm:px-4">Contacto</th>
              <th className="px-3 py-3 font-medium sm:px-4">Etapa</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                Etiquetas
              </th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">
                Campaña
              </th>
              {isAdmin && (
                <th className="hidden px-4 py-3 font-medium sm:table-cell">
                  Asignado a
                </th>
              )}
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                Ingresó
              </th>
              <th className="px-3 py-3 font-medium sm:px-4">
                <span className="sr-only sm:not-sr-only">Acción</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground">
                  {hasFilters ? (
                    <>Ningún lead coincide con los filtros.</>
                  ) : canManageSources ? (
                    <>
                      Todavía no hay leads. Dá de alta una{" "}
                      <Link href="/leads/sources" className="text-primary underline">
                        fuente
                      </Link>{" "}
                      y esperá el próximo ciclo de sincronización.
                    </>
                  ) : (
                    <>Todavía no tenés leads asignados.</>
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
                    <td className="px-3 py-3 sm:px-4">
                      <LeadNameCell
                        contactId={lead.contact?.id ?? null}
                        name={lead.contact?.name || "Sin nombre"}
                        phone={lead.contact?.phone ?? null}
                        phoneValid={lead.phone_valid}
                        duplicate={
                          isAdmin &&
                          Boolean(
                            lead.contact?.id &&
                              dupContactIds.has(lead.contact.id),
                          )
                        }
                      />
                      {leadTags.length > 0 && (
                        <div className="mt-1 md:hidden">
                          <TagList tags={leadTags} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 sm:px-4">
                      {lead.deal ? (
                        <StageSelect
                          dealId={lead.deal.id}
                          stages={stages}
                          initialStageId={lead.deal.stage_id}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {leadTags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <TagList tags={leadTags} />
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {lead.campaign_name || lead.form_name || "—"}
                    </td>
                    {isAdmin && (
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {lead.deal ? (
                          <AssigneeSelect
                            dealId={lead.deal.id}
                            accountId={accountId}
                            initialAgentId={lead.deal.assigned_agent_id}
                            asesoras={asesoras}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {fmtDate(lead.created_at)}
                    </td>
                    <td className="px-3 py-3 text-right sm:px-4 sm:text-left">
                      <div className="flex items-center justify-end gap-1.5 sm:justify-start">
                        <WhatsAppButton
                          leadId={lead.id}
                          phone={lead.contact?.phone ?? null}
                          name={lead.contact?.name ?? null}
                          campaign={lead.campaign_name ?? lead.form_name}
                          disabled={!lead.phone_valid}
                        />
                        {isAdmin && (
                          <DeleteLeadButton
                            leadId={lead.id}
                            leadName={lead.contact?.name ?? ""}
                          />
                        )}
                      </div>
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
    </LeadDetailProvider>
  );
}
