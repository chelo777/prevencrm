"use client";

import { Check } from "lucide-react";
import { useLeadSelection } from "./lead-selection";

// Checkbox de un lead. Nativo por debajo (teclado y lectores de pantalla lo
// entienden gratis) con la caja dibujada encima: el control nativo en Android
// queda por debajo del área táctil cómoda y no toma el color del tema.
//
// El área de toque es de 44px aunque la caja mida 18 — en el celular se marca
// con el pulgar, en movimiento.

export function LeadCheckbox({ id, label }: { id: string; label: string }) {
  const { isSelected, toggle } = useLeadSelection();
  const checked = isSelected(id);

  return (
    <label
      className="-m-3 inline-flex cursor-pointer items-center justify-center p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggle(id)}
        aria-label={`Seleccionar ${label}`}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="flex size-[18px] items-center justify-center rounded-[5px] border border-border bg-card text-primary-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background"
      >
        {checked && <Check className="size-3 stroke-[3]" />}
      </span>
    </label>
  );
}

/**
 * Checkbox de cabecera: marca o desmarca los leads de la página visible.
 * "Todos los que coinciden con el filtro" es un segundo paso, en la barra —
 * no algo que pase por tocar esto.
 */
export function LeadCheckboxAll({ pageIds }: { pageIds: string[] }) {
  const { ids, allMatching, togglePage } = useLeadSelection();
  const allOn = pageIds.length > 0 && pageIds.every((id) => ids.has(id));
  const someOn = !allOn && (allMatching || pageIds.some((id) => ids.has(id)));

  return (
    <label className="-m-3 inline-flex cursor-pointer items-center justify-center p-3">
      <input
        type="checkbox"
        checked={allOn}
        ref={(el) => {
          if (el) el.indeterminate = someOn;
        }}
        onChange={() => togglePage(pageIds)}
        aria-label="Seleccionar los leads de esta página"
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="flex size-[18px] items-center justify-center rounded-[5px] border border-border bg-card text-primary-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
        style={
          someOn
            ? { borderColor: "var(--primary)", backgroundColor: "var(--primary)" }
            : undefined
        }
      >
        {allOn ? (
          <Check className="size-3 stroke-[3]" />
        ) : someOn ? (
          <span className="h-0.5 w-2.5 rounded-full bg-primary-foreground" />
        ) : null}
      </span>
    </label>
  );
}
