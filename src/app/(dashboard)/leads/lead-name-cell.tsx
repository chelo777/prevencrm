"use client";

import { useOpenLead } from "./lead-detail-provider";

// Celda "Contacto" clickeable de la bandeja. Abre el panel de detalle
// del lead. Si el lead no tiene contacto (raro), cae a texto plano.

export function LeadNameCell({
  contactId,
  name,
  phone,
  phoneValid,
}: {
  contactId: string | null;
  name: string;
  phone: string | null;
  phoneValid: boolean;
}) {
  const openLead = useOpenLead();

  const inner = (
    <>
      <div className="font-medium text-foreground">{name}</div>
      <div className="text-xs text-muted-foreground">
        {phone || "—"}
        {!phoneValid && (
          <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            revisar teléfono
          </span>
        )}
      </div>
    </>
  );

  if (!contactId) return inner;

  return (
    <button
      type="button"
      onClick={() => openLead(contactId)}
      className="group -m-1 rounded-md p-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="font-medium text-foreground group-hover:text-primary">
        {name}
      </div>
      <div className="text-xs text-muted-foreground">
        {phone || "—"}
        {!phoneValid && (
          <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            revisar teléfono
          </span>
        )}
      </div>
    </button>
  );
}
