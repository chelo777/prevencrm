# Módulo "Leads Meta" — guía de uso

Ingesta de leads de Meta Lead Ads (Instant Forms) hacia el flujo nativo de
prevencrm: **contacto + deal + asignación + notificación + feedback de conversión
a Meta (CAPI)**. Fase 1 lee las hojas de Google que Meta va poblando.

Diseño completo: [`docs/superpowers/specs/2026-07-01-modulo-leads-meta-design-v2.md`](../superpowers/specs/2026-07-01-modulo-leads-meta-design-v2.md).

---

## 1. Migración

Aplicar las migraciones `029_leads_meta.sql` (crea `lead_sources`, `leads`,
`lead_capi_events`, `lead_intake_errors`, `lead_capi_config`,
`lead_sync_runs`; extiende `deals` y `notifications`) y
`030_lead_source_wizard.sql` (columnas de sync de estados en `leads`,
contador `stage_synced` e índice único de fuentes activas).

```bash
supabase db push        # o el flujo de migraciones que uses
```

Todo es **aditivo**: no toca datos existentes.

## 2. Variables de entorno

Ver `.env.leads.example`. Resumen:

| Variable | Para qué |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Ya existen (cliente admin). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON de la key del service account de Google (lectura de las hojas). |
| `LEADS_CRON_SECRET` | Secreto del cron (cae a `AUTOMATION_CRON_SECRET` si no está). |
| `META_CAPI_ACCESS_TOKEN` | Token de la Conversions API. **Nunca** se guarda en la DB. |

## 3. Acceso a las hojas de Google

1. En Google Cloud: creá un **service account** y una **key JSON**; habilitá la
   **Google Sheets API**.
2. Pegá el JSON completo en `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. **Compartí cada hoja** (permiso *Lector*) con el email del service account
   (`...@....iam.gserviceaccount.com`). Sin esto, la lectura falla con 403.

## 4. Dar de alta una fuente (wizard)

UI: **Leads → Fuentes → Agregar una hoja**. Es un wizard de 3 pasos:

1. **URL y pestaña** — pegás la URL completa; se listan todas las pestañas del
   documento (las que ya tienen fuente aparecen marcadas). Una fuente = una
   pestaña.
2. **Columnas** — cada columna real se muestra con valores de ejemplo y su
   clasificación sugerida: campo del CRM, **campo personalizado con el nombre
   que elijas** (así los datos quedan consistentes entre formularios), o
   ignorar.
3. **Estados → etapas** — cada valor de `lead_status` de la hoja se mapea a una
   etapa del embudo (sugerencia automática: CREATED→Nuevo, calificado→
   Calificado, etc.).

Al crear la primera fuente se crea (idempotente) el pipeline **"Leads
Prepaga"** con sus etapas. Si el documento tiene otra pestaña con datos sin
fuente, el wizard ofrece agregarla a continuación.

**Sync de estados**: si el comprador cambia el `lead_status` en la hoja
*después* de la ingesta, el cron mueve el deal a la etapa mapeada — salvo que
alguien ya lo haya movido a mano en el Kanban (en ese caso el CRM manda y la
planilla deja de controlar ese deal). `closed-won` llegando a su etapa dispara
el evento CAPI como cualquier deal.

> El `id` del lead (`l:...`) se detecta **por contenido**, no por header —
> resiste headers corruptos y columnas `id` vacías (caso real de una de las
> hojas). Las filas sin `id` válido van a **cuarentena**, no generan duplicados.

## 5. Sincronización (cron)

Pegarle cada 2–5 min a:

```
GET /api/leads/sync
Header:  x-cron-secret: <LEADS_CRON_SECRET>
```

Con **Vercel Cron**, un **GitHub Action** o cualquier pinger. Relee el rango
completo de cada hoja; la idempotencia la garantiza el claim sobre
`meta_lead_id` (no hay duplicados aunque corra de más). Cada corrida deja
métricas en `lead_sync_runs` (visibles en *Leads → Fuentes*).

## 6. Feedback de conversión (CAPI)

1. Insertá/activá una fila en `lead_capi_config` para la cuenta:
   `{ account_id, dataset_id, trigger_stage_name: 'Calificado', event_name: 'Lead', active: true }`.
2. Seteá `META_CAPI_ACCESS_TOKEN`.

Cuando un deal llega a la etapa disparadora, el próximo ciclo de `/api/leads/sync`
envía **un** evento de conversión (idempotente por `UNIQUE(lead_id, event_name)`).

**Compliance:** el payload lleva SOLO identificadores hasheados con SHA-256
(email, teléfono, nombre). **Jamás** se envían las respuestas del formulario ni
datos de salud (allowlist codificada en `src/lib/leads/capi.ts`).

## 7. Import histórico (opcional, una vez)

```
POST /api/leads/import-historico
Body: { "sourceId": "<uuid de la fuente>" }
```

Ingesta las filas viejas y ubica cada deal en la etapa según la columna
`lead_status` de la hoja (maneja `CREATED`, `calificado`, `perdido`, etc.).

## 8. Tests

```bash
npm test                       # todo
npx vitest run src/lib/leads   # solo el módulo
```

Cubren: normalización de teléfono AR, detección del `id` por contenido (incluida
la trampa del header corrupto + columna `id` vacía) y el claim-first
anti-duplicados (con repo fake en memoria).

## 9. Arquitectura (archivos)

| Archivo | Rol |
|---------|-----|
| `src/lib/leads/types.ts` | Tipos + puerto `LeadRepository`. |
| `src/lib/leads/phone.ts` | Normalización AR unificada con `022`. |
| `src/lib/leads/mapping.ts` | Detección por contenido/header → `NormalizedLead`. |
| `src/lib/leads/google-sheets.ts` | Auth SA (JWT) + lectura Sheets REST. |
| `src/lib/leads/ingest.ts` | Orquestación claim-first (vía puerto). |
| `src/lib/leads/repository.ts` | Adaptador Supabase del puerto. |
| `src/lib/leads/capi.ts` | Conversions API + reconciliación. |
| `src/app/api/leads/sync/route.ts` | Cron: ingesta + CAPI. |
| `src/app/api/leads/sources/route.ts` | Alta de fuentes. |
| `src/app/api/leads/contacted/route.ts` | Traza de click-to-chat. |
| `src/app/api/leads/import-historico/route.ts` | Import histórico. |
| `src/app/(dashboard)/leads/*` | Bandeja + fuentes (UI). |

## 8. Fuente directa Meta API (sin Google)

Desde la migración 031 existe el kind `meta_api`: el cron pide los leads
directamente a la Graph API (polling cada ciclo), sin planilla intermedia.

- **Env**: `META_LEADS_ACCESS_TOKEN` = token de **system user** del Business
  Manager (no expira) con `leads_retrieval` + la página asignada como activo.
  Requisito de Meta: el acceso a leads de la página debe permitir a la app
  (Business Suite → Configuración → Acceso a clientes potenciales).
- **Alta**: Leads → Fuentes → "Meta directo" → pegar el ID de la página →
  elegir formularios (o "Todos", que incluye los futuros).
- **Dedupe**: el id se guarda como `l:<id>` — mismo formato que las planillas,
  así ambos canales pueden convivir sin duplicar.
- **Estados**: los leads de la API no traen `lead_status`; entran en "Nuevo" y
  el estado se trabaja SOLO en el CRM (no hay sync de estados en este canal).
- **Límite de Meta**: la API devuelve leads de los últimos ~90 días; el
  histórico anterior queda en las planillas.
