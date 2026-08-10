'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type { CampaignRow } from '@/lib/accounting/types';
import { money } from './format';

// Gasto de Meta por campaña. El interruptor decide si la campaña se MIDE:
// apagada no suma al gasto Meta ni carga costo a sus leads. Sirve para dejar
// fuera del cálculo las campañas viejas y medir solo la que está trayendo
// leads hoy.
//
// Va plegada: es configuración que se toca poco y no tiene que competir con la
// contabilidad. El encabezado ya adelanta cuántas se miden.

export function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(campaign: CampaignRow, next: boolean) {
    setBusy(campaign.metaCampaignId);
    const res = await fetch(
      `/api/admin/accounting/campaigns/${encodeURIComponent(campaign.metaCampaignId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracked: next }),
      }
    );
    setBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? 'No se pudo cambiar');
      return;
    }
    toast.success(next ? 'Campaña medida' : 'Campaña fuera del cálculo');
    router.refresh();
  }

  if (campaigns.length === 0) {
    return (
      <div className="border-border bg-muted/40 text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
        Todavía no hay gasto de campañas. El cron lo trae de Meta cada pocos
        minutos.
      </div>
    );
  }

  const measured = campaigns.filter((c) => c.tracked).length;

  return (
    <Accordion className="border-border bg-card rounded-xl border px-4">
      <AccordionItem className="border-none">
        <AccordionTrigger className="text-foreground hover:no-underline">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left">
            <span className="text-sm font-semibold">
              Gasto de Meta por campaña
            </span>
            <span className="text-muted-foreground text-xs font-normal">
              {measured} de {campaigns.length} midiéndose
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-muted-foreground pb-2 text-xs">
            Las campañas apagadas no suman al gasto ni al costo de las tandas.
          </p>
          <div className="border-border overflow-x-auto rounded-lg border">
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
                    className={c.tracked ? '' : 'opacity-50'}
                  >
                    <TableCell className="text-foreground max-w-[22rem] truncate font-medium">
                      {c.campaignName ?? c.metaCampaignId}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(c.spend ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.leads}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.cpl == null ? '—' : money(c.cpl)}
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
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
