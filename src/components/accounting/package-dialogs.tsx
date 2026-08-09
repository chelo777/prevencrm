"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money } from "./format";

// Diálogos de alta de tanda y de registro de pago. Toda la escritura pasa por
// las rutas /api/admin/accounting (requireRole('admin')); estos componentes
// nunca tocan Supabase directamente.

export interface BuyerOption {
  userId: string;
  name: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function NewPackageDialog({
  open,
  onOpenChange,
  buyers,
  defaultBuyerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buyers: BuyerOption[];
  defaultBuyerId?: string;
}) {
  const router = useRouter();
  const [buyerUserId, setBuyerUserId] = useState(defaultBuyerId ?? "");
  const [leadsTarget, setLeadsTarget] = useState("50");
  const [price, setPrice] = useState("300000");
  const [committedAt, setCommittedAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!buyerUserId) {
      toast.error("Elegí una asesora");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/accounting/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyerUserId,
        leadsTarget: Number(leadsTarget),
        price: Number(price),
        committedAt: committedAt || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? "No se pudo crear la tanda");
      return;
    }
    toast.success("Tanda creada");
    onOpenChange(false);
    router.refresh();
  }

  const perLead =
    Number(price) > 0 && Number(leadsTarget) > 0
      ? Number(price) / Number(leadsTarget)
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Nueva tanda</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Registrá una compra de datos. El número de tanda se asigna solo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground">Asesora</Label>
            <Select value={buyerUserId} onValueChange={(v) => v && setBuyerUserId(v)}>
              <SelectTrigger className="w-full bg-muted border-border text-foreground">
                <SelectValue placeholder="Elegir…" />
              </SelectTrigger>
              <SelectContent>
                {buyers.map((b) => (
                  <SelectItem key={b.userId} value={b.userId}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground">Cantidad de datos</Label>
              <Input
                type="number"
                min={1}
                value={leadsTarget}
                onChange={(e) => setLeadsTarget(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground">Precio total (ARS)</Label>
              <Input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Precio por dato: <span className="text-foreground">{money(perLead)}</span>
          </p>

          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground">
              Fecha comprometida de pago (opcional)
            </Label>
            <Input
              type="date"
              value={committedAt}
              onChange={(e) => setCommittedAt(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-popover-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Crear tanda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentDialog({
  open,
  onOpenChange,
  packageId,
  packageLabel,
  balance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId: string | null;
  packageLabel: string;
  balance: number;
}) {
  const router = useRouter();
  const [paidOn, setPaidOn] = useState(today());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Pago que excede el saldo: se acepta, pero pedimos confirmación explícita
  // (queda como saldo a favor). El servidor no bloquea.
  const excess = Number(amount) > 0 && Number(amount) > balance;

  async function submit() {
    if (!packageId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    if (
      excess &&
      !window.confirm(
        `El pago supera el saldo (${money(balance)}). Se va a registrar como saldo a favor. ¿Confirmás?`,
      )
    ) {
      return;
    }
    setSaving(true);
    const res = await fetch(
      `/api/admin/accounting/packages/${packageId}/payments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidOn, amount: value, note: note || null }),
      },
    );
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? "No se pudo registrar el pago");
      return;
    }
    toast.success("Pago registrado");
    setAmount("");
    setNote("");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Registrar pago</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {packageLabel} — saldo actual{" "}
            <span className="text-foreground">{money(balance)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground">Fecha</Label>
              <Input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground">Monto (ARS)</Label>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>

          {excess && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
              El monto supera el saldo. Se registra igual y queda como saldo a favor.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground">Nota (opcional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Transferencia, efectivo, quién lo recibió…"
              rows={2}
              className="bg-muted border-border text-foreground resize-none"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-popover-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
