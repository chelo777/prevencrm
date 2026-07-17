# Router de datos (MVP) — diseño

**Fecha:** 2026-07-17 · **Estado:** diseño aprobado (núcleo + reclamo), pendiente review del usuario · **Migración:** 042

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

## Modelo de datos (migración 042)

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS receiving_leads BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leads_received_count INTEGER NOT NULL DEFAULT 0;

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

## Fuera de alcance (explícito)

- **VBO (Value-Based Optimization):** mandar un `value` por conversión a Meta.
  Requiere primero **capturar un valor $ por deal** (hoy `deal.value = 0`); el
  trabajo real es *medir* el valor (prima/comisión/proxy), no enviarlo. Se defiere
  hasta tener esa fuente de valor. La optimización por cantidad actual alcanza.
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
