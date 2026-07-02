# syntax=docker/dockerfile:1

# ============================================================
# wacrm / Preven Leads Manager — imagen de producción
# Next.js 16 (App Router) en modo standalone.
# Pensada para Dokploy (build por Dockerfile).
# ============================================================

# Base común: Node 22 LTS sobre Alpine (imagen chica).
FROM node:22-alpine AS base
# libc6-compat: algunas deps nativas de Next lo necesitan en Alpine.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ------------------------------------------------------------
# 1) deps — instala node_modules con el lockfile (cacheable)
# ------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# npm ci = install reproducible desde el lockfile.
RUN npm ci

# ------------------------------------------------------------
# 2) builder — compila la app (next build)
# ------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# --- Variables públicas (se hornean en el bundle del cliente) ---
# DEBEN pasarse como build args en Dokploy, si no el navegador
# recibe una URL/anon key indefinida y la app no conecta.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ------------------------------------------------------------
# 3) runner — imagen final mínima que sirve la app
# ------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Usuario sin privilegios.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Assets estáticos + salida standalone (server.js + node_modules mínimos).
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# El server standalone escucha en PORT/HOSTNAME (Dokploy mapea el puerto).
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "server.js"]
