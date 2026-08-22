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
import { LeadSelectionProvider } from "./lead-selection";
import { LeadCheckbox, LeadCheckboxAll } from "./lead-checkbox";
import { BulkActionsBar, SelectAllMatchingHint } from "./bulk-actions-bar";
import {
  applyLeadFilter,
  hasActiveFilters,
  parseLeadFilter,
  scopeFilterToRole,
} from "@/lib/leads/lead-filter";

export const dynamic = "force-dynamic";

// Bandeja de leads de Meta. Server component: lee el estado actual y
// lo renderiza; los trozos cliente son el botón de WhatsApp, el select
// de etapa (update optimista como el Kanban) y los filtros por
// etapa/etiqueta en la URL (paginado de a 50).
//
// Responsive: en el teléfono NO hay tabla. Una tabla con scroll horizontal
// dentro de un contenedor con borde dejaba las acciones fuera de la pantalla
// (había que deslizar para llegar al botón de WhatsApp). Debajo de `sm` la
// lista se renderiza como tarjetas a ancho completo, sin contenedor propio y
// sin scroll lateral; la tabla vuelve recién en pantallas anchas, que es
// donde las columnas entran de verdad.
//
// Selección múltiple: los checkboxes y la barra de acciones masivas son
// cliente (`lead-selection.tsx`), pero el filtro que define "todos los que
// coinciden" es el MISMO módulo que usa /api/leads/bulk — así lo que se
// cuenta y lo que se modifica no pueden separarse.

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
    // hour12:false a propósito: "12:28 p. m." es más ancho que "12:28" y esta
    // columna compite por el ancho de la tabla con la de acciones.
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
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
  const { supabase, accountId, role, userId } = await getCurrentAccount();
  const params = await searchParams;

  // Administrar fuentes es solo admin+. Para una asesora (agent) ocultamos
  // el botón Fuentes, el aviso de cuarentena y el link del estado vacío.
  // El mismo umbral habilita ver/gestionar la asignación de cada lead.
  const isAdmin = hasMinRole(role, "admin");
  const canManageSources = isAdmin;

  // Un solo módulo define el filtro (`lib/leads/lead-filter.ts`) y lo acota
  // al rol: a un agent le fuerza sus propios leads y le saca "solo
  // duplicados", pida lo que pida la URL. /api/leads/bulk hace exactamente lo
  // mismo con el mismo código, así que "seleccionar todos los que coinciden"
  // opera sobre el conjunto que se está viendo, ni uno más.
  const filter = scopeFilterToRole(parseLeadFilter(params), role, userId);
  const stageFilter = filter.stageId;
  const tagFilter = filter.tagId;
  const asesoraFilter = filter.assignedTo;
  const dupFilter = filter.onlyDuplicates;
  const pageNum = Math.max(
    1,
    Number(typeof params.pagina === "string" ? params.pagina : "1") || 1,
  );
  const from = (pageNum - 1) * PER_PAGE;

  // ── Catálogos + auxiliares, TODO en un batch paralelo ──
  // La página es force-dynamic (se renderiza en el servidor por request); el
  // costo real es la LATENCIA de cada round-trip a Supabase, no el SQL (las
  // queries corren en ~1-2 ms). Antes iban en secuencia (catálogos → asesoras
  // → duplicados → leads → cuarentena → deep-link = 5-6 viajes). Ahora todas
  // las auxiliares van juntas (un viaje) y después el query principal.
  const asesorasP = isAdmin
    ? supabase
        .from("profiles")
        .select("user_id, full_name")
        .eq("account_id", accountId)
        .eq("is_lead_buyer", true)
        .order("full_name")
    : null;
  // Duplicados por teléfono (solo admin): un mismo phone_normalized con más de
  // un lead. Query liviana de toda la cuenta — solo contact_id + teléfono.
  const dupScanP = isAdmin
    ? supabase
        .from("leads")
        .select("contact_id, contact:contacts(phone_normalized)")
        .eq("account_id", accountId)
    : null;
  // Deep-link ?lead=<id> (push de nuevo lead): resolvemos el contacto a abrir.
  const deepLinkLead =
    typeof params.lead === "string" && params.lead ? params.lead : null;
  const deepLinkP = deepLinkLead
    ? supabase
        .from("leads")
        .select("contact_id")
        .eq("id", deepLinkLead)
        .eq("account_id", accountId)
        .maybeSingle()
    : null;

  const [pipelinesRes, tagsRes, asesorasRes, dupScanRes, quarantineRes, deepLinkRes] =
    await Promise.all([
      supabase
        .from("pipelines")
        .select("id, stages:pipeline_stages(id, name, color, position)")
        .eq("account_id", accountId),
      supabase.from("tags").select("id, name, color").order("name"),
      asesorasP ??
        Promise.resolve({
          data: [] as { user_id: string; full_name: string | null }[],
        }),
      dupScanP ?? Promise.resolve({ data: [] as unknown[] }),
      supabase
        .from("lead_intake_errors")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("resolved", false),
      deepLinkP ??
        Promise.resolve({ data: null as { contact_id: string | null } | null }),
    ]);

  const stages: StageOption[] = ((pipelinesRes.data ?? []) as {
    stages?: { id: string; name: string; color: string; position: number }[];
  }[])
    .flatMap((p) => p.stages ?? [])
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const tagChips = (tagsRes.data ?? []) as TagChip[];
  const tagOptions = tagChips.map((t) => ({ id: t.id, name: t.name }));

  const asesoras: Asesora[] = (
    (asesorasRes.data ?? []) as { user_id: string; full_name: string | null }[]
  ).map((a) => ({ user_id: a.user_id, full_name: a.full_name ?? null }));
  const asesoraName = new Map(
    asesoras.map((a) => [a.user_id, a.full_name || a.user_id.slice(0, 8)]),
  );

  const quarantineCount = quarantineRes.count;
  const deepLinkContactId =
    (deepLinkRes.data as { contact_id: string | null } | null)?.contact_id ??
    null;

  // "Un mismo teléfono con más de un lead" → set de contact_id duplicados.
  const dupContactIds = new Set<string>();
  {
    const leadCountByPhone = new Map<string, number>();
    const contactIdsByPhone = new Map<string, Set<string>>();
    for (const row of (dupScanRes.data ?? []) as {
      contact_id: string | null;
      contact: { phone_normalized: string | null } | null;
    }[]) {
      const phone = row.contact?.phone_normalized;
      if (!phone || !row.contact_id) continue;
      leadCountByPhone.set(phone, (leadCountByPhone.get(phone) ?? 0) + 1);
      if (!contactIdsByPhone.has(phone)) contactIdsByPhone.set(phone, new Set());
      contactIdsByPhone.get(phone)!.add(row.contact_id);
    }
    for (const [phone, n] of leadCountByPhone) {
      if (n > 1)
        for (const cid of contactIdsByPhone.get(phone) ?? [])
          dupContactIds.add(cid);
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
  query = applyLeadFilter(query, filter, dupContactIds);

  const { data: leads, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + PER_PAGE - 1);

  const rows = (leads ?? []) as unknown as LeadRow[];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const hasFilters = hasActiveFilters(filter);
  // Ids de la página: el checkbox de cabecera marca estos, no los 1057.
  const pageIds = rows.map((r) => r.id);
  // Las etiquetas se resuelven una sola vez: las consumen la vista de
  // tarjetas y la tabla, que son dos marcados sobre los mismos datos.
  // Mensaje de lista vacía: lo comparten tarjetas y tabla. Distingue "no hay
  // nada" de "los filtros no dejaron pasar nada", que son problemas distintos.
  const emptyMessage = hasFilters ? (
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
  );

  const viewRows = rows.map((lead) => ({
    lead,
    leadTags: (lead.contact?.contact_tags ?? [])
      .map((ct) => ct.tags)
      .filter((t): t is TagChip => Boolean(t)),
  }));

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
      <LeadSelectionProvider totalMatching={total} pageSize={rows.length}>
      {/* La barra de acciones es fija abajo (h-14): la lista reserva ese alto
          para que el último lead no quede tapado.
          En xl la bandeja se ensancha a 7xl: es la única pantalla con ocho
          columnas y a 6xl la de acciones quedaba fuera del borde. */}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-20 xl:max-w-7xl sm:pb-16">
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

      {/* Lista: tarjetas en el teléfono, tabla en pantalla ancha. Son dos
          marcados distintos a propósito — una tabla comprimida a 390px
          obligaba a deslizar para llegar a las acciones. */}

      {/* ── Mobile ── */}
      <ul className="-mx-4 divide-y divide-border sm:hidden">
        {viewRows.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </li>
        ) : (
          viewRows.map(({ lead, leadTags }) => (
            <li key={lead.id} className="flex gap-3 px-4 py-3">
              <div className="pt-1">
                <LeadCheckbox
                  id={lead.id}
                  label={lead.contact?.name || "este lead"}
                />
              </div>

              <div className="min-w-0 flex-1">
                <LeadNameCell
                  contactId={lead.contact?.id ?? null}
                  name={lead.contact?.name || "Sin nombre"}
                  phone={lead.contact?.phone ?? null}
                  phoneValid={lead.phone_valid}
                  duplicate={
                    isAdmin &&
                    Boolean(
                      lead.contact?.id && dupContactIds.has(lead.contact.id),
                    )
                  }
                />

                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  Ingresó {fmtDate(lead.created_at)}
                </p>

                {leadTags.length > 0 && (
                  <div className="mt-1.5">
                    <TagList tags={leadTags} />
                  </div>
                )}

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  {lead.deal ? (
                    <StageSelect
                      dealId={lead.deal.id}
                      stages={stages}
                      initialStageId={lead.deal.stage_id}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Sin etapa
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-1">
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
                  </span>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      {/* ── Desktop ── */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <LeadCheckboxAll pageIds={pageIds} />
                <span className="sr-only">Seleccionar</span>
              </th>
              <th className="px-3 py-3 font-medium sm:px-4">Contacto</th>
              <th className="px-3 py-3 font-medium sm:px-4">Etapa</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">
                Etiquetas
              </th>
              <th className="hidden px-4 py-3 font-medium xl:table-cell">
                Campaña
              </th>
              {isAdmin && (
                <th className="hidden px-4 py-3 font-medium sm:table-cell">
                  Asignado a
                </th>
              )}
              <th className="px-4 py-3 font-medium">Ingresó</th>
              <th className="px-3 py-3 font-medium sm:px-4">
                <span className="sr-only sm:not-sr-only">Acción</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {viewRows.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 8 : 7}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              viewRows.map(({ lead, leadTags }) => (
                <tr
                  key={lead.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-4 py-3">
                    <LeadCheckbox
                      id={lead.id}
                      label={lead.contact?.name || "este lead"}
                    />
                  </td>
                  <td className="px-3 py-3 sm:px-4">
                    <LeadNameCell
                      contactId={lead.contact?.id ?? null}
                      name={lead.contact?.name || "Sin nombre"}
                      phone={lead.contact?.phone ?? null}
                      phoneValid={lead.phone_valid}
                      duplicate={
                        isAdmin &&
                        Boolean(
                          lead.contact?.id && dupContactIds.has(lead.contact.id),
                        )
                      }
                    />
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
                  <td className="hidden max-w-[11rem] px-4 py-3 md:table-cell">
                    {leadTags.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <TagList tags={leadTags} />
                    )}
                  </td>
                  <td className="hidden max-w-[12rem] truncate px-4 py-3 text-muted-foreground xl:table-cell">
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
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                    {fmtDate(lead.created_at)}
                  </td>
                  <td className="w-px whitespace-nowrap px-3 py-3 text-right sm:px-4 sm:text-left">
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
              ))
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
      <SelectAllMatchingHint />
      </div>
      <BulkActionsBar stages={stages} tags={tagChips} />
      </LeadSelectionProvider>
    </LeadDetailProvider>
  );
}
