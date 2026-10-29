"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, MessageCircle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

// Genera el enlace único de declaración de salud para el contacto y lo
// manda por WhatsApp al prospecto. El enlace se crea al abrir (el
// WhatsApp se abre en un click aparte: window.open después de un await
// lo bloquean los navegadores del celular).

interface SendDeclarationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string | null;
  /** Número del prospecto normalizado para WhatsApp (549…). */
  waNumber: string;
  /** Se llama cuando efectivamente se abrió WhatsApp. */
  onSent?: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string; missingWhatsapp: boolean };

export function SendDeclarationSheet({
  open,
  onOpenChange,
  contactId,
  contactName,
  waNumber,
  onSent,
}: SendDeclarationSheetProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/health-declarations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          token?: string;
          error?: string;
          code?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.token) {
          setState({
            kind: "error",
            message: json.error ?? "No se pudo crear el enlace",
            missingWhatsapp: json.code === "missing_whatsapp",
          });
          return;
        }
        setState({ kind: "ready", url: `${window.location.origin}/ds/${json.token}` });
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "Sin conexión", missingWhatsapp: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  // Se resetea al cerrar (no al abrir, dentro del effect): la próxima
  // apertura arranca en "loading" y crea un enlace nuevo.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setState({ kind: "loading" });
      setCopied(false);
    }
    onOpenChange(next);
  }

  const firstName = contactName?.trim().split(/\s+/)[0];
  const message =
    state.kind === "ready"
      ? `Hola${firstName ? ` ${firstName}` : ""}! Para avanzar con tu cotización necesito que completes esta declaración de salud, te lleva 2 minutos 👇\n${state.url}`
      : "";

  function send() {
    // api.whatsapp.com directo, NO wa.me: su redirect rompe los emojis.
    window.open(
      `https://api.whatsapp.com/send?phone=${waNumber}&text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
    onSent?.();
    handleOpenChange(false);
  }

  async function copyLink() {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="mx-auto w-full rounded-t-xl sm:max-w-md">
        <SheetHeader className="pb-0">
          <SheetTitle>Declaración de salud</SheetTitle>
          <SheetDescription>
            Le mandás un enlace; cuando la completa, te llega a tu WhatsApp y
            queda en las notas del lead.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6">
          {state.kind === "loading" && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {state.kind === "error" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-300">
              <p>{state.message}</p>
              {state.missingWhatsapp && (
                <Link
                  href="/settings?tab=profile"
                  className="mt-2 inline-block font-semibold underline"
                  onClick={() => handleOpenChange(false)}
                >
                  Ir a Tu perfil
                </Link>
              )}
            </div>
          )}

          {state.kind === "ready" && (
            <>
              <div className="whitespace-pre-line break-all rounded-lg border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                {message}
              </div>
              <Button
                onClick={send}
                className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-600/90"
              >
                <MessageCircle className="size-4" />
                Enviar por WhatsApp
              </Button>
              <Button variant="outline" onClick={copyLink} className="min-h-11">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Enlace copiado" : "Copiar enlace"}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
