import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  hashDeclarationToken,
  isPlausibleDeclarationToken,
} from "@/lib/health-declarations/token";
import { isSummaryVisible } from "@/lib/health-declarations/declaration";
import { DeclarationForm } from "./declaration-form";

export const dynamic = "force-dynamic";

const LOGO_BLANCO =
  "https://corporate-site-content.gruposancorseguros.com/PS/Content/Prevencion-salud-logo-completo-blanco.svg";

interface DeclarationRow {
  status: string;
  summary: string | null;
  advisor_phone: string;
  expires_at: string;
  submitted_at: string | null;
  contacts: { name: string | null } | { name: string | null }[] | null;
}

async function loadDeclaration(token: string) {
  if (!isPlausibleDeclarationToken(token)) return null;
  const { data } = await supabaseAdmin()
    .from("health_declarations")
    .select("status, summary, advisor_phone, expires_at, submitted_at, contacts(name)")
    .eq("token_hash", hashDeclarationToken(token))
    .maybeSingle<DeclarationRow>();
  if (!data) return null;
  const contact = Array.isArray(data.contacts) ? data.contacts[0] : data.contacts;
  const now = Date.now();
  return {
    row: data,
    // Respondida hace más de SUMMARY_VISIBLE_DAYS: no se muestra el texto.
    closed: data.status === "submitted" && !isSummaryVisible(data.submitted_at, now),
    firstName: contact?.name?.trim().split(/\s+/)[0] ?? "",
    expired:
      data.status === "pending" && new Date(data.expires_at).getTime() < now,
  };
}

export default async function DeclarationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await loadDeclaration(token);
  const row = found?.row ?? null;
  const firstName = found?.firstName ?? "";
  const expired = found?.expired ?? false;
  const closed = found?.closed ?? false;

  return (
    <main className="mx-auto w-full max-w-lg pb-16">
      <header
        className="px-5 pb-8 pt-8 text-white"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 0%, #ec1e91 0%, #d6006c 55%, #a80057 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_BLANCO} alt="Prevención Salud" className="h-9 w-auto" />
        <h1 className="mt-6 text-2xl font-bold">Declaración de salud</h1>
        <p className="mt-1 text-sm text-white/85">
          {firstName ? `Hola ${firstName}, ` : ""}
          son unas pocas preguntas y te lleva 2 minutos. Si sumás a tu grupo
          familiar, respondé por cada integrante.
        </p>
      </header>

      {!row ? (
        <Message
          title="Enlace no válido"
          text="Revisá que el enlace esté completo o pedile uno nuevo a tu asesor."
        />
      ) : closed ? (
        <Message
          title="Ya enviaste tu declaración"
          text="Tu asesor ya la tiene. Si necesitás cambiar algo, escribile por WhatsApp."
        />
      ) : expired ? (
        <Message
          title="El enlace venció"
          text="Pedile a tu asesor que te mande uno nuevo."
        />
      ) : (
        <DeclarationForm
          token={token}
          advisorPhone={row.advisor_phone}
          submittedSummary={row.status === "submitted" ? row.summary : null}
        />
      )}
    </main>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-4 -mt-4 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{text}</p>
    </div>
  );
}
