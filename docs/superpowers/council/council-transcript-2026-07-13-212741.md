# LLM Council — MVP router multi-asesor + routing por confirmación de teléfono

**Fecha:** 2026-07-13
**Tema:** ¿Es sólido el MVP del router multi-asesor (una campaña/form único en Meta → página propia que pide el teléfono → muestra el WhatsApp de la asesora asignada), corriendo en paralelo al legacy de planilla?

---

## Pregunta enmarcada

¿Es sólido este MVP de "router multi-asesor"? Una campaña/formulario único en Meta → la pantalla de agradecimiento redirige a una URL FIJA (Meta no deja inyectar lead_id) → página propia que PIDE EL TELÉFONO → el CRM busca el deal ya asignado por dedupe y muestra el WhatsApp de la asesora. Corre en paralelo al flujo legacy (planilla + campañas duplicadas). Objetivo: bajar el CPL 2-3x consolidando la subasta/aprendizaje de Meta, y poder sumar más compradoras.

Preguntas específicas: (1) fallas del modelo de identificación por teléfono y su fricción; (2) la carrera temporal webhook-vs-llegada-a-la-página; (3) riesgos de correr en paralelo al legacy; (4) mínimo imprescindible vs. diferible; (5) agujeros de seguridad/privacidad en una página pública que toca asignación y datos de salud.

**Restricción técnica dura verificada:** la pantalla de agradecimiento de Meta Lead Ads redirige a una URL FIJA por formulario; no se puede inyectar el lead_id ni ningún dato del lead. Todos caen en la misma URL sin identificador.

**Decisiones ya tomadas por el usuario:** identificación por confirmación de teléfono; cuenta real de Ale creada para probar reparto; WhatsApp siempre vía api.whatsapp.com/send (nunca wa.me); el CRM asigna, la página solo muestra.

---

## Respuestas de los asesores

### El Contrarian
La falla fatal no está en tus 5 preguntas: está en que el router resuelve la dirección equivocada del contacto. En Lead Ads la asesora contacta al lead, no al revés. Vos YA tenés el teléfono en el webhook; la asesora asignada puede escribir en 30 segundos. La página que pide el teléfono de nuevo solo sirve para que el LEAD inicie el chat, y estás pagando eso con fricción, carrera y un oráculo de enumeración. Antes de construir nada: probá que "lead-initiated en 2 min" le gana a "asesora-initiated en 30 seg". Si no gana claro, todo el aparato sobra y la pantalla de gracias dice "ya te escribimos".

Segundo: el teléfono NO es determinístico. Meta prellena desde el perfil de FB; en tu página la persona lo tipea de memoria. +54 9 vs 15 vs sin código, typo, el celular del perfil ≠ el WhatsApp que usa. Tu normalización no reconcilia todo, y cada miss es lead perdido o ruteado a la asesora equivocada. Medí el match-rate real antes de asumir "es el mismo teléfono".

Tercero, el que más me quema: la página pública es un oráculo de teléfonos. Tipeo números y me dice si esa persona es lead y a qué asesora cayó. Enumerable. Un competidor mapea tu operación; un curioso infiere datos de salud. Rate-limit no alcanza.

Cuarto: correr en paralelo NO baja el CPL. Son 7 campañas en la subasta canibalizándose hasta que MATES las 6 viejas. El paralelo indefinido contradice el objetivo mismo del MVP. Time-boxealo con criterio de corte explícito, o el aprendizaje nunca arranca.

La carrera temporal (pregunta 2) es real, pero es síntoma: si la asesora escribe primero igual, el race deja de importar. Ahí está la pista de que sobra la mitad del diseño.

### El First Principles Thinker
Están fusionando dos problemas y tratándolos como uno. Problema A: la subasta y el aprendizaje de Meta fragmentados. Problema B: llevar a la persona al WhatsApp correcto. El premio real —bajar el CPL 2-3x— es 100% el Problema A, y se resuelve con UNA campaña + UN formulario + UN evento CAPI. Eso no necesita ninguna página router. Consolidá y cobrá ese beneficio ya, hoy.

El router es el Problema B, y ahí hacen la pregunta equivocada. Preguntan "¿cómo identifico a la persona en la página?". La pregunta es "¿por qué necesito que la persona vuelva a clickear hacia el WhatsApp?". No lo necesitás: el teléfono ya entró por el webhook, el deal ya se asignó, la asesora puede escribir ELLA. Esa es la función claim-first que ya construiste, y ya resuelve el 100% de los leads que hoy no clickean.

Si igual querés el clic "en caliente", el diseño actual es el peor de dos mundos: el único valor del formulario nativo es fricción cero, y le pegás un muro de "reescribí tu teléfono" justo post-conversión. Fundís el CTR ahí. Y si la fricción se acepta, ¿para qué Lead Ads? Un formulario en página propia te da un identificador real en la URL gratis: cero doble carga, cero carrera, cero endpoint público enumerable.

Ese es el olor de fondo: usás a un humano reescribiendo su teléfono como ID de correlación entre dos sistemas async, porque Meta no te lo da. Toda la cascada —carrera temporal, doble asignación, oráculo de enumeración de teléfonos con datos de salud— nace de esa sola decisión. Matá la página y muere la cascada. Consolidá primero; el router es para cuestionar, no para blindar.

### El Expansionist
La página propia no es "fricción con un teléfono": es la palanca que hoy no ves. Tres upsides que las campañas duplicadas te prohíben:

1. **CAPI determinístico = CPL por debajo de tu meta.** Ya tenés CAPI multi-etapa construido. La página captura el teléfono normalizado = match key perfecto para Meta. No solo consolidás el aprendizaje en un adset: lo alimentás con conversiones server-side de match quality altísimo. Los 1000–1500 son piso, no techo. Y el click al botón de WhatsApp es OTRO evento optimizable que hoy no tenés.

2. **Sumar compradoras pasa a costar CERO.** Hoy asesora nueva = campaña nueva = más canibalización. Esta arquitectura invierte el signo: más asesoras = más capacidad de reparto sin tocar la subasta. Agregás una fila en Miembros y listo. Ese es el flywheel real: no vas de 6 a 8, vas de 6 a 60. Dejás de "vender tandas" y pasás a ser el motor de demanda con roster elástico.

3. **Una pregunta más en la página = routing inteligente.** Ya que pedís el teléfono, pedí UNA cosa más (obra social, plan, zona). Ahora no repartís least-loaded: repartís por especialidad/zona/performance. Lead pre-calificado = la asesora cierra más = cobrás más por tanda.

El teléfono no es fricción, es filtro. Quien lo re-tipea es lead más caliente y te confirma el dato. Comprás calidad, no perdés volumen. Y el pixel propio: audiencias custom de compradores reales → lookalikes que hoy son imposibles.

Mínimo imprescindible: página + captura de teléfono + CAPI del click. Todo lo demás (cupo, pregunta calificadora, A/B) es iteración sobre una base que ya te cambió la escala.

### El Outsider
Ponete en la piel de quien acaba de tocar el botón: dio su teléfono hace dos segundos y ahora una página desconocida se lo vuelve a pedir. La lectura instantánea es "algo falló" o "esto es trucho". En salud, donde la gente ya vive esquivando llamados de venta, pedir el número de nuevo dispara la alarma de spam. Una parte grande no lo escribe: cierra y listo. Perdiste el lead que YA pagaste.

Peor es el problema de tiempos. Llega en 1-2 segundos y el sistema tarda varios en registrarlo. O sea que muchísimos van a caer antes de existir en tu base. Si la página contesta "no encontramos tu número", para la persona eso es un cartel de "roto" y se va. Nunca puede haber pantalla muerta: mostrá "te estamos conectando con tu asesora..." y si en X segundos no aparece, mandala igual a un WhatsApp por defecto. Nadie sale con las manos vacías.

Lo innecesariamente complicado: le estás pidiendo AL USUARIO que haga el trabajo de identificarse para resolver un problema tuyo. A la persona no le importa "qué asesora le tocó" — ese concepto no existe en su cabeza, solo quiere hablar con alguien ya. Repartí vos en la página (rotativo) sin pedir nada, o usá un solo número con reparto por detrás. El teléfono como llave es puro costo y cero beneficio para ella.

Y lo grave: la página es pública. Si escribo el número de un tercero y me devuelve algo, estás confirmando que esa persona pidió info de un seguro de salud. Es un dato sensible filtrado, y habilita a raspar tu base número por número. Nunca reveles nada a partir de un teléfono tipeado a mano.

### El Executor
Es sólido, con un agujero que hay que tapar sí o sí: el cron de 2-5 min. Para este flujo la persona llega antes de que ingeste nada, así que el cron acá no sirve. La solución no es polling lindo: es hacer la ingesta claim-first SÍNCRONA en el webhook para el form nuevo. Meta dispara en ~1s; entre que la persona lee, tipea y manda el teléfono pasan 5-15s. El deal ya va a existir casi siempre.

1. **Identificación por teléfono:** sí, es reuso puro. `normalizeArgentinePhone` + `findExistingContact` ya lo resuelven. Riesgo real: el número que tipea la persona ≠ el que Meta prellenó (lo editan, ponen un fijo). Por eso necesitás fallback obligatorio.

2. **Carrera:** webhook síncrono + la página reintenta cada 1s hasta ~20s con "esperá un segundo". Y el fallback que te salva de todo: si a los N intentos no hay deal, la PÁGINA misma corre la función claim-first y asigna least-loaded ahí. Así no dependés de ganar la carrera.

3. **Paralelo al legacy:** routeá por `form_id`. Campaña/form nuevo = pool nuevo (vos + Ale). La asignación least-loaded TIENE que correr en transacción con lock (`SELECT FOR UPDATE`) o unique constraint en teléfono normalizado + `ON CONFLICT`, o webhook y fallback duplican deal.

4. **MVP de la semana:** 1 route API (POST teléfono → link de WhatsApp), 1 página con input+polling, webhook síncrono para el form nuevo, rate limit. Diferís: UI polida, multi-campaña, analytics.

5. **Seguridad:** es un oráculo de enumeración. Blindaje mínimo real: la respuesta devuelve SOLO el link de WhatsApp, cero PII (ni nombre ni estado). Cloudflare Turnstile invisible + rate limit por IP (5/min). Mata el scraping y es gratis.

**Lunes a la mañana:** creá el form único, agarrá su `form_id`, y meté la ingesta claim-first síncrona en el webhook para ese id. Sin eso, nada del resto funciona.

> Nota del chairman: el Executor escribió "wa.me" como abreviatura; la restricción real del proyecto es SIEMPRE `api.whatsapp.com/send`, nunca `wa.me` (rompe emojis de 4 bytes — verificado). Se preserva.

---

## Ronda de peer review (anonimización revelada)

Mapa: **A = Executor · B = Contrarian · C = Expansionist · D = First Principles · E = Outsider**

**Consenso de los 5 revisores:**
- **Más fuerte: D (First Principles) — unánime (5/5).** Es la única que desacopla el objetivo de negocio (bajar CPL = Problema A, cobrable hoy sin router) del mecanismo riesgoso (router = Problema B), y ofrece la salida limpia (form propio con identificador en la URL).
- **Punto ciego más grande: C (Expansionist) — 5/5.** Todo el upside (CAPI determinístico, flywheel 6→60, lookalikes) apoyado sobre el supuesto sin medir de que el teléfono tipeado matchea y que la gente completa la página. Con match-rate 60% y rebote 30%, la rueda no gira. Survivorship bias ("quien re-tipea es más caliente" no cuenta los que perdés).

**Lo que las CINCO respuestas se perdieron (cazado en el review):**
1. **La página solo ve una MINORÍA.** La pantalla de gracias de Meta es un BOTÓN que hay que tocar; el tap-through es ~20-40%. La página NUNCA puede ser el router primario — solo ve una fracción. El backbone del 100% es el webhook claim-first; la página es, a lo sumo, capa aditiva.
2. **Reglas de WhatsApp.** Lead-initiated (el tap) abre la ventana gratis de 24h. Advisor-initiated a escala (el "que escriba la asesora" de B/D) es outbound en frío: exige plantillas aprobadas y quema números. Esa asimetría gobierna el diseño y nadie del panel original la nombró.
3. **El cuello real es el tiempo de respuesta de la asesora, no el handoff de 30 seg.** Si contesta en 3hs, el mecanismo da igual.
4. **La métrica correcta es costo por VENTA, no CPL.** Consolidar baja el CPL casi mecánico; un flujo con más fricción puede cumplir el CPL mientras sube el costo por cierre. Hace falta un holdout para probar el 2-3x.
5. **El browser in-app de IG/FB** rompe redirect y pixel.
6. **Las compradoras PAGAN por los leads.** Si misses/timeouts caen todos a un WhatsApp default, rompés el reparto justo y la confianza del comprador (el segundo objetivo).
7. **Faltan dos datos que zanjan todo el debate:** match-rate real del teléfono y tiempo de respuesta de las asesoras.

---

## Veredicto del Chairman

### Donde el consejo coincide
1. El premio real (CPL 2-3x) **no necesita la página router**: se logra 100% consolidando en UNA campaña + UN formulario + UN evento CAPI. Cobrable ya.
2. La confirmación de teléfono es el **eslabón más débil** por tres motivos independientes: fricción/desconfianza en salud, no es determinístico, y crea un oráculo de enumeración sobre datos sensibles.
3. El **cron de 2-5 min no sirve** acá: si se construye la página, el webhook debe hacer ingesta claim-first síncrona con lock/unique constraint.
4. **Correr en paralelo NO baja el CPL** hasta matar las 6 campañas viejas: hay que time-boxear el apagado.

### Donde el consejo choca
- **Upside de la página (Expansionist) vs. riesgo no medido (los otros 4 + los 5 revisores).** El upside es real pero es Fase 2+; no se puede apoyar el MVP en él.
- **Advisor-initiated vs lead-initiated.** "Que escriba la asesora" (First Principles/Contrarian) choca con la realidad de WhatsApp: outbound en frío a escala quema números y exige templates, mientras el tap lead-initiated abre la ventana de 24h gratis. No es uno o el otro — se necesitan los dos, con distinta función.

### Blind spots que cazó el peer review
La página solo ve el 20-40% que toca el botón → jamás puede ser el router primario; el backbone del 100% es el webhook. Reglas de WhatsApp (ventana 24h vs. baneo de número). El cuello es el tiempo de respuesta de la asesora. La métrica es costo por venta, no CPL. Browser in-app rompe redirect/pixel. Las compradoras pagan → los fallbacks no pueden romper el reparto justo.

### La recomendación
**Partir el proyecto en dos y desacoplar:**

- **Ahora (backbone, bajo riesgo, alto retorno):** UNA campaña + UN form + CAPI consolidado + **webhook claim-first SÍNCRONO**. Da el CPL 2-3x y cubre el **100%** de los leads con la asesora asignada al toque. Time-boxeá el apagado de las 6 viejas. Instrumentá 4 métricas: tap-through, match-rate de teléfono, tiempo de respuesta de asesora, costo por venta (con holdout).
- **NO construir la página de confirmación de teléfono como está.** Es el eslabón más débil en todos los ejes y encima solo ve la minoría que toca.
- **Para la minoría que sí toca:** versión mínima segura **sin pedir teléfono** — la página asigna least-loaded en el momento y muestra el WhatsApp (o cae a un pooled). Decidí si el lead-initiated 24h vale el esfuerzo con los números en mano.

Esto respeta lo ya decidido (consolidar, cuenta de Ale) pero cambia el router: de "pedile el teléfono a la persona" a "el webhook asigna, la asesora arranca, y la página —si va— es una capa fina que no pide nada".

### Lo primero que hay que hacer
Consolidá: creá la **única campaña + único formulario + único evento CAPI**, y meté la **ingesta claim-first síncrona en el webhook de ese form_id**. Eso te da el premio (CPL) sin nada del riesgo del router, y genera los 4 números que deciden si la página vale la pena.
