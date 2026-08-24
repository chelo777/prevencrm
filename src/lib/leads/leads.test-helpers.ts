// ============================================================
// FakeRepo — implementación in-memory del puerto LeadRepository,
// usada por los tests de dominio (ingest.ts, assign.ts, reclaim.ts).
// Movida acá desde leads.test.ts para reusarla entre archivos de test.
// ============================================================

import type {
  AssignEventKind,
  ClaimedLead,
  EligibleAgent,
  LeadRepository,
  OpenPackage,
  StaleLead,
} from "./types";

export class FakeRepo implements LeadRepository {
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
  eligible: EligibleAgent[] = [
    { userId: "u1", openDeals: 0, lastAssignedAt: null },
    { userId: "u2", openDeals: 1, lastAssignedAt: null },
  ];
  /** Reloj del fake: cada entrega avanza un tick, para ordenar la rotación. */
  private tick = 0;
  events: { userId: string; dealId: string; kind: AssignEventKind }[] = [];
  stale: StaleLead[] = [];
  /** Admins que reciben los avisos de lead liberado. */
  admins: string[] = ["admin1"];
  /** user_id -> nombre visible, para redactar el aviso. */
  agentNames: Record<string, string> = {};
  notifications: {
    userId: string;
    leadId: string;
    contactId: string | null;
    title: string;
    body: string;
  }[] = [];
  /** Tandas del modo `quota`. `delivered` lo lleva el propio fake al sellar. */
  packages: (OpenPackage & { status: "open" | "completed" })[] = [];
  /** Sellos leads.package_id aplicados (leadId -> packageId). */
  sealed = new Map<string, string>();
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
  async listEligibleAgents(): Promise<EligibleAgent[]> {
    return this.eligible;
  }
  async listOpenPackages(): Promise<OpenPackage[]> {
    // El adaptador real ya filtra por status/comprador habilitado; el fake
    // replica eso devolviendo solo las abiertas.
    return this.packages
      .filter((p) => p.status === "open")
      .map(
        ({
          packageId,
          buyerUserId,
          leadsTarget,
          delivered,
          createdAt,
          lastDeliveredAt,
        }) => ({
          packageId,
          buyerUserId,
          leadsTarget,
          delivered,
          createdAt,
          lastDeliveredAt: lastDeliveredAt ?? null,
        }),
      );
  }
  async markPackageCompleted(packageId: string) {
    const p = this.packages.find((x) => x.packageId === packageId);
    if (p && p.status === "open") p.status = "completed";
  }
  async sealLeadPackage(leadId: string, packageId: string) {
    if (this.sealed.has(leadId)) return; // no re-sella
    this.sealed.set(leadId, packageId);
    const p = this.packages.find((x) => x.packageId === packageId);
    if (p) {
      p.delivered++;
      // Espeja el adaptador real: sellar corre el turno de la tanda.
      p.lastDeliveredAt = `2026-08-22T00:00:${String(this.tick++).padStart(2, "0")}Z`;
    }
  }
  async assignDealIfUnassigned(dealId: string, userId: string): Promise<boolean> {
    const d = this.deals.find((x) => x.id === dealId);
    if (d && !d.assigned) {
      d.assigned = userId;
      return true;
    }
    return false;
  }
  async recordAssignEvent(userId: string, dealId: string, kind: AssignEventKind) {
    this.events.push({ userId, dealId, kind });
    // El adaptador real deriva `lastAssignedAt` del activity_log: registrar
    // la asignación es lo que corre el turno del asesor en el pozo común.
    if (kind === "lead_assigned") {
      const agent = this.eligible.find((a) => a.userId === userId);
      if (agent) {
        agent.lastAssignedAt = `2026-08-22T00:00:${String(this.tick++).padStart(2, "0")}Z`;
      }
    }
  }
  async unassignDeal(dealId: string) {
    const d = this.deals.find((x) => x.id === dealId);
    if (d) d.assigned = null;
  }
  async listAccountAdmins() {
    return this.admins;
  }
  async getAgentName(userId: string) {
    return this.agentNames[userId] ?? null;
  }
  async notifyLeadReclaimed(input: {
    userId: string;
    leadId: string;
    contactId: string | null;
    title: string;
    body: string;
  }) {
    this.notifications.push(input);
  }
  async listStaleAssignedLeads() {
    return this.stale;
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
