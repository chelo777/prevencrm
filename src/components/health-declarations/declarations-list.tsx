"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Pestaña "Declaraciones" del detalle del lead. Lee de
// health_declarations (no de las notas): la nota se puede borrar, la
// declaración no — así se puede volver a ella dentro de meses.

interface DeclarationRow {
  id: string;
  status: "pending" | "submitted";
  summary: string | null;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  expires_at: string;
}

interface DeclarationsListProps {
  contactId: string;
  /** Cambiarlo fuerza a releer (p. ej. después de mandar un enlace). */
  refreshKey?: number;
}

function formatDate(iso: string, withTime = false): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function DeclarationsList({ contactId, refreshKey = 0 }: DeclarationsListProps) {
  const [rows, setRows] = useState<DeclarationRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Se fija al cargar, no en el render (las reglas de pureza de React).
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("health_declarations")
        .select("id, status, summary, created_by, created_at, submitted_at, expires_at")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false });
      const list = (data ?? []) as DeclarationRow[];

      const ids = [...new Set(list.map((r) => r.created_by))];
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", ids)
        : { data: [] };

      if (cancelled) return;
      setNames(
        Object.fromEntries(
          (profiles ?? []).map((p) => [p.user_id as string, (p.full_name as string) || "Asesor"]),
        ),
      );
      setNow(Date.now());
      setRows(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, refreshKey]);

  async function copy(row: DeclarationRow) {
    if (!row.summary) return;
    try {
      await navigator.clipboard.writeText(row.summary);
      setCopiedId(row.id);
    } catch {
      setCopiedId(null);
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Todavía no se mandó ninguna declaración de salud.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const sender = names[row.created_by] ?? "Asesor";
        const expired =
          row.status === "pending" && new Date(row.expires_at).getTime() < now;
        return (
          <div key={row.id} className="rounded-lg border border-border/50 bg-muted/50 p-3">
            <div className="flex items-center justify-between gap-2">
              {row.status === "submitted" ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Respondida
                </span>
              ) : expired ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Vencida sin responder
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Esperando respuesta
                </span>
              )}
              {row.summary && (
                <button
                  type="button"
                  onClick={() => copy(row)}
                  className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {copiedId === row.id ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copiedId === row.id ? "Copiado" : "Copiar"}
                </button>
              )}
            </div>

            <p className="mt-1.5 text-xs text-muted-foreground">
              Enviada por {sender} el {formatDate(row.created_at)}
              {row.submitted_at
                ? ` · respondida el ${formatDate(row.submitted_at, true)}`
                : !expired
                  ? ` · vence el ${formatDate(row.expires_at)}`
                  : ""}
            </p>

            {row.summary && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {/* Los * son negritas de WhatsApp; acá se leen mejor sin ellos. */}
                {row.summary.replace(/\*/g, "")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
