# Spec de diseño v2 — Módulo "Leads Meta" para PrevenCRM

- **Fecha:** 2026-07-01
- **Autor:** Marcelo Torres (con asistencia de Claude)
- **Estado:** Diseño en revisión — incorpora veredicto del LLM Council + verificación empírica de las hojas reales
- **Reemplaza a:** `2026-07-01-modulo-leads-meta-design.md` (v1)
- **Repositorio destino:** `chelo777/prevencrm` (fork de `wacrm`)

> **Qué cambió respecto de v1.** La v1 fue analizada por el LLM Council, que aprobó el enfoque
> pero marcó **dos fallas de correctitud + un bloque de compliance** como condición para pasar al
> plan. Luego se exportó una fila real de cada hoja (paso #1 del veredicto). Esta v2 cierra los
> bloqueantes con datos reales y ajusta el alcance del MVP según los recortes recomendados.

---

## 0. Contexto y objetivo

PrevenCRM es un CRM self-hosted para operaciones de WhatsApp Business sobre
**Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + Supabase**. Ya resuelve:
inbox multi-agente, contactos con tags/campos custom, pipeline Kanban (`deals`), automatizaciones
no-code, broadcasts, roles por cuenta (`accounts` + `account_role_enum`: `owner/admin/agent/viewer`),
notificaciones y una API REST `/api/v1`.

Lo que **falta** —y es el corazón de un CRM tipo Privyr— es la **captura de leads de Meta Lead Ads
(Instant Forms)** y su inserción automática: contacto + deal + asignación + notificación + feedback
de conversión a Meta. Este módulo, **"Leads Meta"**, se construye **dentro** del código de prevencrm,
de forma **aditiva**.

### Operación actual (a reemplazar)

- Formularios de Meta Lead Ads, vertical **prepaga/salud en Argentina**.
- Meta vuelca cada formulario a un **Google Sheet** (una hoja por formulario; campañas nuevas
  generan libros nuevos).
- El asesor actualiza a mano una columna de estado (`lead_status`) y `Comentarios`, y desde ahí
  actualiza el evento de conversión hacia Meta.
- **Problema:** no escala a 2–10 vendedores; sin contacto instantáneo, asignación, WhatsApp
  integrado ni notificaciones; el feedback de conversión es manual.

---

## 1. Verificación empírica de las hojas reales (paso #1 del consejo — CUMPLIDO)

Se exportó el header + una fila de datos de las **3 hojas** provistas (el usuario mencionó 4
formularios; **queda confirmar si falta una 4.ª hoja**). Hallazgos que gobiernan el diseño:

| Hallazgo | Evidencia | Consecuencia de diseño |
|----------|-----------|------------------------|
| El `id` de Meta (`l:...`) existe en las 3 hojas | Hoja 1/3: `l:1678245683224571`, etc. | La clave de dedupe es real ✓ |
| **La posición del `id` varía** | 1.ª columna en Hojas 1 y 3; **última** en Hoja 2 | Mapeo por posición está **prohibido** |
| **Trampa en Hoja 2:** el `id` real está bajo un header **corrupto (`¡`)** y hay una **segunda columna llamada `id` que está VACÍA** | Header Hoja 2: `¡,…,lead_status,id` con `id` sin datos | Mapear por `header=="id"` daría `meta_lead_id` NULL → cero dedupe → **duplicados masivos**. El `id` se debe resolver **por contenido** (`^l:\d+$`), no por nombre |
| Headers difieren entre formularios | `city` vs `ciudad`; `código_postal` vs `post_code` vs (ninguno); `Comentarios` presente / ausente / header vacío | Fallback a custom field por header; núcleo tolerante a esquema heterogéneo |
| Preguntas calificadoras difieren | Hoja 1: `¿…tratamiento_médico?`; Hoja 2: `¿cuándo_querés_comenzar?`; Hoja 3: ninguna extra | Las preguntas van a custom fields, no a columnas fijas |
| **Teléfonos inconsistentes** | Prefijo `p:` constante, pero `p:+3624101510` (sin `54`) vs `p:+543795586866` | Normalización debe tolerar y **marcar** números malformados; no asumir E.164 válido |
| `lead_status` mezcla vocabularios | `CREATED` (nativo de Meta, mayúscula) junto a `calificado`, `perdido`, etc. | El import histórico mapea ambos vocabularios |
| **PII de salud confirmada** | Hoja 1: "¿actualmente estás bajo algún tratamiento médico?" | Bloque de compliance (§9) es real, no hipotético |

---

## 2. Objetivos y no-objetivos

### Objetivos
1. Ingestar leads de Meta **automáticamente** desde múltiples hojas/libros simultáneos, sin trabajo
   manual por formulario nuevo.
2. Convertir cada lead en **contacto + deal** en un pipeline dedicado, preservando la atribución.
3. **Asignar** a un asesor (por defecto **least-loaded**, reasignable) y **notificar** al instante.
4. **Contacto rápido** por WhatsApp (click-to-chat en MVP, con traza).
5. **Automatizar el feedback de conversión a Meta (CAPI)** al avanzar de etapa —**ya en el MVP**
   (adopción del insight del consejo).
6. Que el **CRM sea la fuente de verdad** del estado; las hojas quedan de solo-lectura.

### No-objetivos (YAGNI)
- Multi-tenant tipo agencia (el modelo `accounts` alcanza). *(Ver Anexo A: es una oportunidad de
  producto, no una feature del MVP.)*
- Dashboards de atribución avanzados **propios** en MVP. *(Ver Anexo A.)*
- Verticales distintos a prepaga/salud.
- Envío automatizado por WhatsApp Business API desde el módulo (Fase 2; prevencrm ya lo integra).

---

## 3. Decisiones de diseño (confirmadas + ajustes del consejo)

| Tema | Decisión |
|------|----------|
| Relación con prevencrm | Módulo **dentro** del mismo repo y misma DB Supabase; aditivo. |
| Escala | Equipo chico (2–10), modelo `accounts`. |
| Plataforma | Web + móvil **PWA** con push. |
| Approach de ingesta | **C — Híbrido**: servicio de dominio agnóstico + adaptadores. |
| Fuente Fase 1 | **Google Sheets** (múltiples hojas/libros). *(Consejo: se rechaza eliminarlo.)* |
| Fuente Fase 2 | **Webhook nativo `leadgen`** + App Review **en paralelo**, sin bloquear el MVP. |
| Mapeo | Por **header** para lo general; **por contenido** para `id` y teléfono (crítico). |
| Alta de fuentes (MVP) | **Seed/config manual** por fuente. *(Recorte del consejo: el asistente UI pasa a Fase 2.)* |
| Fuente de verdad del estado | **El CRM** (etapa del pipeline). Hojas de solo-lectura. |
| Feedback a Meta | **CAPI automático al cambiar etapa — dentro del MVP.** |
| Asignación | **Least-loaded** por defecto (menos deals abiertos) + reasignación manual. |
| Import histórico | **Script aparte**, no dentro del núcleo de ingesta. *(Recorte del consejo.)* |
| Cron | Copia el patrón existente (`x-cron-secret` + lock), no se inventa uno nuevo. |
| Follow-ups | Recordatorios manuales en MVP; secuencias en Fase 3. |

---

## 4. Resolución de los bloqueantes del consejo (trazabilidad)

| # | Bloqueante (consejo) | Resolución en v2 | Sección |
|---|----------------------|------------------|---------|
| B1 | Dedupe mal ubicado (chequeo paso 5 / persistencia paso 9 → 2.º deal ante crash) | **Reordenar a "claim":** insertar la fila `leads` con `meta_lead_id` (ON CONFLICT DO NOTHING) **antes** de crear contacto/deal | §6, §7 |
| B2 | `last_synced_at` roto sobre Sheets | **Eliminado.** Se lee el rango completo cada ciclo; la idempotencia la da el UNIQUE + el claim | §6 |
| B3 | NULLs en el UNIQUE permiten duplicados | `meta_lead_id` **NOT NULL** + validación por contenido (`^l:\d+$`); filas sin id válido → tabla de cuarentena, nunca a `leads` | §5, §6 |
| B4 | Teléfono choca con `022_contact_phone_dedup` | **Unificar** con la normalización de `022` (dígitos) + regla de merge de contacto; malformados se marcan y no deduplican a ciegas | §5.4, §6 |
| B5 | CAPI con un solo `capi_synced_at` insuficiente | Tabla `lead_capi_events` (**una fila por evento**) + `event_id` determinístico + SHA-256 de PII + política de retroceso de etapa | §5.3, §8 |
| B6 | Round-robin sin estado (placeholder en el repo) | **Least-loaded** calculado por conteo de deals abiertos (sin estado frágil); alternativa cola "pull" en Fase 2 | §5.5 nota, flujo §6 |
| B7 | Falta cutover/rollback | Plan de cutover + rollback explícito | §10 |
| B8 | Compliance salud (Ley 25.326 + Meta prohíbe salud en CAPI) | Retención/acceso de `raw_payload` + **allowlist** de campos a CAPI (jamás salud) + consentimiento documentado | §9 |
| B9 | Sin Web Push / trigger sobre `conversations` no deals | Web Push (o degradar a in-app) + trigger `lead_assigned` **sobre deals** | §5.6, §8 |
| B10 | "Función pura" incorrecta (hace writes) | Se renombra a **servicio de dominio transaccional**, testeable vía puertos con fakes | §4.1 |
| B11 | Trazabilidad WhatsApp / número personal | Log de actividad al hacer click-to-chat; envío nativo por API queda para Fase 2 | §5.7 |
| B12 | Sin health-check / contadores | Tabla `lead_sync_runs` con métricas por corrida + endpoint de estado | §5.8 |

### 4.1 Principio de aislamiento (corregido)

El **servicio de dominio de ingesta** recibe un `NormalizedLead` y ejecuta los pasos de claim →
upsert → deal → asignación → notificación. **No es una función pura**: hace escrituras. Se testea
en aislamiento inyectando un **puerto de repositorio** (interfaz) con un fake en memoria, sin Google
ni Meta reales. Las **fuentes** (Sheets, webhook) son adaptadores delgados que solo producen
`NormalizedLead[]`.

---

## 5. Modelo de datos

Todo aditivo, con `account_id` y RLS por cuenta (`is_account_member()`).

### 5.1 Tabla `lead_sources`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | |
| `name` | text | ej. "Form Dependencia - Fabi" |
| `kind` | text | `google_sheet` \| `meta_webhook` \| `manual` |
| `spreadsheet_id` / `sheet_gid` | text | null si no es Sheet |
| `column_mapping` | jsonb | `{ canonical:{...}, custom:{...} }` — **seed manual en MVP** |
| `pipeline_id` / `default_stage_id` | uuid FK | pipeline y etapa inicial destino |
| `active` | boolean | pausar sin borrar |
| `created_at` / `updated_at` | timestamptz | |

> **No hay `last_synced_at`** (B2): se relee el rango completo y la idempotencia la garantiza el
> claim sobre `meta_lead_id`.

### 5.2 Tabla `leads`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | |
| `source_id` | uuid FK → lead_sources | |
| `meta_lead_id` | text **NOT NULL** | `l:...` validado por contenido; **UNIQUE(account_id, meta_lead_id)** (B3) |
| `status` | text | `claimed` → `processed` (control de crash, B1) |
| `contact_id` / `deal_id` | uuid FK | se completan tras el claim |
| `platform` / `is_organic` | text/bool | atribución |
| `campaign_id/name`, `adset_id/name`, `ad_id/name`, `form_id/name` | text | atribución |
| `lead_created_time` | timestamptz | `created_time` de Meta |
| `raw_payload` | jsonb | fila original; **acceso restringido** (§9) |
| `created_at` / `updated_at` | timestamptz | |

### 5.3 Tabla `lead_capi_events` (B5 — una fila por evento)

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `account_id` | uuid FK | |
| `lead_id` | uuid FK → leads | |
| `event_name` | text | `Lead` / `Qualified` / `Purchase` |
| `event_id` | text | determinístico `{lead_id}:{event_name}` → Meta deduplica server-side |
| `status` | text | `pending` \| `sent` \| `failed` |
| `sent_at` | timestamptz | |
| `response` | jsonb | eco de Meta para auditoría |
| — | — | **UNIQUE(lead_id, event_name)** evita doble envío del mismo evento |

**Política de retroceso de etapa:** las conversiones son **monótonas/one-way**. Si un deal
retrocede de etapa, **no** se envía reversa (CAPI no lo soporta) y no se reenvía el evento ya
enviado. Solo se envía cuando un evento pasa por primera vez a `sent`.

### 5.4 Tabla `lead_intake_errors` (cuarentena, B3/B4)

Filas que no se pueden ingestar (sin `id` válido, teléfono irrecuperable, etc.) **no** van a `leads`
(para no ensuciar el UNIQUE). Van a: `{ id, account_id, source_id, raw_row jsonb, reason text,
created_at }`, visibles para revisión manual. Esto cierra en concreto la **trampa de la Hoja 2**
(columna `id` vacía).

### 5.5 Extensión de `notifications` y `deals`

- `notifications`: agregar `lead_assigned` al `CHECK` de `type` (hoy solo `conversation_assigned`).
- `deals`: verificar si existe `assigned_agent_id`; si no, **agregarlo** (aditivo) para poder asignar
  y disparar la notificación **sobre deals** (B9), no sobre conversations.

> **Least-loaded (B6):** la asignación elige el `agent` de la cuenta con **menos deals abiertos** en
> el pipeline; se calcula por conteo, sin tabla de estado frágil. Configurable a manual. La cola
> "pull" (leads a un pool que los asesores reclaman) queda como alternativa evaluable en Fase 2.

### 5.6 Push (B9)

Web Push (VAPID) para PWA. Si el esfuerzo excede el MVP, **degradar a notificación in-app** (badge +
lista) sin bloquear el resto. Se define en el plan según lo que ya use prevencrm.

### 5.7 Traza de WhatsApp (B11)

El click-to-chat abre `wa.me` con el número del lead desde el dispositivo del asesor (su WhatsApp
personal en MVP). Al hacer click se registra un `contact_note`/actividad (quién, cuándo) para dejar
traza. Envío nativo por Business API = Fase 2.

### 5.8 Observabilidad (B12)

Tabla `lead_sync_runs`: `{ id, account_id, source_id, started_at, finished_at, rows_read,
claimed, processed, quarantined, errors, ok bool }`. Un endpoint de estado expone la última corrida
por fuente.

### 5.9 Reuso sin cambios

`contacts` (name/phone/email), `custom_fields` + `contact_custom_values` (preguntas, ciudad, CP),
`contact_notes` (Comentarios), `deals`/`pipelines`/`pipeline_stages`, `accounts`/`profiles`.

### 5.10 Pipeline y etapas (seed)

**"Leads Prepaga":** `Nuevo` → `Calificado` → `Cotizado` → `Closed-Won` · `Perdido` · `No-calificado`.

Mapeo del `lead_status` de la hoja al importar histórico (**maneja ambos vocabularios**, §1):
`CREATED`/vacío → `Nuevo`; `calificado` → `Calificado`; `no-calificado` → `No-calificado`;
`perdido` → `Perdido`; `closed-won` → `Closed-Won`.

---

## 6. Flujo de ingesta (reordenado — claim first)

1. **Disparo.** Cron (patrón existente: `GET` protegido por `x-cron-secret` + lock) recorre las
   `lead_sources` activas `google_sheet`.
2. **Lectura completa.** El adaptador lee **todo el rango** de la hoja (Google Sheets API, service
   account de solo-lectura). Sin `last_synced_at`.
3. **Resolución del `id` por contenido.** Se localiza la columna cuyos valores matchean `^l:\d+$`
   (no por header — la Hoja 2 lo prueba). Si ninguna columna matchea en una fila → `lead_intake_errors`.
4. **Mapeo del resto.** Canónicos por header; headers desconocidos → custom fields. La columna de
   status **se ignora** (el CRM manda); solo el script de histórico la usa una vez.
5. **Normalización de teléfono.** Se quita `p:`; se normaliza al **mismo canónico que `022`** para
   que el dedupe de contacto coincida. Malformado (ej. sin `54`) → se intenta heurística AR; si no se
   puede, el lead se crea **marcado "sin contacto válido"** (no se pierde, no va a WhatsApp).
6. **CLAIM (B1/B3).** `INSERT INTO leads(account_id, meta_lead_id, source_id, status='claimed')
   ON CONFLICT (account_id, meta_lead_id) DO NOTHING`. Si 0 filas → ya procesado → **skip**. Si
   insertó → somos dueños, seguimos.
7. **Upsert contacto.** Por teléfono normalizado (merge con `022`); completa custom fields + nota.
8. **Crear deal.** Pipeline destino, etapa `Nuevo`, `title` = nombre del lead.
9. **Asignar.** Least-loaded entre `agent` de la cuenta (o manual). Setea `deals.assigned_agent_id`.
10. **Completar el lead.** `UPDATE leads SET status='processed', contact_id, deal_id, atribución,
    raw_payload`. Ante crash entre 6 y 10, el próximo ciclo ve `status='claimed'` y **completa sin
    crear un segundo deal**.
11. **Notificar.** Trigger sobre `deals` → `notification` (`lead_assigned`) + push/in-app.

### Errores y borde
- Fila sin `id` válido → `lead_intake_errors` (no rompe el ciclo).
- Teléfono irrecuperable → lead "sin contacto válido", visible para revisión.
- Fallo de Google API → la corrida se marca no-ok en `lead_sync_runs`; se reintenta al próximo ciclo
  (idempotente por el claim).

---

## 7. Servicio de ingesta (componentes)

| Componente | Ubicación propuesta | Responsabilidad |
|------------|---------------------|-----------------|
| Servicio de ingesta | `src/lib/leads/ingest.ts` | Claim → contacto → deal → asignación → notif. |
| Puerto de repositorio | `src/lib/leads/ports.ts` | Interfaz para testear el servicio con fakes |
| Tipos | `src/types/leads.ts` | `NormalizedLead`, `LeadSource`, `LeadAttribution` |
| Adaptador Sheets | `src/lib/leads/sources/google-sheets.ts` | Hoja → `NormalizedLead[]` |
| Mapeo | `src/lib/leads/mapping.ts` | Header + **detección por contenido** (`id`, phone) |
| Teléfono | `src/lib/leads/phone.ts` | `p:` → canónico unificado con `022` |
| CAPI | `src/lib/leads/capi.ts` | Envío con allowlist + SHA-256 + `event_id` |
| Cron sync | `src/app/api/leads/sync/route.ts` | Patrón `x-cron-secret` + lock |
| Script histórico | `scripts/leads/import-historico.ts` | Import único; usa `lead_status` una vez |
| Webhook Meta (Fase 2) | `src/app/api/leads/meta-webhook/route.ts` | `leadgen` → Graph API |

> Rutas y convenciones exactas se validan contra `src/lib/whatsapp`, `src/app/api/v1/*` y
> `src/lib/automations/engine.ts` (round-robin placeholder) en la fase de plan.

---

## 8. CAPI — feedback de conversión (dentro del MVP)

- **Disparo:** cambio de etapa del deal a `Calificado` (o `Closed-Won`, configurable).
- **Payload:** **allowlist estricta** — solo identificadores hasheados con **SHA-256** (email,
  teléfono, nombre, `external_id`) + metadata del evento (valor, moneda, `event_time`) + `event_id`.
  **Nunca** se envían las respuestas del formulario ni datos de salud (B8).
- **Idempotencia:** una fila por evento en `lead_capi_events` con UNIQUE(lead_id, event_name);
  `event_id` determinístico para que Meta deduplique.
- **Retroceso:** monótono; no hay reversa (§5.3).
- **Credenciales:** dataset/pixel id + token por cuenta, guardados como `whatsapp_config` (server-only).

Reemplaza la actualización manual de conversión de hoy.

---

## 9. Compliance (bloque de salud — B8)

Confirmado con datos reales: hay preguntas de salud ("¿tratamiento médico?"). Obligaciones:

- **CAPI sin salud:** el allowlist (§8) garantiza que ningún dato de salud sale hacia Meta.
- **`raw_payload`:** acceso restringido por RLS a `owner`/`admin`; **política de retención**
  (purgar/anonimizar el `raw_payload` una vez mapeado a contacto/custom fields, plazo a definir).
- **Consentimiento (Ley 25.326):** el Instant Form de Meta recoge el consentimiento; se documenta que
  el dato se usa solo para el fin declarado y se almacena de forma segura. **Se recomienda revisión
  legal** antes de producción — es una obligación documentada, no un blocker de código.

---

## 10. Plan por fases + cutover/rollback (B7)

### MVP (Fase 1)
- Migraciones: `lead_sources`, `leads`, `lead_capi_events`, `lead_intake_errors`, `lead_sync_runs`,
  `lead_assigned` en `notifications`, `assigned_agent_id` en `deals` (si falta), seed "Leads Prepaga".
- Adaptador Sheets + servicio de ingesta (claim-first) + mapeo header/contenido + teléfono unificado.
- Cron con patrón existente. CAPI en cambio de etapa. Least-loaded + notif/push (o in-app).
- Seed manual de fuentes (sin asistente UI). Bandeja de leads + cuarentena visible. Click-to-chat con traza.
- Script de import histórico (aparte).

### Cutover / rollback
- **Cutover:** correr en paralelo con las hojas (hojas siguen recibiendo; el CRM ingesta en modo
  sombra) → validar dedupe/atribución sobre datos reales → recién ahí declarar el CRM fuente de verdad.
- **Rollback:** `lead_sources.active=false` detiene la ingesta sin borrar nada; las hojas siguen
  siendo el respaldo. Todo el módulo es aditivo → desactivarlo no afecta el núcleo de prevencrm.

### Fase 2
- Webhook `leadgen` + App Review (en paralelo, no bloquea MVP). Asistente de mapeo en UI. Envío
  WhatsApp por Business API. Evaluar cola "pull".

### Fase 3
- Secuencias/drip. Lead scoring sobre `raw_payload` + histórico (Anexo A).

---

## 11. Criterios de aceptación (MVP)

1. Registrar una hoja como fuente (seed) y ver sus columnas resueltas — incluyendo el `id` **por
   contenido** aunque el header esté corrupto o duplicado (caso Hoja 2).
2. Al llegar un lead nuevo, en ≤5 min aparece como contacto + deal en "Leads Prepaga"/`Nuevo` con
   atribución de campaña.
3. Queda asignado por least-loaded y el asesor recibe notificación (push o in-app).
4. El asesor abre WhatsApp con un click (mensaje pre-armado) y queda **traza** del contacto.
5. Un mismo `meta_lead_id` **nunca** se duplica, ni siquiera ante crash a mitad de proceso (claim).
6. Una fila sin `id` válido cae en cuarentena, **no** genera lead ni rompe el ciclo.
7. Un lead que avanza a `Calificado` dispara **exactamente un** evento CAPI, **sin** datos de salud.
8. Registrar una **segunda** hoja con columnas distintas funciona con solo seed (sin tocar código).
9. Todo respeta RLS por cuenta.

---

## 12. Preguntas abiertas para la fase de plan

- **¿Existe una 4.ª hoja?** El usuario mencionó 4 formularios; se verificaron 3.
- Canónico exacto de teléfono AR (móvil `9`, troncal `0`, `15`) unificado con `022`.
- Evento CAPI por defecto (`Lead`/`Qualified` vs `Purchase`) y etapa de disparo.
- Push: Web Push propio vs. degradar a in-app (según lo que ya use prevencrm).
- Acceso a Google Sheets: service account compartida (¿rompe RLS? mitigación) vs. OAuth por cuenta.
- Plazo de retención/anonimización de `raw_payload`.

---

## Anexo A — Upside (del Expansionista, fuera del MVP)

1. **Grafo de atribución campaña→lead→venta + bucle CAPI** = costo por venta cerrada por adset.
   Reporte de primera clase (no "reutilizar dashboard"). Candidato fuerte para Fase 3.
2. **`raw_payload` + histórico = lead scoring** → asignación por probabilidad de cierre.
3. **prevencrm como producto vendible** → "multi-tenant agencia" descarta un mercado, no una feature.
