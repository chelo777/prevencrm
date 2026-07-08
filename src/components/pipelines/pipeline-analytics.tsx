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
          label="Total Deals"
          value={String(stats.totalCount)}
          tooltip="Count of every deal in this pipeline that isn't marked as Lost. Won deals are still included."
        />
        <Metric
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label="Open Deals"
          value={String(stats.openCount)}
          tooltip="Deals still in play — not marked as Won or Lost."
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          label="New Today"
          value={String(stats.newToday)}
          tooltip="Deals created since midnight — the day's incoming flow."
        />
        <Metric
          icon={<Calendar className="h-4 w-4 text-purple-400" />}
          label="New This Month"
          value={String(stats.newThisMonth)}
          tooltip="Deals created since the first day of the current month."
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label="Won This Month"
          value={String(stats.wonThisMonth)}
          tooltip="Deals marked as Won since the first day of the current month."
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label="Lost This Month"
          value={String(stats.lostThisMonth)}
          tooltip="Deals marked as Lost since the first day of the current month."
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
                aria-label={`How ${label} is calculated`}
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
