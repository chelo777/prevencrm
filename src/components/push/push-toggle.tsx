"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Activación de notificaciones push en ESTE dispositivo (Web Push).
// El service worker se registra al montar (idempotente); el permiso
// del navegador se pide recién al tocar el botón (exige user gesture).
// En navegadores sin Push API (p.ej. Safari iOS sin instalar la PWA)
// el botón no se muestra.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type PushState = "loading" | "unsupported" | "denied" | "off" | "on" | "busy";

export function PushToggle() {
  const [state, setState] = useState<PushState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (Notification.permission === "denied") setState("denied");
        else setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setState("busy");
    try {
      const res = await fetch("/api/push/subscribe");
      const { publicKey } = (await res.json()) as { publicKey: string | null };
      if (!publicKey) {
        toast.error(
          "El servidor no tiene configuradas las claves de push (VAPID).",
        );
        setState("off");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const save = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!save.ok) throw new Error("no se pudo guardar la suscripción");
      setState("on");
      toast.success("Notificaciones activadas en este dispositivo");
    } catch (err) {
      console.error("[push] activar:", err);
      toast.error("No se pudieron activar las notificaciones");
      setState("off");
    }
  }, []);

  const disable = useCallback(async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Notificaciones desactivadas en este dispositivo");
    } catch {
      setState("on");
    }
  }, []);

  if (state === "loading" || state === "unsupported") return null;

  if (state === "denied") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        title="Las notificaciones están bloqueadas — habilitalas en la configuración del navegador para este sitio"
      >
        <BellOff className="mr-1.5 h-4 w-4" />
        Notificaciones bloqueadas
      </Button>
    );
  }

  if (state === "busy") {
    return (
      <Button variant="outline" size="sm" disabled>
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        Un momento…
      </Button>
    );
  }

  if (state === "on") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={disable}
        title="Tocá para desactivar las notificaciones en este dispositivo"
      >
        <BellRing className="mr-1.5 h-4 w-4 text-primary" />
        Notificaciones activas
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={enable}>
      <Bell className="mr-1.5 h-4 w-4" />
      Activar notificaciones
    </Button>
  );
}
