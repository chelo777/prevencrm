import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  formatDeclaration,
  isSummaryVisible,
  parseDeclaration,
} from "@/lib/health-declarations/declaration";
import {
  hashDeclarationToken,
  isPlausibleDeclarationToken,
} from "@/lib/health-declarations/token";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Guarda la declaración respondida por el prospecto (público, sin
 * sesión: la autorización es el token del enlace).
 *
 * El texto lo arma el servidor a partir de las respuestas validadas,
 * nunca se toma uno del navegador. Queda como nota del contacto (a
 * nombre del asesor que mandó el enlace) y vuelve al cliente junto con
 * el WhatsApp del asesor para abrir el chat con el texto listo.
 *
 * Responder es de una sola vez: el UPDATE filtra por status='pending',
 * así dos envíos simultáneos no pisan uno al otro.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isPlausibleDeclarationToken(token)) {
    return NextResponse.json({ error: "Enlace inválido" }, { status: 404 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Demasiados datos" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { declaration, errors } = parseDeclaration(body);
  if (errors.length > 0) {
    return NextResponse.json({ error: "Faltan respuestas", errors }, { status: 422 });
  }

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("health_declarations")
    .select(
      "id, account_id, contact_id, lead_id, created_by, advisor_phone, status, summary, submitted_at, expires_at, contacts(name)",
    )
    .eq("token_hash", hashDeclarationToken(token))
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Enlace inválido" }, { status: 404 });
  }
  if (row.status === "submitted") {
    // Mismo corte que la página: pasados los días de gracia el texto ya
    // no sale por el enlace.
    const visible = isSummaryVisible(row.submitted_at as string | null, Date.now());
    return NextResponse.json(
      visible
        ? { error: "Esta declaración ya fue enviada", summary: row.summary, advisorPhone: row.advisor_phone }
        : { error: "Esta declaración ya fue enviada a tu asesor" },
      { status: 409 },
    );
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "El enlace venció. Pedile uno nuevo a tu asesor." },
      { status: 410 },
    );
  }

  const contact = row.contacts as { name?: string | null } | { name?: string | null }[] | null;
  const contactName = Array.isArray(contact) ? contact[0]?.name : contact?.name;
  const summary = formatDeclaration(declaration, { name: contactName });

  const { data: updated, error } = await admin
    .from("health_declarations")
    .update({
      status: "submitted",
      answers: declaration,
      summary,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error("[POST /api/health-declarations/:token] update:", error);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // Otro envío ganó la carrera: ya está guardada.
    return NextResponse.json({ ok: true, summary, advisorPhone: row.advisor_phone });
  }

  // Trazas best-effort: la declaración ya está guardada.
  const [noteRes, logRes] = await Promise.all([
    admin.from("contact_notes").insert({
      account_id: row.account_id,
      contact_id: row.contact_id,
      user_id: row.created_by,
      note_text: summary,
    }),
    admin.from("activity_log").insert({
      account_id: row.account_id,
      user_id: row.created_by,
      lead_id: row.lead_id,
      action: "health_declaration_submitted",
      meta: { contact_id: row.contact_id, declaration_id: row.id },
    }),
  ]);
  if (noteRes.error || logRes.error) {
    console.error("[POST /api/health-declarations/:token] trazas:", {
      note: noteRes.error,
      log: logRes.error,
    });
  }

  return NextResponse.json({ ok: true, summary, advisorPhone: row.advisor_phone });
}
