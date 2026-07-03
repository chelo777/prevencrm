// Parseo de URLs de Google Sheets (compartido por el wizard y el preview).

export function parseSheetUrl(url: string): {
  spreadsheetId: string | null;
  gid: string | null;
} {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
  const trimmed = url.trim();
  const bareId = /^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null;
  return {
    spreadsheetId: idMatch ? idMatch[1] : bareId,
    gid: gidMatch ? gidMatch[1] : null,
  };
}
