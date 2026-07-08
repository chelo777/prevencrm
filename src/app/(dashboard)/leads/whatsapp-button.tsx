"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { toWhatsAppNumber } from "@/lib/leads/phone";

// Click-to-chat con traza (B11): al abrir WhatsApp registramos una
// nota en el contacto ("Contactado por WhatsApp") sin bloquear la
// apertura del chat. El envío real ocurre en el WhatsApp del asesor.

interface Props {
  leadId: string;
  phone: string | null;
  name: string | null;
  disabled?: boolean;
}

export function WhatsAppButton({ leadId, phone, name, disabled }: Props) {
  const [done, setDone] = useState(false);
  const digits = phone ? phone.replace(/\D/g, "") : "";
  const wa = toWhatsAppNumber(digits);
  const usable = !!wa && !disabled;

  function onClick() {
    if (!usable) return;
    // Traza — best effort, no bloquea.
    fetch("/api/leads/contacted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    }).catch(() => {});
    setDone(true);
    const greeting = `Hola${name ? " " + name.split(" ")[0] : ""}!`;
    window.open(
      `https://wa.me/${wa}?text=${encodeURIComponent(greeting)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!usable}
      title={usable ? "Abrir WhatsApp" : "Teléfono no válido"}
      aria-label={done ? "Contactado por WhatsApp" : "Abrir WhatsApp"}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5 sm:py-1.5"
    >
      <MessageCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      <span className="hidden sm:inline">
        {done ? "Contactado" : "WhatsApp"}
      </span>
    </button>
  );
}
