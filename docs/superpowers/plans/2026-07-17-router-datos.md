# Router de datos + VBO por capitas — Implementation Plan (v2, post-council)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repartir leads de un pozo común entre asesores elegibles (reciben + bajo su cupo), con reclamo seguro de leads sin trabajar, y mandar a Meta el valor por capitas (VBO). Contador de recibidos **derivado** de eventos con timestamp (sin columna mutable).

**Architecture:** Se extiende la ingesta (`ingest.ts` + puerto `LeadRepository` + adaptador `repository.ts`). El reparto es una única función `assignFromPool` usada por la ingesta Y el reclamo (DRY). "Recibidos en la tanda" se deriva de `activity_log` (`lead_assigned` − `lead_reclaimed` desde `profiles.receiving_since`). VBO agrega `custom_data.value=capitas` en `capi.ts`.

**Tech Stack:** Next.js 16, Supabase (Postgres + RLS), TypeScript strict, Vitest, puerto/adaptador con `FakeRepo`.

## Global Constraints

- **Migraciones aditivas.** Próxima libre = **042**. Aplicar por `run-sql.js` (Management API).
- **Columnas en inglés**, UI en español.
- **Deploy = push a main (Dokploy).** ⚠️ **Cada commit a main DEBE pasar `npm run build` local antes de pushear.** El gate real es build/typecheck, NO Vitest (el FakeRepo da falso verde). Ideal: feature branch + merge solo en verde.
- **Seguridad (041):** cambios sobre otros perfiles por RPC `SECURITY DEFINER` admin-only con `WHERE account_id`, sin owner/self. El router escribe eventos/asignaciones con **service-role** (cron), que bypassea RLS.
- **CAPI compliance:** payload SOLO PII hasheada + metadata + `lead_id` + `custom_data.value`. Nunca respuestas del form ni salud.
- **Contador DERIVADO** (R1): NO existe columna `leads_received_count`.
- **Fuera de alcance:** precio ARS, corrección de valor post-envío, tablero/velocidad/valor-por-adset/tie-breaker meritocrático (fast-follow), SP3, config de Meta.

---

### Task 0 (spike, sin commit): pre-checks

- [ ] **autoAssign:** `SELECT id, name, auto_assign, pipeline_id FROM lead_sources WHERE active = true;` — si `false`, el router no reparte; avisar (es config de la fuente).
- [ ] **Etapa inicial + nombre de "Calificado":**
```sql
SELECT ps.name, ps.position, ps.pipeline_id FROM pipeline_stages ps
JOIN pipelines p ON p.id=ps.pipeline_id
WHERE p.account_id='9b462779-62b3-4784-9a21-26aa2e6bd832' ORDER BY ps.pipeline_id, ps.position;
```
Anotar: etapa `position` mínima = inicial (para el reclamo); nombre exacto de "Calificado" (para el gate de capitas).
- [ ] **Backlog:** `SELECT count(*) FROM deals WHERE account_id='...' AND assigned_agent_id IS NOT NULL;` — dimensiona cuántos históricos existen (el reclamo los excluye por `reclaim_after`, pero conviene saberlo).

---

### Task 1: Migración 042 — schema + RPCs (contador derivado + cupo)

**Files:** Create `supabase/migrations/042_router_datos.sql`

**Interfaces — Produces:** columnas `profiles.receiving_leads`, `profiles.receiving_since`, `profiles.lead_cap`, `deals.capitas`, `lead_capi_config.send_value`; RPCs `set_member_receiving(uuid,boolean)`, `set_member_cap(uuid,integer)`, `reset_member_cycle(uuid)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 042_router_datos.sql — router de datos (pozo común) + VBO por capitas.
-- Contador DERIVADO de activity_log (lead_assigned − lead_reclaimed desde
-- receiving_since); no hay columna de contador mutable.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS receiving_leads BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receiving_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_cap INTEGER;  -- NULL = sin límite

-- Compradores existentes arrancan recibiendo, tanda desde ahora.
UPDATE profiles SET receiving_leads = true, receiving_since = now()
  WHERE is_lead_buyer = true;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS capitas INTEGER;

ALTER TABLE lead_capi_config ADD COLUMN IF NOT EXISTS send_value BOOLEAN NOT NULL DEFAULT false;
UPDATE lead_capi_config SET send_value = true WHERE event_name IN ('calificado', 'closed-won');

-- set_member_receiving: al ACTIVAR, arranca nueva tanda (receiving_since=now()).
CREATE OR REPLACE FUNCTION set_member_receiving(p_user_id UUID, p_receiving BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account UUID; v_role account_role_enum;
BEGIN
  SELECT account_id, account_role INTO v_account, v_role FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE='22023'; END IF;
  IF NOT is_account_member(v_account,'admin') THEN RAISE EXCEPTION 'Solo un admin' USING ERRCODE='42501'; END IF;
  IF v_role='owner' THEN RAISE EXCEPTION 'El dueño no se gestiona por acá' USING ERRCODE='22023'; END IF;
  UPDATE profiles SET receiving_leads = p_receiving,
    receiving_since = CASE WHEN p_receiving THEN now() ELSE receiving_since END,
    updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END; $$;

-- set_member_cap: cupo por asesor (NULL = sin límite).
CREATE OR REPLACE FUNCTION set_member_cap(p_user_id UUID, p_cap INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE='22023'; END IF;
  IF NOT is_account_member(v_account,'admin') THEN RAISE EXCEPTION 'Solo un admin' USING ERRCODE='42501'; END IF;
  IF p_cap IS NOT NULL AND p_cap < 0 THEN RAISE EXCEPTION 'Cupo inválido' USING ERRCODE='22023'; END IF;
  UPDATE profiles SET lead_cap = p_cap, updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END; $$;

-- reset_member_cycle: arranca una tanda nueva SIN borrar historial (mueve receiving_since).
CREATE OR REPLACE FUNCTION reset_member_cycle(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE='22023'; END IF;
  IF NOT is_account_member(v_account,'admin') THEN RAISE EXCEPTION 'Solo un admin' USING ERRCODE='42501'; END IF;
  UPDATE profiles SET receiving_since = now(), updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END; $$;

GRANT EXECUTE ON FUNCTION set_member_receiving(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION set_member_cap(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_member_cycle(UUID) TO authenticated;
```

- [ ] **Step 2: Aplicar** (`node run-sql.js`) → `[]`. Correr 2× (idempotente).
- [ ] **Step 3: Verificar** backfill (`receiving_leads`/`receiving_since` en compradores; `send_value` solo calificado/closed-won).
- [ ] **Step 4: Commit** `feat(router): migración 042 — receiving/cap/capitas/send_value + RPCs`

---

### Task 2 (COMMIT ATÓMICO): puerto + FakeRepo + adaptador

⚠️ **Un solo commit.** Cambiar el puerto sin el adaptador deja `repository.ts` incompatible → build rojo → deploy roto (Dokploy).

**Files:**
- Modify: `src/lib/leads/types.ts` (puerto)
- Create: `src/lib/leads/leads.test-helpers.ts` (mover `FakeRepo` acá, `export`)
- Modify: `src/lib/leads/leads.test.ts` (importar `FakeRepo` desde test-helpers)
- Modify: `src/lib/leads/repository.ts` (adaptador)

**Interfaces — Produces (puerto):**
```typescript
export interface EligibleAgent { userId: string; openDeals: number; }
export interface StaleLead { leadId: string; dealId: string; assignedAgentId: string; }
export type AssignEventKind = "lead_assigned" | "lead_reclaimed";
```
Métodos nuevos/cambiados en `LeadRepository`:
- `listEligibleAgents(): Promise<EligibleAgent[]>` — reemplaza `listAssignableAgents`. Filtra `is_lead_buyer && receiving_leads && !blocked && (lead_cap IS NULL || recibidos_tanda < lead_cap)`. `recibidos_tanda` = `count(lead_assigned) − count(lead_reclaimed)` en activity_log desde `receiving_since`.
- `assignDealIfUnassigned(dealId, userId): Promise<boolean>` — ahora devuelve si asignó.
- `recordAssignEvent(userId, dealId, kind): Promise<void>` — inserta en activity_log.
- `unassignDeal(dealId): Promise<void>`
- `listStaleAssignedLeads(reclaimAfterIso: string): Promise<StaleLead[]>` — deals asignados, en etapa inicial, `created_at > reclaimAfterIso`, **sin actividad post-asignación en activity_log**.

- [ ] **Step 1: Puerto en `types.ts`** — agregar los tipos de arriba; reemplazar `listAssignableAgents(): Promise<AssignableAgent[]>` por `listEligibleAgents(): Promise<EligibleAgent[]>`; cambiar la firma de `assignDealIfUnassigned` a `Promise<boolean>`; agregar `recordAssignEvent`, `unassignDeal`, `listStaleAssignedLeads`. Mantener `AssignableAgent` como alias de `EligibleAgent` si algún import externo lo usa (grep primero). `pickLeastLoaded` queda igual (opera sobre `{userId, openDeals}`).

- [ ] **Step 2: Mover `FakeRepo` a `leads.test-helpers.ts`** — cortar la clase de `leads.test.ts` (línea ~123) a un archivo nuevo con `export class FakeRepo implements LeadRepository`. En `leads.test.ts`, `import { FakeRepo } from "./leads.test-helpers";`. Agregar al Fake:

```typescript
  eligible: EligibleAgent[] = [{ userId: "u1", openDeals: 0 }, { userId: "u2", openDeals: 1 }];
  events: { userId: string; dealId: string; kind: AssignEventKind }[] = [];
  stale: StaleLead[] = [];

  async listEligibleAgents() { return this.eligible; }
  async assignDealIfUnassigned(dealId: string, userId: string): Promise<boolean> {
    const d = this.deals.find((x) => x.id === dealId);
    if (d && !d.assigned) { d.assigned = userId; return true; }
    return false;
  }
  async recordAssignEvent(userId: string, dealId: string, kind: AssignEventKind) {
    this.events.push({ userId, dealId, kind });
  }
  async unassignDeal(dealId: string) {
    const d = this.deals.find((x) => x.id === dealId);
    if (d) d.assigned = undefined;
  }
  async listStaleAssignedLeads() { return this.stale; }
```
Borrar el viejo `listAssignableAgents` del Fake.

- [ ] **Step 3: Adaptador `repository.ts`** — reemplazar `listAssignableAgents` (207-236) por `listEligibleAgents`:

```typescript
    async listEligibleAgents(): Promise<EligibleAgent[]> {
      const { data: members } = await admin
        .from("profiles")
        .select("user_id, lead_cap, receiving_since")
        .eq("account_id", accountId)
        .eq("is_lead_buyer", true)
        .eq("receiving_leads", true)
        .eq("blocked", false);
      const rows = (members ?? []) as { user_id: string; lead_cap: number | null; receiving_since: string | null }[];
      if (rows.length === 0) return [];

      // Carga actual = deals abiertos del pipeline por asesor.
      const { data: openDeals } = await admin
        .from("deals").select("assigned_agent_id")
        .eq("account_id", accountId).eq("pipeline_id", pipelineId)
        .eq("status", "open").not("assigned_agent_id", "is", null);
      const load = new Map<string, number>();
      for (const d of openDeals ?? []) {
        const a = d.assigned_agent_id as string; load.set(a, (load.get(a) ?? 0) + 1);
      }

      const out: EligibleAgent[] = [];
      for (const r of rows) {
        if (r.lead_cap != null) {
          const since = r.receiving_since ?? "1970-01-01";
          const { count: assigned } = await admin.from("activity_log")
            .select("id", { count: "exact", head: true })
            .eq("user_id", r.user_id).eq("action", "lead_assigned").gte("created_at", since);
          const { count: reclaimed } = await admin.from("activity_log")
            .select("id", { count: "exact", head: true })
            .eq("user_id", r.user_id).eq("action", "lead_reclaimed").gte("created_at", since);
          const received = (assigned ?? 0) - (reclaimed ?? 0);
          if (received >= r.lead_cap) continue; // auto-apagado por cupo
        }
        out.push({ userId: r.user_id, openDeals: load.get(r.user_id) ?? 0 });
      }
      return out;
    },
```
Reemplazar `assignDealIfUnassigned` (238-245) para devolver boolean (`.select("id")` → `return (data?.length ?? 0) > 0`). Agregar:

```typescript
    async recordAssignEvent(userId, dealId, kind) {
      await admin.from("activity_log").insert({
        account_id: accountId, user_id: userId, deal_id: dealId, action: kind, meta: {},
      });
    },
    async unassignDeal(dealId) {
      const { error } = await admin.from("deals").update({ assigned_agent_id: null }).eq("id", dealId);
      if (error) throw error;
    },
    async listStaleAssignedLeads(reclaimAfterIso) {
      const { data: initial } = await admin.from("pipeline_stages")
        .select("id").eq("pipeline_id", pipelineId).order("position", { ascending: true }).limit(1).maybeSingle();
      const initialStageId = initial?.id as string | undefined;
      if (!initialStageId) return [];
      const cutoffIso = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
      const { data: deals } = await admin.from("deals")
        .select("id, assigned_agent_id, created_at")
        .eq("account_id", accountId).eq("pipeline_id", pipelineId).eq("stage_id", initialStageId)
        .not("assigned_agent_id", "is", null)
        .gt("created_at", reclaimAfterIso)   // gate: excluye backlog histórico
        .lt("created_at", cutoffIso)          // más viejo que el umbral de reclamo
        .limit(RECLAIM_BATCH);                // batch limit
      const out: StaleLead[] = [];
      for (const d of deals ?? []) {
        // "Trabajado" = cualquier evento en activity_log para el deal DESPUÉS de crearse.
        const { count } = await admin.from("activity_log")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", d.id as string).gt("created_at", d.created_at as string);
        if ((count ?? 0) > 0) continue;
        const { data: lead } = await admin.from("leads").select("id").eq("deal_id", d.id as string).maybeSingle();
        if (lead) out.push({ leadId: lead.id as string, dealId: d.id as string, assignedAgentId: d.assigned_agent_id as string });
      }
      return out;
    },
```
Agregar constantes arriba del factory: `const STALE_DAYS = 3;` y `const RECLAIM_BATCH = 50;`. Importar `EligibleAgent`, `StaleLead`, `AssignEventKind`.

- [ ] **Step 4: Correr tests existentes + typecheck + build**

Run: `npx vitest run src/lib/leads && npm run typecheck && npm run build`
Expected: los tests de ingest siguen pasando (el Fake ahora tiene `listEligibleAgents`); build en verde. Si `ingest.ts` todavía llama `listAssignableAgents`, **arreglarlo en este mismo commit** (ver Task 3 Step 3, pero el rename mínimo va acá para que compile).

- [ ] **Step 5: Commit atómico**

```bash
git add src/lib/leads/types.ts src/lib/leads/leads.test-helpers.ts src/lib/leads/leads.test.ts src/lib/leads/repository.ts src/lib/leads/ingest.ts
git commit -m "feat(router): puerto+adaptador+FakeRepo — pool elegible por cupo (derivado)"
```

---

### Task 3: `assignFromPool` (DRY) + wire en la ingesta

**Files:** Create `src/lib/leads/assign.ts`; Modify `src/lib/leads/ingest.ts:104-111`; Test `src/lib/leads/assign.test.ts`

**Interfaces — Produces:** `assignFromPool(repo, dealId, excludeUserId?): Promise<string | null>` — lista elegibles (excluyendo `excludeUserId`), elige least-loaded, asigna, registra `lead_assigned`, devuelve el userId asignado o null.

- [ ] **Step 1: Test (falla)**

```typescript
import { describe, it, expect } from "vitest";
import { assignFromPool } from "./assign";
import { FakeRepo } from "./leads.test-helpers";

describe("assignFromPool", () => {
  it("asigna al least-loaded y registra el evento", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d1" } as never);
    const who = await assignFromPool(repo, "d1");
    expect(who).toBe("u1"); // openDeals 0
    expect(repo.events).toContainEqual({ userId: "u1", dealId: "d1", kind: "lead_assigned" });
  });
  it("excluye al asesor indicado (reclamo)", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d2" } as never);
    const who = await assignFromPool(repo, "d2", "u1");
    expect(who).toBe("u2");
  });
  it("devuelve null si no hay elegibles", async () => {
    const repo = new FakeRepo();
    repo.eligible = [];
    repo.deals.push({ id: "d3" } as never);
    expect(await assignFromPool(repo, "d3")).toBeNull();
  });
});
```

- [ ] **Step 2: Correr (falla)** — `npx vitest run src/lib/leads/assign.test.ts` → FAIL.

- [ ] **Step 3: Implementar `assign.ts`**

```typescript
import type { LeadRepository } from "./types";
import { pickLeastLoaded } from "./ingest";

/** Reparto único (ingesta y reclamo). Asigna el deal al asesor elegible menos
 *  cargado (excluyendo `excludeUserId`), registra el evento y devuelve su id. */
export async function assignFromPool(
  repo: LeadRepository, dealId: string, excludeUserId?: string,
): Promise<string | null> {
  const agents = (await repo.listEligibleAgents()).filter((a) => a.userId !== excludeUserId);
  const pick = pickLeastLoaded(agents);
  if (!pick) return null;
  const ok = await repo.assignDealIfUnassigned(dealId, pick.userId);
  if (!ok) return null;
  await repo.recordAssignEvent(pick.userId, dealId, "lead_assigned");
  return pick.userId;
}
```

- [ ] **Step 4: Wire en `ingest.ts`** — reemplazar el bloque 104-111 por:

```typescript
  // 4. Asignación least-loaded (idempotente + registra el evento de tanda).
  if (opts.autoAssign) {
    await assignFromPool(repo, dealId);
  }
```
Import: `import { assignFromPool } from "./assign";`. Si quedó un `import { AssignableAgent }` sin uso en ingest.ts, quitarlo. `pickLeastLoaded` sigue exportado (lo usa assign.ts).

- [ ] **Step 5: Correr + typecheck** — `npx vitest run src/lib/leads && npm run typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(router): assignFromPool (DRY) + wire en la ingesta`

---

### Task 4: Reclamo seguro (`reclaimStaleLeads`) con dry-run

**Files:** Create `src/lib/leads/reclaim.ts`; Test `src/lib/leads/reclaim.test.ts`

**Interfaces — Produces:** `reclaimStaleLeads(repo, opts: { reclaimAfterIso: string; dryRun: boolean }): Promise<{ candidates: number; reclaimed: number; reassigned: number }>`.

- [ ] **Step 1: Test (falla)**

```typescript
import { describe, it, expect } from "vitest";
import { reclaimStaleLeads } from "./reclaim";
import { FakeRepo } from "./leads.test-helpers";

const OPTS = { reclaimAfterIso: "2000-01-01T00:00:00Z", dryRun: false };

describe("reclaimStaleLeads", () => {
  it("dry-run: cuenta candidatos pero NO reasigna", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d1", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l1", dealId: "d1", assignedAgentId: "u1" }];
    const res = await reclaimStaleLeads(repo, { ...OPTS, dryRun: true });
    expect(res.candidates).toBe(1);
    expect(res.reclaimed).toBe(0);
    expect(repo.deals[0].assigned).toBe("u1"); // intacto
  });
  it("reasigna a otro y registra reclaim+assign", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d1", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l1", dealId: "d1", assignedAgentId: "u1" }];
    const res = await reclaimStaleLeads(repo, OPTS);
    expect(res.reclaimed).toBe(1);
    expect(res.reassigned).toBe(1);
    expect(repo.deals[0].assigned).toBe("u2");
    expect(repo.events).toContainEqual({ userId: "u1", dealId: "d1", kind: "lead_reclaimed" });
    expect(repo.events).toContainEqual({ userId: "u2", dealId: "d1", kind: "lead_assigned" });
  });
  it("sin otro elegible: reclama pero queda sin asignar", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d2", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l2", dealId: "d2", assignedAgentId: "u1" }];
    repo.eligible = [{ userId: "u1", openDeals: 0 }]; // solo el original
    const res = await reclaimStaleLeads(repo, OPTS);
    expect(res.reclaimed).toBe(1);
    expect(res.reassigned).toBe(0);
    expect(repo.deals[0].assigned).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr (falla).**

- [ ] **Step 3: Implementar `reclaim.ts`**

```typescript
import type { LeadRepository } from "./types";
import { assignFromPool } from "./assign";

/** Devuelve al pozo los leads sin trabajar y los reasigna a otro elegible.
 *  El contador es derivado, así que el evento lead_reclaimed ya "descuenta"
 *  al original y lead_assigned "suma" al nuevo (los emite assignFromPool y este). */
export async function reclaimStaleLeads(
  repo: LeadRepository,
  opts: { reclaimAfterIso: string; dryRun: boolean },
): Promise<{ candidates: number; reclaimed: number; reassigned: number }> {
  const stale = await repo.listStaleAssignedLeads(opts.reclaimAfterIso);
  if (opts.dryRun) return { candidates: stale.length, reclaimed: 0, reassigned: 0 };

  let reclaimed = 0, reassigned = 0;
  for (const s of stale) {
    await repo.unassignDeal(s.dealId);
    await repo.recordAssignEvent(s.assignedAgentId, s.dealId, "lead_reclaimed");
    reclaimed++;
    const who = await assignFromPool(repo, s.dealId, s.assignedAgentId);
    if (who) reassigned++;
  }
  return { candidates: stale.length, reclaimed, reassigned };
}
```

- [ ] **Step 4: Correr + typecheck** → PASS.
- [ ] **Step 5: Commit** `feat(router): reclaimStaleLeads con dry-run + gate temporal`

---

### Task 5: Wire del reclamo en el cron (log-only primero)

**Files:** Modify `src/app/api/leads/sync/route.ts`

- [ ] **Step 1:** Import `import { reclaimStaleLeads } from "@/lib/leads/reclaim";`. Definir la constante de gate (fecha de deploy del feature, en UTC) arriba del handler:

```typescript
// Reclamo: solo sobre leads creados desde que el feature está vivo (excluye el
// backlog histórico). Actualizar a la fecha real de deploy.
const RECLAIM_AFTER_ISO = "2026-07-18T00:00:00Z";
const RECLAIM_DRY_RUN = true; // ⚠️ arrancar en true; pasar a false tras revisar logs.
```

- [ ] **Step 2:** Donde ya existe el `repo` por fuente (instanciado con `createLeadRepository(admin, source)`), después de los loops de ingesta y antes/después de `reconcileAllCapi`:

```typescript
    const reclaim = await reclaimStaleLeads(repo, {
      reclaimAfterIso: RECLAIM_AFTER_ISO, dryRun: RECLAIM_DRY_RUN,
    });
    console.log(`[sync] reclaim candidates=${reclaim.candidates} reclaimed=${reclaim.reclaimed} reassigned=${reclaim.reassigned} (dryRun=${RECLAIM_DRY_RUN})`);
```

- [ ] **Step 3:** `npm run typecheck && npm run build` → verde.
- [ ] **Step 4: Commit** `feat(router): correr reclaim en el cron (log-only)`
- [ ] **Step 5 (post-deploy, MANUAL):** revisar logs 1-2 días; si `candidates` es razonable, cambiar `RECLAIM_DRY_RUN=false` en un commit aparte.

---

### Task 6: VBO — `custom_data.value = capitas` (sin default basura)

**Files:** Modify `src/lib/leads/capi.ts`; Test `src/lib/leads/capi.test.ts`

- [ ] **Step 1: Test (falla)**

```typescript
import { describe, it, expect } from "vitest";
import { buildEventPayload } from "./capi";
const base = { datasetId:"d", accessToken:"t", eventName:"calificado", eventId:"l1:calificado", eventTimeSec:1, userData:{}, leadId:"l:5" };
describe("buildEventPayload — VBO", () => {
  it("manda custom_data.value con capitas", () => {
    expect(buildEventPayload({ ...base, value: 4 }).data[0].custom_data).toEqual({ value: 4, currency: "ARS" });
  });
  it("SIN custom_data si value es null (nunca sella value=1)", () => {
    expect(buildEventPayload({ ...base, value: null }).data[0].custom_data).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr (falla).**

- [ ] **Step 3: Implementar** — en `SendConversionInput` agregar `value?: number | null;`. En `buildEventPayload`, armar el evento como objeto y agregar `custom_data` solo si `value != null`:

```typescript
  const event: Record<string, unknown> = {
    event_name: input.eventName, event_time: input.eventTimeSec,
    event_id: input.eventId, action_source: "system_generated", user_data,
  };
  if (input.value != null) event.custom_data = { value: input.value, currency: "ARS" };
  return { data: [event] };
```

- [ ] **Step 4: Pasar el value en `reconcileCapiForAccount`** — traer `capitas`:
```typescript
  const { data: deals } = await admin.from("deals").select("id, capitas")
    .eq("account_id", config.account_id).in("stage_id", stageIds);
  const capitasByDeal = new Map<string, number | null>(
    (deals ?? []).map((d) => [d.id as string, (d.capitas as number | null) ?? null]));
```
Agregar `send_value: boolean` a `CapiConfigRow` y al `.select(...)` de `reconcileAllCapi`. En el `sendConversion({...})`:
```typescript
      // Solo eventos de valor (send_value) Y con capitas cargadas. Si null,
      // NO se manda value (nunca se sella value=1 basura).
      value: config.send_value ? (capitasByDeal.get(lead.deal_id as string) ?? null) : null,
```

- [ ] **Step 5: Correr + typecheck** → PASS.
- [ ] **Step 6: Commit** `feat(vbo): custom_data.value=capitas (omite si null; nunca default 1)`

---

### Task 7: API de miembros (recepción + cupo + recibidos derivado)

**Files:** Modify `src/app/api/account/members/route.ts` (GET) y `src/app/api/account/members/[userId]/route.ts` (PATCH)

- [ ] **Step 1: GET** — agregar al `.select(...)` de profiles: `receiving_leads, lead_cap, receiving_since`. Calcular `received_this_cycle` por miembro (query a activity_log: `lead_assigned − lead_reclaimed` desde `receiving_since`; si no tiene `receiving_since`, 0). Devolver en cada member: `receiving_leads`, `lead_cap`, `received_this_cycle`.

- [ ] **Step 2: PATCH** — agregar ramas (junto a `allowed_modules`/`blocked`):
```typescript
    if (body && "receiving" in body) {
      if (typeof body.receiving !== "boolean") return NextResponse.json({ error: "'receiving' debe ser boolean" }, { status: 400 });
      const { error } = await ctx.supabase.rpc("set_member_receiving", { p_user_id: userId, p_receiving: body.receiving });
      if (error) return rpcErrorToResponse(error);
      return NextResponse.json({ ok: true });
    }
    if (body && "lead_cap" in body) {
      const cap = body.lead_cap;
      if (cap !== null && (typeof cap !== "number" || cap < 0)) return NextResponse.json({ error: "'lead_cap' debe ser número ≥ 0 o null" }, { status: 400 });
      const { error } = await ctx.supabase.rpc("set_member_cap", { p_user_id: userId, p_cap: cap });
      if (error) return rpcErrorToResponse(error);
      return NextResponse.json({ ok: true });
    }
    if (body && body.reset_cycle === true) {
      const { error } = await ctx.supabase.rpc("reset_member_cycle", { p_user_id: userId });
      if (error) return rpcErrorToResponse(error);
      return NextResponse.json({ ok: true });
    }
```

- [ ] **Step 3:** `npm run typecheck && npm run build` → verde.
- [ ] **Step 4: Commit** `feat(router): API miembros — recepción/cupo/recibidos derivado`

---

### Task 8: UI admin en Miembros (toggle + cupo + recibidos + reset)

**Files:** Modify `src/components/settings/member-access-controls.tsx`, `src/components/settings/members-tab.tsx`

- [ ] **Step 1:** Agregar props `receiving: boolean`, `leadCap: number | null`, `receivedThisCycle: number`. Renderizar (reusando el helper `patch()` existente):
  - Toggle "Recibe leads" (PATCH `{ receiving: !receiving }`).
  - Chip `"{receivedThisCycle}{leadCap != null ? '/'+leadCap : ''} recibidos"` + botón "reset" (PATCH `{ reset_cycle: true }`).
  - Input numérico de cupo (o "sin límite") que hace PATCH `{ lead_cap: value }` on blur/enter, con validación cliente (entero ≥ 0 o vacío=null).
- [ ] **Step 2:** En `members-tab.tsx`, agregar `receiving_leads`, `lead_cap`, `received_this_cycle` a la `Member` interface y pasarlos a `<MemberAccessControls .../>`.
- [ ] **Step 3:** `npm run typecheck && npm run build && npx vitest run` → todo verde.
- [ ] **Step 4: Commit** `feat(router): UI miembros — recepción + cupo + recibidos`

---

### Task 9: Captura de capitas (validada, requisito para Calificado)

**Files:** Modify `src/components/contacts/contact-detail-view.tsx`; `src/app/(dashboard)/leads/stage-select.tsx`

- [ ] **Step 1:** Campo numérico "Capitas" en la sección del deal (input `min=1 max=20 step=1`), que valida y hace `supabase.from('deals').update({ capitas }).eq('id', primary.id)`. Sembrar el valor actual en el fetch de deals (`select` agrega `capitas`).
- [ ] **Step 2:** En el handler de cambio de etapa (contact-detail-view `changeStage` y `stage-select.tsx`), si la etapa destino es "Calificado" (nombre exacto del Task 0) y el deal no tiene `capitas` válida (1–20), **bloquear el cambio** con un aviso ("Cargá las capitas antes de calificar") — un diálogo/campo inline, NO `window.prompt`. Recién con capitas válida se confirma el movimiento. Esto garantiza que el value esté antes de que el cron selle el evento.
- [ ] **Step 3:** `npm run typecheck && npm run build` → verde.
- [ ] **Step 4: Commit** `feat(vbo): capturar capitas validada; requisito para Calificado`

---

### Task 10: Verificación en vivo (RLS + smoke)

- [ ] **RPCs admin-only:** simular como `agent` (SET ROLE authenticated + jwt sub) → `set_member_receiving`/`set_member_cap`/`reset_member_cycle` sobre otro fallan `42501`; como admin OK.
- [ ] **Pool + cupo:** poner `lead_cap` bajo a un comprador, insertar N eventos `lead_assigned` de prueba en activity_log, confirmar que `listEligibleAgents` (query equivalente) lo excluye al llegar al cupo. Limpiar los eventos de prueba.
- [ ] **Reclaim gate:** confirmar que un deal viejo (`created_at < RECLAIM_AFTER_ISO`) NO aparece en `listStaleAssignedLeads`.
- [ ] **VBO:** setear `deals.capitas=4` en un deal en Calificado, forzar cron, verificar `lead_capi_events.response` (fbtrace) + `ads_get_dataset_stats`. Con capitas null → confirmar que el evento sale SIN value.
- [ ] **Revertir** todos los datos de prueba.

---

## Self-Review (cobertura vs spec + revisiones)

- **R1 contador derivado:** Task 1 (receiving_since, sin columna de contador) + Task 2 (listEligibleAgents deriva) + Task 7 (GET deriva received_this_cycle). ✔
- **R2 cupo + auto-apagado:** Task 1 (lead_cap + set_member_cap) + Task 2 (filtro) + Task 8 (UI). ✔
- **R3 assignFromPool único:** Task 3 (ingesta) + Task 4 (reclamo lo reusa). ✔
- **R4 reclamo seguro:** Task 2 (gate reclaimAfter + worked-vía-activity_log + batch) + Task 4 (dry-run) + Task 5 (log-only primero). ✔
- **R5 capitas validada + sin default 1:** Task 6 (omite value si null) + Task 9 (campo validado + requisito). ✔
- **R6 commit atómico + build-gate:** Task 2 atómica; build-gate en cada tarea. ✔
- **Diferido** (tablero/velocidad/valor-adset/tie-breaker): sin tareas — correcto; la base (eventos) queda en Task 2/3/4.

**Riesgos residuales anotados:**
- El derivado de `received_this_cycle` hace 2 counts a activity_log por asesor con cupo (pocos asesores → ok).
- `listStaleAssignedLeads` hace 1 count de actividad por candidato (batch=50 acota el N+1).
- `value=capitas` con `currency:'ARS'` es señal relativa, no pesos (aceptado; documentado).
- El gate `RECLAIM_AFTER_ISO` es una constante — recordar setearla a la fecha real de deploy.
