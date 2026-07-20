"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Borrado definitivo de un lead (admin-only — el botón solo se renderiza
// para admin/owner en page.tsx). Pega directo a la RPC delete_lead, que
// borra atómicamente lead + deal + contacto (si no queda compartido con
// otro lead/deal) + eventos CAPI. Sin undo: por eso el diálogo confirma.

export function DeleteLeadButton({
  leadId,
  leadName,
}: {
  leadId: string;
  leadName: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onConfirm() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_lead", { p_lead_id: leadId });
    setBusy(false);
    if (error) {
      toast.error("No se pudo eliminar el lead");
      return;
    }
    toast.success("Lead eliminado");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Eliminar lead"
        aria-label="Eliminar lead"
        className="inline-flex items-center rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-destructive transition-colors hover:bg-destructive/20 sm:px-2.5 sm:py-1.5"
      >
        <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Eliminar lead
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Vas a eliminar definitivamente el lead de{" "}
              <strong>{leadName || "este contacto"}</strong>: su contacto,
              deal, notas y eventos. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? "Eliminando…" : "Eliminar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
