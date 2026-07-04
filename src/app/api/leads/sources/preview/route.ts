import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  fetchSheetRows,
  fetchSpreadsheetTabs,
  getServiceAccountEmail,
} from "@/lib/leads/google-sheets";
import { suggestMapping } from "@/lib/leads/mapping";
import { parseSheetUrl } from "@/lib/leads/sheet-url";

// Node runtime: JWT de Google usa node:crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview para el wizard de fuentes: pestañas del documento + headers,
 * muestras y sugerencias de mapeo de la pestaña elegida. Solo lectura,
 * salvo el ensure (idempotente) del pipeline destino, necesario para
 * ofrecer las etapas en el paso de estados.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return NextResponse.json(
        { error: "GOOGLE_SERVICE_ACCOUNT_JSON no está configurada en el servidor" },
        { status: 503 },
      );
    }
    const body = (await request.json()) as { url?: string; gid?: string | null };
    const { spreadsheetId, gid: urlGid } = parseSheetUrl(body.url ?? "");
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "URL de Google Sheets inválida" },
        { status: 400 },
      );
    }

    let tabs;
    try {
      tabs = await fetchSpreadsheetTabs(spreadsheetId);
    } catch (err) {
      console.error("[leads/preview] error leyendo la planilla:", err);
      const msg = err instanceof Error ? err.message : String(err);
      // Config del service account rota: JSON truncado/multilínea o incompleto.
      if (err instanceof SyntaxError || msg.includes("GOOGLE_SERVICE_ACCOUNT_JSON")) {
        return NextResponse.json(
          {
            error:
              "GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido. Pegala en UNA sola línea " +
              "(compactá el archivo con: node -e \"console.log(JSON.stringify(require('./clave.json')))\") " +
              "y redeployá.",
          },
          { status: 503 },
        );
      }
      // Google rechazó las credenciales (key inválida/revocada).
      if (msg.includes("Google token error")) {
        return NextResponse.json(
          {
            error:
              "Google rechazó las credenciales del service account. Verificá que la key JSON " +
              "sea la descargada de Google Cloud, completa y vigente.",
          },
          { status: 502 },
        );
      }
      if (msg.includes(" 403")) {
        const email = getServiceAccountEmail();
        return NextResponse.json(
          {
            error: `Sin acceso a la planilla. Compartila (lectura) con ${
              email ?? "el service account de Google"
            }.`,
          },
          { status: 403 },
        );
      }
      if (msg.includes(" 404")) {
        return NextResponse.json(
          { error: "Planilla no encontrada. Revisá la URL." },
          { status: 404 },
        );
      }
      throw err;
    }

    const selectedGid = body.gid ?? urlGid ?? tabs[0]?.gid ?? null;

    // Pestañas que ya tienen fuente activa en esta cuenta.
    const { data: sources } = await ctx.supabase
      .from("lead_sources")
      .select("sheet_gid")
      .eq("spreadsheet_id", spreadsheetId)
      .eq("active", true);
    const registered = new Set(
      (sources ?? []).map((s) => String(s.sheet_gid ?? "0")),
    );

    // Pipeline destino + etapas (idempotente; igual que POST /sources).
    const { data: pipelineId, error: rpcErr } = await ctx.supabase.rpc(
      "ensure_leads_prepaga_pipeline",
      { p_account_id: ctx.accountId, p_user_id: ctx.userId },
    );
    if (rpcErr || !pipelineId) {
      console.error("[leads/preview] ensure pipeline error:", rpcErr);
      return NextResponse.json(
        { error: "no se pudo preparar el pipeline" },
        { status: 500 },
      );
    }
    const { data: stages } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, name")
      .eq("pipeline_id", pipelineId)
      .order("position");

    const raw = await fetchSheetRows(spreadsheetId, selectedGid);
    const suggestion = suggestMapping(raw);

    return NextResponse.json({
      spreadsheetId,
      serviceAccountEmail: getServiceAccountEmail(),
      tabs: tabs.map((t) => ({
        ...t,
        hasSource: registered.has(t.gid),
        looksLikeData: t.rowCount > 1,
      })),
      selected: {
        gid: selectedGid,
        headers: raw.headers,
        rowCount: raw.rows.length,
        suggestions: suggestion.columns,
        statusValues: suggestion.statusValues,
      },
      stages: stages ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
