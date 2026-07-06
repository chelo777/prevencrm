import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  fetchPageForms,
  fetchPageName,
  getMetaLeadsTokenConfigured,
} from "@/lib/leads/meta-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extrae el id numérico de una URL de página de Facebook, o el id pelado. */
function parsePageInput(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{5,}$/.test(trimmed)) return trimmed;
  const idMatch = trimmed.match(/(?:profile\.php\?id=|facebook\.com\/)(\d{5,})/);
  if (idMatch) return idMatch[1];
  return null;
}

/**
 * Preview para el wizard de fuentes meta_api: lista los formularios de
 * la página con su conteo de leads. Solo ids/nombres/conteos — el token
 * jamás sale del servidor.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    if (!getMetaLeadsTokenConfigured()) {
      return NextResponse.json(
        { error: "META_LEADS_ACCESS_TOKEN no está configurada en el servidor" },
        { status: 503 },
      );
    }
    const body = (await request.json()) as { pageUrlOrId?: string };
    const pageId = parsePageInput(body.pageUrlOrId ?? "");
    if (!pageId) {
      return NextResponse.json(
        { error: "Pegá el ID numérico de la página (o una URL que lo contenga)" },
        { status: 400 },
      );
    }

    let forms;
    let pageName: string | null = null;
    try {
      forms = await fetchPageForms(pageId);
      pageName = await fetchPageName(pageId);
    } catch (err) {
      console.error("[leads/meta-preview] error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `No se pudo leer la página en Meta: ${msg}` },
        { status: 502 },
      );
    }

    // Páginas ya registradas en esta cuenta.
    const { data: sources } = await ctx.supabase
      .from("lead_sources")
      .select("meta_page_id")
      .eq("kind", "meta_api")
      .eq("active", true);
    const hasSource = (sources ?? []).some(
      (s) => String(s.meta_page_id) === pageId,
    );

    return NextResponse.json({ pageId, pageName, hasSource, forms });
  } catch (err) {
    return toErrorResponse(err);
  }
}
