"use client";

import { useMemo } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  BarChart3,
  Calendar,
  Info,
  Target,
  TrendingUp,
  Trophy,
  XCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Métricas del pipeline SIN dinero: este CRM trabaja leads de planes
// de salud, no montos — todo se mide en cantidad de deals y ritmo de
// entrada (hoy / este mes) más los cierres por estado.

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
}

export function PipelineAnalytics({ deals }: PipelineAnalyticsProps) {
  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const createdSince = (d: Deal, since: Date) =>
      d.created_at ? new Date(d.created_at) >= since : false;
    const updatedThisMonth = (d: Deal) => {
      const ts = d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= monthStart : false;
    };

    return {
      totalCount: active.length,
      openCount: openDeals.length,
      newToday: deals.filter((d) => createdSince(d, dayStart)).length,
      newThisMonth: deals.filter((d) => createdSince(d, monthStart)).length,
      wonThisMonth: deals.filter(
        (d) => d.status === "won" && updatedThisMonth(d),
      ).length,
      lostThisMonth: deals.filter(
        (d) => d.status === "lost" && updatedThisMonth(d),
      ).length,
    };
  }, [deals]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          label="Deals totales"
          value={String(stats.totalCount)}
          tooltip="Todos los deals de este pipeline que no están marcados como perdidos. Los ganados cuentan."
        />
        <Metric
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label="Deals abiertos"
          value={String(stats.openCount)}
          tooltip="Deals todavía en juego — sin marcar como ganados ni perdidos."
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          label="Nuevos hoy"
          value={String(stats.newToday)}
          tooltip="Deals creados desde la medianoche — el flujo de entrada del día."
        />
        <Metric
          icon={<Calendar className="h-4 w-4 text-purple-400" />}
          label="Nuevos este mes"
          value={String(stats.newThisMonth)}
          tooltip="Deals creados desde el primer día del mes."
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label="Ganados este mes"
          value={String(stats.wonThisMonth)}
          tooltip="Deals marcados como ganados desde el primer día del mes."
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label="Perdidos este mes"
          value={String(stats.lostThisMonth)}
          tooltip="Deals marcados como perdidos desde el primer día del mes."
        />
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Cómo se calcula ${label}`}
                className="ml-auto text-muted-foreground hover:text-foreground focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
