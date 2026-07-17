# Router de datos + VBO por capitas (MVP) — diseño

**Fecha:** 2026-07-17 · **Estado:** aprobado + **revisado por council (ver "Revisiones post-council" al final — VINCULANTE)** · **Migración:** 042

> ⚠️ La sección **"Revisiones post-council"** al final OVERRIDEA varias decisiones de
> abajo (contador derivado, cupo con auto-apagado, seguridad del reclamo, captura de
> capitas, orden de commits). El plan de implementación sigue esas revisiones.

## Objetivo

Desacoplar la **máquina de anuncios** de los **asesores**. Un solo formulario
global alimenta un **pozo común** de leads; el router los reparte entre los
asesores que están **recibiendo**. Esto permite **crecer el grupo de asesores**
sin armarle un anuncio propio a cada uno, y **concentra la señal de optimización**
de Meta en una sola máquina (mejor aprendizaje que el modelo "martillo", que se
descarta).

## Estado actual verificado (2026-07-17)

- **CAPI funciona end-to-end.** 4 reglas activas en `lead_capi_config`
  (Calificado→`calificado`, No-calificado→`no-calificado`, Closed-Won→`closed-won`,
  Perdido→`perdido`), dataset `796135859815097`. 361 eventos `sent`, 0 fallidos;
  Meta los recibe (verificado con dataset_stats en vivo). Atribuye por `lead_id`.
  **Las calificaciones de los asesores ya se reflejan en Meta.**
- **CAPI dispara** por barrido de estado en el cron `/api/leads/sync`
  (`reconcileAllCapi`): un deal que está en la etapa disparadora emite su evento
  una vez (idempotente por `UNIQUE(lead_id, event_name)`; "sellado" = fila `sent`).
- **CAPI no manda valor.** `deal.value = 0` y nunca viaja → Meta optimiza por
  **cantidad** de calificados, no por valor. (VBO fuera de alcance, ver abajo.)
- **Ruteo actual:** `pickLeastLoaded` (`src/lib/leads/ingest.ts:48-55`) entre
  perfiles `is_lead_buyer`, contando deals `open`. **`pickByQuota` NO existe.**
  La asignación automática ocurre en `ingestLead` si `opts.autoAssign`
  (`ingest.ts:104-111`) → `assignDealIfUnassigned` (`repository.ts:238-245`).

## Arquitectura — 3 capas desacopladas

1. **Máquina de anuncios** (config de Meta, no código): 1 formulario global → pozo.
   *Prerrequisito operativo:* apuntar la fuente `meta_api` (`lead_sources.meta_form_ids`)
   al form global en vez de a los form_ids del piloto de Ale.
2. **Router / pozo común** (este spec): reparte a asesores activos + reclamo.
3. **Venta de datos** (SP3, futuro): el admin vende leads del pozo. Fuera de alcance.

## Router MVP

Columnas en inglés (convención del esquema: `is_lead_buyer`, `allowed_modules`,
`blocked`); la UI queda en español ("Recibe leads", "N recibidos").

### Pool elegible
Un asesor entra a la fila de reparto si:
`is_lead_buyer = true` **AND** `receiving_leads = true` **AND** `blocked = false`.

### Reparto
`pickLeastLoaded` entre el pool elegible — al de menos deals `open`, desempate al
azar. Balancea carga actual; el que cierra/califica rápido baja abiertos y recibe
más (premia trabajar → mejor señal Meta). Se extiende `listAssignableAgents`
(`repository.ts:207-236`) para filtrar por `receiving_leads` además de `is_lead_buyer`.

### Cupo manual (sin tiempo)
- Contador `leads_received_count` por asesor que **incrementa en cada asignación
  automática del router** (no en reasignación manual del admin).
- El admin **mira el contador**; cuando llega a su umbral (~50) **apaga
  `receiving_leads`**. El asesor **sigue usando el CRM** pero sale de la fila.
- **Reactivar** = el admin prende `receiving_leads` y **resetea el contador a 0**
  (nueva tanda).
- Sin reset automático por tiempo. (Auto-apagado por un cupo numérico configurable
  queda como v2.)

### Reclamo automático (protege la señal de Meta)
Un lead **"sin trabajar"** = asignado pero sin ninguna señal de actividad
(el deal sigue en la etapa inicial "Nuevo" **Y** sin traza de contacto
—click-to-chat en `/api/leads/contacted`— **Y** sin nota) durante **N días**
(default 3, configurable). Pasado el plazo:
- El lead **vuelve al pozo** (se limpia `assigned_agent_id`) y se **reasigna** vía
  `pickLeastLoaded` **excluyendo al asesor original**.
- **Decrementa** el contador del original (lo devolvió) y **incrementa** el del nuevo.
- Corre como un **paso nuevo en el cron** `/api/leads/sync` (`reclaimStaleLeads`),
  service-role, junto a `reconcileAllCapi`.
- Si no hay otro asesor elegible, el lead queda sin asignar en el pozo (visible como
  "Sin asignar") hasta que haya cupo.

## VBO por capitas (feedback de valor a Meta)

Fuente de valor = **capitas** (vidas cubiertas del grupo familiar). El asesor
averigua la composición del grupo **antes de cotizar**, así que el dato es
**exacto en la etapa `calificado`** (no estimado).

- **Valor a Meta = capitas pelada** (número de vidas, 1/2/4…). NO se usa un precio
  en ARS: el precio real varía por plan vendido, aportes (si es empleado), metas
  del agente y otras variables que **no se conocen en `calificado`** (el plan aún
  no se vendió). Capitas es una señal relativa estable (familia de 4 ≈ 4× un
  soltero) — suficiente para que Meta prefiera grupos grandes.
- **Captura:** `deals.capitas INTEGER` (nullable). El asesor lo completa **al
  calificar**. UX: prompt de capitas al mover el deal a la etapa `Calificado`
  (garantiza que esté seteado antes de que el cron dispare el CAPI), y campo
  editable en el detalle del lead como respaldo.
- **Envío CAPI:** `buildEventPayload` (`capi.ts:79-103`) hoy NO manda `custom_data`.
  Se agrega `custom_data: { value: <capitas>, currency: 'ARS' }` en el evento
  `calificado` (alto volumen + exacto → VBO real) y en `closed-won` (misma cifra o
  actualizada a la afiliación). Si `capitas` es null al enviar → default **1**
  (se asume individual). `no-calificado`/`perdido` van sin valor (o value 0).
- **Limitación de idempotencia (MVP):** el evento es único por `(lead_id, event_name)`
  y se "sella" al primer envío `sent`. Si el asesor corrige las capitas DESPUÉS de
  que `calificado` ya se envió, el valor viejo queda en Meta y no se reenvía. Por
  eso la captura va **en la transición a `Calificado`**, antes del cron (5 min).
  Corrección de valor post-envío = v2.
- **Ops (fuera de código):** para que el valor OPTIMICE, el adset debe optimizar por
  `calificado` con **Value Optimization** activado en Meta — configuración, no código.

## Modelo de datos (migración 042)

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS receiving_leads BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leads_received_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS capitas INTEGER; -- vidas cubiertas; alimenta el value CAPI

-- Preservar el comportamiento actual: los compradores existentes arrancan
-- recibiendo; los nuevos arrancan apagados hasta que el admin los active.
UPDATE profiles SET receiving_leads = true WHERE is_lead_buyer = true;
```

RPCs SECURITY DEFINER admin-only (patrón de la 039), con `WHERE account_id`,
rechazan self/owner igual que `set_member_*`:
- `set_member_receiving(p_user_id, p_receiving BOOLEAN)` — al **activar**, resetea
  `leads_received_count = 0`; al apagar no toca el contador.
- `reset_member_lead_count(p_user_id)` — reset manual del contador.

El incremento/decremento del contador lo hace el router con **service-role**
(cron / asignación), no el cliente.

## UX del admin

- **Configuración → Miembros**, por asesor (junto a Módulos/Pausar que ya existen):
  interruptor **"Recibe leads"** + chip **"N recibidos"** + botón **reset**.
  Extiende `member-access-controls.tsx` y el `MemberOut` de `/api/account/members`.
- **Leads (header, admin):** resumen "X asesores recibiendo" y, opcional, el
  contador por asesor. Reusa el fetch de asesoras ya agregado.

## Seguridad / RLS

- `recibe_leads` y `leads_recibidos_count` se modifican **solo** por las RPCs
  admin-only (o el service-role del router). Un agent no puede tocarlos.
- La asignación de deals sigue las policies ya endurecidas (037): admin reasigna,
  el router corre service-role en el cron (bypass RLS, como el resto de la ingesta).
- Coherente con la contención RBAC (041): `is_account_member` excluye bloqueados,
  y el pool ya filtra `blocked = false`.

## Testing (Vitest, patrón puerto/adaptador con FakeRepo)

- `listAssignableAgents` filtra por `receiving_leads` (excluye apagados y bloqueados).
- `pickLeastLoaded` sobre el pool filtrado: reparte al menos cargado, desempate.
- Cupo: el contador incrementa en auto-asignación; apagar `receiving_leads` saca al
  asesor del pool; reactivar resetea a 0.
- Reclamo: detecta "sin trabajar" por (etapa inicial + sin contacto + sin nota +
  antigüedad ≥ N días); reasigna excluyendo al original; ajusta ambos contadores;
  sin asesor elegible → queda sin asignar.
- `set_member_receiving` / `reset_member_lead_count`: admin-only, no self/owner,
  scope por cuenta (tests de RLS por simulación como en el gate anterior).
- **VBO:** `buildEventPayload` incluye `custom_data.value` = capitas en
  `calificado`/`closed-won`; default 1 si null; `no-calificado`/`perdido` sin value.
  El payload sigue idempotente por `(lead_id, event_name)`.

## Fuera de alcance (explícito)

- **Precio en ARS / valor monetario por deal:** no se calcula; el value CAPI es la
  capita pelada. El precio real (plan, aportes, metas) se resuelve recién en la
  venta y es demasiado variable para el value de `calificado`. Un value monetario
  afinado es v2.
- **Corrección de valor post-envío:** si las capitas cambian después de que el
  evento `calificado` ya se selló, no se reenvía a Meta (v2: evento de corrección).
- **Señal por asesor a Meta:** innecesaria — Meta optimiza *anuncios*, no asesores;
  la calificación del lead ya es la señal y ya llega por `lead_id`.
- **Cupo por tiempo / auto-apagado por cupo numérico:** v2.
- **Venta de datos / pricing / cobro:** SP3.
- **Config del form global en Meta:** paso operativo (no código); se anota como
  prerrequisito.

## Prerrequisitos a confirmar en implementación

- ¿`opts.autoAssign` está **encendido** hoy en el cron `/api/leads/sync`? El router
  MVP lo requiere. Hoy 621 leads están en marcelo y 4 en alecita — verificar si es
  por autoAssign con un solo comprador o por asignación directa.
- Apuntar `meta_form_ids` al formulario global (deja de filtrar por el piloto).

---

## Revisiones post-council (VINCULANTE — override lo de arriba)

Tras correr el plan por el LLM council (transcript:
`docs/superpowers/council/council-transcript-2026-07-17-plan-router.md`).

### R1 — Contador DERIVADO, no columna mutable
Se elimina `profiles.leads_received_count`. "Recibidos en la tanda actual" se **deriva**
de eventos con timestamp en `activity_log` (append-only, ya existe):
- Router auto-asigna → `activity_log` action `lead_assigned` (user_id = asesor receptor).
- Reclamo: al original → `lead_reclaimed`; al nuevo asesor → `lead_assigned`.
- **recibidos_tanda(asesor)** = `count(lead_assigned) - count(lead_reclaimed)` desde
  `profiles.receiving_since`.
- Se agrega `profiles.receiving_since TIMESTAMPTZ`. Reactivar/reset = `receiving_since = now()`
  (NO destructivo: la serie histórica queda en activity_log). Elimina el bug de atomicidad,
  el drift y la pérdida de historial. (Mata las tareas de increment/decrement.)

### R2 — Cupo configurable con auto-apagado (decisión del usuario)
Se agrega `profiles.lead_cap INTEGER` (nullable = sin límite). El pool elegible es:
`is_lead_buyer AND receiving_leads AND NOT blocked AND (lead_cap IS NULL OR recibidos_tanda < lead_cap)`.
El auto-apagado es **implícito en el filtro** (al llegar al cupo, sale solo de la fila; no
hace falta que el admin apague). El toggle manual `receiving_leads` se mantiene para
prender/apagar a mano.

### R3 — Un solo `assignLead(pool)` (DRY)
El reparto es una función pura `assignLead(agents)` (= el `pickLeastLoaded` actual) usada
por la ingesta Y por el reclamo. Reclamo = `unassignDeal` + `assignLead(pool sin el original)`.
No hay dos implementaciones de la misma regla.

### R4 — Seguridad del reclamo (evita el desastre día 1 sobre los 621 viejos)
- **Gate temporal:** solo reclama deals con `created_at > reclaim_after` (constante =
  fecha de deploy del feature; los 621 históricos quedan excluidos).
- **Dry-run primero:** el reclamo arranca en modo **log-only** (cuenta y loguea, no reasigna)
  hasta confirmar en logs que los candidatos son razonables; recién ahí se activa.
- **"Trabajado" real vía activity_log:** un lead está trabajado si hay CUALQUIER evento en
  activity_log para su deal después de la asignación (nota, cambio de etapa, contacto), no
  solo "tiene nota". Menos falsos positivos que castigan al que trabaja sin anotar.
- **Batch limit** por corrida para no disparar N+1 masivo.

### R5 — Capitas: campo validado, capturado ANTES de sellar
`deals.capitas` es un entero validado (rango 1–20). Se captura con un **campo/diálogo real
con validación** (no `window.prompt`), y es **requisito para mover el deal a "Calificado"**
(se bloquea el cambio de etapa sin capitas). En el reconcile CAPI: si `capitas` es null →
**NO se manda `custom_data.value`** (el evento va sin valor; nunca se sella `value=1`
basura). Nota: `currency` queda como unidad nominal; el value es una señal relativa (capitas),
no pesos.

### R6 — Orden de commits (evita romper prod con Dokploy)
El puerto `LeadRepository`, el `FakeRepo` y el adaptador `repository.ts` se cambian en **un
commit atómico** (nunca el puerto sin el adaptador → typecheck/build rojo = deploy roto).
**Regla:** `npm run build` en verde antes de cada push a main (o feature branch + merge en
verde). El gate real es build, no Vitest (FakeRepo da falso verde).

### Diferido explícito (fast-follow, NO en este MVP)
Tablero admin ordenado por carga; velocidad de primer contacto; tasa de calificación/desperdicio
por asesor; valor real por adset (guardar adset_id con el value); tie-breaker meritocrático en
el reparto. **La base (eventos con timestamp) SÍ se persiste ahora** (R1) para no perder la serie.
