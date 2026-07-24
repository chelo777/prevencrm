import { Loader2 } from "lucide-react";

// Fallback de carga de las páginas del dashboard. Next lo muestra
// AUTOMÁTICAMENTE mientras renderiza en el servidor la página a la que se
// navega (las force-dynamic como /leads tardan un poco). El shell (sidebar)
// queda montado; solo el área de contenido muestra el spinner, así el usuario
// ve enseguida que la app está trabajando en lugar de una pantalla congelada.
export default function DashboardLoading() {
  return (
    <div
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-8 animate-spin text-primary" />
      <span className="text-sm">Cargando…</span>
    </div>
  );
}
