"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  BuyerTotals,
  CampaignRow,
  DateRange,
  GlobalTotals,
  PackageMetrics,
  PackagePayment,
  PaymentStatus,
} from "@/lib/accounting/types";
import { NewPackageDialog, PaymentDialog, type BuyerOption } from "./package-dialogs";
import { CampaignsTable } from "./campaigns-table";
import { DateFilter } from "./date-filter";
import type { PeriodPreset } from "@/lib/accounting/date-range";
import { fmtDate, money, pct } from "./format";

// Panel de contabilidad. Recibe TODO calculado del server component: acá no se
// hace ninguna cuenta de plata, solo se muestra y se disparan las acciones
// contra /api/admin/accounting.

const STATUS_STYLE: Record<PaymentStatus, string> = {
  PAGADO: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  PARCIAL: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  DEBE: "border-red-500/30 bg-red-500/10 text-red-400",
};

function StatusChip({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
        ? "text-red-400"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function AccountingPanel({
  totals,
  buyerTotals,
  packages,
  payments,
  buyers,
  campaigns,
  preset,
  range,
  periodLabel,
}: {
  totals: GlobalTotals;
  buyerTotals: BuyerTotals[];
  packages: PackageMetrics[];
  payments: PackagePayment[];
  buyers: BuyerOption[];
  campaigns: CampaignRow[];
  preset: PeriodPreset;
  range: DateRange;
  periodLabel: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [payFor, setPayFor] = useState<PackageMetrics | null>(null);

  const nameOf = useMemo(
    () => new Map(buyers.map((b) => [b.userId, b.name])),
    [buyers],
  );
  const packagesByBuyer = useMemo(() => {
    const map = new Map<string, PackageMetrics[]>();
    for (const p of packages) {
      const list = map.get(p.buyerUserId);
      if (list) list.push(p);
      else map.set(p.buyerUserId, [p]);
    }
    return map;
  }, [packages]);
  const paymentsByPackage = useMemo(() => {
    const map = new Map<string, PackagePayment[]>();
    for (const p of payments) {
      const list = map.get(p.packageId);
      if (list) list.push(p);
      else map.set(p.packageId, [p]);
    }
    return map;
  }, [payments]);

  async function cancelPackage(pkg: PackageMetrics) {
    if (
      !window.confirm(
        `¿Cancelar la tanda #${pkg.ordinal}? Sale de lo que hay a cobrar; los pagos registrados se conservan.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/accounting/packages/${pkg.packageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? "No se pudo cancelar");
      return;
    }
    toast.success("Tanda cancelada");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Contabilidad</h1>
          <p className="text-sm text-muted-foreground">
            Tandas, pagos y margen —{" "}
            <span className="text-foreground">{periodLabel}</span>
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="mr-1.5 size-4" />
          Nueva tanda
        </Button>
      </div>

      <DateFilter preset={preset} range={range} />

      {/* Totales globales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="A cobrar" value={money(totals.toCollect)} />
        <StatCard label="Cobrado" value={money(totals.collected)} tone="positive" />
        <StatCard
          label="Adeudado"
          value={money(totals.owed)}
          tone={totals.owed > 0 ? "negative" : undefined}
        />
        <StatCard
          label="Gasto Meta"
          value={money(totals.metaSpend)}
          hint="Campañas medidas"
        />
        <StatCard
          label="Costo por lead"
          value={totals.costPerLead == null ? "—" : money(totals.costPerLead)}
          hint={`${totals.trackedLeads} leads medidos`}
        />
        <StatCard
          label="Margen"
          value={money(totals.margin)}
          hint="A cobrar − gasto Meta"
          tone={totals.margin >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Compradoras */}
      {buyerTotals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-4 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
            <Wallet className="size-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            Todavía no hay tandas cargadas
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Creá la primera tanda para empezar a llevar la cuenta de lo comprado,
            lo pagado y el margen.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setNewOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            Nueva tanda
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Asesora</TableHead>
                <TableHead className="text-right">Tandas</TableHead>
                <TableHead className="text-right">Comprado</TableHead>
                <TableHead className="text-right">Pagado</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buyerTotals.map((b) => {
                const isOpen = expanded === b.buyerUserId;
                const pkgs = packagesByBuyer.get(b.buyerUserId) ?? [];
                return (
                  <Fragment key={b.buyerUserId}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() =>
                        setExpanded(isOpen ? null : b.buyerUserId)
                      }
                    >
                      <TableCell className="text-muted-foreground">
                        {isOpen ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {nameOf.get(b.buyerUserId) ?? b.buyerUserId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.packages}
                        {b.openPackages > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({b.openPackages} abierta{b.openPackages > 1 ? "s" : ""})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(b.totalPurchased)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(b.totalPaid)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          b.balance > 0 ? "text-red-400" : "text-emerald-500"
                        }`}
                      >
                        {money(b.balance)}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={b.paymentStatus} />
                      </TableCell>
                    </TableRow>

                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30 p-0">
                          <div className="flex flex-col gap-3 p-4">
                            {pkgs.map((pkg) => {
                              const pays =
                                paymentsByPackage.get(pkg.packageId) ?? [];
                              return (
                                <div
                                  key={pkg.packageId}
                                  className="rounded-lg border border-border bg-card p-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-foreground">
                                        Tanda #{pkg.ordinal}
                                      </span>
                                      <StatusChip status={pkg.paymentStatus} />
                                      {pkg.status !== "open" && (
                                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                                          {pkg.status === "cancelled"
                                            ? "Cancelada"
                                            : "Completada"}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setPayFor(pkg)}
                                        className="border-border"
                                      >
                                        <Wallet className="mr-1.5 size-3.5" />
                                        Pago
                                      </Button>
                                      {pkg.status === "open" && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => cancelPackage(pkg)}
                                          className="text-muted-foreground hover:text-red-400"
                                        >
                                          <XCircle className="mr-1.5 size-3.5" />
                                          Cancelar
                                        </Button>
                                      )}
                                    </div>
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                                    <Field
                                      label="Precio"
                                      value={`${money(pkg.price)} · ${money(pkg.pricePerLead)}/dato`}
                                    />
                                    <Field
                                      label="Entregados"
                                      value={`${pkg.delivered}/${pkg.leadsTarget} (${pct(pkg.deliveredPct)})`}
                                    />
                                    <Field
                                      label="Pagado"
                                      value={`${money(pkg.paid)} (${pct(pkg.paidPct)})`}
                                    />
                                    <Field
                                      label="Saldo"
                                      value={money(pkg.balance)}
                                      tone={
                                        pkg.balance > 0 ? "negative" : "positive"
                                      }
                                    />
                                    <Field
                                      label="Costo Meta"
                                      value={money(pkg.metaCost)}
                                    />
                                    <Field
                                      label="Margen"
                                      value={money(pkg.margin)}
                                      tone={
                                        pkg.margin >= 0 ? "positive" : "negative"
                                      }
                                    />
                                    <Field
                                      label="Compromiso"
                                      value={fmtDate(pkg.committedAt)}
                                    />
                                    <Field
                                      label="Creada"
                                      value={fmtDate(pkg.createdAt.slice(0, 10))}
                                    />
                                  </div>

                                  {pays.length > 0 && (
                                    <div className="mt-3 border-t border-border pt-2">
                                      <div className="text-xs font-medium text-muted-foreground">
                                        Pagos
                                      </div>
                                      <ul className="mt-1 flex flex-col gap-0.5">
                                        {pays.map((p) => (
                                          <li
                                            key={p.id}
                                            className="flex items-center justify-between gap-3 text-xs"
                                          >
                                            <span className="text-muted-foreground">
                                              {fmtDate(p.paidOn)}
                                              {p.note && ` · ${p.note}`}
                                            </span>
                                            <span className="tabular-nums text-foreground">
                                              {money(p.amount)}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CampaignsTable campaigns={campaigns} />

      <NewPackageDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        buyers={buyers}
      />
      <PaymentDialog
        open={payFor !== null}
        onOpenChange={(o) => !o && setPayFor(null)}
        packageId={payFor?.packageId ?? null}
        packageLabel={
          payFor
            ? `${nameOf.get(payFor.buyerUserId) ?? ""} — tanda #${payFor.ordinal}`
            : ""
        }
        balance={payFor?.balance ?? 0}
      />
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
        ? "text-red-400"
        : "text-foreground";
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
