# JornadaPulse — data model and backend boundaries

Starting point for the database and API design. The canonical type definitions are in [`frontend/src/domain/types.ts`](../frontend/src/domain/types.ts). Every business record carries `companyId`, the tenant key; every query must be scoped by it (SEC-01, AC-PLT-01).

## 1. Entities and relationships

| Entity | Purpose | Key fields / relationships | Mutability |
|---|---|---|---|
| **Company** | Tenant (shared with the portal) | NIF, timezone, province, `workerRepresentation` | Portal master data |
| **Department**, **Worksite** (N:1 Company) | Organisation, own and customer sites | Worksite: kind own/customer, address, IANA `timezone`, `calendarId` | Effective-dated in production |
| **User**, **Membership** (User × Company) | Identity and per-company roles | roles[], `employeeId` link, `validFrom/validUntil` (adviser mandate), `roleValidUntil` (representative term), status/revokedAt, reference | Revocation is a state change |
| **Employee** (N:1 Company) | Person employed by the company | code, names, work email, department, primary worksite, `worksiteIds[]`, manager, status, hire/end date, `userId` | Deactivation never deletes; records retained |
| **EmploymentRelationship** (N:1 Employee) | Effective-dated employment terms | effectiveFrom/To, contract type, full/part time, weekly hours, part-time %, `agreementId`, `policyKey`, reduced hours (ET 37.6), remote allowed | New version per change; no back-dating |
| **CollectiveAgreementReference** | Agreement reference | name, code, scope, REGCON link, review status | Content is configured as policies after adviser review |
| **WorkingTimePolicy** (versioned by `key`) | Break treatment and review thresholds | version, effectiveFrom/To, status, `breaks.paidBreakKinds`, `indicators` (daily max, min rest, long/short session, missing-clock-out threshold, night window), basis, editor, approver, `supersedesId` | Append a version; never retroactive (PLT-07) |
| **WorkingCalendar** | Public holidays per year | holidays[] (date, name, scope), source and URL | Editable with audit |
| **RecordingProtocol** | How the record is organised (ET 34.9) | basis (convenio / acuerdo / decisión previa consulta), consultation date, sources, correction procedure, connectivity fallback | Versioned |
| **PlannedShift** (N:1 Employee, Worksite) | Plan only | start/end instants, `date`, timezone, status planned/cancelled | Editable; cancelling keeps the row |
| **AttendanceEvent** (N:1 WorkSession) | Evidence: clock in/out, break start/end | `at` (instant), `receivedAt`, timezone, source (web/mobile/kiosk PIN/correction/import — **no biometric source**), worksite, mode, break kind, `idempotencyKey`, `receipt`, `recordedBy`, `correctionId` | **Append-only, immutable** |
| **WorkSession** (N:1 Employee) | Groups events of one continuous work period (may cross midnight) | `date` = local start date, start/end event ids, `breaks[]` (BreakRecord), `correctionIds[]`, origin clocked/correction | Links only; values come from events plus approved corrections |
| **FailedAttempt** | A clocking that could NOT be persisted («No registrado») | action, attempted at, worksite, reason, `correctionId` | Insert, then linked to its correction |
| **CorrectionRequest** (N:1 Session or new session) | Reviewed correction layer | kind, initiatedBy employee/company, `original`, `requested`, `approved` (SessionValues), explanation, status, requester, reviewer, decidedAt, decisionReason, employeeResponse, history[] | State machine; never deleted |
| **AbsenceType** | Configurable category | legal reference (informative), paid, requiresApproval, evidence none/optional/required, **sensitive**, partial-day, allowance (with adviser approval flag), version | Versioned edits |
| **AbsenceRequest** (N:1 Employee) | Leave request | dates, partial hours, note, attachments, status, reviewer, decision reason, acknowledged conflicts, history[] | State machine; approved rows are cancelled, never deleted |
| **Attachment** | Restricted evidence | access class restricted, uploader, size, type | Demo: browser only |
| **AnomalyReview** | Human review of a detected anomaly | deterministic `key`, snapshot, assignee, status, history[], resolution | Anomalies themselves are derived, not stored |
| **ReportingPeriod** | Monthly close | status, closedBy/At, `openExceptionsAtClose`, close note, reopen data, history | Close/reopen with reasons |
| **ExportJob** | Every export | kind, format, filters, period, record count, open exceptions declared, fingerprint, minimised flag | Insert-only |
| **RetentionDecision** | Deletion attempts | entity, requester, outcome blocked/allowed, retention end, reason | Insert-only |
| **AppNotification**, **AuditEvent** | Notices and append-only business audit (hash chain) | Audit: seq, actor + roles, action, entity, employee, summary, reason, changes, prevHash/hash | **Append-only** |

**Derived (never stored):** effective session values (original events plus the latest applied correction), durations (gross, recorded breaks, unpaid breaks per the policy version in force on the work date, net), session state, review indicators, anomalies, balances, period summaries.

### ReviewDecision

The brief's *ReviewDecision* is modelled as `history[]` entries (`ReviewEntry`: at, by, action, note) inside CorrectionRequest, AbsenceRequest, AnomalyReview and ReportingPeriod, plus the decision fields on each record. A backend may normalise these into one `review_decisions` table keyed by entity type and id.

### LeaveBalance

Not stored. It is computed only for categories with an **adviser-approved** allowance (`AbsenceType.allowance.adviserApproved`). Natural or working days follow the allowance unit and the worksite calendar.

## 2. Status models

| Workflow | States | Transitions |
|---|---|---|
| Session (derived) | working, on_break, incomplete (open > threshold), complete; + corrected / correction pending | Clock events only; never auto-completed |
| Correction | pending, pending_employee, approved, rejected, applied_with_disagreement, withdrawn | `domain/status.ts › CORRECTION_TRANSITIONS` |
| Absence | draft, pending, approved, rejected, withdrawn, cancel_requested, cancelled | `domain/status.ts › ABSENCE_TRANSITIONS` |
| Anomaly review | open, acknowledged, investigating, resolved, dismissed (+ reopen) | `services/opsService.ts › reviewAnomaly` |
| Period | open, closed (+ reopen with reason) | `services/reportService.ts` |

## 3. API boundary (what replaces the mock services)

Each service function resolves the request context and checks permission, tenant and scope. It validates business rules, mutates state and appends an audit event, all in one transaction. A write failure rolls back and nothing is reported as saved.

| Service function | Suggested endpoint | Server-side rules |
|---|---|---|
| `clock` | `POST /me/attendance-events` (Idempotency-Key) | active employee, assigned worksite, remote allowed, state machine, durable receipt, server timestamp + client timestamp |
| `requestRecordDeletion` | `POST /sessions/{id}/deletion-requests` | four-year retention block, legal holds, decision recorded |
| `requestCorrection`, `proposeCorrection` | `POST /sessions/{id}/corrections`, `POST /corrections` | own record or HR, one active request, value validation, closed periods, DST resolution |
| `reviewCorrection`, `respondToProposal`, `applyWithDisagreement`, `withdrawCorrection` | `POST /corrections/{id}/decision`, `/employee-response`, `/apply`, `/withdraw` | reviewer scope, no self-approval, single decision, notify employee |
| `saveAbsence`, `reviewAbsence`, `withdrawAbsence`, `requestCancellation`, `decideCancellation`, `addAbsenceAttachment` | `/absences…` | overlaps, partial-day rules, evidence rules, conflict acknowledgement, sensitive-category masking, never create attendance |
| `saveShift`, `cancelShift` | `/shifts` | planner scope, DST gaps, overlap warnings |
| `createEmployee`, `updateEmployee`, `setEmployeeActive`, `addRelationshipVersion` | `/employees…` | unique code/email, effective dating, no back-dating, retention on deactivation |
| `newPolicyVersion`, `updateAgreementReview`, `addHoliday`, `removeHoliday`, `updateAbsenceType`, `newProtocolVersion` | `/policies…`, `/calendars…`, `/absence-types…`, `/protocols` | effective ≥ today, reason required, adviser approval flags |
| `reviewAnomaly` | `POST /anomalies/{key}/review` | scope, no self-review, note on resolve/dismiss |
| `recordRows`, `summaryRows`, `partTimeSummary`, … `createExport` | `GET /reports/{kind}`, `POST /exports` | scope filtering, minimised representative exports, metadata with open exceptions, audit |
| `closePeriod`, `reopenPeriod` | `POST /periods/{p}/close`, `/reopen` | approved protocol, acknowledgement of open items |

## 4. Integrations (none live)

| Integration | Prototype | Production need |
|---|---|---|
| Clocking devices / kiosk / mobile app | Source labels only; web clocking in the browser | Authenticated device APIs with server timestamps; offline sync only after review (TIM-09) |
| Payroll | CSV (`;`, decimal comma) and JSON exports with metadata | Mapping agreed with the receiving adviser (TIM-08); export is not payroll |
| INSS sick-leave communications | Not integrated; sick leave registered manually without medical data | Optional, privacy-reviewed integration |
| E-mail notifications | In-app notifications only | Transactional e-mail without sensitive content (PLT-08) |
| Shared portal identity | Same ids as FacturaFlow; separate browser storage | Shared identity, company and employee services (PLT-02) |

## 5. Known prototype limitations

- Authorisation runs in the browser. Production must enforce every check server-side, with MFA for privileged roles.
- localStorage is demo storage: unencrypted, per browser, limited to a few MB, not tamper-proof. The audit hash chain uses a non-cryptographic demo hash; production needs SHA-256 with write-once storage and the four-year retention control.
- The demo clock is the real browser clock; seed data is generated relative to the first visit. The DST example is fixed on 28–29/03/2026.
- Review indicator thresholds are demo values, and collective agreement content is not loaded (professional review items P1–P5).
- The draft digital time-recording decree is not in force; fields prepared for it (mode, nature of hours) are optional.
