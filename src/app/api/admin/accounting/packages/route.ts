// ============================================================
// POST /api/admin/accounting/packages — alta de tanda.
//
// Admin+. La RLS de lead_packages ya es admin-only; el requireRole corta
// antes y da un 403 legible en vez de un insert que devuelve 0 filas.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createAccountingRepository } from "@/lib/accounting/repository";
import { createPackage } from "@/lib/accounting/service";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:pkgCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      buyerUserId?: unknown;
      leadsTarget?: unknown;
      price?: unknown;
      committedAt?: unknown;
    } | null;

    const buyerUserId = body?.buyerUserId;
    const leadsTarget = Number(body?.leadsTarget);
    const price = Number(body?.price);
    const committedAt =
      typeof body?.committedAt === "string" && body.committedAt
        ? body.committedAt
        : null;

    if (typeof buyerUserId !== "string" || !buyerUserId) {
      return NextResponse.json({ error: "Elegí una asesora" }, { status: 400 });
    }
    if (!Number.isInteger(leadsTarget) || leadsTarget <= 0) {
      return NextResponse.json(
        { error: "La cantidad de datos debe ser un entero mayor a 0" },
        { status: 400 },
      );
    }
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
    }

    // El comprador tiene que ser miembro de ESTA cuenta (evita colgar una
    // tanda de un user_id de otra cuenta).
    const { data: member } = await ctx.supabase
      .from("profiles")
      .select("user_id")
      .eq("account_id", ctx.accountId)
      .eq("user_id", buyerUserId)
      .maybeSingle();
    if (!member) {
      return NextResponse.json(
        { error: "Esa asesora no pertenece a la cuenta" },
        { status: 400 },
      );
    }

    const repo = createAccountingRepository(ctx.supabase, ctx.accountId);
    const pkg = await createPackage(repo, {
      buyerUserId,
      leadsTarget,
      price,
      committedAt,
    });

    return NextResponse.json({ package: pkg }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
