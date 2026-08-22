// ============================================================
// PATCH  /api/admin/accounting/packages/[id] — editar o cancelar una tanda.
// DELETE /api/admin/accounting/packages/[id] — borrarla definitivamente.
//
// Admin+. Precio y cantidad SOLO se editan con la tanda `open` (una tanda
// completada o cancelada ya es historia contable: cambiarle el precio
// reescribiría el pasado).
//
// Cancelar vs. borrar: cancelar deja la tanda a la vista, anulada y fuera de
// las cuentas. Borrar la saca del sistema — es para limpiar una carga
// equivocada, no para dar de baja una operación real.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createAccountingRepository } from "@/lib/accounting/repository";
import { deletePackage } from "@/lib/accounting/service";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { PackageStatus, UpdatePackageInput } from "@/lib/accounting/types";

export const runtime = "nodejs";

const STATUSES: PackageStatus[] = ["open", "completed", "cancelled"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:pkgUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      leadsTarget?: unknown;
      price?: unknown;
      committedAt?: unknown;
      status?: unknown;
    } | null;

    const repo = createAccountingRepository(ctx.supabase, ctx.accountId);
    const current = (await repo.listPackages()).find((p) => p.id === id);
    if (!current) {
      return NextResponse.json({ error: "Tanda no encontrada" }, { status: 404 });
    }

    const patch: UpdatePackageInput = {};

    if (body?.status !== undefined) {
      if (typeof body.status !== "string" || !STATUSES.includes(body.status as PackageStatus)) {
        return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      }
      patch.status = body.status as PackageStatus;
    }

    const editsFinancials =
      body?.leadsTarget !== undefined ||
      body?.price !== undefined ||
      body?.committedAt !== undefined;

    if (editsFinancials) {
      if (current.status !== "open") {
        return NextResponse.json(
          { error: "Solo se puede editar una tanda abierta" },
          { status: 409 },
        );
      }
      if (body?.leadsTarget !== undefined) {
        const n = Number(body.leadsTarget);
        if (!Number.isInteger(n) || n <= 0) {
          return NextResponse.json(
            { error: "La cantidad de datos debe ser un entero mayor a 0" },
            { status: 400 },
          );
        }
        patch.leadsTarget = n;
      }
      if (body?.price !== undefined) {
        const n = Number(body.price);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
        }
        patch.price = n;
      }
      if (body?.committedAt !== undefined) {
        patch.committedAt =
          typeof body.committedAt === "string" && body.committedAt
            ? body.committedAt
            : null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }

    const updated = await repo.updatePackage(id, patch);
    return NextResponse.json({ package: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:pkgDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const repo = createAccountingRepository(ctx.supabase, ctx.accountId);

    // El servicio valida que exista y respeta el orden soltar-leads → borrar
    // (la FK de leads.package_id no cascadea).
    try {
      await deletePackage(repo, id);
    } catch (err) {
      if (err instanceof Error && err.message === "Tanda no encontrada") {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
