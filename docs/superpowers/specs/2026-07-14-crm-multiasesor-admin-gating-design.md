# CRM multi-asesor con control del admin — Design (v2, post-council)

**Fecha:** 2026-07-14 · **Revisado:** 2026-07-16 tras pressure-test del LLM Council.
**Rama sugerida:** `feature/crm-multiasesor`
**Sub-proyecto:** SP1 de 3 (SP2 = router/reparto por cupo, SP3 = módulo de venta de datos — fuera de alcance).
**Council:** `docs/superpowers/council/council-report-2026-07-16-192307.html` (+ transcript).

## Goal

Meter a las asesoras (compradoras de leads) al CRM de forma **segura** y con **valor real para ellas**, con control **mínimo** del admin. El admin ve el trabajo de todas; cada asesora ve solo lo suyo y trabaja su loop (leer el lead → WhatsApp pre-armado → mover etapa) más rápido que en su planilla.

## Qué cambió el council (el reencuadre)

El diseño original tenía el orden invertido y un agujero de seguridad:
- **El gating de módulos es COSMÉTICO — el único control real es RLS.** El sidebar y el guard de ruta son UX; una asesora con sesión pega a `/api/v1/...` (que no pasa por el layout) o a cualquier route handler y trae todo. **Hoy, meter una asesora real filtra los datos de todas las demás, incluidos datos de salud.**
- **La 037 aísla solo la mitad del modelo** — deja abiertas tablas con PII.
- **El riesgo real es la adopción, no la técnica.** Controles PARA el dueño, cero valor PARA la asesora, no generan adopción.

→ **Se reordena: piso de seguridad primero, valor de la asesora al frente, gating/blocked mínimos y últimos.**

## Scope

**Dentro (SP1):** aislamiento de datos completo (RLS en TODAS las tablas + `/api/v1` verificada), el loop de valor de la asesora (mayormente ya existe), gating de módulos + bloquear (mínimos), asignación (auto + reasignación manual), event log sembrado.
**Fuera:** router/reparto por cupo (SP2), venta de datos (SP3). Migración de planillas y modelo legal/PII: flagueados, no bloquean el piloto con una asesora.

## Arquitectura por fases (orden = orden de construcción)

### Fase 1 — Piso de seguridad (NO negociable, primero, antes de cualquier UI)

**1.1 Auditar TODAS las tablas con RLS** e inventariar cuáles necesitan aislamiento por agente (no confiar en la lista de 037). Punto de partida a verificar una por una:
- **Aislar por agente** (agent ve solo lo suyo, admin ve todo): `deals`, `conversations`, `messages`, `contacts`, `leads`, `contact_notes`, `contact_custom_values`, `contact_tags`, `lead_capi_events` (PII + conversiones), `push_subscriptions` (por `user_id`).
- **Revisar caso por caso:** `custom_fields`, `tags` (catálogos de cuenta — ¿compartidos o por agente?), `quick_messages` (¿compartidos?), `lead_intake_errors`, `lead_sync_runs`, `notifications` (ya por user), `broadcasts`, `automations`, `flows`, `message_templates`, `whatsapp_config`, `api_keys`, `webhook_endpoints`.
- **Coherencia:** las tablas hijas (`contact_notes`, `contact_custom_values`, `contact_tags`) deben aislar consistente con su padre (`contacts`) — hoy verían la nota pero no el contacto, o al revés.

**1.2 Migración 037 (aislamiento) — EXTENDIDA y escrita fresh en main** (NO cherry-pick). Cubre todas las tablas del inventario 1.1, no solo las 4 originales.
> **Git:** las 037/038 de `feature/router-multiasesor` NO se cherry-pickean (colisión de número de migración con distinto hash → Supabase explota/duplica al mergear). El SQL es **fuente única en main**; la rama router se rebasa sobre main y descarta sus 037/038. El **código** (`repository.ts`, `lead-alerts.ts`) sí se cherry-pickea o re-aplica.

**1.3 Migración 038 — `profiles.is_lead_buyer`** + `listAssignableAgents` filtra `is_lead_buyer` (repository.ts) + fix `lead-alerts.ts` (`profiles.user_id`). Escrita fresh en main.

**1.4 Verificar `/api/v1` y TODA ruta de API** — que usen el cliente Supabase del usuario (RLS aplica) y no service-role para datos del agente, o que gateen por rol. Auditar cada handler. **El gating de ruta del frontend NO protege la API.**

**1.5 Custom claims en el JWT** (Supabase `access_token` hook): rol + `allowed_modules` + `blocked` viajan en el token, para que el guard server y el sidebar no peguen a la DB en cada request. (Alternativa si el hook complica: `React.cache` por request.)

**Verificación de Fase 1 (gate):** con DOS usuarios reales (un admin, una agente), probar que la agente NO ve datos ajenos ni por UI ni por `fetch('/api/v1/...')` en la consola. Sin este gate verde, NO se avanza a UI.

### Fase 2 — El valor de la asesora (lo que genera adopción)

El loop core de la asesora **ya existe**: panel de detalle del lead (form legible) + botón de WhatsApp con **mensaje pre-armado** (mensajes rápidos) + cambiar etapa inline. La pieza de valor de SP1 es **hacer que ese loop sea la experiencia principal de la asesora** (que abrir un lead y responder por WhatsApp sea más rápido que su planilla), no construir algo nuevo. Norte de adopción (fuera de SP1, notado): recordatorios de seguimiento, comisión calculada.

### Fase 3 — Gating y bloquear (admin, mínimos, después del piso)

**3.1 Gating de módulos:** `profiles.allowed_modules TEXT[]`. Efectivos: admin/owner=todos; agent=`allowed_modules` o default `['leads']`. Enforcement: sidebar filtra + guard de ruta en el layout server (leyendo el **claim del JWT**, no la DB). Función pura `src/lib/auth/modules.ts` testeable.
- **UX (del Outsider):** esconder **de verdad** (no mostrar puertas cerradas que generan "no confían en mí"). Nada de módulos visibles-pero-bloqueados.

**3.2 Bloquear:** `profiles.blocked BOOLEAN`. Enforcement **real, no solo cosmético**: el guard server bloquea + se **invalida/revoca la sesión** (forzar signOut; la RLS igual protege los datos). Owner nunca bloqueable.
- **UX:** lenguaje no punitivo (no "suspendido/bloqueado" tipo banco para una asesora que no cometió falta) — algo como "tu acceso está pausado, contactá al admin".

**3.3 UI del admin:** Configuración → Miembros, por asesora: checkboxes de módulos + toggle de acceso. Vía **RPCs SECURITY DEFINER (migración 039)** `set_member_modules`, `set_member_blocked` — admin+ only, **con `WHERE account_id` propio** (que una asesora no edite a otra cuenta), no owner, no self para blocked.

### Fase 4 — Event log (sembrar ahora, no mostrar)

Tabla append-only **`activity_log`** (migración 040): `id, account_id, user_id, deal_id, lead_id, action (stage_change|contacted|note_added|reassigned), meta jsonb, created_at`. Se escribe en las acciones clave (cambio de etapa, click de WhatsApp/contacted, nota, reasignación). **No se muestra en UI en SP1.** Es el insumo del CAPI de calidad y del "ver si actualizan" hecho bien (un log, no vigilancia intrusiva).

## Asignación

Automática `pickLeastLoaded` entre asesoras `is_lead_buyer` (admin excluido) + **reasignación manual** del admin (selector "Asignada a" en el panel de detalle del lead → `deals.assigned_agent_id`). **Edge:** leads `assigned_agent_id NULL` deben ser visibles para el admin (la policy "admin ve todo" lo cubre — verificar).

## Rollout y riesgos (del council — explícitos)

- **Empezar con UNA asesora (Ale, ya adentro), no seis.** Si una no lo elige por gusto, ningún panel de admin lo arregla.
- **Doble vida / fuente de verdad:** si la asesora sigue en su planilla, el CRM queda con datos vacíos/podridos → envenena el CAPI y las métricas. Falta el mecanismo que fuerce al CRM como única fuente (import del Excel + que el WhatsApp valioso solo exista adentro). Parcialmente producto/SP2 — **flag**, se decide antes de escalar a 6.
- **Legal / PII:** leads con datos de salud compartidos entre compradoras que compiten; revender PII de un lead no trabajado; qué pasa cuando una asesora se va "con sus leads". **Revisar antes de escalar** (no bloquea el piloto con una asesora que ya opera bajo la cuenta).
- **Puerta de una sola vía:** las compradoras son el ingreso; un rollout mal hecho daña la relación. Ir de a una, con cuidado.

## Data model (migraciones)

| # | Contenido |
|---|---|
| 037 | RLS de aislamiento por agente — **EXTENDIDA** a todas las tablas del inventario 1.1. Fresh en main. |
| 038 | `profiles.is_lead_buyer` + código (repository.ts, lead-alerts.ts). Fresh en main. |
| 039 | `profiles.allowed_modules` + `profiles.blocked` + RPCs `set_member_modules`/`set_member_blocked` (con `WHERE account_id`, no owner/self). |
| 040 | `activity_log` append-only. |
| — | Custom claims: Supabase `access_token` auth hook (config del proyecto). |

## Manejo de errores y edge cases

- Asesora sin módulos (`allowed_modules = '{}'`) → pantalla "sin módulos habilitados, hablá con el admin", sin loop de redirects.
- Admin auto-gateándose/bloqueándose: RPCs rechazan blocked sobre self/owner; `allowed_modules` no aplica a admin/owner.
- Ruta no mapeada a módulo (`/leads/sources`, `/settings`) → mapeo por prefijo; `/settings` siempre permitido (perfil propio; sus tabs de config ya gateados por rol).
- Contacto con dos deals de dos asesoras → ambas lo ven (aceptado; el aislamiento es por deal). Documentar.
- Blocked con sesión activa → sesión invalidada (Fase 3.2), no solo pantalla.
- Deep-link del push a lead no asignado → RLS no devuelve la fila, el panel no abre (ya manejado).

## Testing

- **Unit (Vitest):** `modules.ts` (efectivos, canAccess, moduleForPath). `roles.ts` sigue cubierto.
- **Integración/manual (el gate crítico):** dos usuarios reales — la agente no accede a datos ajenos por UI **ni por `/api/v1`**. Por tabla del inventario 1.1. Este es el test que decide si el piso está.
- **Playwright:** invitar asesora → ve solo Leads → URL directa a otro módulo redirige → admin agrega módulo → aparece → admin pausa acceso → sesión cortada → la asesora ve solo sus leads, el admin ve todos → reasignar cambia dueño.

## Fuera de alcance (a propósito)

- Router / reparto por cupo (`pickByQuota`, `/r/[leadId]` con identificación, `lead_router_events`) = SP2.
- Módulo de venta de datos = SP3 (solo se deja el rol admin preparado).
- Import de planillas y modelo legal/PII completo = flagueados, se resuelven antes de escalar a 6 asesoras.
- Cambiar el login (sigue email+password Supabase; alta por `inviteUserByEmail`/`generateLink('invite')` que crea el user confirmado sin fricción, seteando `is_lead_buyer`/`allowed_modules` en el trigger de creación de profile).
