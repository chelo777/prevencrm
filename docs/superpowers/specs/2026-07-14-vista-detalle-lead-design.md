# Vista de detalle de lead — Design

**Fecha:** 2026-07-14
**Rama sugerida:** `feature/lead-detail-view`

## Goal

Que el asesor pueda abrir un lead y ver/trabajar toda su info en un solo lugar: las respuestas que cargó en el formulario de Meta **de forma legible**, su estado (etapa), sus comentarios (con un campo para agregar) y sus etiquetas (con posibilidad de asignar). Accesible desde la lista `/leads` (click en la fila) y desde el push de "nuevo lead" (deep-link al lead).

## Contexto (qué existe hoy)

- **`/leads`** (`src/app/(dashboard)/leads/page.tsx`): server component, tabla paginada. Cada fila tiene `StageSelect` (etapa editable) y `WhatsAppButton`. **Las filas no son clickeables a un detalle.**
- **`ContactDetailView`** (`src/components/contacts/contact-detail-view.tsx`): Sheet lateral (`side="right"`) con tabs **Detalles / Etiquetas / Notas / Campos personalizados / Deals**, keyed por `contactId`. Ya implementa: agregar/listar/borrar notas (`contact_notes`), asignar/quitar tags (`contact_tags` + catálogo `tags`), editar campos personalizados (`contact_custom_values`), y listar deals con su etapa. Hoy solo se usa en `/contacts`.
- **`StageSelect`** (`src/app/(dashboard)/leads/stage-select.tsx`): client component autónomo `{ dealId, stages, initialStageId }` que hace update optimista de `deals.stage_id`. Reutilizable.
- **Respuestas del formulario:** las llena la ingesta en `contact_custom_values` (via `setCustomValues`), como slugs — `field_name` "qué edad tenés", `value` "entre_36_y_49_años". Los "comentarios" del form entran como **nota** (`addNote`), no como campo.
- **Push de nuevo lead:** `src/lib/push/lead-alerts.ts` → `buildLeadAlert()` arma el payload con `url: "/leads"` (genérico, tanto para 1 como para varios). El service worker (`public/sw.js`) en `notificationclick` navega a `event.notification.data.url`. **Cambiar la `url` alcanza para deep-linkear** — el SW no se toca.
- Sin cambios de base de datos: todas las tablas existen.

## Arquitectura

**Reusar y extender `ContactDetailView`** (no construir un panel nuevo — duplicaría notas/tags). El panel se abre por `contactId`; la etapa se deriva del deal abierto más reciente del contacto (que ya se fetchea).

### Cambios en `ContactDetailView`

1. **Tab nueva "Formulario"** (read-only, legible). Renderiza los `contact_custom_values` del contacto humanizados: `field_name` capitalizado + `value` con `_`→espacio y capitalizado. Filtra valores vacíos y el `field_name` decoy `"id"`. Se muestra **solo si hay al menos un valor con contenido**. Es la respuesta a "ver qué completó".
2. **Estado editable en el header.** Debajo del nombre/teléfono, un `StageSelect` con el deal abierto más reciente del contacto. Requiere el catálogo de etapas → `ContactDetailView` fetchea `pipeline_stages` de los pipelines de la cuenta (nuevo fetch chico). Si el contacto no tiene deal, no se muestra el select.
3. **Prop `defaultTab?: string`** (default `"details"`). Cuando se abre desde un lead se pasa `defaultTab="form"` para que lo primero que vea el asesor sea el formulario.
4. **Helper puro `humanizeFormValue(s)` / `humanizeFieldName(s)`** en un módulo aparte (`src/lib/leads/humanize.ts`) — testeable con Vitest.

### Cambios en `/leads`

5. **Wrapper cliente para abrir el panel.** Un client component (`LeadsTableClient` o un provider chico) mantiene `openContactId: string | null` y renderiza `ContactDetailView`. La celda "Contacto" de cada fila pasa a ser un botón que setea `openContactId` con el `contact.id` de esa fila. El resto de la tabla queda server-render; solo la parte interactiva es cliente (mismo patrón que `StageSelect`/`WhatsAppButton` ya conviven en filas server).
6. **Deep-link `?lead=<id>`.** El server component lee `searchParams.lead`; si viene, hace un fetch puntual `select contact_id from leads where id = <lead> and account_id = <acc>` y pasa `initialOpenContactId` al wrapper para que abra el panel al montar. (Fetch puntual porque el lead deep-linkeado puede no estar en la página actual del paginado.) Si el lead no existe / no es de la cuenta, no abre nada (silencioso).

### Cambios en el push (`src/lib/push/lead-alerts.ts`)

7. `notifyNewLeads`: agregar `id` al `select` de leads y pasarlo a `buildLeadAlert`.
8. `buildLeadAlert`: para el caso de **un solo lead**, `url: "/leads?lead=<leadId>"`. Para varios, se mantiene `url: "/leads"` (no se puede deep-linkear a uno). `LeadForAlert` suma `leadId: string`.

## Renderizado legible (reglas)

- **field_name:** capitalizar la primera letra. Ej. `"qué edad tenés"` → `"Qué edad tenés"`.
- **value:** `replace(/_/g, " ")`, colapsar espacios, capitalizar la primera letra. Ej. `"entre_36_y_49_años"` → `"Entre 36 y 49 años"`; `"soy_monotributista_/_autónomo"` → `"Soy monotributista / autónomo"`.
- **Filtro:** omitir valores vacíos/whitespace y `field_name === "id"`.
- Orden: por `field_name` (estable), igual que el resto del componente.

## Manejo de errores y edge cases

- **Sin deal:** no se renderiza el `StageSelect` del header (el contacto puede existir sin deal, aunque un lead siempre tiene uno).
- **Sin custom values:** la tab "Formulario" no aparece.
- **Deep-link a lead inexistente / de otra cuenta:** el fetch puntual (bajo RLS) no devuelve fila → no abre panel, `/leads` renderiza normal.
- **RLS:** todo pasa por el cliente Supabase del usuario (no service-role). El aislamiento por agente (migración 037) aplica: un agente solo abre leads/contactos que le corresponden. Nada nuevo se expone — `contact_custom_values` ya era accesible en la tab "Campos personalizados".
- **Realtime / stale:** al agregar nota o togglear tag se refetchea la sección afectada (patrón ya existente en `ContactDetailView`).

## Testing

- **Unit (Vitest):** `humanize.ts` — casos: slug con `_`, con `/`, con acentos, vacío, ya-legible. Archivo `src/lib/leads/humanize.test.ts`.
- **Verificación manual/Playwright:** (a) click en fila de `/leads` abre el panel en la tab Formulario con los valores legibles; (b) agregar una nota y una etiqueta persisten; (c) cambiar la etapa desde el header se refleja en la lista; (d) navegar a `/leads?lead=<id>` abre el panel de ese lead; (e) el layout del Sheet no rompe en móvil.

## Fuera de alcance (a propósito)

- **Entradas de "nuevo lead" en el centro de notificaciones** (`/notifications`) — hoy solo tiene `conversation_assigned`. El usuario confirmó que usa el **push**, que ya funciona; el deep-link del push cubre el pedido. Agregar un tipo de notificación in-app queda como follow-on si se pide.
- **Editar** las respuestas del formulario (son lo que cargó el lead; se muestran read-only). La edición manual de campos sigue disponible en la tab "Campos personalizados" existente.
- Cambios en el service worker o en el sistema de push más allá de la `url`.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/lib/leads/humanize.ts` | **Crear** — helpers puros de humanización |
| `src/lib/leads/humanize.test.ts` | **Crear** — tests Vitest |
| `src/components/contacts/contact-detail-view.tsx` | Tab "Formulario", estado editable en header, prop `defaultTab`, fetch de `pipeline_stages` |
| `src/app/(dashboard)/leads/page.tsx` | Leer `?lead=`, resolver contact_id, pasar al wrapper |
| `src/app/(dashboard)/leads/leads-table-client.tsx` (o similar) | **Crear** — wrapper cliente que abre el panel (row-click + deep-link) |
| `src/lib/push/lead-alerts.ts` | Thread `leadId`; `url` con deep-link para lead único |
