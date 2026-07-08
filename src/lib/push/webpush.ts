import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

// Envío de Web Push con VAPID. Claves SOLO en env (nunca en DB):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  — par generado una vez
//   VAPID_SUBJECT                          — mailto: de contacto (opcional)
// Si faltan las claves, todo es no-op silencioso: la app funciona
// igual sin push.

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

let vapidReady = false;
function ensureConfigured(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:admin@prevencion-salud.com",
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    vapidReady = true;
  }
  return true;
}

/**
 * Envía el payload a TODOS los dispositivos suscriptos de los usuarios
 * dados. Suscripciones muertas (404/410 del push service) se borran en
 * el momento — el próximo envío ya no las intenta.
 */
export async function sendPushToUsers(
  admin: SupabaseClient,
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; removed: number; failed: number }> {
  const result = { sent: 0, removed: 0, failed: 0 };
  if (userIds.length === 0 || !ensureConfigured()) return result;

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  const body = JSON.stringify(payload);
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
        },
        body,
        { TTL: 3600 },
      );
      result.sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
        result.removed++;
      } else {
        result.failed++;
        console.error("[push] fallo de envío:", status ?? err);
      }
    }
  }
  return result;
}
