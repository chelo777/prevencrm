# Spec de diseño — Módulo "Leads Meta" para PrevenCRM

- **Fecha:** 2026-07-01
- **Autor:** Marcelo Torres (con asistencia de Claude)
- **Estado:** Diseño aprobado — pendiente de plan de implementación
- **Repositorio destino:** `chelo777/prevencrm` (fork de `wacrm`)

---

## 0. Contexto y objetivo

PrevenCRM es un CRM self-hosted para operaciones de WhatsApp Business, construido sobre
**Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + Supabase**. Ya resuelve:
inbox compartido multi-agente, contactos con tags/campos custom, pipeline Kanban (`deals`),
automatizaciones no-code, broadcasts, roles por cuenta (`accounts` + `account_role_enum`:
`owner/admin/agent/viewer`), notificaciones y una API REST `/api/v1`.

Lo que **falta** —y es el corazón de un CRM tipo Privyr— es la **captura de leads de Meta Lead
Ads (Instant Forms)** y su inserción automática en ese flujo: contacto + deal + asignación +
notificación + feedback de conversión a Meta.

Este módulo, llamado **"Leads Meta"**, se construye **dentro del mismo código de prevencrm**
(mismo Next.js, misma base Supabase) de forma **aditiva**: no rompe ni modifica el núcleo
existente.

### Operación actual del usuario (a reemplazar)

- 4 formularios de Meta Lead Ads, vertical **prepaga/salud en Argentina**.
- Meta vuelca cada formulario a un **Google Sheet** (una hoja por formulario; campañas nuevas
  generan libros nuevos).
- El asesor actualiza a mano una columna de estado (hoy la columna `U` = `lead_status`) y una
  de `Comentarios`, y desde ahí actualiza el evento de conversión hacia Meta.
- **Problema:** no escala a un equipo de 2–10 vendedores, no hay contacto instantáneo,
  asignación, WhatsApp integrado ni notificaciones; y el feedback de conversión es manual.

---

## 1. Objetivos y no-objetivos

### Objetivos

1. Ingestar leads de Meta **automáticamente** desde múltiples formularios/hojas/libros
   simultáneos, sin trabajo manual por formulario nuevo.
2. Convertir cada lead en **contacto + deal** en un pipeline dedicado, con la atribución de
   campaña preservada.
3. **Asignar** el lead a un asesor (round-robin configurable, reasignable a mano) y **notificar**
   al instante (push PWA).
4. Permitir **contacto rápido** por WhatsApp (click-to-chat en MVP).
5. **Automatizar el feedback de conversión a Meta (CAPI)** al avanzar el lead de etapa,
   reemplazando el paso manual actual.
6. Que el **CRM sea la fuente de verdad** del estado del lead; las hojas quedan de solo-lectura.

### No-objetivos (YAGNI — fuera de alcance por ahora)

- Multi-tenant tipo agencia (varios clientes aislados). El modelo `accounts` existente alcanza
  para un equipo.
- Dashboards de atribución avanzados propios (se reutiliza el dashboard existente de prevencrm).
- Soporte de verticales distintos a prepaga/salud (el mapeo es genérico, pero no se diseñan
  plantillas específicas de otros rubros).
- WhatsApp Business API para envío automatizado del lado del módulo (prevencrm ya lo integra;
  el MVP usa click-to-chat).

---

## 2. Decisiones de diseño (confirmadas)

| Tema | Decisión |
|------|----------|
| Relación con prevencrm | Módulo **dentro** del mismo repo/código y misma DB Supabase. |
| Escala | Equipo chico (2–10), modelo `accounts` existente. |
| Plataforma | Web + móvil como **PWA** con push. |
| Approach de ingesta | **C — Híbrido**: core agnóstico + adaptadores de fuente. |
| Fuente Fase 1 | **Google Sheets** (múltiples hojas/libros), reusa lo que ya funciona. |
| Fuente Fase 2 | **Webhook nativo de Meta** (`leadgen`) alimentando el mismo core. |
| Mapeo de columnas | Por **nombre de header**, nunca por posición. Asistente de mapeo en la UI. |
| Fuente de verdad del estado | **El CRM** (etapa del pipeline). Hojas de solo-lectura. |
| Feedback a Meta | **CAPI automático** al cambiar etapa del deal. |
| Asignación | Round-robin configurable + reasignación manual. |
| Follow-ups | Recordatorios manuales en MVP; secuencias/drip en Fase 3. |

---

## 3. Arquitectura

```
Meta Lead Ads ──► [Google Sheet(s)]  ──┐  (Fase 1: pull/poll)
                                        ├─► /api/v1/leads  (CORE de ingesta agnóstico)
Meta Webhook (leadgen) ── Fase 2 ──────┘        │
                                                ├─ 1. Validar + normalizar payload
                                                ├─ 2. Dedupe por meta_lead_id
                                                ├─ 3. Normalizar teléfono → E.164
                                                ├─ 4. Upsert contact + custom_fields
                                                ├─ 5. Crear/obtener deal en pipeline "Leads Prepaga"
                                                ├─ 6. Auto-asignar (round-robin/manual)
                                                ├─ 7. Persistir lead (atribución + raw_payload)
                                                └─ 8. Notificar al asesor (notification + push PWA)

Cambio de etapa del deal ──► CAPI sync ──► Meta Conversions API
                             (calificado / closed-won, configurable; idempotente por capi_synced_at)
```

### Principio de aislamiento

El **core de ingesta** es una única función pura de dominio que recibe un `NormalizedLead` y
ejecuta los pasos 1–8. Las **fuentes** (Sheets, webhook) son adaptadores delgados cuya única
responsabilidad es leer su formato particular y producir un `NormalizedLead`. Así:

- El core se testea en aislamiento con payloads normalizados, sin Google ni Meta.
- Agregar una fuente nueva = agregar un adaptador, sin tocar el core.
- El adaptador de Sheets no sabe nada de deals ni de asignación.

### Componentes (ubicación propuesta en el repo)

| Componente | Ubicación | Responsabilidad |
|------------|-----------|-----------------|
| Core de ingesta | `src/lib/leads/ingest.ts` | Pasos 1–8 sobre un `NormalizedLead`. |
| Tipos del dominio | `src/types/leads.ts` | `NormalizedLead`, `LeadSource`, `LeadAttribution`. |
| Adaptador Sheets | `src/lib/leads/sources/google-sheets.ts` | Leer hoja → filas → `NormalizedLead[]`. |
| Mapeo de headers | `src/lib/leads/mapping.ts` | Normalizar headers, auto-mapear canónicos, resolver custom. |
| Normalización teléfono | `src/lib/leads/phone.ts` | Limpiar prefijos (`p:+`) → E.164 (AR). |
| Adaptador webhook Meta | `src/lib/leads/sources/meta-webhook.ts` | Fase 2: `leadgen_id` → Graph API → `NormalizedLead`. |
| Sync CAPI | `src/lib/leads/capi.ts` | Enviar conversión a Meta Conversions API. |
| Endpoint ingesta | `src/app/api/v1/leads/route.ts` | Recibe payload/normalizado (fuentes externas y webhook). |
| Cron de pull Sheets | `src/app/api/leads/sync/route.ts` | Job periódico que lee las fuentes activas. |
| Webhook Meta (Fase 2) | `src/app/api/leads/meta-webhook/route.ts` | Verificación + recepción `leadgen`. |
| UI: fuentes/mapeo | `src/app/(dashboard)/leads/sources/*` | Asistente de alta y mapeo de hojas. |
| UI: bandeja de leads | `src/app/(dashboard)/leads/*` | Vista de leads entrantes y su estado. |

> Las rutas exactas se validan contra los patrones reales de prevencrm en la fase de plan
> (leer `src/lib/whatsapp`, `src/app/api/v1/*` y `src/lib/api/v1` para respetar convenciones).

---

## 4. Modelo de datos

Todo aditivo, con `account_id` y RLS por cuenta, siguiendo el patrón de las migraciones
existentes (`is_account_member()`).

### 4.1 Tabla `lead_sources` (config de cada hoja + su mapeo)

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | tenant |
| `name` | text | ej. "Form Dependencia-Monotrib - Fabi" |
| `kind` | text | `google_sheet` \| `meta_webhook` \| `manual` |
| `spreadsheet_id` | text | null si no es Sheet |
| `sheet_gid` | text | pestaña específica |
| `column_mapping` | jsonb | `{ canonical: {...}, custom: {...}, status_column?: text }` |
| `pipeline_id` | uuid FK → pipelines | pipeline destino |
| `default_stage_id` | uuid FK → pipeline_stages | etapa inicial ("Nuevo") |
| `active` | boolean | pausar sin borrar |
| `last_synced_at` | timestamptz | control de poll |
| `created_at` / `updated_at` | timestamptz | |

### 4.2 Tabla `leads` (lead + atribución)

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | |
| `source_id` | uuid FK → lead_sources | de qué fuente vino |
| `contact_id` | uuid FK → contacts | contacto resultante |
| `deal_id` | uuid FK → deals | deal en el pipeline |
| `meta_lead_id` | text | el `id` de Meta (`l:...`); **UNIQUE(account_id, meta_lead_id)** → dedupe |
| `platform` | text | `ig` \| `fb` |
| `is_organic` | boolean | |
| `campaign_id` / `campaign_name` | text | atribución |
| `adset_id` / `adset_name` | text | atribución |
| `ad_id` / `ad_name` | text | atribución |
| `form_id` / `form_name` | text | atribución |
| `lead_created_time` | timestamptz | `created_time` de Meta |
| `raw_payload` | jsonb | fila/objeto original completo |
| `capi_synced_at` | timestamptz | null hasta enviar conversión; evita duplicados |
| `capi_event` | text | qué evento se envió (`Qualified`/`Purchase`) |
| `created_at` / `updated_at` | timestamptz | |

### 4.3 Extensión de `notifications`

Agregar el tipo `lead_received` (y opcional `lead_assigned`) al `CHECK` de la columna `type`
(hoy solo permite `conversation_assigned`). Es una migración, no cambio de app.

### 4.4 Reuso sin cambios

- `contacts` — destino de `name`, `phone`, `email`; `phone` normalizado a E.164.
- `custom_fields` + `contact_custom_values` — preguntas calificadoras, city, código postal.
- `contact_notes` — columna `Comentarios`.
- `deals` + `pipelines` + `pipeline_stages` — pipeline "Leads Prepaga".
- `accounts` / `profiles.account_role` — asignación y permisos.

### 4.5 Pipeline y etapas (seed)

Pipeline **"Leads Prepaga"** con etapas derivadas de la operación actual (columna `lead_status`):

`Nuevo` → `Calificado` → `Cotizado` → `Closed-Won` · `Perdido` · `No-calificado`

- Mapeo de valores de la hoja al importar histórico: `no-calificado→No-calificado`,
  `calificado→Calificado`, `perdido→Perdido`, `closed-won→Closed-Won`; sin estado → `Nuevo`.
- Los nombres/orden son configurables; este es el seed inicial.

---

## 5. Flujo de ingesta detallado

1. **Disparo.** Cron periódico (ej. cada 2–5 min) recorre las `lead_sources` activas de tipo
   `google_sheet`. (Fase 2: el webhook `leadgen` dispara por evento.)
2. **Lectura.** El adaptador de Sheets lee filas nuevas desde `last_synced_at` usando la Google
   Sheets API (service account con acceso de lectura a las hojas).
3. **Mapeo por header.** Con `column_mapping` de la fuente: los canónicos de Meta se auto-mapean;
   los headers desconocidos → custom fields. La columna de status **se ignora** (el CRM es la
   fuente de verdad); solo se usa una vez para importar histórico.
4. **Normalización.** Se produce un `NormalizedLead`. Teléfono: se quita prefijo `p:+` y se
   normaliza a E.164 con default AR (`+54`).
5. **Dedupe.** Si `(account_id, meta_lead_id)` ya existe en `leads`, se omite (idempotente).
6. **Upsert contacto.** Por teléfono (respetando la deduplicación de contactos existente,
   migración `022_contact_phone_dedup`). Se completan custom fields y nota (`Comentarios`).
7. **Crear deal.** En el pipeline destino, etapa inicial `Nuevo`, `title` = nombre del lead,
   `currency` según la cuenta.
8. **Asignar.** Round-robin sobre los `profiles` con rol `agent` de la cuenta (configurable;
   reasignable a mano). Se setea `deals`/`conversations.assigned_agent_id` según corresponda.
9. **Persistir lead.** Fila en `leads` con toda la atribución y `raw_payload`.
10. **Notificar.** `notification` tipo `lead_received` + push PWA al asesor asignado.

### Errores y borde

- Fila sin teléfono válido → lead se crea igual pero marcado como "sin contacto válido"
  (no se pierde; queda visible para revisión manual). No se envía a WhatsApp.
- Fallo de la Google Sheets API → reintento en el próximo ciclo; no se avanza `last_synced_at`
  de las filas no procesadas.
- Header nuevo no mapeado → cae como custom field con el nombre del header (no rompe la ingesta).

---

## 6. Feedback de conversión a Meta (CAPI)

- **Disparo:** cambio de etapa del deal a `Calificado` (o `Closed-Won`, configurable por cuenta).
- **Acción:** enviar evento a la **Meta Conversions API** usando el `meta_lead_id` para atribución
  (evento de conversión de lead con `lead_id`), o `Purchase`/`Qualified` según config.
- **Idempotencia:** solo se envía si `capi_synced_at IS NULL` para ese evento; se sella al enviar.
- **Config por cuenta:** en qué etapa dispara, qué evento manda, y credenciales de Meta (pixel/
  dataset id + token) guardadas de forma segura (siguiendo el patrón de `whatsapp_config`).

Esto reemplaza la actualización manual de conversión que hoy se hace desde la columna `U`.

---

## 7. Asignación y notificaciones

- **Regla por cuenta:** round-robin automático por defecto entre asesores (`agent`); opción de
  desactivar auto-asignación y dejarlo manual.
- **Reasignación:** un `admin`/`owner` puede reasignar cualquier lead.
- **Notificación:** al asignar, `notification` (`lead_received`) + push PWA (Web Push). El asesor
  ve el lead nuevo y puede abrir WhatsApp con un click (mensaje pre-armado con el nombre).

---

## 8. Plan por fases

### MVP (Fase 1)
- Migraciones: `lead_sources`, `leads`, tipo `lead_received` en `notifications`, seed pipeline
  "Leads Prepaga".
- Adaptador Google Sheets + core de ingesta + mapeo por header + normalización de teléfono.
- Cron de sync.
- Asistente de alta/mapeo de fuentes en la UI.
- Bandeja de leads + asignación round-robin + notificación + push PWA.
- Contacto por WhatsApp click-to-chat.
- Recordatorios manuales (agendar "recontactar el martes").
- Import de histórico desde las hojas (usando la columna de status una única vez).

### Fase 2
- Webhook nativo de Meta (`leadgen`) alimentando el mismo core.
- CAPI automático en cambio de etapa.

### Fase 3
- Secuencias/drip automáticas (follow-ups por tiempo/etapa).

---

## 9. Riesgos y consideraciones

| Riesgo | Mitigación |
|--------|------------|
| Prefijos raros en el Sheet (`p:`, `l:`, `ag:`, `z:`) | Normalización explícita por campo; los ids se guardan tal cual y se limpian solo donde importa (teléfono). |
| Headers cambian entre formularios | Mapeo por nombre + fallback a custom field; asistente re-ejecutable por fuente. |
| Google Sheets API: cuotas / permisos | Service account con lectura; poll con backoff; `last_synced_at` por fuente. |
| Credenciales de Meta (CAPI) | Guardar cifrado/seguro como `whatsapp_config`; nunca en el cliente. |
| Duplicados de lead | `UNIQUE(account_id, meta_lead_id)` + dedupe de contacto por teléfono. |
| App Review de Meta (Fase 2) | Desacoplado del MVP: Sheets no lo requiere. |
| Cambios en el núcleo de prevencrm | Todo aditivo; no se modifican tablas ni rutas existentes salvo el `CHECK` de `notifications`. |

---

## 10. Criterios de aceptación (MVP)

1. Registrar una hoja de Google como fuente vía el asistente y ver sus headers auto-mapeados.
2. Al llegar un lead nuevo a la hoja, en ≤5 min aparece como contacto + deal en "Leads Prepaga",
   etapa `Nuevo`, con la atribución de campaña visible.
3. El lead queda asignado a un asesor por round-robin y el asesor recibe una notificación push.
4. El asesor abre WhatsApp con un click y un mensaje pre-armado con el nombre del lead.
5. Un mismo lead (mismo `meta_lead_id`) nunca se duplica.
6. Registrar una **segunda** hoja (otro formulario, con columnas distintas) funciona sin cambios
   de código: solo alta + mapeo en la UI.
7. Todo respeta el aislamiento por cuenta (RLS): un asesor solo ve los leads de su cuenta.

---

## 11. Preguntas abiertas para la fase de plan

- Nombres/orden definitivos de las etapas del pipeline (seed propuesto en §4.5).
- Evento CAPI exacto a enviar (`Lead` calificado vs `Purchase`) y en qué etapa por defecto.
- Mecanismo de push PWA (Web Push propio vs. servicio) según lo que ya use prevencrm.
- Autenticación del acceso a Google Sheets (service account compartida vs. OAuth por cuenta).
