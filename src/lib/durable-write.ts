// Escrituras durables desde el celular ("outbox").
//
// El problema real que resuelve: el asesor cambia la etapa o pone una etiqueta
// y acto seguido toca WhatsApp. wa.me abre la app, la pestaña pasa a segundo
// plano y el SO la suspende. Un fetch normal se aborta antes de llegar a la
// base y el cambio se pierde EN SILENCIO ("volvió a Nuevo", "no me quedó la
// etiqueta"). `keepalive` cubre el caso de la pestaña que se descarga, pero no
// cubre quedarse sin señal: ahí el request muere y nadie lo reintenta, y el
// toast de error aparece en una pestaña que el asesor ya dejó atrás.
//
// Este módulo agrega la pieza que faltaba: si el envío no llega, la escritura
// queda PERSISTIDA en localStorage y se reintenta sola al recuperar conexión o
// al volver a la app. Sobrevive incluso a recargar la página.
//
// Reglas de diseño, todas cubiertas por durable-write.test.ts:
//   - Colapso por `id`: dos cambios del mismo deal dejan solo el último. Sin
//     esto, la cola reaplicaría una etapa vieja encima de la nueva.
//   - 4xx (salvo 408/429) = rechazo permanente (sin permiso, lead ajeno):
//     reintentar no arregla nada → se descarta y se avisa.
//   - 5xx / falla de red = transitorio → se reintenta.
//   - Tope de intentos: se descarta y se avisa, en vez de reintentar para
//     siempre.

export const OUTBOX_KEY = "prevencrm.outbox.v1";
export const MAX_ATTEMPTS = 6;

export interface OutboxItem {
  /** Clave de colapso: "stage:<dealId>" | "tag:<contactId>:<tagId>". */
  id: string;
  url: string;
  body: unknown;
  attempts: number;
  queuedAt: number;
}

export interface OutboxDeps {
  storage: Pick<Storage, "getItem" | "setItem">;
  send: (url: string, body: unknown) => Promise<Response>;
  /** Se llama cuando la escritura se pierde definitivamente. */
  onError: (item: OutboxItem, reason: "rejected" | "exhausted") => void;
}

export interface WriteResult {
  ok: boolean;
  /** true = no llegó, pero quedó en la cola y se va a reintentar. */
  queued: boolean;
}

function readQueue(deps: OutboxDeps): OutboxItem[] {
  try {
    const raw = deps.storage.getItem(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    // Storage corrupto o deshabilitado: arrancamos limpio en vez de romper la UI.
    return [];
  }
}

function writeQueue(deps: OutboxDeps, items: OutboxItem[]): void {
  try {
    deps.storage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // Modo privado / cuota llena: perder la cola es mejor que romper la acción.
  }
}

/** Un 4xx que no sea 408/429 no mejora reintentando. */
function isPermanentReject(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function createOutbox(deps: OutboxDeps) {
  /**
   * Intenta enviar. Devuelve `null` si llegó bien; si no, el motivo.
   */
  async function attempt(
    item: OutboxItem,
  ): Promise<null | { permanent: boolean }> {
    try {
      const res = await deps.send(item.url, item.body);
      if (res.ok) return null;
      return { permanent: isPermanentReject(res.status) };
    } catch {
      // Falla de red / pestaña suspendida: transitorio por definición.
      return { permanent: false };
    }
  }

  function enqueue(item: OutboxItem): void {
    const q = readQueue(deps).filter((i) => i.id !== item.id); // colapso por id
    q.push(item);
    writeQueue(deps, q);
  }

  function dequeue(id: string): void {
    writeQueue(
      deps,
      readQueue(deps).filter((i) => i.id !== id),
    );
  }

  return {
    /**
     * Escribe ahora; si no llega, deja el pedido en la cola para reintentarlo.
     */
    async write(req: {
      id: string;
      url: string;
      body: unknown;
    }): Promise<WriteResult> {
      const item: OutboxItem = { ...req, attempts: 1, queuedAt: Date.now() };

      const failure = await attempt(item);
      if (!failure) {
        // Un envío exitoso invalida cualquier pendiente del mismo id.
        dequeue(item.id);
        return { ok: true, queued: false };
      }
      if (failure.permanent) {
        dequeue(item.id);
        deps.onError(item, "rejected");
        return { ok: false, queued: false };
      }
      enqueue(item);
      return { ok: false, queued: true };
    },

    /** Reintenta todo lo pendiente. Se llama al volver la conexión / la app. */
    async flush(): Promise<void> {
      const q = readQueue(deps);
      if (q.length === 0) return;

      for (const item of q) {
        const next: OutboxItem = { ...item, attempts: item.attempts + 1 };
        const failure = await attempt(next);

        if (!failure) {
          dequeue(item.id);
          continue;
        }
        if (failure.permanent) {
          dequeue(item.id);
          deps.onError(next, "rejected");
          continue;
        }
        if (next.attempts >= MAX_ATTEMPTS) {
          dequeue(item.id);
          deps.onError(next, "exhausted");
          continue;
        }
        // Sigue pendiente: guardamos el contador de intentos actualizado. Ojo
        // con no resucitar un id que otra escritura ya colapsó mientras tanto.
        const current = readQueue(deps);
        const idx = current.findIndex((i) => i.id === item.id);
        if (idx >= 0 && current[idx].queuedAt === item.queuedAt) {
          current[idx] = next;
          writeQueue(deps, current);
        }
      }
    },

    /** Cuántas escrituras esperan reintento (para avisar en la UI). */
    size(): number {
      return readQueue(deps).length;
    },
  };
}
