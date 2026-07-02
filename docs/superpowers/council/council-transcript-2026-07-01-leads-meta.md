# Transcript del Consejo — Spec "Leads Meta" para PrevenCRM

- **Fecha:** 2026-07-01
- **Spec analizado:** `docs/superpowers/specs/2026-07-01-modulo-leads-meta-design.md`
- **Método:** LLM Council (5 asesores independientes → peer review anónimo → síntesis del chairman)
- **Votación:** Más fuerte = **B (El Contrarian) 5/5** · Mayor punto ciego = **D (Primeros Principios) 5/5**

> **Nota de ejecución:** en la corrida original, "El Expansionista" falló y devolvió texto basura
> (`assistant is Claude Code...`). El peer review evaluó esa Respuesta E vacía (ninguno la eligió como
> más fuerte). El Expansionista se **re-ejecutó** después; su respuesta recuperada se incluye abajo.
> La síntesis del chairman se hizo con el Expansionista fallido; los aportes de upside recuperados se
> anexan al final.

---

## Pregunta original del usuario

> "analicemos el spec con /llm-council"

## Pregunta enmarcada (framed)

Módulo "Leads Meta" DENTRO de PrevenCRM (fork de wacrm: Next.js 16 + React 19 + TS + Tailwind v4 +
Supabase; ya tiene contactos, pipeline Kanban `deals`, inbox WhatsApp, roles por cuenta con RLS,
notificaciones, API REST /api/v1). Negocio: prepaga en Argentina, 2-10 vendedores, PWA. Hoy 4
formularios de Meta Lead Ads vuelcan a Google Sheets donde un asesor actualiza estado y la conversión
a mano. El spec propone: core de ingesta agnóstico + adaptadores (Sheets Fase 1, webhook nativo Fase
2), mapeo por header, CRM como fuente de verdad, CAPI automático al cambiar etapa, round-robin, push
PWA. En juego: arquitectura fundacional de un CRM del que depende el negocio.

---

## Respuestas de los asesores

### El Contrarian → Respuesta B (más fuerte 5/5)

Core síncrono de 8 pasos (§3, §5) sin atomicidad ni cola. El dedupe (§5.5) es por `meta_lead_id` en
la tabla `leads`, que se persiste recién en el **paso 9**. Si el proceso muere entre el paso 4 y el
9, el `meta_lead_id` nunca se registró: el próximo cron reprocesa la fila y crea un **segundo deal**.
El dedupe está mal ubicado. Falta un "claim" del `meta_lead_id` ANTES de crear entidades.

`last_synced_at` (§4.1, §5.2): Google Sheets no garantiza orden ni cursor confiable de append; una
fila tardía o un backfill del asesor cae fuera de ventana y se pierde en silencio (contradice §1.1 y
el criterio 2). El cursor real es el conjunto de `meta_lead_id` vistos.

Supuesto peligroso: "hojas de solo-lectura" (§2, §5.3), pero el asesor HOY escribe ahí. No hay plan
de cutover/rollback para el día 1 con leads en vuelo.

CAPI (§6): un único `capi_synced_at` no soporta múltiples eventos ni el retroceso de etapa (mandaste
conversión, el deal cae a Perdido → optimizás el ad hacia leads malos). Necesitás una fila por evento.

Round-robin (§5.8) sin estado persistido de "a quién le tocó último" ni manejo de asesor inactivo.

El dedupe mal ubicado y el cursor por timestamp son fallas fundacionales: garantizan duplicados y
leads perdidos.

### El Pensador de Primeros Principios → Respuesta D (mayor punto ciego 5/5)

Están construyendo el core equivocado. El problema despojado es: cuatro planillas de Meta necesitan
volverse contactos accionables y Meta necesita saber quién compró. Eso no requiere una capa de
abstracción de fuentes; requiere resolver latencia de contacto y feedback de conversión.

**El adaptador de Sheets no debería existir.** Meta permite el webhook `leadgen` desde el día uno; el
intermediario Sheets lo agregó el usuario porque no tenía backend. Ahora lo tienen. Sheets + mapeo +
cron + `last_synced_at` es infraestructura que se tira en Fase 2. El "core agnóstico" existe para
justificar esa basura. Es complejidad para diferir el App Review de Meta (§9): decisión de negocio
disfrazada de arquitectura.

**Replanteo:** el MVP real es webhook `leadgen` → contacto → deal → asignación → notificación. Es
MENOS código. El asistente de mapeo (§3, §5.3, `column_mapping`) desaparece: el webhook da campos con
`field_key`, no headers. La tabla `lead_sources` sobra. Lo único que Sheets justifica es el import
histórico (§8), que es un script de una vez.

**CAPI en Fase 2 es un error de prioridad.** El dolor de §0 es "feedback manual". El CAPI depende
solo de tener `meta_lead_id` — que el webhook ya da. Debería ser MVP.

**Pregunta que el spec no hace:** ¿por qué un pipeline nuevo "Leads Prepaga" (§4.5) y no el `deals`
existente con una etiqueta de origen?

### El Outsider → Respuesta C

El core "función pura" (§3) hace I/O en los pasos 4-9: NO es pura. Jerga mal usada; digan "core con
lógica de dominio testeable, con I/O inyectado".

§5.1 dice cron "cada 2-5 min" y §10.2 promete ≤5 min, pero Next.js self-hosted no tiene cron nativo.
¿Quién dispara `/api/leads/sync`? Decisión de infra de la que depende TODO el MVP.

Dedupe por `meta_lead_id` (§4.2, §5.5): ¿la hoja trae la columna con el `id` (`l:...`)? Muéstrenme un
header real de las 4 hojas antes de comprometerse a esta clave.

Contradicción: §6 dispara CAPI "al cambiar etapa", pero CAPI es Fase 2 (§8) y el pipeline ya existe
en el MVP → durante el MVP se mueven deals SIN conversión. El problema central (§0) NO se resuelve en
el MVP. Díganlo con todas las letras.

"Atribución" aparece 6 veces sin definir. §11 deja abierto OAuth vs service account, pero §5.2 ya
asume service account: el spec se contradice.

### El Ejecutor → Respuesta A

El cron cada 2-5 min (§3, §5.1) es el eslabón débil: Next.js 16 no tiene scheduler; hace falta
disparador externo + lock (advisory lock) por solapamiento. Recórtenlo a **cada 5 min, single-flight
con lock**.

"Filas nuevas desde `last_synced_at`" (§5.2) no funciona con Sheets. El mecanismo que escala es leer
todo y dedupe por `meta_lead_id` (§4.2 UNIQUE). `last_synced_at` es humo.

Orden del MVP: 1) migraciones + seed pipeline; 2) `phone.ts` + `mapping.ts` (puro); 3) core con
payload mockeado; 4) adaptador Sheets + service account (§11: resolver día 1; OAuth es scope-creep).
El asistente de mapeo UI (§8): **recórtenlo del MVP**, arranquen con mapeo por JSON de las 4 hojas.

CAPI a Fase 2 está bien; el import histórico (§8) es un one-shot frágil: script aparte, no en el core.

### El Expansionista → (RE-EJECUTADO; en la corrida original falló → Respuesta E vacía)

Este spec construye una máquina de captura y la trata como el producto. El producto real es el
**grafo de atribución campaña→lead→venta cerrada, con dinero y timestamps**, que nadie en el mercado
argentino de prepagas tiene limpio. Lo subvaloran en tres frentes:

1. **§4.2 + §6: el activo no es el lead, es el bucle de aprendizaje del CAPI.** Cada `capi_synced_at`
   con `Purchase` es señal de entrenamiento para Meta. Con `campaign/adset/ad_id` + etapa real, en
   3-6 meses tenés **costo por venta cerrada por adset**, no por lead. Baja el CAC más que cualquier
   feature. Pídanlo como reporte de primera clase, no "se reutiliza el dashboard" (§1).
2. **§4.2 `raw_payload` + histórico (§8): dataset para lead scoring.** Preguntas calificadoras +
   desenlace real = clasificador supervisado. El round-robin (§7) podría ser **priorización por
   probabilidad de cierre**. El histórico ES el training set.
3. **Base instalada de prevencrm = producto vendible.** "CRM que cierra el loop de Meta solo" es un
   pitch. El no-objetivo "multi-tenant agencia" (§1) descarta el mercado, no la feature.

Constrúyanlo como plataforma de datos, no como buzón.

---

## Mapeo de anonimización

| Letra | Asesor |
|-------|--------|
| A | El Ejecutor |
| B | El Contrarian |
| C | El Outsider |
| D | El Pensador de Primeros Principios |
| E | El Expansionista (respuesta fallida en la corrida original) |

**Tally:** Más fuerte → B: 5 · Mayor punto ciego → D: 5.

---

## Peer reviews (resumen fiel)

**Revisor 1** — Más fuerte: B (dedupe mal ubicado, precisión de implementación). Punto ciego: D
(ignora App Review; inconsistente con el import histórico). Todas omitieron: **colisión dedupe de
CONTACTO con E.164** (`022` guarda solo-dígitos, §5.4 usa E.164 → duplica o rompe ingesta); **no hay
Web Push** (in-app por realtime hoy); ventana/costo CAPI; el trigger de notif. es sobre
`conversations`; NULLs en `UNIQUE(meta_lead_id)`.

**Revisor 2** — Más fuerte: B. Punto ciego: D (los `field_key` son configurables por formulario → el
mapeo NO desaparece con el webhook). Todas omitieron: **PII de salud + Ley 25.326 + Meta prohíbe
salud en CAPI** (baneo); merge de contacto al llenar dos formularios; **click-to-chat sale del número
personal**; falta test con datos reales; ¿round-robin es la política correcta? (cola "pull").

**Revisor 3** — Más fuerte: B (su remedio = patrón ya usado en `/api/automations/cron`). Punto ciego:
D ("Leads Prepaga" ES el patrón nativo; `deals` cuelga de `pipelines`). Todas omitieron: **nadie leyó
el repo** — el cron ya existe (`x-cron-secret` + lock), el round-robin es placeholder confeso
(`engine.ts:427-430`), ya hay trigger de notif. por asignación (027), y el cumplimiento de salud.

**Revisor 4** — Más fuerte: B. Punto ciego: D (subestima verificación de firma, `leadgen_id`→Graph
API, tokens). Todas omitieron: **hashing SHA-256 obligatorio en CAPI + `event_id`**; ventana de
atribución; el "sin trabajo manual" es teatro (Meta→Sheets es frágil); **un service account rompe el
aislamiento RLS** (ve todas las hojas de todas las cuentas).

**Revisor 5** — Más fuerte: B. Punto ciego: D (falta vía intermedia: Sheets YA + App Review en
paralelo; el core SÍ se reusa). Todas omitieron: consentimiento/cifrado de `raw_payload`; ventana de
atribución vs ciclo de venta; calidad de event match (`fbc/fbp`); cuota de Sheets API a escala;
**observabilidad y health-check por fuente** (un formulario que deja de sincronizar pierde leads en
silencio).

---

## Veredicto del Chairman

### Donde el consejo coincide
1. **Dedupe mal ubicado (falla fundacional)** — chequeo paso 5, persistencia paso 9 → segundo deal
   ante crash. Fix: "claim" del `meta_lead_id` antes de crear entidades (patrón ya en el repo).
2. **`last_synced_at` roto sobre Sheets** — leer rango completo, confiar en el UNIQUE.
3. **Disparador del cron sin especificar** — el repo ya lo resuelve (`x-cron-secret` + lock).
4. **CAPI con un solo `capi_synced_at` insuficiente** — una fila por evento; retroceso de etapa.
5. **Round-robin sin estado** — y en el repo es placeholder.
6. **Falta plan de cutover/rollback.**

### Donde el consejo choca
Sheets Fase 1 vs webhook directo. D quiere eliminar Sheets; los 5 revisores lo marcan como punto
ciego (App Review bloquearía el MVP mientras los leads caen hoy). Síntesis: no es "todo o nada" —
Sheets YA + App Review en paralelo. Insight de D que sobrevive: **CAPI al MVP**. Secundario resuelto
por código: "Leads Prepaga" es el patrón nativo. Round-robin: cola "pull" puede convertir mejor.

### Puntos ciegos detectados (solo en peer review)
Colisión dedupe de contacto E.164 · PII de salud/Ley 25.326/Meta CAPI · sin Web Push · trigger de
notif. sobre `conversations` no deals · CAPI hashing SHA-256 + `event_id` + ventana · NULLs en el
UNIQUE · service account rompe RLS · click-to-chat número personal · sin health-check · falta fila
real de las 4 hojas.

### La recomendación
Híbrido correcto, el spec sigue — pero **no pasar al plan** hasta cerrar 2 fallas de correctitud + el
bloque de compliance. Se rechaza eliminar Sheets; se adopta **CAPI al MVP** + App Review en paralelo.
Bloqueantes de correctitud: reordenar dedupe a "claim"; unificar estrategia de teléfono con `022` +
regla de merge de contacto; eliminar `last_synced_at` + manejar NULL; CAPI una fila por evento +
SHA-256 + `event_id` + política de retroceso. Compliance (salud): retención/cifrado de `raw_payload`,
consentimiento (Ley 25.326), **filtrar datos de salud del payload CAPI**. Recortes: quitar mapeo UI
(seed manual), histórico como script aparte, cron copiando el patrón existente. Agregar: Web Push (o
degradar a in-app); trigger `lead_received` sobre deals; round-robin de cero (o cola "pull");
trazabilidad WhatsApp; health-check + contadores; corregir "función pura".

### Lo primero que hay que hacer
**Exportar una fila REAL de cada una de las 4 hojas** y confirmar: (1) que existe la columna con el
`id` del lead (`l:...`), y (2) el formato exacto de los teléfonos AR. Sin eso, las dos fallas
fundacionales son especulación.

---

## Anexo — Upside del Expansionista (recuperado post-síntesis)

1. **El activo es el grafo de atribución campaña→lead→venta + el bucle CAPI** → costo por venta
   cerrada por adset. Reporte de primera clase, no "reutilizar dashboard" (§1).
2. **`raw_payload` + histórico = lead scoring** → round-robin como priorización por probabilidad de
   cierre.
3. **prevencrm = producto vendible** → "multi-tenant agencia" (§1) descarta el mercado, no la feature.
