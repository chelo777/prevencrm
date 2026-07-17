"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

// Cambio de etapa inline desde la bandeja de leads. Mismo update
// optimista que el drag del Kanban (deals.stage_id bajo RLS); el
// feedback CAPI lo levanta el cron igual que con un movimiento en el
// tablero. Select nativo (en el teléfono abre el picker del sistema)
// vestido como el chip de etapa, con chevron para que se note que es
// editable.

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
  const [stageId, setStageId] = useState(initialStageId);
  const [busy, setBusy] = useState(false);
  const color = stages.find((s) => s.id === stageId)?.color ?? "#94a3b8";

  async function onChange(next: string) {
    const prev = stageId;
    if (!next || next === prev) return;

    // "Calificado" requiere capitas cargadas (VBO para el CAPI) y acá, en
    // la tabla, no hay dónde cargarlas — se bloquea y se manda al lead a
    // abrir el detalle. Nunca window.prompt.
    const targetStage = stages.find((s) => s.id === next);
    if (targetStage?.name === "Calificado") {
      toast.error("Abrí el lead y cargá las capitas para calificar");
      return;
    }

    setStageId(next);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("deals")
      .update({ stage_id: next })
      .eq("id", dealId);
    setBusy(false);
    if (error) {
      setStageId(prev);
      toast.error("No se pudo cambiar la etapa");
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
