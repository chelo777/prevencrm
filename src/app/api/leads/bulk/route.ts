// ============================================================
// POST /api/leads/bulk — aplicar una etapa o etiquetas a muchos leads.
//
// Dos formas de decir sobre QUÉ operar:
//   { leadIds: [...] }  selección individual (tope MAX_IDS).
//   { filter: {...} }   "seleccionar todos los que coinciden" — se manda el
//                       filtro, no 1057 ids en el body.
//
// CONTROL DE ACCESO (el requisito central de esta función): un asesor solo
// puede mover SUS leads. Se aplica en tres capas, a propósito:
//   1. `scopeFilterToRole` fuerza assigned_agent_id = él antes de tocar la
//      base, sin importar qué pida el body.
//   2. La resolución de ids parte de esa consulta ya acotada, así que un
//      `leadIds` con leads ajenos se queda por el camino.
//   3. La RLS (037) es el muro final: aunque las dos anteriores fallaran,
//      el UPDATE no toca un deal que no tenga asignado.
// Se responde cuántas filas se modificaron REALMENTE, no cuántas se pidieron.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
  applyLeadFilter,
  parseLeadFilter,
  scopeFilterToRole,
} from "@/lib/leads/lead-filter";

export const runtime = "nodejs";

/** Tope por request. Más que esto se parte en tandas desde el cliente. */
const MAX_IDS = 500;

interface BulkBody {
  action?: unknown;
  stageId?: unknown;
  addTagIds?: unknown;
  removeTagIds?: unknown;
  leadIds?: unknown;
  filter?: unknown;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRole("agent");

    const limit = checkRateLimit(`leads:bulk:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await req.json().catch(() => null)) as BulkBody | null;
    const action = body?.action;
    if (action !== "stage" && action !== "tags") {
      return NextResponse.json(
        { error: "action debe ser stage o tags" },
        { status: 400 },
      );
    }

    // ── 1. Resolver el conjunto de leads, YA acotado por rol ──
    const rawFilter =
      body?.filter && typeof body.filter === "object"
        ? (body.filter as Record<string, string | string[] | undefined>)
        : null;
    const explicitIds = asStringArray(body?.leadIds);

    if (!rawFilter && explicitIds.length === 0) {
      return NextResponse.json(
        { error: "Hay que indicar leadIds o filter" },
        { status: 400 },
      );
    }
    if (explicitIds.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_IDS} leads por vez` },
        { status: 400 },
      );
    }

    const filter = scopeFilterToRole(
      parseLeadFilter(rawFilter ?? {}),
      ctx.role,
      ctx.userId,
    );

    // Duplicados: sólo lo usa admin (scopeFilterToRole ya se lo saca a un
    // agent), y resolverlo pide un barrido aparte. Si no está pedido, null.
    let dupContactIds: Set<string> | null = null;
    if (filter.onlyDuplicates) {
      const { data } = await ctx.supabase
        .from("leads")
        .select("contact_id, contact:contacts(phone_normalized)")
        .eq("account_id", ctx.accountId);
      const byPhone = new Map<string, string[]>();
      for (const r of (data ?? []) as unknown as {
        contact_id: string | null;
        contact: { phone_normalized: string | null } | null;
      }[]) {
        const phone = r.contact?.phone_normalized;
        if (!phone || !r.contact_id) continue;
        const list = byPhone.get(phone);
        if (list) list.push(r.contact_id);
        else byPhone.set(phone, [r.contact_id]);
      }
      dupContactIds = new Set(
        [...byPhone.values()].filter((ids) => ids.length > 1).flat(),
      );
    }

    const needInnerDeal = Boolean(filter.stageId || filter.assignedTo);
    const contactEmbed = filter.tagId
      ? "contact:contacts!inner(id, tag_filter:contact_tags!inner(tag_id))"
      : "contact:contacts(id)";
    const dealEmbed = needInnerDeal
      ? "deal:deals!inner(id, stage_id, assigned_agent_id)"
      : "deal:deals(id, stage_id, assigned_agent_id)";

    let query = ctx.supabase
      .from("leads")
      .select(`id, contact_id, ${contactEmbed}, ${dealEmbed}`)
      .eq("account_id", ctx.accountId);
    query = applyLeadFilter(query, filter, dupContactIds);
    // La selección individual ACOTA el conjunto del filtro; nunca lo amplía.
    if (explicitIds.length > 0) query = query.in("id", explicitIds);

    const { data: leads, error: qErr } = await query.limit(MAX_IDS);
    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });

    const rows = (leads ?? []) as unknown as {
      id: string;
      contact_id: string | null;
      deal: { id: string } | null;
    }[];
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, affected: 0 });
    }

    // ── 2. Aplicar ──
    let affected = 0;

    if (action === "stage") {
      const stageId = body?.stageId;
      if (typeof stageId !== "string" || !stageId) {
        return NextResponse.json({ error: "stageId es requerido" }, { status: 400 });
      }
      const dealIds = rows
        .map((r) => r.deal?.id)
        .filter((id): id is string => Boolean(id));
      if (dealIds.length === 0) return NextResponse.json({ ok: true, affected: 0 });

      const { data: updated, error } = await ctx.supabase
        .from("deals")
        .update({ stage_id: stageId })
        .in("id", dealIds)
        .eq("account_id", ctx.accountId)
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      affected = (updated ?? []).length;

      await ctx.supabase
        .from("activity_log")
        .insert(
          (updated ?? []).map((d) => ({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            deal_id: d.id as string,
            action: "stage_change",
            meta: { stage_id: stageId, source: "bulk" },
          })),
        )
        .then(
          () => {},
          () => {},
        );
    } else {
      const addTagIds = asStringArray(body?.addTagIds);
      const removeTagIds = asStringArray(body?.removeTagIds);
      if (addTagIds.length === 0 && removeTagIds.length === 0) {
        return NextResponse.json(
          { error: "Indicá al menos una etiqueta para agregar o quitar" },
          { status: 400 },
        );
      }
      const contactIds = [
        ...new Set(
          rows.map((r) => r.contact_id).filter((id): id is string => Boolean(id)),
        ),
      ];
      if (contactIds.length === 0) return NextResponse.json({ ok: true, affected: 0 });

      if (addTagIds.length > 0) {
        // ignoreDuplicates: reaplicar una etiqueta que ya estaba no es error.
        const { error } = await ctx.supabase.from("contact_tags").upsert(
          contactIds.flatMap((contactId) =>
            addTagIds.map((tagId) => ({ contact_id: contactId, tag_id: tagId })),
          ),
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
        );
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (removeTagIds.length > 0) {
        const { error } = await ctx.supabase
          .from("contact_tags")
          .delete()
          .in("contact_id", contactIds)
          .in("tag_id", removeTagIds);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      }
      affected = contactIds.length;

      await ctx.supabase
        .from("activity_log")
        .insert(
          contactIds.map((contactId) => ({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            action: addTagIds.length > 0 ? "tag_added" : "tag_removed",
            meta: {
              contact_id: contactId,
              tag_ids: addTagIds.length > 0 ? addTagIds : removeTagIds,
              source: "bulk",
            },
          })),
        )
        .then(
          () => {},
          () => {},
        );
    }

    return NextResponse.json({ ok: true, affected });
  } catch (err) {
    return toErrorResponse(err);
  }
}
