# wacrm — WhatsApp CRM Template

> Self-hostable CRM para WhatsApp Business API: inbox compartido, contactos, pipelines de ventas, broadcasts, automaciones sin código, flows visuales y módulo de leads desde Meta.

---

## IMPORTANTE: Next.js 16 no es el Next.js que conocés

Esta versión tiene breaking changes. Antes de escribir código que toque App Router, Server Components, o cualquier API de Next.js, leé:

```
node_modules/next/dist/docs/
```

Las convenciones de archivos, el manejo de `cookies()`, `headers()`, y el ciclo de vida de componentes son distintos a versiones anteriores.

---

## Stack

| Capa | Tecnología |
|------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Base de datos | Supabase: Postgres + Auth + Storage + Realtime + RLS |
| Estilos | Tailwind v4 (config en CSS, no en tailwind.config.ts — ese archivo no existe) |
| WhatsApp | Meta Cloud API (Business API oficial) |
| Charts | Recharts + wrappers custom en `src/components/tremor/` |
| Flows | `@xyflow/react` (canvas visual) + `@dagrejs/dagre` (auto-layout) |
| Testing | Vitest |
| Cliente Supabase | `@supabase/ssr` (`createBrowserClient` / `createServerClient`) |

---

## Arrancar en local

```bash
cd prevencrm
npm install
cp .env.local.example .env.local   # rellenar vars (ver más abajo)
# Añadir también las vars de .env.leads.example si vas a probar leads
npm run dev                         # http://localhost:3000
```

### Variables de entorno mínimas

| Variable | De dónde sacarla |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ídem |
| `SUPABASE_SERVICE_ROLE_KEY` | ídem (¡nunca exponer en cliente!) |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `META_APP_SECRET` | Meta for Developers → App Settings → Basic |

### Variables opcionales / por feature

- `AUTOMATION_CRON_SECRET` — necesario para pasos Wait en automaciones
- `META_APP_ID` — necesario para templates con header de imagen
- `WHATSAPP_TEMPLATES_DRY_RUN=true` — saltar llamada real a Meta en dev
- `LEADS_CRON_SECRET` — cron de ingesta de leads (cae a `AUTOMATION_CRON_SECRET` si no está)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON completo del service account (lectura de Google Sheets)
- `META_CAPI_ACCESS_TOKEN` — token de Meta Conversions API (¡NUNCA en DB!)

---

## Comandos

```bash
npm run dev          # Dev server con Turbopack
npm run build        # Build de producción
npm run typecheck    # tsc --noEmit
npm run test         # Vitest (todos los tests)
npx vitest run src/lib/leads   # Solo módulo de leads
npm run lint         # ESLint
npm run format       # Prettier
```

---

## Estructura de directorios

```
src/
├── app/
│   ├── (auth)/              # Login, signup, forgot-password
│   ├── (dashboard)/         # Rutas protegidas (layout con sidebar)
│   │   ├── dashboard/       # Métricas y actividad en tiempo real
│   │   ├── inbox/           # Inbox compartido de WhatsApp
│   │   ├── contacts/        # Gestión de contactos
│   │   ├── leads/           # Módulo Leads Meta
│   │   ├── leads/sources/   # Configurar fuentes (Google Sheets, wizard)
│   │   ├── pipelines/       # Kanban de ventas
│   │   ├── broadcasts/      # Campañas masivas
│   │   ├── automations/     # Builder y logs
│   │   ├── flows/           # Builder visual (canvas)
│   │   ├── notifications/   # Centro de notificaciones
│   │   └── settings/        # Config de cuenta y team
│   └── api/
│       ├── account/         # Perfil, miembros, invitaciones, API keys
│       ├── automations/     # CRUD + engine + cron
│       ├── flows/           # CRUD + ejecución + cron
│       ├── leads/           # sync, sources (+preview), contacted, import-historico
│       ├── v1/              # REST API pública (broadcasts, contacts, conversations, webhooks)
│       └── whatsapp/        # Config, webhook, media, templates, broadcasts
├── components/
│   ├── ui/                  # Componentes base (button, dialog, tabs, input, etc.)
│   ├── layout/              # Header, sidebar (con nav a /leads), theme toggle
│   ├── inbox/               # Thread de mensajes, composer, reacciones
│   ├── automations/         # Builder visual de automaciones
│   ├── flows/               # Canvas, editor de nodos, validación
│   ├── broadcasts/          # Wizard 4 pasos
│   ├── contacts/            # Form, import CSV, campos personalizados
│   ├── pipelines/           # Kanban, deal cards, analytics
│   ├── dashboard/           # Charts, feed de actividad, métricas
│   ├── settings/            # Todos los paneles de configuración
│   ├── presence/            # Presencia en tiempo real
│   └── tremor/              # Wrappers Recharts (bar, colores, Y-axis)
├── hooks/                   # use-auth, use-realtime, use-presence, use-can, etc.
├── lib/
│   ├── auth/                # requireRole(), account context, roles, invitaciones
│   ├── automations/         # Engine de automaciones, templates, triggers
│   ├── contacts/            # findExistingContact() (dedupe por teléfono)
│   ├── flows/               # Engine de flows, layout, templates, validación
│   ├── leads/               # Módulo completo (ver sección dedicada abajo)
│   ├── supabase/            # createBrowserClient / createServerClient
│   ├── webhooks/            # Delivery, firma, SSRF checks
│   └── whatsapp/            # Meta Cloud API, encriptación AES-256-GCM, templates
├── types/
│   └── index.ts             # Todas las interfaces (Profile, Contact, Message, Deal, etc.)
└── middleware.ts             # Auth + redirección de rutas
supabase/
└── migrations/              # 30 migraciones SQL (aditivas)
docs/
├── public-api.md            # Referencia REST /api/v1
└── leads-meta/README.md     # Guía del módulo de leads
```

---

## Multi-tenancy

- Tabla `accounts` + `profiles.account_id` + `account_role_enum` (owner/admin/agent/viewer)
- Función `is_account_member(account_id)` — SECURITY DEFINER — usada en todas las políticas RLS
- **Todas** las tablas de dominio tienen RLS habilitado
- El `supabaseAdmin()` (service role) bypasea RLS; usarlo **solo en rutas server-side**
- `requireRole('admin')` en `src/lib/auth/account.ts` — helper para rutas de API que necesitan un rol mínimo

---

## Módulo Leads Meta (`src/lib/leads/`)

Ingesta leads de Meta Lead Ads (vía Google Sheets intermedias) hacia el CRM nativo.

### Archivos

| Archivo | Rol |
|---------|-----|
| `types.ts` | Interfaces + puerto `LeadRepository` |
| `phone.ts` | `normalizeArgentinePhone()` — E.164, trunk 0, prefijo `p:` |
| `mapping.ts` | `detectColumnByContent()` + `suggestMapping()` (wizard) — detecta columnas por contenido, no por header |
| `sheet-url.ts` | `parseSheetUrl()` — extrae spreadsheetId y gid de una URL |
| `google-sheets.ts` | Auth JWT RS256 (sin googleapis), lectura REST Sheets v4, pestañas |
| `ingest.ts` | Orquestación claim-first + sync de estados planilla→CRM |
| `repository.ts` | Adaptador Supabase del puerto `LeadRepository` |
| `capi.ts` | Meta Conversions API: SHA-256 allowlist, reconciliación idempotente |
| `leads.test.ts` | 29 tests Vitest: phone, mapping (trampa Hoja 2), ingest claim-first, sync de estados, wizard |

### Patrones clave

**Claim-first (anti-duplicados):**
```sql
INSERT INTO leads (account_id, meta_lead_id, ...)
ON CONFLICT (account_id, meta_lead_id) DO NOTHING
```
Si el proceso crashea con `status='claimed'`, el próximo ciclo reanuda desde el checkpoint sin crear entidades duplicadas.

**Detección de columnas por contenido (Hoja 2):**
La columna `id` de la hoja puede estar con header corrupto (`¡`) o haber una columna `id` vacía como decoy. `detectColumnByContent()` escanea celdas reales con regex `^l:\d+$` — ≥80% de matches en una columna gana. Ídem para teléfonos con prefijo `p:`.

**Wizard de fuentes (`leads/sources`):**
Alta en 3 pasos: URL→pestaña (una fuente = una pestaña), mapeo de columnas con
nombre elegido para cada custom field (`column_mapping.custom`), y mapeo
`lead_status`→etapa (`column_mapping.statusToStage`). Preview vía
`POST /api/leads/sources/preview`.

**Sync de estados planilla→CRM (`ingest.ts` / migración 030):**
El comprador trabaja `lead_status` en la hoja DESPUÉS de la ingesta. En cada
pasada del cron, si el estado cambió, el deal se mueve a la etapa mapeada —
salvo que un humano lo haya movido en el Kanban (`deals.stage_id !=
leads.synced_stage_id`): en ese caso la planilla pierde el control de ese deal
para siempre (`synced_stage_id = NULL`). Así la transición planilla→CRM es
automática por deal.

**Sin `last_synced_at`:** Lectura completa del rango en cada ciclo. La idempotencia la da el claim sobre `meta_lead_id`.

**Asignación least-loaded:** `pickLeastLoaded()` cuenta deals abiertos por agente, asigna al de menor carga, rompe empates al azar.

**CAPI compliance:** Solo se hashean email, phone, nombre con SHA-256. Las respuestas del formulario y datos de salud NUNCA salen del sistema. `raw_payload` restringido por RLS a owner/admin. La conversión se dispara cuando el deal llega a la etapa `trigger_stage_name` (la sync de estados hace que `closed-won` de la hoja llegue ahí).

### Flujo de uso

1. Aplicar migraciones `029_leads_meta.sql` y `030_lead_source_wizard.sql` (`supabase db push`)
2. Crear service account en Google Cloud, compartir hojas con el email del SA
3. Poner `GOOGLE_SERVICE_ACCOUNT_JSON` en `.env.local`
4. UI: Leads → Fuentes → pegar la URL → wizard (pestaña → columnas con nombre propio → estados→etapa)
5. Cron: `GET /api/leads/sync` con header `x-cron-secret: <LEADS_CRON_SECRET>` cada 2-5 min
6. Opcional: `POST /api/leads/import-historico` para importar histórico

### Rutas API del módulo

| Ruta | Método | Rol | Función |
|------|--------|-----|---------|
| `/api/leads/sync` | GET | cron-secret | Ingesta + sync de estados + CAPI |
| `/api/leads/sources` | POST | admin | Alta de fuente (con columnMapping) |
| `/api/leads/sources/preview` | POST | admin | Preview del wizard (pestañas + sugerencias) |
| `/api/leads/contacted` | POST | agent | Traza click-to-chat |
| `/api/leads/import-historico` | POST | admin | Import histórico |

---

## Migraciones

30 migraciones SQL en `supabase/migrations/`, todas aditivas (no modifican datos existentes):

```
001 — Schema inicial (profiles, contacts, conversations, messages, deals, pipelines)
002 — Mejoras de pipelines
003 — broadcast_recipient.whatsapp_message_id
004 — Cascade delete contactos
005 — Contadores incrementales broadcasts
006 — Tablas de automaciones
007 — Contador de automaciones
008 — Storage para avatares
009 — Acciones/reacciones en mensajes
010 — Builder de flows
011 — Beta features en perfil
012 — Contador de flows
013 — Unique en whatsapp_config phone_number_id
014 — Integración templates Meta
015 — Registro WhatsApp
016 — Media en flows
017 — Cuentas compartidas (multi-user, roles)
018 — RPCs de gestión de miembros
019 — RPCs de invitaciones
020 — Followups de account sharing
021 — Moneda default de cuenta
022 — Dedup de teléfonos en contactos (phone_normalized, índice UNIQUE)
023 — Media en inbox
024 — Presencia en tiempo real
025 — Filtrar contactos por tags
026 — API keys
027 — Notificaciones in-app
028 — Webhook endpoints
029 — Módulo Leads Meta (lead_sources, leads, lead_capi_events, lead_intake_errors, lead_capi_config, lead_sync_runs)
030 — Wizard de fuentes (sheet_status/synced_stage_id en leads, índice único de fuentes activas, contador stage_synced)
```

---

## Patrones y convenciones

### Supabase clients

```typescript
// En Server Components / API routes:
import { createServerClient } from "@/lib/supabase/server";
const supabase = await createServerClient();

// Admin (bypasea RLS) — solo server-side:
import { supabaseAdmin } from "@/lib/automations/admin-client";
const admin = supabaseAdmin();

// En Client Components:
import { createBrowserClient } from "@/lib/supabase/client";
```

### Auth en rutas API

```typescript
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function POST(req: Request) {
  try {
    const ctx = await requireRole("admin"); // lanza si no tiene el rol
    // ctx.accountId, ctx.userId, ctx.supabase
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

### Deduplicación de contactos

`findExistingContact()` en `src/lib/contacts/dedupe.ts` — busca por `phone_normalized` (columna generada: solo dígitos). Usada por el módulo de leads y por la ingesta de contactos CSV.

### Encriptación WhatsApp

Los tokens de WhatsApp se encriptan con AES-256-GCM usando `ENCRYPTION_KEY` antes de guardarse en DB. Ver `src/lib/whatsapp/`.

### Cron pattern

Todas las rutas cron usan:
```typescript
export const runtime = "nodejs";
// GET protegido por x-cron-secret header
```
El secret cae a `AUTOMATION_CRON_SECRET` si no hay uno específico.

### Port/Adapter (módulo leads)

`LeadRepository` en `types.ts` define la interfaz. `ingest.ts` depende solo del puerto. `repository.ts` es el adaptador Supabase. `FakeRepo` en tests es la implementación in-memory.

---

## Seguridad

- RLS en todas las tablas — siempre verificar que nuevas tablas tengan políticas
- `SUPABASE_SERVICE_ROLE_KEY` — solo en server, nunca en cliente
- `META_CAPI_ACCESS_TOKEN` — solo en env, nunca en DB
- `raw_payload` de leads — RLS restringido a owner/admin
- Tokens WhatsApp — AES-256-GCM
- Webhook signatures — HMAC-SHA256 verificado con `META_APP_SECRET`
- SSRF checks en entregas de webhooks salientes
- CSP — actualmente `Report-Only` (sin bloqueo); hardening pendiente

---

## Tests

```bash
npm run test                           # Todos
npx vitest run src/lib/leads           # Solo leads
npx vitest run src/middleware          # Solo middleware
```

Tests en `*.test.ts` al lado de los archivos que testean. Usan Vitest. No hay setup de base de datos real — los tests de leads usan `FakeRepo` in-memory.

> Nota (entorno local Windows/ART): `src/lib/currency.test.ts` y
> `src/lib/dashboard/date-utils.test.ts` tienen fallas dependientes de
> timezone/ICU en máquinas UTC-3; en CI (UTC) pasan. No están relacionadas
> con el código de la app.

---

## Deployment

Producción actual: **Dokploy** (build por Dockerfile multi-stage, Next standalone) en `appcrm.prevencion-salud.com`.
- Build args (se hornean en el bundle): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Env de runtime: `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`, y las del módulo de leads
- El dominio en Dokploy va SIN `https://` en el campo Host; Container Port 3000

También funciona: Hostinger Managed Node.js, Vercel, Railway, VPS propio con `npm run build && npm start`.
