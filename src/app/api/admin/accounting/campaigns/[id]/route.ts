// ============================================================
// PATCH /api/admin/accounting/campaigns/[id] — medir o no una campaña.
//
// Admin+. `[id]` es el meta_campaign_id. Con tracked=false la campaña deja de
// sumar al gasto Meta y sus leads dejan de cargar costo prorrateado (sirve
// para sacar del cálculo las campañas muertas del histórico).
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createAccountingRepository } from "@/lib/accounting/repository";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:campaignTrack:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      tracked?: unknown;
    } | null;

    if (typeof body?.tracked !== "boolean") {
      return NextResponse.json(
        { error: "tracked debe ser true o false" },
        { status: 400 },
      );
    }

    const repo = createAccountingRepository(ctx.supabase, ctx.accountId);
    await repo.setCampaignTracked(id, body.tracked);
    return NextResponse.json({ ok: true, tracked: body.tracked });
  } catch (err) {
    return toErrorResponse(err);
  }
}
