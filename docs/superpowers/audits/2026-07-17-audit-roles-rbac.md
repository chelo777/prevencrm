# Auditoría general de roles / RBAC — prevencrm (2026-07-17)

Auditoría en 4 dimensiones (4 subagentes en paralelo) del sistema multi-usuario
recién integrado: guards de ruta, acciones admin dentro de módulos, autorización
de API + bloqueo + escalada, y completitud de RLS + lógica de gating.

**Modelo:** owner(4) > admin(3) > agent(2) > viewer(1). `is_account_member` (RLS),
`requireRole`/`getCurrentAccount` (server TS), `modules.ts` (gating de UI por
`allowed_modules`; default asesora `['leads']`). La 037 aísla datos por agente.

> **Regla de lectura:** el diseño declara "RLS es el muro real; el gating de
> módulos es UX". Varios hallazgos son consistentes con ese diseño (UX no
> garantizada) — pero dos rompen el muro real (PII entre asesoras y `blocked`
> inoperante en API), y esos son los que importan.

---

## CRÍTICO

### 1. `blocked` es cosmético en la capa API
`getCurrentAccount`/`requireRole` (`src/lib/auth/account.ts:106-190`) nunca leen
`blocked`; `is_account_member` (017) lo ignora; `set_member_blocked` (039) solo
setea la columna y **no revoca la sesión** (no hay `auth.admin.signOut`). El corte
de `blocked` vive solo en el layout server + shell (UI). Una asesora "pausada"
conserva su cookie válida y **puede seguir mutando por API** (curl/Postman). Un
**admin bloqueado conserva todo su poder** (incluida gestión de miembros). El
botón "Pausar acceso" da falsa sensación de seguridad.
**Fix:** añadir `blocked` al select de `getCurrentAccount` y lanzar `ForbiddenError`;
idealmente excluir bloqueados en `is_account_member` (RLS deniega) y revocar la
sesión al bloquear (`supabaseAdmin.auth.admin.signOut(userId,'global')`).

### 2. Fuga de PII de salud entre asesoras: `lead_intake_errors.raw_row`
SELECT = `is_account_member(account_id)` (029:178), **no tocada por 037**. `raw_row`
es la fila cruda de la planilla → nombre, teléfono y **respuestas de salud** de los
leads en cuarentena. Cualquier `agent` lee las de **todas** las asesoras. Choca de
frente con el negocio (leads exclusivos + datos sensibles).
**Fix:** aislar por asignación o restringir a admin; o no persistir las respuestas
sensibles en `raw_row`.

---

## ALTO

### 3. `automations/*` — mutaciones sin rol, con service-role (bypass RLS)
`POST /api/automations`, `PATCH/DELETE /api/automations/[id]`, `duplicate` solo
verifican `getUser()` y escriben con `supabaseAdmin()` (bypass RLS). RLS pretendida:
agent+. → un **viewer** puede crear/editar/borrar/duplicar automations (side-effecting:
mandan WhatsApp, mueven deals). Bypasea también `blocked`. Mitigación parcial:
filtran por `user_id`.
**Fix:** `requireRole('agent')` al inicio de cada handler.

### 4. `flows/*` — igual, y peor (edición cruzada)
Mismo patrón sin rol + service-role. `requireOwnership` (`flows/[id]/route.ts:39-47`)
solo comprueba **visibilidad por RLS** (`flows_select` = cualquier miembro), no
autoría → **cualquier miembro (viewer incluido) puede editar/borrar/activar CUALQUIER
flow de la cuenta**, incluidos los del owner.
**Fix:** `requireRole('agent')` en create/update/delete/activate; validar autoría por
`user_id` si el diseño lo exige.

### 5. `leads.raw_payload` no está protegido a nivel columna
La doc (029:119, CLAUDE.md) afirma "restringido a owner/admin", pero RLS es
row-level: `leads_select` (037) le da al agent la **fila entera de sus leads
asignados, incluido `raw_payload`** (respuestas de salud). Exposición hoy acotada
porque el repositorio nunca hace SELECT de esa columna — pero un agent con su sesión
Supabase puede pedirla directo. Gap de defensa-en-profundidad + mismatch con lo
documentado.
**Fix:** vista sin `raw_payload` para agent, o mover el payload a tabla admin-only.

### 6. Gating de módulos es solo cliente (sin enforcement server)
El gate de rol/módulo vive solo en `dashboard-shell.tsx:37-43` (useEffect). No hay
guard server para `/broadcasts`, `/automations`, `/flows`, `/pipelines`, `/contacts`,
`/dashboard`, `/inbox`, `/notifications`, `/quick-messages`. Un agent puede leerlos
por URL directa (ventana de render / JS off) o vía el browser Supabase client,
limitado solo por RLS. Consistente con "RLS es el muro" — pero si el requisito es que
la asesora **no vea** Broadcasts/Automations/Flows, hoy **no está garantizado**.
**Fix:** guard server por página sensible (patrón `leads/sources`) o aceptar y
documentar que módulos = UX.

---

## MEDIO

### 7. Panel Settings + tabs admin sin gate de rol (causa raíz)
`settings/page.tsx` + `settings-rail.tsx` renderizan las 9 secciones sin filtrar por
rol. El `adminOnly` de `settings-sections.ts:38` es un **comentario muerto** (no hay
campo ni filtro). Un agent abre `/settings?tab=whatsapp|templates|members|api|fields`
y ve el panel admin. GETs sensibles (`api-keys` GET, `whatsapp/config` GET) usan
`getCurrentAccount` (cualquier miembro) → expone **metadata** intra-cuenta (token
enmascarado, `phone_number_id`, roster). No cross-tenant.
**Fix:** filtrar rail por rol; redirigir tab no permitido; `requireRole('admin')` en
los GET sensibles.

### 8. Cinco acciones admin visibles dentro de módulos (patrón "Fuentes")
RLS frena la escritura, pero la UI se muestra:
- **Pipelines "Gestionar pipelines"** (`pipelines/page.tsx:354`) → diálogo que renombra,
  agrega/quita etapas y **borra el pipeline con todos sus deals**. Sin gate (el botón
  "Nuevo pipeline" sí lo tiene).
- **WhatsApp config** (`settings/whatsapp-config.tsx`) — form completo editable.
- **Template manager** (`settings/template-manager.tsx`) — crear/editar/sync/borrar (incl. en Meta).
- **Tag manager** (`settings/tag-manager.tsx`) — crear/borrar tags.
- (Fuentes ya se arregló — es el estándar de oro: redirect server + botón oculto.)
**Fix:** envolver cada acción en `useCan('edit-settings')`/`RequireRole`.

### 9. Side-effects a Meta sin `requireRole` (templates/config)
`whatsapp/templates/submit|[id]` y `whatsapp/config` POST/DELETE solo `getUser()`; las
llamadas a Meta ocurren antes del gate RLS de la tabla lateral. No es fuga de datos,
pero cuelga un side-effect externo (cuota Meta, crear/borrar templates reales) de la
RLS de otra tabla.
**Fix:** `requireRole('admin')` al tope.

### 10. Admins no protegidos entre sí
`set_member_role` (018) y `set_member_blocked` (039) excluyen owner y self, pero no a
otros admins → un admin puede degradar/bloquear a otro admin (DoS lateral; no es
escalada a owner, eso está bien cerrado).
**Fix (decisión de diseño):** exigir owner para operar sobre un target admin.

---

## BAJO / OBSERVACIONES

- **Posible regresión funcional:** `whatsapp/send|broadcast|react` leen `whatsapp_config`
  con el cliente RLS del usuario, cuyo SELECT pasó a **admin-only** (037). En la práctica
  quedarían **admin-gated** → una asesora agent podría **no poder enviar WhatsApp**.
  Revisar por diseño (¿el agent necesita enviar?). *(Flag: contradice el propósito del CRM
  para la asesora si su flujo incluye responder por WhatsApp.)*
- `broadcast_recipients` no se aísla (cascadea a `broadcasts` compartida) — solo expone
  `contact_id` (UUID no resoluble) + status. Metadata.
- `middleware.ts` `protectedPaths` incompleto (`/leads`, `/flows`, `/notifications`,
  `/quick-messages`) → visitante no autenticado a `/leads` recibe error en vez de redirect
  limpio (server component lanza sin catch). UX, no fuga.
- `canAccessPath` no normaliza querystring/fragment (latente; hoy no explotable, el único
  call site pasa `usePathname()` sin query). Un test "pasa por la razón equivocada"
  (`modules.test.ts:57`).
- `set_member_modules` (039) no excluye owner/self (inerte, pero por consistencia).

## Positivos confirmados
- Aislamiento por-agente de la 037 correcto y **cascadeo verificado** (contact_notes,
  lead_capi_events, contact_custom_values, contact_tags, messages, message_reactions).
- Config sensible endurecida a admin-only en SELECT (037).
- Gestión de miembros **cross-tenant sólida**: valida account_id; admin no puede
  auto-ascenderse a owner ni tocar al owner; API keys solo admin.
- `leads/sources` blindado server-side (estándar de oro).
- Sin policies permisivas legacy (017 dropeó todas, incl. el `messages INSERT (true)`).
- Sidebar ↔ canAccessPath alineados; `effectiveModules` robusto a null/[]/slug inválido.

---

## Ranking de remediación sugerido
1. **#1 blocked** + **#2 raw_row PII** (los dos que rompen el muro real).
2. **#3/#4 automations/flows sin rol** (viewer escala; flows edita ajenos).
3. **#5 raw_payload** (columna PII).
4. **#7/#8 gate de Settings + acciones admin en módulos** (patrón Fuentes).
5. **#9/#10 side-effects Meta / admins entre sí.**
6. Revisar la **regresión de envío WhatsApp para agent** (puede ser bug de producto, no de seguridad).
7. Bajos (middleware, querystring, guards).
