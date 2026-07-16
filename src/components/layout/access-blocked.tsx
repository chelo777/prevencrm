import { PauseCircle } from "lucide-react";

// Pantalla cuando el admin pausó el acceso de la asesora. Lenguaje NO
// punitivo a propósito (del council): no cometió una falta, su acceso
// está en pausa. Sin datos de la cuenta a la vista (RLS igual protege).
export function AccessBlocked() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
        <PauseCircle className="h-7 w-7 text-amber-400" />
      </div>
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-foreground">
          Tu acceso está en pausa
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Un administrador pausó tu acceso a la cuenta. Escribile para
          reactivarlo cuando quieras.
        </p>
      </div>
    </div>
  );
}
