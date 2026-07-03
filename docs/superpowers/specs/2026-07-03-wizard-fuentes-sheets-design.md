# Wizard de fuentes de Google Sheets + sincronización de estados

Fecha: 2026-07-03
Estado: aprobado (luz verde del usuario para decidir diseño; transición planilla→CRM elegida por defecto)
Contexto previo: `2026-07-01-modulo-leads-meta-design-v2.md` (módulo base), diagnóstico 2026-07-02 (cron nunca configurado en prod).

## Problema

1. El alta de fuentes es un form manual (nombre + spreadsheetId) sin visibilidad de columnas:
   cada formulario nuevo de Meta trae columnas distintas y el mapeo queda a ciegas.
2. Una fuente = una pestaña, pero los documentos reales tienen varias pestañas de datos
   (doc "Fabi": Hoja 1 + Hoja 2). Hoy las pestañas no registradas pierden leads en silencio.
3. El comprador (Fabi/Giuli) trabaja el estado del lead en la planilla (columna `lead_status`)
   DESPUÉS de la ingesta. El CRM ingesta una vez y nunca relee → su trabajo se pierde y
   `closed-won` jamás dispara la conversión CAPI (que se dispara por etapa del deal).

## Evidencia (planillas reales analizadas 2026-07-03)

- 3 documentos (uno por comprador/localidad), cada uno: 1-2 pestañas de datos (una por
  formulario/versión de Meta) + pestaña "Guía de estados".
- Núcleo común idéntico en las 6 pestañas: `id` (`l:\d+`), `created_time` (ISO), atribución
  (`ad/adset/campaign/form` id+name), `is_organic`, `platform`, `full_name`, `phone_number`
  (`p:...`), `lead_status`.
- Variable entre formularios: 3-4 preguntas (`¿qué_edad_tenés?`, etc.), ciudad
  (`city`/`ciudad`/ausente), CP (`código_postal`/`post_code`/ausente), columna manual final
  (`Comentarios`/`Cimentarios` (typo)/`Notas`).
- Trampas confirmadas: header corrupto `¡` con el id real + columna `id` decoy vacía
  (doc2/FormDep). La heurística por contenido existente las resuelve.
- Vocabulario de estados uniforme y documentado en la Guía (validado por Meta):
  `CREATED / calificado / no-calificado / perdido / closed-won`. Matchea las etapas que
  `ensure_leads_prepaga_pipeline` ya crea: Nuevo, Calificado, Cotizado, Closed-Won,
  Perdido, No-calificado.

## Decisiones

- **Enfoque elegido**: wizard de mapeo asistido + sync continua de estados planilla→CRM
  (enfoque A). Alternativas descartadas: wizard sin sync (pierde el trabajo del comprador),
  solo config JSON manual (no elimina errores de mapeo).
- **Modo de trabajo del estado**: transición. Mientras el comprador use la planilla, la sync
  refleja sus cambios en el Kanban. Cuando pase al Kanban, sus movimientos manuales pisan a
  la planilla automáticamente (regla de conflicto abajo). No hay flag de configuración.
- **stage ids, no nombres**, en `statusToStage` (consistente con `default_stage_id`).
- **Una fuente por pestaña** (spreadsheet_id + gid). El wizard enumera pestañas y encadena
  altas; no hay fuente multi-pestaña.

## Modelo de datos (migración 030, aditiva)

```sql
-- leads: estado visto en planilla + última etapa aplicada por la sync
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sheet_status TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS synced_stage_id UUID
  REFERENCES pipeline_stages(id) ON DELETE SET NULL;

-- lead_sources: eliminar duplicados (conservar el más viejo por
-- (account_id, spreadsheet_id, coalesce(sheet_gid,'0'))) y prevenir nuevos
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sources_account_sheet
  ON lead_sources(account_id, spreadsheet_id, COALESCE(sheet_gid, '0'))
  WHERE active;
```

`column_mapping` (jsonb existente en `lead_sources`) amplía su contrato:

```ts
interface ColumnMapping {
  canonical?: Partial<Record<CanonicalField, string>>; // campo -> header (ya existía)
  custom?: Record<string, string>;   // header normalizado -> nombre del custom field
  ignore?: string[];                 // headers normalizados a ignorar
  statusToStage?: Record<string, string>; // valor de lead_status -> pipeline_stages.id
}
```

## Componentes

### google-sheets.ts
`fetchSpreadsheetTabs(spreadsheetId)` → `{ title, gid, rowCount }[]` vía
`GET /v4/spreadsheets/{id}?fields=sheets.properties` con el JWT existente.

### mapping.ts
- `resolveColumns` respeta `ignore` (columna fuera) y `custom` (renombre del custom field).
- `suggestMapping(raw)` → estructura para el wizard: por columna `{ index, header, samples[3],
  suggestion: {kind: 'canonical'|'custom'|'ignore', field?, label?} }` + valores distintos de
  la columna de estado. Reusa la heurística actual (id/tel por contenido, resto por diccionario).

### Endpoint nuevo: POST /api/leads/sources/preview (rol admin)
Body: `{ url }` (URL completa de Google Sheets; extrae spreadsheetId y gid).
Respuesta: `{ spreadsheetId, tabs: [{gid, title, rowCount, hasSource, looksLikeData}],
selected: {gid, headers, sampleRows, suggestions, statusValues, stages: [{id,name}]} }`.
Errores accionables: 503 si falta `GOOGLE_SERVICE_ACCOUNT_JSON`; 403 de Google → "compartí la
hoja con <client_email del service account>"; 404 → URL/gid inválido.

### POST /api/leads/sources (existente, se amplía)
Acepta `sheetGid`, `columnMapping` completo (canonical/custom/ignore/statusToStage) y
`autoAssign`. Valida que los stage ids del statusToStage pertenezcan al pipeline de la cuenta.

### ingest.ts / repository.ts
- Etapa inicial del deal: `statusToStage[lead.statusRaw] ?? default_stage_id`
  (el puerto `createDeal` gana parámetro `stageId`).
- Al finalizar ingesta se persisten `sheet_status = statusRaw` y `synced_stage_id = etapa inicial`.

### Sync de estados (cron, leads ya procesados)
En cada pasada, por fila cuyo lead ya está `processed`:
1. Si `statusRaw == leads.sheet_status` → nada.
2. Si cambió y hay mapeo a etapa:
   - Si `deals.stage_id == leads.synced_stage_id` (la planilla sigue siendo dueña) →
     `deals.stage_id = etapa nueva`, `leads.sheet_status` y `synced_stage_id` actualizados.
   - Si `deals.stage_id != leads.synced_stage_id` (alguien lo movió en el Kanban) →
     solo `leads.sheet_status = statusRaw`; la planilla deja de controlar ese deal.
3. Estado sin mapeo → solo registra `sheet_status`; contador en el resumen de la corrida.

CAPI no cambia: sigue disparando por etapa (`trigger_stage_name`); la sync hace que
`closed-won` de la planilla llegue a esa etapa.

### UI: wizard en /leads/sources/new (reemplaza new-source-form.tsx)
- Paso 1 — URL y pestaña: pegar URL (soporta `#gid=`), lista de pestañas con estado
  (ya registrada / parece datos / vacía), elegir una + nombre de la fuente.
- Paso 2 — Columnas: tabla header → 3 valores de muestra → clasificación editable
  (canónico / custom con nombre libre pre-cargado legible / ignorar).
- Paso 3 — Estados: valores reales de `lead_status` → etapa (sugerencia automática por
  similitud de nombre), toggle auto-asignación, crear.
- Al crear, si el documento tiene otra pestaña de datos sin fuente → ofrecer repetir el
  wizard con sugerencias pre-cargadas (mismo URL, siguiente gid).

## Manejo de errores
- Fila sin `l:...` → cuarentena (sin cambios).
- Estado no mapeado → deal no se mueve; se cuenta en `lead_sync_runs.message`.
- Preview: errores accionables (arriba). El wizard nunca crea la fuente si el preview falló.

## Testing (Vitest, FakeRepo)
- Fixtures = headers reales de las 6 pestañas analizadas (incluida la trampa `¡`/decoy y
  el typo `Cimentarios`).
- mapping: renombres custom, ignore, sugerencias, valores de estado.
- ingest: etapa inicial por statusToStage; fallback a default_stage_id.
- sync: planilla manda mientras `stage == synced_stage`; humano manda si difieren;
  estado desconocido no mueve nada.
- preview: extracción de spreadsheetId/gid desde URLs reales.

## Fuera de alcance
- Cuenta/tenant por comprador (Fabi, Giuli): decisión de producto aparte; hoy un usuario
  pertenece a una sola cuenta.
- Webhook `leadgen` directo de Meta (mejora futura ya discutida).
- Escritura CRM→planilla (la planilla nunca se escribe desde el CRM).

## Riesgos
- `GOOGLE_SERVICE_ACCOUNT_JSON` aún no está configurada en prod: el wizard depende de ella
  para el preview. El mensaje de error del preview lo hace evidente y accionable.
- Si el comprador borra/renombra columnas después del alta, el mapeo por header puede
  romperse: las filas caen a cuarentena (visible), no se pierden en silencio.
