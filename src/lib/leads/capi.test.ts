import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IN_CHUNK,
  buildEventPayload,
  buildUserData,
  reconcileAllCapi,
  reconcileCapiForAccount,
} from "./capi";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

const base = {
  datasetId: "d",
  accessToken: "t",
  eventName: "calificado",
  eventId: "l1:calificado",
  eventTimeSec: 1,
  userData: {},
  leadId: "l:5",
};

describe("buildEventPayload — VBO", () => {
  it("manda custom_data.value con capitas", () => {
    expect(buildEventPayload({ ...base, value: 4 }).data[0].custom_data).toEqual({
      value: 4,
      currency: "ARS",
    });
  });

  it("SIN custom_data si value es null (nunca sella value=1)", () => {
    expect(
      buildEventPayload({ ...base, value: null }).data[0].custom_data,
    ).toBeUndefined();
  });
});

describe("buildUserData — matching de Meta", () => {
  it("hashea external_id, ciudad (sin acento) y CP", () => {
    const data = buildUserData({
      email: null,
      phone: null,
      name: null,
      externalId: "ABC-123",
      city: "Villa María",
      zip: " 5900 ",
    });
    expect(data.external_id).toEqual([sha256("abc-123")]);
    expect(data.ct).toEqual([sha256("villamaria")]); // sin acento ni espacios
    expect(data.zp).toEqual([sha256("5900")]); // trim
  });

  it("omite ciudad/CP/external_id vacíos o ausentes", () => {
    const data = buildUserData({
      email: null,
      phone: null,
      name: null,
      city: "   ",
      zip: "",
    });
    expect(data.ct).toBeUndefined();
    expect(data.zp).toBeUndefined();
    expect(data.external_id).toBeUndefined();
  });

  it("sigue mandando teléfono en E.164 hasheado", () => {
    const data = buildUserData({ email: null, phone: "p:+5493416590100", name: null });
    expect(data.ph).toEqual([sha256("5493416590100")]);
  });
});

// ------------------------------------------------------------
// Reconciliación: cliente Supabase falso que reproduce los dos límites
// reales que frenaron el evento "calificado" (2026-09-21):
//   · un `in` con más de ~430 UUIDs no entra en la URL → la lectura falla
//     y supabase-js devuelve `error` (no lanza);
//   · sin `range`, PostgREST corta la respuesta en 1000 filas.
// ------------------------------------------------------------
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Result = { data: Row[] | null; error: { message: string } | null };

const URL_LIMIT_IDS = 430;
const MAX_ROWS = 1000;

function fakeAdmin(
  tables: Tables,
  failOn?: (table: string, eqs: Record<string, unknown>) => boolean,
) {
  const inSizes: number[] = [];

  class Query {
    private eqs: Record<string, unknown> = {};
    private ins: [string, unknown[]][] = [];
    private orderBy: string | null = null;
    private window: [number, number] | null = null;
    private mode: "select" | "insert" | "update" = "select";
    private payload: Row = {};

    constructor(private table: string) {}

    select() {
      return this;
    }
    insert(row: Row) {
      this.mode = "insert";
      this.payload = row;
      return this;
    }
    update(patch: Row) {
      this.mode = "update";
      this.payload = patch;
      return this;
    }
    eq(col: string, value: unknown) {
      this.eqs[col] = value;
      return this;
    }
    in(col: string, values: unknown[]) {
      inSizes.push(values.length);
      this.ins.push([col, values]);
      return this;
    }
    order(col: string) {
      this.orderBy = col;
      return this;
    }
    range(from: number, to: number) {
      this.window = [from, to];
      return this;
    }
    maybeSingle() {
      const r = this.run();
      return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
    }
    then<T>(onOk: (r: Result) => T, onErr?: (e: unknown) => T) {
      return Promise.resolve(this.run()).then(onOk, onErr);
    }

    private matches(r: Row) {
      return (
        Object.entries(this.eqs).every(([c, v]) => r[c] === v) &&
        this.ins.every(([c, vs]) => vs.includes(r[c]))
      );
    }

    private run(): Result {
      const rows = (tables[this.table] ??= []);
      if (this.mode === "insert") {
        const dup =
          this.table === "lead_capi_events" &&
          rows.some(
            (r) =>
              r.lead_id === this.payload.lead_id &&
              r.event_name === this.payload.event_name,
          );
        if (dup) return { data: null, error: { message: "duplicate key" } };
        rows.push({ ...this.payload });
        return { data: null, error: null };
      }
      if (this.mode === "update") {
        for (const r of rows) if (this.matches(r)) Object.assign(r, this.payload);
        return { data: null, error: null };
      }
      if (
        failOn?.(this.table, this.eqs) ||
        this.ins.some(([, vs]) => vs.length > URL_LIMIT_IDS)
      ) {
        return { data: null, error: { message: "TypeError: fetch failed" } };
      }
      let out = rows.filter((r) => this.matches(r));
      const col = this.orderBy;
      if (col) out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      const [from, to] = this.window ?? [0, MAX_ROWS - 1];
      return { data: out.slice(from, to + 1), error: null };
    }
  }

  const admin = { from: (table: string) => new Query(table) } as unknown as SupabaseClient;
  return { admin, inSizes };
}

/** `n` deals en "Calificado", cada uno con su lead; los primeros `sent` ya
 *  tienen el evento enviado. */
function seed(n: number, sent = 0, account = "acc"): Tables {
  const id = (kind: string, i: number) => `${account}-${kind}-${String(i).padStart(5, "0")}`;
  const idx = (count: number) => Array.from({ length: count }, (_, i) => i);
  return {
    pipelines: [{ id: `${account}-p`, account_id: account }],
    pipeline_stages: [{ id: `${account}-s`, pipeline_id: `${account}-p`, name: "Calificado" }],
    custom_fields: [],
    deals: idx(n).map((i) => ({
      id: id("d", i),
      account_id: account,
      stage_id: `${account}-s`,
      capitas: null,
    })),
    leads: idx(n).map((i) => ({
      id: id("l", i),
      account_id: account,
      deal_id: id("d", i),
      contact_id: null,
      meta_lead_id: `l:${1000 + i}`,
    })),
    lead_capi_events: idx(sent).map((i) => ({
      lead_id: id("l", i),
      event_name: "calificado",
      status: "sent",
    })),
  };
}

const configFor = (account = "acc") => ({
  account_id: account,
  dataset_id: "ds",
  trigger_stage_name: "Calificado",
  event_name: "calificado",
  active: true,
  send_value: false,
});

describe("reconcileCapiForAccount — volumen", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response('{"events_received":1}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("envía el evento con 469 deals en la etapa (antes: 0 enviados, sin error)", async () => {
    const tables = seed(469);
    const { admin, inSizes } = fakeAdmin(tables);

    const totals = await reconcileCapiForAccount(admin, configFor(), "token");

    expect(totals).toMatchObject({ candidates: 469, sent: 469, failed: 0, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(469);
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(IN_CHUNK);
    expect(tables.lead_capi_events.filter((e) => e.status === "sent")).toHaveLength(469);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.data[0].event_name).toBe("calificado");
    expect(body.data[0].user_data.lead_id).toBe(1000);
  });

  it("no reenvía lo ya enviado aunque los leads superen un lote", async () => {
    const { admin } = fakeAdmin(seed(450, 440));

    const totals = await reconcileCapiForAccount(admin, configFor(), "token");

    expect(totals).toMatchObject({ candidates: 10, sent: 10, skipped: 440 });
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("pagina los deals: los que pasan la fila 1000 también reciben su evento", async () => {
    const { admin } = fakeAdmin(seed(1203, 1200));

    const totals = await reconcileCapiForAccount(admin, configFor(), "token");

    expect(totals).toMatchObject({ sent: 3, skipped: 1200 });
  });

  it("una lectura fallida lanza en vez de pasar por 'no hay nada que enviar'", async () => {
    const { admin } = fakeAdmin(seed(5), (table) => table === "leads");

    await expect(reconcileCapiForAccount(admin, configFor(), "token")).rejects.toThrow(
      /leads de los deals/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si falla la lectura de eventos ya registrados no envía nada", async () => {
    const { admin } = fakeAdmin(seed(5, 2), (table) => table === "lead_capi_events");

    await expect(reconcileCapiForAccount(admin, configFor(), "token")).rejects.toThrow(
      /eventos ya registrados/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reconcileAllCapi: un evento que falla no frena a los demás y queda contado", async () => {
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "token");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = seed(4, 0, "a1");
    const b = seed(5, 0, "a2");
    const tables: Tables = { lead_capi_config: [configFor("a1"), configFor("a2")] };
    for (const [name, rows] of [...Object.entries(a), ...Object.entries(b)]) {
      (tables[name] ??= []).push(...rows);
    }
    const { admin } = fakeAdmin(
      tables,
      (table, eqs) => table === "leads" && eqs.account_id === "a1",
    );

    const totals = await reconcileAllCapi(admin);

    expect(totals).toMatchObject({ sent: 5, errors: 1 });
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
