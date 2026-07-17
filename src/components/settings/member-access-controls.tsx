"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  PauseCircle,
  PlayCircle,
  SlidersHorizontal,
  Check,
  Inbox,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MODULES, DEFAULT_ASESOR_MODULES } from "@/lib/auth/modules";

// Controles admin por asesora (agent): qué módulos ve + pausar/reactivar
// su acceso. Owner/admin no se gatean, así que esto solo aparece en filas
// de agent/viewer. Toca RPCs SECURITY DEFINER vía /api/account/members.

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  inbox: "Inbox",
  notifications: "Notificaciones",
  leads: "Leads",
  "quick-messages": "Mensajes rápidos",
  contacts: "Contactos",
  pipelines: "Pipelines",
  broadcasts: "Difusiones",
  automations: "Automatizaciones",
  flows: "Flows",
};

export function MemberAccessControls({
  userId,
  name,
  allowedModules,
  blocked,
  receiving,
  leadCap,
  receivedThisCycle,
  onUpdated,
}: {
  userId: string;
  name: string;
  allowedModules: string[] | null;
  blocked: boolean;
  receiving: boolean;
  leadCap: number | null;
  receivedThisCycle: number;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const [capDraft, setCapDraft] = useState(
    leadCap != null ? String(leadCap) : "",
  );

  // null = default (['leads']). Lo materializamos para mostrar/editar.
  const current = allowedModules ?? DEFAULT_ASESOR_MODULES;

  // Sincronizar el input de cupo cuando llega un valor nuevo del server
  // (post-reload) y el usuario no está editando activamente.
  useEffect(() => {
    setCapDraft(leadCap != null ? String(leadCap) : "");
  }, [leadCap]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/account/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        toast.error(p.error || "No se pudo actualizar");
        return false;
      }
      onUpdated();
      return true;
    } catch {
      toast.error("No se pudo contactar el servidor");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleModule(slug: string) {
    const set = new Set(current);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    await patch({ allowed_modules: [...set] });
  }

  async function toggleBlocked() {
    const ok = await patch({ blocked: !blocked });
    if (ok) toast.success(blocked ? "Acceso reactivado" : "Acceso pausado");
  }

  async function toggleReceiving() {
    const ok = await patch({ receiving: !receiving });
    if (ok)
      toast.success(
        receiving ? "Dejó de recibir leads" : "Ahora recibe leads",
      );
  }

  async function resetCycle() {
    const ok = await patch({ reset_cycle: true });
    if (ok) toast.success("Tanda reiniciada");
  }

  async function commitCap() {
    const trimmed = capDraft.trim();
    if (trimmed === "") {
      const ok = await patch({ lead_cap: null });
      if (ok) toast.success("Cupo quitado (sin límite)");
      else setCapDraft(leadCap != null ? String(leadCap) : "");
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast.error("El cupo debe ser un entero ≥ 0, o vacío para sin límite");
      setCapDraft(leadCap != null ? String(leadCap) : "");
      return;
    }
    if (parsed === leadCap) return;
    const ok = await patch({ lead_cap: parsed });
    if (ok) toast.success(`Cupo actualizado a ${parsed}`);
    else setCapDraft(leadCap != null ? String(leadCap) : "");
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setModulesOpen(true)}
          disabled={busy}
          className="border-border text-muted-foreground hover:bg-muted"
        >
          <SlidersHorizontal className="size-3.5" />
          Módulos
          <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">
            {current.length}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleBlocked}
          disabled={busy}
          className={
            blocked
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
          }
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : blocked ? (
            <PlayCircle className="size-3.5" />
          ) : (
            <PauseCircle className="size-3.5" />
          )}
          {blocked ? "Reactivar" : "Pausar"}
        </Button>

        {/* Router de leads: recepción + cupo + recibidos. */}
        <Button
          variant="outline"
          size="sm"
          onClick={toggleReceiving}
          disabled={busy}
          className={
            receiving
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border-border text-muted-foreground hover:bg-muted"
          }
        >
          <Inbox className="size-3.5" />
          {receiving ? "Recibe leads" : "No recibe"}
        </Button>

        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Cupo:</span>
          <Input
            type="text"
            inputMode="numeric"
            value={capDraft}
            placeholder="sin límite"
            disabled={busy}
            onChange={(e) => setCapDraft(e.target.value)}
            onBlur={() => void commitCap()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-24 text-xs"
          />
        </div>

        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {receivedThisCycle}
          {leadCap != null ? `/${leadCap}` : ""} recibidos
          <button
            type="button"
            onClick={resetCycle}
            disabled={busy}
            title="Reiniciar tanda"
            className="ml-0.5 rounded-full p-0.5 hover:bg-background disabled:opacity-60"
          >
            <RotateCcw className="size-3" />
          </button>
        </span>
      </div>

      <Dialog open={modulesOpen} onOpenChange={setModulesOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Módulos de {name || "el asesor"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Tocá para mostrar u ocultar cada módulo. Los que no ve quedan
              escondidos y bloqueados por ruta.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 py-1">
            {MODULES.map((slug) => {
              const on = current.includes(slug);
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => toggleModule(slug)}
                  disabled={busy}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                    on
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {on && <Check className="size-3" />}
                  {MODULE_LABELS[slug] ?? slug}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
