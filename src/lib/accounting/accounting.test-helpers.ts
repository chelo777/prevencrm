// Fake en memoria del puerto AccountingRepository — mismo patrón que el
// FakeRepo del módulo de leads.

import type {
  AccountingRepository,
  CampaignInsight,
  CreatePackageInput,
  CreatePaymentInput,
  DeliveredLead,
  LeadPackage,
  PackagePayment,
  UpdatePackageInput,
} from "./types";

export function makePackage(over: Partial<LeadPackage> = {}): LeadPackage {
  return {
    id: over.id ?? "pkg_1",
    accountId: "acc_1",
    buyerUserId: over.buyerUserId ?? "buyer_1",
    ordinal: over.ordinal ?? 1,
    leadsTarget: over.leadsTarget ?? 50,
    price: over.price ?? 300000,
    currency: "ARS",
    status: over.status ?? "open",
    committedAt: over.committedAt ?? null,
    createdAt: over.createdAt ?? "2026-08-01T00:00:00Z",
    completedAt: over.completedAt ?? null,
  };
}

export class FakeAccountingRepo implements AccountingRepository {
  packages: LeadPackage[] = [];
  payments: PackagePayment[] = [];
  delivered: DeliveredLead[] = [];
  counts: Record<string, number> = {};
  insights: CampaignInsight[] = [];
  private seq = 0;

  async listPackages() {
    return this.packages;
  }
  async listPayments() {
    return this.payments;
  }
  async listDeliveredLeads() {
    return this.delivered;
  }
  async leadCountByCampaign() {
    return this.counts;
  }
  async listCampaignInsights() {
    return this.insights;
  }

  async nextOrdinal(buyerUserId: string) {
    const mine = this.packages.filter((p) => p.buyerUserId === buyerUserId);
    return mine.reduce((max, p) => Math.max(max, p.ordinal), 0) + 1;
  }

  async createPackage(input: CreatePackageInput & { ordinal: number }) {
    const pkg = makePackage({
      id: `pkg_${++this.seq}`,
      buyerUserId: input.buyerUserId,
      ordinal: input.ordinal,
      leadsTarget: input.leadsTarget,
      price: input.price,
      committedAt: input.committedAt,
    });
    this.packages.push(pkg);
    return pkg;
  }

  async updatePackage(id: string, input: UpdatePackageInput) {
    const pkg = this.packages.find((p) => p.id === id);
    if (!pkg) throw new Error("not found");
    Object.assign(pkg, input);
    return pkg;
  }

  async createPayment(input: CreatePaymentInput) {
    const payment: PackagePayment = {
      id: `pay_${++this.seq}`,
      packageId: input.packageId,
      paidOn: input.paidOn,
      amount: input.amount,
      note: input.note,
    };
    this.payments.push(payment);
    return payment;
  }
}
