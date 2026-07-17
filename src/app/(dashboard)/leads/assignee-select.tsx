"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

// Reasignación inline desde la bandeja de leads (solo admin — la columna
// se renderiza únicamente para admin/owner). Mismo update optimista que el
// selector del panel de detalle: deals.assigned_agent_id bajo RLS (el
// admin puede update) + traza en activity_log (best-effort). Select nativo
// vestido como chip, con chevron para que se note editable.

export interface Asesora {
  user_id: string;
  full_name: string | null;
}

export function AssigneeSelect({
  dealId,
  accountId,
  initialAgentId,
  asesoras,
}: {
  dealId: string;
  accountId: string;
  initialAgentId: string | null;
  asesoras: Asesora[];
}) {
  const [agentId, setAgentId] = useState(initialAgentId ?? "");
  const [busy, setBusy] = useState(false);

  async function onChange(next: string) {
    const prev = agentId;
    if (next === prev) return;
    setAgentId(next); // optimista
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("deals")
      .update({ assigned_agent_id: next || null })
      .eq("id", dealId);
    if (error) {
      setAgentId(prev);
      setBusy(false);
      toast.error("No se pudo reasignar");
      return;
    }
    // Event log (append-only, best-effort; RLS exige user_id = auth.uid()).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      await supabase.from("activity_log").insert({
        account_id: accountId,
        user_id: uid,
        deal_id: dealId,
        action: "reassigned",
        meta: { assigned_agent_id: next || null },
      });
    }
    setBusy(false);
    toast.success("Lead reasignado");
  }

  return (
    <span className="relative inline-flex max-w-full items-center">
      <select
        value={agentId}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Reasignar lead"
        className="max-w-full cursor-pointer appearance-none truncate rounded-md border border-border bg-muted py-1.5 pl-2.5 pr-6 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 sm:py-1"
      >
        <option value="">Sin asignar</option>
        {asesoras.map((a) => (
          <option key={a.user_id} value={a.user_id}>
            {a.full_name || a.user_id.slice(0, 8)}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-muted-foreground"
      />
    </span>
  );
}
