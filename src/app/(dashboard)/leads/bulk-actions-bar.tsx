"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { useLeadSelection } from "./lead-selection";
import type { StageOption } from "./stage-select";

// Barra de acciones masivas. Aparece pegada al borde inferior en cuanto hay
// algo seleccionado y es la única pieza "fuerte" de la pantalla: fondo sólido,
// contraste alto, el número de leads en grande y tabular. Todo lo demás en la
// bandeja es discreto justamente para que esto se lea de un vistazo mientras
// se opera con el pulgar.
//
// Mide h-14 más la safe-area del iPhone; la lista reserva ese alto abajo, así
// la barra nunca tapa el último lead.

interface TagOption {
  id: string;
  name: string;
  color: string;
}

export function BulkActionsBar({
  stages,
  tags,
}: {
  stages: StageOption[];
  tags: TagOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ids, allMatching, count, totalMatching, clear } = useLeadSelection();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"stage" | "tags" | null>(null);

  if (count === 0) return null;

  // El filtro de la URL ES la definición del conjunto cuando se eligió "todos
  // los que coinciden": se manda tal cual y el servidor lo reresuelve acotado
  // al rol de quien pide (un asesor solo toca sus leads, pida lo que pida).
  function currentFilter(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of ["etapa", "etiqueta", "asesora", "dup", "periodo", "desde", "hasta"]) {
      const v = searchParams.get(key);
      if (v) out[key] = v;
    }
    return out;
  }

  async function apply(
    body: Record<string, unknown>,
    confirmText: string,
    successVerb: string,
  ) {
    if (!window.confirm(confirmText)) return;

    setBusy(true);
    setPanel(null);
    try {
      const res = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          ...(allMatching
            ? { filter: currentFilter() }
            : { leadIds: [...ids] }),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        affected?: number;
      };
      if (!res.ok) {
        toast.error(payload.error ?? "No se pudo aplicar el cambio");
        return;
      }
      const n = payload.affected ?? 0;
      // Se informa lo que REALMENTE cambió, no lo que se pidió: si la RLS
      // dejó afuera leads ajenos, el número lo dice.
      if (n === 0) {
        toast.info("No se modificó ningún lead", {
          description: "Puede que ya no estén asignados a vos.",
        });
      } else {
        toast.success(`${n} lead${n === 1 ? "" : "s"} ${successVerb}`);
      }
      clear();
      router.refresh();
    } catch {
      toast.error("No se pudo aplicar el cambio");
    } finally {
      setBusy(false);
    }
  }

  const scope = allMatching
    ? `los ${totalMatching} leads del filtro`
    : `${count} lead${count === 1 ? "" : "s"}`;

  function applyStage(stage: StageOption) {
    void apply(
      { action: "stage", stageId: stage.id },
      `Vas a mover ${scope} a "${stage.name}".\n\nEsto no se puede deshacer.`,
      `movido${count === 1 ? "" : "s"} a ${stage.name}`,
    );
  }

  function applyTag(tag: TagOption, mode: "add" | "remove") {
    void apply(
      mode === "add"
        ? { action: "tags", addTagIds: [tag.id] }
        : { action: "tags", removeTagIds: [tag.id] },
      mode === "add"
        ? `Vas a agregar la etiqueta "${tag.name}" a ${scope}.`
        : `Vas a quitar la etiqueta "${tag.name}" de ${scope}.`,
      mode === "add" ? "etiquetados" : "actualizados",
    );
  }

  return (
    <>
      {/* Panel de opciones: sale desde la barra, no desde el centro — la mano
          ya está abajo. */}
      {panel && (
        <>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setPanel(null)}
            className="fixed inset-0 z-40 bg-black/40 motion-safe:animate-in motion-safe:fade-in"
          />
          <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-h-[55vh] max-w-2xl overflow-y-auto rounded-t-2xl border border-border bg-popover p-4 shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4 sm:bottom-[calc(4rem+env(safe-area-inset-bottom))] sm:rounded-2xl">
            <div className="mb-3 text-sm font-medium text-popover-foreground">
              {panel === "stage" ? "Mover a la etapa" : "Etiquetas"}
            </div>

            {panel === "stage" ? (
              <div className="flex flex-wrap gap-2">
                {stages.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => applyStage(s)}
                    className="min-h-11 rounded-full px-4 text-sm font-medium transition-transform active:scale-95"
                    style={{ backgroundColor: `${s.color}22`, color: s.color }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {tags.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Todavía no hay etiquetas. Creá una desde el detalle de un lead.
                  </p>
                )}
                {tags.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span
                      className="truncate rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: `${t.color}22`, color: t.color }}
                    >
                      {t.name}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => applyTag(t, "add")}
                        className="min-h-9 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        Agregar
                      </button>
                      <button
                        type="button"
                        onClick={() => applyTag(t, "remove")}
                        className="min-h-9 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-red-400"
                      >
                        Quitar
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-3 sm:px-4">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {count}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {allMatching ? "del filtro" : count === 1 ? "lead" : "leads"}
            </span>
          </span>

          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPanel(panel === "stage" ? null : "stage")}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-transform active:scale-95 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Etapa
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPanel(panel === "tags" ? null : "tags")}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-transform active:scale-95 disabled:opacity-60"
            >
              <Tag className="size-4" />
              Etiquetas
            </button>
            <button
              type="button"
              onClick={clear}
              aria-label="Cancelar selección"
              className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * Cartel de "seleccionaste los 50 de esta página — ¿querés los N del filtro?".
 * Es el segundo paso deliberado para operar sobre todo el conjunto.
 */
export function SelectAllMatchingHint() {
  const { ids, allMatching, totalMatching, pageSize, selectAllMatching, clear } =
    useLeadSelection();

  const pageFullySelected = ids.size >= pageSize && pageSize > 0;
  if (!pageFullySelected && !allMatching) return null;
  if (totalMatching <= pageSize) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg bg-accent/60 px-3 py-2 text-center text-xs text-muted-foreground">
      {allMatching ? (
        <>
          <span>
            Seleccionados los{" "}
            <span className="font-medium tabular-nums text-foreground">
              {totalMatching}
            </span>{" "}
            leads del filtro.
          </span>
          <button
            type="button"
            onClick={clear}
            className="font-medium text-primary underline underline-offset-2"
          >
            Deshacer
          </button>
        </>
      ) : (
        <>
          <span>Seleccionados los {ids.size} de esta página.</span>
          <button
            type="button"
            onClick={selectAllMatching}
            className="font-medium text-primary underline underline-offset-2"
          >
            Seleccionar los {totalMatching} del filtro
          </button>
        </>
      )}
    </div>
  );
}
