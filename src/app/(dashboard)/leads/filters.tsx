"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { PERIOD_LABELS, PERIOD_OPTIONS } from "@/lib/date-range";

// Filtros de la bandeja de leads (etapa / etiqueta / asesor / fecha de
// ingreso). Viven en la URL como query params: la página los aplica
// server-side, el estado es compartible, y el bulk manda ese mismo filtro
// para operar exactamente sobre lo que se ve.
//
// En el celular no se despliegan como cuatro selects apilados — empujaban la
// lista fuera de la pantalla. Van detrás de un botón "Filtros" con el número
// de filtros activos, y el panel se abre sobre el contenido. En pantalla
// grande quedan siempre a la vista, que es donde hay lugar.

interface Option {
  id: string;
  name: string;
}

export function LeadFilters({
  stages,
  tags,
  asesoras = [],
}: {
  stages: Option[];
  tags: Option[];
  // Solo lo pasa el admin: habilita el filtro por asesora. Vacío = no se
  // renderiza (una agente no filtra por asignación).
  asesoras?: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const etapa = searchParams.get("etapa") ?? "";
  const etiqueta = searchParams.get("etiqueta") ?? "";
  const asesora = searchParams.get("asesora") ?? "";
  const periodo = searchParams.get("periodo") ?? "";
  const desde = searchParams.get("desde") ?? "";
  const hasta = searchParams.get("hasta") ?? "";

  const activeCount = [etapa, etiqueta, asesora, periodo || desde || hasta].filter(
    Boolean,
  ).length;

  function push(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("pagina"); // todo cambio de filtro vuelve a la página 1
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply(key: "etapa" | "etiqueta" | "asesora", value: string) {
    push((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
  }

  /** Un preset y un rango a mano son excluyentes: el último gana. */
  function applyPeriod(value: string) {
    push((params) => {
      params.delete("desde");
      params.delete("hasta");
      if (value && value !== "todo") params.set("periodo", value);
      else params.delete("periodo");
    });
  }

  function applyCustomDate(key: "desde" | "hasta", value: string) {
    push((params) => {
      params.delete("periodo");
      if (value) params.set(key, value);
      else params.delete(key);
    });
  }

  function clearAll() {
    push((params) => {
      for (const k of ["etapa", "etiqueta", "asesora", "periodo", "desde", "hasta"]) {
        params.delete(k);
      }
    });
    setOpen(false);
  }

  const selectClass =
    "min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground sm:min-h-0 sm:w-auto sm:py-2";
  const dateClass =
    "min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground sm:min-h-0 sm:w-auto sm:py-2";

  const controls = (
    <>
      <select
        aria-label="Filtrar por etapa"
        value={etapa}
        onChange={(e) => apply("etapa", e.target.value)}
        className={selectClass}
      >
        <option value="">Todas las etapas</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {tags.length > 0 && (
        <select
          aria-label="Filtrar por etiqueta"
          value={etiqueta}
          onChange={(e) => apply("etiqueta", e.target.value)}
          className={selectClass}
        >
          <option value="">Todas las etiquetas</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {asesoras.length > 0 && (
        <select
          aria-label="Filtrar por asesor"
          value={asesora}
          onChange={(e) => apply("asesora", e.target.value)}
          className={selectClass}
        >
          <option value="">Todos los asesores</option>
          <option value="none">Sin asignar</option>
          {asesoras.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}

      <select
        aria-label="Filtrar por fecha de ingreso"
        value={desde || hasta ? "custom" : periodo || "todo"}
        onChange={(e) => applyPeriod(e.target.value)}
        className={selectClass}
      >
        {PERIOD_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {p === "todo" ? "Cualquier fecha" : PERIOD_LABELS[p]}
          </option>
        ))}
        {(desde || hasta) && <option value="custom">{PERIOD_LABELS.custom}</option>}
      </select>

      <span className="flex items-center gap-2">
        <input
          type="date"
          aria-label="Ingresó desde"
          value={desde}
          max={hasta || undefined}
          onChange={(e) => applyCustomDate("desde", e.target.value)}
          className={dateClass}
        />
        <span className="shrink-0 text-xs text-muted-foreground">→</span>
        <input
          type="date"
          aria-label="Ingresó hasta"
          value={hasta}
          min={desde || undefined}
          onChange={(e) => applyCustomDate("hasta", e.target.value)}
          className={dateClass}
        />
      </span>
    </>
  );

  return (
    <>
      {/* Mobile: un botón; el detalle vive en el panel. */}
      <div className="flex items-center gap-2 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground"
        >
          <SlidersHorizontal className="size-4" />
          Filtros
          {activeCount > 0 && (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="min-h-11 px-1 text-sm text-muted-foreground underline"
          >
            Limpiar
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end sm:hidden">
          <button
            type="button"
            aria-label="Cerrar filtros"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40 motion-safe:animate-in motion-safe:fade-in"
          />
          <div className="relative max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] motion-safe:animate-in motion-safe:slide-in-from-bottom">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-popover-foreground">
                Filtros
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="-m-2 p-2 text-muted-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex flex-col gap-2.5">{controls}</div>
            <div className="mt-4 flex gap-2">
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="min-h-11 flex-1 rounded-lg border border-border text-sm text-muted-foreground"
                >
                  Limpiar
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 flex-1 rounded-lg bg-primary text-sm font-medium text-primary-foreground"
              >
                Ver resultados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop: a la vista, que hay lugar. */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {controls}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Limpiar
          </button>
        )}
      </div>
    </>
  );
}
