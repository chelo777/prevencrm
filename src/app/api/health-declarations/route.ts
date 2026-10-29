import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  generateDeclarationToken,
  hashDeclarationToken,
} from "@/lib/health-declarations/token";

export const dynamic = "force-dynamic";

/**
 * Crea el enlace de declaración de salud para un contacto. Devuelve el
 * token en claro (única vez que existe fuera del navegador del
 * prospecto); el cliente arma `${origin}/ds/<token>` y lo manda por
 * WhatsApp.
 *
 * El prospecto vuelve al WhatsApp de quien creó el enlace, así que sin
 * `profiles.whatsapp_phone` cargado no se puede crear (409).
 *
 * Body: { contactId }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const { contactId } = (await request.json()) as { contactId?: string };
    if (!contactId) {
      return NextResponse.json({ error: "contactId requerido" }, { status: 400 });
    }

    // Con el cliente del usuario: si la RLS no le deja ver el contacto,
    // tampoco puede mandarle una declaración.
    const { data: contact } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!contact) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    const { data: me } = await ctx.supabase
      .from("profiles")
      .select("whatsapp_phone")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const advisorPhone = (me?.whatsapp_phone as string | null)?.replace(/\D/g, "");
    if (!advisorPhone) {
      return NextResponse.json(
        {
          error:
            "Cargá tu WhatsApp en Ajustes → Tu perfil: ahí te llega la declaración respondida.",
          code: "missing_whatsapp",
        },
        { status: 409 },
      );
    }

    const { data: lead } = await ctx.supabase
      .from("leads")
      .select("id, deal_id")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const token = generateDeclarationToken();
    const { data: created, error } = await ctx.supabase
      .from("health_declarations")
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        lead_id: lead?.id ?? null,
        created_by: ctx.userId,
        advisor_phone: advisorPhone,
        token_hash: hashDeclarationToken(token),
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[POST /api/health-declarations] insert:", error);
      return NextResponse.json(
        { error: "No se pudo crear el enlace" },
        { status: 500 },
      );
    }

    await ctx.supabase.from("activity_log").insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      deal_id: lead?.deal_id ?? null,
      lead_id: lead?.id ?? null,
      action: "health_declaration_sent",
      meta: { contact_id: contactId, declaration_id: created.id },
    });

    return NextResponse.json({ ok: true, token, leadId: lead?.id ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
