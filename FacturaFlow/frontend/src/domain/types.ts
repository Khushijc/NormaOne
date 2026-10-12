/**
 * Domain model for Facturas y Gastos.
 *
 * Every persisted entity carries `companyId` (tenant key, BRD §17 / PLT-02) and a
 * stable `id`. Cross-entity references are explicit foreign-key-like `...Id` fields.
 * Monetary amounts are integer euro cents to avoid floating-point drift.
 *
 * This file is the starting point for the future database schema: see
 * docs/DATA_MODEL.md for the entity-relationship summary.
 */

export type ID = string;
/** Calendar date without time, `YYYY-MM-DD`. */
export type ISODate = string;
/** Instant in time, ISO 8601 UTC (`...Z`). Displayed in the company's time zone. */
export type ISODateTime = string;
/** Integer euro cents. */
export type Cents = number;

// ─────────────────────────────── Company & configuration ───────────────────────────────

export type TaxTerritory =
  | 'common_mainland'
  | 'common_balearic'
  | 'canarias'
  | 'ceuta'
  | 'melilla'
  | 'foral_alava'
  | 'foral_bizkaia'
  | 'foral_gipuzkoa'
  | 'foral_navarra';

/** Direct-tax position that drives the RRSIF deadline (S01). */
export type TaxpayerType = 'IS' | 'IRPF' | 'IRNR_EP' | 'other';

export type SifMode = 'verifactu' | 'no_verifactu' | 'undecided';

export type VatRegime = 'general' | 'criterio_caja' | 'recargo_equivalencia' | 'simplificado' | 'other';

export type ApplicabilityState = 'applicable' | 'not_applicable' | 'pending_review';

export interface Address {
  street: string;
  postalCode: string;
  city: string;
  province: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
}

export interface Company {
  id: ID;
  legalName: string;
  tradeName: string;
  nif: string;
  legalForm: 'SL' | 'SLU' | 'SA' | 'autonomo' | 'cooperativa' | 'other';
  registeredAddress: Address;
  worksites: string[];
  activity: string;
  cnae: string;
  employeeCount: number;
  taxAdministration: string;
  timezone: 'Europe/Madrid' | 'Atlantic/Canary';
  /** PLT-01: a responsible person reviews the profile before automation is enabled. */
  profileReviewedBy: string | null;
  profileReviewedAt: ISODate | null;
  modules: { finance: boolean; time: boolean; prl: boolean; privacy: boolean; notices: boolean };
  createdAt: ISODateTime;
}

/** A recorded applicability decision for a regulatory obligation (FIN-01, PLT-07). */
export interface ApplicabilityDecision {
  state: ApplicabilityState;
  /** Date by which the capability must be in place for this taxpayer (null if n/a or unknown). */
  deadline: ISODate | null;
  /** RuleVersion ids used to derive the decision. */
  ruleIds: ID[];
  basis: string;
  decidedBy: ID | null;
  reviewer: string | null;
  reviewedAt: ISODate | null;
  nextReview: ISODate | null;
}

export interface FinanceConfig {
  companyId: ID;
  taxpayerType: TaxpayerType;
  territory: TaxTerritory;
  siiParticipant: boolean;
  vatRegime: VatRegime;
  priorYearTurnoverBand: 'over_8m' | 'up_to_8m' | 'unknown';
  sifMode: SifMode;
  sif: ApplicabilityDecision;
  b2b: ApplicabilityDecision;
  /** FIN-09 (conditional): structured B2B exchange validated for this company. Always false in the prototype. */
  b2bConnectorValidated: boolean;
  /** IRPF withholding applied by an individual professional issuer (art. 101.5 LIRPF). */
  irpfWithholding: { applies: boolean; ratePct: number; basis: string };
  defaultPaymentTermsDays: number;
  /** Internal control (not a legal rule): approver must differ from the draft's author. */
  requireDifferentApprover: boolean;
  /** Tax codes approved for this company after adviser review (FIN-02). */
  approvedTaxCodes: string[];
  configApprovedBy: string | null;
  configApprovedAt: ISODate | null;
  responsibleAdviser: string;
}

export type ProviderScenario =
  | 'accept'
  | 'accept_with_errors'
  | 'reject'
  | 'timeout_processed'
  | 'timeout_not_processed'
  | 'outage';

export interface ProducerDeclaration {
  softwareName: string;
  softwareId: string;
  version: string;
  producerName: string;
  producerNif: string;
  declarationDate: ISODate;
  /** True in the prototype: the content is illustrative and not a real declaration. */
  demo: true;
}

export interface ProviderConfig {
  companyId: ID;
  providerName: string;
  /** Always 'sandbox_mock' in this prototype — no real provider or AEAT connection exists. */
  environment: 'sandbox_mock';
  status: 'approved' | 'not_configured' | 'expired' | 'suspended';
  authorisationRef: string;
  authorisationExpires: ISODate | null;
  componentVersion: string;
  producerDeclaration: ProducerDeclaration | null;
  supportedScenarios: string[];
  lastHealthCheckAt: ISODateTime | null;
  /** Simulation control: outcome the mock provider returns for the next issue request. */
  nextScenario: ProviderScenario;
}

export type SeriesKind = 'ordinary' | 'rectifying';

export interface InvoiceSeries {
  id: ID;
  companyId: ID;
  code: string;
  prefix: string;
  kind: SeriesKind;
  /** Next correlative number to assign at issue time. */
  nextNumber: number;
  padding: number;
  active: boolean;
  description: string;
}

/** Versioned legal/deadline rule (PLT-07, BRD §03). */
export interface RuleVersion {
  id: ID;
  key: string;
  title: string;
  jurisdiction: string;
  applicability: string;
  value: string;
  publicationDate: ISODate | null;
  effectiveDate: ISODate | null;
  sourceIds: string[];
  /** 'announced' = publicly announced change with no published legal instrument: never applied. */
  status: 'confirmed' | 'conditional' | 'unresolved' | 'professional_review' | 'announced';
  reviewer: string | null;
  nextReview: ISODate | null;
  supersedesId: ID | null;
  supersededById: ID | null;
  note: string;
}

export interface TaxCode {
  code: string;
  label: string;
  kind: 'vat' | 'exempt' | 'reverse_charge' | 'not_subject' | 'other_tax';
  ratePct: number;
  /** VERI*FACTU-style operation qualification (S1, S2, N1, N2) or exemption (E1-E6). Informational. */
  qualification: string | null;
  legalRef: string;
  /** Text that must appear on the invoice when this treatment is used. */
  mention: string | null;
  /** Product launch scope: unsupported treatments can never be issued in this release. */
  supportStatus: 'supported' | 'requires_review' | 'unsupported';
  note: string;
}

export interface CollectionPolicy {
  companyId: ID;
  /** Days after due date at which a reminder is due. */
  reminderOffsetsDays: number[];
  channel: 'email';
  suppressWhenDisputed: boolean;
  /** Late-payment interest is informational only (Ley 3/2004); not auto-charged. */
  showLatePaymentNotice: boolean;
}

// ─────────────────────────────── Identity & permissions ───────────────────────────────

export type RoleId = 'owner' | 'admin' | 'issuer' | 'employee' | 'supervisor' | 'gestoria';

export interface User {
  id: ID;
  name: string;
  email: string;
  title: string;
  /** Organisation for external users (e.g. the gestoría). */
  organisation: string | null;
}

export interface Membership {
  id: ID;
  userId: ID;
  companyId: ID;
  roles: RoleId[];
  status: 'active' | 'revoked';
  grantedBy: ID | null;
  grantedAt: ISODateTime;
  validUntil: ISODate | null;
  revokedAt: ISODateTime | null;
  revokedBy: ID | null;
  /** Supervisor: maximum expense they may approve. */
  approvalLimitCents: Cents | null;
  /** Supervisor: employees whose expenses they review. */
  teamUserIds: ID[];
  /** Gestoría: reference of the client mandate (BRD §05: explicit client mandate). */
  mandateRef: string | null;
}

// ─────────────────────────────── Parties ───────────────────────────────

export type PartyKind = 'company' | 'self_employed' | 'individual' | 'public_admin';
/** Aligned with AEAT IDType codes for non-NIF identifiers (02 NIF-IVA, 03 passport, 04 foreign official doc, 06 other). */
export type IdType = 'NIF' | 'NIF_IVA' | 'PASSPORT' | 'FOREIGN_ID' | 'OTHER' | 'NONE';

export interface PartyBase {
  id: ID;
  companyId: ID;
  kind: PartyKind;
  legalName: string;
  tradeName: string;
  idType: IdType;
  idNumber: string;
  address: Address;
  email: string;
  phone: string;
  contactName: string;
  notes: string;
  archived: boolean;
  archivedAt: ISODateTime | null;
  archivedReason: string | null;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Customer extends PartyBase {
  paymentTermsDays: number;
  deliveryChannel: 'email' | 'manual';
  defaultTaxCode: string;
}

export interface Supplier extends PartyBase {
  defaultCategory: string;
  /** Masked; only the last 4 characters are kept in the prototype. */
  ibanMasked: string;
  paymentTermsDays: number;
}

// ─────────────────────────────── Sales invoices ───────────────────────────────

export type DocumentStatus = 'draft' | 'approved' | 'issued' | 'rectified';
export type FiscalStatus = 'not_submitted' | 'pending' | 'accepted' | 'rejected' | 'needs_review';
export type ExchangeStatus = 'not_sent' | 'sent' | 'delivered' | 'delivery_failed' | 'accepted' | 'rejected';
export type CollectionStatus = 'unpaid' | 'partial' | 'paid' | 'disputed';

/** Rectification causes per art. 80 LIVA / RD 1619/2012 art. 15 (codes as used by AEAT records). */
export type RectificationReasonCode = 'R1' | 'R2' | 'R3' | 'R4';
export type RectificationMethod = 'substitution' | 'differences';

export interface InvoiceLine {
  id: ID;
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  discountPct: number;
  taxCode: string;
}

export interface TaxBreakdownEntry {
  taxCode: string;
  label: string;
  ratePct: number;
  baseCents: Cents;
  taxCents: Cents;
  mention: string | null;
}

export interface InvoiceTotals {
  grossCents: Cents;
  discountCents: Cents;
  baseCents: Cents;
  taxCents: Cents;
  withholdingPct: number;
  withholdingCents: Cents;
  /** Invoice total = base + tax. */
  totalCents: Cents;
  /** Amount the customer must pay = total − withholding. Collections track this amount. */
  payableCents: Cents;
  breakdown: TaxBreakdownEntry[];
}

export interface PartySnapshot {
  legalName: string;
  idType: IdType;
  idNumber: string;
  address: Address;
}

export interface Invoice {
  id: ID;
  companyId: ID;
  kind: 'ordinary' | 'rectifying';
  seriesId: ID;
  /** Assigned only at issue, from the series counter (no gaps from abandoned drafts). */
  number: string | null;
  customerId: ID;
  /** Frozen copy of issuer/recipient identity at issue (RD 1619/2012 art. 6). */
  customerSnapshot: PartySnapshot | null;
  issuerSnapshot: PartySnapshot | null;
  issueDate: ISODate | null;
  /** Date of the operation if different from issue date. */
  operationDate: ISODate | null;
  dueDate: ISODate | null;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  notes: string;
  paymentTerms: string;

  documentStatus: DocumentStatus;
  /** Sub-state while in draft: approval requested / returned to author. */
  review: { state: 'none' | 'requested' | 'returned'; by: ID | null; at: ISODateTime | null; comment: string };
  approvedBy: ID | null;
  approvedAt: ISODateTime | null;
  issuedBy: ID | null;
  issuedAt: ISODateTime | null;

  fiscalStatus: FiscalStatus;
  providerInvoiceId: string | null;
  fiscalRecordId: string | null;
  fiscalHash: string | null;
  /** Operation currently awaiting reconciliation; blocks new issue attempts (FIN-03). */
  pendingOperationId: ID | null;

  exchangeStatus: ExchangeStatus;

  /** Present on rectifying invoices. */
  rectification: {
    originalInvoiceId: ID;
    reasonCode: RectificationReasonCode;
    method: RectificationMethod;
    reasonText: string;
    requestedBy: ID;
    requestedAt: ISODateTime;
  } | null;
  /** On an original invoice: rectifying invoices that reference it. */
  rectifiedByIds: ID[];

  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Incremented on each change (optimistic concurrency in a future API). */
  version: number;
}

export interface PaymentEvent {
  id: ID;
  companyId: ID;
  invoiceId: ID;
  kind: 'payment' | 'reversal';
  date: ISODate;
  amountCents: Cents;
  method: 'transfer' | 'direct_debit' | 'card' | 'cash' | 'bizum' | 'other';
  reference: string;
  note: string;
  reversesPaymentId: ID | null;
  recordedBy: ID;
  recordedAt: ISODateTime;
}

export interface Dispute {
  id: ID;
  companyId: ID;
  invoiceId: ID;
  status: 'open' | 'resolved';
  reason: string;
  holdReminders: boolean;
  openedBy: ID;
  openedAt: ISODateTime;
  resolvedBy: ID | null;
  resolvedAt: ISODateTime | null;
  resolution: string | null;
}

export type FiscalOperationState =
  | 'in_flight'
  | 'accepted'
  | 'accepted_with_errors'
  | 'rejected'
  | 'uncertain'
  | 'not_processed'
  | 'failed';

/** One attempt to talk to the (simulated) fiscal provider (INT-01..INT-03). */
export interface FiscalOperation {
  id: ID;
  companyId: ID;
  invoiceId: ID;
  type: 'issue' | 'annulment' | 'status_query';
  /** Idempotency key: the same logical operation always reuses it (FIN-03 / INT-02). */
  operationKey: string;
  attempt: number;
  requestedBy: ID;
  requestedAt: ISODateTime;
  completedAt: ISODateTime | null;
  state: FiscalOperationState;
  /** Invoice number reserved for this operation (reused on retry). */
  reservedNumber: string | null;
  providerRequestId: string | null;
  providerInvoiceId: string | null;
  fiscalRecordId: string | null;
  responseCode: string | null;
  responseMessage: string | null;
  errors: { code: string; message: string }[];
  reconciledBy: ID | null;
  reconciledAt: ISODateTime | null;
  /** Always true: no real provider or AEAT response exists in the prototype. */
  simulated: true;
}

export interface DeliveryEvent {
  id: ID;
  companyId: ID;
  invoiceId: ID;
  channel: 'email' | 'manual' | 'b2b_network';
  recipient: string;
  status: 'sent' | 'delivered' | 'failed' | 'accepted' | 'rejected';
  detail: string;
  at: ISODateTime;
  by: ID;
  simulated: boolean;
}

export interface CollectionReminder {
  id: ID;
  companyId: ID;
  invoiceId: ID;
  offsetDays: number | null;
  status: 'sent' | 'delivered' | 'failed' | 'suppressed';
  reason: string;
  channel: 'email';
  at: ISODateTime;
  by: ID;
  simulated: true;
}

// ─────────────────────────────── Purchases & expenses ───────────────────────────────

export type ExpenseKind = 'supplier_invoice' | 'employee_expense';
export type ExpenseDocumentType = 'complete_invoice' | 'simplified_invoice' | 'receipt_no_vat';
export type ExpenseReviewStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface ExpenseRecord {
  id: ID;
  companyId: ID;
  kind: ExpenseKind;
  supplierId: ID | null;
  /** Free-text merchant when no supplier record exists (e.g. a restaurant ticket). */
  merchantName: string;
  documentType: ExpenseDocumentType;
  documentNumber: string;
  documentDate: ISODate;
  /** `YYYY-MM` accounting period for the accountant handover. */
  accountingPeriod: string;
  category: string;
  description: string;
  baseCents: Cents;
  vatRatePct: number;
  vatCents: Cents;
  withholdingCents: Cents;
  totalCents: Cents;
  /** Simplified invoices: recipient NIF and separate VAT quota shown (RD 1619/2012 art. 7.2). */
  recipientNifShown: boolean;
  dueDate: ISODate | null;
  submittedBy: ID;
  submittedAt: ISODateTime | null;
  reviewStatus: ExpenseReviewStatus;
  reviewedBy: ID | null;
  reviewedAt: ISODateTime | null;
  reviewComment: string;
  paymentStatus: 'unpaid' | 'paid' | 'reimbursed';
  paidAt: ISODate | null;
  paymentReference: string;
  attachmentIds: ID[];
  /** Duplicate warnings the submitter explicitly acknowledged. */
  duplicateAcknowledged: ID[];
  extraction: { suggestedAt: ISODateTime; fields: string[]; simulated: true } | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

export interface Attachment {
  id: ID;
  companyId: ID;
  ownerType: 'expense' | 'invoice' | 'payment' | 'handover';
  ownerId: ID;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Content fingerprint for duplicate detection (demo hash). */
  fingerprint: string;
  /** Small local demo files only; never uploaded anywhere. */
  dataUrl: string | null;
  accessClass: 'finance' | 'restricted';
  uploadedBy: ID;
  uploadedAt: ISODateTime;
  /** PLT-05: original is preserved; replacements are new versions. */
  version: number;
  supersedesId: ID | null;
  demo: boolean;
}

// ─────────────────────────────── Accountant handover & exports ───────────────────────────────

export interface HandoverChecklistItem {
  key: string;
  label: string;
  auto: boolean;
  done: boolean;
  doneBy: ID | null;
  doneAt: ISODateTime | null;
}

export interface HandoverPackage {
  id: ID;
  companyId: ID;
  periodFrom: ISODate;
  periodTo: ISODate;
  label: string;
  status: 'in_preparation' | 'ready' | 'delivered' | 'acknowledged';
  checklist: HandoverChecklistItem[];
  exportIds: ID[];
  notes: string;
  createdBy: ID;
  createdAt: ISODateTime;
  deliveredAt: ISODateTime | null;
  acknowledgedBy: ID | null;
  acknowledgedAt: ISODateTime | null;
}

export interface ExportRecord {
  id: ID;
  companyId: ID;
  kind: string;
  format: 'csv' | 'json';
  fileName: string;
  periodFrom: ISODate | null;
  periodTo: ISODate | null;
  filters: string;
  recordCount: number;
  totalCents: Cents | null;
  /** Demo integrity fingerprint of the exported content (SEC-05 tamper evidence, illustrative). */
  fingerprint: string;
  scopeNote: string;
  createdBy: ID;
  createdAt: ISODateTime;
}

// ─────────────────────────────── Notifications & audit ───────────────────────────────

export type NotificationType =
  | 'approval_requested'
  | 'approval_returned'
  | 'fiscal_rejected'
  | 'fiscal_uncertain'
  | 'invoice_overdue'
  | 'invoice_due_soon'
  | 'expense_review'
  | 'expense_decided'
  | 'handover_incomplete'
  | 'delivery_failed'
  | 'access_changed';

export interface AppNotification {
  id: ID;
  companyId: ID;
  type: NotificationType;
  /** Non-sensitive title (no amounts or personal data). */
  title: string;
  body: string;
  recipientRoles: RoleId[];
  recipientUserIds: ID[];
  link: string;
  /** Prevents duplicate notifications for the same condition. */
  dedupeKey: string;
  createdAt: ISODateTime;
  readBy: Record<ID, ISODateTime>;
}

export interface AuditChange {
  field: string;
  before: string;
  after: string;
}

/** Append-only business audit event (PLT-06). There is no update or delete operation. */
export interface AuditEvent {
  id: ID;
  seq: number;
  companyId: ID;
  at: ISODateTime;
  actorId: ID;
  actorName: string;
  actorRoles: RoleId[];
  action: string;
  entityType: string;
  entityId: ID;
  entityLabel: string;
  summary: string;
  reason: string | null;
  changes: AuditChange[];
  /** Demo hash chain: each event includes the previous event's hash. */
  prevHash: string;
  hash: string;
}

// ─────────────────────────────── Database shape ───────────────────────────────

export interface Database {
  schemaVersion: number;
  seededAt: ISODateTime;
  companies: Company[];
  financeConfigs: FinanceConfig[];
  providerConfigs: ProviderConfig[];
  series: InvoiceSeries[];
  taxCodes: TaxCode[];
  rules: RuleVersion[];
  collectionPolicies: CollectionPolicy[];
  users: User[];
  memberships: Membership[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  payments: PaymentEvent[];
  disputes: Dispute[];
  fiscalOperations: FiscalOperation[];
  deliveries: DeliveryEvent[];
  reminders: CollectionReminder[];
  expenses: ExpenseRecord[];
  attachments: Attachment[];
  handovers: HandoverPackage[];
  exports: ExportRecord[];
  notifications: AppNotification[];
  audit: AuditEvent[];
}

export type CollectionKey = Exclude<keyof Database, 'schemaVersion' | 'seededAt'>;
