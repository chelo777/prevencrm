# Handoff — Router de asesores y escalado multi-comprador

> **Objetivo.** Dejar por escrito, con contexto suficiente para ejecutar en frío, la evolución de
> `prevencrm` desde "un CRM que recibe los leads de Ale" hacia "una plataforma de venta de leads con
> reparto por cupo y router de WhatsApp".
>
> **Estado: propuesta aprobada, sin implementar.** Nada de lo descrito acá existe todavía, salvo donde se
> aclare explícitamente que ya está construido (§2).
>
> Fecha: 2026-07-13

---

## 1. El negocio (leer esto primero o nada tiene sentido)

Marcelo compra tráfico en Meta Ads y **vende los leads** a asesoras de Prevención Salud.

- **Producto:** una *tanda* = **50 leads por $300.000 ARS**. Precio y cupo deben ser **configurables por cliente**.
- **Compradoras hoy:** Ale (que además es **dueña de la cuenta publicitaria** y vendedora), Paula, Fabi, Giuli,
  Guille y Stefy. **Van a entrar más.**
- **Cobranza:** pagos parciales, en distintas fechas. Hay que saber siempre qué se debe, qué se pagó y cuándo.
- **Entrega actual:** cada compradora recibe una Google Sheet con sus leads y contacta por WhatsApp.

### El modelo actual y por qué se rompe

Hoy, por cada compradora se **duplica la campaña** en Meta y se crea **un formulario nativo propio**, cuya
pantalla final muestra **el WhatsApp de esa asesora**. Eso **obliga** a tener una campaña por clienta.

Consecuencias medidas (julio 2026):

| Campaña | Leads | CPL | CTR | CPM |
|---|---|---|---|---|
| Monotributistas (propia, pausada) | 144 | **944** | **1,34%** | **1.597** |
| Paula | 202 | 1.943 | 0,93% | 2.881 |
| Fabi | 151 | 2.358 | 0,87% | 2.825 |
| Guille | 41 | 3.021 | 0,68% | 2.312 |
| Giuli | 106 | 3.111 | 0,75% | 3.358 |

Dos patologías:

1. **Canibalización.** Varias campañas con el mismo creativo y la misma audiencia **pujan entre sí** en la
   subasta. El CTR cae de forma sostenida en cada campaña nueva (0,93 → 0,87 → 0,75 → 0,68) y el CPM sube.
2. **Fragmentación del aprendizaje.** Meta necesita **~50 conversiones por conjunto por semana** para salir de
   la fase de aprendizaje. Repartir ~75 leads/semana entre 6 campañas deja a todas en aprendizaje permanente.
   Por eso la campaña única de Monotributistas rinde 3x mejor que las fragmentadas.

**Con 6 compradoras el modelo ya no escala.** (Separar por provincias aguanta 3, no 6.)

### El objetivo

Desacoplar **captación** de **entrega**:

- **Una sola campaña, un solo conjunto, un solo formulario** → aprendizaje concentrado → CPL esperado bajando
  de ~3.000 a la zona de **1.000–1.500**.
- El **CRM** decide a qué compradora le corresponde cada lead (por **cupo de tanda comprada**).
- Un **router web** le muestra al lead la asesora que le tocó, con su WhatsApp.

Impacto estimado: con 6 compradoras (300 leads/ciclo), el costo de adquisición pasa de ~900.000 a ~360.000 ARS.
**~500.000 más de margen por ciclo**, y el sistema escala a la séptima compradora sin lanzar otra campaña.

---

## 2. Qué ya existe en el repo (NO reconstruir)

Relevado sobre el código actual. **Todo esto funciona.**

| Capacidad | Dónde |
|---|---|
| Multi-tenant + roles `owner/admin/agent/viewer` | `src/lib/auth/account.ts`, `src/lib/auth/roles.ts`, migración `017` |
| Ingesta de leads Meta (polling Graph API v21) | `src/lib/leads/meta-api.ts`, cron `GET /api/leads/sync` |
| Ingesta desde Google Sheets | `src/lib/leads/google-sheets.ts` |
| Claim-first anti-duplicados (`meta_lead_id` UNIQUE) | `src/lib/leads/ingest.ts` |
| **Asignación automática a un asesor** | `pickLeastLoaded()` en `src/lib/leads/ingest.ts` |
| Puerto/adaptador del repositorio | `LeadRepository` en `types.ts`, impl. en `repository.ts` |
| Pipeline "Leads Prepaga" con etapas **Nuevo / Calificado / Cotizado / Closed-Won / Perdido / No-calificado** | RPC `ensure_leads_prepaga_pipeline()` |
| `deals.assigned_agent_id` | migración `029` |
| Push PWA de lead nuevo | `src/lib/push/`, migración `034` |
| Click-to-chat WhatsApp | `src/app/(dashboard)/leads/whatsapp-button.tsx`, `waNumber()` en `src/lib/leads/phone.ts` |
| **Verificación de firma de webhook Meta (HMAC-SHA256)** | `src/lib/whatsapp/webhook-signature.ts` — **reutilizable para leadgen** |
| CAPI hacia Meta con disparo por etapa | `src/lib/leads/capi.ts`, `lead_capi_config.trigger_stage_name` |
| Invitaciones de miembros | `/api/account/invitations`, migraciones `018`–`019` |
| Tests (FakeRepo in-memory) | `src/lib/leads/leads.test.ts` |

**Convenciones a respetar:** migraciones **aditivas** (la próxima es `036`), RLS en toda tabla nueva,
`requireRole()` en rutas de API, puerto/adaptador en el módulo de leads, tests con Vitest + `FakeRepo`.

> ⚠️ Next.js 16 tiene breaking changes. Antes de tocar App Router / Server Components, leer
> `node_modules/next/dist/docs/`.

---

## 3. Bloqueantes — arreglar ANTES de invitar a nadie

### 3.1 🔴 Aislamiento: cada asesora ve los leads de todas

La RLS de `leads` y `deals` filtra **solo por cuenta** (`is_account_member(account_id)`, ver `029_leads_meta.sql`
y `017`). Hoy no se nota porque solo está Ale. **El día que entre Paula, va a ver los leads de Fabi, Giuli y Ale.**

Es doblemente grave:

- **Comercial:** se venden datos exclusivos; verían los de las demás.
- **Datos personales:** los leads incluyen **información de salud** (la pregunta "¿está cursando un tratamiento?"
  se guarda en `raw_payload`). En Argentina eso es dato sensible (Ley 25.326).

**Qué hacer.** Endurecer las policies de `leads`, `deals`, `contacts` y `conversations`:

```
assigned_agent_id = auth.uid()  OR  is_account_member(account_id, 'admin')
```

El rol `agent` ve **solo lo suyo**; `owner`/`admin` ven todo. `raw_payload` ya está restringido a owner/admin —
mantenerlo así.

### 3.2 🔴 El reparto es por carga de trabajo, no por lo que compraron

`pickLeastLoaded()` asigna el lead **al asesor con menos deals abiertos**. Sirve para un equipo de ventas propio.
**Para este negocio está mal:** no tiene ninguna relación con quién pagó $300.000 por 50 datos. Peor: una asesora
que no cierra deals queda "llena" y **deja de recibir leads** — exactamente al revés de lo que se necesita.

Reemplazo en §4.

### 3.3 🟡 Los administradores entran al reparto

`ASSIGNABLE_ROLES` en `src/lib/leads/repository.ts` incluye `owner` y `admin`. Marcelo (dueño) recibiría leads.

**No resolverlo con roles.** Ale es `owner` **y** compradora; Marcelo es `owner` y **no** compradora. El rol no
alcanza para distinguirlos.

```sql
ALTER TABLE profiles ADD COLUMN is_lead_buyer BOOLEAN NOT NULL DEFAULT FALSE;
```

La asignación considera **solo** `is_lead_buyer = true`, sin importar el rol. Desacopla "quién administra" de
"quién compra datos".

### 3.4 🟡 Bug: el push de leads sin asignar nunca llega

`src/lib/push/lead-alerts.ts` (≈línea 87) hace `.from("profiles").select("id")`, pero `sendPushToUsers()`
(`src/lib/push/webpush.ts`, ≈línea 57) filtra `push_subscriptions` por **`user_id`**. En `profiles`, `id` y
`user_id` son **columnas distintas** (`001_initial_schema.sql`).

**Resultado:** owners/admins **nunca** reciben el aviso de leads sin asignar, y falla en silencio.
`repository.ts` (≈211) ya usa `user_id` correctamente — copiar de ahí. Es una línea.

Pasa a importar mucho: cuando ninguna compradora tenga cupo, los leads quedan sin asignar y **nadie se entera**.

---

## 4. Reparto por cupo de tanda (reemplaza a `pickLeastLoaded`)

### Modelo de datos (migración `036`)

```sql
-- Una fila por tanda comprada
CREATE TABLE lead_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buyer_user_id UUID NOT NULL REFERENCES auth.users(id),
  ordinal       INT  NOT NULL,               -- "Paula #3"
  leads_target  INT  NOT NULL DEFAULT 50,    -- configurable
  price         NUMERIC(12,2) NOT NULL DEFAULT 300000,
  currency      TEXT NOT NULL DEFAULT 'ARS',
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','completed','cancelled')),
  committed_at  DATE,                        -- cuándo se comprometió a pagar
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- Pagos parciales
CREATE TABLE lead_package_payments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES lead_packages(id) ON DELETE CASCADE,
  paid_on    DATE NOT NULL,
  amount     NUMERIC(12,2) NOT NULL,
  note       TEXT
);

-- Trazabilidad: qué lead se entregó contra qué tanda
ALTER TABLE leads ADD COLUMN package_id UUID REFERENCES lead_packages(id);
CREATE INDEX idx_leads_package ON leads(package_id);
```

RLS: el comprador ve **sus** paquetes y pagos; owner/admin ven todo.

### Estrategia de asignación

Nueva `pickByQuota()`, junto a `pickLeastLoaded()`:

1. Traer las tandas `status = 'open'` cuyo comprador tenga `is_lead_buyer = true`.
2. `entregados(paquete) = count(leads WHERE package_id = paquete)`.
3. Descartar las tandas con `entregados >= leads_target` → marcarlas `completed` (idempotente).
4. Entre las abiertas, **rotación pareja**: la de **menor `entregados`**; empate → `created_at` más antiguo;
   empate → al azar.
5. Asignar el deal a `buyer_user_id` y sellar `leads.package_id`.
6. **Si no hay ninguna tanda abierta → dejar el lead sin asignar** (cola de admin). Es una señal de negocio:
   se está comprando tráfico que no está vendido. Debe disparar el push a admins (requiere el fix de §3.4).

**Punto de inyección:** `ingest.ts` depende solo del puerto `LeadRepository` y recibe `IngestOptions`.
Agregar ahí una `assignmentStrategy` y **no tocar** la lógica de ingesta. **Mantener `pickLeastLoaded`**
(no borrarla): se elige por configuración de la fuente.

**Tests obligatorios** (`leads.test.ts`, patrón `FakeRepo`):

- Se respeta el cupo: la tanda #1 recibe exactamente 50 y deja de recibir.
- Rotación pareja entre 3 tandas abiertas.
- Sin tandas abiertas → el lead queda sin asignar (no explota).
- `is_lead_buyer = false` nunca recibe leads, aunque sea `owner`.
- Idempotencia: reingestar el mismo `meta_lead_id` no duplica ni reasigna.

---

## 5. El router — diseño completo

### 5.1 La decisión de producto (y por qué NO una landing page)

Se evaluó reemplazar el formulario nativo de Meta por una landing page propia. **Se descarta.**

**Capturar primero, acelerar después.** Con una LP, si el lead se enfría en el camino, **no queda nada**.
Con el formulario nativo, **el dato ya está guardado** antes de ofrecerle nada más; todo lo que pase después
es upside. Además el formulario nativo convierte mejor (es in-app, con datos pre-rellenados).

**El formulario nativo se mantiene. No se toca.**

Lo que cambia: **el WhatsApp sale del formulario**. En la pantalla final, el botón apunta al router.
Eso es lo que permite **un solo formulario para todas** → **una sola campaña**.

### 5.2 El flujo

```
1. El lead completa el FORMULARIO NATIVO de Meta.        → el dato ya está capturado ✅
2. Meta dispara el webhook `leadgen` (~1 s).
3. El CRM ingesta el lead y lo ASIGNA por cupo (§4).
4. En la pantalla final, el lead toca:
       "Hablar con mi asesora ahora"
    → https://appcrm.prevencion-salud.com/r/{lead_id}
5. El ROUTER busca el lead, ve qué asesora tiene asignada,
   y muestra su tarjeta: foto + nombre + 1 línea + botón de WhatsApp.
6. El lead toca el botón → se abre WhatsApp con esa asesora.
7. El router registra el click → evento de alta intención → CAPI a Meta.
```

### 5.3 🔴 La condición de carrera (esto hace o rompe el diseño)

El CRM ingesta por **cron cada varios minutos**. El lead toca el link **2 segundos** después de enviar el
formulario. **El lead todavía no existe en el CRM. No hay asesora asignada. El router no sabe a quién mostrar.**

Y si el router improvisa por su cuenta, después el cron asigna **otra** asesora → el lead habló con Giuli pero
el CRM se lo entregó a Fabi. Inaceptable.

> **Regla de oro: el CRM asigna. El router solo muestra. El router nunca decide por su cuenta.**

Se resuelve con **dos mecanismos, ambos idempotentes** gracias al claim-first sobre `meta_lead_id`:

**A) Webhook `leadgen` de Meta (primario).**
El lead entra al CRM en ~1 segundo, ya asignado. Cuando toca el link, la asignación **ya existe**.

- El valor `meta_webhook` **ya está en el CHECK de `lead_sources.kind`** (migración `029`) pero **nunca se
  implementó**. El hueco está esperando.
- Reutilizar `src/lib/whatsapp/webhook-signature.ts` para validar `x-hub-signature-256` con `META_APP_SECRET`.
- Nueva ruta `GET/POST /api/leads/webhook` (GET para el `hub.challenge`, POST para el evento).
- El payload de `leadgen` trae `leadgen_id`, `form_id`, `page_id`. **Traer el lead completo con
  `GET /{leadgen_id}`** usando el page token (`getPageAccessToken()` ya existe en `meta-api.ts`).
- Reusar `ingestLead()` tal cual: el claim-first evita duplicados si además lo trae el cron.

**B) Ingesta bajo demanda en el router (fallback).**
Si el router recibe un `lead_id` que no está en la base (webhook demorado o caído), **lo trae él mismo** de la
Graph API (`GET /{lead_id}`), lo ingesta y lo asigna con la misma `ingestLead()`. Agrega ~300-800 ms;
mostrar un esqueleto mientras tanto.

Con A + B el lead **siempre** encuentra a su asesora. El cron queda como tercera red de seguridad.

### 5.4 La URL y el `lead_id`

```
https://appcrm.prevencion-salud.com/r/{lead_id}
```

> ⚠️ **Verificar ANTES de escribir código:** el macro exacto que soporta Meta para inyectar el `lead_id` en la
> URL de la pantalla de agradecimiento del formulario nativo.
>
> **Plan B** si Meta no lo soporta: el router asigna al hacer el click y deja una **intención**
> (`meta_lead_id → agent_id`) que la ingesta **honra** cuando el lead llega. Es viable porque
> `assignDealIfUnassigned()` ya hace `UPDATE ... WHERE assigned_agent_id IS NULL` (no pisa una asignación
> existente).

### 5.5 La página del router

Ruta **pública** (sin auth): `src/app/r/[leadId]/page.tsx`.

**Requisitos de diseño, en orden de importancia:**

1. **Velocidad.** Es lo único que importa: el lead viene de una app y cada milisegundo pierde gente.
   Sin imágenes pesadas, sin JS de más. Server Component, HTML mínimo.
2. **El botón, arriba de todo, sin scroll.** Grande, verde, imposible de no ver.
3. **Tarjeta mínima:** foto de la asesora, nombre, **una** línea. Ejemplo:
   > *"Soy Giuli, asesora de Prevención Salud. Si querés, hablamos ahora y te saco las dudas."*
4. **Nada más.** En el momento en que se agregan párrafos explicando planes, se vuelve a crear la landing page
   que justamente se quería evitar.

**Seguridad / privacidad:**

- La página **no muestra ningún dato del lead**. Solo información pública de la asesora (nombre, foto, WhatsApp).
  Si alguien adivina una URL, no ve PII.
- Rate-limit en la ruta.
- Si el `lead_id` no existe ni se puede traer de Meta → tarjeta genérica de contacto, **nunca** un error.

**El link de WhatsApp:** usar `https://api.whatsapp.com/send?phone=...&text=...`, **NO `wa.me`**. El código ya lo
hace así deliberadamente (ver el comentario en `src/components/quick-messages/quick-send-sheet.tsx`: el redirect
de `wa.me` rompe el flujo). Construir el número con `waNumber()` de `src/lib/leads/phone.ts`.

**Perfil público de la asesora — campos nuevos:**

```sql
ALTER TABLE profiles ADD COLUMN whatsapp_phone   TEXT;  -- E.164
ALTER TABLE profiles ADD COLUMN public_photo_url TEXT;  -- Supabase Storage
ALTER TABLE profiles ADD COLUMN public_bio       TEXT;  -- una línea, máx ~120 caracteres
```

### 5.6 Registrar el click (el upside que no hay que dejar pasar)

```sql
CREATE TABLE lead_router_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID REFERENCES leads(id) ON DELETE CASCADE,
  event      TEXT NOT NULL CHECK (event IN ('view','whatsapp_click')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Da un **evento de alta intención** (`whatsapp_click`) que:

- Alimenta **CAPI** (`src/lib/leads/capi.ts` ya existe) → Meta deja de optimizar por "quien llena formularios" y
  empieza a optimizar por "quien quiere hablar". **Es la palanca más potente de todas (§6).**
- Sirve como argumento de venta: mostrarle a cada compradora cuántos de sus leads la contactaron solos.

### 5.7 El costo que se acepta conscientemente

Hoy el botón de WhatsApp está **dentro** de Meta: un toque, sin salir de la app. El flujo nuevo agrega pasos
(tocar link → salir de la app → cargar la web → tocar WhatsApp). **Se va a perder una parte de los auto-contactos.**

Se acepta a sabiendas: **el lead se captura igual** (el formulario nativo ya guardó el dato) y la asesora lo
contacta de todas formas. Lo que se pierde es el lead *caliente*, no el lead. A cambio, el CPL baja 2-3x y el
sistema escala sin límite. **El trade conviene.**

Mitigar con: página ultra rápida, botón sin scroll, y copy del CTA en Meta = **"Hablar con mi asesora ahora"**
(no "Ver sitio web"). En el texto de cierre, empujar: *"Tu asesora ya tiene tus datos. ¿Querés hablarle ahora?"*
en vez de *"si no querés esperar"* (que sugiere que esperar está bien).

---

## 6. Calidad del lead: el error más caro y cómo se corrige

**Hallazgo del negocio.** La campaña de Monotributistas daba leads baratísimos (CPL 944) pero **de mala calidad**:
muchas personas de más de 50 con preexistencias, o **no afiliables por edad**. Se la pausó y se lanzó una orientada
a *relación de dependencia + monotributo*, que **subió mucho la calidad** a costa de volumen.

**El diagnóstico correcto.** El problema **no es la audiencia: es la señal.** La campaña optimiza por
*"Cliente potencial" (formulario enviado)*. Meta es literal: busca **a quien más barato complete el formulario**.
Y quien más completa formularios de salud es justamente gente de 55-65 (más tiempo, más motivación por su salud).
**Meta hizo exactamente lo que se le pidió.** Achicar la audiencia es un parche sobre un problema de optimización.

### 6.1 La métrica que falta: **CPL calificado**

Se mide **CPL**. Hay que medir **costo por lead CALIFICADO**.

Los datos **ya existen**: el pipeline "Leads Prepaga" tiene las etapas `Calificado` y `No-calificado`.

```
CPL calificado = gasto de la campaña ÷ leads que llegaron a "Calificado"
```

Con esta métrica, una campaña con CPL 944 pero 70% de descarte tiene un **CPL calificado de ~3.100** y deja de
parecer la ganadora. **Sin esto se maneja a ciegas.** Es lo más valioso que se puede agregar.

Hace falta traer el **gasto por campaña** desde la Graph API al CRM:

```sql
CREATE TABLE campaign_insights (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  meta_campaign_id TEXT NOT NULL,
  campaign_name    TEXT,
  spend            NUMERIC(12,2),
  impressions      BIGINT,
  reach            BIGINT,
  clicks           BIGINT,
  ctr              NUMERIC(6,3),
  cpm              NUMERIC(12,2),
  frequency        NUMERIC(6,2),
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, meta_campaign_id)
);
```

Los leads ya guardan la atribución (`campaign_id`, `adset_id`, `ad_id`, `form_id`), así que el cruce sale solo.
Reportar por campaña **y por anuncio**: CPL, CPL calificado, tasa de calificación, CTR, CPM.

### 6.2 Enseñarle a Meta qué es un lead bueno (CAPI)

`lead_capi_config.trigger_stage_name` **ya permite** disparar la conversión cuando el deal llega a una etapa.
Usarlo bien:

- Enviar a Meta un evento cuando el lead llega a **`Calificado`** (no solo cuando se afilia).
- Enviar también el **`whatsapp_click`** del router (§5.6).

**Advertencia honesta:** Meta necesita **~50 eventos por semana** para optimizar sobre ellos. Optimizar por
"afiliado" es inalcanzable con el volumen actual (si se afilia el 10%, harían falta 500 leads/semana). Por eso el
evento correcto es uno **intermedio y frecuente**: `Calificado` o `whatsapp_click`. Ese es el punto dulce.

**Cumplimiento:** CAPI hashea solo email, teléfono y nombre (SHA-256). **Las respuestas del formulario y cualquier
dato de salud NUNCA salen del sistema.** Está así hoy y se mantiene.

---

## 7. Estructura de anuncios (contexto: para esto existe el router)

No es trabajo de código, pero explica el porqué de todo lo anterior.

```
CAMPAÑA — "[PS] Leads - Prepaga"
  Objetivo: Clientes potenciales
  Presupuesto: a nivel campaña
  │
  └── CONJUNTO ÚNICO
        Audiencia: ORIGINAL (NO Advantage+)
        Edad: tope duro según elegibilidad real de Prevención  ← control de calidad
        Ubicación: Argentina
        Formulario: ÚNICO, con el ROUTER en la pantalla final
        │
        ├── Anuncio 1 — Relación de dependencia   (mejor calidad medida)
        ├── Anuncio 2 — Monotributista / autónomo activo
        ├── Anuncio 3 — Familia con hijos
        └── Anuncio 4 — Joven / Plan IÓN
```

**Principios que lo sostienen:**

- El **aprendizaje vive en el conjunto** (~50 conversiones/semana). Un solo conjunto → sale de aprendizaje.
  Cada conjunto extra parte la señal.
- **El creativo hace la segmentación fina.** No hace falta un conjunto por segmento: los ángulos van como
  **anuncios distintos dentro del mismo conjunto**.
- **La edad hace el corte grueso.** Advantage+ puede salirse de la audiencia marcada; con una restricción real de
  elegibilidad, **audiencia original con tope de edad duro** es la decisión correcta.
- **Rotar creativos, no estructuras.** Agregar un anuncio al conjunto **no reinicia** el aprendizaje. Crear un
  conjunto nuevo, **sí**. Lo que reinicia: cambiar presupuesto >20%, cambiar audiencia, cambiar el evento de
  optimización, pausar >7 días.
- Fijar el tope de edad **con datos, no con impresión**: desglosar por edad en el Administrador de Anuncios y
  cruzar con la tasa de calificación por franja en el CRM.

> **Orden crítico:** el conjunto único **solo se puede lanzar cuando el router esté funcionando**. Antes de eso no
> hay forma de saber de quién es cada lead. **Primero el router, después se consolidan las campañas.**

---

## 8. Plan de ejecución

### Fase 0 — Bloqueantes (antes de invitar a nadie)
1. RLS: aislar por `assigned_agent_id` en `leads`, `deals`, `contacts`, `conversations` (§3.1).
2. `profiles.is_lead_buyer` + sacar a los admins del reparto (§3.3).
3. Fix del push de leads sin asignar (§3.4).

### Fase 1 — Tandas y cupo
4. Migración `036`: `lead_packages`, `lead_package_payments`, `leads.package_id` (§4).
5. `pickByQuota()` + `assignmentStrategy` en `IngestOptions`. **Con tests.**
6. UI mínima: alta de tanda, registro de pagos, saldo por compradora.

### Fase 2 — Router
7. Webhook `leadgen` (`/api/leads/webhook`) reutilizando la verificación de firma existente (§5.3-A).
8. Campos públicos del perfil (`whatsapp_phone`, `public_photo_url`, `public_bio`) (§5.5).
9. Página `/r/[leadId]` con ingesta bajo demanda como fallback (§5.3-B, §5.5).
10. `lead_router_events` + registro del click (§5.6).

### Fase 3 — Consolidación y calidad
11. Formulario único con el router en la pantalla final; **una sola campaña, un solo conjunto** (§7).
12. Invitar a Paula, Fabi, Giuli, Guille y Stefy como `agent` + `is_lead_buyer = true`.
13. `campaign_insights` + reporte de **CPL calificado** (§6.1).
14. CAPI con eventos `Calificado` y `whatsapp_click` (§6.2).

---

## 9. Decisiones tomadas (no volver a discutirlas)

- **El formulario nativo de Meta se mantiene.** No se reemplaza por una landing page. *Capturar primero,
  acelerar después.*
- **El CRM asigna; el router solo muestra.** Una sola fuente de verdad.
- **WhatsApp vía `api.whatsapp.com/send`, nunca `wa.me`.**
- **Audiencia original con tope de edad**, no Advantage+, mientras exista la restricción de elegibilidad.
- **El rol no define quién compra datos:** lo define `is_lead_buyer`.
- **Se acepta perder auto-contactos** a cambio de bajar el CPL 2-3x y poder escalar.
- **Un solo conjunto de anuncios** hasta superar ~300 leads/semana.
- El CRM pasa a ser **la fuente de verdad de las tandas**. La Google Sheet de contabilidad queda como respaldo /
  vista para el comprador, no como sistema.

---

## 10. Riesgos abiertos

| Riesgo | Mitigación |
|---|---|
| Meta no soporta inyectar `lead_id` en la URL de la pantalla final | Plan B de §5.4 (intención + `assignDealIfUnassigned`). **Verificar antes de codear.** |
| Caída de auto-contactos mayor a la esperada | Medir con `lead_router_events`. Si es catastrófica, evaluar redirect directo a WhatsApp sin tarjeta. |
| Leads que entran sin ninguna tanda abierta | Quedan sin asignar + push a admins (requiere el fix de §3.4). Es señal de que se compra tráfico no vendido. |
| Volumen insuficiente para optimizar por evento de calidad | Usar `whatsapp_click` (más frecuente) en vez de `Calificado` / afiliación. |
| Fuga de datos de salud entre asesoras | **Fase 0 es bloqueante.** No invitar a nadie hasta que la RLS esté cerrada. |
