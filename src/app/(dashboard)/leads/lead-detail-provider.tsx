"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ContactDetailView } from "@/components/contacts/contact-detail-view";

// Provider liviano para la bandeja de leads: mantiene UNA instancia del
// panel de detalle y expone openLead(contactId) por contexto. Envuelve la
// tabla (server-render) sin convertirla en cliente. Se abre por click en
// una fila o por deep-link (?lead=<id>) resuelto server-side a contactId.

const OpenLeadCtx = createContext<(contactId: string) => void>(() => {});

export function useOpenLead() {
  return useContext(OpenLeadCtx);
}

export function LeadDetailProvider({
  initialContactId,
  children,
}: {
  initialContactId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [contactId, setContactId] = useState<string | null>(initialContactId);
  const [open, setOpen] = useState<boolean>(Boolean(initialContactId));

  return (
    <OpenLeadCtx.Provider
      value={(id: string) => {
        setContactId(id);
        setOpen(true);
      }}
    >
      {children}
      <ContactDetailView
        open={open}
        onOpenChange={setOpen}
        contactId={contactId}
        // Refresca la lista tras cambiar etapa/tags/notas desde el panel.
        onUpdated={() => router.refresh()}
        defaultTab="form"
      />
    </OpenLeadCtx.Provider>
  );
}
