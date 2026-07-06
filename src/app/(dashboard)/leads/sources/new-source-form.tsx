"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from "lucide-react";
import type { CanonicalField, ColumnSuggestion } from "@/lib/leads/types";

// Wizard de alta de fuente: URL → pestaña → mapeo de columnas (con el
// nombre que el usuario quiera para cada custom field) → estados→etapa.

interface PreviewTab {
  gid: string;
  title: string;
  rowCount: number;
  hasSource: boolean;
  looksLikeData: boolean;
}

interface Preview {
  spreadsheetId: string;
  serviceAccountEmail: string | null;
  tabs: PreviewTab[];
  selected: {
    gid: string | null;
    headers: string[];
    rowCount: number;
    suggestions: ColumnSuggestion[];
    statusValues: string[];
  };
  stages: { id: string; name: string }[];
}

/** Clasificación editable de una columna en el paso 2. */
interface ColumnChoice {
  index: number;
  header: string;
  samples: string[];
  kind: "canonical" | "custom" | "ignore";
  field?: CanonicalField;
  label: string;
}

const CANONICAL_LABELS: Partial<Record<CanonicalField, string>> = {
  metaLeadId: "ID del lead (Meta)",
  name: "Nombre",
  phone: "Teléfono",
  email: "Email",
  city: "Ciudad",
  postalCode: "Código postal",
  comments: "Comentarios / notas",
  status: "Estado (lead_status)",
  createdTime: "Fecha de creación",
  platform: "Plataforma",
  isOrganic: "Orgánico",
  campaignId: "Campaña (id)",
  campaignName: "Campaña (nombre)",
  adsetId: "Conjunto (id)",
  adsetName: "Conjunto (nombre)",
  adId: "Anuncio (id)",
  adName: "Anuncio (nombre)",
  formId: "Formulario (id)",
  formName: "Formulario (nombre)",
};

/** Sugerencia de etapa por similitud de nombre con el estado. */
function suggestStage(
  status: string,
  stages: { id: string; name: string }[],
): string {
  const s = status.toLowerCase().replace(/[^a-záéíóúñ]/g, "");
  const alias: Record<string, string> = {
    created: "nuevo",
  };
  const wanted = alias[s] ?? s;
  if (!wanted) return "";
  for (const st of stages) {
    const n = st.name.toLowerCase().replace(/[^a-záéíóúñ]/g, "");
    if (n === wanted || n.includes(wanted) || wanted.includes(n)) return st.id;
  }
  return "";
}

function normalizeHeaderClient(h: string): string {
  return (h ?? "").toString().trim().toLowerCase().replace(/\s+/g, "_");
}

function SheetSourceForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<ColumnChoice[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  async function loadPreview(targetGid?: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leads/sources/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, gid: targetGid ?? null }),
      });
      const body = (await res.json().catch(() => ({}))) as Preview & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setPreview(body);
      setChoices(
        body.selected.suggestions.map((s) => ({
          index: s.index,
          header: s.header,
          samples: s.samples,
          kind: s.kind,
          field: s.field,
          label: s.label ?? "",
        })),
      );
      setStatusMap(
        Object.fromEntries(
          body.selected.statusValues.map((v) => [v, suggestStage(v, body.stages)]),
        ),
      );
      const tab = body.tabs.find((t) => t.gid === body.selected.gid);
      if (!name.trim() && tab) setName(tab.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la planilla.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function setChoice(index: number, patch: Partial<ColumnChoice>) {
    setChoices((prev) =>
      prev.map((c) => (c.index === index ? { ...c, ...patch } : c)),
    );
  }

  async function createSource() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const canonical: Partial<Record<CanonicalField, string>> = {};
      const custom: Record<string, string> = {};
      const ignore: string[] = [];
      for (const c of choices) {
        const norm = normalizeHeaderClient(c.header);
        if (c.kind === "canonical" && c.field) canonical[c.field] = c.header;
        else if (c.kind === "custom") custom[norm] = c.label.trim() || c.header;
        else if (c.kind === "ignore" && norm) ignore.push(norm);
      }
      const statusToStage = Object.fromEntries(
        Object.entries(statusMap).filter(([, stageId]) => stageId),
      );
      const res = await fetch("/api/leads/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          spreadsheetId: preview.spreadsheetId,
          sheetGid: preview.selected.gid,
          autoAssign,
          columnMapping: { canonical, custom, ignore, statusToStage },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      setDone(preview.selected.gid ?? "0");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la fuente.");
    } finally {
      setBusy(false);
    }
  }

  function resetForTab(gid: string) {
    setDone(null);
    setName("");
    setStep(2);
    void loadPreview(gid);
  }

  const inputCls =
    "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
  const pendingTabs =
    preview?.tabs.filter(
      (t) => !t.hasSource && t.looksLikeData && t.gid !== done,
    ) ?? [];

  // ---------- pantalla de éxito ----------
  if (done) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Fuente creada ✅</h2>
        {pendingTabs.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              Este documento tiene otras pestañas con datos sin fuente:
            </p>
            <div className="flex flex-wrap gap-2">
              {pendingTabs.map((t) => (
                <button
                  key={t.gid}
                  onClick={() => resetForTab(t.gid)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
                >
                  <Plus className="h-4 w-4" /> {t.title}
                </button>
              ))}
            </div>
          </>
        )}
        <div>
          <button
            onClick={() => {
              setDone(null);
              setPreview(null);
              setUrl("");
              setName("");
              setStep(1);
            }}
            className="text-xs text-muted-foreground underline"
          >
            Agregar otra planilla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Agregar una hoja</h2>
        <span className="text-xs text-muted-foreground">Paso {step} de 3</span>
      </div>

      {/* ---------- Paso 1: URL + pestaña ---------- */}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            URL de la hoja de Google (o el ID)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
              className={inputCls}
            />
          </label>
          {preview && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">Pestañas del documento:</p>
              <div className="flex flex-col gap-1">
                {preview.tabs.map((t) => (
                  <label
                    key={t.gid}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="radio"
                      name="tab"
                      checked={preview.selected.gid === t.gid}
                      disabled={t.hasSource}
                      onChange={() => void loadPreview(t.gid)}
                    />
                    {t.title}
                    <span className="text-xs text-muted-foreground">
                      {t.hasSource
                        ? "— ya tiene fuente"
                        : t.looksLikeData
                          ? ""
                          : "— parece vacía"}
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Nombre de la fuente
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Form Dependencia - Fabi"
                  className={inputCls}
                />
              </label>
            </div>
          )}
          {preview?.serviceAccountEmail && (
            <p className="text-xs text-muted-foreground">
              La hoja debe estar compartida (lectura) con{" "}
              <code>{preview.serviceAccountEmail}</code>.
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void loadPreview()}
              disabled={busy || !url.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              {busy ? "Leyendo…" : preview ? "Releer" : "Leer planilla"}
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!preview || busy || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Siguiente <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---------- Paso 2: columnas ---------- */}
      {step === 2 && preview && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Revisá cómo se interpreta cada columna. Los campos personalizados
            usan el nombre que escribas acá (después aparecen así en cada contacto).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Columna</th>
                  <th className="py-2 pr-3">Ejemplos</th>
                  <th className="py-2 pr-3">Usar como</th>
                  <th className="py-2">Nombre del campo</th>
                </tr>
              </thead>
              <tbody>
                {choices.map((c) => (
                  <tr key={c.index} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-3 font-mono text-xs text-foreground">
                      {c.header || <em className="text-muted-foreground">(sin header)</em>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {c.samples.slice(0, 2).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={c.kind === "canonical" ? `f:${c.field}` : c.kind}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("f:")) {
                            setChoice(c.index, {
                              kind: "canonical",
                              field: v.slice(2) as CanonicalField,
                            });
                          } else {
                            setChoice(c.index, {
                              kind: v as "custom" | "ignore",
                              field: undefined,
                            });
                          }
                        }}
                        className={inputCls}
                      >
                        <option value="custom">Campo personalizado</option>
                        <option value="ignore">Ignorar</option>
                        <optgroup label="Campo del CRM">
                          {Object.entries(CANONICAL_LABELS).map(([f, label]) => (
                            <option key={f} value={`f:${f}`}>
                              {label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td className="py-2">
                      {c.kind === "custom" ? (
                        <input
                          value={c.label}
                          onChange={(e) => setChoice(c.index, { label: e.target.value })}
                          placeholder="Nombre para trabajar"
                          className={inputCls}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" /> Volver
            </button>
            <button
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Siguiente <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---------- Paso 3: estados + crear ---------- */}
      {step === 3 && preview && (
        <div className="flex flex-col gap-3">
          {preview.selected.statusValues.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                Cada estado de la planilla mueve el deal a esta etapa del embudo.
                Si el comprador cambia el estado en la hoja, el CRM lo refleja —
                salvo que alguien ya haya movido ese deal a mano en el Kanban.
              </p>
              <div className="flex flex-col gap-2">
                {preview.selected.statusValues.map((v) => (
                  <label key={v} className="flex items-center gap-3 text-sm">
                    <code className="w-40 shrink-0 text-xs text-foreground">{v}</code>
                    <select
                      value={statusMap[v] ?? ""}
                      onChange={(e) =>
                        setStatusMap((m) => ({ ...m, [v]: e.target.value }))
                      }
                      className={inputCls}
                    >
                      <option value="">(no mover)</option>
                      {preview.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              La pestaña no tiene columna de estado (o está vacía): los leads
              entran en la etapa inicial del embudo.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoAssign}
              onChange={(e) => setAutoAssign(e.target.checked)}
              className="h-4 w-4"
            />
            Auto-asignar (least-loaded)
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" /> Volver
            </button>
            <button
              onClick={() => void createSource()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {busy ? "Creando…" : "Crear fuente"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Fuente directa Meta API (sin Google): página -> formularios.
// ============================================================

interface MetaFormRow {
  id: string;
  name: string;
  status: string;
  leadsCount: number;
}

interface MetaPreview {
  pageId: string;
  pageName: string | null;
  hasSource: boolean;
  forms: MetaFormRow[];
}

function MetaSourceForm() {
  const router = useRouter();
  const [pageInput, setPageInput] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MetaPreview | null>(null);
  const [allForms, setAllForms] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [autoAssign, setAutoAssign] = useState(true);
  const [done, setDone] = useState(false);

  const inputCls =
    "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

  async function loadPreview() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leads/sources/meta-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrlOrId: pageInput }),
      });
      const body = (await res.json().catch(() => ({}))) as MetaPreview & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setPreview(body);
      if (!name.trim() && body.pageName) setName(body.pageName);
      // Default: formularios activos con leads.
      setSelected(
        Object.fromEntries(
          body.forms.map((f) => [f.id, f.status === "ACTIVE" && f.leadsCount > 0]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la página.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const metaFormIds = allForms
        ? []
        : Object.entries(selected)
            .filter(([, on]) => on)
            .map(([id]) => id);
      if (!allForms && metaFormIds.length === 0) {
        throw new Error("Elegí al menos un formulario (o marcá 'Todos').");
      }
      const res = await fetch("/api/leads/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || preview.pageName || "Meta Lead Ads",
          kind: "meta_api",
          metaPageId: preview.pageId,
          metaFormIds,
          autoAssign,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la fuente.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Fuente creada ✅</h3>
        <p className="text-xs text-muted-foreground">
          Los leads entran directo desde Meta en el próximo ciclo del cron (≤5
          min). Los formularios nuevos{" "}
          {allForms ? "se incluyen solos" : "se agregan editando la fuente"}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        ID (o URL) de la página de Facebook
        <input
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          placeholder="851468501392623"
          className={inputCls}
        />
      </label>

      {preview && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Página:{" "}
            <span className="text-foreground">
              {preview.pageName ?? preview.pageId}
            </span>
            {preview.hasSource && (
              <span className="text-red-400"> — ya tiene una fuente activa</span>
            )}
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Nombre de la fuente
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allForms}
              onChange={(e) => setAllForms(e.target.checked)}
              className="h-4 w-4"
            />
            Todos los formularios (incluye los que crees en el futuro)
          </label>
          {!allForms && (
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
              {preview.forms.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={selected[f.id] ?? false}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [f.id]: e.target.checked }))
                    }
                    className="h-4 w-4"
                  />
                  <span className="flex-1">{f.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.leadsCount} leads ·{" "}
                    {f.status === "ACTIVE" ? "activo" : "archivado"}
                  </span>
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoAssign}
              onChange={(e) => setAutoAssign(e.target.checked)}
              className="h-4 w-4"
            />
            Auto-asignar (least-loaded)
          </label>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void loadPreview()}
          disabled={busy || !pageInput.trim()}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {busy && !preview ? "Leyendo…" : preview ? "Releer" : "Leer formularios"}
        </button>
        {preview && !preview.hasSource && (
          <button
            onClick={() => void create()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {busy ? "Creando…" : "Crear fuente"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Selector de tipo de fuente + flujos. */
export function NewSourceForm() {
  const [sourceType, setSourceType] = useState<"meta" | "sheet" | null>(null);

  if (sourceType === "sheet") return <SheetSourceForm />;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Agregar una fuente</h2>
        {sourceType && (
          <button
            onClick={() => setSourceType(null)}
            className="text-xs text-muted-foreground underline"
          >
            Cambiar tipo
          </button>
        )}
      </div>

      {sourceType === null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setSourceType("meta")}
            className="flex flex-col items-start gap-1 rounded-lg border border-primary/50 bg-background p-4 text-left hover:bg-accent"
          >
            <span className="text-sm font-semibold text-foreground">
              Meta directo{" "}
              <span className="text-xs font-normal text-primary">(recomendado)</span>
            </span>
            <span className="text-xs text-muted-foreground">
              Lee los leads de tus formularios directamente de la API de Meta.
              Sin planillas; los formularios nuevos pueden entrar solos.
            </span>
          </button>
          <button
            onClick={() => setSourceType("sheet")}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-background p-4 text-left hover:bg-accent"
          >
            <span className="text-sm font-semibold text-foreground">
              Planilla de Google
            </span>
            <span className="text-xs text-muted-foreground">
              Lee una pestaña de una hoja que Meta/Zapier va llenando, con mapeo
              de columnas y sync de estados.
            </span>
          </button>
        </div>
      )}

      {sourceType === "meta" && <MetaSourceForm />}
    </div>
  );
}
