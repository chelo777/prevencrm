# CRM multi-asesor con control del admin (roles + gating de módulos) — Design

**Fecha:** 2026-07-14
**Rama sugerida:** `feature/crm-multiasesor`
**Sub-proyecto:** SP1 de 3 (SP2 = router/reparto por cupo, SP3 = módulo de venta de datos — ambos fuera de alcance).

## Goal

Meter a las asesoras (compradoras de leads) dentro del CRM como usuarias controladas por un admin. El admin da de alta asesoras, decide **qué módulos ve cada una** (ej. Paula solo Leads, porque WhatsApp/automatización todavía no están listos), puede **bloquear/habilitar** usuarios, y **ve el trabajo de todas** mientras cada asesora ve **solo lo suyo**. Esto habilita el "ver si están actualizando sus leads".

## Contexto (qué existe / qué falta)

**Existe y se reutiliza:**
- Roles `owner/admin/agent/viewer` con doble enforcement: RLS SQL (`is_account_member(account_id, min_role)`) + predicados TS espejados (`src/lib/auth/roles.ts`). **Admin = owner/admin; Asesor = agent.**
- Alta de usuarios por **invitación por link** (`invite-member-dialog.tsx`, RPCs 019, `/join/[token]`): el admin genera un link con un rol, la asesora se registra con Supabase Auth (su propio email + contraseña) y redime la invitación. Sin email service; el admin no toca credenciales.
- Gestión de miembros: `members-tab.tsx`, RPCs 018 (`set_member_role`, `remove_account_member`), rutas `/api/account/members`.
- Reparto automático de leads: `pickLeastLoaded()` + `listAssignableAgents()` en `src/lib/leads/`.

**Falta (lo nuevo de este proyecto):**
- Gating de módulos por usuario. Hoy `sidebar.tsx` muestra **todos** los `navItems` a todos; no hay tabla de features ni lectura de `beta_features` para ocultar módulos.
- Concepto de **bloquear/deshabilitar** usuario (solo existe expulsión).
- **Aislamiento de datos por agente**: en `main` cualquier miembro ve todos los datos de la cuenta. La RLS de aislamiento existe pero vive en la rama `feature/router-multiasesor` (migración 037), sin mergear.
- **Reasignación manual** de un lead a otra asesora.

## Alcance

**Dentro (SP1):** roles+alta (reuso), gating de módulos, bloquear/habilitar, aislamiento de datos (graduar Fase 0 del router a main), asignación (automática existente + reasignación manual del admin), UI del admin.

**Fuera:** el router / reparto por cupo fino (`pickByQuota`, página `/r/`, identificación del lead) = SP2. Módulo de venta de datos = SP3 (solo se deja el rol admin preparado, sin construir).

## Diseño

### 1. Roles y alta — reuso
Admin = `owner/admin`, Asesor = `agent`. No se agregan roles. El admin invita asesoras con rol `agent` por el flujo de link existente. Al aceptar, la asesora queda `agent` en la cuenta del admin.

### 2. Gating de módulos — nuevo

**Modelo:** default por rol + override por usuario.

- Nueva columna `profiles.allowed_modules TEXT[]` (nullable). Slugs de módulos = segmentos de ruta de la nav: `dashboard, inbox, notifications, leads, quick-messages, contacts, pipelines, broadcasts, automations, flows`.
- **Módulos efectivos de un usuario:**
  - Admin/owner → **todos** (nunca se gatean).
  - Agent/viewer → `allowed_modules` si está seteado; si es `NULL` → el default `DEFAULT_ASESOR_MODULES = ['leads']` (constante). Así una asesora nueva ve Leads sin que el admin configure nada.
- **Excepción:** el perfil propio (Configuración → tab Perfil: cambiar contraseña/avatar) es **siempre accesible** — el gating aplica a los módulos operativos, no a la gestión de la cuenta propia. La ruta `/settings` queda accesible pero sus tabs de configuración de cuenta ya están gateados por rol (`RequireRole`), así que una asesora solo ve/edita su perfil.
- **Enforcement en 2 capas:**
  - **Sidebar** (`sidebar.tsx`): filtra `navItems` por los módulos efectivos del usuario (leído de `useAuth`).
  - **Guard de ruta** (server, en el layout de `(dashboard)`): mapea la ruta actual → slug de módulo; si el usuario no lo tiene permitido → `redirect()` a su primer módulo permitido (o a `/leads`). Esto blinda el acceso por URL directa; la UI sola no alcanza.

**Función pura** `src/lib/auth/modules.ts`: `effectiveModules(role, allowed)`, `canAccessModule(role, allowed, slug)`, `moduleForPath(pathname)`. Testeable con Vitest.

### 3. Bloquear/habilitar — nuevo

- Nueva columna `profiles.blocked BOOLEAN NOT NULL DEFAULT false`.
- **Enforcement:** el layout server de `(dashboard)` (que ya resuelve el profile) chequea `blocked`; si está bloqueada, renderiza una pantalla **"Cuenta suspendida"** (sin datos) en vez del CRM. La RLS sigue protegiendo los datos igual. (El owner nunca puede ser bloqueado.)
- El admin togglea desde la UI de miembros.

### 4. Aislamiento de datos — graduar Fase 0 del router a main

Traer a `main` las piezas **terminadas y probadas** de la Fase 0 (hoy en `feature/router-multiasesor`), por cherry-pick o re-aplicación:
- **Migración 037** — RLS de aislamiento por `assigned_agent_id`: admin/owner ven todo; agent ve solo sus `deals/conversations/contacts/leads` asignados. (Ya verificada: con un solo perfil cae en la rama admin, cero cambio; el aislamiento entra en juego con el primer agente real — que es justo lo que este proyecto crea.)
- **Migración 038** — `profiles.is_lead_buyer` + `repository.ts` (`listAssignableAgents` filtra `is_lead_buyer` en vez de rol) + fix de `lead-alerts.ts` (`profiles.user_id`).

Numeración: `main` está en 036; 037/038 quedan con esos números (consistentes). **Nota git:** al mergear más adelante la rama `feature/router-multiasesor`, habrá que reconciliar 037/038 ya presentes en main (rebasar la rama sobre main resuelve esto).

Resultado: admin ve todo el trabajo; cada asesora ve **solo sus leads asignados**.

### 5. Asignación — automática + reasignación manual

- **Automática (existe):** `pickLeastLoaded()` reparte los leads entrantes entre las asesoras marcadas `is_lead_buyer = true` (viene con 038 + el cambio de `repository.ts`). El admin (`is_lead_buyer = false`) queda fuera del reparto. Al invitar una asesora, se la marca `is_lead_buyer = true`.
- **Reasignación manual (nueva):** el admin puede cambiar `deals.assigned_agent_id` a otra asesora. **UI:** un selector **"Asignada a"** (solo admin) en el header del panel de detalle del lead (`ContactDetailView`, el que ya construimos), que lista las asesoras `is_lead_buyer` de la cuenta y actualiza `assigned_agent_id`. Bajo RLS 037 el admin puede editar cualquier deal.

### 6. UI del admin — nuevo

- **Configuración → Miembros** (`members-tab.tsx`): por cada miembro `agent`, además del select de rol y el botón de remover, dos controles nuevos (admin+ only):
  - **Módulos**: multi-select / checkboxes de los módulos disponibles, seteando `allowed_modules`.
  - **Bloquear/habilitar**: toggle sobre `blocked`.
- Estas mutaciones tocan filas de OTROS perfiles → como la RLS de `profiles` solo permite editar el propio, van por **RPCs SECURITY DEFINER nuevas** (patrón de las 018): `set_member_modules(p_user_id, p_modules)` y `set_member_blocked(p_user_id, p_blocked)` — admin+ only, no tocan owner ni self para blocked. Rutas API `/api/account/members/[userId]` (PATCH ampliado o sub-rutas).

## Data model (migraciones)

- **037 / 038** — graduadas desde la rama router (ver §4).
- **039 (nueva)** — `profiles.allowed_modules TEXT[]` + `profiles.blocked BOOLEAN DEFAULT false` + RPCs `set_member_modules`, `set_member_blocked` (SECURITY DEFINER, admin+, con las mismas guardas que 018: cuenta propia, no owner, no self para blocked).

## Manejo de errores y edge cases

- **Asesora sin ningún módulo permitido** (`allowed_modules = '{}'` explícito): el guard la manda a una pantalla "Sin módulos habilitados — hablá con el admin". No loop de redirects.
- **Admin se auto-gatea/bloquea:** las RPCs rechazan `blocked` sobre self y sobre owner (SQLSTATE → 400). `allowed_modules` no aplica a admin/owner (se ignora), así que auto-gatearse no tiene efecto.
- **Ruta no mapeada a módulo** (ej. `/leads/sources`, `/settings`): el guard mapea por prefijo (`/leads/*` → `leads`); `/settings` siempre permitido (perfil propio).
- **Deep-link del push** (`/leads?lead=`) a una asesora que no tiene el lead asignado: RLS 037 no le devuelve el contacto → el panel no abre (silencioso), como ya maneja la vista de detalle.
- **Bloqueada con sesión activa:** el próximo request pega el layout → pantalla suspendida. Opcional: forzar signOut.

## Testing

- **Unit (Vitest):** `src/lib/auth/modules.ts` — `effectiveModules` (admin=todos, agent con/sin override, default), `canAccessModule`, `moduleForPath` (prefijos, settings siempre, ruta desconocida). Y `src/lib/auth/roles.ts` sigue cubierto.
- **Manual/Playwright:** (a) invitar una asesora, entra y ve solo Leads; (b) URL directa a `/pipelines` la redirige; (c) admin le agrega Pipelines → aparece; (d) admin la bloquea → pantalla suspendida; (e) la asesora ve solo sus leads asignados, el admin ve todos; (f) el admin reasigna un lead y cambia de dueño.

## Fuera de alcance (a propósito)

- **Router / reparto por cupo** (`pickByQuota`, `/r/[leadId]` con identificación, `lead_router_events`) = SP2, su propia sesión de diseño.
- **Módulo de venta de datos** = SP3. Solo se deja el rol admin como el que lo administrará; no se construye nada ahora.
- Cambiar el modelo de login (sigue email+password de Supabase). No se agrega username suelto.

## Archivos afectados (aproximado)

| Archivo | Cambio |
|---|---|
| `supabase/migrations/037_*.sql`, `038_*.sql` | **Graduar** desde la rama router |
| `supabase/migrations/039_member_modules_blocked.sql` | **Crear** — columnas + RPCs |
| `src/lib/leads/repository.ts` | `listAssignableAgents` → `is_lead_buyer` (de 038) |
| `src/lib/push/lead-alerts.ts` | fix `user_id` (de 038) |
| `src/lib/auth/modules.ts` + `.test.ts` | **Crear** — lógica pura de gating |
| `src/hooks/use-auth.tsx` | Exponer `allowedModules`/`blocked`/módulos efectivos |
| `src/components/layout/sidebar.tsx` | Filtrar `navItems` por módulos efectivos |
| `src/app/(dashboard)/layout.tsx` | Guard de ruta + pantalla "suspendida"/"sin módulos" |
| `src/components/settings/members-tab.tsx` | Controles de módulos + bloquear por miembro |
| `src/app/api/account/members/[userId]/route.ts` | PATCH ampliado (módulos, blocked) → RPCs |
| `src/components/contacts/contact-detail-view.tsx` | Selector "Asignada a" (admin) |
| `src/lib/auth/roles.ts` | (opcional) predicado `canAssignLeads` / helpers |
