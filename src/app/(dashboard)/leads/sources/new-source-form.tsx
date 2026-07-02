"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

// Alta de fuente (seed manual). Acepta pegar la URL completa de la
// hoja: extrae spreadsheetId y gid automáticamente.

function parseSheetUrl(url: string): { spreadsheetId: string; gid: string | null } {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
  return {
    spreadsheetId: idMatch ? idMatch[1] : url.trim(),
    gid: gidMatch ? gidMatch[1] : null,
  };
}

export function NewSourceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { spreadsheetId, gid } = parseSheetUrl(url);
    if (!name.trim() || !spreadsheetId) {
      setError("Completá el nombre y la URL/ID de la hoja.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/leads/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), spreadsheetId, sheetGid: gid, autoAssign }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      setName("");
      setUrl("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la fuente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-foreground">Agregar una hoja</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Nombre de la fuente
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Form Dependencia - Fabi"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={autoAssign}
            onChange={(e) => setAutoAssign(e.target.checked)}
            className="h-4 w-4"
          />
          Auto-asignar (least-loaded)
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        URL de la hoja de Google (o el ID)
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Compartí la hoja (lectura) con el email del service account de Google
        configurado en el servidor.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {busy ? "Creando…" : "Crear fuente"}
        </button>
      </div>
    </form>
  );
}
