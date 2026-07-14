// Humaniza los slugs de las respuestas del formulario de Meta para
// mostrarlas legibles en la vista de detalle del lead. Los valores
// vienen como "entre_36_y_49_años" y los nombres de campo como
// "qué edad tenés"; se muestran "Entre 36 y 49 años" y "Qué edad tenés".

/** Capitaliza la primera letra respetando acentos. */
function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Nombre de campo legible: trim + capitaliza la primera letra. */
export function humanizeFieldName(fieldName: string): string {
  return capitalizeFirst(fieldName.trim());
}

/**
 * Valor legible: reemplaza guiones bajos por espacios, colapsa espacios
 * repetidos y capitaliza la primera letra. Los valores ya legibles
 * (sin guiones bajos) pasan casi intactos.
 */
export function humanizeFormValue(value: string): string {
  const spaced = value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return capitalizeFirst(spaced);
}
