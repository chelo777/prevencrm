// ============================================================
// Contabilidad de compradoras de datos — tipos + puerto.
//
// Mismo patrón que el módulo de leads: las funciones de cálculo son PURAS
// (metrics.ts) y el acceso a datos pasa por el puerto `AccountingRepository`,
// con adaptador Supabase (repository.ts) y fake en memoria en los tests.
// ============================================================

export type PackageStatus = "open" | "completed" | "cancelled";

/** Estado de pago DERIVADO (no se persiste): sale de price vs. pagado. */
export type PaymentStatus = "PAGADO" | "PARCIAL" | "DEBE";

export interface LeadPackage {
  id: string;
  accountId: string;
  buyerUserId: string;
  ordinal: number;
  leadsTarget: number;
  price: number;
  currency: string;
  status: PackageStatus;
  committedAt: string | null; // DATE ISO (YYYY-MM-DD)
  createdAt: string;
  completedAt: string | null;
}

export interface PackagePayment {
  id: string;
  packageId: string;
  paidOn: string; // DATE ISO
  amount: number;
  note: string | null;
}

/** Insight de campaña (handoff §6.1). Solo se usa `spend` para el prorrateo. */
export interface CampaignInsight {
  metaCampaignId: string;
  campaignName: string | null;
  spend: number | null;
  impressions?: number | null;
  clicks?: number | null;
}

/** Lead entregado contra una tanda — lo mínimo para prorratear el costo. */
export interface DeliveredLead {
  packageId: string;
  campaignId: string | null;
}

/** Métricas calculadas de una tanda. Todo server-side. */
export interface PackageMetrics {
  packageId: string;
  buyerUserId: string;
  ordinal: number;
  status: PackageStatus;
  currency: string;
  committedAt: string | null;
  createdAt: string;

  price: number;
  leadsTarget: number;
  /** price / leadsTarget */
  pricePerLead: number;
  /** count(leads.package_id = id) */
  delivered: number;
  /** delivered / leadsTarget (0..1, puede pasar 1 si se sobre-entregó) */
  deliveredPct: number;

  paid: number;
  /** price − paid. Negativo = saldo a favor de la compradora. */
  balance: number;
  /** paid / price (0..1+) */
  paidPct: number;
  paymentStatus: PaymentStatus;

  /** Costo Meta atribuido por prorrateo por lead (ver metrics.ts). */
  metaCost: number;
  /** price − metaCost */
  margin: number;
}

/** Agregado por compradora. */
export interface BuyerTotals {
  buyerUserId: string;
  packages: number;
  openPackages: number;
  /** Suma de price de tandas NO canceladas. */
  totalPurchased: number;
  totalPaid: number;
  balance: number;
  delivered: number;
  metaCost: number;
  margin: number;
  paymentStatus: PaymentStatus;
}

/** Totales globales de la cabecera del panel. */
export interface GlobalTotals {
  /** Suma de price de tandas NO canceladas. */
  toCollect: number;
  /** Dinero efectivamente recibido (incluye pagos de tandas canceladas). */
  collected: number;
  /** Deuda pendiente: solo tandas no canceladas y sin contar saldos a favor. */
  owed: number;
  /** Gasto Meta TOTAL del período (todas las campañas con insight). */
  metaSpend: number;
  /** toCollect − metaSpend */
  margin: number;
}

// ------------------------------------------------------------
// Puerto
// ------------------------------------------------------------
export interface CreatePackageInput {
  buyerUserId: string;
  leadsTarget: number;
  price: number;
  committedAt: string | null;
}

export interface UpdatePackageInput {
  leadsTarget?: number;
  price?: number;
  committedAt?: string | null;
  status?: PackageStatus;
}

export interface CreatePaymentInput {
  packageId: string;
  paidOn: string;
  amount: number;
  note: string | null;
}

export interface AccountingRepository {
  listPackages(): Promise<LeadPackage[]>;
  listPayments(): Promise<PackagePayment[]>;
  /** Leads entregados (con package_id no nulo) + su campaña de origen. */
  listDeliveredLeads(): Promise<DeliveredLead[]>;
  /** Cuántos leads tiene cada campaña EN TOTAL (denominador del prorrateo). */
  leadCountByCampaign(): Promise<Record<string, number>>;
  listCampaignInsights(): Promise<CampaignInsight[]>;

  /** Siguiente ordinal para ese comprador (1 si no tiene tandas). */
  nextOrdinal(buyerUserId: string): Promise<number>;
  createPackage(input: CreatePackageInput & { ordinal: number }): Promise<LeadPackage>;
  updatePackage(id: string, input: UpdatePackageInput): Promise<LeadPackage>;
  createPayment(input: CreatePaymentInput): Promise<PackagePayment>;
}
