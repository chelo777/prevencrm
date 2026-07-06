# Fuente directa Meta Graph API (sin Google Sheets)

Fecha: 2026-07-06
Estado: aprobado (usuario pidió el canal directo; selección de formularios confirmada)
Contexto: extiende el módulo de leads (specs 2026-07-01 y 2026-07-03). Verificado en vivo
con el token real: system user "CLaude Acceso 2026 V2", `leads_retrieval` funcionando
sobre la página "Asesores Prevencion online" (851468501392623) tras habilitar el acceso
a leads; 12 formularios visibles (~1.000 leads).

## Problema

Los leads viajan Meta → (Zapier/Make) → Google Sheet → cron → CRM. La planilla ya no se
trabaja (el estado vive en el CRM); Google quedó como intermediario frágil y con costo.
Además hay formularios cuyos leads hoy NO llegan a ninguna planilla (el principal tiene
599) y el alta por planilla exige wizard por pestaña.

## Decisiones

- **Polling a la Graph API** (misma cadencia del cron, 2-5 min), NO webhook: el webhook
  exige App Review (Advanced Access); el polling con system user sobre activos propios
  funciona hoy y quedó probado.
- **Una fuente = una página** de Facebook, con **selección de formularios**:
  `meta_form_ids` = lista de ids elegidos en el wizard, o `[]`/null = **todos los
  formularios activos, incluidos los futuros** (checkbox "todos" en el wizard).
- **Sin estados desde la API**: los leads de este canal no traen `lead_status`; entran en
  la etapa default ("Nuevo") y el estado se trabaja SOLO en el CRM. La sync de estados
  planilla→CRM sigue existiendo únicamente para fuentes google_sheet.
- **Dedupe entre canales**: `metaLeadId = "l:" + lead.id` (mismo formato que las
  planillas) → el claim-first evita duplicados mientras ambos canales convivan.
- **Token en env** (`META_LEADS_ACCESS_TOKEN`), nunca en DB (política existente). El
  page token se canjea en runtime (`GET /{page}?fields=access_token`) y se cachea por
  proceso.
- Ventana de Meta: la API devuelve leads de los **últimos 90 días**; el histórico más
  viejo queda cubierto por las planillas. Documentado, no se mitiga.

## Modelo de datos (migración 031, aditiva)

```sql
ALTER TABLE lead_sources DROP CONSTRAINT IF EXISTS lead_sources_kind_check;
ALTER TABLE lead_sources ADD CONSTRAINT lead_sources_kind_check
  CHECK (kind IN ('google_sheet', 'meta_webhook', 'meta_api', 'manual'));
ALTER TABLE lead_sources ADD COLUMN IF NOT EXISTS meta_page_id TEXT;
ALTER TABLE lead_sources ADD COLUMN IF NOT EXISTS meta_form_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sources_account_meta_page
  ON lead_sources(account_id, meta_page_id) WHERE active AND kind = 'meta_api';
```

## Componentes

### src/lib/leads/meta-api.ts (nuevo)
- `getPageAccessToken(pageId)` — canjea el system token por el page token (cache por proceso).
- `fetchPageForms(pageId)` → `{ id, name, status, leadsCount }[]`.
- `fetchFormLeads(formId, pageToken, after?)` → una página de leads crudos
  (`fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,
  form_id,is_organic,platform,field_data`, `limit=100`) + cursor `after`.
- `mapApiLead(raw, formName, mapping?)` → `NormalizedLead`:
  - `metaLeadId = "l:" + raw.id` (dedupe con planillas).
  - `field_data` se mapea con el MISMO diccionario de headers de mapping.ts
    (`full_name`→name, `phone_number`→phone con `normalizeArgentinePhone`, `city`/`ciudad`,
    `código_postal`/`post_code`, `email`, `comentarios`); las preguntas desconocidas →
    custom fields con label legible (`toLabel`), respetando renombres de
    `column_mapping.custom` si existen.
  - Atribución desde los campos del lead (sin prefijos `ag:`/`fm:`).
  - `statusRaw = null`, `raw` = objeto completo de la API.
- Errores accionables: token faltante (`META_LEADS_ACCESS_TOKEN no está configurada`),
  Graph error con code/message passthrough al log.

### mapping.ts
Exporta `toLabel` y `HEADER_DICT` (hoy internos) para reuso del adaptador.

### Cron sync/route.ts
- `loadActiveMetaApiSources(admin)` en repository.ts (kind='meta_api').
- Nuevo loop por fuente meta_api: resolver formularios (los elegidos, o todos los ACTIVE
  si la lista está vacía) → por formulario, paginar leads e `ingestLead` cada uno
  (mismas opts; statusToStage no aplica). **Corte temprano**: si una página entera de
  resultados son duplicados ya procesados, se corta ese formulario (los leads llegan
  ordenados descendente por fecha).
- Totales por fuente en `lead_sync_runs` igual que Sheets.

### POST /api/leads/sources (extensión)
Body para este kind: `{ name, kind: "meta_api", metaPageId, metaFormIds?: string[],
autoAssign? }`. Mantiene ensure del pipeline + etapa "Nuevo" como default. 409 por índice
único de página.

### POST /api/leads/sources/meta-preview (nuevo, rol admin)
Body `{ pageUrlOrId }` → `{ pageId, pageName, forms: [{id, name, status, leadsCount}] }`.
503 si falta el token; errores de Graph legibles.

### Wizard UI (new-source-form.tsx)
Paso 0: selector de tipo de fuente — "Planilla de Google" (flujo actual intacto) |
"Meta directo (recomendado)". Flujo meta: pegar URL/ID de la página → preview lista los
formularios con conteos → checkboxes (default: activos con leads > 0) + opción "Todos los
formularios (incluye los que crees en el futuro)" + auto-asignar → crear.

## Seguridad
- Token solo en env; jamás se persiste ni se manda al cliente. El preview devuelve solo
  ids/nombres/conteos.
- `raw_payload` de la API queda bajo la misma RLS restrictiva existente.

## Testing (Vitest)
- `mapApiLead`: prefijo `l:`, mapeo de field_data real (fixture de la respuesta viva),
  teléfono AR normalizado, preguntas → custom fields con label legible, renombres de
  `custom`, atribución completa, statusRaw null.
- Sin tests de red (mismo criterio que google-sheets.ts).

## Fuera de alcance
- Webhook tiempo real (App Review) — se puede sumar encima más adelante.
- Apagar las fuentes de Google (decisión del usuario cuando el canal directo esté probado).
- Cuenta por comprador (sigue pendiente como proyecto aparte).
