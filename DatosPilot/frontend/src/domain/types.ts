/**
 * DatosPilot domain model (= the future backend schema / DTOs).
 *
 * Design rules (see docs/03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md):
 * - Every company-scoped row carries `companyId`; services never read across companies.
 * - Requirement templates are versioned with effective dates; a new version never rewrites
 *   the evidence reviewed under an older one (each review stores the version it was made under).
 * - Document versions are append-only: a replacement creates a new version, a rejection is kept.
 * - Legal expiry, provider review date and internal follow-up date are three different fields.
 *   An absent date stays absent (null) and is shown as "review required", never invented.
 * - Health-related data lives in its own collections (offers, conclusions, quarantine) with
 *   minimum fields: no diagnoses, no clinical reports.
 * - Readiness is DERIVED from the configured rules on every read; only explicit human decisions
 *   (assignment confirmations, authorised exceptions) are stored.
 */

export type ID = string;
/** Calendar date `YYYY-MM-DD` (local to the company). */
export type ISODate = string;
/** UTC instant `YYYY-MM-DDTHH:mm:ss.sssZ`. */
export type ISOInstant = string;

/** A translatable message: Spanish source text + parameters (rendered with t()). */
export interface Msg {
  text: string;
  params?: Record<string, string | number>;
}

export interface Actor {
  userId: ID;
  name: string;
  roles: RoleId[];
}

// ─────────────────────────────── Company, people, access ───────────────────────────────

export type PreventionModality = 'spa' | 'own_service' | 'designated_workers' | 'employer' | 'joint_service';

export interface Company {
  id: ID;
  legalName: string;
  tradeName: string;
  nif: string;
  timezone: string;
  province: string;
  employeeCount: number;
  activity: string;
  /** How prevention is organised (LPRL arts. 30–31, RD 39/1997 art. 10). Recorded, not decided by the app. */
  preventionModality: PreventionModality[];
  preventionNote: string;
  /** Delegados de prevención exist (LPRL art. 35). */
  hasPreventionDelegates: boolean;
}

export interface Department {
  id: ID;
  companyId: ID;
  name: string;
}

export interface User {
  id: ID;
  name: string;
  email: string;
  title: string;
  /** External organisation (prevention provider) for non-employees. */
  organisation: string | null;
}

export type RoleId = 'owner' | 'company_admin' | 'prl_coordinator' | 'supervisor' | 'employee' | 'provider_technical' | 'provider_medical' | 'representative';

export interface Membership {
  id: ID;
  userId: ID;
  companyId: ID;
  roles: RoleId[];
  /** End date of individual roles (e.g. a prevention delegate's mandate). */
  roleValidUntil: Partial<Record<RoleId, ISODate>>;
  employeeId: ID | null;
  status: 'active' | 'revoked';
  validFrom: ISODate | null;
  validUntil: ISODate | null;
  /** Prevention provider the user acts for (external roles). */
  providerId: ID | null;
  /** Worksites an external user may see; null = all worksites of the company. */
  worksiteScope: ID[] | null;
  /** Contract / mandate / appointment reference (e.g. concierto del SPA, acta de nombramiento). */
  reference: string | null;
  revokedAt: ISOInstant | null;
}

export interface Employee {
  id: ID;
  companyId: ID;
  code: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive';
  hireDate: ISODate;
  endDate: ISODate | null;
  managerEmployeeId: ID | null;
  userId: ID | null;
  /** Sensitive-worker status (LPRL art. 25) is NOT stored here: it belongs to the restricted area. */
  createdAt: ISOInstant;
}

/** A job role definition (puesto) with the tasks/risks that drive requirement applicability. */
export interface JobRole {
  id: ID;
  companyId: ID;
  name: string;
  departmentId: ID;
  tasks: string;
  riskTags: string[];
  active: boolean;
}

/**
 * Effective-dated assignment of an employee to a role, department and worksites.
 * A change creates a new version (the previous one gets `effectiveTo`) and an AssignmentChange
 * delta review; history is never overwritten.
 */
export interface EmployeeAssignment {
  id: ID;
  companyId: ID;
  employeeId: ID;
  jobRoleId: ID;
  departmentId: ID;
  worksiteIds: ID[];
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  changeReason: string;
  createdBy: ID;
  createdAt: ISOInstant;
}

export interface CustomerOrganisation {
  id: ID;
  companyId: ID;
  name: string;
  nif: string;
  contactName: string;
  contactEmail: string;
}

export interface Worksite {
  id: ID;
  companyId: ID;
  code: string;
  name: string;
  kind: 'own' | 'customer';
  address: string;
  municipality: string;
  customerId: ID | null;
  siteContactName: string;
  siteContactPhone: string;
  /** Internal coordinator (employee) responsible for this worksite. */
  coordinatorEmployeeId: ID | null;
  activities: string;
  riskTags: string[];
  /** Other businesses' workers share this workplace (CAE may apply; professional assessment). */
  sharedWorkplace: boolean;
  active: boolean;
  updatedAt: ISOInstant;
}

export type ProviderSpecialty = 'seguridad' | 'higiene' | 'ergonomia' | 'medicina';

export interface PreventionProvider {
  id: ID;
  companyId: ID;
  name: string;
  kind: 'spa' | 'medical' | 'training' | 'other';
  specialties: ProviderSpecialty[];
  contractReference: string;
  contractValidUntil: ISODate | null;
  contactName: string;
  contactEmail: string;
}

/** Product-defined vocabulary of risk/task tags (configurable per company). */
export interface RiskTag {
  id: string;
  companyId: ID;
  label: string;
  /** Specialist scope (construction, hazardous processes): flagged as outside the initial product scope. */
  specialist: boolean;
}

// ─────────────────────────────── Requirements ───────────────────────────────

export type RequirementCategory =
  | 'training'
  | 'information'
  | 'site_instruction'
  | 'ppe'
  | 'health_surveillance'
  | 'provider_document'
  | 'coordination'
  | 'employee_document'
  | 'authorisation';

/** How the requirement is satisfied. */
export type EvidenceMode = 'document' | 'training' | 'acknowledgement' | 'ppe_issue' | 'health';

export type RequirementType = 'mandatory_policy' | 'optional' | 'not_applicable';

export type ReviewAuthority = 'coordinator' | 'provider_technical' | 'provider_medical';

export type SourceKind = 'law' | 'risk_assessment' | 'provider_policy' | 'customer_requirement' | 'collective_agreement' | 'internal_policy';

export interface SourceRef {
  kind: SourceKind;
  label: string;
  url: string | null;
  /** Risk assessment the requirement derives from, when kind = risk_assessment. */
  assessmentId: ID | null;
}

/** Legal expiry of the evidence documents. */
export type ExpiryRule = 'none' | 'per_document' | 'not_determined';

export interface ReviewRule {
  /** none: no scheduled review; interval: set by the provider; per_document: each document carries its review date; not_determined: a professional must decide. */
  kind: 'none' | 'interval' | 'per_document' | 'not_determined';
  months: number | null;
  /** Who set the interval (provider/professional), required for kind = interval. */
  setBy: string | null;
}

export interface RequirementScope {
  /** Empty = any role (only meaningful together with another criterion or appliesToAll). */
  jobRoleIds: ID[];
  worksiteIds: ID[];
  riskTags: string[];
  employeeIds: ID[];
  appliesToAll: boolean;
}

export type VersionStatus = 'draft' | 'pending_approval' | 'scheduled' | 'active' | 'superseded' | 'retired' | 'rejected';

export interface HealthBasis {
  /** voluntary: an offer the worker may decline. mandatory_exception: LPRL art. 22.1 exception confirmed by a professional. */
  kind: 'voluntary' | 'mandatory_exception';
  exceptionGround: 'indispensable_evaluation' | 'danger_to_others' | 'specific_legal_provision' | null;
  /** Date the worker representatives' prior report was obtained (art. 22.1), if applicable. */
  representativesReportOn: ISODate | null;
  professionalReference: string | null;
}

export interface RequirementVersion {
  id: ID;
  companyId: ID;
  templateId: ID;
  version: number;
  name: string;
  description: string;
  purpose: string;
  category: RequirementCategory;
  evidenceMode: EvidenceMode;
  requirementType: RequirementType;
  scope: RequirementScope;
  /** One item per worksite (site instructions, CAE information) instead of one per employee. */
  perWorksite: boolean;
  source: SourceRef;
  applicabilityNote: string;
  reviewAuthority: ReviewAuthority;
  responsibleReviewer: string;
  evidenceRequired: string;
  expiryRule: ExpiryRule;
  reviewRule: ReviewRule;
  /** Date the requirement itself must be reconsidered (policy review), if set by the approver. */
  policyReviewDate: ISODate | null;
  /** Critical for assignment: blocks readiness until satisfied. Only a professional approver can set it. */
  critical: boolean;
  /** A validated exception procedure exists for this requirement (never for legally mandatory controls). */
  exceptionAllowed: boolean;
  /** Evidence accepted under earlier versions must be reviewed again. */
  invalidatesPriorEvidence: boolean;
  /** Linked training course / PPE item / instruction document, depending on evidenceMode. */
  courseId: ID | null;
  equipmentItemId: ID | null;
  instructionDocumentId: ID | null;
  health: HealthBasis | null;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  status: VersionStatus;
  changeReason: string;
  createdBy: ID;
  createdAt: ISOInstant;
  approvedBy: ID | null;
  approvedAt: ISOInstant | null;
  approvalNote: string | null;
}

export interface RequirementTemplate {
  id: ID;
  companyId: ID;
  code: string;
  createdAt: ISOInstant;
  createdBy: ID;
  retiredAt: ISOInstant | null;
  /** Why it was retired (also in the audit event). */
  retireReason?: string | null;
}

/** Explicit assignment of an approved template to a role, worksite or employee (effective-dated). */
export interface RequirementAssignment {
  id: ID;
  companyId: ID;
  templateId: ID;
  target: { kind: 'employee' | 'worksite' | 'role'; id: ID };
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  reason: string;
  assignedBy: ID;
  assignedAt: ISOInstant;
  endedBy: ID | null;
  endReason: string | null;
}

/** An authorised reviewer marked a requirement as not applicable to one employee (with reason). */
export interface ApplicabilityDecision {
  id: ID;
  companyId: ID;
  templateId: ID;
  employeeId: ID;
  worksiteId: ID | null;
  decision: 'not_applicable';
  reason: string;
  decidedBy: ID;
  decidedAt: ISOInstant;
  revokedAt: ISOInstant | null;
  revokedBy: ID | null;
}

// ─────────────────────────────── Evidence ───────────────────────────────

export type AccessClass = 'ordinary' | 'restricted' | 'health' | 'quarantined';

export interface DocumentCategory {
  id: string;
  companyId: ID;
  label: string;
  accessClass: AccessClass;
  active: boolean;
}

export interface EvidenceRequest {
  id: ID;
  companyId: ID;
  employeeId: ID | null;
  worksiteId: ID | null;
  templateId: ID;
  requestedBy: ID;
  requestedAt: ISOInstant;
  /** Internal follow-up date chosen by the requester (not a legal deadline). */
  followUpDate: ISODate | null;
  note: string;
  status: 'open' | 'fulfilled' | 'cancelled';
  documentId: ID | null;
  closedAt: ISOInstant | null;
}

export type DocStatus = 'received' | 'in_review' | 'accepted' | 'rejected' | 'superseded';

export interface DemoFile {
  name: string;
  size: number;
  type: string;
  /** Small text/image files may be kept as a data URL for the demo download; otherwise metadata only. */
  dataUrl: string | null;
}

/** Logical document (one per subject + requirement); its content lives in versions. */
export interface EvidenceDocument {
  id: ID;
  companyId: ID;
  code: string;
  categoryId: string;
  title: string;
  employeeId: ID | null;
  worksiteId: ID | null;
  caseId: ID | null;
  templateId: ID | null;
  accessClass: AccessClass;
  createdAt: ISOInstant;
  createdBy: ID;
}

export interface DocumentVersion {
  id: ID;
  companyId: ID;
  documentId: ID;
  version: number;
  issuer: string;
  issueDate: ISODate | null;
  /** 'none' = the issuer states no expiry; 'unknown' = not stated → review required. */
  expiryMode: 'date' | 'none' | 'unknown';
  legalExpiryDate: ISODate | null;
  providerReviewDate: ISODate | null;
  internalFollowUpDate: ISODate | null;
  receivedAt: ISOInstant;
  submittedBy: ID;
  file: DemoFile | null;
  status: DocStatus;
  /** Requirement version in force when the document was submitted / reviewed (BRD §17). */
  requirementVersionId: ID | null;
  reviewerId: ID | null;
  reviewStartedAt: ISOInstant | null;
  reviewedAt: ISOInstant | null;
  decisionNote: string | null;
  rejectionReason: string | null;
  supersededBy: ID | null;
  sourceReference: string;
  notes: string;
}

/** Acknowledgement of information/instructions by the worker. Not proof of training. */
export interface Acknowledgement {
  id: ID;
  companyId: ID;
  employeeId: ID;
  subject: { kind: 'document' | 'ppe_issue'; id: ID };
  /** For documents: the version acknowledged. A new version needs a new acknowledgement. */
  documentVersionId: ID | null;
  acknowledgedAt: ISOInstant;
  method: 'in_app' | 'paper_recorded';
  recordedBy: ID;
  statement: string;
}

// ─────────────────────────────── Training and PPE ───────────────────────────────

export interface TrainingCourse {
  id: ID;
  companyId: ID;
  code: string;
  title: string;
  providerName: string;
  modality: 'presencial' | 'online' | 'mixta';
  durationHours: number | null;
  contentSummary: string;
  riskTags: string[];
  /** Review/refresher interval only when a provider or rule established it. */
  refresher: ReviewRule;
  active: boolean;
}

export type TrainingStatus = 'assigned' | 'scheduled' | 'attended' | 'completed' | 'cancelled';

/** Training assignment: attendance, completion and evidence acceptance are tracked separately. */
export interface TrainingAssignment {
  id: ID;
  companyId: ID;
  employeeId: ID;
  courseId: ID;
  templateId: ID | null;
  assignedBy: ID;
  assignedAt: ISOInstant;
  scheduledDate: ISODate | null;
  attendanceRecordedAt: ISOInstant | null;
  attendanceDate: ISODate | null;
  completionRecordedAt: ISOInstant | null;
  completionDate: ISODate | null;
  hours: number | null;
  documentId: ID | null;
  status: TrainingStatus;
  note: string;
}

export interface EquipmentItem {
  id: ID;
  companyId: ID;
  code: string;
  name: string;
  type: string;
  description: string;
  jobRoleIds: ID[];
  riskTags: string[];
  worksiteIds: ID[];
  /** Inspection / replacement schedule only when configured from the manufacturer or provider. */
  replacement: ReviewRule;
  identifierRequired: boolean;
  active: boolean;
}

export type IssueStatus = 'issued' | 'returned' | 'replaced' | 'lost';

export interface EquipmentIssue {
  id: ID;
  companyId: ID;
  employeeId: ID;
  itemId: ID;
  identifier: string;
  size: string;
  worksiteId: ID | null;
  issuedAt: ISODate;
  issuedBy: ID;
  status: IssueStatus;
  returnedAt: ISODate | null;
  replacedById: ID | null;
  replacementDue: ISODate | null;
  documentId: ID | null;
  note: string;
}

// ─────────────────────────────── Risk assessments and actions ───────────────────────────────

export type AssessmentStatus = 'draft' | 'submitted' | 'under_review' | 'accepted' | 'superseded' | 'review_required';

export interface Hazard {
  id: string;
  riskTag: string;
  description: string;
  measures: string;
}

export interface RiskAssessment {
  id: ID;
  companyId: ID;
  code: string;
  title: string;
  worksiteId: ID | null;
  activity: string;
  jobRoleIds: ID[];
  providerId: ID | null;
  assessorName: string;
  version: number;
  supersedesId: ID | null;
  issueDate: ISODate | null;
  effectiveDate: ISODate | null;
  /** Review date only if the assessor established one. */
  reviewDate: ISODate | null;
  hazards: Hazard[];
  preventiveMeasures: string;
  documentId: ID | null;
  ownerUserId: ID;
  linkedTemplateIds: ID[];
  status: AssessmentStatus;
  reviewNote: string | null;
  reviewedBy: ID | null;
  reviewedAt: ISOInstant | null;
  createdBy: ID;
  createdAt: ISOInstant;
}

export type ActionStatus = 'open' | 'assigned' | 'in_progress' | 'pending_review' | 'resolved' | 'reopened';
export type Priority = 'low' | 'medium' | 'high';

export interface ActionNote {
  at: ISOInstant;
  by: ID;
  kind: 'progress' | 'submitted' | 'accepted' | 'rejected' | 'reopened' | 'assigned' | 'created';
  text: string;
}

export interface PreventiveAction {
  id: ID;
  companyId: ID;
  code: string;
  title: string;
  description: string;
  source: { kind: 'requirement_gap' | 'review_finding' | 'risk_assessment' | 'cae' | 'provider_review' | 'incident' | 'other'; refId: ID | null; label: string };
  employeeId: ID | null;
  jobRoleId: ID | null;
  worksiteId: ID | null;
  priority: Priority;
  ownerUserId: ID | null;
  targetDate: ISODate | null;
  targetJustification: string;
  /** Evidence the reviewer requires before accepting the resolution. */
  requiredEvidence: string;
  evidenceRequired: boolean;
  reviewAuthority: ReviewAuthority;
  /** The approved policy says this open action affects readiness of the linked worksite. */
  affectsReadiness: boolean;
  status: ActionStatus;
  evidenceDocumentIds: ID[];
  resolutionNote: string | null;
  notes: ActionNote[];
  createdBy: ID;
  createdAt: ISOInstant;
  resolvedAt: ISOInstant | null;
}

// ─────────────────────────────── CAE ───────────────────────────────

export type CaeRole = 'titular' | 'principal' | 'contratista' | 'subcontratista' | 'autonomo' | 'concurrente';

export interface CaeParticipant {
  id: ID;
  organisation: string;
  role: CaeRole;
  contactName: string;
  contactEmail: string;
  isOwnCompany: boolean;
}

export interface CaeCase {
  id: ID;
  companyId: ID;
  code: string;
  worksiteId: ID;
  title: string;
  status: 'open' | 'active' | 'closed';
  participants: CaeParticipant[];
  activities: string;
  risksSummary: string;
  coordinationMeans: string;
  followUpOwnerId: ID | null;
  nextFollowUp: ISODate | null;
  openQuestions: string;
  createdBy: ID;
  createdAt: ISOInstant;
  closedAt: ISOInstant | null;
}

/**
 * One exchange of information: sending, recipient receipt, recipient acknowledgement and the
 * review decision are separate fields (an upload never implies receipt or acceptance).
 */
export interface CaeExchange {
  id: ID;
  companyId: ID;
  caseId: ID;
  direction: 'sent' | 'received';
  subject: string;
  documentId: ID | null;
  documentVersionId: ID | null;
  versionLabel: string;
  senderParticipantId: ID;
  recipientParticipantId: ID;
  sentAt: ISOInstant | null;
  receivedAt: ISOInstant | null;
  receiptConfirmedBy: string | null;
  acknowledgedAt: ISOInstant | null;
  review: 'pending' | 'accepted' | 'rejected' | 'not_required';
  reviewedBy: ID | null;
  reviewNote: string | null;
  followUp: string;
  createdBy: ID;
  createdAt: ISOInstant;
}

/** Simulated share link: scoped to one case/worksite, one recipient and an expiry. */
export interface ShareLink {
  id: ID;
  companyId: ID;
  caseId: ID;
  recipientParticipantId: ID;
  token: string;
  documentVersionIds: ID[];
  createdBy: ID;
  createdAt: ISOInstant;
  expiresOn: ISODate;
  revokedAt: ISOInstant | null;
  accessLog: ISOInstant[];
}

// ─────────────────────────────── Health (restricted) ───────────────────────────────

export interface HealthOffer {
  id: ID;
  companyId: ID;
  employeeId: ID;
  templateId: ID | null;
  basis: HealthBasis['kind'];
  offeredAt: ISODate;
  offeredBy: ID;
  response: 'pending' | 'accepted' | 'declined';
  respondedAt: ISODate | null;
  recordedBy: ID | null;
}

export type FitnessConclusion = 'fit' | 'fit_with_measures' | 'temporarily_unfit' | 'unfit';

/** Minimum conclusion a medical provider may share with the employer (no diagnosis). */
export interface HealthConclusion {
  id: ID;
  companyId: ID;
  employeeId: ID;
  offerId: ID | null;
  providerId: ID;
  scope: string;
  conclusion: FitnessConclusion;
  /** Operational preventive measures for the coordinator (never diagnoses). */
  measures: string;
  conclusionDate: ISODate;
  nextReviewDate: ISODate | null;
  /** Clinical record stays with the medical service; only an external reference is kept. */
  clinicalRecordReference: string;
  recordedBy: ID;
  recordedAt: ISOInstant;
  measuresConfirmedAt: ISOInstant | null;
  measuresConfirmedBy: ID | null;
  status: 'current' | 'superseded';
}

export interface QuarantineItem {
  id: ID;
  companyId: ID;
  documentId: ID;
  documentVersionId: ID;
  detectedBy: 'uploader_flag' | 'keyword';
  quarantinedAt: ISOInstant;
  uploaderId: ID;
  status: 'quarantined' | 'returned_to_provider' | 'file_removed';
  handledBy: ID | null;
  handledAt: ISOInstant | null;
  note: string | null;
}

// ─────────────────────────────── Changes, readiness decisions, exceptions ───────────────────────────────

export interface DeltaItem {
  templateId: ID;
  versionId: ID;
  worksiteId: ID | null;
  name: string;
  critical: boolean;
  /** Evidence status at the time of the change. */
  evidence: string;
}

export interface RequirementDelta {
  newlyRequired: DeltaItem[];
  unchanged: DeltaItem[];
  noLongerApplicable: DeltaItem[];
  evidenceStillValid: DeltaItem[];
  evidenceNeedsReview: DeltaItem[];
  newCriticalUnresolved: DeltaItem[];
}

/** Role / worksite change with the requirement delta review it triggers (PRL-02). */
export interface AssignmentChange {
  id: ID;
  companyId: ID;
  employeeId: ID;
  trigger: 'employee_change' | 'worksite_change' | 'requirement_change';
  /** Worksites whose readiness waits for this review (new sites, the changed site, or all on a role change). */
  focusWorksiteIds: ID[];
  before: { jobRoleId: ID; departmentId: ID; worksiteIds: ID[] };
  after: { jobRoleId: ID; departmentId: ID; worksiteIds: ID[] };
  effectiveFrom: ISODate;
  reason: string;
  delta: RequirementDelta;
  status: 'pending_review' | 'reviewed';
  createdBy: ID;
  createdAt: ISOInstant;
  reviewedBy: ID | null;
  reviewedAt: ISOInstant | null;
  reviewNote: string | null;
}

export type ReadinessState = 'pending_evaluation' | 'incomplete' | 'in_review' | 'ready' | 'blocked' | 'professional_review';

/** Explicit decision by an authorised person about one assignment (employee × worksite). */
export interface ReadinessDecision {
  id: ID;
  companyId: ID;
  employeeId: ID;
  worksiteId: ID;
  kind: 'confirmed_ready' | 'exception';
  /** Exception: blocking requirement(s) covered, compensating measure and expiry. */
  templateIds: ID[];
  reason: string;
  compensatingMeasure: string | null;
  validUntil: ISODate | null;
  decidedBy: ID;
  decidedAt: ISOInstant;
  stateAtDecision: ReadinessState;
  revokedAt: ISOInstant | null;
}

export type ExceptionStatus = 'open' | 'assigned' | 'acknowledged' | 'investigating' | 'resolved' | 'reopened';

export interface ExceptionHistory {
  at: ISOInstant;
  by: ID;
  status: ExceptionStatus;
  note: string;
}

/** Stored review state of a derived exception (the exception itself is recomputed every read). */
export interface ExceptionReview {
  id: ID;
  companyId: ID;
  key: string;
  status: ExceptionStatus;
  ownerUserId: ID | null;
  history: ExceptionHistory[];
  /** Snapshot of the reason when the review was last updated. */
  snapshot: string;
  updatedAt: ISOInstant;
}

// ─────────────────────────────── Platform records ───────────────────────────────

export interface AppNotification {
  id: ID;
  companyId: ID;
  type: string;
  title: string;
  body: string;
  recipientUserIds: ID[];
  link: string;
  createdAt: ISOInstant;
  readBy: ID[];
  dedupeKey: string;
}

export interface AuditChange {
  field: string;
  before: string;
  after: string;
}

export interface AuditEvent {
  id: ID;
  seq: number;
  companyId: ID;
  at: ISOInstant;
  actor: Actor;
  action: string;
  entityType: string;
  entityId: ID;
  entityLabel: string;
  employeeId: ID | null;
  summary: string;
  reason: string | null;
  changes: AuditChange[];
  /** Version or recipient concerned, where applicable. */
  version: string | null;
  recipient: string | null;
  /** Restricted events (health) are listed only to health-authorised users. */
  restricted: boolean;
  prevHash: string;
  hash: string;
}

export interface ExportJob {
  id: ID;
  companyId: ID;
  kind: string;
  format: 'csv' | 'json';
  fileName: string;
  scope: string;
  recipient: string | null;
  recordCount: number;
  openItems: number;
  redacted: boolean;
  generatedBy: ID;
  generatedAt: ISOInstant;
  fingerprint: string;
}

export interface CompanySettings {
  id: ID;
  companyId: ID;
  /** Internal alert window (days) before an actual expiry/review date. Product setting, not law. */
  alertWindowDays: number;
  /** Keywords that send an upload to quarantine (possible clinical content). */
  clinicalKeywords: string[];
  shareLinkMaxDays: number;
  updatedBy: ID | null;
  updatedAt: ISOInstant | null;
}

export interface Database {
  schemaVersion: number;
  seededAt: ISOInstant;
  companies: Company[];
  settings: CompanySettings[];
  departments: Department[];
  users: User[];
  memberships: Membership[];
  employees: Employee[];
  jobRoles: JobRole[];
  assignments: EmployeeAssignment[];
  customers: CustomerOrganisation[];
  worksites: Worksite[];
  providers: PreventionProvider[];
  riskTags: RiskTag[];
  templates: RequirementTemplate[];
  versions: RequirementVersion[];
  requirementAssignments: RequirementAssignment[];
  applicability: ApplicabilityDecision[];
  categories: DocumentCategory[];
  requests: EvidenceRequest[];
  documents: EvidenceDocument[];
  docVersions: DocumentVersion[];
  acknowledgements: Acknowledgement[];
  courses: TrainingCourse[];
  trainings: TrainingAssignment[];
  equipment: EquipmentItem[];
  issues: EquipmentIssue[];
  assessments: RiskAssessment[];
  actions: PreventiveAction[];
  caeCases: CaeCase[];
  caeExchanges: CaeExchange[];
  shareLinks: ShareLink[];
  healthOffers: HealthOffer[];
  healthConclusions: HealthConclusion[];
  quarantine: QuarantineItem[];
  changes: AssignmentChange[];
  readinessDecisions: ReadinessDecision[];
  exceptionReviews: ExceptionReview[];
  notifications: AppNotification[];
  exports: ExportJob[];
  audit: AuditEvent[];
}

export type CollectionKey = Exclude<keyof Database, 'schemaVersion' | 'seededAt'>;
