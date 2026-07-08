# Glosario de traducción — frontend en español (rioplatense)

Regla general: **la prosa se traduce, la jerga de laburo queda**. Voseo
("Creá", "Tocá", "Elegí"), acentos completos, comillas rectas. Nunca
smart quotes (rompieron el build dos veces).

## Quedan en inglés

| Término | Motivo |
|---|---|
| Leads | Término del rubro, universal |
| Dashboard | Universal y corto |
| Pipeline | Jerga de ventas instalada |
| Deal | Corto, ya lo usan ("Nuevo deal") |
| Inbox | Más común que "Bandeja de entrada" |
| Flows | Nombre oficial de la feature de WhatsApp |
| WhatsApp, API keys, Beta | Nombres propios / técnicos |

## Se traducen

| Inglés | Español |
|---|---|
| Contacts | Contactos |
| Notifications | Notificaciones |
| Settings | Configuración |
| Broadcasts | Difusiones |
| Automations | Automatizaciones |
| Tags | Etiquetas |
| Templates (Meta) | Plantillas |
| Won / Lost | Ganado / Perdido |
| Stage | Etapa |
| Owner / Admin / Agent / Viewer | Dueño / Admin / Agente / Visor |
| Members | Miembros |
| Save / Cancel / Delete / Edit | Guardar / Cancelar / Borrar / Editar |
| Add / Create / New X | Agregar / Crear / Nuevo X |
| Search... | Buscar… |
| Loading... | Cargando… |
| No X yet | Todavía no hay X |
| Mark all as read | Marcar todo leído |
| Sign in / Sign up / Sign out | Iniciar sesión / Crear cuenta / Cerrar sesión |

## Frases de fecha/tiempo

- "vs yesterday" → "vs ayer" · "this month" → "este mes" · "today" → "hoy"
- Rangos: "7 days / 30 days / 90 days" → "7 días / 30 días / 90 días"
- `toLocaleString`/`toLocaleDateString` → locale `"es-AR"`

## Método (lecciones de los 2 intentos fallidos)

1. Inline, sin agentes. Módulo por módulo.
2. Un commit por módulo, con typecheck + build en verde antes de commitear.
3. Tests que asserten strings en inglés se ajustan en el mismo commit.
4. Todo en la rama `feature/traduccion-es` — main no se toca hasta el OK.

## Estado

- ✅ Ya en español de fábrica: Leads, Fuentes, Mensajes rápidos, push.
- Fase 1: shell (sidebar/header/auth), Pipelines, Dashboard, Notificaciones.
- Fase 2: Contactos, Configuración.
- Fase 3: Inbox, Difusiones, Automatizaciones, Flows.
