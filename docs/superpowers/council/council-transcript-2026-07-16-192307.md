# LLM Council — Pressure-test del spec CRM multi-asesor (SP1)

**Fecha:** 2026-07-16
**Spec analizado:** `docs/superpowers/specs/2026-07-14-crm-multiasesor-admin-gating-design.md` (commit d34f9a7)

## Pregunta enmarcada

Pressure-testear ANTES de construir el SP1 de un CRM multi-asesor (prevencrm — Next.js 16 + Supabase + RLS): admin da de alta asesoras, decide qué módulos ve cada una (gating vía `profiles.allowed_modules` + guard de ruta server + filtro de sidebar), bloquea/habilita (`profiles.blocked`), aislamiento RLS por `assigned_agent_id` (graduar migración 037 de otra rama) + `is_lead_buyer` (038), asignación automática (pickLeastLoaded) + reasignación manual, UI admin vía RPCs SECURITY DEFINER (039). Contexto: las asesoras hoy trabajan en SUS planillas, no en el CRM; existe una API pública `/api/v1`. ¿Qué problemas futuros no ve el diseño (DB/RLS, seguridad, UX/UI, escalabilidad/adopción, edge cases)?

---

## Respuestas de los asesores

### El Contrarian
Falla fatal número uno: el gating es cosmético mientras exista `/api/v1`. Filtrás el sidebar y redirigís en el layout server, pero las route handlers de API no pasan por ese layout. Una asesora con sesión válida hace `fetch('/api/v1/...')` desde la consola y trae todo. El gating de módulos NO es control de acceso: es UX. El único control real es RLS.

Y 037 se olvida de la mitad del modelo. Aíslas deals/conversations/contacts/leads, pero `quick_messages`, `push_subscriptions`, `custom_fields`, `contact_notes`, `contact_custom_values`, `tags`, `lead_capi_events` siguen con la política vieja `is_account_member` = todos ven todo. `contact_notes` y `contact_custom_values` cuelgan de contactos que sí aislás: incoherencia explotable. `lead_capi_events` tiene PII y datos de conversión de TODAS. `push_subscriptions` = poder mandar push a dispositivos ajenos. Hacé el inventario de TODAS las tablas con RLS y auditá una por una.

Graduar 037/038 desde otra rama es una bomba: fueron escritas contra otro schema. Si `assigned_agent_id` no existe o difiere, la policy falla o —peor— aplica un predicado que no filtra. Portalas manualmente, no cherry-pick a ciegas.

Edge cases: leads sin asignar (`assigned_agent_id NULL`) → ¿nadie los ve, ni el admin? La asesora bloqueada mantiene su JWT vivo hasta expirar. Reasignación: un contacto con dos deals de dos asesoras lo ven las dos. RPCs SECURITY DEFINER en 039 sin `WHERE account_id` propio = una asesora edita módulos de cualquiera. Antes de construir: auditá tabla por tabla y cerrá `/api/v1` con RLS, no con redirects.

### El First Principles Thinker
No es un problema de gating de módulos. Ese es el error de encuadre.

El problema real: seis compradoras independientes ya tienen un sistema que funciona para ellas —su planilla, su WhatsApp— y vos querés que migren a uno peor para ellas y mejor para vos. "Ver si actualizan sus leads" es vigilancia del admin, no valor para la asesora. Vos ganás visibilidad; ella gana una planilla ajena, más rígida, donde el dueño le mira por encima del hombro. Nadie deja su herramienta por eso.

El SP1 correcto no es "control de acceso". Es una pregunta brutal: ¿por qué una asesora abriría prevencrm mañana a la mañana en vez de su Excel? Si la respuesta honesta es "porque el admin la obliga", el proyecto ya fracasó.

Las funciones de WhatsApp/automatización que "no están listas" no son el postre: son el plato principal. Ese es el único gancho real. Estás construyendo la cerradura antes que la casa. Gating, blocked, allowed_modules son features de administrador, cero adopción. Aislamiento por assigned_agent_id sí importa (competencia entre compradoras), pero es infra, no razón para migrar. Hacé SP1 = "una cosa que la asesora hace más rápido en el CRM que en su planilla". Meté a UNA asesora, no seis.

### El Expansionist
El diseño está tapando un agujero cuando debería estar construyendo un activo. Meter a TODAS las asesoras adentro no es una feature de administración: es la jugada que convierte a Marcelo de vendedor de tandas de leads en dueño de un mercado.

Primero, el dato de conversión real por asesora: hoy vendés 50 leads a ciegas. Adentro, medís tasa de calificación y velocidad de respuesta por persona. Eso es tu insumo más caro para el CAPI: señales de calidad de primera parte, y bajás el CPL de 2.262 sistemáticamente. Las asesoras trabajando en tu sistema son tu máquina de optimización de pauta gratis.

Segundo, pricing dinámico. Con datos de cierre por cohorte dejás de vender "50 leads a precio fijo" y vendés leads con score. El módulo de venta de datos (SP3) se vuelve un exchange: reasignás el lead que una asesora no trabajó en 24h y lo revendés.

Tercero, el SaaS: "el CRM para el que vende leads", con ranking, gamificación y CAPI integrado. Se lo vendés a otros brokers de leads de salud.

El agujero que no ve: falta un event log inmutable de cada acción de la asesora (respondió, movió, cerró). Sin eso, las métricas y el CAPI de calidad son reconstrucciones frágiles. Metelo en SP1 aunque no lo muestres. Ahí está el 10x.

### El Outsider
Le mandan un link para "registrarse" en el sistema del dueño y lo primero que siente es: esto no es mío. En su Excel ella era la dueña de la data; acá entra como invitada a una casa ajena. "Asesora" ya la baja de rango: era la que manejaba su cartera, ahora es una fila en la tabla de otro.

Lo de "esconder secciones" es veneno. Nadie te explica que Paula ve poco "porque no está listo"; Paula ve poco y piensa "no confían en mí". Ver puertas que no puedo abrir genera más ansiedad que no verlas. Si vas a esconder, escondé de verdad: que ni sepa que existen.

"Te asignaron leads": ¿por qué estos y no otros? Si no entiende el criterio, sospecha que le dan los peores y guarda los buenos en su planilla. Ahí ya la perdiste: doble carga, un pie afuera.

"Bloqueado" y "cuenta suspendida" se leen como castigo. A alguien que no cometió falta le cae como amenaza. Es lenguaje de banco, no de equipo.

¿Qué la hace volver al Excel? Que la app le quite control sin darle nada a cambio. Todo lo que describís son controles PARA el dueño. Le falta el anzuelo egoísta: que la app le consiga MÁS leads o mejores, que le recuerde a quién seguir, que le calcule su comisión sola, que le arme el mensaje de WhatsApp. Si la app la hace ganar más con menos laburo, se olvida de que le esconden cosas. Si solo la vigila, la planilla siempre gana.

### El Executor
El cherry-pick de 037/038 es la primera trampa. Al graduarlas por cherry-pick a main vas a tener el mismo número de migración con distinto hash en dos ramas: cuando mergees la rama después, Supabase ve dos "037" y explota o duplica. Alternativa: no cherry-pickees migraciones, renumerá. Graduá el contenido como 037/038 nuevas en main y en la rama router borralas y rebaseá encima. El código (`repository.ts`, `lead-alerts.ts`) sí cherry-pickealo, pero el SQL tratalo como fuente única en main.

Guard en el layout server: en Next 16 `cookies()`/`params` son async, así que el layout ya es async, no hay costo extra. Pero NO pegues a la DB en cada request para leer rol+módulos+blocked: metelo en el JWT (custom claims vía `access_token` hook de Supabase) o cacheá por request con `React.cache`. Si lo hacés con select por navegación, cada click son 1-2 roundtrips.

Triple fuente de verdad: el sidebar y el guard son UX, no seguridad. La única verdad es RLS. Asumí que sidebar/guard mienten y que RLS es el muro.

Email verification: la invitación NO es signup normal. Usá `inviteUserByEmail` (admin API) o `generateLink('invite')`: crea el user ya confirmado, sin fricción. Ahí mismo seteás `is_lead_buyer` y `allowed_modules` en el metadata/trigger de creación de profile.

Lunes a la mañana, en orden de riesgo: (1) hook de custom claims + RLS 037 en main, testeado con dos usuarios reales; (2) `modules.ts` puro con tests; (3) guard server; (4) sidebar; (5) RPCs 039 al final. Nada de UI de gating antes de que RLS aísle.

---

## Ronda de peer review (anonimización revelada)

Mapa: **A = Executor · B = Outsider · C = Contrarian · D = Expansionist · E = First Principles**

**Consenso de los 5 revisores:**
- **Más fuerte: C (Contrarian) — unánime (5/5).** Es la única que ataca la seguridad real y falsable (el gating es teatro mientras `/api/v1` no pase por el guard; RLS es el único control), audita tabla por tabla la PII que 037 olvida, y marca edge cases verificables (leads NULL, contacto con dos deals, RPCs sin `WHERE account_id`, blocked que no revoca el JWT). Accionable hoy. **A (Executor)** la complementa en lo operativo (renumerar migraciones, custom claims en vez de DB-por-request).
- **Punto ciego más grande: D (Expansionist) — unánime (5/5).** Salta a "mercado de datos / SaaS / pricing dinámico" sobre un piloto solo-Ale que ni cerró la RLS. Construye el piso 10 sin cimientos. Su idea útil (event log inmutable) queda sepultada bajo un salto de escala prematuro.

**Lo que las CINCO respuestas se perdieron (cazado en el review):**
1. **La "doble vida" / fuente de verdad del dato.** Si la asesora sigue trabajando su planilla, el CRM nunca tiene datos reales → CAPI y métricas (lo de D) se envenenan solos. Nadie propuso el mecanismo que FUERCE que el CRM sea el único lugar donde se toca el lead.
2. **Migración de las planillas actuales.** Las seis ya tienen historial (contactos, notas, estados) en su Excel. Si el CRM arranca vacío, ninguna migra aunque el aislamiento sea perfecto. El costo de abandonar meses de datos propios es la barrera real de adopción.
3. **Legal / PII / consentimiento.** Leads con datos de salud compartidos entre compradoras que COMPITEN; revender PII de un lead no trabajado; qué pasa legalmente cuando una asesora se va "con sus leads".
4. **La tensión no reconciliada: seguridad (esconder/aislar) vs adopción (esconder + vigilar mata la adopción).** Nadie la resolvió como el trade-off central.
5. **Puerta de una sola vía:** si el rollout sale mal, dañás la relación con tus compradores, que son tu ingreso.

---

## Veredicto del Chairman

### Donde el consejo coincide (alta confianza)
1. **El gating de módulos es COSMÉTICO; el único control real es RLS.** El sidebar y el guard de ruta son UX. Una asesora con sesión pega a `/api/v1/...` (o cualquier route handler de API que no pase por el layout) y trae todo. Si RLS no lo cierra, está abierto — gateo o no.
2. **La 037 aísla solo la mitad.** Tablas olvidadas con la política vieja `is_account_member` (todos ven todo): `quick_messages`, `push_subscriptions`, `custom_fields`, `contact_notes`, `contact_custom_values`, `tags`, `lead_capi_events` (¡PII y datos de conversión de todas!). Hay que **auditar tabla por tabla**, no confiar en la lista de 037.
3. **Graduar 037/038 por cherry-pick es riesgoso** (colisión de número de migración al mergear después + escritas contra otro schema). Portar el SQL como fuente única en main; cherry-pickear solo el código.
4. **El riesgo real es la adopción, no la técnica.** Todo el diseño son controles PARA el dueño, cero valor PARA la asesora. Sin una razón egoísta para que ella use el CRM, ningún panel de admin la retiene.

### Donde el consejo choca
**Seguridad primero (Contrarian/Executor) vs Adopción primero (First Principles/Outsider) vs Upside (Expansionist).** No son excluyentes — son **secuencia mal ordenada** en el spec. El Contrarian tiene razón: sin RLS completo es un leak (incluye datos de salud). El First Principles tiene razón: sin adopción no hay nada que asegurar. El Expansionist tiene el norte correcto (el dato de las asesoras vale oro para el CAPI) pero llega 10 pasos antes de tiempo.

### Blind spots que cazó el peer review
La **doble vida con la planilla** (el CRM queda con datos vacíos/podridos → envenena el CAPI), la **migración del Excel existente** (sin importarlo, nunca abandonan la doble carga), el **problema legal/PII** de leads de salud compartidos entre compradoras que compiten, y que es una **puerta de una sola vía** con tus clientes-ingreso.

### La recomendación
El spec **no está mal, está en el orden equivocado y con un agujero que hace del feature estrella (gating) una mentira.** Reordenar así:

1. **Piso de seguridad primero (no negociable):** auditar TODAS las tablas con RLS, aislar las que 037 olvida, y **verificar que `/api/v1` y toda ruta de API respetan RLS**. El gating de módulos es UX *encima* de RLS, no en vez de. Portar 037/038 como SQL nuevo en main (no cherry-pick), con `assigned_agent_id NULL` visible para el admin, y RPCs 039 con `WHERE account_id` propio + `blocked` que además invalide la sesión.
2. **Reencuadre de SP1:** gating/blocked/allowed_modules son features de admin de cero adopción — hacelos **mínimos**. La verdadera pieza de SP1 debería ser **UNA cosa de valor real para la asesora** (el follow-up de WhatsApp semi-armado desde el panel de lead que ya construimos: más rápido que su planilla).
3. **Escala:** una asesora (Ale, ya adentro), no seis. Si UNA no lo elige por gusto, ningún panel lo arregla.
4. **Sembrar sin mostrar:** el event log inmutable de acciones (lo de Expansionist) — meterlo ahora aunque no se muestre; es el insumo del CAPI de calidad y de las métricas futuras.

### Lo primero que hay que hacer
**Auditar TODAS las tablas con RLS y cerrar el aislamiento completo (no solo las 4 de 037) + verificar que `/api/v1` respeta RLS — ANTES de tocar una sola línea de UI de gating.** Porque hoy, con el gating cosmético, meter una asesora real es filtrar datos (incluidos datos de salud) de todas las demás.
