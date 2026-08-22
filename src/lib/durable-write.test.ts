import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox, OUTBOX_KEY, type OutboxDeps } from "./durable-write";

// Storage in-memory que imita localStorage (el test corre en node).
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const ok = () => new Response(null, { status: 200 });
const forbidden = () => new Response(null, { status: 403 });
const serverError = () => new Response(null, { status: 500 });

function deps(over: Partial<OutboxDeps> = {}): OutboxDeps & {
  storage: ReturnType<typeof fakeStorage>;
} {
  const storage = fakeStorage();
  return {
    storage,
    send: vi.fn(async () => ok()),
    onError: vi.fn(),
    ...over,
  } as OutboxDeps & { storage: ReturnType<typeof fakeStorage> };
}

function pending(storage: { getItem: (k: string) => string | null }) {
  return JSON.parse(storage.getItem(OUTBOX_KEY) ?? "[]") as unknown[];
}

describe("outbox de escrituras durables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no deja nada pendiente cuando el envío sale bien", async () => {
    const d = deps();
    const box = createOutbox(d);

    const res = await box.write({ id: "stage:d1", url: "/api/leads/stage", body: { a: 1 } });

    expect(res.ok).toBe(true);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(pending(d.storage)).toHaveLength(0);
  });

  it("encola la escritura cuando la red falla (pestaña en segundo plano)", async () => {
    // Este es el caso real: el asesor etiqueta y se va a WhatsApp; el
    // request se aborta. La escritura NO puede evaporarse.
    const d = deps({
      send: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    const box = createOutbox(d);

    const res = await box.write({ id: "tag:c1:t1", url: "/api/leads/tags", body: { x: 1 } });

    expect(res.ok).toBe(false);
    expect(res.queued).toBe(true);
    expect(pending(d.storage)).toHaveLength(1);
  });

  it("flush reintenta lo pendiente y lo saca de la cola al lograrlo", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok());
    const d = deps({ send });
    const box = createOutbox(d);

    await box.write({ id: "stage:d1", url: "/api/leads/stage", body: { s: "A" } });
    expect(pending(d.storage)).toHaveLength(1);

    await box.flush();

    expect(send).toHaveBeenCalledTimes(2);
    expect(pending(d.storage)).toHaveLength(0);
  });

  it("colapsa por id: el último cambio del mismo deal pisa al anterior", async () => {
    // Sin esto, reintentar la cola reaplicaría una etapa vieja encima de la
    // nueva y el lead "volvería" solo.
    const d = deps({
      send: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    const box = createOutbox(d);

    await box.write({ id: "stage:d1", url: "/api/leads/stage", body: { stageId: "A" } });
    await box.write({ id: "stage:d1", url: "/api/leads/stage", body: { stageId: "B" } });

    const q = pending(d.storage) as Array<{ body: { stageId: string } }>;
    expect(q).toHaveLength(1);
    expect(q[0].body.stageId).toBe("B");
  });

  it("reintenta ante 5xx pero descarta ante 403 (rechazo permanente)", async () => {
    const d403 = deps({ send: vi.fn(async () => forbidden()) });
    const box403 = createOutbox(d403);
    const r = await box403.write({ id: "tag:c1:t1", url: "/u", body: {} });
    expect(r.ok).toBe(false);
    expect(r.queued).toBe(false); // sin permiso: reintentar no arregla nada
    expect(pending(d403.storage)).toHaveLength(0);
    expect(d403.onError).toHaveBeenCalled();

    const d500 = deps({ send: vi.fn(async () => serverError()) });
    const box500 = createOutbox(d500);
    await box500.write({ id: "tag:c1:t1", url: "/u", body: {} });
    expect(pending(d500.storage)).toHaveLength(1); // 5xx sí se reintenta
  });

  it("descarta y avisa tras agotar los reintentos", async () => {
    const d = deps({
      send: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    const box = createOutbox(d);

    await box.write({ id: "tag:c1:t1", url: "/u", body: {} });
    for (let i = 0; i < 10; i++) await box.flush();

    expect(pending(d.storage)).toHaveLength(0);
    expect(d.onError).toHaveBeenCalled();
  });

  it("la cola sobrevive a recargar la página (se lee del storage)", async () => {
    const failing = deps({
      send: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    await createOutbox(failing).write({ id: "stage:d1", url: "/api/leads/stage", body: { s: 1 } });

    // Nueva instancia (recarga) sobre el MISMO storage, ahora con red.
    const send = vi.fn(async () => ok());
    const revived = createOutbox({ ...failing, send });
    await revived.flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(pending(failing.storage)).toHaveLength(0);
  });

  it("no se rompe si el storage tiene basura", async () => {
    const storage = fakeStorage({ [OUTBOX_KEY]: "no-es-json" });
    const send = vi.fn(async () => ok());
    const box = createOutbox({ storage, send, onError: vi.fn() });

    await expect(box.flush()).resolves.not.toThrow();
    const res = await box.write({ id: "a", url: "/u", body: {} });
    expect(res.ok).toBe(true);
  });
});
