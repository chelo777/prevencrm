import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

/**
 * Registra la traza de un click-to-chat de WhatsApp (B11): agrega una
 * nota "Contactado por WhatsApp" al contacto del lead. Best-effort —
 * la apertura del chat en el cliente no depende de esta respuesta.
 *
 * Body: { leadId }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const { leadId } = (await request.json()) as { leadId?: string };
    if (!leadId) {
      return NextResponse.json({ error: "leadId requerido" }, { status: 400 });
    }

    const { data: lead } = await ctx.supabase
      .from("leads")
      .select("id, contact_id")
      .eq("id", leadId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!lead?.contact_id) {
      return NextResponse.json({ ok: false, reason: "lead sin contacto" });
    }

    const { data: me } = await ctx.supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const who = me?.full_name || "Un asesor";

    await ctx.supabase.from("contact_notes").insert({
      account_id: ctx.accountId,
      contact_id: lead.contact_id,
      user_id: ctx.userId,
      note_text: `${who} abrió WhatsApp para contactar este lead.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
