// ============================================================
// Gating de módulos — lógica pura, sin I/O, testeable.
//
// Decide qué módulos (ítems de la nav) puede ver un usuario. Es UX +
// defensa en profundidad, NO el control de acceso a los datos: eso lo
// hace RLS. El sidebar filtra con esto y el layout server redirige, pero
// una ruta/tabla sin RLS quedaría abierta igual — asumí que esto miente
// y que RLS es el muro.
//
// Admin/owner ven todos los módulos. Agent/viewer ven su `allowed_modules`
// (si está seteado) o el default. El perfil propio (/settings) queda
// siempre accesible.
// ============================================================

import type { AccountRole } from "./roles";

/** Módulos gateables = ítems de la nav principal. El slug es el primer
 *  segmento de la ruta (ej. /leads → "leads"). */
export const MODULES = [
  "dashboard",
  "inbox",
  "notifications",
  "leads",
  "quick-messages",
  "contacts",
  "pipelines",
  "broadcasts",
  "automations",
  "flows",
] as const;

export type ModuleSlug = (typeof MODULES)[number];

/** Rutas siempre accesibles (no gateadas): /settings deja al asesor
 *  editar su propio perfil; sus tabs de config ya se gatean por rol. */
const ALWAYS_ALLOWED_PREFIXES = ["/settings"] as const;

/** Default de una asesora nueva (agent) cuando allowed_modules es null. */
export const DEFAULT_ASESOR_MODULES: ModuleSlug[] = ["leads"];

function isModuleSlug(s: string): s is ModuleSlug {
  return (MODULES as readonly string[]).includes(s);
}

/** Módulos efectivos: admin/owner = todos; agent/viewer = su lista o el default. */
export function effectiveModules(
  role: AccountRole,
  allowed: string[] | null | undefined,
): ModuleSlug[] {
  if (role === "owner" || role === "admin") return [...MODULES];
  if (allowed == null) return [...DEFAULT_ASESOR_MODULES];
  return allowed.filter(isModuleSlug);
}

/** Mapea una ruta a su slug de módulo por primer segmento. null si no mapea. */
export function moduleForPath(pathname: string): ModuleSlug | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return isModuleSlug(seg) ? seg : null;
}

/**
 * ¿Puede el usuario acceder a esta ruta? Las rutas siempre-permitidas y
 * las no mapeadas a un módulo devuelven true (no bloqueamos lo que no
 * gateamos). Las mapeadas se chequean contra los módulos efectivos.
 */
export function canAccessPath(
  role: AccountRole,
  allowed: string[] | null | undefined,
  pathname: string,
): boolean {
  if (
    ALWAYS_ALLOWED_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    )
  ) {
    return true;
  }
  const slug = moduleForPath(pathname);
  if (!slug) return true;
  return effectiveModules(role, allowed).includes(slug);
}

/** Primer módulo permitido — destino del redirect si el actual no lo está. */
export function firstAllowedModule(
  role: AccountRole,
  allowed: string[] | null | undefined,
): ModuleSlug | null {
  return effectiveModules(role, allowed)[0] ?? null;
}
