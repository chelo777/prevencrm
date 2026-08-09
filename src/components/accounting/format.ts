// Formateo de la contabilidad (es-AR). Vive aparte para que los componentes
// no repitan el Intl y el panel se lea limpio.

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function money(n: number): string {
  return ARS.format(n);
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Fecha DATE (YYYY-MM-DD) a DD/MM/AAAA sin correrla de día por timezone. */
export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
