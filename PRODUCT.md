# Product

## Register

product

## Users

Marcelo (dueño/admin) y sus vendedoras de planes de salud prepaga (Ale hoy; Paula, Fabi y Giuli al fin del piloto) en Argentina. Uso principal en el **celular** (PWA instalada), con ratos de escritorio. Contexto real: trabajan leads entrantes de Meta mientras chatean por WhatsApp, con interrupciones constantes y conexión móvil.

## Product Purpose

CRM self-hosted que reemplaza Privyr + planillas de Google: ingesta automática de leads de Meta Lead Ads, pipeline Kanban, aviso push de leads nuevos, click-to-chat de WhatsApp y feedback de conversiones a Meta (CAPI) para optimizar campañas. Éxito = la vendedora contacta el lead en minutos y el estado del pipeline llega a Meta sin trabajo manual.

## Brand Personality

Sobrio, veloz, confiable. Herramienta de trabajo diario: cero decoración que estorbe, densidad razonable, español rioplatense directo.

## Anti-references

- Privyr: funciones básicas detrás de paywalls (export de leads pago).
- Planillas de Google como UI de trabajo: columnas crípticas, estados sin garantías.
- Dashboards SaaS sobrecargados de métricas y gradientes decorativos.

## Design Principles

1. **El teléfono es la primera pantalla**: todo flujo clave se completa a una mano, sin scroll horizontal.
2. **Un lead nuevo se contacta en ≤2 toques** (ver → WhatsApp).
3. **La familiaridad gana**: patrones estándar (tabla, kanban, chips, selects nativos) antes que invenciones.
4. **Lo visible es accionable**: si se muestra una etapa, se puede cambiar ahí mismo.
5. **Nada bloquea la ingesta**: la UI degrada con gracia si Meta o el push fallan.

## Accessibility & Inclusion

Sin requisito formal de WCAG declarado. Mínimos del proyecto: contraste AA (≥4.5:1) en texto, targets táctiles ≥44px en móvil, respetar `prefers-reduced-motion`.
