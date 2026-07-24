import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export const runtime = "nodejs";

// Cambio de etapa de un deal desde la bandeja de leads.
//
// Por qué un endpoint y no el update directo del cliente: en el celular la
// asesora cambia la etapa y enseguida toca WhatsApp (wa.me abre la app y deja
// la pestaña en segundo plano) o el SO suspende la pestaña. Un update async
// "fire-and-forget" del navegador se ABORTA antes de llegar a la base → el
// cambio se pierde en silencio y el lead "vuelve a Nuevo". El cliente llama a
// esta ruta con `fetch(..., { keepalive: true })`, que SOBREVIVE a que la
// pestaña se descargue, así la escritura llega igual.
//
// Además confirma que el update afectó una fila (RLS: un agente solo puede su
// deal asignado; 0 filas = sin permiso/inexistente → el cliente revierte y
// avisa) y deja traza en activity_log (stage-select no logueaba).

export async function POST(req: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await req.json().catch(() => null)) as
      | { dealId?: unknown; stageId?: unknown; source?: unknown }
      | null;
    const dealId = body?.dealId;
    const stageId = body?.stageId;
    const source = typeof body?.source === "string" ? body.source : "leads_list";
    if (typeof dealId !== "string" || typeof stageId !== "string") {
      return NextResponse.json(
        { error: "dealId y stageId son requeridos" },
        { status: 400 },
      );
    }

    // Update bajo RLS (deals_update: admin, o agent dueño del deal). El
    // .select() nos deja detectar 0 filas — el modo de falla silencioso que
    // el cliente no podía ver.
    const { data, error } = await ctx.supabase
      .from("deals")
      .update({ stage_id: stageId })
      .eq("id", dealId)
      .eq("account_id", ctx.accountId)
      .select("id, stage_id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "No se pudo cambiar la etapa (sin permiso o lead inexistente)" },
        { status: 403 },
      );
    }

    // Traza para forense — best effort, no bloquea la respuesta.
    await ctx.supabase
      .from("activity_log")
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        deal_id: dealId,
        action: "stage_change",
        meta: { stage_id: stageId, source },
      })
      .then(
        () => {},
        () => {},
      );

    return NextResponse.json({ ok: true, stage_id: stageId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
