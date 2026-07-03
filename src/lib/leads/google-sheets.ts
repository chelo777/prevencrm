// ============================================================
// Adaptador de Google Sheets (Fase 1).
//
// Sin dependencias nuevas: auth de service account con JWT RS256
// firmado por `node:crypto`, y lectura vía Sheets API REST v4.
// Funciona con hojas privadas (compartí cada hoja con el email del
// service account, permiso de lectura).
//
// Env requerida:
//   GOOGLE_SERVICE_ACCOUNT_JSON  -> el JSON completo de la key del SA.
// ============================================================

import crypto from "node:crypto";
import type { RawSheetData } from "./types";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no está configurada");
  }
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON incompleta (falta client_email/private_key)");
  }
  return {
    client_email: parsed.client_email,
    // Las private_key vienen con \n escapados si están en una línea.
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
    token_uri: parsed.token_uri || "https://oauth2.googleapis.com/token",
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// Cache de token en memoria (por proceso).
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }

  const sa = loadServiceAccount();
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(sa.private_key);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600),
  };
  return cachedToken.token;
}

/** Resuelve el título (nombre A1) de la pestaña a partir del gid. */
async function resolveSheetTitle(
  spreadsheetId: string,
  gid: string | null,
  token: string,
): Promise<string> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}?fields=sheets.properties(sheetId,title)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Sheets metadata error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  };
  const sheets = json.sheets ?? [];
  if (gid != null && gid !== "") {
    const match = sheets.find((s) => String(s.properties?.sheetId) === String(gid));
    if (match?.properties?.title) return match.properties.title;
  }
  const first = sheets[0]?.properties?.title;
  if (!first) throw new Error("La planilla no tiene pestañas legibles");
  return first;
}

/**
 * Lee una pestaña completa. Devuelve headers (primera fila) + filas.
 * NO usa watermark: relee todo el rango cada vez (B2). La idempotencia
 * la garantiza el claim sobre meta_lead_id.
 */
export async function fetchSheetRows(
  spreadsheetId: string,
  gid: string | null,
): Promise<RawSheetData> {
  const token = await getAccessToken();
  const title = await resolveSheetTitle(spreadsheetId, gid, token);

  const range = encodeURIComponent(title);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Sheets values error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { values?: unknown[][] };
  const values = (json.values ?? []).map((row) =>
    row.map((cell) => (cell == null ? "" : String(cell))),
  );

  if (values.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = values;
  return { headers, rows };
}

/** Una pestaña del documento, para el wizard. */
export interface SheetTab {
  gid: string;
  title: string;
  rowCount: number;
}

/** Lista las pestañas (título + gid + filas) del documento. */
export async function fetchSpreadsheetTabs(
  spreadsheetId: string,
): Promise<SheetTab[]> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}?fields=sheets.properties(sheetId,title,gridProperties(rowCount))`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Sheets metadata error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    sheets?: {
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number };
      };
    }[];
  };
  return (json.sheets ?? []).flatMap((s) => {
    const p = s.properties;
    if (p?.sheetId == null) return [];
    return [
      {
        gid: String(p.sheetId),
        title: p.title ?? `gid ${p.sheetId}`,
        rowCount: p.gridProperties?.rowCount ?? 0,
      },
    ];
  });
}

/** Email del service account (para el hint "compartí la hoja con…"). */
export function getServiceAccountEmail(): string | null {
  try {
    return loadServiceAccount().client_email;
  } catch {
    return null;
  }
}
