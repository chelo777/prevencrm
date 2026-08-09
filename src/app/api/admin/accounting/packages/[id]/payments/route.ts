// ============================================================
// POST /api/admin/accounting/packages/[id]/payments — registrar un pago.
//
// Admin+. Un pago que EXCEDE el saldo se acepta (queda como saldo a favor,
// balance negativo): la confirmación es del lado del panel, el servidor no
// bloquea. Se permiten pagos sobre tandas canceladas — devoluciones y ajustes
// existen y el historial tiene que reflejarlos.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createAccountingRepository } from "@/lib/accounting/repository";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:payCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      paidOn?: unknown;
      amount?: unknown;
      note?: unknown;
    } | null;

    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "El monto debe ser mayor a 0" },
        { status: 400 },
      );
    }
    const paidOn =
      typeof body?.paidOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn)
        ? body.paidOn
        : null;
    if (!paidOn) {
      return NextResponse.json(
        { error: "Fecha de pago inválida (AAAA-MM-DD)" },
        { status: 400 },
      );
    }
    const note =
      typeof body?.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 500)
        : null;

    const repo = createAccountingRepository(ctx.supabase, ctx.accountId);
    // La tanda tiene que existir EN ESTA CUENTA: lead_package_payments no
    // tiene account_id, así que este chequeo es el que impide colgar un pago
    // de una tanda ajena (además de la RLS por el paquete padre).
    const pkg = (await repo.listPackages()).find((p) => p.id === id);
    if (!pkg) {
      return NextResponse.json({ error: "Tanda no encontrada" }, { status: 404 });
    }

    const payment = await repo.createPayment({
      packageId: id,
      paidOn,
      amount,
      note,
    });
    return NextResponse.json({ payment }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
