"use client";

import { toast } from "sonner";
import { createOutbox, type OutboxItem } from "./durable-write";

// Instancia de navegador del outbox (ver durable-write.ts para el porqué).
//
// Acá viven las tres piezas que dependen del entorno:
//   1. `keepalive` — el request sobrevive a que la pestaña se descargue
//      (el asesor toca WhatsApp y wa.me se lleva el foco).
//   2. Reintento automático — al volver la conexión (`online`) o al volver a
//      la app (`visibilitychange`), que es cuando el celular vuelve de fondo.
//   3. Avisos — un error que nadie ve es igual a no tener error. Y si la
//      escritura quedó en cola, se lo decimos: "queda pendiente", no "falló".

function labelFor(item: OutboxItem): string {
  if (item.id.startsWith("stage:")) return "el cambio de etapa";
  if (item.id.startsWith("tag:")) return "la etiqueta";
  return "el cambio";
}

let instance: ReturnType<typeof createOutbox> | null = null;
let listenersReady = false;

/** Storage que no explota si el navegador lo tiene deshabilitado. */
const safeStorage: Pick<Storage, "getItem" | "setItem"> = {
  getItem: (k) => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(k, v);
    } catch {
      /* modo privado / cuota: seguimos sin persistir */
    }
  },
};

export function getOutbox() {
  if (instance) return instance;

  instance = createOutbox({
    storage: safeStorage,
    send: (url, body) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }),
    onError: (item, reason) => {
      toast.error(
        reason === "rejected"
          ? `No se pudo guardar ${labelFor(item)}`
          : `No se pudo guardar ${labelFor(item)} tras varios intentos`,
        {
          description:
            reason === "rejected"
              ? "Puede que el lead ya no esté asignado a vos. Refrescá y probá de nuevo."
              : "Revisá la conexión y volvé a intentarlo.",
        },
      );
    },
  });

  if (typeof window !== "undefined" && !listenersReady) {
    listenersReady = true;
    const flush = () => void instance?.flush();
    // Vuelve la señal.
    window.addEventListener("online", flush);
    // Vuelve a la app desde WhatsApp: el momento exacto en que antes se perdía.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") flush();
    });
    // Y una pasada al cargar, por lo que haya quedado de la sesión anterior.
    flush();
  }

  return instance;
}

/**
 * Guarda un cambio de forma durable.
 *
 * El resultado tiene TRES estados, y quien llama los necesita distintos:
 *   ok:true                  → ya está en la base.
 *   ok:false, queued:true    → no llegó pero se va a reintentar solo: hay que
 *                              DEJAR el cambio optimista en pantalla.
 *   ok:false, queued:false   → rechazado (sin permiso): hay que REVERTIR.
 * El aviso al usuario ya se emitió en los dos casos de falla.
 */
export async function durablePost(req: {
  id: string;
  url: string;
  body: unknown;
  /** Aviso cuando quedó encolado (sin red). Por defecto avisa. */
  quiet?: boolean;
}): Promise<{ ok: boolean; queued: boolean }> {
  const res = await getOutbox().write(req);

  if (!res.ok && res.queued && !req.quiet) {
    toast.warning("Sin conexión: el cambio queda pendiente", {
      description: "Se guarda solo cuando vuelva la señal. No cierres sesión.",
    });
  }
  return res;
}
