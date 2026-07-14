# Consolidación de campaña "martillo" + estrategia CAPI de calificación

**Fecha:** 2026-07-14
**Cuenta Meta:** PrevencionADS — `act_1379871940277019` (ARS)
**Estado:** aprobado, en ejecución (Fases 0-2 sin riesgo, se pueden hacer ya)

---

## 1. Objetivo

Pasar de **N campañas duplicadas** (una por asesora, cada una con su formulario + WhatsApp) que **canibalizan la subasta**, a **UNA campaña → UN conjunto → N anuncios** (uno por asesora, cada uno conserva su formulario + WhatsApp nativo). El conjunto de Ale (el mejor y ya caliente) es el contenedor. Reparto por **modelo martillo**: se activa el anuncio de la asesora que compra su tanda, se pausa al llegar a sus 50.

**Por qué el puente y no el router (todavía):** consolidar la subasta pasa a nivel **conjunto**, no formulario. Los N anuncios dentro de un conjunto **no compiten entre sí** en la subasta. Esto mata la canibalización sin tocar el WhatsApp nativo de cada asesora y **sin código**. El router (1 formulario + página propia) recién se justifica por **cuota exacta / escala >6 asesoras simultáneas / testeo de creativos**, no por consolidar.

---

## 2. Foto real de la cuenta (relevada 2026-07-14 vía Graph API)

### Campañas (últimos 30 días; CPL real vía `onsite_conversion.lead_grouped`)

| Campaña | Estado | Gasto | Leads | **CPL real** | CTR |
|---|---|---|---|---|---|
| Paula | pausada | 242.435 | 114 | **2.127** ⭐ | 0.82 |
| **base = Ale** | **ACTIVA** | 268.767 | 118 | 2.278 | 0.83 |
| Fabi | pausada | 356.041 | 151 | 2.358 | 0.87 |
| Giuli | pausada | 329.747 | 111 | 2.971 | 0.75 |
| Guille | pausada | 144.424 | 46 | 3.140 | 0.69 |

- **Volumen real: ~127 leads/semana** (540 en 30d). Arriba del umbral de ~50/sem para salir de aprendizaje (bien para un conjunto único), debajo de los **~300/sem** donde recién conviene partir en varios conjuntos → **un solo conjunto es lo correcto; clustering es prematuro**.
- Ojo con el CPL: la primera lectura dio ~470 por sumar varios `action_type`; el lead real es `onsite_conversion.lead_grouped` → CPL ~2.100-3.140 (coincide con el ~3.000 histórico).
- Solo la base (Ale) está **activa**; las 5 clones están **pausadas** (entre tandas). La canibalización ya está detenida → **momento ideal para consolidar con calma**.

### Ale (base) desde el inicio — `[PS] Leads - Dependencia Premium 2026` (ID `120244095116120383`, creada 2026-04-21)

- Lifetime: **898.059 ARS · 397 leads · CPL 2.262 · CTR 0.86 · frecuencia 1.72** (sana, no quemada).
- **Prueba de la canibalización en su propia línea de tiempo:**

| Mes | CTR | CPL | Leads |
|---|---|---|---|
| Jun (mejor) | **0.95** | **2.104** | 163 |
| Jul (con clones corriendo) | **0.75** (−21%) | **2.516** (+20%) | 54 |

Las clones no solo rinden peor: **le arruinaron el CPL a la mejor campaña**. Por eso un creativo nuevo NO arregla julio — lo arregla consolidar.

- **1 conjunto:** `[PS] Dependencia Premium - 28-49 - Closed Won`, optimiza el evento custom **`closed-won`** (`QUALITY_LEAD`), 18.000 ARS/día, 9 provincias centro/sur, edad **28-49**.
- **2 anuncios** (1 activo: `AD Dependencia premium Nuevo 20-04`).
- Cuenta llena de basura: ~13 campañas `Copia / FOTO / 1-10` pausadas con 0 gasto.

---

## 3. Runbook de consolidación (🟢 sin riesgo · 🟡 reinicia aprendizaje)

### Fase 0 — Preparar y limpiar 🟢
1. Archivar las ~13 campañas basura (`Copia / FOTO / 1-10`, 0 gasto).
2. Renombrar la campaña de Ale → `[PS] Leads - Consolidada 2026` y su conjunto → `Dependencia 25-49`. **Renombrar NO reinicia el aprendizaje** (era el miedo — es solo metadato).

### Fase 1 — Meter a las asesoras existentes en el conjunto de Ale 🟢
3. Por cada una (Paula, Fabi, Giuli, Guille): pestaña **Anuncios** → seleccionar su anuncio → **Duplicar** → destino **"Conjunto de anuncios existente" = el de Ale**.
   - **"Usar publicación existente"** (preserva likes/comentarios).
   - Mantener **SU formulario** (su WhatsApp).
   - Dejar **PAUSADO**. Nombrar `AD - Paula`, `AD - Fabi`, etc.
4. Agregar anuncios **pausados** a un conjunto activo **no reinicia aprendizaje**.

> **Gotcha de duplicación:** NO duplicar a nivel **campaña** (crea una campaña nueva = re-fragmenta). Duplicar a nivel **anuncio** con destino el conjunto de Ale. Si aparece el diálogo de recomendaciones, elegir **"Duplicar configuración original"**, nunca "con recomendaciones" (Advantage+ cambia la audiencia; "agregar imagen" cambia el creativo — preservar, no "mejorar", durante la consolidación).

### Fase 2 — Stefy (nueva asesora) 🟢
5. Stefy no tiene form ni anuncio. Duplicar un formulario existente (idealmente el de Ale ya con city+CP), cambiar la pantalla de gracias a **el WhatsApp de Stefy**, crear anuncio `AD - Stefy` en el conjunto de Ale con ese form. **Pausado** hasta que arranque.

### Fase 3 — Presupuesto 🟡
6. El conjunto (18k/día, calibrado para 1 asesora) tiene que cubrir a todas las activas. **Subir escalonado (~20-30%/día), no de golpe** (salto grande = reinicia aprendizaje).

### Fase 4 — Activar y rotar (martillo) 🟢
7. Activar los anuncios de las que compran ahora (**máximo ~6 activos**). Pausar cada una a los 50. La próxima se activa **dentro del conjunto de Ale**, nunca en campaña separada.

### Fase 5 — Matar lo viejo 🟢
8. Cuando el consolidado entrega bien, **archivar las 4 campañas clon**. No reactivarlas nunca.

### Fase 6 — "v2" deliberada, más adelante 🟡 (todo junto = un solo reinicio)
9. Con la regla auto de calificación lista: cambiar evento de optimización **`closed-won` → `calificado`** + bajar edad a **25-49** (la data muestra 26-35 al 71%). Juntos.

### Reglas de oro del aprendizaje
| No reinicia 🟢 | Sí reinicia 🟡 |
|---|---|
| Renombrar | Cambiar evento de optimización |
| Agregar anuncios pausados | Cambiar segmentación (edad/geo) |
| Pausar un anuncio | Subir mucho el presupuesto de golpe |
| Duplicar con publicación existente | Cambiar el creativo del anuncio activo |

---

## 4. Formularios

- **No se editan en vivo** → se **duplican**: copiar, agregar campos, adjuntar a un anuncio nuevo.
- **city + código postal son campos de PREFILL** (Meta los autocompleta del perfil, el lead solo confirma) → **fricción mínima**, no manual. Vale agregarlos a la de Ale (le faltan): dan zona para calificar/rutear y dejan el CRM con la ubicación de los leads de Ale. Caveat: el prefill puede venir desactualizado → zona orientativa.
- El resto (edad, situación laboral, cuándo comenzar, cuántas personas) son las 4 preguntas que **alimentan la regla de calificación** — mantenerlas. No engordar el form con campos manuales (fricción = CPL).

---

## 5. Estrategia CAPI de calificación (paralela — mayor ROI, no depende de la consolidación)

**Ya construido y activo:** CAPI multi-etapa manda el funnel completo cuando un humano mueve el deal — `calificado` (144), `no-calificado` (74), `closed-won` (65), `perdido` (56). Dedupe por `UNIQUE(lead_id, event_name)`.

**El problema:** los adsets optimizan sobre **`closed-won`** — solo ~64 en total (~13/sem) → demasiado escaso, Meta nunca sale de aprendizaje. Probablemente el mayor factor del CPL alto.

**El plan (orden de palanca):**
1. **Consolidar** (este runbook) → concentra volumen.
2. **Cambiar el evento de optimización `closed-won` → `calificado`** (más frecuente). Cero código — ya se manda.
3. **Regla auto de calificación** (único código a construir): evaluar las respuestas del formulario al ingresar y disparar `calificado` automático, para **fabricar** ~50 `calificado`/sem y cruzar el umbral de aprendizaje. Implementación: función pura + pasada nueva en el reconcile que ya existe; el dedupe unifica auto + humano; refinamiento: si el humano ya marcó "No-calificado", la regla auto lo respeta.

**La regla, validada contra 338 resultados reales:**
- Cruce respuestas→resultado: `más de 49 años` (49% calif, 5 ventas/146) y `otra situación` laboral (51%, 5/74) son los segmentos flojos. Las ventas se concentran en **≤49 + (dependencia o monotributista)**.
- Regla candidata **`edad ≤49 Y (dependencia o monotributista)`**: 67% calidad (vs 52% de los que no pasan), **86% de las ventas** (55/64), 68% del volumen.
- **+49:** se excluye de la señal AUTO (no le pagás a Meta por buscar más de un segmento que convierte 3-4x peor), pero **los +49 que sí afilian siguen mandando su `calificado` por la vía humana** — no se pierde ninguna venta.
- **NO agregar urgencia** a la regla: discrimina poco y tira el volumen abajo de 50/sem.
- Validar con las notas reales de la planilla ("ya está afiliado", "no puede derivar aportes" → no-calificado; "con recibo/monotributo" → calificado): el eje es **aportes derivables**.

**`Cotizado` (diferido):** se puede agregar como regla de config (1 fila, cero código) cuando las asesoras usen la etapa (hoy tiene 0 deals). Sirve para MEDIR (validar la regla auto: ¿los auto-calificados llegan a cotización?), no para optimizar todavía (más profundo = más escaso).

---

## 6. Métricas a instrumentar (deciden todo lo demás)

- **Tap-through** de la pantalla de gracias (para dimensionar cualquier futuro router).
- **Match-rate de teléfono** (si algún día se hace confirmación en página).
- **Tiempo de respuesta de la asesora** (el cuello real; si contesta en 3hs, el mecanismo da igual).
- **Costo por VENTA** con holdout (no CPL — el CPL baja casi mecánico al consolidar; el holdout prueba el 2-3x de verdad).

---

## 7. Inputs pendientes / próximos pasos

- [ ] **WhatsApp de Stefy** (para su formulario).
- [ ] **¿Quiénes compran ahora?** (para saber qué anuncios activar en Fase 4).
- [ ] Ejecutar Fases 0-2 (sin riesgo).
- [ ] Construir la **regla auto de calificación** (el único código) → habilita el cambio de evento a `calificado`.
- [ ] Fase 6 "v2" (evento + edad juntos) una vez que la regla auto esté viva.

---

## Anexo — Constantes técnicas de la cuenta

- Cuenta: `act_1379871940277019` (PrevencionADS, ARS). El MCP de Meta **no está habilitado** para esta cuenta (rollout gradual); se lee por Graph API con token de usuario (rotar el token compartido en texto plano).
- Campaña base Ale: `120244095116120383`. Página: `851468501392623`. Pixel: `796135859815097`.
- WhatsApp siempre vía `api.whatsapp.com/send`, nunca `wa.me`.
