import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * CSP ships as `Content-Security-Policy-Report-Only` so the browser
 * surfaces violations in the console without blocking anything — once
 * we have confidence nothing legit trips it (two deploys, a pass on
 * every route), flip the key to `Content-Security-Policy` to enforce.
 *
 * The rest of the headers are straight blocks, safe to enforce today:
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: we don't use camera / microphone / etc, so
 *     deny them. A supply-chain compromise or a forgotten plugin
 *     can't silently opt back in.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Microphone is allowed for same-origin (`self`) so the inbox
    // composer can record voice notes via MediaRecorder. Everything
    // else stays denied — a compromised dependency can't silently grab
    // the camera / geolocation / etc.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline hydration script
      // and 'unsafe-eval' in dev + some production optimisations.
      // Nonce-based CSP is a later project.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind + inline style attributes on lots of components.
      "style-src 'self' 'unsafe-inline'",
      // Supabase public-bucket avatars, contact avatars (arbitrary
      // https URLs paste-able from the UI), OG images, data URLs for
      // tiny inline assets.
      "img-src 'self' data: blob: https:",
      // Outbound media previews (blob: from MediaRecorder + file picker)
      // and Supabase public-bucket audio/video the inbox renders.
      "media-src 'self' blob: https://*.supabase.co",
      "font-src 'self' data:",
      // Supabase REST + realtime (WSS). All Meta API calls happen
      // server-side, so graph.facebook.com does not belong here.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
] as const;

/**
 * Rutas que se renderizan igual para cualquiera (con o sin sesión) y por lo
 * tanto pueden vivir en una caché compartida. TODO lo que no esté acá se
 * trata como página autenticada: `private, no-store`.
 *
 * Es una alternancia de regex, se usa dentro de `source` en headers(). Al
 * agregar una página pública nueva, sumala acá; si te olvidás, la página
 * simplemente no se cachea en el borde (fail-safe: se pierde latencia, nunca
 * corrección).
 */
const PUBLIC_ROUTES = [
  "login",
  "signup",
  "forgot-password",
  "gracias",
  "r/.*", // links cortos públicos
  "join/.*", // alta de asesor por invitación
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
].join("|");

const nextConfig: NextConfig = {
  /**
   * Standalone output for Docker/Dokploy.
   *
   * Produces `.next/standalone` with a minimal `server.js` and only the
   * production `node_modules` actually traced as used — the runtime image
   * copies that instead of the full dependency tree, keeping it small.
   */
  output: "standalone",

  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — leave to Next. Turbopack dev chunks can go
   *     stale if we force immutable caching here; Next already emits
   *     the correct production headers for hashed assets.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *   - PUBLIC_ROUTES   — public, brief s-maxage + generous
   *     stale-while-revalidate. The edge serves instantly from cache
   *     for the first 5 min, then returns cached content while
   *     refreshing in the background for up to 24 h. A deploy's
   *     chunk-hash drift self-heals within ~5 min with no user-
   *     visible latency.
   *   - Everything else — `private, no-store`. Authenticated pages are
   *     per-user AND change on every write.
   *
   *   The note that used to sit here claimed dashboard routes were
   *   "already protected" by Next.js + Supabase auth. They were not:
   *   this rule OVERRODE whatever Next set, and production served
   *   `Cache-Control: public, max-age=0, s-maxage=300,
   *   stale-while-revalidate=86400` on every authenticated page. Two
   *   real consequences:
   *
   *     1. `router.refresh()` came back STALE. The RSC payload is a GET
   *        to the same URL, so `stale-while-revalidate` let the browser
   *        answer it instantly from cache and revalidate in the
   *        background — you saved a change, the panel kept showing the
   *        old numbers, and only a manual reload fixed it. This is what
   *        made the accounting panel (and any optimistic write) look
   *        broken.
   *     2. `public` without `Vary: Cookie` invites any shared cache to
   *        store one user's authenticated HTML and serve it to another.
   *        Nothing in front of the app happened to cache it, which is
   *        the only reason this never leaked.
   *
   *   Hence: private by DEFAULT, and only the routes listed below —
   *   which render the same for everyone, logged in or not — opt into
   *   edge caching. A new authenticated route is safe automatically;
   *   forgetting to add one here costs a little latency, never
   *   correctness.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   */
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // Páginas públicas: idénticas para todo el mundo, se pueden cachear
        // en el borde. Es la regla que cura la deriva de chunk-hashes tras
        // un deploy.
        source: `/:path(${PUBLIC_ROUTES})`,
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // Todo lo demás es la app autenticada: por usuario y cambiante en
        // cada escritura. `no-store` es lo que hace que router.refresh()
        // traiga datos frescos en vez de la copia stale del navegador.
        source: `/:path((?!_next/static|_next/image|api|${PUBLIC_ROUTES}).*)`,
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Vary", value: "Cookie" },
        ],
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
