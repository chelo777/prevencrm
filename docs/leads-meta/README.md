# Módulo "Leads Meta" — guía de uso

Ingesta de leads de Meta Lead Ads (Instant Forms) hacia el flujo nativo de
prevencrm: **contacto + deal + asignación + notificación + feedback de conversión
a Meta (CAPI)**. Fase 1 lee las hojas de Google que Meta va poblando.

Diseño completo: [`docs/superpowers/specs/2026-07-01-modulo-leads-meta-design-v2.md`](../superpowers/specs/2026-07-01-modulo-leads-meta-design-v2.md).

---

## 1. Migración

Aplicar la migración `supabase/migrations/029_leads_meta.sql` (crea
`lead_sources`, `leads`, `lead_capi_events`, `lead_intake_errors`,
`lead_capi_config`, `lead_sync_runs`; extiende `deals` y `notifications`).

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

## 4. Dar de alta una fuente

UI: **Leads → Fuentes → Agregar una hoja**. Pegá la URL completa de la hoja
(se extraen `spreadsheetId` y `gid` solos) y un nombre. Al crear la primera
fuente se crea (idempotente) el pipeline **"Leads Prepaga"** con sus etapas.

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
