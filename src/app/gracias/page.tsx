import type { Metadata } from "next";

// Página pública de "gracias" para el destino del formulario de Meta.
// Neutral a propósito: NO manda al WhatsApp de una sola asesora ni al sitio
// oficial de la prepaga (para no fugar el lead) — solo confirma la recepción
// y setea expectativa. El reparto y el contacto salen del CRM.

export const metadata: Metadata = {
  title: "¡Gracias! — Prevención Salud",
  description: "Recibimos tu consulta. Un asesor te contacta por WhatsApp.",
};

const LOGO_BLANCO =
  "https://corporate-site-content.gruposancorseguros.com/PS/Content/Prevencion-salud-logo-completo-blanco.svg";

export default function GraciasPage() {
  return (
    <main
      className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12 text-center text-white"
      style={{
        background:
          "radial-gradient(120% 120% at 50% 0%, #ec1e91 0%, #d6006c 55%, #a80057 100%)",
      }}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-7">
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGO_BLANCO}
          alt="Prevención Salud"
          className="h-12 w-auto sm:h-14"
        />

        {/* Check */}
        <div className="flex size-16 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-8"
            aria-hidden
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        {/* Mensaje */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold sm:text-4xl">¡Gracias!</h1>
          <p className="text-lg text-white/90">
            Recibimos tu consulta.
          </p>
          <p className="text-base text-white/80">
            Un asesor de Prevención Salud te contacta por{" "}
            <span className="font-semibold text-white">WhatsApp</span> en
            minutos para pasarte tu cotización.
          </p>
        </div>

        {/* Horarios */}
        <div className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/70">
            Horarios de atención
          </p>
          <ul className="space-y-1 text-sm text-white/90">
            <li className="flex items-center justify-between gap-4">
              <span>Lunes a viernes</span>
              <span className="font-semibold">08 a 20 hs</span>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span>Sábados y domingos</span>
              <span className="font-semibold">10 a 18 hs</span>
            </li>
          </ul>
        </div>

        <p className="text-xs text-white/60">
          Ya podés cerrar esta ventana. Te escribimos nosotros. 💬
        </p>
      </div>
    </main>
  );
}
