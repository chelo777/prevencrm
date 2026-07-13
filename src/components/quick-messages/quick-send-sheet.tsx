"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageCircle, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  renderQuickMessage,
  type MessageVars,
  type QuickMessage,
} from "@/lib/quick-messages/render";

// Bottom sheet de envío: lista los mensajes rápidos de la cuenta con
// las variables YA rellenadas para este lead; tocar uno abre wa.me con
// el texto listo. Se consulta al abrir (tabla chica, siempre fresca).

interface QuickSendSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Número ya normalizado para wa.me (solo dígitos, formato 549…). */
  waNumber: string;
  vars: MessageVars;
  /** Se llama cuando efectivamente se abrió WhatsApp. */
  onSent?: () => void;
}

const ITEM_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function QuickSendSheet({
  open,
  onOpenChange,
  waNumber,
  vars,
  onSent,
}: QuickSendSheetProps) {
  const [templates, setTemplates] = useState<QuickMessage[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("quick_messages")
        .select("id, name, body, position")
        .order("position")
        .order("created_at");
      if (!cancelled) setTemplates((data ?? []) as QuickMessage[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function send(text?: string) {
    // api.whatsapp.com directo, NO wa.me: el redirect de wa.me rompe
    // los emojis de 4 bytes (👋 → �) — verificado en vivo. Sin texto
    // (chat vacío), omitimos el parámetro por completo en vez de
    // mandar text= vacío — así WhatsApp no deja ni un espacio picado.
    const url = text
      ? `https://api.whatsapp.com/send?phone=${waNumber}&text=${encodeURIComponent(text)}`
      : `https://api.whatsapp.com/send?phone=${waNumber}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onSent?.();
    onOpenChange(false);
  }

  const fallback = renderQuickMessage("Hola {{primer_nombre}}!", vars);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto w-full rounded-t-xl sm:max-w-md"
      >
        <SheetHeader className="pb-0">
          <SheetTitle>Enviar WhatsApp</SheetTitle>
          <SheetDescription>
            Elegí el mensaje — se abre en tu WhatsApp listo para mandar.
          </SheetDescription>
        </SheetHeader>

        <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto px-4">
          {templates === null ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {templates.map((t) => {
                const text = renderQuickMessage(t.body, vars);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => send(text)}
                    className={ITEM_CLASS}
                  >
                    <div className="text-sm font-medium text-foreground">
                      {t.name}
                    </div>
                    <div className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                      {text}
                    </div>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => send(fallback)}
                className={ITEM_CLASS}
              >
                <div className="text-sm font-medium text-foreground">
                  Solo saludo
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fallback}
                </div>
              </button>
              <button
                type="button"
                onClick={() => send()}
                className={`${ITEM_CLASS} flex items-center gap-2`}
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-emerald-500" />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Chat vacío
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Abrir WhatsApp sin ningún texto escrito
                  </div>
                </div>
              </button>
            </>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Link
            href="/quick-messages"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Gestionar mensajes rápidos
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
