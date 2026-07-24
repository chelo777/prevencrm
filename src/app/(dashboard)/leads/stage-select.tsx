"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

// Cambio de etapa inline desde la bandeja de leads. Select nativo (en el
// teléfono abre el picker del sistema) vestido como el chip de etapa.
//
// Persistimos vía POST /api/leads/stage con `keepalive: true` (NO un update
// directo del cliente): en el celular la asesora cambia la etapa y enseguida
// toca WhatsApp (wa.me abre la app y deja la pestaña en segundo plano) o el SO
// suspende la pestaña. Un update async del navegador se aborta antes de llegar
// a la base y el cambio se pierde en silencio ("vuelve a Nuevo"). keepalive
// hace que el request sobreviva a que la pestaña se descargue. Además el
// endpoint confirma que afectó una fila y refrescamos el server component.

export interface StageOption {
  id: string;
  name: string;
  color: string;
}

export function StageSelect({
  dealId,
  stages,
  initialStageId,
}: {
  dealId: string;
  stages: StageOption[];
  initialStageId: string;
}) {
  const router = useRouter();
  const [stageId, setStageId] = useState(initialStageId);
  const [busy, setBusy] = useState(false);
  const color = stages.find((s) => s.id === stageId)?.color ?? "#94a3b8";

  async function onChange(next: string) {
    const prev = stageId;
    if (!next || next === prev) return;

    // Mover a "Calificado" ya NO se bloquea. Como acá (en la tabla) no hay
    // dónde cargar las capitas, solo recordamos hacerlo en el detalle para
    // sumar el valor a Meta (el CAPI es null-safe: sin capitas manda el
    // evento sin valor, nunca basura).
    const targetStage = stages.find((s) => s.id === next);
    if (targetStage?.name === "Calificado") {
      toast.info("Abrí el lead y cargá las capitas para sumar el valor a Meta");
    }

    setStageId(next); // optimista
    setBusy(true);
    try {
      const res = await fetch("/api/leads/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, stageId: next }),
        keepalive: true, // sobrevive a que la pestaña pase a segundo plano / se descargue
      });
      if (!res.ok) {
        setStageId(prev);
        toast.error("No se pudo cambiar la etapa");
      } else {
        // Resync del server component: lo mostrado siempre coincide con la base.
        router.refresh();
      }
    } catch {
      // Si la pestaña se descargó (navegó a WhatsApp), el keepalive completa la
      // escritura igual server-side; este catch es para fallas reales de red.
      setStageId(prev);
      toast.error("No se pudo cambiar la etapa");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex max-w-full items-center">
      <select
        value={stageId}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Cambiar etapa"
        className="max-w-full cursor-pointer appearance-none truncate rounded-full py-1.5 pl-2.5 pr-6 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 sm:py-1"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1.5 h-3 w-3"
        style={{ color }}
      />
    </span>
  );
}
