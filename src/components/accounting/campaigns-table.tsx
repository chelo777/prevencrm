"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import type { CampaignRow } from "@/lib/accounting/types";
import { money } from "./format";

// Gasto de Meta por campaña. El interruptor decide si la campaña se MIDE:
// apagada no suma al gasto Meta ni carga costo a sus leads. Sirve para dejar
// fuera del cálculo las campañas viejas y medir solo la que está trayendo
// leads hoy.

export function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(campaign: CampaignRow, next: boolean) {
    setBusy(campaign.metaCampaignId);
    const res = await fetch(
      `/api/admin/accounting/campaigns/${encodeURIComponent(campaign.metaCampaignId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracked: next }),
      },
    );
    setBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? "No se pudo cambiar");
      return;
    }
    toast.success(next ? "Campaña medida" : "Campaña fuera del cálculo");
    router.refresh();
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
        Todavía no hay gasto de campañas. El cron lo trae de Meta cada pocos
        minutos.
      </div>
    );
  }

  const measured = campaigns.filter((c) => c.tracked).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Gasto de Meta por campaña
        </h2>
        <p className="text-xs text-muted-foreground">
          {measured} de {campaigns.length} se están midiendo. Las apagadas no
          suman al gasto ni al costo de las tandas.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaña</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Costo por lead</TableHead>
              <TableHead className="text-right">Medir</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow
                key={c.metaCampaignId}
                className={c.tracked ? "" : "opacity-50"}
              >
                <TableCell className="max-w-[22rem] truncate font-medium text-foreground">
                  {c.campaignName ?? c.metaCampaignId}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(c.spend ?? 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.leads}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.cpl == null ? "—" : money(c.cpl)}
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={c.tracked}
                    disabled={busy === c.metaCampaignId}
                    onCheckedChange={(v) => void toggle(c, Boolean(v))}
                    aria-label={`Medir ${c.campaignName ?? c.metaCampaignId}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
