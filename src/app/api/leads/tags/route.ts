import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export const runtime = "nodejs";

// Asignar / quitar una etiqueta de un contacto.
//
// Por qué un endpoint y no el update directo del cliente (el bug que arregla):
// `toggleTag` escribía con supabase-js desde el navegador, sin `keepalive` y
// tragándose el error (`if (!error)` sin rama else). En el celular el asesor
// etiqueta y enseguida toca WhatsApp → la pestaña pasa a segundo plano → el
// request se aborta antes de llegar a la base. Resultado: la etiqueta no se
// guardaba y NADIE se enteraba — ni el asesor (sin aviso) ni nosotros (las
// etiquetas no dejaban traza). Es el mismo modo de falla que ya se corrigió
// para las etapas en /api/leads/stage; acá se cierra para las etiquetas.
//
// Es IDEMPOTENTE a propósito: la cola de reintentos (lib/durable-write.ts)
// puede reenviar el mismo pedido, y agregar dos veces la misma etiqueta debe
// dar 200, no el 23505 de UNIQUE(contact_id, tag_id).

export async function POST(req: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await req.json().catch(() => null)) as {
      contactId?: unknown;
      tagId?: unknown;
      action?: unknown;
      dealId?: unknown;
    } | null;

    const contactId = body?.contactId;
    const tagId = body?.tagId;
    const action = body?.action;
    const dealId = typeof body?.dealId === "string" ? body.dealId : null;

    if (
      typeof contactId !== "string" ||
      typeof tagId !== "string" ||
      (action !== "add" && action !== "remove")
    ) {
      return NextResponse.json(
        { error: "contactId, tagId y action ('add'|'remove') son requeridos" },
        { status: 400 },
      );
    }

    // Puerta de permiso explícita. `contact_tags` hereda la RLS de `contacts`
    // (un agente solo ve los contactos con un deal/conversación suyo), pero un
    // INSERT rechazado y un INSERT que no cambia nada se parecen demasiado
    // desde el cliente. Resolviendo el permiso acá, el 403 es inequívoco y la
    // cola de reintentos sabe que NO tiene sentido reintentar.
    const { data: contact, error: contactErr } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (contactErr) {
      return NextResponse.json({ error: contactErr.message }, { status: 400 });
    }
    if (!contact) {
      return NextResponse.json(
        { error: "Lead sin permiso o inexistente" },
        { status: 403 },
      );
    }

    if (action === "add") {
      // ignoreDuplicates: reenviar el mismo pedido no puede fallar.
      const { error } = await ctx.supabase
        .from("contact_tags")
        .upsert(
          { contact_id: contactId, tag_id: tagId },
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
        );
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      // Post-condición: confirmamos contra la base que la fila QUEDÓ. Sin esto
      // volveríamos al modo de falla original — creer que se guardó sin haberlo
      // verificado nunca.
      const { data: check } = await ctx.supabase
        .from("contact_tags")
        .select("tag_id")
        .eq("contact_id", contactId)
        .eq("tag_id", tagId)
        .maybeSingle();

      if (!check) {
        return NextResponse.json(
          { error: "No se pudo asignar la etiqueta" },
          { status: 403 },
        );
      }
    } else {
      const { error } = await ctx.supabase
        .from("contact_tags")
        .delete()
        .eq("contact_id", contactId)
        .eq("tag_id", tagId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      // 0 filas borradas es un resultado válido: el reintento de un borrado que
      // ya se aplicó. El estado final es el pedido, que es lo que importa.
    }

    // Traza para forense — best effort, no bloquea la respuesta. Es lo que hoy
    // faltaba para poder MEDIR este bug en vez de depender del reporte verbal.
    await ctx.supabase
      .from("activity_log")
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        deal_id: dealId,
        action: action === "add" ? "tag_added" : "tag_removed",
        meta: { contact_id: contactId, tag_id: tagId },
      })
      .then(
        () => {},
        () => {},
      );

    return NextResponse.json({ ok: true, action, tag_id: tagId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
