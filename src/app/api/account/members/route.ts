// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
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

interface ActivityLogRow {
  user_id: string;
  action: string;
  created_at: string;
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
    const ctx = await getCurrentAccount();

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

    // "Recibidos en la tanda" es derivado de activity_log (lead_assigned −
    // lead_reclaimed desde receiving_since de cada miembro), no una columna
    // mutable. Una sola query trae todo el historial relevante de la cuenta
    // y se agrega en memoria por user_id — pocos miembros por cuenta, así
    // que esto evita N+1 sin necesitar un `since` distinto por fila.
    const { data: activityRows, error: activityError } = await ctx.supabase
      .from("activity_log")
      .select("user_id, action, created_at")
      .eq("account_id", ctx.accountId)
      .in("action", ["lead_assigned", "lead_reclaimed"]);

    if (activityError) {
      console.error(
        "[GET /api/account/members] activity_log fetch error:",
        activityError,
      );
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const activityByUser = new Map<string, ActivityLogRow[]>();
    for (const row of activityRows as ActivityLogRow[]) {
      const list = activityByUser.get(row.user_id);
      if (list) {
        list.push(row);
      } else {
        activityByUser.set(row.user_id, [row]);
      }
    }

    function receivedThisCycle(
      userId: string,
      receivingSince: string | null,
    ): number {
      if (!receivingSince) return 0;
      const since = new Date(receivingSince).getTime();
      const rows = activityByUser.get(userId);
      if (!rows) return 0;
      let assigned = 0;
      let reclaimed = 0;
      for (const row of rows) {
        if (new Date(row.created_at).getTime() < since) continue;
        if (row.action === "lead_assigned") assigned += 1;
        else if (row.action === "lead_reclaimed") reclaimed += 1;
      }
      return assigned - reclaimed;
    }

    const canSeeEmails = canManageMembers(ctx.role);

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
          received_this_cycle: receivedThisCycle(
            row.user_id,
            row.receiving_since,
          ),
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
