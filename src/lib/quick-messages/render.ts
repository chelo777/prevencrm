// Mensajes rápidos: sustitución de variables para el flujo click-to-chat
// (wa.me). Pura y sin dependencias — testeada en render.test.ts.

export interface QuickMessage {
  id: string;
  name: string;
  body: string;
  position: number;
}

export interface MessageVars {
  /** Nombre completo del contacto (full_name de Meta). */
  nombre?: string | null;
  /** Nombre de la campaña que originó el lead. */
  campania?: string | null;
}

/** Catálogo de variables disponibles en el constructor. */
export const TEMPLATE_VARIABLES = [
  {
    token: "{{primer_nombre}}",
    label: "Primer nombre",
    example: "María",
  },
  {
    token: "{{nombre}}",
    label: "Nombre completo",
    example: "María González",
  },
  {
    token: "{{campaña}}",
    label: "Campaña",
    example: "[PS] Dependencia 2026",
  },
] as const;

/** Datos de ejemplo para la vista previa del constructor. */
export const PREVIEW_VARS: MessageVars = {
  nombre: "María González",
  campania: "[PS] Dependencia 2026",
};

/**
 * Reemplaza las variables de la plantilla con los datos del lead.
 * Tolerante: acepta espacios dentro de las llaves y "campana" sin ñ.
 * Si una variable no tiene dato, se limpia el espacio sobrante y el
 * espacio antes de puntuación ("Hola !" → "Hola!").
 */
export function renderQuickMessage(body: string, vars: MessageVars): string {
  const nombre = vars.nombre?.trim() ?? "";
  const primerNombre = nombre.split(/\s+/)[0] ?? "";
  const campania = vars.campania?.trim() ?? "";

  return body
    .replace(/\{\{\s*primer_nombre\s*\}\}/gi, primerNombre)
    .replace(/\{\{\s*nombre\s*\}\}/gi, nombre)
    .replace(/\{\{\s*campa(?:ñ|n)a\s*\}\}/gi, campania)
    .replace(/[^\S\n]+([!?.,;:])/g, "$1")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]+$/gm, "");
}
