# Router de datos + VBO por capitas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repartir los leads de un pozo común entre los asesores que están recibiendo (con cupo manual y reclamo de leads sin trabajar), y mandar a Meta el valor por capitas para optimización por valor (VBO).

**Architecture:** Se extiende la ingesta existente (puerto `LeadRepository` + `ingest.ts`, adaptador `repository.ts`) para filtrar el pool por `receiving_leads` y llevar un contador de recibidos; un paso nuevo de reclamo corre en el cron `/api/leads/sync`; y `capi.ts` agrega `custom_data.value = capitas` al payload. Toda la config nueva vive en la migración 042 (columnas + RPCs admin-only, patrón de la 039/018).

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS), TypeScript strict, Vitest. Puerto/adaptador con `FakeRepo` en memoria para tests de dominio.

## Global Constraints

- **TZ / fechas:** el cron corre con `TZ=America/Argentina/Cordoba`. Usar `new Date()` server-side; no depender de la TZ del cliente.
- **Migraciones aditivas, numeradas.** Próxima libre = **042**. Aplicar vía el `run-sql.js` del scratchpad (Management API) y dejar el archivo en `supabase/migrations/`.
- **Columnas en inglés** (convención: `is_lead_buyer`, `blocked`); **UI en español** ("Recibe leads", "N recibidos").
- **Seguridad (contención 041):** `is_account_member` excluye bloqueados; cambios sobre OTROS perfiles van por RPC `SECURITY DEFINER` admin-only con `WHERE account_id`, nunca al owner ni a sí mismo. El contador lo toca solo el service-role del router.
- **CAPI compliance (B8):** el payload lleva SOLO PII hasheada (allowlist) + metadata + `lead_id` + ahora `custom_data.value`. JAMÁS respuestas del formulario ni datos de salud.
- **Fuera de alcance:** precio ARS por deal, corrección de valor post-envío, venta de datos (SP3), config de Meta (form global, activar Value Optimization en el adset).

---

### Task 0 (prerrequisito, sin código): verificar autoAssign

**Files:** ninguno (verificación).

- [ ] **Step 1:** Confirmar si la fuente activa tiene `auto_assign = true`. Correr en el scratchpad:

```sql
SELECT id, name, kind, auto_assign, pipeline_id FROM lead_sources WHERE active = true;
```

Expected: ver el/los `lead_sources` activos y su `auto_assign`. Si `auto_assign=false`, el router MVP **no reparte** — anotar y avisar al usuario (es una decisión de config de la fuente, no de este plan). El resto del plan asume que se activará.

- [ ] **Step 2:** Confirmar la etapa inicial del pipeline (para el reclamo). Correr:

```sql
SELECT ps.id, ps.name, ps.position, ps.pipeline_id
FROM pipeline_stages ps
JOIN pipelines p ON p.id = ps.pipeline_id
WHERE p.account_id = '9b462779-62b3-4784-9a21-26aa2e6bd832'
ORDER BY ps.pipeline_id, ps.position;
```

Expected: la etapa `position` mínima por pipeline es "Nuevo" (la inicial). Anotar su nombre exacto — el reclamo la usa.

---

### Task 1: Migración 042 — schema + RPCs

**Files:**
- Create: `supabase/migrations/042_router_datos.sql`
- Test: verificación SQL en el scratchpad (no hay tests unitarios de SQL en el repo).

**Interfaces:**
- Produces: columnas `profiles.receiving_leads BOOLEAN`, `profiles.leads_received_count INTEGER`, `deals.capitas INTEGER`, `lead_capi_config.send_value BOOLEAN`; RPCs `set_member_receiving(uuid, boolean)`, `reset_member_lead_count(uuid)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 042_router_datos.sql — router de datos (pozo común) + VBO por capitas.
--
-- profiles.receiving_leads      — el asesor entra a la fila de reparto.
-- profiles.leads_received_count — contador de recibidos (cupo manual).
-- deals.capitas                 — vidas cubiertas; alimenta custom_data.value.
-- lead_capi_config.send_value   — si esta regla manda value=capitas.
--
-- RPCs admin-only (patrón 039/018): set_member_receiving / reset_member_lead_count.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS receiving_leads BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leads_received_count INTEGER NOT NULL DEFAULT 0;

-- Preservar comportamiento actual: los compradores existentes arrancan
-- recibiendo; los nuevos arrancan apagados hasta que el admin los active.
UPDATE profiles SET receiving_leads = true WHERE is_lead_buyer = true;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS capitas INTEGER;

ALTER TABLE lead_capi_config
  ADD COLUMN IF NOT EXISTS send_value BOOLEAN NOT NULL DEFAULT false;

-- Los eventos "positivos" llevan el valor; no-calificado/perdido no.
UPDATE lead_capi_config SET send_value = true
  WHERE event_name IN ('calificado', 'closed-won');

-- ------------------------------------------------------------
-- set_member_receiving(p_user_id, p_receiving) — admin+ prende/apaga la
-- recepción de un miembro. Al ACTIVAR resetea el contador (nueva tanda).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_member_receiving(p_user_id UUID, p_receiving BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_role account_role_enum;
BEGIN
  SELECT account_id, account_role INTO v_account, v_role
    FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Solo un admin puede configurar la recepción' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'El dueño no se gestiona por acá' USING ERRCODE = '22023';
  END IF;
  UPDATE profiles
    SET receiving_leads = p_receiving,
        leads_received_count = CASE WHEN p_receiving THEN 0 ELSE leads_received_count END,
        updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END;
$$;

-- ------------------------------------------------------------
-- reset_member_lead_count(p_user_id) — admin+ resetea el contador a 0.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reset_member_lead_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'Solo un admin puede resetear el contador' USING ERRCODE = '42501';
  END IF;
  UPDATE profiles
    SET leads_received_count = 0, updated_at = now()
    WHERE user_id = p_user_id AND account_id = v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION set_member_receiving(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_member_lead_count(UUID) TO authenticated;
```

- [ ] **Step 2: Aplicar la migración**

Run (desde el scratchpad): `node run-sql.js <copia de 042_router_datos.sql>`
Expected: `[]` (éxito). Correr dos veces para confirmar idempotencia (IF NOT EXISTS / CREATE OR REPLACE).

- [ ] **Step 3: Verificar**

```sql
SELECT count(*) FILTER (WHERE receiving_leads) AS recibiendo,
       count(*) FILTER (WHERE is_lead_buyer) AS compradores
FROM profiles WHERE account_id = '9b462779-62b3-4784-9a21-26aa2e6bd832';
SELECT event_name, send_value FROM lead_capi_config
WHERE account_id = '9b462779-62b3-4784-9a21-26aa2e6bd832' ORDER BY event_name;
```
Expected: `recibiendo == compradores` (backfill correcto); `send_value=true` solo en calificado/closed-won.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/042_router_datos.sql
git commit -m "feat(router): migración 042 — receiving_leads + capitas + send_value + RPCs"
```

---

### Task 2: Extender el puerto `LeadRepository` + `FakeRepo`

**Files:**
- Modify: `src/lib/leads/types.ts` (el puerto)
- Modify: `src/lib/leads/leads.test.ts:123` (FakeRepo)

**Interfaces:**
- Produces (nuevas firmas del puerto):
  - `assignDealIfUnassigned(dealId, userId): Promise<boolean>` — ahora **devuelve si realmente asignó** (para incrementar el contador solo una vez).
  - `incrementReceivedCount(userId: string): Promise<void>`
  - `decrementReceivedCount(userId: string): Promise<void>`
  - `listStaleAssignedLeads(): Promise<StaleLead[]>` — leads asignados, en etapa inicial, sin nota, con deal más viejo que el umbral.
  - `unassignDeal(dealId: string): Promise<void>`
  - Nuevo tipo `StaleLead { leadId: string; dealId: string; assignedAgentId: string }`.

- [ ] **Step 1: Actualizar el puerto en `types.ts`**

Cambiar la firma de `assignDealIfUnassigned` (línea ~193-194) a que devuelva boolean, y agregar los métodos + tipo:

```typescript
/** Un lead asignado pero sin trabajar, candidato a reclamo. */
export interface StaleLead {
  leadId: string;
  dealId: string;
  assignedAgentId: string;
}
```

En `interface LeadRepository`, reemplazar la firma de `assignDealIfUnassigned` y agregar:

```typescript
  /** Asigna el deal solo si está sin asignar. Devuelve true si asignó. */
  assignDealIfUnassigned(dealId: string, userId: string): Promise<boolean>;

  /** +1 al contador de recibidos del asesor (cupo). */
  incrementReceivedCount(userId: string): Promise<void>;

  /** -1 al contador (el asesor devolvió un lead por reclamo). */
  decrementReceivedCount(userId: string): Promise<void>;

  /** Leads asignados, en etapa inicial, sin nota, con deal más viejo que el
   *  umbral de reclamo (config del adaptador). */
  listStaleAssignedLeads(): Promise<StaleLead[]>;

  /** Devuelve un deal al pozo (assigned_agent_id = null). */
  unassignDeal(dealId: string): Promise<void>;
```

- [ ] **Step 2: Actualizar el `FakeRepo` en `leads.test.ts`**

Agregar estado + implementar los métodos nuevos, y hacer que `assignDealIfUnassigned` devuelva boolean:

```typescript
  received = new Map<string, number>();
  stale: StaleLead[] = [];

  async assignDealIfUnassigned(dealId: string, userId: string): Promise<boolean> {
    const d = this.deals.find((x) => x.id === dealId);
    if (d && !d.assigned) { d.assigned = userId; return true; }
    return false;
  }
  async incrementReceivedCount(userId: string): Promise<void> {
    this.received.set(userId, (this.received.get(userId) ?? 0) + 1);
  }
  async decrementReceivedCount(userId: string): Promise<void> {
    this.received.set(userId, (this.received.get(userId) ?? 0) - 1);
  }
  async listStaleAssignedLeads(): Promise<StaleLead[]> {
    return this.stale;
  }
  async unassignDeal(dealId: string): Promise<void> {
    const d = this.deals.find((x) => x.id === dealId);
    if (d) d.assigned = undefined;
  }
```

Importar `StaleLead` en el bloque de imports del test.

- [ ] **Step 3: Correr los tests existentes (deben seguir pasando)**

Run: `npx vitest run src/lib/leads`
Expected: PASS (la firma boolean no rompe los tests actuales — no leen el retorno).

- [ ] **Step 4: Commit**

```bash
git add src/lib/leads/types.ts src/lib/leads/leads.test.ts
git commit -m "feat(router): extender puerto LeadRepository (contador + reclamo)"
```

---

### Task 3: Contador de recibidos en la auto-asignación

**Files:**
- Modify: `src/lib/leads/ingest.ts:104-111`
- Test: `src/lib/leads/leads.test.ts`

**Interfaces:**
- Consumes: `repo.assignDealIfUnassigned(): Promise<boolean>`, `repo.incrementReceivedCount()`.

- [ ] **Step 1: Escribir el test (falla)**

```typescript
it("incrementa el contador del asesor al auto-asignar", async () => {
  const repo = new FakeRepo();
  await ingestLead(repo, makeLead("l:900"), { autoAssign: true });
  // u1 es el least-loaded del FakeRepo (openDeals 0).
  expect(repo.received.get("u1")).toBe(1);
});

it("no incrementa si el deal ya estaba asignado (idempotente)", async () => {
  const repo = new FakeRepo();
  await ingestLead(repo, makeLead("l:901"), { autoAssign: true });
  // Segundo ciclo sobre el mismo lead: assign devuelve false → sin +1.
  await ingestLead(repo, makeLead("l:901"), { autoAssign: true });
  expect(repo.received.get("u1")).toBe(1);
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `npx vitest run src/lib/leads -t "contador"`
Expected: FAIL (hoy no se incrementa).

- [ ] **Step 3: Implementar en `ingest.ts`**

Reemplazar el bloque de asignación (líneas 104-111):

```typescript
  // 4. Asignación least-loaded (idempotente: solo si sin asignar). El
  //    contador de recibidos solo sube cuando la asignación realmente pasa.
  if (opts.autoAssign) {
    const agents = await repo.listAssignableAgents();
    const pick = pickLeastLoaded(agents);
    if (pick) {
      const assigned = await repo.assignDealIfUnassigned(dealId, pick.userId);
      if (assigned) await repo.incrementReceivedCount(pick.userId);
    }
  }
```

- [ ] **Step 4: Correr (debe pasar)**

Run: `npx vitest run src/lib/leads`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/ingest.ts src/lib/leads/leads.test.ts
git commit -m "feat(router): contar recibidos al auto-asignar (cupo)"
```

---

### Task 4: Filtro `receiving_leads` + contador en el adaptador Supabase

**Files:**
- Modify: `src/lib/leads/repository.ts:207-245` (listAssignableAgents, assignDealIfUnassigned) + agregar los métodos nuevos.

**Interfaces:**
- Consumes: columnas de la migración 042.
- Produces: las implementaciones reales de los métodos del puerto agregados en Task 2.

> Nota: el adaptador Supabase no tiene tests unitarios (usa el cliente real); su corrección se valida por el typecheck + la verificación en vivo (Task 9). El dominio ya quedó cubierto por el FakeRepo.

- [ ] **Step 1: `listAssignableAgents` filtra por `receiving_leads`**

En `repository.ts:208-212`, agregar el filtro:

```typescript
      const { data: members, error } = await admin
        .from("profiles")
        .select("user_id")
        .eq("account_id", accountId)
        .eq("is_lead_buyer", true)
        .eq("receiving_leads", true);
```

- [ ] **Step 2: `assignDealIfUnassigned` devuelve boolean**

Reemplazar el método (líneas 238-245):

```typescript
    async assignDealIfUnassigned(dealId, userId): Promise<boolean> {
      const { data, error } = await admin
        .from("deals")
        .update({ assigned_agent_id: userId })
        .eq("id", dealId)
        .is("assigned_agent_id", null)
        .select("id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
```

- [ ] **Step 3: Agregar los métodos nuevos al adaptador**

Después de `assignDealIfUnassigned`, agregar:

```typescript
    async incrementReceivedCount(userId) {
      // +1 atómico vía RPC de incremento no existe; usamos un update
      // leído-y-escrito bajo service-role (baja concurrencia del cron).
      const { data } = await admin
        .from("profiles")
        .select("leads_received_count")
        .eq("user_id", userId)
        .maybeSingle();
      const next = ((data?.leads_received_count as number | null) ?? 0) + 1;
      await admin.from("profiles").update({ leads_received_count: next }).eq("user_id", userId);
    },

    async decrementReceivedCount(userId) {
      const { data } = await admin
        .from("profiles")
        .select("leads_received_count")
        .eq("user_id", userId)
        .maybeSingle();
      const next = Math.max(0, ((data?.leads_received_count as number | null) ?? 0) - 1);
      await admin.from("profiles").update({ leads_received_count: next }).eq("user_id", userId);
    },

    async unassignDeal(dealId) {
      const { error } = await admin
        .from("deals")
        .update({ assigned_agent_id: null })
        .eq("id", dealId);
      if (error) throw error;
    },

    async listStaleAssignedLeads() {
      // Etapa inicial = la de menor position en el pipeline de la fuente.
      const { data: initial } = await admin
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      const initialStageId = initial?.id as string | undefined;
      if (!initialStageId) return [];

      const cutoffIso = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
      // Deals asignados, aún en la etapa inicial, más viejos que el umbral.
      const { data: deals } = await admin
        .from("deals")
        .select("id, assigned_agent_id, contact_id")
        .eq("account_id", accountId)
        .eq("pipeline_id", pipelineId)
        .eq("stage_id", initialStageId)
        .not("assigned_agent_id", "is", null)
        .lt("created_at", cutoffIso);

      const out: StaleLead[] = [];
      for (const d of deals ?? []) {
        const contactId = d.contact_id as string | null;
        // "Trabajado" = tiene al menos una nota. Sin nota → sin trabajar.
        if (contactId) {
          const { count } = await admin
            .from("contact_notes")
            .select("id", { count: "exact", head: true })
            .eq("contact_id", contactId);
          if ((count ?? 0) > 0) continue;
        }
        const { data: lead } = await admin
          .from("leads")
          .select("id")
          .eq("deal_id", d.id as string)
          .maybeSingle();
        if (lead) {
          out.push({
            leadId: lead.id as string,
            dealId: d.id as string,
            assignedAgentId: d.assigned_agent_id as string,
          });
        }
      }
      return out;
    },
```

Agregar la constante arriba del factory (junto a `DEAL_CURRENCY`):

```typescript
/** Días sin trabajar antes de reclamar un lead al pozo. */
const STALE_DAYS = 3;
```

Importar `StaleLead` en el bloque de tipos del archivo.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sin errores (el adaptador cumple el puerto extendido).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/repository.ts
git commit -m "feat(router): adaptador — filtro receiving_leads + contador + reclamo"
```

---

### Task 5: Función de reclamo (`reclaimStaleLeads`)

**Files:**
- Create: `src/lib/leads/reclaim.ts`
- Test: `src/lib/leads/reclaim.test.ts`

**Interfaces:**
- Consumes: `repo.listStaleAssignedLeads()`, `repo.unassignDeal()`, `repo.decrementReceivedCount()`, `repo.listAssignableAgents()`, `repo.assignDealIfUnassigned()`, `repo.incrementReceivedCount()`, `pickLeastLoaded()`.
- Produces: `reclaimStaleLeads(repo): Promise<{ reclaimed: number; reassigned: number }>`.

- [ ] **Step 1: Escribir el test (falla)**

```typescript
import { describe, it, expect } from "vitest";
import { reclaimStaleLeads } from "./reclaim";
import { FakeRepo } from "./leads.test-helpers"; // ver nota de Step 3

describe("reclaimStaleLeads", () => {
  it("devuelve el lead al pozo y lo reasigna a otro, ajustando contadores", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d1", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l1", dealId: "d1", assignedAgentId: "u1" }];
    repo.received.set("u1", 5);
    // listAssignableAgents del Fake devuelve u1 y u2; excluimos u1 → va a u2.
    const res = await reclaimStaleLeads(repo);
    expect(res.reclaimed).toBe(1);
    expect(res.reassigned).toBe(1);
    expect(repo.received.get("u1")).toBe(4); // -1 al original
    expect(repo.received.get("u2")).toBe(1); // +1 al nuevo
    const d1 = repo.deals.find((d) => d.id === "d1");
    expect(d1?.assigned).toBe("u2");
  });

  it("si no hay otro asesor elegible, deja el lead sin asignar", async () => {
    const repo = new FakeRepo();
    repo.deals.push({ id: "d2", assigned: "u1" } as never);
    repo.stale = [{ leadId: "l2", dealId: "d2", assignedAgentId: "u1" }];
    repo.received.set("u1", 3);
    repo.onlyAgent = "u1"; // el Fake devuelve solo u1 como elegible
    const res = await reclaimStaleLeads(repo);
    expect(res.reclaimed).toBe(1);
    expect(res.reassigned).toBe(0);
    const d2 = repo.deals.find((d) => d.id === "d2");
    expect(d2?.assigned).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `npx vitest run src/lib/leads/reclaim.test.ts`
Expected: FAIL (`reclaim.ts` no existe).

- [ ] **Step 3: Implementar `reclaim.ts`**

```typescript
// Reclamo de leads sin trabajar: los devuelve al pozo y los reasigna a otro
// asesor que reciba, protegiendo la señal de Meta (un lead que nadie trabaja
// nunca se califica → Meta lo ve como no-conversión).
import type { LeadRepository } from "./types";
import { pickLeastLoaded } from "./ingest";

export async function reclaimStaleLeads(
  repo: LeadRepository,
): Promise<{ reclaimed: number; reassigned: number }> {
  const stale = await repo.listStaleAssignedLeads();
  let reclaimed = 0;
  let reassigned = 0;

  for (const s of stale) {
    // 1. Volver al pozo + descontar del original (lo devolvió).
    await repo.unassignDeal(s.dealId);
    await repo.decrementReceivedCount(s.assignedAgentId);
    reclaimed++;

    // 2. Reasignar a otro que reciba (excluyendo al original).
    const agents = (await repo.listAssignableAgents()).filter(
      (a) => a.userId !== s.assignedAgentId,
    );
    const pick = pickLeastLoaded(agents);
    if (pick) {
      const ok = await repo.assignDealIfUnassigned(s.dealId, pick.userId);
      if (ok) {
        await repo.incrementReceivedCount(pick.userId);
        reassigned++;
      }
    }
    // Sin otro elegible → queda sin asignar en el pozo (visible "Sin asignar").
  }

  return { reclaimed, reassigned };
}
```

Para el test: extraer `FakeRepo` a `src/lib/leads/leads.test-helpers.ts` (export) y reimportarlo desde `leads.test.ts`, o duplicar un fake mínimo en `reclaim.test.ts`. Recomendado: mover `FakeRepo` a `leads.test-helpers.ts` con `export class FakeRepo`, agregar el campo `onlyAgent?: string` y que `listAssignableAgents` respete `onlyAgent` (devuelve solo ese) — así ambos tests lo comparten sin duplicar.

- [ ] **Step 4: Correr (debe pasar)**

Run: `npx vitest run src/lib/leads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/reclaim.ts src/lib/leads/reclaim.test.ts src/lib/leads/leads.test-helpers.ts src/lib/leads/leads.test.ts
git commit -m "feat(router): reclaimStaleLeads — devuelve leads sin trabajar al pozo"
```

---

### Task 6: Wire del reclamo en el cron `/api/leads/sync`

**Files:**
- Modify: `src/app/api/leads/sync/route.ts` (junto a `reconcileAllCapi`, ~línea 220)

**Interfaces:**
- Consumes: `reclaimStaleLeads`, el adaptador `createLeadRepository` (mismo que usa la ingesta) y `supabaseAdmin`.

- [ ] **Step 1: Leer el route para ubicar el adaptador y el cierre**

Run: `sed -n '1,60p;200,260p' src/app/api/leads/sync/route.ts` (o Read). Identificar cómo se construye el repo por cuenta/fuente y dónde se llama `reconcileAllCapi`.

- [ ] **Step 2: Agregar la pasada de reclamo**

Inmediatamente antes o después de `reconcileAllCapi(admin)`, por cada fuente activa (donde ya se tiene un `repo` construido para esa fuente/pipeline), agregar:

```typescript
    // Reclamo: leads sin trabajar vuelven al pozo y se reasignan.
    const reclaim = await reclaimStaleLeads(repo);
    if (reclaim.reclaimed > 0) {
      console.log(`[sync] reclamados ${reclaim.reclaimed}, reasignados ${reclaim.reassigned}`);
    }
```

Import al tope: `import { reclaimStaleLeads } from "@/lib/leads/reclaim";`

> El `repo` acá es el adaptador real (service-role, ya scopeado a la cuenta+pipeline de la fuente), así que `listStaleAssignedLeads` usa su `STALE_DAYS`/pipeline.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/leads/sync/route.ts
git commit -m "feat(router): correr reclaimStaleLeads en el cron de sync"
```

---

### Task 7: VBO — `custom_data.value = capitas` en CAPI

**Files:**
- Modify: `src/lib/leads/capi.ts` (`SendConversionInput`, `buildEventPayload`, `reconcileCapiForAccount`)
- Test: `src/lib/leads/capi.test.ts` (crear si no existe un bloque de `buildEventPayload`)

**Interfaces:**
- Consumes: `deals.capitas`, `lead_capi_config.send_value`.
- Produces: payload con `custom_data: { value, currency }` cuando corresponde.

- [ ] **Step 1: Escribir el test de `buildEventPayload` (falla)**

```typescript
import { describe, it, expect } from "vitest";
import { buildEventPayload } from "./capi";

describe("buildEventPayload — value (VBO)", () => {
  const base = {
    datasetId: "ds", accessToken: "tok", eventName: "calificado",
    eventId: "l1:calificado", eventTimeSec: 1000, userData: {}, leadId: "l:5",
  };
  it("incluye custom_data.value cuando se pasa value", () => {
    const p = buildEventPayload({ ...base, value: 4 });
    expect(p.data[0].custom_data).toEqual({ value: 4, currency: "ARS" });
  });
  it("omite custom_data cuando value es null/undefined", () => {
    const p = buildEventPayload(base);
    expect(p.data[0].custom_data).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `npx vitest run src/lib/leads/capi.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar en `capi.ts`**

Agregar a `SendConversionInput` (después de `leadId?`):

```typescript
  /** Valor de conversión (capitas). Si está presente, se manda como
   *  custom_data.value para optimización por valor (VBO). */
  value?: number | null;
```

En `buildEventPayload`, después de armar `user_data` y antes del `return`, construir el evento con `custom_data` condicional:

```typescript
  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: input.eventTimeSec,
    event_id: input.eventId,
    action_source: "system_generated",
    user_data,
  };
  if (input.value != null) {
    event.custom_data = { value: input.value, currency: "ARS" };
  }
  return { data: [event] };
```

- [ ] **Step 4: Pasar el value en `reconcileCapiForAccount`**

Extender la query de deals (líneas 183-187) para traer `capitas`:

```typescript
  const { data: deals } = await admin
    .from("deals")
    .select("id, capitas")
    .eq("account_id", config.account_id)
    .in("stage_id", stageIds);
  const dealIds = (deals ?? []).map((d) => d.id as string);
  const capitasByDeal = new Map<string, number | null>(
    (deals ?? []).map((d) => [d.id as string, (d.capitas as number | null) ?? null]),
  );
```

Agregar `send_value` al tipo `CapiConfigRow` y al `.select(...)` de `reconcileAllCapi` (línea 290):

```typescript
interface CapiConfigRow {
  account_id: string; dataset_id: string | null; trigger_stage_name: string;
  event_name: string; active: boolean; send_value: boolean;
}
```
```typescript
    .select("account_id, dataset_id, trigger_stage_name, event_name, active, send_value")
```

En el `sendConversion({...})` dentro del loop, agregar el value (solo si la regla lo pide; default 1 si no hay capitas):

```typescript
      value: config.send_value ? (capitasByDeal.get(lead.deal_id as string) ?? 1) : null,
```

- [ ] **Step 5: Correr tests + typecheck**

Run: `npx vitest run src/lib/leads && npm run typecheck`
Expected: PASS + sin errores de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leads/capi.ts src/lib/leads/capi.test.ts
git commit -m "feat(vbo): mandar custom_data.value=capitas en calificado/closed-won"
```

---

### Task 8: API + UI de recepción en Miembros

**Files:**
- Modify: `src/app/api/account/members/route.ts` (GET agrega `receiving_leads`, `leads_received_count`)
- Modify: `src/app/api/account/members/[userId]/route.ts` (PATCH despacha `receiving`; nuevo POST/PATCH para reset)
- Modify: `src/components/settings/member-access-controls.tsx` (toggle + contador + reset)
- Modify: `src/components/settings/members-tab.tsx` (Member interface + pasar props)
- Modify: `src/hooks/use-auth.tsx` (agregar los campos al select/Profile si se usan en cliente — opcional)

**Interfaces:**
- Consumes: RPCs `set_member_receiving`, `reset_member_lead_count`.

- [ ] **Step 1: GET /api/account/members devuelve los campos**

En `route.ts`, agregar `receiving_leads, leads_received_count` al `.select(...)` de profiles y al `MemberOut` (extendiendo el patrón de `allowed_modules`/`blocked` que ya existe). Devolver `receiving_leads: Boolean(row.receiving_leads)` y `leads_received_count: row.leads_received_count ?? 0`.

- [ ] **Step 2: PATCH despacha `receiving` y `reset`**

En `[userId]/route.ts` PATCH, agregar ramas (junto a las de `allowed_modules`/`blocked`), antes de la de `role`:

```typescript
    if (body && "receiving" in body) {
      if (typeof body.receiving !== "boolean") {
        return NextResponse.json({ error: "'receiving' debe ser boolean" }, { status: 400 });
      }
      const { error } = await ctx.supabase.rpc("set_member_receiving", {
        p_user_id: userId, p_receiving: body.receiving,
      });
      if (error) return rpcErrorToResponse(error);
      return NextResponse.json({ ok: true });
    }
    if (body && body.reset_count === true) {
      const { error } = await ctx.supabase.rpc("reset_member_lead_count", { p_user_id: userId });
      if (error) return rpcErrorToResponse(error);
      return NextResponse.json({ ok: true });
    }
```

- [ ] **Step 3: UI en `member-access-controls.tsx`**

Agregar props `receiving: boolean`, `leadsReceived: number`. Agregar un botón toggle "Recibe leads / Pausar recepción" (PATCH `{ receiving: !receiving }`) y un chip `"{leadsReceived} recibidos"` con un botón reset (PATCH `{ reset_count: true }`). Reusar el helper `patch()` que ya existe en el componente y `onUpdated()`.

```tsx
<Button variant="outline" size="sm" disabled={busy}
  onClick={async () => { const ok = await patch({ receiving: !receiving });
    if (ok) toast.success(receiving ? "Recepción pausada" : "Recibiendo leads"); }}
  className={receiving
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-border text-muted-foreground"}>
  {receiving ? "Recibe leads" : "No recibe"}
</Button>
<span className="text-xs text-muted-foreground">
  {leadsReceived} recibidos
  <button type="button" className="ml-1 underline"
    onClick={async () => { if (await patch({ reset_count: true })) toast.success("Contador reseteado"); }}>
    reset
  </button>
</span>
```

- [ ] **Step 4: Pasar props desde `members-tab.tsx`**

Agregar `receiving_leads` y `leads_received_count` a la `Member` interface y pasarlos a `<MemberAccessControls receiving={member.receiving_leads} leadsReceived={member.leads_received_count} ... />`.

- [ ] **Step 5: Typecheck + build + tests**

Run: `npm run typecheck && npm run build && npx vitest run`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/account/members/ src/components/settings/member-access-controls.tsx src/components/settings/members-tab.tsx
git commit -m "feat(router): UI admin — toggle Recibe leads + contador + reset"
```

---

### Task 9: Captura de capitas al calificar

**Files:**
- Modify: `src/components/contacts/contact-detail-view.tsx` (campo capitas en el deal, editable; prompt al mover a "Calificado")
- Modify: `src/app/(dashboard)/leads/stage-select.tsx` (opcional: prompt de capitas al elegir "Calificado" desde la tabla)

**Interfaces:**
- Consumes: `deals.capitas` (migración 042).

- [ ] **Step 1: Campo capitas editable en el detalle**

En `contact-detail-view.tsx`, agregar un input numérico "Capitas" en la sección del deal, que hace `supabase.from('deals').update({ capitas }).eq('id', primary.id)` (bajo RLS: el asesor puede editar su propio deal; el admin cualquiera). Sembrar el valor actual en el fetch de deals (`select` agrega `capitas`).

- [ ] **Step 2: Prompt al mover a "Calificado"**

En el handler de cambio de etapa (`changeStage`), si la etapa destino se llama "Calificado" y el deal no tiene `capitas`, pedirlo antes de confirmar el movimiento (un `window.prompt` simple para MVP, o un pequeño diálogo). Guardar `capitas` junto con el cambio de etapa. Esto garantiza que el valor esté seteado antes de que el cron (5 min) dispare el evento `calificado`.

> Rationale (del spec): el evento se sella al primer envío; si capitas se carga después del envío, el valor viejo queda en Meta. Por eso se captura en la transición a Calificado.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/contacts/contact-detail-view.tsx src/app/(dashboard)/leads/stage-select.tsx
git commit -m "feat(vbo): capturar capitas al calificar (alimenta el value CAPI)"
```

---

### Task 10: Verificación en vivo (simulación RLS + smoke)

**Files:** ninguno (verificación en el scratchpad, patrón del gate anterior).

- [ ] **Step 1: RPCs admin-only**

Simular como un `agent` (SET ROLE authenticated + jwt sub) llamando `set_member_receiving` sobre otro → debe fallar `42501`. Como admin → OK. Verificar que activar resetea el contador a 0.

- [ ] **Step 2: Filtro del pool**

Poner `receiving_leads=false` a un comprador y confirmar que `listAssignableAgents` (query equivalente) lo excluye.

- [ ] **Step 3: VBO end-to-end (opcional, con un lead de prueba)**

Setear `deals.capitas=4` en un deal en etapa Calificado, forzar una corrida del cron, y verificar en `lead_capi_events.response` (fbtrace) + `ads_get_dataset_stats` que el evento salió. (El value en Meta no es consultable directo por MCP; el recibo fbtrace confirma el envío.)

- [ ] **Step 4:** Dejar todo revertido (contadores/flags de prueba a su estado real).

---

## Self-Review (cobertura del spec)

- **Pozo + filtro receiving_leads:** Task 1 (columna) + Task 4 (filtro) + Task 3 (contador). ✔
- **pickLeastLoaded sobre el pool:** reusa el existente; el filtro entra en Task 4. ✔
- **Cupo manual + reset:** Task 1 (RPCs) + Task 8 (UI). ✔
- **Reclamo:** Task 2 (puerto) + Task 4 (query) + Task 5 (lógica) + Task 6 (wire cron). ✔
- **VBO capitas:** Task 1 (columna + send_value) + Task 7 (CAPI) + Task 9 (captura). ✔
- **RLS/seguridad:** RPCs admin-only (Task 1), verificación (Task 10). ✔
- **Prerrequisito autoAssign:** Task 0. ✔
- **Fuera de alcance** (precio ARS, corrección post-envío, SP3, config Meta): no hay tareas — correcto.

**Riesgos anotados (para el council):**
- Contador `increment/decrement` es read-then-write (no atómico) — service-role, baja concurrencia del cron; drift improbable pero posible. ¿Vale una RPC atómica?
- "Trabajado" = "tiene una nota" es un proxy; un asesor que trabaja por WhatsApp sin dejar nota podría perder el lead por reclamo. ¿Sumar la traza de click-to-chat / cambio de etapa?
- El value se sella al primer envío de `calificado`; capitas cargadas tarde no corrigen Meta (v2).
- `listStaleAssignedLeads` hace N+1 (una query de notas por deal candidato) — ok para volumen de cuarentena, revisar si escala.
