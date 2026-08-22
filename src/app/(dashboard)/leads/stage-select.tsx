"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { durablePost } from "@/lib/durable-write-client";

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

    // keepalive sobrevive a que la pestaña se descargue (navegar a WhatsApp);
    // la cola de reintento cubre lo que keepalive no cubre: quedarse sin señal.
    const { ok, queued } = await durablePost({
      id: `stage:${dealId}`,
      url: "/api/leads/stage",
      body: { dealId, stageId: next },
    });

    if (ok) {
      // Resync del server component: lo mostrado siempre coincide con la base.
      router.refresh();
    } else if (!queued) {
      // Rechazo permanente. Si quedó encolado dejamos la etapa optimista:
      // la cola la aplica al volver la señal.
      setStageId(prev);
    }
    setBusy(false);
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
