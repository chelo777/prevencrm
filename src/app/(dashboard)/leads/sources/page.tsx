import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentAccount } from "@/lib/auth/account";
import { NewSourceForm } from "./new-source-form";

export const dynamic = "force-dynamic";

// Alta y estado de las fuentes de leads (seed manual — MVP). Muestra
// las fuentes cargadas, la cuarentena y la última corrida del cron.

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function LeadSourcesPage() {
  const { supabase, accountId } = await getCurrentAccount();

  const { data: sources } = await supabase
    .from("lead_sources")
    .select("id, name, spreadsheet_id, sheet_gid, active, auto_assign, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  const { data: quarantine } = await supabase
    .from("lead_intake_errors")
    .select("id, reason, created_at")
    .eq("account_id", accountId)
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: runs } = await supabase
    .from("lead_sync_runs")
    .select("id, started_at, rows_read, processed, quarantined, errors, ok, message")
    .eq("account_id", accountId)
    .order("started_at", { ascending: false })
    .limit(5);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/leads"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Leads
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Fuentes de leads</h1>
        <p className="text-sm text-muted-foreground">
          Cada hoja de Google de un formulario de Meta es una fuente. El id del
          lead se detecta por contenido, así que no importa el orden de columnas.
        </p>
      </div>

      <NewSourceForm />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Fuentes cargadas</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Spreadsheet</th>
                <th className="px-4 py-3 font-medium">Auto-asignar</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(sources ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    Todavía no hay fuentes.
                  </td>
                </tr>
              ) : (
                (sources ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {(s.spreadsheet_id as string)?.slice(0, 12)}…
                      {s.sheet_gid ? ` · gid ${s.sheet_gid}` : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.auto_assign ? "Sí" : "Manual"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          s.active
                            ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        }
                      >
                        {s.active ? "Activa" : "Pausada"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Últimas sincronizaciones</h2>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {(runs ?? []).length === 0 ? (
              <p className="text-muted-foreground">Sin corridas todavía.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(runs ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{fmt(r.started_at)}</span>
                    <span className="text-foreground">
                      {r.processed}/{r.rows_read} · {r.quarantined} cuar. · {r.errors} err.
                    </span>
                    <span className={r.ok ? "text-emerald-300" : "text-red-400"}>
                      {r.ok ? "ok" : "falló"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Cuarentena {quarantine?.length ? `(${quarantine.length})` : ""}
          </h2>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {(quarantine ?? []).length === 0 ? (
              <p className="text-muted-foreground">Sin filas en cuarentena. 🎉</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(quarantine ?? []).map((q) => (
                  <li key={q.id} className="text-muted-foreground">
                    <span className="text-foreground">{fmt(q.created_at)}</span> — {q.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
