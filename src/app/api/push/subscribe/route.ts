import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { getVapidPublicKey } from "@/lib/push/webpush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suscripciones Web Push del dispositivo. El navegador genera la
// suscripción con la clave pública VAPID (GET) y acá se persiste
// (POST) o se da de baja (DELETE) bajo RLS del usuario.

export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}

export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await req.json().catch(() => null)) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    } | null;
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
    const p256dh =
      typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "suscripción inválida" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.from("push_subscriptions").upsert(
      {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        endpoint,
        p256dh,
        auth,
        user_agent: req.headers.get("user-agent"),
      },
      { onConflict: "endpoint" },
    );
    if (error) {
      console.error("[push/subscribe] upsert:", error);
      return NextResponse.json(
        { error: "no se pudo guardar la suscripción" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await req.json().catch(() => null)) as {
      endpoint?: unknown;
    } | null;
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
    if (!endpoint) {
      return NextResponse.json({ error: "endpoint requerido" }, { status: 400 });
    }
    await ctx.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
