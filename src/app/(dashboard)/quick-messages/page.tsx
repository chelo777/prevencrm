"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  MessagesSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PREVIEW_VARS,
  TEMPLATE_VARIABLES,
  renderQuickMessage,
  type QuickMessage,
} from "@/lib/quick-messages/render";

// Mensajes rápidos: constructor de plantillas click-to-chat (estilo
// Privyr). Los gestiona owner/admin; cualquier miembro los usa desde
// el botón de WhatsApp. Constructor responsivo: formulario y vista
// previa lado a lado en desktop, apilados en el teléfono.

interface Draft {
  id: string | null;
  name: string;
  body: string;
}

const EMPTY_DRAFT: Draft = { id: null, name: "", body: "" };

export default function QuickMessagesPage() {
  const { accountId, accountRole } = useAuth();
  const canManage = accountRole === "owner" || accountRole === "admin";

  const [items, setItems] = useState<QuickMessage[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("quick_messages")
      .select("id, name, body, position")
      .order("position")
      .order("created_at");
    if (error) {
      toast.error("No se pudieron cargar las plantillas");
      return;
    }
    setItems((data ?? []) as QuickMessage[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function insertVariable(token: string) {
    const el = bodyRef.current;
    setDraft((d) => {
      if (!d) return d;
      const start = el?.selectionStart ?? d.body.length;
      const end = el?.selectionEnd ?? d.body.length;
      const body = d.body.slice(0, start) + token + d.body.slice(end);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const caret = start + token.length;
        el.setSelectionRange(caret, caret);
      });
      return { ...d, body };
    });
  }

  async function save() {
    if (!draft || !accountId) return;
    const name = draft.name.trim();
    const body = draft.body.trim();
    if (!name || !body) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = draft.id
      ? await supabase
          .from("quick_messages")
          .update({ name, body, updated_at: new Date().toISOString() })
          .eq("id", draft.id)
      : await supabase.from("quick_messages").insert({
          account_id: accountId,
          name,
          body,
          position: items?.length ?? 0,
        });
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar la plantilla");
      return;
    }
    toast.success(draft.id ? "Plantilla actualizada" : "Plantilla creada");
    setDraft(null);
    load();
  }

  async function remove(item: QuickMessage) {
    if (!window.confirm(`¿Borrar la plantilla "${item.name}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("quick_messages")
      .delete()
      .eq("id", item.id);
    if (error) {
      toast.error("No se pudo borrar");
      return;
    }
    toast.success("Plantilla borrada");
    load();
  }

  async function move(index: number, delta: -1 | 1) {
    if (!items) return;
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    const supabase = createClient();
    await Promise.all(
      next.map((item, i) =>
        supabase.from("quick_messages").update({ position: i }).eq("id", item.id),
      ),
    );
    load();
  }

  const previewSource =
    draft?.body.trim() ||
    "Hola {{primer_nombre}}! Vi tu consulta por {{campaña}}. ¿Te paso la cotización?";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Mensajes rápidos
          </h1>
          <p className="text-sm text-muted-foreground">
            Plantillas que abren WhatsApp con el texto listo para mandar.
          </p>
        </div>
        {canManage && !draft && (
          <Button size="sm" onClick={() => setDraft(EMPTY_DRAFT)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nueva plantilla
          </Button>
        )}
      </div>

      {canManage && draft && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="qm-name"
                  className="text-sm font-medium text-foreground"
                >
                  Nombre
                </label>
                <Input
                  id="qm-name"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, name: e.target.value } : d))
                  }
                  placeholder="Bienvenida"
                  maxLength={60}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="qm-body"
                  className="text-sm font-medium text-foreground"
                >
                  Mensaje
                </label>
                <Textarea
                  id="qm-body"
                  ref={bodyRef}
                  value={draft.body}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, body: e.target.value } : d))
                  }
                  placeholder={
                    "Hola {{primer_nombre}}! Vi tu consulta por {{campaña}}…"
                  }
                  rows={6}
                />
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-xs text-muted-foreground">
                    Variables:
                  </span>
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onClick={() => insertVariable(v.token)}
                      title={`Insertar ${v.token} (ej.: ${v.example})`}
                      className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                Vista previa
              </span>
              <div className="flex flex-1 flex-col justify-end rounded-lg border border-border bg-muted/40 p-4">
                <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-foreground">
                  {renderQuickMessage(previewSource, PREVIEW_VARS)}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Con datos de ejemplo: {PREVIEW_VARS.nombre} ·{" "}
                {PREVIEW_VARS.campania}
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !draft.name.trim() || !draft.body.trim()}
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {draft.id ? "Guardar cambios" : "Crear plantilla"}
            </Button>
          </div>
        </div>
      )}

      {items === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 && !draft ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MessagesSquare className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            Todavía no hay mensajes rápidos
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Creá plantillas como “Bienvenida” o “Falta documentación” y
            mandalas en dos toques desde el botón de WhatsApp de cada lead.
          </p>
          {canManage && (
            <Button
              size="sm"
              className="mt-4"
              onClick={() => setDraft(EMPTY_DRAFT)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Crear la primera
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {item.name}
                </div>
                <div className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                  {item.body}
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Subir"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Bajar"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setDraft({ id: item.id, name: item.name, body: item.body })
                    }
                    aria-label="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(item)}
                    aria-label="Borrar"
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
