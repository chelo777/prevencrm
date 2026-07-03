# Wizard de fuentes de Google Sheets + sync de estados — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alta de fuentes de leads con wizard (URL → pestañas → mapeo de columnas con nombres elegidos → mapeo lead_status→etapa) y sincronización continua planilla→CRM de los estados que el comprador marca después de la ingesta.

**Architecture:** Se amplía el contrato `ColumnMapping` (jsonb existente en `lead_sources`) con `ignore` y `statusToStage`; `ingest.ts` gana etapa inicial por estado y una rama de sync para leads ya procesados (regla: la planilla manda mientras el deal siga en la etapa que la propia sync le puso; si un humano lo movió, la planilla pierde el control para siempre). Un endpoint nuevo `preview` alimenta el wizard con pestañas, headers, muestras y sugerencias de la heurística existente.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role en cron), Vitest, Google Sheets API v4 (JWT RS256 con node:crypto, sin deps nuevas).

**Spec:** `docs/superpowers/specs/2026-07-03-wizard-fuentes-sheets-design.md`

## Global Constraints

- TypeScript strict; `npm run typecheck` debe pasar tras cada tarea.
- Tests: `npx vitest run src/lib/leads` (los 15 existentes siguen verdes).
- Sin dependencias npm nuevas.
- Texto de UI en el idioma existente de cada archivo (los archivos de leads ya están en español).
- Claves de `statusToStage`: los valores de `lead_status` tal cual aparecen en la hoja; lookup exacto y fallback case-insensitive.
- `synced_stage_id NULL` = la planilla NO controla el deal (regla de conflicto). La tabla `leads` está vacía en prod, no hay legado que migrar.
- Migraciones: solo `030_lead_source_wizard.sql` nueva, aditiva. No editar migraciones aplicadas.
- Commits frecuentes, mensajes en español, `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Tipos + mapping (ignore, renombres custom, suggestMapping) + util de URL

**Files:**
- Modify: `src/lib/leads/types.ts`
- Modify: `src/lib/leads/mapping.ts`
- Create: `src/lib/leads/sheet-url.ts`
- Test: `src/lib/leads/leads.test.ts` (agregar describes)

**Interfaces:**
- Consumes: `resolveColumns`, `normalizeHeader`, `toLabel` existentes en mapping.ts.
- Produces:
  - `ColumnMapping` con `ignore?: string[]` y `statusToStage?: Record<string, string>`
  - `ColumnSuggestion { index: number; header: string; samples: string[]; kind: "canonical"|"custom"|"ignore"; field?: CanonicalField; label?: string }`
  - `MappingSuggestion { columns: ColumnSuggestion[]; statusValues: string[] }`
  - `suggestMapping(raw: RawSheetData, mapping?: ColumnMapping): MappingSuggestion`
  - `parseSheetUrl(url: string): { spreadsheetId: string | null; gid: string | null }`

- [ ] **Step 1: Escribir los tests que fallan** — agregar al final de `src/lib/leads/leads.test.ts`:

```ts
// ============================================================
// mapping.ts — renombres custom, ignore y suggestMapping (wizard)
// ============================================================
import { suggestMapping } from "./mapping";
import { parseSheetUrl } from "./sheet-url";

describe("ColumnMapping.custom e ignore", () => {
  const raw = {
    headers: ["id", "¿qué_edad_tenés?", "full_name", "phone_number", "Cimentarios", "lead_status"],
    rows: [["l:1", "35", "Ana", "p:+543795586866", "llamar tarde", "calificado"]],
  };

  it("renombra un custom field con el nombre elegido", () => {
    const { mapRow } = createLeadMapper(raw, {
      custom: { "¿qué_edad_tenés?": "Edad" },
    });
    const { lead } = mapRow(raw.rows[0]);
    expect(lead?.customFields["Edad"]).toBe("35");
    expect(lead?.customFields["qué edad tenés"]).toBeUndefined();
  });

  it("ignora columnas listadas en ignore", () => {
    const { mapRow } = createLeadMapper(raw, { ignore: ["cimentarios"] });
    const { lead } = mapRow(raw.rows[0]);
    expect(Object.values(lead?.customFields ?? {})).not.toContain("llamar tarde");
  });

  it("mapea 'Cimentarios' (typo real) a comments vía canonical", () => {
    const { mapRow } = createLeadMapper(raw, {
      canonical: { comments: "Cimentarios" },
    });
    const { lead } = mapRow(raw.rows[0]);
    expect(lead?.comments).toBe("llamar tarde");
  });
});

describe("suggestMapping (wizard)", () => {
  it("sugiere canónicos, customs y devuelve los valores de estado (Hoja 2 real)", () => {
    const raw = {
      headers: ["¡", "created_time", "full_name", "phone_number", "ciudad", "¿qué_edad_tenés?", "lead_status", "id"],
      rows: [
        ["l:1736506344033192", "2026-06-15T23:16:04-05:00", "Flavia", "p:+543795586866", "Corrientes", "40", "calificado", ""],
        ["l:1736506344033193", "2026-06-16T10:00:00-05:00", "Marta", "p:+543624101510", "Chaco", "51", "CREATED", ""],
      ],
    };
    const s = suggestMapping(raw);
    const byHeader = Object.fromEntries(s.columns.map((c) => [c.header, c]));
    expect(byHeader["¡"].kind).toBe("canonical");
    expect(byHeader["¡"].field).toBe("metaLeadId"); // contenido gana al header
    expect(byHeader["phone_number"].field).toBe("phone");
    expect(byHeader["¿qué_edad_tenés?"].kind).toBe("custom");
    expect(byHeader["¿qué_edad_tenés?"].label).toBe("qué edad tenés");
    expect(byHeader["¡"].samples[0]).toBe("l:1736506344033192");
    expect(s.statusValues.sort()).toEqual(["CREATED", "calificado"]);
    // la columna decoy "id" (vacía) no debe sugerirse como metaLeadId
    expect(byHeader["id"]?.field).not.toBe("metaLeadId");
  });
});

describe("parseSheetUrl", () => {
  it("extrae id y gid de una URL completa", () => {
    const r = parseSheetUrl(
      "https://docs.google.com/spreadsheets/d/1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8/edit?gid=217367597#gid=217367597",
    );
    expect(r.spreadsheetId).toBe("1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8");
    expect(r.gid).toBe("217367597");
  });
  it("acepta un ID pelado", () => {
    const r = parseSheetUrl("1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8");
    expect(r.spreadsheetId).toBe("1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8");
    expect(r.gid).toBeNull();
  });
  it("rechaza texto que no es URL ni ID", () => {
    expect(parseSheetUrl("hola mundo").spreadsheetId).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run src/lib/leads`
Expected: FAIL — `suggestMapping` no exportado, `./sheet-url` no existe, renombre/ignore sin efecto.

- [ ] **Step 3: Implementar tipos** — en `src/lib/leads/types.ts` reemplazar la interfaz `ColumnMapping` por:

```ts
/** Overrides opcionales de mapeo (todo auto-detectable si está vacío). */
export interface ColumnMapping {
  canonical?: Partial<Record<CanonicalField, string>>;
  /** header normalizado -> nombre elegido para el custom field. */
  custom?: Record<string, string>;
  /** headers normalizados que no se ingestan. */
  ignore?: string[];
  /** valor de lead_status (tal cual la hoja) -> pipeline_stages.id. */
  statusToStage?: Record<string, string>;
}

/** Sugerencia de clasificación de una columna, para el wizard. */
export interface ColumnSuggestion {
  index: number;
  header: string;
  samples: string[];
  kind: "canonical" | "custom" | "ignore";
  field?: CanonicalField;
  label?: string;
}

export interface MappingSuggestion {
  columns: ColumnSuggestion[];
  statusValues: string[];
}
```

- [ ] **Step 4: Implementar mapping** — en `src/lib/leads/mapping.ts`:

(a) En `resolveColumns`, después de construir `claimed` y antes del loop de customs, agregar el set de ignorados, y usar el renombre en el label:

```ts
  // Todo lo no reclamado por un canónico -> custom field.
  const ignored = new Set((mapping?.ignore ?? []).map(normalizeHeader));
  const customNames = mapping?.custom ?? {};
  const claimed = new Set<number>(
    Object.values(resolved).filter((v): v is number => typeof v === "number" && v >= 0),
  );
  for (let i = 0; i < colCount; i++) {
    if (claimed.has(i)) continue;
    if (ignored.has(norm[i])) continue;
    const label = customNames[norm[i]] ?? toLabel(raw.headers[i]);
    if (!label) continue; // header vacío (columna decoy / trailing)
    resolved.customHeaders.push({ index: i, label });
  }
```

(sustituye el bloque equivalente existente; `customNames` se indexa por header normalizado)

(b) Agregar al final del archivo:

```ts
/**
 * Sugerencias de mapeo para el wizard: clasifica cada columna con la
 * heurística existente (id/tel por contenido, resto por diccionario) y
 * junta los valores distintos de la columna de estado.
 */
export function suggestMapping(
  raw: RawSheetData,
  mapping?: ColumnMapping,
): MappingSuggestion {
  const cols = resolveColumns(raw, mapping);
  const samples = (i: number): string[] =>
    raw.rows
      .map((r) => (r[i] ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);

  const byIndex = new Map<number, ColumnSuggestion>();
  for (const [key, value] of Object.entries(cols)) {
    if (key === "customHeaders" || typeof value !== "number" || value < 0) continue;
    const field = key as CanonicalField;
    byIndex.set(value, {
      index: value,
      header: raw.headers[value] ?? "",
      samples: samples(value),
      kind: "canonical",
      field,
    });
  }
  for (const { index, label } of cols.customHeaders) {
    byIndex.set(index, {
      index,
      header: raw.headers[index] ?? "",
      samples: samples(index),
      kind: "custom",
      label,
    });
  }

  const columns: ColumnSuggestion[] = [];
  for (let i = 0; i < raw.headers.length; i++) {
    const found = byIndex.get(i);
    if (found) {
      columns.push(found);
      continue;
    }
    const header = (raw.headers[i] ?? "").trim();
    const hasData = raw.rows.some((r) => (r[i] ?? "").trim() !== "");
    if (!header && !hasData) continue; // columna totalmente vacía: no molestar
    columns.push({ index: i, header, samples: samples(i), kind: "ignore" });
  }

  const statusValues =
    cols.status >= 0
      ? [...new Set(raw.rows.map((r) => (r[cols.status] ?? "").trim()).filter(Boolean))]
      : [];

  return { columns, statusValues };
}
```

Importar `ColumnSuggestion, MappingSuggestion` desde `./types` en el import existente.

- [ ] **Step 5: Crear `src/lib/leads/sheet-url.ts`:**

```ts
// Parseo de URLs de Google Sheets (compartido por el wizard y el preview).

export function parseSheetUrl(url: string): {
  spreadsheetId: string | null;
  gid: string | null;
} {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
  const trimmed = url.trim();
  const bareId = /^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null;
  return {
    spreadsheetId: idMatch ? idMatch[1] : bareId,
    gid: gidMatch ? gidMatch[1] : null,
  };
}
```

- [ ] **Step 6: Correr los tests y ver que pasan**

Run: `npx vitest run src/lib/leads`
Expected: PASS (15 existentes + los nuevos).

- [ ] **Step 7: Commit**

```bash
git add src/lib/leads/types.ts src/lib/leads/mapping.ts src/lib/leads/sheet-url.ts src/lib/leads/leads.test.ts
git commit -m "feat(leads): ColumnMapping con ignore/renombres, suggestMapping y parseSheetUrl"
```

---

### Task 2: Ingesta — etapa inicial por statusToStage + persistir sheet_status

**Files:**
- Modify: `src/lib/leads/types.ts` (puerto)
- Modify: `src/lib/leads/ingest.ts`
- Test: `src/lib/leads/leads.test.ts` (FakeRepo + describes)

**Interfaces:**
- Consumes: `ColumnMapping.statusToStage` de Task 1.
- Produces (cambios de puerto que Task 4 implementa en Supabase):
  - `createDeal(input: { leadId; contactId; title; stageId?: string | null }): Promise<{ id: string; stageId: string }>`
  - `finalizeLead(leadId, data: { attribution; leadCreatedTime; rawPayload; phoneValid; sheetStatus: string | null; syncedStageId: string | null })`
  - `ClaimedLead` += `sheetStatus: string | null; syncedStageId: string | null`
  - `IngestOptions` += `statusToStage?: Record<string, string>`
  - `resolveStage(statusRaw: string | null, map?: Record<string, string>): string | null` (exportada)

- [ ] **Step 1: Tests que fallan** — en `leads.test.ts`, dentro del describe `ingestLead (claim-first)` agregar:

```ts
  it("usa la etapa mapeada por lead_status al crear el deal", async () => {
    const repo = new FakeRepo();
    const lead = { ...makeLead("l:20"), statusRaw: "calificado" };
    await ingestLead(repo, lead, {
      autoAssign: false,
      statusToStage: { calificado: "stage_calificado" },
    });
    expect(repo.deals[0].stageId).toBe("stage_calificado");
    const stored = [...repo.leads.values()][0];
    expect(stored.sheetStatus).toBe("calificado");
    expect(stored.syncedStageId).toBe("stage_calificado");
  });

  it("cae a la etapa default si el estado no está mapeado", async () => {
    const repo = new FakeRepo();
    const lead = { ...makeLead("l:21"), statusRaw: "algo-raro" };
    await ingestLead(repo, lead, { autoAssign: false, statusToStage: {} });
    expect(repo.deals[0].stageId).toBe("stage_default");
  });

  it("el lookup de estado es case-insensitive como fallback", async () => {
    const repo = new FakeRepo();
    const lead = { ...makeLead("l:22"), statusRaw: "Calificado" };
    await ingestLead(repo, lead, {
      autoAssign: false,
      statusToStage: { calificado: "stage_calificado" },
    });
    expect(repo.deals[0].stageId).toBe("stage_calificado");
  });
```

Y actualizar `FakeRepo` (reemplaza los miembros/métodos correspondientes) para que compile y modele etapas:

```ts
class FakeRepo implements LeadRepository {
  leads = new Map<
    string,
    {
      leadId: string;
      metaLeadId: string;
      status: "claimed" | "processed";
      contactId: string | null;
      dealId: string | null;
      sheetStatus: string | null;
      syncedStageId: string | null;
    }
  >();
  contacts: { id: string; phone: string }[] = [];
  deals: { id: string; assigned: string | null; stageId: string }[] = [];
  quarantined: { reason: string }[] = [];
  private seq = 0;
  private nid(p: string) {
    return p + ++this.seq;
  }

  async claimLead(metaLeadId: string): Promise<ClaimedLead> {
    for (const l of this.leads.values()) {
      if (l.metaLeadId === metaLeadId) {
        return {
          leadId: l.leadId,
          status: l.status,
          isNew: false,
          dealId: l.dealId,
          contactId: l.contactId,
          sheetStatus: l.sheetStatus,
          syncedStageId: l.syncedStageId,
        };
      }
    }
    const leadId = this.nid("lead_");
    this.leads.set(leadId, {
      leadId, metaLeadId, status: "claimed", contactId: null, dealId: null,
      sheetStatus: null, syncedStageId: null,
    });
    return {
      leadId, status: "claimed", isNew: true, dealId: null, contactId: null,
      sheetStatus: null, syncedStageId: null,
    };
  }
  async findOrCreateContact({ phoneE164 }: { phoneE164: string | null }) {
    const key = phoneE164 ?? "";
    const found = this.contacts.find((c) => c.phone === key);
    if (found) return { id: found.id };
    const id = this.nid("contact_");
    this.contacts.push({ id, phone: key });
    return { id };
  }
  async setCustomValues() {}
  async addNote() {}
  async createDeal({ leadId, stageId }: { leadId: string; contactId: string; title: string; stageId?: string | null }) {
    const id = this.nid("deal_");
    const stage = stageId ?? "stage_default";
    this.deals.push({ id, assigned: null, stageId: stage });
    const l = this.leads.get(leadId);
    if (l) l.dealId = id;
    return { id, stageId: stage };
  }
  async setLeadContact(leadId: string, contactId: string) {
    const l = this.leads.get(leadId);
    if (l) l.contactId = contactId;
  }
  async listAssignableAgents(): Promise<AssignableAgent[]> {
    return [
      { userId: "u1", openDeals: 0 },
      { userId: "u2", openDeals: 3 },
    ];
  }
  async assignDealIfUnassigned(dealId: string, userId: string) {
    const d = this.deals.find((x) => x.id === dealId);
    if (d && !d.assigned) d.assigned = userId;
  }
  async finalizeLead(
    leadId: string,
    data: { sheetStatus: string | null; syncedStageId: string | null },
  ) {
    const l = this.leads.get(leadId);
    if (l) {
      l.status = "processed";
      l.sheetStatus = data.sheetStatus;
      l.syncedStageId = data.syncedStageId;
    }
  }
  async getDealStage(dealId: string): Promise<string | null> {
    return this.deals.find((d) => d.id === dealId)?.stageId ?? null;
  }
  async moveDealStage(dealId: string, stageId: string) {
    const d = this.deals.find((x) => x.id === dealId);
    if (d) d.stageId = stageId;
  }
  async recordSheetStatus(leadId: string, sheetStatus: string | null, syncedStageId: string | null) {
    const l = this.leads.get(leadId);
    if (l) {
      l.sheetStatus = sheetStatus;
      l.syncedStageId = syncedStageId;
    }
  }
  async quarantine(_row: Record<string, string>, reason: string) {
    this.quarantined.push({ reason });
  }
}
```

(`getDealStage`, `moveDealStage`, `recordSheetStatus` se agregan al puerto en el Step 3; el FakeRepo ya los trae para no tocarlo dos veces.)

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/leads`
Expected: FAIL — TypeScript: `stageId` no existe en createDeal; `sheetStatus` no existe en ClaimedLead/finalizeLead.

- [ ] **Step 3: Actualizar el puerto en `types.ts`** — reemplazar `ClaimedLead`, `createDeal`, `finalizeLead` y agregar los métodos nuevos:

```ts
/** Fila mínima de un lead reclamado, para decidir reanudación/sync. */
export interface ClaimedLead {
  leadId: string;
  status: "claimed" | "processed";
  /** true si el INSERT fue nuevo; false si ya existía (dedupe / reanudar). */
  isNew: boolean;
  dealId: string | null;
  contactId: string | null;
  /** Último lead_status visto en la planilla (persistido). */
  sheetStatus: string | null;
  /** Última etapa aplicada por la sync; null = la planilla no controla. */
  syncedStageId: string | null;
}
```

En `LeadRepository`:

```ts
  /** Crea el deal en el pipeline destino y lo linkea al lead. */
  createDeal(input: {
    leadId: string;
    contactId: string;
    title: string;
    /** Etapa inicial; si es null usa la default de la fuente. */
    stageId?: string | null;
  }): Promise<{ id: string; stageId: string }>;

  /** Cierra el lead: status='processed' + atribución + raw + estado de hoja. */
  finalizeLead(
    leadId: string,
    data: {
      attribution: LeadAttribution;
      leadCreatedTime: string | null;
      rawPayload: Record<string, string>;
      phoneValid: boolean;
      sheetStatus: string | null;
      syncedStageId: string | null;
    },
  ): Promise<void>;

  /** Etapa actual del deal (null si no existe). */
  getDealStage(dealId: string): Promise<string | null>;

  /** Mueve el deal de etapa (sync planilla→CRM). */
  moveDealStage(dealId: string, stageId: string): Promise<void>;

  /** Persiste el último estado visto en la hoja + quién controla. */
  recordSheetStatus(
    leadId: string,
    sheetStatus: string | null,
    syncedStageId: string | null,
  ): Promise<void>;
```

Y en `IngestOutcome` agregar `"stage_synced"`:

```ts
export type IngestOutcome =
  | "processed"
  | "skipped_duplicate"
  | "resumed"
  | "stage_synced"
  | "quarantined";
```

- [ ] **Step 4: Implementar en `ingest.ts`** — `IngestOptions` y resolución de etapa:

```ts
export interface IngestOptions {
  /** Auto-asignar por least-loaded (config de la fuente). */
  autoAssign: boolean;
  /** Mapa lead_status -> stage_id (config de la fuente). */
  statusToStage?: Record<string, string>;
}

/** Resuelve la etapa para un lead_status: exacto, luego case-insensitive. */
export function resolveStage(
  statusRaw: string | null,
  map?: Record<string, string>,
): string | null {
  if (!statusRaw || !map) return null;
  const key = statusRaw.trim();
  if (map[key]) return map[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.trim().toLowerCase() === lower) return v;
  }
  return null;
}
```

En `ingestLead`, el paso 3 (deal) pasa a:

```ts
  // 3. Deal (reusa el ya creado si estamos reanudando).
  let dealId = claimed.dealId;
  let initialStageId = claimed.syncedStageId;
  if (!dealId) {
    const deal = await repo.createDeal({
      leadId: claimed.leadId,
      contactId,
      title: lead.name || lead.phoneRaw || "Lead de Meta",
      stageId: resolveStage(lead.statusRaw, opts.statusToStage),
    });
    dealId = deal.id;
    initialStageId = deal.stageId;
  }
```

Y el paso 5 (finalize):

```ts
  // 5. Finalize.
  await repo.finalizeLead(claimed.leadId, {
    attribution: lead.attribution,
    leadCreatedTime: lead.leadCreatedTime,
    rawPayload: lead.raw,
    phoneValid: lead.phoneValid,
    sheetStatus: lead.statusRaw?.trim() || null,
    syncedStageId: initialStageId,
  });
```

- [ ] **Step 5: Correr y ver pasar**

Run: `npx vitest run src/lib/leads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leads/types.ts src/lib/leads/ingest.ts src/lib/leads/leads.test.ts
git commit -m "feat(leads): etapa inicial del deal por statusToStage + persistencia de sheet_status"
```

---

### Task 3: Ingesta — sync de estados para leads ya procesados

**Files:**
- Modify: `src/lib/leads/ingest.ts`
- Test: `src/lib/leads/leads.test.ts`

**Interfaces:**
- Consumes: puerto de Task 2 (`getDealStage`, `moveDealStage`, `recordSheetStatus`, `ClaimedLead.sheetStatus/syncedStageId`), `resolveStage`.
- Produces: `ingestLead` devuelve `{ outcome: "stage_synced" }` cuando movió el deal; reglas de conflicto documentadas en el spec.

- [ ] **Step 1: Tests que fallan** — nuevo describe en `leads.test.ts`:

```ts
describe("sync de estados planilla→CRM (leads procesados)", () => {
  async function seedProcessed(repo: FakeRepo, status: string, stage: string) {
    await ingestLead(repo, { ...makeLead("l:50"), statusRaw: status }, {
      autoAssign: false,
      statusToStage: MAP,
    });
    expect(repo.deals[0].stageId).toBe(stage);
  }
  const MAP = {
    CREATED: "stage_nuevo",
    calificado: "stage_calificado",
    "closed-won": "stage_won",
  };

  it("mueve el deal cuando el estado cambia en la hoja", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "calificado" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("stage_synced");
    expect(repo.deals[0].stageId).toBe("stage_calificado");
    expect([...repo.leads.values()][0].sheetStatus).toBe("calificado");
    expect([...repo.leads.values()][0].syncedStageId).toBe("stage_calificado");
  });

  it("no mueve nada si el estado no cambió", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "CREATED" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("skipped_duplicate");
    expect(repo.deals[0].stageId).toBe("stage_nuevo");
  });

  it("si un humano movió el deal en el Kanban, la planilla pierde el control", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    repo.deals[0].stageId = "stage_cotizado"; // movimiento manual en el CRM
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "calificado" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("skipped_duplicate");
    expect(repo.deals[0].stageId).toBe("stage_cotizado"); // no lo pisó
    const stored = [...repo.leads.values()][0];
    expect(stored.sheetStatus).toBe("calificado"); // igual registra lo visto
    expect(stored.syncedStageId).toBeNull(); // control manual permanente
    // y una pasada posterior tampoco lo toca
    const res2 = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "closed-won" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res2.outcome).toBe("skipped_duplicate");
    expect(repo.deals[0].stageId).toBe("stage_cotizado");
  });

  it("estado sin mapeo: registra sheet_status pero no mueve", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "perdido" }, // no está en MAP
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("skipped_duplicate");
    expect(res.reason).toBe("estado sin mapeo");
    expect(repo.deals[0].stageId).toBe("stage_nuevo");
    expect([...repo.leads.values()][0].sheetStatus).toBe("perdido");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/leads`
Expected: FAIL — hoy un duplicado processed devuelve `skipped_duplicate` sin sync (primer test rompe).

- [ ] **Step 3: Implementar la sync en `ingest.ts`** — reemplazar el early-return del claim por:

```ts
  // 1. CLAIM — reserva la clave antes de crear nada.
  const claimed = await repo.claimLead(lead.metaLeadId);
  if (!claimed.isNew && claimed.status === "processed") {
    return syncSheetStage(repo, claimed, lead, opts);
  }
```

Y agregar la función (privada del módulo, debajo de `ingestLead`):

```ts
/**
 * Lead ya procesado: si el lead_status de la hoja cambió, refleja el
 * cambio en la etapa del deal — salvo que un humano ya lo haya movido
 * en el Kanban (deal.stage != synced_stage), en cuyo caso la planilla
 * pierde el control de ese deal para siempre (synced_stage = null).
 */
async function syncSheetStage(
  repo: LeadRepository,
  claimed: ClaimedLead,
  lead: NormalizedLead,
  opts: IngestOptions,
): Promise<IngestResult> {
  const skipped: IngestResult = { outcome: "skipped_duplicate", leadId: claimed.leadId };
  const status = lead.statusRaw?.trim() || null;
  if (!status || status === (claimed.sheetStatus ?? "")) return skipped;
  if (!claimed.dealId) return skipped;

  // Control manual permanente (o legado sin tracking).
  if (!claimed.syncedStageId) {
    await repo.recordSheetStatus(claimed.leadId, status, null);
    return { ...skipped, reason: "deal en control manual" };
  }

  const target = resolveStage(status, opts.statusToStage);
  if (!target) {
    await repo.recordSheetStatus(claimed.leadId, status, claimed.syncedStageId);
    return { ...skipped, reason: "estado sin mapeo" };
  }

  const current = await repo.getDealStage(claimed.dealId);
  if (current !== claimed.syncedStageId) {
    // Alguien lo movió en el CRM: la planilla deja de mandar.
    await repo.recordSheetStatus(claimed.leadId, status, null);
    return { ...skipped, reason: "deal en control manual" };
  }
  if (current === target) {
    await repo.recordSheetStatus(claimed.leadId, status, target);
    return skipped;
  }

  await repo.moveDealStage(claimed.dealId, target);
  await repo.recordSheetStatus(claimed.leadId, status, target);
  return { outcome: "stage_synced", leadId: claimed.leadId };
}
```

Importar `ClaimedLead` y `NormalizedLead` ya están importados; verificar imports.

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/lib/leads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/ingest.ts src/lib/leads/leads.test.ts
git commit -m "feat(leads): sync de estados planilla→CRM con regla humano-manda"
```

---

### Task 4: Migración 030 + adaptador Supabase + cron

**Files:**
- Create: `supabase/migrations/030_lead_source_wizard.sql`
- Modify: `src/lib/leads/repository.ts`
- Modify: `src/app/api/leads/sync/route.ts`

**Interfaces:**
- Consumes: puerto de Tasks 2-3.
- Produces: columnas `leads.sheet_status`, `leads.synced_stage_id`, `lead_sync_runs.stage_synced`; índice único activo de fuentes; `SyncRunTotals` += `stageSynced: number`.

- [ ] **Step 1: Crear `supabase/migrations/030_lead_source_wizard.sql`:**

```sql
-- ============================================================
-- 030 — Wizard de fuentes + sync de estados planilla→CRM.
-- Aditiva e idempotente.
--   * leads.sheet_status: último lead_status visto en la hoja.
--   * leads.synced_stage_id: última etapa aplicada por la sync
--     (NULL = la planilla no controla el deal; regla humano-manda).
--   * lead_sync_runs.stage_synced: contador por corrida.
--   * Fuentes duplicadas: se desactivan (conservando la más vieja)
--     y un índice único parcial evita duplicar de nuevo.
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS sheet_status TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS synced_stage_id UUID
  REFERENCES pipeline_stages(id) ON DELETE SET NULL;

ALTER TABLE lead_sync_runs ADD COLUMN IF NOT EXISTS stage_synced INTEGER NOT NULL DEFAULT 0;

-- Desactivar fuentes duplicadas (misma cuenta + planilla + pestaña),
-- conservando la más vieja. No se borra: leads.source_id las referencia.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY account_id, spreadsheet_id, COALESCE(sheet_gid, '0')
           ORDER BY created_at ASC
         ) AS rn
  FROM lead_sources
  WHERE active AND kind = 'google_sheet'
)
UPDATE lead_sources SET active = FALSE
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sources_account_sheet
  ON lead_sources(account_id, spreadsheet_id, COALESCE(sheet_gid, '0'))
  WHERE active;
```

- [ ] **Step 2: Aplicar la migración al proyecto linkeado**

Run: `npx supabase db push --yes`
Expected: `Applying migration 030_lead_source_wizard.sql...` sin errores.
Verificar: `npx supabase migration list --linked` muestra la 030 en Local y Remote.

- [ ] **Step 3: Actualizar `repository.ts`:**

(a) `claimLead` — ambos SELECT pasan a `"id, status, contact_id, deal_id, sheet_status, synced_stage_id"` y ambos returns agregan:

```ts
          sheetStatus: (row.sheet_status as string | null) ?? null,
          syncedStageId: (row.synced_stage_id as string | null) ?? null,
```

(en la rama del conflicto, con `found` en lugar de `row`)

(b) `createDeal` — usar la etapa pedida y devolverla:

```ts
    async createDeal({ leadId, contactId, title, stageId }) {
      const stage = stageId ?? defaultStageId;
      const { data, error } = await admin
        .from("deals")
        .insert({
          account_id: accountId,
          user_id: ownerUserId,
          pipeline_id: pipelineId,
          stage_id: stage,
          contact_id: contactId,
          title: title || "Lead de Meta",
          value: 0,
          currency: DEAL_CURRENCY,
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw error;

      // Checkpoint de reanudación: linkear el deal al lead enseguida.
      await admin.from("leads").update({ deal_id: data.id }).eq("id", leadId);
      return { id: data.id as string, stageId: stage };
    },
```

(c) `finalizeLead` — el UPDATE agrega:

```ts
          sheet_status: data.sheetStatus,
          synced_stage_id: data.syncedStageId,
```

(d) Métodos nuevos (después de `assignDealIfUnassigned`):

```ts
    async getDealStage(dealId) {
      const { data, error } = await admin
        .from("deals")
        .select("stage_id")
        .eq("id", dealId)
        .maybeSingle();
      if (error) throw error;
      return (data?.stage_id as string | null) ?? null;
    },

    async moveDealStage(dealId, stageId) {
      const { error } = await admin
        .from("deals")
        .update({ stage_id: stageId, updated_at: new Date().toISOString() })
        .eq("id", dealId);
      if (error) throw error;
    },

    async recordSheetStatus(leadId, sheetStatus, syncedStageId) {
      const { error } = await admin
        .from("leads")
        .update({
          sheet_status: sheetStatus,
          synced_stage_id: syncedStageId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
      if (error) throw error;
    },
```

(e) `SyncRunTotals` += `stageSynced: number;` y `recordSyncRun` inserta `stage_synced: totals.stageSynced,`.

- [ ] **Step 4: Actualizar el cron `src/app/api/leads/sync/route.ts`:**

En los totals iniciales agregar `stageSynced: 0,`. En el loop de filas, pasar el mapa y contar:

```ts
          const result = await ingestLead(repo, lead, {
            autoAssign: source.autoAssign,
            statusToStage: source.columnMapping.statusToStage,
          });
          if (result.outcome === "processed") {
            totals.claimed++;
            totals.processed++;
          } else if (result.outcome === "resumed") {
            totals.processed++;
          } else if (result.outcome === "stage_synced") {
            totals.stageSynced++;
          }
          // "skipped_duplicate" -> ya estaba, no cuenta.
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npx vitest run src/lib/leads`
Expected: ambos PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/030_lead_source_wizard.sql src/lib/leads/repository.ts src/app/api/leads/sync/route.ts
git commit -m "feat(leads): migración 030 (sheet_status/synced_stage_id, índice único de fuentes) + adaptador y cron"
```

---

### Task 5: google-sheets.ts — pestañas del documento + email del SA

**Files:**
- Modify: `src/lib/leads/google-sheets.ts`

**Interfaces:**
- Produces:
  - `SheetTab { gid: string; title: string; rowCount: number }`
  - `fetchSpreadsheetTabs(spreadsheetId: string): Promise<SheetTab[]>`
  - `getServiceAccountEmail(): string | null`

(Adaptador de red puro, sin test unitario — mismo criterio que el resto del archivo; se verifica end-to-end vía el preview en Task 9.)

- [ ] **Step 1: Agregar al final de `google-sheets.ts`:**

```ts
/** Una pestaña del documento, para el wizard. */
export interface SheetTab {
  gid: string;
  title: string;
  rowCount: number;
}

/** Lista las pestañas (título + gid + filas) del documento. */
export async function fetchSpreadsheetTabs(
  spreadsheetId: string,
): Promise<SheetTab[]> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}?fields=sheets.properties(sheetId,title,gridProperties(rowCount))`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Error de metadatos de Sheets ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    sheets?: {
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number };
      };
    }[];
  };
  return (json.sheets ?? []).flatMap((s) => {
    const p = s.properties;
    if (p?.sheetId == null) return [];
    return [
      {
        gid: String(p.sheetId),
        title: p.title ?? `gid ${p.sheetId}`,
        rowCount: p.gridProperties?.rowCount ?? 0,
      },
    ];
  });
}

/** Email del service account (para el hint "compartí la hoja con…"). */
export function getServiceAccountEmail(): string | null {
  try {
    return loadServiceAccount().client_email;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/leads/google-sheets.ts
git commit -m "feat(leads): fetchSpreadsheetTabs y getServiceAccountEmail para el wizard"
```

---

### Task 6: Endpoint POST /api/leads/sources/preview

**Files:**
- Create: `src/app/api/leads/sources/preview/route.ts`

**Interfaces:**
- Consumes: `parseSheetUrl` (T1), `fetchSpreadsheetTabs`/`fetchSheetRows`/`getServiceAccountEmail` (T5), `suggestMapping` (T1), `requireRole` de `@/lib/auth/account`.
- Produces (contrato que consume el wizard en T8):

```ts
// Response 200:
{
  spreadsheetId: string;
  serviceAccountEmail: string | null;
  tabs: { gid: string; title: string; rowCount: number; hasSource: boolean; looksLikeData: boolean }[];
  selected: {
    gid: string | null;
    headers: string[];
    rowCount: number;
    suggestions: ColumnSuggestion[];
    statusValues: string[];
  };
  stages: { id: string; name: string }[];
}
```

- [ ] **Step 1: Crear `src/app/api/leads/sources/preview/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  fetchSheetRows,
  fetchSpreadsheetTabs,
  getServiceAccountEmail,
} from "@/lib/leads/google-sheets";
import { suggestMapping } from "@/lib/leads/mapping";
import { parseSheetUrl } from "@/lib/leads/sheet-url";

// Node runtime: JWT de Google usa node:crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview para el wizard de fuentes: pestañas del documento + headers,
 * muestras y sugerencias de mapeo de la pestaña elegida. Solo lectura,
 * salvo el ensure (idempotente) del pipeline destino, necesario para
 * ofrecer las etapas en el paso de estados.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return NextResponse.json(
        { error: "GOOGLE_SERVICE_ACCOUNT_JSON no está configurada en el servidor" },
        { status: 503 },
      );
    }
    const body = (await request.json()) as { url?: string; gid?: string | null };
    const { spreadsheetId, gid: urlGid } = parseSheetUrl(body.url ?? "");
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "URL de Google Sheets inválida" },
        { status: 400 },
      );
    }

    let tabs;
    try {
      tabs = await fetchSpreadsheetTabs(spreadsheetId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes(" 403")) {
        const email = getServiceAccountEmail();
        return NextResponse.json(
          {
            error: `Sin acceso a la planilla. Compartila (lectura) con ${
              email ?? "el service account de Google"
            }.`,
          },
          { status: 403 },
        );
      }
      if (msg.includes(" 404")) {
        return NextResponse.json(
          { error: "Planilla no encontrada. Revisá la URL." },
          { status: 404 },
        );
      }
      throw err;
    }

    const selectedGid = body.gid ?? urlGid ?? tabs[0]?.gid ?? null;

    // Pestañas que ya tienen fuente activa en esta cuenta.
    const { data: sources } = await ctx.supabase
      .from("lead_sources")
      .select("sheet_gid")
      .eq("spreadsheet_id", spreadsheetId)
      .eq("active", true);
    const registered = new Set(
      (sources ?? []).map((s) => String(s.sheet_gid ?? "0")),
    );

    // Pipeline destino + etapas (idempotente; igual que POST /sources).
    const { data: pipelineId, error: rpcErr } = await ctx.supabase.rpc(
      "ensure_leads_prepaga_pipeline",
      { p_account_id: ctx.accountId, p_user_id: ctx.userId },
    );
    if (rpcErr || !pipelineId) {
      console.error("[leads/preview] ensure pipeline error:", rpcErr);
      return NextResponse.json(
        { error: "no se pudo preparar el pipeline" },
        { status: 500 },
      );
    }
    const { data: stages } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, name")
      .eq("pipeline_id", pipelineId)
      .order("position");

    const raw = await fetchSheetRows(spreadsheetId, selectedGid);
    const suggestion = suggestMapping(raw);

    return NextResponse.json({
      spreadsheetId,
      serviceAccountEmail: getServiceAccountEmail(),
      tabs: tabs.map((t) => ({
        ...t,
        hasSource: registered.has(t.gid),
        looksLikeData: t.rowCount > 1,
      })),
      selected: {
        gid: selectedGid,
        headers: raw.headers,
        rowCount: raw.rows.length,
        suggestions: suggestion.columns,
        statusValues: suggestion.statusValues,
      },
      stages: stages ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/leads/sources/preview/route.ts
git commit -m "feat(leads): endpoint preview para el wizard de fuentes"
```

---

### Task 7: POST /api/leads/sources acepta columnMapping validado

**Files:**
- Modify: `src/app/api/leads/sources/route.ts`

**Interfaces:**
- Consumes: `ColumnMapping` (T1).
- Produces: body extendido `{ name, spreadsheetId, sheetGid?, autoAssign?, columnMapping? }`; 409 amigable ante duplicado; validación de stage ids.

- [ ] **Step 1: Reemplazar el cuerpo del POST** (mantener el ensure del pipeline y la búsqueda de la etapa "Nuevo" tal cual; cambian el parse del body, la validación y el insert):

```ts
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { ColumnMapping } from "@/lib/leads/types";

export const dynamic = "force-dynamic";

/**
 * Alta de una fuente de leads (una pestaña de una hoja de Google).
 * El wizard manda el columnMapping completo (canonical/custom/ignore/
 * statusToStage); el alta manual mínima sigue funcionando sin él.
 *
 * Body JSON: { name, spreadsheetId, sheetGid?, autoAssign?, columnMapping? }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json()) as {
      name?: string;
      spreadsheetId?: string;
      sheetGid?: string | null;
      autoAssign?: boolean;
      columnMapping?: ColumnMapping;
    };

    const name = (body.name ?? "").trim();
    const spreadsheetId = (body.spreadsheetId ?? "").trim();
    if (!name || !spreadsheetId) {
      return NextResponse.json(
        { error: "name y spreadsheetId son obligatorios" },
        { status: 400 },
      );
    }

    // Asegura (idempotente) el pipeline "Leads Prepaga" + etapas.
    const { data: pipelineId, error: rpcErr } = await ctx.supabase.rpc(
      "ensure_leads_prepaga_pipeline",
      { p_account_id: ctx.accountId, p_user_id: ctx.userId },
    );
    if (rpcErr || !pipelineId) {
      console.error("[leads/sources] ensure pipeline error:", rpcErr);
      return NextResponse.json(
        { error: "no se pudo preparar el pipeline" },
        { status: 500 },
      );
    }

    // Etapa inicial "Nuevo".
    const { data: stage, error: stageErr } = await ctx.supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("name", "Nuevo")
      .maybeSingle();
    if (stageErr || !stage) {
      return NextResponse.json(
        { error: "no se encontró la etapa inicial" },
        { status: 500 },
      );
    }

    // Validar statusToStage: toda etapa debe pertenecer al pipeline.
    const mapping: ColumnMapping = body.columnMapping ?? {};
    const mappedStageIds = Object.values(mapping.statusToStage ?? {});
    if (mappedStageIds.length > 0) {
      const { data: valid } = await ctx.supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .in("id", mappedStageIds);
      const validIds = new Set((valid ?? []).map((s) => s.id as string));
      const invalid = mappedStageIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: "statusToStage contiene etapas que no son del pipeline de leads" },
          { status: 400 },
        );
      }
    }

    const { data: source, error: insErr } = await ctx.supabase
      .from("lead_sources")
      .insert({
        account_id: ctx.accountId,
        owner_user_id: ctx.userId,
        name,
        kind: "google_sheet",
        spreadsheet_id: spreadsheetId,
        sheet_gid: body.sheetGid ?? null,
        column_mapping: mapping,
        pipeline_id: pipelineId,
        default_stage_id: stage.id,
        auto_assign: body.autoAssign ?? true,
      })
      .select("id, name")
      .single();
    if (insErr) {
      if (insErr.code === "23505") {
        return NextResponse.json(
          { error: "Esa pestaña ya tiene una fuente activa en esta cuenta" },
          { status: 409 },
        );
      }
      console.error("[leads/sources] insert error:", insErr);
      return NextResponse.json(
        { error: "no se pudo crear la fuente" },
        { status: 500 },
      );
    }

    return NextResponse.json({ source }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/leads/sources/route.ts
git commit -m "feat(leads): alta de fuentes con columnMapping validado y 409 ante duplicados"
```

---

### Task 8: Wizard UI (reemplaza el form de alta)

**Files:**
- Modify: `src/app/(dashboard)/leads/sources/new-source-form.tsx` (reescritura completa; conserva el export `NewSourceForm`, así `page.tsx` no cambia)

**Interfaces:**
- Consumes: `POST /api/leads/sources/preview` (T6), `POST /api/leads/sources` (T7), `parseSheetUrl` (T1), tipos `ColumnSuggestion`/`CanonicalField` (T1).
- Produces: componente client `NewSourceForm` con 3 pasos.

- [ ] **Step 1: Reescribir `new-source-form.tsx` completo:**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from "lucide-react";
import type { CanonicalField, ColumnSuggestion } from "@/lib/leads/types";

// Wizard de alta de fuente: URL → pestaña → mapeo de columnas (con el
// nombre que el usuario quiera para cada custom field) → estados→etapa.

interface PreviewTab {
  gid: string;
  title: string;
  rowCount: number;
  hasSource: boolean;
  looksLikeData: boolean;
}

interface Preview {
  spreadsheetId: string;
  serviceAccountEmail: string | null;
  tabs: PreviewTab[];
  selected: {
    gid: string | null;
    headers: string[];
    rowCount: number;
    suggestions: ColumnSuggestion[];
    statusValues: string[];
  };
  stages: { id: string; name: string }[];
}

/** Clasificación editable de una columna en el paso 2. */
interface ColumnChoice {
  index: number;
  header: string;
  samples: string[];
  kind: "canonical" | "custom" | "ignore";
  field?: CanonicalField;
  label: string;
}

const CANONICAL_LABELS: Partial<Record<CanonicalField, string>> = {
  metaLeadId: "ID del lead (Meta)",
  name: "Nombre",
  phone: "Teléfono",
  email: "Email",
  city: "Ciudad",
  postalCode: "Código postal",
  comments: "Comentarios / notas",
  status: "Estado (lead_status)",
  createdTime: "Fecha de creación",
  platform: "Plataforma",
  isOrganic: "Orgánico",
  campaignId: "Campaña (id)",
  campaignName: "Campaña (nombre)",
  adsetId: "Conjunto (id)",
  adsetName: "Conjunto (nombre)",
  adId: "Anuncio (id)",
  adName: "Anuncio (nombre)",
  formId: "Formulario (id)",
  formName: "Formulario (nombre)",
};

/** Sugerencia de etapa por similitud de nombre con el estado. */
function suggestStage(
  status: string,
  stages: { id: string; name: string }[],
): string {
  const s = status.toLowerCase().replace(/[^a-záéíóúñ]/g, "");
  const alias: Record<string, string> = {
    created: "nuevo",
    closedwon: "closedwon",
  };
  const wanted = alias[s] ?? s;
  for (const st of stages) {
    const n = st.name.toLowerCase().replace(/[^a-záéíóúñ]/g, "");
    if (n === wanted || n.includes(wanted) || wanted.includes(n)) return st.id;
  }
  return "";
}

function normalizeHeaderClient(h: string): string {
  return (h ?? "").toString().trim().toLowerCase().replace(/\s+/g, "_");
}

export function NewSourceForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<ColumnChoice[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  async function loadPreview(targetGid?: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leads/sources/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, gid: targetGid ?? null }),
      });
      const body = (await res.json().catch(() => ({}))) as Preview & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setPreview(body);
      setChoices(
        body.selected.suggestions.map((s) => ({
          index: s.index,
          header: s.header,
          samples: s.samples,
          kind: s.kind,
          field: s.field,
          label: s.label ?? "",
        })),
      );
      setStatusMap(
        Object.fromEntries(
          body.selected.statusValues.map((v) => [v, suggestStage(v, body.stages)]),
        ),
      );
      const tab = body.tabs.find((t) => t.gid === body.selected.gid);
      if (!name.trim() && tab) setName(tab.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la planilla.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function setChoice(index: number, patch: Partial<ColumnChoice>) {
    setChoices((prev) =>
      prev.map((c) => (c.index === index ? { ...c, ...patch } : c)),
    );
  }

  async function createSource() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const canonical: Partial<Record<CanonicalField, string>> = {};
      const custom: Record<string, string> = {};
      const ignore: string[] = [];
      for (const c of choices) {
        const norm = normalizeHeaderClient(c.header);
        if (c.kind === "canonical" && c.field) canonical[c.field] = c.header;
        else if (c.kind === "custom") custom[norm] = c.label.trim() || c.header;
        else if (c.kind === "ignore" && norm) ignore.push(norm);
      }
      const statusToStage = Object.fromEntries(
        Object.entries(statusMap).filter(([, stageId]) => stageId),
      );
      const res = await fetch("/api/leads/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          spreadsheetId: preview.spreadsheetId,
          sheetGid: preview.selected.gid,
          autoAssign,
          columnMapping: { canonical, custom, ignore, statusToStage },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      setDone(preview.selected.gid ?? "0");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la fuente.");
    } finally {
      setBusy(false);
    }
  }

  function resetForTab(gid: string) {
    setDone(null);
    setName("");
    setStep(2);
    void loadPreview(gid);
  }

  const inputCls =
    "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
  const pendingTabs =
    preview?.tabs.filter(
      (t) => !t.hasSource && t.looksLikeData && t.gid !== done,
    ) ?? [];

  // ---------- pantalla de éxito ----------
  if (done) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Fuente creada ✅</h2>
        {pendingTabs.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              Este documento tiene otras pestañas con datos sin fuente:
            </p>
            <div className="flex flex-wrap gap-2">
              {pendingTabs.map((t) => (
                <button
                  key={t.gid}
                  onClick={() => resetForTab(t.gid)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
                >
                  <Plus className="h-4 w-4" /> {t.title}
                </button>
              ))}
            </div>
          </>
        )}
        <div>
          <button
            onClick={() => {
              setDone(null);
              setPreview(null);
              setUrl("");
              setName("");
              setStep(1);
            }}
            className="text-xs text-muted-foreground underline"
          >
            Agregar otra planilla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Agregar una hoja</h2>
        <span className="text-xs text-muted-foreground">Paso {step} de 3</span>
      </div>

      {/* ---------- Paso 1: URL + pestaña ---------- */}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            URL de la hoja de Google (o el ID)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
              className={inputCls}
            />
          </label>
          {preview && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">Pestañas del documento:</p>
              <div className="flex flex-col gap-1">
                {preview.tabs.map((t) => (
                  <label
                    key={t.gid}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="radio"
                      name="tab"
                      checked={preview.selected.gid === t.gid}
                      disabled={t.hasSource}
                      onChange={() => void loadPreview(t.gid)}
                    />
                    {t.title}
                    <span className="text-xs text-muted-foreground">
                      {t.hasSource
                        ? "— ya tiene fuente"
                        : t.looksLikeData
                          ? ""
                          : "— parece vacía"}
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Nombre de la fuente
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Form Dependencia - Fabi"
                  className={inputCls}
                />
              </label>
            </div>
          )}
          {preview?.serviceAccountEmail && (
            <p className="text-xs text-muted-foreground">
              La hoja debe estar compartida (lectura) con{" "}
              <code>{preview.serviceAccountEmail}</code>.
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void loadPreview()}
              disabled={busy || !url.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              {busy ? "Leyendo…" : preview ? "Releer" : "Leer planilla"}
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!preview || busy || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Siguiente <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---------- Paso 2: columnas ---------- */}
      {step === 2 && preview && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Revisá cómo se interpreta cada columna. Los campos personalizados
            usan el nombre que escribas acá (después aparecen así en cada contacto).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Columna</th>
                  <th className="py-2 pr-3">Ejemplos</th>
                  <th className="py-2 pr-3">Usar como</th>
                  <th className="py-2">Nombre del campo</th>
                </tr>
              </thead>
              <tbody>
                {choices.map((c) => (
                  <tr key={c.index} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-3 font-mono text-xs text-foreground">
                      {c.header || <em className="text-muted-foreground">(sin header)</em>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {c.samples.slice(0, 2).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={c.kind === "canonical" ? `f:${c.field}` : c.kind}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("f:")) {
                            setChoice(c.index, {
                              kind: "canonical",
                              field: v.slice(2) as CanonicalField,
                            });
                          } else {
                            setChoice(c.index, {
                              kind: v as "custom" | "ignore",
                              field: undefined,
                            });
                          }
                        }}
                        className={inputCls}
                      >
                        <option value="custom">Campo personalizado</option>
                        <option value="ignore">Ignorar</option>
                        <optgroup label="Campo del CRM">
                          {Object.entries(CANONICAL_LABELS).map(([f, label]) => (
                            <option key={f} value={`f:${f}`}>
                              {label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td className="py-2">
                      {c.kind === "custom" ? (
                        <input
                          value={c.label}
                          onChange={(e) => setChoice(c.index, { label: e.target.value })}
                          placeholder="Nombre para trabajar"
                          className={inputCls}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" /> Volver
            </button>
            <button
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Siguiente <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---------- Paso 3: estados + crear ---------- */}
      {step === 3 && preview && (
        <div className="flex flex-col gap-3">
          {preview.selected.statusValues.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                Cada estado de la planilla mueve el deal a esta etapa del embudo.
                Si el comprador cambia el estado en la hoja, el CRM lo refleja —
                salvo que alguien ya haya movido ese deal a mano en el Kanban.
              </p>
              <div className="flex flex-col gap-2">
                {preview.selected.statusValues.map((v) => (
                  <label key={v} className="flex items-center gap-3 text-sm">
                    <code className="w-40 shrink-0 text-xs text-foreground">{v}</code>
                    <select
                      value={statusMap[v] ?? ""}
                      onChange={(e) =>
                        setStatusMap((m) => ({ ...m, [v]: e.target.value }))
                      }
                      className={inputCls}
                    >
                      <option value="">(no mover)</option>
                      {preview.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              La pestaña no tiene columna de estado (o está vacía): los leads
              entran en la etapa inicial del embudo.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoAssign}
              onChange={(e) => setAutoAssign(e.target.checked)}
              className="h-4 w-4"
            />
            Auto-asignar (least-loaded)
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" /> Volver
            </button>
            <button
              onClick={() => void createSource()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {busy ? "Creando…" : "Crear fuente"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: PASS (lint puede marcar warnings preexistentes de otros archivos; ninguno nuevo en este).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/leads/sources/new-source-form.tsx"
git commit -m "feat(leads): wizard de 3 pasos para el alta de fuentes"
```

---

### Task 9: Verificación integral, docs y push

**Files:**
- Modify: `CLAUDE.md` (lista de migraciones + nota del wizard)
- Modify: `docs/leads-meta/README.md` (si menciona el alta manual)

- [ ] **Step 1: Suite completa**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: typecheck PASS, tests PASS (todos, no solo leads), build PASS.

- [ ] **Step 2: Verificación e2e local del wizard (manual, con `npm run dev`)**

Requiere `GOOGLE_SERVICE_ACCOUNT_JSON` en `.env.local` (si no está, saltar este paso y anotar que la verificación queda para prod). Con dev server:
1. Login → Leads → Fuentes.
2. Pegar la URL del doc de Fabi → "Leer planilla" → deben listarse "Hoja 1" (ya tiene fuente), "Hoja 2" y "Guía de estados".
3. Elegir "Hoja 2" → paso 2 debe mostrar el header `¡` clasificado como "ID del lead (Meta)" y `Cimentarios` como campo personalizado (renombrable a "Comentarios internos").
4. Paso 3 debe listar los estados reales con etapas sugeridas.
5. Crear → success → NO debe ofrecer de nuevo "Hoja 2".

- [ ] **Step 3: Actualizar docs**

En `CLAUDE.md`, sección Migraciones, agregar al final de la lista:

```
030 — Wizard de fuentes (sheet_status/synced_stage_id en leads, índice único de fuentes activas, contador stage_synced)
```

Y en la sección del módulo Leads, reemplazar el paso 4 del flujo de uso por:

```
4. UI: Leads → Fuentes → pegar la URL → wizard (pestaña → columnas con nombre propio → estados→etapa)
```

- [ ] **Step 4: Commit final + push**

```bash
git add CLAUDE.md docs/leads-meta/README.md
git commit -m "docs: wizard de fuentes y migración 030"
git push origin main
```

(El push dispara el rebuild en Dokploy.)

- [ ] **Step 5: Verificación en producción (requiere env vars — coordinar con el usuario)**

Pendientes de configuración del usuario en Dokploy (del diagnóstico 2026-07-02, siguen faltando):
- `GOOGLE_SERVICE_ACCOUNT_JSON` (y compartir cada planilla con ese email)
- `LEADS_CRON_SECRET` (o `AUTOMATION_CRON_SECRET`)
- Un scheduler que llame `GET /api/leads/sync` con header `x-cron-secret` cada 2-5 min.

Prueba: `curl -H "x-cron-secret: $SECRET" https://appcrm.prevencion-salud.com/api/leads/sync` → JSON con `sources[]` y contadores; en la UI, los leads aparecen en el Kanban en la etapa que dicta su `lead_status`.

---

## Self-review del plan

- **Cobertura del spec:** ColumnMapping ampliado (T1), suggestMapping (T1), etapa inicial (T2), sync con regla humano-manda (T3), migración 030 + dedupe + índice (T4), tabs (T5), preview con errores accionables (T6), alta validada (T7), wizard 3 pasos + encadenado de pestañas (T8), verificación + docs (T9). El spec pedía "eliminar duplicados"; se implementa como desactivación (más segura por FKs) — anotado en la migración.
- **Placeholders:** ninguno; todo step con código completo.
- **Consistencia de tipos:** `createDeal` devuelve `{id, stageId}` en puerto (T2), FakeRepo (T2) y Supabase (T4); `ClaimedLead.sheetStatus/syncedStageId` en los tres; `SyncRunTotals.stageSynced` (T4) usado por el cron (T4); `ColumnSuggestion` (T1) consumido por preview (T6) y wizard (T8).
