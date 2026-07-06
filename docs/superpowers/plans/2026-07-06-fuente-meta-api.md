# Conector Meta Graph API — Plan de implementación

> **For agentic workers:** ejecutar inline con superpowers:executing-plans. Spec:
> `docs/superpowers/specs/2026-07-06-fuente-meta-api-design.md`. Los pasos siguen TDD
> donde hay lógica pura; los adaptadores de red siguen el criterio del módulo (sin test
> de red).

**Goal:** Ingesta directa de Meta Lead Ads vía Graph API (polling), con fuente por página
y selección de formularios, deduplicada contra las fuentes de planilla.

**Global constraints:** typecheck limpio; `npx vitest run src/lib/leads` verde; sin deps
nuevas; token SOLO en env (`META_LEADS_ACCESS_TOKEN`); `metaLeadId = "l:" + id`.

### Task 1: Migración 031
- Create: `supabase/migrations/031_meta_api_source.sql` (SQL del spec, con comentario).
- Run: `npx supabase db push --yes` → aplicada en linked.
- Commit.

### Task 2: mapping.ts exporta helpers + adaptador meta-api.ts (TDD)
- Modify: `src/lib/leads/mapping.ts` — `export` en `HEADER_DICT` y `toLabel`.
- Create: `src/lib/leads/meta-api.ts`:
  - `interface MetaApiLead { id: string; created_time?: string; ad_id?; ad_name?;
    adset_id?; adset_name?; campaign_id?; campaign_name?; form_id?; is_organic?;
    platform?; field_data?: { name: string; values?: string[] }[] }`
  - `mapApiLead(raw: MetaApiLead, formName: string | null, mapping?: ColumnMapping):
    NormalizedLead` — pura, testeable. Canónicos por `HEADER_DICT` sobre
    `normalizeHeader(field.name)`; teléfono por `normalizeArgentinePhone`; desconocidos →
    `customFields[custom[norm] ?? toLabel(name)]`; ignora los de `mapping.ignore`;
    `attribution.formName = raw.form_name ?? formName`; `isOrganic` de boolean/string.
  - Red: `getPageAccessToken`, `fetchPageForms`, `fetchFormLeads` (paginado con
    `after`), `getMetaLeadsTokenConfigured()`.
- Test (leads.test.ts): fixture = lead real enmascarado de la verificación en vivo
  (field_data con las 4 preguntas + full_name/phone_number/city/código_postal).
  Asserts: `metaLeadId === "l:1053045053958358"`, name, phoneE164 `+54...` válido,
  `customFields["qué edad tenés"]` presente, renombre con `custom`, atribución, y
  `statusRaw === null`.
- Ciclo: test rojo → implementación → verde → commit.

### Task 3: repository.ts + cron
- `loadActiveMetaApiSources(admin)` → `MetaApiSourceConfig { id, accountId, ownerUserId,
  name, pageId, formIds: string[], columnMapping, pipelineId, defaultStageId, autoAssign }`.
- `sync/route.ts`: tras el loop de sheets, loop meta_api:
  - `forms = formIds.length ? formIds : fetchPageForms(pageId).filter(f => f.status === "ACTIVE").map(f => f.id)`
  - por form: paginar `fetchFormLeads`; por lead `mapApiLead` → `ingestLead` (mismas
    opts, sin statusToStage); contar en totals; **cortar el form si una página completa
    fue todo `skipped_duplicate`**; máx. 25 páginas por form por corrida (backstop).
  - `recordSyncRun` igual que sheets.
- typecheck + tests → commit.

### Task 4: alta + preview
- `POST /api/leads/sources`: acepta `kind: "meta_api"` + `metaPageId` + `metaFormIds`;
  valida `metaPageId` no vacío; inserta con `spreadsheet_id/sheet_gid` null; 409 → mismo
  mensaje adaptado ("Esa página ya tiene una fuente activa").
- Create `POST /api/leads/sources/meta-preview`: `{ pageUrlOrId }` → extrae id numérico
  (regex sobre URL de facebook o id pelado) → `fetchPageForms` → respuesta del spec;
  503 sin token, errores Graph legibles.
- typecheck → commit.

### Task 5: wizard UI
- `new-source-form.tsx`: estado `sourceType: "sheet" | "meta"` con selector inicial
  (dos cards); flujo sheet intacto; flujo meta: input página → preview → checkboxes de
  formularios (default activos con leads>0) + checkbox "Todos (incluye futuros)"
  (deshabilita la lista y manda `metaFormIds: []`) + auto-asignar → POST → pantalla éxito.
- typecheck + lint → commit.

### Task 6: verificación + docs + push + demo
- `npm run typecheck && npx vitest run src/lib/leads && npm run build`.
- Docs: CLAUDE.md (migración 031, fuente meta_api, env nueva) + docs/leads-meta/README.md
  (sección "Fuente directa Meta API").
- Push a main → deploy.
- Usuario agrega `META_LEADS_ACCESS_TOKEN` en Dokploy → redeploy.
- Demo: crear fuente vía wizard (o SQL), disparar sync, verificar leads/deals en DB y
  Kanban; confirmar dedupe (los 10 de la planilla no se duplican).
