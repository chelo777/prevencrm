import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { fetchSheetRows } from "@/lib/leads/google-sheets";
import { createLeadMapper } from "@/lib/leads/mapping";
import { createLeadRepository } from "@/lib/leads/repository";
import { ingestLead } from "@/lib/leads/ingest";
import type { ColumnMapping, LeadSourceConfig } from "@/lib/leads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Import histórico (una vez por fuente). A diferencia del cron, ESTE
// sí usa la columna lead_status de la hoja para ubicar el deal en su
// etapa. Maneja el vocabulario mixto (nativo de Meta + manual).
// No auto-asigna (evita spamear notificaciones con el histórico).

const STATUS_TO_STAGE: Record<string, string> = {
  "": "Nuevo",
  created: "Nuevo",
  nuevo: "Nuevo",
  calificado: "Calificado",
  "no-calificado": "No-calificado",
  "no calificado": "No-calificado",
  cotizado: "Cotizado",
  perdido: "Perdido",
  "closed-won": "Closed-Won",
  "closed won": "Closed-Won",
  ganado: "Closed-Won",
};

function mapStatusToStage(raw: string | null): string {
  const key = (raw ?? "").trim().toLowerCase();
  return STATUS_TO_STAGE[key] ?? "Nuevo";
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const { sourceId } = (await request.json()) as { sourceId?: string };
    if (!sourceId) {
      return NextResponse.json({ error: "sourceId requerido" }, { status: 400 });
    }

    // Cargar la fuente (RLS admin) y validar que sea de esta cuenta.
    const { data: row } = await ctx.supabase
      .from("lead_sources")
      .select(
        "id, account_id, owner_user_id, name, spreadsheet_id, sheet_gid, column_mapping, pipeline_id, default_stage_id, auto_assign",
      )
      .eq("id", sourceId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!row || !row.spreadsheet_id) {
      return NextResponse.json({ error: "fuente no encontrada" }, { status: 404 });
    }

    const source: LeadSourceConfig = {
      id: row.id as string,
      accountId: row.account_id as string,
      ownerUserId: row.owner_user_id as string,
      name: row.name as string,
      spreadsheetId: row.spreadsheet_id as string,
      sheetGid: (row.sheet_gid as string | null) ?? null,
      columnMapping: (row.column_mapping as ColumnMapping) ?? {},
      pipelineId: row.pipeline_id as string,
      defaultStageId: row.default_stage_id as string,
      autoAssign: false,
    };

    // Mapa de nombre de etapa -> id, del pipeline destino.
    const { data: stages } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, name")
      .eq("pipeline_id", source.pipelineId);
    const stageByName = new Map<string, string>();
    for (const s of stages ?? []) stageByName.set(s.name as string, s.id as string);

    const admin = supabaseAdmin();
    const raw = await fetchSheetRows(source.spreadsheetId!, source.sheetGid);
    const { mapRow } = createLeadMapper(raw, source.columnMapping);
    const repo = createLeadRepository(admin, source);

    let imported = 0;
    let skipped = 0;
    let quarantined = 0;

    for (const r of raw.rows) {
      const { lead, error } = mapRow(r);
      if (error || !lead) {
        const obj: Record<string, string> = {};
        raw.headers.forEach((h, i) => (obj[h || `col_${i}`] = (r[i] ?? "").trim()));
        await repo.quarantine(obj, error ?? "fila no mapeable");
        quarantined++;
        continue;
      }
      const res = await ingestLead(repo, lead, { autoAssign: false });
      if (res.outcome === "skipped_duplicate") {
        skipped++;
        continue;
      }
      imported++;

      // Ubicar el deal en la etapa que dice el histórico.
      const stageName = mapStatusToStage(lead.statusRaw);
      const stageId = stageByName.get(stageName);
      if (stageId && res.leadId) {
        const { data: leadRow } = await admin
          .from("leads")
          .select("deal_id")
          .eq("id", res.leadId)
          .maybeSingle();
        if (leadRow?.deal_id) {
          await admin
            .from("deals")
            .update({ stage_id: stageId })
            .eq("id", leadRow.deal_id);
        }
      }
    }

    return NextResponse.json({ imported, skipped, quarantined, rows: raw.rows.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
