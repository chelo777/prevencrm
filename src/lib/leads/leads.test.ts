import { describe, it, expect } from "vitest";
import { normalizeArgentinePhone, toWhatsAppNumber } from "./phone";
import { createLeadMapper, detectColumnByContent } from "./mapping";
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
    { leadId: string; metaLeadId: string; status: "claimed" | "processed"; contactId: string | null; dealId: string | null }
  >();
  contacts: { id: string; phone: string }[] = [];
  deals: { id: string; assigned: string | null }[] = [];
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
        };
      }
    }
    const leadId = this.nid("lead_");
    this.leads.set(leadId, { leadId, metaLeadId, status: "claimed", contactId: null, dealId: null });
    return { leadId, status: "claimed", isNew: true, dealId: null, contactId: null };
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
  async createDeal({ leadId }: { leadId: string }) {
    const id = this.nid("deal_");
    this.deals.push({ id, assigned: null });
    const l = this.leads.get(leadId);
    if (l) l.dealId = id;
    return { id };
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
  async finalizeLead(leadId: string) {
    const l = this.leads.get(leadId);
    if (l) l.status = "processed";
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
    });
    repo.deals.push({ id: "deal_prev", assigned: null });
    const res = await ingestLead(repo, makeLead("l:9"), { autoAssign: true });
    expect(res.outcome).toBe("resumed");
    expect(repo.deals).toHaveLength(1); // no se creó un segundo deal
    expect([...repo.leads.values()][0].status).toBe("processed");
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
