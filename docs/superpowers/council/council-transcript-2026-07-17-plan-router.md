# Council transcript — Plan del router de datos + VBO (2026-07-17)

Análisis SOLO del plan `docs/superpowers/plans/2026-07-17-router-datos.md`.

## Contrarian
El día 1 es el peligro: Task 6 cablea el reclamo antes de auditar los 621 existentes.
Al correr, todo deal assigned+etapa inicial+>3d+sin nota entra al reclamo de golpe →
N+1 (621 queries → timeout serverless) + rota leads trabajados por WhatsApp sin nota.
Exigir dry-run/log-only + filtro `created_at > fecha_deploy`. Race prompt vs reconcile:
window.prompt async → reconcile lee capitas=null y sella value=1 (ARS) para siempre =
basura VBO. Contador read-then-write diverge del pickLeastLoaded (que cuenta deals
abiertos) → drift. Orfandad: stale sin elegible → decrementás y dejás sin asignar.
RLS: confirmar que increment/decrement corren service-role. value=capitas con currency
ARS: un conteo no es pesos.

## First Principles
El problema real es "repartir con equidad y respetar cupos", no "mantener un contador".
`leads_received_count` es estado DERIVABLE (count de deals asignados / ledger). Derivarlo
elimina Task 3 + los increment/decrement de 4/5 + el bug de atomicidad; el reset pasa a
ser ventana temporal, no RPC. `receiving_leads` manual y "cupo" son la misma decisión en
dos lugares: el cupo pertenece al algoritmo (elegibles = receiving && carga<cupo), no un
bool manual — hoy no hay cupo real, hay on/off. Reclamo no es concepto separado: es
reparto disparado por staleness; extraé `assignLead(pool)` puro y reclaim = unassign +
assignLead (si no, dos implementaciones divergen). Capitas por window.prompt = peor capa:
debe ser campo del modelo con default. Task 0 es spike; 8 y 9 mezclan API+UI. Falta:
backfill de los 621 e idempotencia del reclamo. Colapsa a ~6 tareas.

## Executor
Una traba dura de DEPLOY: Task 2 cambia la firma de `assignDealIfUnassigned` (void→boolean)
y agrega 4 métodos al puerto; el adaptador real `repository.ts:238` no se fixea hasta
Task 4 → typecheck/build ROJOS dos commits seguidos. Con Dokploy (deploy al pushear main),
commitear Task 2/3 rompe producción. Los tests con FakeRepo dan falsa luz verde (el gate
real es build). FIX: fusionar Task 2+4 en un commit atómico (puerto+FakeRepo+adaptador
juntos), y el move de FakeRepo a test-helpers ahí. Regla: cada commit a main pasa
`npm run build` antes de pushear (o branch + merge en verde). Task 6 no es traba (adapter =
createLeadRepository(admin, source), reclaim después de los loops). Task 1/8/9 sin
fail-first real; el gate serio es Task 10 (RLS+smoke) — no saltearlo.

## Outsider
El interruptor manual es lo más frágil: depende de que un humano apague en 50; si se olvida,
ese vendedor se come los leads y el least-loaded se rompe. ¿Por qué no auto-apagado al tope?
¿Y "50" de dónde sale? Configurable por vendedor, no constante escondida. Reset a 0 pisa el
historial (perdés "cuántos recibió este mes"). ¿El vendedor ve su contador? Sin tablero, el
admin mira 10 contadores a ojo → nadie lo hace bien. window.prompt para el dato que va a Meta
como plata: sin validación (¿"cuatro"? ¿999? ¿vacío?). El proxy "sin nota = no trabajó"
castiga al que trabaja y no anota — ¿el vendedor se entera del reclamo, puede reclamar?

## Expansionist
El contador+reclamo ya te obligan a 3 números por asesor (recibidos/calificados/reclamados)
→ gratis tasa de calificación y desperdicio; persistilas con timestamp (no las borres en el
reset). El `activity_log` existente es la mina ignorada: derivá "trabajado real" de la primera
actividad post-asignación + velocidad de primer contacto → mejor criterio de reclamo + tablero
casi gratis. Capitas: guardá campaign/adset/ad con el value → valor real por anuncio (lo que el
martillo necesita). Bucle faltante: velocidad+tasa deberían retroalimentar pickLeastLoaded
(tie-breaker meritocrático). Métricas vendibles: tasa de desperdicio y velocidad = calidad de
asesor.

## Síntesis del Chairman (ver mensaje al usuario)
Coinciden: (1) reclamo día-1 sobre los 621 = peligro real (gate post-deploy + dry-run);
(2) el contador volátil es la abstracción equivocada → derivar de un ledger con timestamp;
(3) capitas = campo validado, no window.prompt, capturado antes de sellar el evento;
(4) fusionar Task 2+4 (build roto entre medio rompe prod con Dokploy);
(5) el toggle manual es frágil → cupo configurable con auto-apagado + tablero.
Diferir (fast-follow): dashboards, velocidad, valor por adset, tie-breaker meritocrático —
pero adoptar YA la persistencia barata (eventos de asignación en activity_log) para no perder
la serie histórica.
