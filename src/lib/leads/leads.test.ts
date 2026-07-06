import { describe, it, expect } from "vitest";
import { normalizeArgentinePhone, toWhatsAppNumber } from "./phone";
import { createLeadMapper, detectColumnByContent, suggestMapping } from "./mapping";
import { parseSheetUrl } from "./sheet-url";
import { mapApiLead } from "./meta-api";
import { buildEventPayload } from "./capi";
import { ingestLead, pickLeastLoaded } from "./ingest";
import type {
  AssignableAgent,
  ClaimedLead,
  LeadRepository,
} from "./types";

// ============================================================
// phone.ts
// ============================================================
describe("normalizeArgentinePhone", () => {
  it("normaliza un móvil AR bien formado con prefijo p:", () => {
    const r = normalizeArgentinePhone("p:+543795586866");
    expect(r.digits).toBe("543795586866");
    expect(r.valid).toBe(true);
    expect(r.e164).toBe("+543795586866");
  });

  it("recupera un número malformado sin código de país (Hoja 1)", () => {
    const r = normalizeArgentinePhone("p:+3624101510");
    expect(r.digits).toBe("543624101510");
    expect(r.valid).toBe(true);
  });

  it("quita el trunk 0 de discado nacional", () => {
    const r = normalizeArgentinePhone("03795586866");
    expect(r.digits).toBe("543795586866");
    expect(r.valid).toBe(true);
  });

  it("marca inválido lo que no puede normalizar", () => {
    expect(normalizeArgentinePhone("").valid).toBe(false);
    expect(normalizeArgentinePhone("abc").valid).toBe(false);
  });

  it("inserta el 9 para wa.me en móviles AR", () => {
    expect(toWhatsAppNumber("543795586866")).toBe("5493795586866");
    // No duplica el 9 si ya está.
    expect(toWhatsAppNumber("5493795586866")).toBe("5493795586866");
  });
});

// ============================================================
// mapping.ts — detección del id por contenido (trampa Hoja 2)
// ============================================================
describe("detección del meta_lead_id por contenido", () => {
  it("Hoja 1/3: id en la primera columna", () => {
    const raw = {
      headers: ["id", "full_name", "phone_number", "lead_status"],
      rows: [["l:1678245683224571", "Juan Perez", "p:+543425085926", "calificado"]],
    };
    const { columns, mapRow } = createLeadMapper(raw);
    expect(columns.metaLeadId).toBe(0);
    const { lead } = mapRow(raw.rows[0]);
    expect(lead?.metaLeadId).toBe("l:1678245683224571");
    expect(lead?.phoneValid).toBe(true);
    expect(lead?.name).toBe("Juan Perez");
  });

  it("Hoja 2 (trampa): id real bajo header corrupto, decoy 'id' vacío", () => {
    const raw = {
      headers: ["¡", "full_name", "phone_number", "ciudad", "lead_status", "id"],
      rows: [
        [
          "l:1736506344033192",
          "Barrios Flavia",
          "p:+543795586866",
          "Corrientes",
          "calificado",
          "", // columna decoy "id" VACÍA
        ],
      ],
    };
    const { columns, mapRow } = createLeadMapper(raw);
    // Debe elegir la columna 0 (contenido l:...), NO la 5 (header "id" vacío).
    expect(columns.metaLeadId).toBe(0);
    const { lead, error } = mapRow(raw.rows[0]);
    expect(error).toBeUndefined();
    expect(lead?.metaLeadId).toBe("l:1736506344033192");
    expect(lead?.customFields["Ciudad"]).toBe("Corrientes");
  });

  it("manda a cuarentena una fila sin id de lead válido", () => {
    const raw = {
      headers: ["id", "full_name", "phone_number"],
      rows: [["", "Sin Id", "p:+543795586866"]],
    };
    const { mapRow } = createLeadMapper(raw);
    const { lead, error } = mapRow(raw.rows[0]);
    expect(lead).toBeUndefined();
    expect(error).toBeTruthy();
  });

  it("las preguntas calificadoras van a custom fields", () => {
    const raw = {
      headers: ["id", "¿qué_edad_tenés?", "full_name", "phone_number"],
      rows: [["l:999", "35", "Ana", "p:+543795586866"]],
    };
    const { mapRow } = createLeadMapper(raw);
    const { lead } = mapRow(raw.rows[0]);
    expect(lead?.customFields["qué edad tenés"]).toBe("35");
  });

  it("detectColumnByContent ignora columnas sin celdas no vacías", () => {
    const idx = detectColumnByContent(
      [["l:1", ""], ["l:2", ""]],
      (v) => /^l:\d+$/.test(v),
      2,
    );
    expect(idx).toBe(0);
  });
});

// ============================================================
// ingest.ts — claim-first anti-duplicados (con repo fake)
// ============================================================
class FakeRepo implements LeadRepository {
  leads = new Map<
    string,
    {
      leadId: string;
      metaLeadId: string;
      status: "claimed" | "processed";
      contactId: string | null;
      dealId: string | null;
      sheetStatus: string | null;
      syncedStageId: string | null;
    }
  >();
  contacts: { id: string; phone: string }[] = [];
  deals: { id: string; assigned: string | null; stageId: string }[] = [];
  quarantined: { reason: string }[] = [];
  private seq = 0;
  private nid(p: string) {
    return p + ++this.seq;
  }

  async claimLead(metaLeadId: string): Promise<ClaimedLead> {
    for (const l of this.leads.values()) {
      if (l.metaLeadId === metaLeadId) {
        return {
          leadId: l.leadId,
          status: l.status,
          isNew: false,
          dealId: l.dealId,
          contactId: l.contactId,
          sheetStatus: l.sheetStatus,
          syncedStageId: l.syncedStageId,
        };
      }
    }
    const leadId = this.nid("lead_");
    this.leads.set(leadId, {
      leadId, metaLeadId, status: "claimed", contactId: null, dealId: null,
      sheetStatus: null, syncedStageId: null,
    });
    return {
      leadId, status: "claimed", isNew: true, dealId: null, contactId: null,
      sheetStatus: null, syncedStageId: null,
    };
  }
  async findOrCreateContact({ phoneE164 }: { phoneE164: string | null }) {
    const key = phoneE164 ?? "";
    const found = this.contacts.find((c) => c.phone === key);
    if (found) return { id: found.id };
    const id = this.nid("contact_");
    this.contacts.push({ id, phone: key });
    return { id };
  }
  async setCustomValues() {}
  async addNote() {}
  async createDeal({ leadId, stageId }: { leadId: string; contactId: string; title: string; stageId?: string | null }) {
    const id = this.nid("deal_");
    const stage = stageId ?? "stage_default";
    this.deals.push({ id, assigned: null, stageId: stage });
    const l = this.leads.get(leadId);
    if (l) l.dealId = id;
    return { id, stageId: stage };
  }
  async setLeadContact(leadId: string, contactId: string) {
    const l = this.leads.get(leadId);
    if (l) l.contactId = contactId;
  }
  async listAssignableAgents(): Promise<AssignableAgent[]> {
    return [
      { userId: "u1", openDeals: 0 },
      { userId: "u2", openDeals: 3 },
    ];
  }
  async assignDealIfUnassigned(dealId: string, userId: string) {
    const d = this.deals.find((x) => x.id === dealId);
    if (d && !d.assigned) d.assigned = userId;
  }
  async finalizeLead(
    leadId: string,
    data: { sheetStatus: string | null; syncedStageId: string | null },
  ) {
    const l = this.leads.get(leadId);
    if (l) {
      l.status = "processed";
      l.sheetStatus = data.sheetStatus;
      l.syncedStageId = data.syncedStageId;
    }
  }
  async getDealStage(dealId: string): Promise<string | null> {
    return this.deals.find((d) => d.id === dealId)?.stageId ?? null;
  }
  async moveDealStage(dealId: string, stageId: string) {
    const d = this.deals.find((x) => x.id === dealId);
    if (d) d.stageId = stageId;
  }
  async recordSheetStatus(leadId: string, sheetStatus: string | null, syncedStageId: string | null) {
    const l = this.leads.get(leadId);
    if (l) {
      l.sheetStatus = sheetStatus;
      l.syncedStageId = syncedStageId;
    }
  }
  async quarantine(_row: Record<string, string>, reason: string) {
    this.quarantined.push({ reason });
  }
}

function makeLead(metaLeadId: string) {
  return {
    metaLeadId,
    name: "Test Lead",
    phoneRaw: "543795586866",
    phoneE164: "+543795586866",
    phoneValid: true,
    email: null,
    attribution: {
      platform: null, isOrganic: null, campaignId: null, campaignName: null,
      adsetId: null, adsetName: null, adId: null, adName: null, formId: null, formName: null,
    },
    leadCreatedTime: null,
    customFields: {},
    comments: null,
    statusRaw: null,
    raw: {},
  };
}

describe("ingestLead (claim-first)", () => {
  it("ingesta un lead nuevo: contacto + deal + asignación least-loaded", async () => {
    const repo = new FakeRepo();
    const res = await ingestLead(repo, makeLead("l:1"), { autoAssign: true });
    expect(res.outcome).toBe("processed");
    expect(repo.contacts).toHaveLength(1);
    expect(repo.deals).toHaveLength(1);
    expect(repo.deals[0].assigned).toBe("u1"); // menos cargado
    expect([...repo.leads.values()][0].status).toBe("processed");
  });

  it("no duplica ante el mismo meta_lead_id (dedupe)", async () => {
    const repo = new FakeRepo();
    await ingestLead(repo, makeLead("l:1"), { autoAssign: true });
    const res2 = await ingestLead(repo, makeLead("l:1"), { autoAssign: true });
    expect(res2.outcome).toBe("skipped_duplicate");
    expect(repo.deals).toHaveLength(1); // sigue habiendo UN solo deal
  });

  it("reanuda un lead 'claimed' sin recrear el deal (crash recovery)", async () => {
    const repo = new FakeRepo();
    // Simula un claim previo que ya creó contacto+deal pero no finalizó.
    repo.leads.set("lead_x", {
      leadId: "lead_x", metaLeadId: "l:9", status: "claimed",
      contactId: "contact_prev", dealId: "deal_prev",
      sheetStatus: null, syncedStageId: null,
    });
    repo.deals.push({ id: "deal_prev", assigned: null, stageId: "stage_default" });
    const res = await ingestLead(repo, makeLead("l:9"), { autoAssign: true });
    expect(res.outcome).toBe("resumed");
    expect(repo.deals).toHaveLength(1); // no se creó un segundo deal
    expect([...repo.leads.values()][0].status).toBe("processed");
  });

  it("usa la etapa mapeada por lead_status al crear el deal", async () => {
    const repo = new FakeRepo();
    const lead = { ...makeLead("l:20"), statusRaw: "calificado" };
    await ingestLead(repo, lead, {
      autoAssign: false,
      statusToStage: { calificado: "stage_calificado" },
    });
    expect(repo.deals[0].stageId).toBe("stage_calificado");
    const stored = [...repo.leads.values()][0];
    expect(stored.sheetStatus).toBe("calificado");
    expect(stored.syncedStageId).toBe("stage_calificado");
  });

  it("cae a la etapa default si el estado no está mapeado", async () => {
    const repo = new FakeRepo();
    const lead = { ...makeLead("l:21"), statusRaw: "algo-raro" };
    await ingestLead(repo, lead, { autoAssign: false, statusToStage: {} });
    expect(repo.deals[0].stageId).toBe("stage_default");
  });

  it("el lookup de estado es case-insensitive como fallback", async () => {
    const repo = new FakeRepo();
    const lead = { ...makeLead("l:22"), statusRaw: "Calificado" };
    await ingestLead(repo, lead, {
      autoAssign: false,
      statusToStage: { calificado: "stage_calificado" },
    });
    expect(repo.deals[0].stageId).toBe("stage_calificado");
  });
});

describe("pickLeastLoaded", () => {
  it("elige al de menor carga", () => {
    const pick = pickLeastLoaded([
      { userId: "a", openDeals: 5 },
      { userId: "b", openDeals: 1 },
    ]);
    expect(pick?.userId).toBe("b");
  });
  it("devuelve null sin asesores", () => {
    expect(pickLeastLoaded([])).toBeNull();
  });
});

describe("sync de estados planilla→CRM (leads procesados)", () => {
  const MAP = {
    CREATED: "stage_nuevo",
    calificado: "stage_calificado",
    "closed-won": "stage_won",
  };
  async function seedProcessed(repo: FakeRepo, status: string, stage: string) {
    await ingestLead(repo, { ...makeLead("l:50"), statusRaw: status }, {
      autoAssign: false,
      statusToStage: MAP,
    });
    expect(repo.deals[0].stageId).toBe(stage);
  }

  it("mueve el deal cuando el estado cambia en la hoja", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "calificado" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("stage_synced");
    expect(repo.deals[0].stageId).toBe("stage_calificado");
    expect([...repo.leads.values()][0].sheetStatus).toBe("calificado");
    expect([...repo.leads.values()][0].syncedStageId).toBe("stage_calificado");
  });

  it("no mueve nada si el estado no cambió", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "CREATED" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("skipped_duplicate");
    expect(repo.deals[0].stageId).toBe("stage_nuevo");
  });

  it("si un humano movió el deal en el Kanban, la planilla pierde el control", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    repo.deals[0].stageId = "stage_cotizado"; // movimiento manual en el CRM
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "calificado" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("skipped_duplicate");
    expect(repo.deals[0].stageId).toBe("stage_cotizado"); // no lo pisó
    const stored = [...repo.leads.values()][0];
    expect(stored.sheetStatus).toBe("calificado"); // igual registra lo visto
    expect(stored.syncedStageId).toBeNull(); // control manual permanente
    // y una pasada posterior tampoco lo toca
    const res2 = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "closed-won" },
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res2.outcome).toBe("skipped_duplicate");
    expect(repo.deals[0].stageId).toBe("stage_cotizado");
  });

  it("estado sin mapeo: registra sheet_status pero no mueve", async () => {
    const repo = new FakeRepo();
    await seedProcessed(repo, "CREATED", "stage_nuevo");
    const res = await ingestLead(
      repo,
      { ...makeLead("l:50"), statusRaw: "perdido" }, // no está en MAP
      { autoAssign: false, statusToStage: MAP },
    );
    expect(res.outcome).toBe("skipped_duplicate");
    expect(res.reason).toBe("estado sin mapeo");
    expect(repo.deals[0].stageId).toBe("stage_nuevo");
    expect([...repo.leads.values()][0].sheetStatus).toBe("perdido");
  });
});

// ============================================================
// mapping.ts — renombres custom, ignore y suggestMapping (wizard)
// ============================================================
describe("ColumnMapping.custom e ignore", () => {
  const raw = {
    headers: ["id", "¿qué_edad_tenés?", "full_name", "phone_number", "Cimentarios", "lead_status"],
    rows: [["l:1", "35", "Ana", "p:+543795586866", "llamar tarde", "calificado"]],
  };

  it("renombra un custom field con el nombre elegido", () => {
    const { mapRow } = createLeadMapper(raw, {
      custom: { "¿qué_edad_tenés?": "Edad" },
    });
    const { lead } = mapRow(raw.rows[0]);
    expect(lead?.customFields["Edad"]).toBe("35");
    expect(lead?.customFields["qué edad tenés"]).toBeUndefined();
  });

  it("ignora columnas listadas en ignore", () => {
    const { mapRow } = createLeadMapper(raw, { ignore: ["cimentarios"] });
    const { lead } = mapRow(raw.rows[0]);
    expect(Object.values(lead?.customFields ?? {})).not.toContain("llamar tarde");
  });

  it("mapea 'Cimentarios' (typo real) a comments vía canonical", () => {
    const { mapRow } = createLeadMapper(raw, {
      canonical: { comments: "Cimentarios" },
    });
    const { lead } = mapRow(raw.rows[0]);
    expect(lead?.comments).toBe("llamar tarde");
  });
});

describe("suggestMapping (wizard)", () => {
  it("sugiere canónicos, customs y devuelve los valores de estado (Hoja 2 real)", () => {
    const raw = {
      headers: ["¡", "created_time", "full_name", "phone_number", "ciudad", "¿qué_edad_tenés?", "lead_status", "id"],
      rows: [
        ["l:1736506344033192", "2026-06-15T23:16:04-05:00", "Flavia", "p:+543795586866", "Corrientes", "40", "calificado", ""],
        ["l:1736506344033193", "2026-06-16T10:00:00-05:00", "Marta", "p:+543624101510", "Chaco", "51", "CREATED", ""],
      ],
    };
    const s = suggestMapping(raw);
    const byHeader = Object.fromEntries(s.columns.map((c) => [c.header, c]));
    expect(byHeader["¡"].kind).toBe("canonical");
    expect(byHeader["¡"].field).toBe("metaLeadId"); // contenido gana al header
    expect(byHeader["phone_number"].field).toBe("phone");
    expect(byHeader["¿qué_edad_tenés?"].kind).toBe("custom");
    expect(byHeader["¿qué_edad_tenés?"].label).toBe("qué edad tenés");
    expect(byHeader["¡"].samples[0]).toBe("l:1736506344033192");
    expect(s.statusValues.sort()).toEqual(["CREATED", "calificado"]);
    // la columna decoy "id" (vacía) no debe sugerirse como metaLeadId
    expect(byHeader["id"]?.field).not.toBe("metaLeadId");
  });
});

// ============================================================
// meta-api.ts — mapeo de un lead crudo de la Graph API
// ============================================================
describe("mapApiLead", () => {
  // Estructura real verificada en vivo (2026-07-06), valores de fantasía.
  const RAW = {
    id: "1053045053958358",
    created_time: "2026-07-03T12:43:00+0000",
    ad_id: "120248319395160383",
    ad_name: "Ad Video Testimonio",
    adset_id: "120248319395110383",
    adset_name: "Conjunto CBA 25-45",
    campaign_id: "120248319395100383",
    campaign_name: "Leads Salud Julio",
    form_id: "833520326281165",
    is_organic: false,
    platform: "ig",
    field_data: [
      { name: "¿para_cuántas_personas_buscás_cobertura?", values: ["para mí y mi familia"] },
      { name: "¿qué_edad_tenés?", values: ["entre_30_y_40"] },
      { name: "full_name", values: ["Cecilia Prueba"] },
      { name: "phone_number", values: ["+543795586866"] },
      { name: "city", values: ["Corrientes"] },
      { name: "código_postal", values: ["3400"] },
    ],
  };

  it("mapea un lead real de la API a NormalizedLead", () => {
    const lead = mapApiLead(RAW, "Form Dependencia-Monotrib 2026 - Loc Fabi (v1)");
    expect(lead.metaLeadId).toBe("l:1053045053958358"); // dedupe con planillas
    expect(lead.name).toBe("Cecilia Prueba");
    expect(lead.phoneE164).toBe("+543795586866");
    expect(lead.phoneValid).toBe(true);
    expect(lead.customFields["Ciudad"]).toBe("Corrientes");
    expect(lead.customFields["Código Postal"]).toBe("3400");
    expect(lead.customFields["qué edad tenés"]).toBe("entre_30_y_40");
    expect(lead.attribution.campaignName).toBe("Leads Salud Julio");
    expect(lead.attribution.formId).toBe("833520326281165");
    expect(lead.attribution.formName).toBe("Form Dependencia-Monotrib 2026 - Loc Fabi (v1)");
    expect(lead.attribution.isOrganic).toBe(false);
    expect(lead.attribution.platform).toBe("ig");
    expect(lead.leadCreatedTime).toBe("2026-07-03T12:43:00.000Z");
    expect(lead.statusRaw).toBeNull(); // la API no trae estado: manda el CRM
  });

  it("respeta renombres e ignore del column_mapping", () => {
    const lead = mapApiLead(RAW, null, {
      custom: { "¿qué_edad_tenés?": "Edad" },
      ignore: ["¿para_cuántas_personas_buscás_cobertura?"],
    });
    expect(lead.customFields["Edad"]).toBe("entre_30_y_40");
    expect(lead.customFields["qué edad tenés"]).toBeUndefined();
    expect(Object.values(lead.customFields)).not.toContain("para mí y mi familia");
  });

  it("normaliza teléfonos AR malformados y marca inválidos", () => {
    const raw = {
      ...RAW,
      id: "99",
      field_data: [{ name: "phone_number", values: ["3624101510"] }],
    };
    const lead = mapApiLead(raw, null);
    expect(lead.metaLeadId).toBe("l:99");
    expect(lead.phoneE164).toBe("+543624101510"); // recuperó el 54
    expect(lead.phoneValid).toBe(true);
  });
});

// ============================================================
// capi.ts — payload de Conversion Leads (evento custom + lead_id)
// ============================================================
describe("buildEventPayload (CAPI)", () => {
  it("incluye lead_id numérico y el evento custom closed-won", () => {
    const p = buildEventPayload({
      datasetId: "796135859815097",
      accessToken: "x",
      eventName: "closed-won",
      eventId: "lead_1:closed-won",
      eventTimeSec: 1751800000,
      userData: { em: ["hash_email"] },
      leadId: "l:1053045053958358",
    });
    const ev = p.data[0] as Record<string, unknown>;
    expect(ev.event_name).toBe("closed-won");
    expect(ev.action_source).toBe("system_generated");
    const ud = ev.user_data as Record<string, unknown>;
    expect(ud.lead_id).toBe(1053045053958358); // sin prefijo l:, numérico
    expect(ud.em).toEqual(["hash_email"]);
  });

  it("sin leadId no agrega lead_id (retrocompatible)", () => {
    const p = buildEventPayload({
      datasetId: "d",
      accessToken: "x",
      eventName: "Lead",
      eventId: "e",
      eventTimeSec: 1,
      userData: {},
    });
    const ud = (p.data[0] as Record<string, unknown>).user_data as Record<string, unknown>;
    expect(ud.lead_id).toBeUndefined();
  });
});

describe("parseSheetUrl", () => {
  it("extrae id y gid de una URL completa", () => {
    const r = parseSheetUrl(
      "https://docs.google.com/spreadsheets/d/1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8/edit?gid=217367597#gid=217367597",
    );
    expect(r.spreadsheetId).toBe("1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8");
    expect(r.gid).toBe("217367597");
  });
  it("acepta un ID pelado", () => {
    const r = parseSheetUrl("1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8");
    expect(r.spreadsheetId).toBe("1IU3J6s5i8mCDTmJaXkHKbBQfbde_ldJuMJ9SeyiPzK8");
    expect(r.gid).toBeNull();
  });
  it("rechaza texto que no es URL ni ID", () => {
    expect(parseSheetUrl("hola mundo").spreadsheetId).toBeNull();
  });
});
