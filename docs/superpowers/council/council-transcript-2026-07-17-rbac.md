# Council transcript — Auditoría de roles/RBAC prevencrm (2026-07-17)

## Pregunta original
Discutir los hallazgos de la auditoría general de roles/RBAC de prevencrm
(`docs/superpowers/audits/2026-07-17-audit-roles-rbac.md`). CRM que vende leads
exclusivos de salud a asesoras-compradoras (rol agent). Qué priorizar; si "RLS es el
muro, módulos son UX" es sólida; sobre-ingeniería vs falta base; riesgo mayor no
visto; y la posible regresión de envío de WhatsApp.

## Mapa de anonimización (para peer review)
- A = El Ejecutor
- B = El Contrarian
- C = El Outsider
- D = El Pensador de Primeros Principios
- E = El Expansionista

---

## Respuestas de los asesores

### El Contrarian
CRÍTICO 2 es la bomba, subestimado al ponerlo segundo: una asesora que paga por
exclusividad y descubre que lee PII de salud de sus competidoras te funde el producto
(Ley 25.326 = exposición legal). "RLS es el muro" es media verdad: RLS protege filas,
no roles/columnas/rutas service-role; los tres ALTOS son los huecos que RLS no cubre.
No sobre-ingeniería, falta la base más barata. CRÍTICO 1 es el control que creés tener
y no tenés (cortar por falta de pago no funciona por curl). Orden: (1) aislar
lead_intake_errors; (2) blocked en /api + revocar sesión; (3) requireRole en
automations/flows/broadcasts; (4) raw_payload. WhatsApp: separá "leer credenciales" de
"disparar envío" con función server acotada.

### El Pensador de Primeros Principios
La pregunta real: ¿cuál es el producto? Una promesa (lead tuyo + salud a salvo). Cada
CRÍTICO la viola. "RLS es el muro" = muro de una habitación; dos habitaciones sin
puerta (raw_row, service-role). Regla correcta: ningún dato sensible sale sin
autorización server-side (RLS o requireRole en cada ruta service-role). Ordená por
"¿rompe la promesa?": CRÍTICO 2; CRÍTICO 1 + raw_payload; service-role. Resto (Settings,
gating) = UX, dejalo. Riesgo: una asesora del piloto viendo datos de otra destruye la
confianza. WhatsApp: no es regresión, es diseño; separá credencial (admin) de capacidad
de envío (endpoint server-side).

### El Expansionista
La oportunidad es el producto: exclusividad hoy es promesa verbal; cerrarla server-side
es tu argumento de venta y justifica subir precio ("cada lead sellado, auditable").
Hacelo VISIBLE: log de "quién tocó este lead". Compliance de salud = foso (prepagas más
grandes, vender la plataforma multi-tenant). Prioridad CRÍTICO 1 y 2 (lo que cobrás).
WhatsApp: no endurezcas hasta romperlo (hilo de adopción); envolvé el envío como
capacidad explícita del agent. Riesgo: a un incidente de PII de convertir tu mejor
activo (exclusividad) en tu peor pasivo (fuga de salud entre competidoras).

### El Outsider
¿Por qué guarda salud cruda en una cuarentena que todas ven? Incendio legal (categoría
más regulada). (1) Arreglá la cuarentena PRIMERO: ya está abierta. (2) Filosofía
incompleta: cuatro agujeros donde el muro NO existe; predican RLS sin tenerlo puesto.
(3) Falta lo básico. (4) Riesgo: pagan por exclusivos y ven los del resto; curl = fraude
vendible; + salud = demanda + fin del negocio. Ingenua: al pausar, ¿vive la sesión? Un
bloqueo que no mata la sesión no es bloqueo. (5) WhatsApp: "enviar" como permiso propio,
probá con asesora real ANTES.

### El Ejecutor
CRÍTICO 1 primero (único explotable hoy por alguien ya-dentro). Lunes 9am: account.ts +
blocked al select + ForbiddenError (20 min). Migración 041: excluir blocked de
is_account_member + signOut. Orden: 1) blocked; 2) CRÍTICO 2 (SELECT admin, policy 5
líneas); 3) automations/flows requireRole('agent') primera línea; 4) raw_payload
(martes). RLS no alcanza en rutas service-role; ahí requireRole ES el muro. Riesgo no
visto: endpoints service-role con account_id/lead_id del body sin validar pertenencia
(grepeá supabaseAdmin). WhatsApp lunes 9:15: test en vivo como asesora, apretá enviar; si
falla es RLS en whatsapp_config → policy SELECT para agent o config con service-role.

---

## Revisión por pares (3 revisores, anonimizado A–E)

**Revisor 1:** Más fuerte = A (única operativa: archivos, tiempos, verificación en vivo;
mejor riesgo-no-visto = service-role confiando en account_id/lead_id del body). Punto
ciego = E (convierte fuga de PII en pitch de ventas; le falta contención; CRÍTICO 2 es
incidente notificable). A las cinco se les escapó la remediación del dato YA expuesto
(¿purgar raw_row histórico? ¿logs? ¿a quién notificar?) y la minimización (no guardar
salud cruda).

**Revisor 2:** Más fuerte = B (orden ejecutable + porqué de negocio + marco legal 25.326 +
disección precisa "RLS protege filas, no roles/columnas/service-role" + separar
credenciales/envío). Punto ciego = E (reencuadre comercial, roza minimizar CRÍTICO 1). A
las cinco: detección/alcance del daño ya ocurrido + un test de CI que falle si un endpoint
service-role omite requireRole.

**Revisor 3:** Más fuerte = B (corrige el orden con argumento afilado; desmonta el mantra
sin abstracción vaga; mejor idea WhatsApp). Punto ciego = E (subordina el cierre de una
fuga activa al pitch; "no endurezcas hasta romperlo"). A las cinco: retención/purga y
minimización de raw_row; notificación de brecha + log forense retroactivo; tests de
regresión/RLS automatizados.

---

## Síntesis del Chairman

**Coincidencias (alta confianza):** (1) la fuga de PII de salud es lo #1 — rompe la
promesa central + peso legal; (2) "RLS es el muro, módulos son UX" es media verdad
peligrosa — RLS protege filas, no roles/columnas/service-role; núcleo correcto
(server-side), alcance falso; (3) no es sobre-ingeniería, falta base (requireRole barato);
(4) el riesgo no visto: una asesora viendo datos de otra refuta el producto y mata la
confianza; (5) WhatsApp: no relajar — separar "leer credenciales" de "capacidad de
enviar".

**Choques:** orden de los dos críticos (Ejecutor: blocked primero por explotabilidad hoy;
resto: PII primero por producto+legal → van en el mismo push, PII gana el primer commit
por irreversibilidad). Deuda vs oportunidad (Expansionista: certificar exclusividad como
foso — correcto a largo plazo, mal en secuencia: no se vende lo que todavía filtra).

**Puntos ciegos (peer review):** el dato ya expuesto (purga/notificación/forense);
minimización en ingesta (no guardar salud cruda); test de CI de regresión para rutas
service-role.

**Recomendación:** sprint de contención (no de producto), esta semana, mayormente en la
migración 041: (1) cerrar las dos fugas — raw_row admin-only + purga, y blocked
server-side + revocar sesión; (2) requireRole('agent') en toda ruta service-role; (3)
proteger raw_payload; (4) separar envío WhatsApp de leer config + test en vivo; (5) diferir
minimización, log de auditoría, test de CI, chequeo de brecha. Gating de módulos/Settings
queda como UX. Filosofía corregida: "ningún dato sensible sale sin autorización server-side
— RLS donde alcanza, requireRole explícito en toda ruta service-role."

**Lo primero:** migración 041 que restringe raw_row (y raw_payload) a admin Y purga/redacta
la salud ya en cuarentena — la única fuga que es incidente notificable y que refuta el
producto si un comprador la encuentra.
