import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

/**
 * Alta de una fuente de leads (una hoja de Google). Seed manual (el
 * asistente visual es Fase 2). Asegura el pipeline "Leads Prepaga" y
 * crea la fila en lead_sources apuntando a su etapa "Nuevo".
 *
 * Body JSON: { name, spreadsheetId, sheetGid?, autoAssign? }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json()) as {
      name?: string;
      spreadsheetId?: string;
      sheetGid?: string | null;
      autoAssign?: boolean;
    };

    const name = (body.name ?? "").trim();
    const spreadsheetId = (body.spreadsheetId ?? "").trim();
    if (!name || !spreadsheetId) {
      return NextResponse.json(
        { error: "name y spreadsheetId son obligatorios" },
        { status: 400 },
      );
    }

    // Asegura (idempotente) el pipeline "Leads Prepaga" + etapas.
    const { data: pipelineId, error: rpcErr } = await ctx.supabase.rpc(
      "ensure_leads_prepaga_pipeline",
      { p_account_id: ctx.accountId, p_user_id: ctx.userId },
    );
    if (rpcErr || !pipelineId) {
      console.error("[leads/sources] ensure pipeline error:", rpcErr);
      return NextResponse.json(
        { error: "no se pudo preparar el pipeline" },
        { status: 500 },
      );
    }

    // Etapa inicial "Nuevo".
    const { data: stage, error: stageErr } = await ctx.supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("name", "Nuevo")
      .maybeSingle();
    if (stageErr || !stage) {
      return NextResponse.json(
        { error: "no se encontró la etapa inicial" },
        { status: 500 },
      );
    }

    const { data: source, error: insErr } = await ctx.supabase
      .from("lead_sources")
      .insert({
        account_id: ctx.accountId,
        owner_user_id: ctx.userId,
        name,
        kind: "google_sheet",
        spreadsheet_id: spreadsheetId,
        sheet_gid: body.sheetGid ?? null,
        pipeline_id: pipelineId,
        default_stage_id: stage.id,
        auto_assign: body.autoAssign ?? true,
      })
      .select("id, name")
      .single();
    if (insErr) {
      console.error("[leads/sources] insert error:", insErr);
      return NextResponse.json(
        { error: "no se pudo crear la fuente" },
        { status: 500 },
      );
    }

    return NextResponse.json({ source }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
