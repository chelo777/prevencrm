// ============================================================
// GET /api/account/members
//
// ADMIN+ ONLY. Devuelve el roster del equipo. Un agent/viewer NO debe
// saber quiénes son sus compañeros (compradores de datos), así que el
// endpoint entero es admin — no solo el tab de la UI (si no, un agente
// podría leer el roster por la API directamente).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  allowed_modules: string[] | null;
  blocked: boolean | null;
  receiving_leads: boolean | null;
  lead_cap: number | null;
  receiving_since: string | null;
}

type MemberOut = AccountMember & {
  allowed_modules: string[] | null;
  blocked: boolean;
  receiving_leads: boolean;
  lead_cap: number | null;
  received_this_cycle: number;
};

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select(
        "user_id, full_name, email, avatar_url, account_role, created_at, allowed_modules, blocked, receiving_leads, lead_cap, receiving_since",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const profileRows = data as ProfileRow[];

    const canSeeEmails = canManageMembers(ctx.role);

    // "Recibidos en la tanda" es derivado de activity_log (lead_assigned −
    // lead_reclaimed desde receiving_since de cada miembro), no una columna
    // mutable. Esta información es confidencial (admin-only): un no-admin no
    // debería ver la carga de sus compañeros.
    //
    // Se cuenta con `count: "exact", head: true` por miembro (igual que el
    // router en listEligibleAgents) y NO trayendo las filas: PostgREST corta
    // en 1000 filas por request, y traer todo el historial de la cuenta sin
    // filtrar devolvía sólo las más viejas — todas anteriores a
    // receiving_since — y el contador quedaba clavado en 0.
    const receivedByUser = new Map<string, number>();

    if (canSeeEmails) {
      const countSince = async (
        userId: string,
        action: "lead_assigned" | "lead_reclaimed",
        since: string,
      ): Promise<number> => {
        const { count, error: countError } = await ctx.supabase
          .from("activity_log")
          .select("id", { count: "exact", head: true })
          .eq("account_id", ctx.accountId)
          .eq("user_id", userId)
          .eq("action", action)
          .gte("created_at", since);
        if (countError) throw countError;
        return count ?? 0;
      };

      try {
        await Promise.all(
          profileRows
            .filter((row) => row.receiving_since)
            .map(async (row) => {
              const since = row.receiving_since as string;
              const [assigned, reclaimed] = await Promise.all([
                countSince(row.user_id, "lead_assigned", since),
                countSince(row.user_id, "lead_reclaimed", since),
              ]);
              receivedByUser.set(row.user_id, Math.max(0, assigned - reclaimed));
            }),
        );
      } catch (activityError) {
        console.error(
          "[GET /api/account/members] activity_log count error:",
          activityError,
        );
        return NextResponse.json(
          { error: "Failed to load members" },
          { status: 500 },
        );
      }
    }

    const members: MemberOut[] = profileRows.flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
          allowed_modules: row.allowed_modules ?? null,
          blocked: Boolean(row.blocked),
          receiving_leads: Boolean(row.receiving_leads),
          lead_cap: row.lead_cap,
          received_this_cycle: receivedByUser.get(row.user_id) ?? 0,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
