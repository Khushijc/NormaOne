/**
 * JornadaPulse domain model. These types are the starting point for the future database
 * schema (docs/03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md).
 *
 * Principles (BRD §09–10, §17): every business record carries `companyId`; planned shifts,
 * actual attendance events, absences and payroll treatment are separate records; original
 * events are never edited (corrections add a reviewed layer); policies are effective-dated.
 */

export type ID = string;
/** Calendar date "YYYY-MM-DD" in the workplace zone. */
export type ISODate = string;
/** Unambiguous instant, ISO-8601 UTC ("2026-10-12T06:02:13.000Z"). */
export type ISOInstant = string;
/** Accounting period "YYYY-MM". */
export type Period = string;

/** Spanish source text with parameters; rendered with t(text, params) so it can be translated. */
export interface Msg {
  text: string;
  params?: Record<string, string | number>;
}

export interface Actor {
  userId: ID;
  name: string;
  roles: RoleId[];
}

// ─────────────────────────────── Organisation (shared with the portal, PLT-02) ───────────────────────────────

export interface Company {
  id: ID;
  legalName: string;
  tradeName: string;
  nif: string;
  timezone: string;
  province: string;
  employeeCount: number;
  activity: string;
  /** Representation present in the company (affects consultation duties, ET art. 34.9). */
  workerRepresentation: 'delegados' | 'comite' | 'none';
}

export interface Department {
  id: ID;
  companyId: ID;
  name: string;
}

export interface Worksite {
  id: ID;
  companyId: ID;
  name: string;
  kind: 'own' | 'customer';
  address: string;
  city: string;
  timezone: string;
  calendarId: ID;
  active: boolean;
}

export interface User {
  id: ID;
  name: string;
  email: string;
  title: string;
  organisation: string | null;
}

export type RoleId = 'owner' | 'hr_admin' | 'supervisor' | 'employee' | 'payroll' | 'representative';

export interface Membership {
  id: ID;
  userId: ID;
  companyId: ID;
  roles: RoleId[];
  /** Link to the employee record when the user is also an employee of this company. */
  employeeId: ID | null;
  /** Time-bound access (payroll adviser mandate, representative term). */
  validFrom: ISODate;
  validUntil: ISODate | null;
  /** Per-role end dates (e.g. a representative's term) inside an otherwise open membership. */
  roleValidUntil: Partial<Record<RoleId, ISODate>>;
  status: 'active' | 'revoked';
  revokedAt: ISOInstant | null;
  /** Mandate or appointment reference (adviser contract, representative election record). */
  reference: string | null;
}

// ─────────────────────────────── People and employment (TIM-01) ───────────────────────────────

export interface Employee {
  id: ID;
  companyId: ID;
  /** Internal employee code shown on records ("EMP-007"). No national ID number is stored here. */
  code: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  departmentId: ID;
  primaryWorksiteId: ID;
  /** Worksites where the employee may record time (cleaning staff often work at two customer sites). */
  worksiteIds: ID[];
  managerEmployeeId: ID | null;
  jobTitle: string;
  status: 'active' | 'inactive';
  hireDate: ISODate;
  endDate: ISODate | null;
  userId: ID | null;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export type WorkdayType = 'full_time' | 'part_time';
export type ContractType = 'indefinido' | 'temporal' | 'fijo_discontinuo' | 'formativo';

/** Effective-dated employment terms. A change creates a new version; history is kept. */
export interface EmploymentRelationship {
  id: ID;
  companyId: ID;
  employeeId: ID;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  contractType: ContractType;
  workdayType: WorkdayType;
  /** Contracted weekly hours (e.g. 40 full time, 20 part time). */
  weeklyHours: number;
  /** For part time: percentage of the comparable full-time working day. */
  partTimePct: number | null;
  agreementId: ID;
  policyKey: string;
  /** Reduced working time (ET art. 37.6) recorded as data; no calculation is derived from it. */
  reducedHours: { pct: number; basis: string } | null;
  remoteAllowed: boolean;
  createdBy: ID;
  createdAt: ISOInstant;
  note: string;
}

export interface CollectiveAgreementReference {
  id: ID;
  companyId: ID;
  name: string;
  /** Official agreement code (código de convenio) where known. */
  code: string | null;
  scope: string;
  sourceUrl: string | null;
  /** Agreements are references only: their content is configured as policies after adviser review. */
  reviewStatus: 'reference_only' | 'pending_review' | 'adviser_reviewed';
  reviewedBy: string | null;
  reviewedAt: ISODate | null;
  note: string;
}

/** Thresholds used for review indicators only (never for blocking or payroll). */
export interface IndicatorThresholds {
  dailyOrdinaryMaxHours: number;
  minRestBetweenDaysHours: number;
  longSessionHours: number;
  shortSessionMinutes: number;
  continuousWorkBreakAfterHours: number;
  minBreakMinutes: number;
  nightStart: string;
  nightEnd: string;
  missingClockOutAfterHours: number;
}

/** Versioned working-time policy (PLT-07: a new version never changes earlier records). */
export interface WorkingTimePolicy {
  id: ID;
  companyId: ID;
  /** Policy family; employment relationships point to the key, the version is chosen by date. */
  key: string;
  name: string;
  version: number;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  status: 'draft' | 'active' | 'superseded';
  agreementId: ID;
  breaks: {
    /** Recorded breaks of these kinds count as working time (not deducted). */
    paidBreakKinds: BreakKind[];
    /** Informational: minutes of paid break per day agreed by the policy. */
    paidBreakMinutes: number;
  };
  indicators: IndicatorThresholds;
  /** Where the rule comes from (agreement article, company decision) — shown next to each indicator. */
  basis: string;
  editedBy: ID;
  editedAt: ISOInstant;
  approvedBy: string | null;
  supersedesId: ID | null;
  changeReason: string;
}

export interface Holiday {
  date: ISODate;
  name: string;
  scope: 'national' | 'regional' | 'local' | 'company';
}

export interface WorkingCalendar {
  id: ID;
  companyId: ID;
  name: string;
  year: number;
  holidays: Holiday[];
  source: string;
  sourceUrl: string | null;
}

/** How the company organises its time record (ET art. 34.9; draft RD art. 7). */
export interface RecordingProtocol {
  id: ID;
  companyId: ID;
  version: number;
  basis: 'convenio' | 'acuerdo_empresa' | 'decision_previa_consulta';
  basisReference: string;
  consultedRepresentativesOn: ISODate | null;
  effectiveFrom: ISODate;
  sources: ClockSource[];
  correctionProcedure: string;
  connectivityFallback: string;
  approvedBy: string;
  approvedAt: ISOInstant;
  status: 'active' | 'superseded';
}

// ─────────────────────────────── Planned vs actual (TIM-02, TIM-03) ───────────────────────────────

export interface PlannedShift {
  id: ID;
  companyId: ID;
  employeeId: ID;
  worksiteId: ID;
  start: ISOInstant;
  end: ISOInstant;
  timezone: string;
  /** Local date the shift belongs to (start date in the workplace zone). */
  date: ISODate;
  status: 'planned' | 'cancelled';
  note: string;
  createdBy: ID;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export type EventType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
/** No biometric source exists by design (BRD §09; AEPD biometric guidance). */
export type ClockSource = 'web' | 'mobile' | 'kiosk_pin' | 'correction' | 'import';
export type WorkMode = 'onsite' | 'remote';
export type BreakKind = 'rest' | 'meal' | 'other';

/** Append-only attendance event with a durable receipt (TIM-02). Never edited or deleted. */
export interface AttendanceEvent {
  id: ID;
  companyId: ID;
  employeeId: ID;
  sessionId: ID;
  type: EventType;
  /** When the event happened (instant). */
  at: ISOInstant;
  /** When the system received and persisted it. */
  receivedAt: ISOInstant;
  timezone: string;
  source: ClockSource;
  worksiteId: ID;
  mode: WorkMode;
  breakKind: BreakKind | null;
  /** Client idempotency key: a repeated click with the same key returns the existing event. */
  idempotencyKey: string;
  /** Receipt shown to the employee ("JP-7F3A-2C91"). */
  receipt: string;
  recordedBy: ID;
  /** Set when the event was created by an approved correction (source = 'correction'). */
  correctionId: ID | null;
}

export interface BreakRecord {
  id: ID;
  startEventId: ID;
  endEventId: ID | null;
  kind: BreakKind;
}

/** A work session groups the events of one continuous period of work (it may cross midnight). */
export interface WorkSession {
  id: ID;
  companyId: ID;
  employeeId: ID;
  worksiteId: ID;
  timezone: string;
  mode: WorkMode;
  /** Local date of the start event: the "working day" the session belongs to. */
  date: ISODate;
  startEventId: ID;
  endEventId: ID | null;
  breaks: BreakRecord[];
  /** Approved corrections layered on top of the original events, oldest first. */
  correctionIds: ID[];
  /** Whether the session was created from a correction (missing session added later). */
  origin: 'clocked' | 'correction';
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

/** A clocking attempt that could NOT be persisted (simulated connectivity failure). */
export interface FailedAttempt {
  id: ID;
  companyId: ID;
  employeeId: ID;
  action: EventType;
  attemptedAt: ISOInstant;
  worksiteId: ID;
  reason: string;
  /** Set once a correction request references the attempt. */
  correctionId: ID | null;
}

// ─────────────────────────────── Corrections (TIM-04) ───────────────────────────────

export interface SessionValues {
  start: ISOInstant | null;
  end: ISOInstant | null;
  breaks: { start: ISOInstant; end: ISOInstant | null; kind: BreakKind }[];
  worksiteId: ID | null;
  mode: WorkMode;
}

export type CorrectionKind =
  | 'missing_clock_out'
  | 'wrong_start'
  | 'wrong_end'
  | 'missing_break'
  | 'wrong_worksite'
  | 'duplicate_event'
  | 'connectivity'
  | 'missing_session'
  | 'other';

export type CorrectionStatus =
  /** Requested by the employee; awaiting an authorised reviewer. */
  | 'pending'
  /** Proposed by the company; awaiting the employee's agreement (draft RD art. 4.b design). */
  | 'pending_employee'
  | 'approved'
  | 'rejected'
  /** Company applied it; the employee recorded disagreement. */
  | 'applied_with_disagreement'
  | 'withdrawn';

export interface CorrectionRequest {
  id: ID;
  companyId: ID;
  employeeId: ID;
  /** null when the request adds a session that was never recorded. */
  sessionId: ID | null;
  failedAttemptId: ID | null;
  date: ISODate;
  kind: CorrectionKind;
  initiatedBy: 'employee' | 'company';
  /** Effective values at the time of the request (snapshot). */
  original: SessionValues | null;
  requested: SessionValues;
  /** Values the reviewer approved (may differ from requested). */
  approved: SessionValues | null;
  explanation: string;
  status: CorrectionStatus;
  requestedBy: ID;
  requestedAt: ISOInstant;
  reviewerId: ID | null;
  decidedAt: ISOInstant | null;
  decisionReason: string | null;
  employeeResponse: { at: ISOInstant; agreed: boolean; comment: string } | null;
  history: ReviewEntry[];
}

export interface ReviewEntry {
  at: ISOInstant;
  by: ID;
  action: string;
  note: string | null;
}

// ─────────────────────────────── Absences (TIM-05) ───────────────────────────────

export interface AbsenceType {
  id: ID;
  companyId: ID;
  code: string;
  name: string;
  /** Short reference to the legal or agreement basis (informative, reviewed by the adviser). */
  legalReference: string;
  paid: 'paid' | 'unpaid' | 'depends';
  requiresApproval: boolean;
  evidence: 'none' | 'optional' | 'required';
  /** Sensitive categories (sick leave) are masked for supervisors, owner and representatives. */
  sensitive: boolean;
  allowsPartialDay: boolean;
  /** Days allowance per year, only when an adviser-approved policy defines one. */
  allowance: { days: number; unit: 'natural' | 'working'; year: number; adviserApproved: boolean } | null;
  /** Statutory/agreement reference duration shown as information only. */
  referenceDuration: string | null;
  active: boolean;
  version: number;
  effectiveFrom: ISODate;
  note: string;
  colour: 'blue' | 'teal' | 'violet' | 'amber' | 'grey' | 'rose';
}

export type AbsenceStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancel_requested' | 'cancelled';

export interface AbsenceRequest {
  id: ID;
  companyId: ID;
  employeeId: ID;
  typeId: ID;
  startDate: ISODate;
  endDate: ISODate;
  /** Partial day (hours) where the category allows it. */
  partial: { startTime: string; endTime: string } | null;
  note: string;
  attachmentIds: ID[];
  status: AbsenceStatus;
  submittedAt: ISOInstant | null;
  createdBy: ID;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
  reviewerId: ID | null;
  decidedAt: ISOInstant | null;
  decisionReason: string | null;
  /** Conflicts the reviewer saw and accepted when approving. */
  acknowledgedConflicts: string[];
  history: ReviewEntry[];
}

export interface Attachment {
  id: ID;
  companyId: ID;
  ownerType: 'absence';
  ownerId: ID;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Demo only: files stay in the browser (data URL when small). */
  dataUrl: string | null;
  accessClass: 'restricted';
  uploadedBy: ID;
  uploadedAt: ISOInstant;
}

// ─────────────────────────────── Exceptions, periods, exports ───────────────────────────────

export type AnomalyType =
  | 'missing_clock_out'
  | 'missing_clock_in'
  | 'overlapping_sessions'
  | 'duplicate_event'
  | 'long_session'
  | 'short_session'
  | 'off_schedule'
  | 'unplanned_session'
  | 'short_rest'
  | 'pending_correction'
  | 'shift_absence_conflict'
  | 'not_recorded';

export type AnomalyStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'dismissed';

/**
 * Review state of an anomaly. Anomalies are DETECTED from data on every read; this record only
 * stores the human review (assignee, status, history), keyed by a deterministic anomaly key.
 */
export interface DetectedAnomaly {
  key: string;
  type: AnomalyType;
  companyId: ID;
  employeeId: ID;
  date: ISODate;
  /** Record the anomaly refers to (for navigation). */
  ref: { kind: 'session' | 'shift' | 'correction' | 'absence' | 'failed_attempt'; id: ID };
  reason: Msg;
  severity: 'high' | 'medium' | 'low';
}

export interface AnomalyReview {
  id: ID;
  companyId: ID;
  key: string;
  /** Copy of the anomaly when it was first reviewed, so history survives once the data is fixed. */
  snapshot: DetectedAnomaly | null;
  assigneeId: ID | null;
  status: AnomalyStatus;
  history: ReviewEntry[];
  resolution: string | null;
  updatedAt: ISOInstant;
}

export interface ReportingPeriod {
  id: ID;
  companyId: ID;
  period: Period;
  status: 'open' | 'closed';
  closedBy: ID | null;
  closedAt: ISOInstant | null;
  /** Open exceptions at the moment of close, disclosed in every export of the period. */
  openExceptionsAtClose: number;
  closeNote: string | null;
  reopenedBy: ID | null;
  reopenedAt: ISOInstant | null;
  reopenReason: string | null;
  history: ReviewEntry[];
}

export interface ExportJob {
  id: ID;
  companyId: ID;
  kind: string;
  format: 'csv' | 'json';
  fileName: string;
  filters: string;
  period: string | null;
  recordCount: number;
  openExceptions: number;
  generatedBy: ID;
  generatedAt: ISOInstant;
  fingerprint: string;
  /** Representative exports are pseudonymised (draft RD art. 6.2; GDPR minimisation). */
  minimised: boolean;
}

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
  prevHash: string;
  hash: string;
}

/** Recorded decision when someone tries to delete a record inside its retention period (AC-TIM-04). */
export interface RetentionDecision {
  id: ID;
  companyId: ID;
  entityType: string;
  entityId: ID;
  requestedBy: ID;
  requestedAt: ISOInstant;
  outcome: 'blocked' | 'allowed';
  retentionUntil: ISODate;
  reason: string;
}

export interface Database {
  schemaVersion: number;
  seededAt: ISOInstant;
  companies: Company[];
  departments: Department[];
  worksites: Worksite[];
  users: User[];
  memberships: Membership[];
  employees: Employee[];
  relationships: EmploymentRelationship[];
  agreements: CollectiveAgreementReference[];
  policies: WorkingTimePolicy[];
  calendars: WorkingCalendar[];
  protocols: RecordingProtocol[];
  shifts: PlannedShift[];
  events: AttendanceEvent[];
  sessions: WorkSession[];
  failedAttempts: FailedAttempt[];
  corrections: CorrectionRequest[];
  absenceTypes: AbsenceType[];
  absences: AbsenceRequest[];
  attachments: Attachment[];
  anomalyReviews: AnomalyReview[];
  periods: ReportingPeriod[];
  exports: ExportJob[];
  notifications: AppNotification[];
  retentionDecisions: RetentionDecision[];
  audit: AuditEvent[];
}

export type CollectionKey = Exclude<keyof Database, 'schemaVersion' | 'seededAt'>;
