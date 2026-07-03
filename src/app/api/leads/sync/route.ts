import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  createLeadRepository,
  loadActiveGoogleSheetSources,
  recordSyncRun,
  type SyncRunTotals,
} from "@/lib/leads/repository";
import { fetchSheetRows } from "@/lib/leads/google-sheets";
import { createLeadMapper } from "@/lib/leads/mapping";
import { ingestLead } from "@/lib/leads/ingest";
import { reconcileAllCapi } from "@/lib/leads/capi";

// Node runtime: usamos node:crypto (JWT de Google + SHA-256 de CAPI).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron de ingesta de leads de Meta (Fase 1 = Google Sheets) + feedback
 * CAPI. Pensado para un schedule (Vercel Cron / pinger). Protegido por
 * `x-cron-secret` contra LEADS_CRON_SECRET (cae a AUTOMATION_CRON_SECRET
 * para reusar el que ya exista). Copia el patrón de
 * src/app/api/automations/cron/route.ts.
 *
 * Relee el rango completo de cada hoja cada vez (sin watermark, B2);
 * la idempotencia la garantiza el claim sobre meta_lead_id.
 */
export async function GET(request: Request) {
  const expected =
    process.env.LEADS_CRON_SECRET ?? process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();

  let sources;
  try {
    sources = await loadActiveGoogleSheetSources(admin);
  } catch (err) {
    console.error("[leads/sync] no se pudieron cargar las fuentes:", err);
    return NextResponse.json({ error: "could not load sources" }, { status: 500 });
  }

  const perSource: Array<{ source: string } & SyncRunTotals> = [];

  for (const source of sources) {
    const startedAt = new Date().toISOString();
    const totals: SyncRunTotals = {
      rowsRead: 0,
      claimed: 0,
      processed: 0,
      quarantined: 0,
      stageSynced: 0,
      errors: 0,
      ok: true,
    };

    try {
      if (!source.spreadsheetId) {
        throw new Error("fuente sin spreadsheet_id");
      }
      const raw = await fetchSheetRows(source.spreadsheetId, source.sheetGid);
      totals.rowsRead = raw.rows.length;

      const { mapRow } = createLeadMapper(raw, source.columnMapping);
      const repo = createLeadRepository(admin, source);

      for (const row of raw.rows) {
        try {
          const { lead, error } = mapRow(row);
          if (error || !lead) {
            const obj: Record<string, string> = {};
            raw.headers.forEach((h, i) => {
              obj[h || `col_${i}`] = (row[i] ?? "").trim();
            });
            await repo.quarantine(obj, error ?? "fila no mapeable");
            totals.quarantined++;
            continue;
          }
          const result = await ingestLead(repo, lead, {
            autoAssign: source.autoAssign,
            statusToStage: source.columnMapping.statusToStage,
          });
          if (result.outcome === "processed") {
            totals.claimed++;
            totals.processed++;
          } else if (result.outcome === "resumed") {
            totals.processed++;
          } else if (result.outcome === "stage_synced") {
            totals.stageSynced++;
          }
          // "skipped_duplicate" -> ya estaba, no cuenta.
        } catch (rowErr) {
          totals.errors++;
          console.error("[leads/sync] error en fila:", rowErr);
        }
      }
    } catch (srcErr) {
      totals.ok = false;
      totals.message =
        srcErr instanceof Error ? srcErr.message : String(srcErr);
      console.error(`[leads/sync] error en fuente ${source.id}:`, srcErr);
    }

    await recordSyncRun(admin, source.accountId, source.id, startedAt, totals);
    perSource.push({ source: source.name, ...totals });
  }

  // Feedback de conversión a Meta (idempotente).
  let capi = { candidates: 0, sent: 0, failed: 0, skipped: 0 };
  try {
    capi = await reconcileAllCapi(admin);
  } catch (capiErr) {
    console.error("[leads/sync] error en reconciliación CAPI:", capiErr);
  }

  return NextResponse.json({ sources: perSource, capi });
}
