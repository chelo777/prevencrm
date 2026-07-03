// ============================================================
// Tipos del dominio "Leads Meta" + el puerto de repositorio.
//
// El servicio de ingesta (ingest.ts) depende SOLO de este puerto,
// no de Supabase. Así se testea con un fake en memoria (ver
// ingest.test.ts) y el adaptador real (repository.ts) queda aislado.
// ============================================================

/** Filas crudas leídas de una fuente (Google Sheet), header-agnósticas. */
export interface RawSheetData {
  headers: string[];
  /** Cada fila alineada a `headers` por índice. */
  rows: string[][];
}

/** Atribución de campaña de Meta, para reporting y CAPI. */
export interface LeadAttribution {
  platform: string | null;
  isOrganic: boolean | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string | null;
  formName: string | null;
}

/**
 * Un lead ya normalizado, listo para ingestar. Producido por los
 * adaptadores de fuente (Sheets / webhook). El servicio de ingesta
 * no sabe de qué formato vino.
 */
export interface NormalizedLead {
  /** `l:...` de Meta. Clave de dedupe. Siempre presente y validada. */
  metaLeadId: string;
  name: string | null;
  /** Teléfono tal cual vino (sin prefijo `p:`), para trazabilidad. */
  phoneRaw: string | null;
  /** Teléfono canónico E.164 AR, o null si no se pudo normalizar. */
  phoneE164: string | null;
  /** false => no se pudo normalizar; el lead se crea pero se marca. */
  phoneValid: boolean;
  email: string | null;
  attribution: LeadAttribution;
  /** ISO 8601 del `created_time` de Meta, o null. */
  leadCreatedTime: string | null;
  /** Preguntas calificadoras / ciudad / CP => custom fields (header -> valor). */
  customFields: Record<string, string>;
  comments: string | null;
  /** `lead_status` de la hoja. Solo lo usa el import histórico. */
  statusRaw: string | null;
  /** Fila original completa (header -> valor) para raw_payload. */
  raw: Record<string, string>;
}

/** Config de una fuente ya cargada desde `lead_sources`. */
export interface LeadSourceConfig {
  id: string;
  accountId: string;
  ownerUserId: string;
  name: string;
  spreadsheetId: string | null;
  sheetGid: string | null;
  columnMapping: ColumnMapping;
  pipelineId: string;
  defaultStageId: string;
  autoAssign: boolean;
}

/** Overrides opcionales de mapeo (todo auto-detectable si está vacío). */
export interface ColumnMapping {
  canonical?: Partial<Record<CanonicalField, string>>;
  /** header normalizado -> nombre elegido para el custom field. */
  custom?: Record<string, string>;
  /** headers normalizados que no se ingestan. */
  ignore?: string[];
  /** valor de lead_status (tal cual la hoja) -> pipeline_stages.id. */
  statusToStage?: Record<string, string>;
}

/** Sugerencia de clasificación de una columna, para el wizard. */
export interface ColumnSuggestion {
  index: number;
  header: string;
  samples: string[];
  kind: "canonical" | "custom" | "ignore";
  field?: CanonicalField;
  label?: string;
}

export interface MappingSuggestion {
  columns: ColumnSuggestion[];
  statusValues: string[];
}

export type CanonicalField =
  | "metaLeadId"
  | "name"
  | "phone"
  | "email"
  | "city"
  | "postalCode"
  | "comments"
  | "status"
  | "createdTime"
  | "platform"
  | "isOrganic"
  | "campaignId"
  | "campaignName"
  | "adsetId"
  | "adsetName"
  | "adId"
  | "adName"
  | "formId"
  | "formName";

/** Un asesor asignable con su carga actual (deals abiertos en el pipeline). */
export interface AssignableAgent {
  userId: string;
  openDeals: number;
}

export type IngestOutcome =
  | "processed"
  | "skipped_duplicate"
  | "resumed"
  | "quarantined";

export interface IngestResult {
  outcome: IngestOutcome;
  leadId?: string;
  reason?: string;
}

/** Fila mínima de un lead reclamado, para decidir reanudación. */
export interface ClaimedLead {
  leadId: string;
  status: "claimed" | "processed";
  /** true si el INSERT fue nuevo; false si ya existía (dedupe / reanudar). */
  isNew: boolean;
  dealId: string | null;
  contactId: string | null;
}

// ------------------------------------------------------------
// Puerto de repositorio — la única dependencia de ingest.ts.
// ------------------------------------------------------------
export interface LeadRepository {
  /**
   * Claim-first (B1/B3): reserva el meta_lead_id ANTES de crear nada.
   * INSERT ... ON CONFLICT DO NOTHING. Devuelve el estado actual para
   * decidir: nuevo -> procesar; existente 'processed' -> saltar;
   * existente 'claimed' -> reanudar sin duplicar.
   */
  claimLead(metaLeadId: string): Promise<ClaimedLead>;

  /** Resuelve o crea el contacto por teléfono (dedupe estilo 022). */
  findOrCreateContact(input: {
    phoneE164: string | null;
    phoneRaw: string | null;
    name: string | null;
    email: string | null;
  }): Promise<{ id: string }>;

  /** Setea custom values (upsert por custom_field, creando el field si falta). */
  setCustomValues(contactId: string, values: Record<string, string>): Promise<void>;

  /** Agrega una nota (Comentarios) si hay texto. */
  addNote(contactId: string, text: string): Promise<void>;

  /** Crea el deal en el pipeline destino y lo linkea al lead. */
  createDeal(input: {
    leadId: string;
    contactId: string;
    title: string;
  }): Promise<{ id: string }>;

  /** Marca contact_id en el lead reclamado (checkpoint de reanudación). */
  setLeadContact(leadId: string, contactId: string): Promise<void>;

  /** Lista asesores asignables ordenados por menor carga. */
  listAssignableAgents(): Promise<AssignableAgent[]>;

  /** Asigna el deal a un asesor solo si está sin asignar (idempotente). */
  assignDealIfUnassigned(dealId: string, userId: string): Promise<void>;

  /** Cierra el lead: status='processed' + atribución + raw + phone_valid. */
  finalizeLead(
    leadId: string,
    data: {
      attribution: LeadAttribution;
      leadCreatedTime: string | null;
      rawPayload: Record<string, string>;
      phoneValid: boolean;
    },
  ): Promise<void>;

  /** Manda una fila no ingestable a cuarentena. */
  quarantine(rawRow: Record<string, string>, reason: string): Promise<void>;
}
