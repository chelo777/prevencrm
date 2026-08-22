"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PERIOD_LABELS,
  PERIOD_OPTIONS,
  type PeriodPreset,
} from "@/lib/date-range";
import type { DateRange } from "@/lib/accounting/types";

// Filtro de período. Navega cambiando la URL (?periodo= o ?desde=&hasta=): el
// server component recalcula todo con el rango, así el link es compartible y
// recargable, y ninguna cuenta se hace en el cliente.

export function DateFilter({
  preset,
  range,
}: {
  preset: PeriodPreset;
  range: DateRange;
}) {
  const router = useRouter();
  const [since, setSince] = useState(range.since ?? "");
  const [until, setUntil] = useState(range.until ?? "");

  function goPreset(p: PeriodPreset) {
    setSince("");
    setUntil("");
    router.push(p === "todo" ? "/admin/contabilidad" : `/admin/contabilidad?periodo=${p}`);
  }

  function goCustom() {
    if (!since && !until) return;
    const sp = new URLSearchParams();
    if (since) sp.set("desde", since);
    if (until) sp.set("hasta", until);
    router.push(`/admin/contabilidad?${sp}`);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <CalendarRange className="mr-0.5 size-4 text-muted-foreground" />
        {PERIOD_OPTIONS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={preset === p ? "default" : "outline"}
            onClick={() => goPreset(p)}
            className={preset === p ? "" : "border-border text-muted-foreground"}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">Rango:</span>
        <Input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          aria-label="Desde"
          className="h-8 w-auto bg-muted border-border text-foreground"
        />
        <span className="text-xs text-muted-foreground">a</span>
        <Input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          aria-label="Hasta"
          className="h-8 w-auto bg-muted border-border text-foreground"
        />
        <Button
          size="sm"
          onClick={goCustom}
          disabled={!since && !until}
          variant={preset === "custom" ? "default" : "outline"}
          className={preset === "custom" ? "" : "border-border"}
        >
          Aplicar
        </Button>
      </div>
    </div>
  );
}
