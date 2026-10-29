import type { Metadata } from "next";
import type { ReactNode } from "react";

// Declaración de salud pública (/ds/<token>). El token va en la URL:
// no-referrer para que no salga en el Referer de nada externo (el logo
// se carga de otro dominio) y noindex por si un enlace termina crawleado.
// NO está en PUBLIC_ROUTES a propósito: cada página tiene datos de una
// persona y debe salir con el `private, no-store` por defecto.

export const metadata: Metadata = {
  title: "Declaración de salud — Prevención Salud",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function DeclarationLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      {children}
    </div>
  );
}
