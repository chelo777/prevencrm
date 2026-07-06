import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { ColumnMapping } from "@/lib/leads/types";

export const dynamic = "force-dynamic";

/**
 * Alta de una fuente de leads (una pestaña de una hoja de Google).
 * El wizard manda el columnMapping completo (canonical/custom/ignore/
 * statusToStage); el alta manual mínima sigue funcionando sin él.
 *
 * Body JSON: { name, spreadsheetId, sheetGid?, autoAssign?, columnMapping? }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json()) as {
      name?: string;
      kind?: "google_sheet" | "meta_api";
      spreadsheetId?: string;
      sheetGid?: string | null;
      metaPageId?: string;
      metaFormIds?: string[];
      autoAssign?: boolean;
      columnMapping?: ColumnMapping;
    };

    const kind = body.kind === "meta_api" ? "meta_api" : "google_sheet";
    const name = (body.name ?? "").trim();
    const spreadsheetId = (body.spreadsheetId ?? "").trim();
    const metaPageId = (body.metaPageId ?? "").trim();
    if (!name || (kind === "google_sheet" && !spreadsheetId)) {
      return NextResponse.json(
        { error: "name y spreadsheetId son obligatorios" },
        { status: 400 },
      );
    }
    if (kind === "meta_api" && !metaPageId) {
      return NextResponse.json(
        { error: "metaPageId es obligatorio para fuentes meta_api" },
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

    // Validar statusToStage: toda etapa debe pertenecer al pipeline.
    const mapping: ColumnMapping = body.columnMapping ?? {};
    const mappedStageIds = Object.values(mapping.statusToStage ?? {});
    if (mappedStageIds.length > 0) {
      const { data: valid } = await ctx.supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", pipelineId)
        .in("id", mappedStageIds);
      const validIds = new Set((valid ?? []).map((s) => s.id as string));
      const invalid = mappedStageIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: "statusToStage contiene etapas que no son del pipeline de leads" },
          { status: 400 },
        );
      }
    }

    const { data: source, error: insErr } = await ctx.supabase
      .from("lead_sources")
      .insert({
        account_id: ctx.accountId,
        owner_user_id: ctx.userId,
        name,
        kind,
        spreadsheet_id: kind === "google_sheet" ? spreadsheetId : null,
        sheet_gid: kind === "google_sheet" ? (body.sheetGid ?? null) : null,
        meta_page_id: kind === "meta_api" ? metaPageId : null,
        meta_form_ids: kind === "meta_api" ? (body.metaFormIds ?? []) : [],
        column_mapping: mapping,
        pipeline_id: pipelineId,
        default_stage_id: stage.id,
        auto_assign: body.autoAssign ?? true,
      })
      .select("id, name")
      .single();
    if (insErr) {
      if (insErr.code === "23505") {
        return NextResponse.json(
          {
            error:
              kind === "meta_api"
                ? "Esa página ya tiene una fuente activa en esta cuenta"
                : "Esa pestaña ya tiene una fuente activa en esta cuenta",
          },
          { status: 409 },
        );
      }
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
