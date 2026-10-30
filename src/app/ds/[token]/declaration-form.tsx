"use client";

import { useEffect, useRef, useState } from "react";
import {
  emptyDeclaration,
  emptyMember,
  CONTRACEPTIVE_OPTIONS,
  GLASSES_OPTIONS,
  MAX_MEMBERS,
  memberTitle,
  parseDeclaration,
  questionsFor,
  type Declaration,
  type EyeRx,
  type Member,
  type Relation,
  type YesNoAnswer,
} from "@/lib/health-declarations/declaration";

// Formulario público de la declaración. Pensado para el pulgar: Sí/No
// con botones grandes, el detalle aparece solo al elegir "Sí", teclado
// numérico en edad/altura/peso. El borrador se guarda en el navegador
// por si el prospecto sale a buscar una fecha y vuelve.

interface Props {
  token: string;
  advisorPhone: string;
  /** Si ya respondió: el texto guardado, para reenviarlo. */
  submittedSummary: string | null;
}

const PINK = "#d6006c";

function whatsappUrl(phone: string, text: string): string {
  // api.whatsapp.com directo, NO wa.me: su redirect rompe los emojis.
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function DeclarationForm({ token, advisorPhone, submittedSummary }: Props) {
  const draftKey = `ds-draft:${token}`;
  const [data, setData] = useState<Declaration>(emptyDeclaration);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<string | null>(submittedSummary);
  const [phone, setPhone] = useState(advisorPhone);
  const errorsRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (summary) return;
    try {
      const raw = localStorage.getItem(draftKey);
      const draft = raw ? (JSON.parse(raw) as Partial<Declaration>) : null;
      // Se completa sobre un formulario vacío: un borrador de otra versión
      // (o tocado a mano) no puede dejar preguntas sin su respuesta base.
      if (draft && Array.isArray(draft.members) && draft.members.length > 0) {
        setData({
          members: draft.members.slice(0, MAX_MEMBERS).map((m) => {
            const base = emptyMember(m.relation ?? "otro");
            return { ...base, ...m, answers: { ...base.answers, ...m.answers } };
          }),
          children: { ...emptyDeclaration().children, ...draft.children },
        });
      }
    } catch {
      // Sin borrador: arranca vacío.
    }
    loaded.current = true;
  }, [draftKey, summary]);

  useEffect(() => {
    if (!loaded.current || summary) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(data));
    } catch {
      // Navegación privada / storage bloqueado: no pasa nada.
    }
  }, [data, draftKey, summary]);

  function updateMember(i: number, patch: Partial<Member>) {
    setData((d) => ({
      ...d,
      members: d.members.map((m, j) => (j === i ? { ...m, ...patch } : m)),
    }));
  }

  function updateAnswer(i: number, key: string, patch: Partial<YesNoAnswer>) {
    setData((d) => ({
      ...d,
      members: d.members.map((m, j) =>
        j === i
          ? { ...m, answers: { ...m.answers, [key]: { ...m.answers[key], ...patch } } }
          : m,
      ),
    }));
  }

  function addMember() {
    setData((d) => ({ ...d, members: [...d.members, emptyMember("pareja")] }));
  }

  function removeMember(i: number) {
    setData((d) => ({ ...d, members: d.members.filter((_, j) => j !== i) }));
  }

  async function submit() {
    const { errors: found } = parseDeclaration(data);
    setErrors(found);
    if (found.length > 0) {
      requestAnimationFrame(() =>
        errorsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/health-declarations/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        keepalive: true,
      });
      const json = (await res.json().catch(() => ({}))) as {
        summary?: string;
        advisorPhone?: string;
        error?: string;
        errors?: string[];
      };
      if (!json.summary) {
        setErrors(json.errors ?? [json.error ?? "No se pudo guardar. Probá de nuevo."]);
        return;
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      const to = json.advisorPhone ?? advisorPhone;
      setPhone(to);
      setSummary(json.summary);
      await copy(json.summary);
      window.location.href = whatsappUrl(to, json.summary);
    } catch {
      setErrors(["Sin conexión. Revisá tu internet y tocá Guardar de nuevo."]);
    } finally {
      setSaving(false);
    }
  }

  if (summary) return <Done summary={summary} phone={phone} />;

  return (
    <div className="-mt-4 space-y-4 px-4">
      {data.members.map((m, i) => (
        <MemberCard
          key={i}
          index={i}
          member={m}
          onChange={(patch) => updateMember(i, patch)}
          onAnswer={(key, patch) => updateAnswer(i, key, patch)}
          onRemove={i > 0 ? () => removeMember(i) : undefined}
        />
      ))}

      {data.members.length < MAX_MEMBERS && (
        <button
          type="button"
          onClick={addMember}
          className="min-h-12 w-full rounded-2xl border-2 border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-700 active:bg-slate-100"
        >
          + Agregar integrante del grupo familiar
        </button>
      )}

      <Card>
        <YesNoQuestion
          label="¿Tenés hijos? ¿Tienen cobertura?"
          detailLabel="Edades y si tienen cobertura"
          answer={data.children}
          onChange={(patch) =>
            setData((d) => ({ ...d, children: { ...d.children, ...patch } }))
          }
        />
      </Card>

      {errors.length > 0 && (
        <div
          ref={errorsRef}
          role="alert"
          className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">Te falta completar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="px-1 text-xs text-slate-500">
        Tus respuestas las ve solo tu asesor de Prevención Salud para armar tu
        cotización.
      </p>

      <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent px-4 pb-4 pt-6">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="min-h-14 w-full rounded-2xl text-base font-bold text-white shadow-lg disabled:opacity-60"
          style={{ background: PINK }}
        >
          {saving ? "Guardando…" : "Guardar y enviar a mi asesor"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      {children}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold transition-colors ${
        active
          ? "border-transparent text-white"
          : "border-slate-300 bg-white text-slate-700 active:bg-slate-100"
      }`}
      style={active ? { background: PINK } : undefined}
    >
      {children}
    </button>
  );
}

const INPUT =
  "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-pink-600 focus:ring-2 focus:ring-pink-600/20";

function YesNoQuestion({
  label,
  detailLabel,
  answer,
  onChange,
  children,
  showDetail = true,
}: {
  label: string;
  detailLabel: string;
  answer: YesNoAnswer;
  onChange: (patch: Partial<YesNoAnswer>) => void;
  children?: React.ReactNode;
  /** false = el texto libre no aplica (lo reemplaza `children`). */
  showDetail?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[15px] font-medium leading-snug">{label}</p>
      <div className="flex gap-2">
        <Chip active={answer.value === "no"} onClick={() => onChange({ value: "no" })}>
          No
        </Chip>
        <Chip active={answer.value === "si"} onClick={() => onChange({ value: "si" })}>
          Sí
        </Chip>
      </div>
      {answer.value === "si" && (
        <>
          {children}
          {showDetail && (
            <textarea
              value={answer.detail}
              onChange={(e) => onChange({ detail: e.target.value })}
              placeholder={detailLabel}
              rows={2}
              maxLength={300}
              className={`${INPUT} py-2`}
            />
          )}
        </>
      )}
    </div>
  );
}

const RELATIONS: { value: Relation; label: string }[] = [
  { value: "pareja", label: "Pareja" },
  { value: "hijo", label: "Hijo/a" },
  { value: "otro", label: "Otro" },
];

function MemberCard({
  index,
  member: m,
  onChange,
  onAnswer,
  onRemove,
}: {
  index: number;
  member: Member;
  onChange: (patch: Partial<Member>) => void;
  onAnswer: (key: string, patch: Partial<YesNoAnswer>) => void;
  onRemove?: () => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold" style={{ color: PINK }}>
          {index === 0 ? "Tus datos" : memberTitle(m, index)}
        </h2>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 px-2 text-sm text-slate-500 underline"
          >
            Quitar
          </button>
        )}
      </div>

      {index > 0 && (
        <div className="space-y-2">
          <div className="flex gap-2">
            {RELATIONS.map((r) => (
              <Chip
                key={r.value}
                active={m.relation === r.value}
                onClick={() => onChange({ relation: r.value })}
              >
                {r.label}
              </Chip>
            ))}
          </div>
          <input
            value={m.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Nombre"
            autoComplete="off"
            maxLength={120}
            className={INPUT}
          />
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[15px] font-medium">Sexo</p>
        <div className="flex gap-2">
          <Chip active={m.sex === "m"} onClick={() => onChange({ sex: "m" })}>
            Hombre
          </Chip>
          <Chip active={m.sex === "f"} onClick={() => onChange({ sex: "f" })}>
            Mujer
          </Chip>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label="Edad"
          suffix="años"
          value={m.age}
          onChange={(age) => onChange({ age })}
          integer
        />
        <NumberField
          label="Altura"
          suffix="cm"
          value={m.heightCm}
          onChange={(heightCm) => onChange({ heightCm })}
        />
        <NumberField
          label="Peso"
          suffix="kg"
          value={m.weightKg}
          onChange={(weightKg) => onChange({ weightKg })}
        />
      </div>

      {questionsFor(m.sex).map((q) => (
        <YesNoQuestion
          key={q.key}
          label={q.label}
          detailLabel={q.detailLabel}
          answer={m.answers[q.key]}
          onChange={(patch) => onAnswer(q.key, patch)}
          showDetail={q.key !== "contraceptive" || m.contraceptiveType === "Otro"}
        >
          {q.key === "glasses" && <GlassesFields member={m} onChange={onChange} />}
          {q.key === "contraceptive" && (
            <ContraceptiveFields member={m} onChange={onChange} />
          )}
        </YesNoQuestion>
      ))}

      {m.sex === "f" && (
        <label className="block space-y-2">
          <span className="text-[15px] font-medium">
            Fecha de última menstruación
          </span>
          <input
            type="date"
            value={m.lastPeriod}
            onChange={(e) => onChange({ lastPeriod: e.target.value })}
            className={INPUT}
          />
        </label>
      )}
    </Card>
  );
}

function GlassesFields({
  member: m,
  onChange,
}: {
  member: Member;
  onChange: (patch: Partial<Member>) => void;
}) {
  function setRx(type: string, eye: keyof EyeRx, value: string) {
    const current = m.glassesRx[type] ?? { od: "", oi: "" };
    onChange({
      glassesRx: {
        ...m.glassesRx,
        [type]: { ...current, [eye]: value.replace(/[^\d.,+-]/g, "") },
      },
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {GLASSES_OPTIONS.map((g) => {
          const on = m.glassesTypes.includes(g);
          return (
            <Chip
              key={g}
              active={on}
              onClick={() =>
                onChange({
                  glassesTypes: on
                    ? m.glassesTypes.filter((x) => x !== g)
                    : [...m.glassesTypes, g],
                })
              }
            >
              {g}
            </Chip>
          );
        })}
      </div>

      {m.glassesTypes.length > 0 && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-xs text-slate-600">
            Graduación en dioptrías, como figura en tu receta. Si no la sabés,
            dejala vacía.
          </p>
          {GLASSES_OPTIONS.filter((g) => m.glassesTypes.includes(g)).map((g) => (
            <div key={g} className="space-y-1">
              <p className="text-sm font-semibold">{g}</p>
              <div className="grid grid-cols-2 gap-2">
                {(["od", "oi"] as const).map((eye) => (
                  <label key={eye} className="block space-y-1">
                    <span className="text-xs font-medium text-slate-600">
                      {eye === "od" ? "Ojo derecho" : "Ojo izquierdo"}
                    </span>
                    <input
                      value={m.glassesRx[g]?.[eye] ?? ""}
                      onChange={(e) => setRx(g, eye, e.target.value)}
                      inputMode="decimal"
                      placeholder="ej. 2,50"
                      maxLength={6}
                      className={INPUT}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function ContraceptiveFields({
  member: m,
  onChange,
}: {
  member: Member;
  onChange: (patch: Partial<Member>) => void;
}) {
  // Mes y año con dos selects: <input type="month"> no existe en varios
  // navegadores y ahí cae a un campo de texto sin formato.
  const [year = "", month = ""] = m.contraceptiveMonth.split("-");
  const [thisYear] = useState(() => new Date().getFullYear());
  const years = Array.from({ length: 21 }, (_, i) => String(thisYear - i));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {CONTRACEPTIVE_OPTIONS.map((c) => (
          <Chip
            key={c}
            active={m.contraceptiveType === c}
            onClick={() => onChange({ contraceptiveType: c })}
          >
            {c}
          </Chip>
        ))}
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-slate-600">Fecha de colocación</span>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={month}
            onChange={(e) => onChange({ contraceptiveMonth: `${year}-${e.target.value}` })}
            aria-label="Mes de colocación"
            className={INPUT}
          >
            <option value="">Mes</option>
            {MONTHS.map((name, i) => (
              <option key={name} value={String(i + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => onChange({ contraceptiveMonth: `${e.target.value}-${month}` })}
            aria-label="Año de colocación"
            className={INPUT}
          >
            <option value="">Año</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  suffix,
  value,
  onChange,
  integer,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  integer?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="relative">
        <input
          value={value}
          onChange={(e) =>
            onChange(e.target.value.replace(integer ? /\D/g : /[^\d.,]/g, ""))
          }
          inputMode={integer ? "numeric" : "decimal"}
          maxLength={6}
          className={`${INPUT} pr-10`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
          {suffix}
        </span>
      </div>
    </label>
  );
}

function Done({ summary, phone }: { summary: string; phone: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="-mt-4 space-y-4 px-4">
      <Card>
        <div className="text-center">
          <div
            className="mx-auto flex size-14 items-center justify-center rounded-full text-white"
            style={{ background: PINK }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-7"
              aria-hidden
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 className="mt-3 text-lg font-bold">¡Listo! Guardamos tu declaración</h2>
          <p className="mt-1 text-sm text-slate-600">
            Mandásela a tu asesor por WhatsApp: el mensaje ya está escrito,
            solo tocá enviar.
          </p>
        </div>
        <a
          href={whatsappUrl(phone, summary)}
          className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#25D366] text-base font-bold text-white shadow"
        >
          Enviar a mi asesor por WhatsApp
        </a>
        <button
          type="button"
          onClick={async () => setCopied(await copy(summary))}
          className="min-h-11 w-full rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 active:bg-slate-100"
        >
          {copied ? "¡Copiado!" : "Copiar texto"}
        </button>
      </Card>
      <pre className="whitespace-pre-wrap rounded-2xl bg-white p-4 font-sans text-sm text-slate-700 ring-1 ring-slate-200">
        {summary}
      </pre>
    </div>
  );
}
