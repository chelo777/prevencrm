"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Filtros de la bandeja de leads (etapa del deal / etiqueta del
// contacto). Viven en la URL como query params para que la página
// server-side los aplique en la consulta y el estado sea compartible.

interface Option {
  id: string;
  name: string;
}

export function LeadFilters({
  stages,
  tags,
}: {
  stages: Option[];
  tags: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const etapa = searchParams.get("etapa") ?? "";
  const etiqueta = searchParams.get("etiqueta") ?? "";

  function push(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("pagina"); // todo cambio de filtro vuelve a la página 1
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply(key: "etapa" | "etiqueta", value: string) {
    push((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
  }

  const selectClass =
    "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground";

  return (
    <div className="flex flex-wrap items-center gap-2">
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
      {(etapa || etiqueta) && (
        <button
          type="button"
          onClick={() =>
            push((params) => {
              params.delete("etapa");
              params.delete("etiqueta");
            })
          }
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Limpiar
        </button>
      )}
    </div>
  );
}
