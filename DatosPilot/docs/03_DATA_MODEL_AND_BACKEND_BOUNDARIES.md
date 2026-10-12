# DatosPilot: data model and backend boundaries

The TypeScript types in `frontend/src/domain/types.ts` are the proposed schema. The functions in `frontend/src/services/*` are the proposed API. Each service function resolves the caller's company, permissions and scope, validates the input, writes, appends audit events and creates notifications, in that order. A backend should implement the same contracts server-side; the browser checks in this prototype are a mock-up.

## 1. Entities (collections) and key relationships

| Group | Entity | Key fields | Notes / changes vs the suggested model |
|---|---|---|---|
| Tenant | Company | id, legalName, NIF, preventionModality[], hasPreventionDelegates | Every other row carries `companyId`. |
| | CompanySettings | alertWindowDays, clinicalKeywords[], shareLinkMaxDays | Product settings, not legal deadlines. |
| Identity | User, Membership | roles[], roleValidUntil{}, employeeId, providerId, worksiteScope[], validFrom/Until, status, reference | Membership replaces a separate "Delegation"; access is deliberately per company. |
| People | Employee | code, names, status, hireDate/endDate, managerEmployeeId, userId | Shared with JornadaPulse and FacturaFlow; DatosPilot adds EMP-019. |
| | JobRole (≈ RoleDefinition) | name, departmentId, tasks, riskTags[] | Risk tags drive applicability. |
| | EmployeeAssignment (≈ EmploymentRelationship + EmployeeWorksiteAssignment) | jobRoleId, departmentId, worksiteIds[], effectiveFrom/To, changeReason | Effective-dated; never overwritten. |
| Sites | Worksite, CustomerOrganisation | kind, customerId, coordinatorEmployeeId, activities, riskTags[], sharedWorkplace, active | |
| | PreventionProvider | kind (spa/medical/training), specialties[], contractReference, contractValidUntil | |
| | RiskTag, DocumentCategory | specialist flag; accessClass | Configurable vocabularies. |
| Requirements | RequirementTemplate | code, retiredAt, retireReason | Stable identity. |
| | RequirementVersion | version, scope{jobRoleIds, worksiteIds, riskTags, employeeIds, appliesToAll}, perWorksite, requirementType, category, evidenceMode, source{kind,label,url,assessmentId}, reviewAuthority, expiryRule, reviewRule{kind,months,setBy}, policyReviewDate, critical, exceptionAllowed, invalidatesPriorEvidence, health{kind, exceptionGround, representativesReportOn, professionalReference}, effectiveFrom/To, status, approvedBy/At/Note | Approval is part of the version; there is no separate approval entity. |
| | RequirementAssignment | target{employee/role/worksite}, effectiveFrom/To, reason | Explicit assignments of approved templates. |
| | ApplicabilityDecision | templateId, employeeId, worksiteId, reason, decidedBy, revokedAt | "Not applicable" with an authorised reviewer. |
| Evidence | EvidenceRequest | employeeId, templateId, followUpDate (internal), status | "Solicitado". |
| | EvidenceDocument | code, categoryId, employeeId / worksiteId / caseId, templateId, accessClass | Logical document. |
| | DocumentVersion (≈ DocumentVersion + EvidenceReview) | version, issuer, issueDate, **expiryMode + legalExpiryDate**, **providerReviewDate**, **internalFollowUpDate**, file (demo), status, **requirementVersionId**, reviewer, decision note, rejection reason, supersededBy | The review is stored on the version it decides. |
| | Acknowledgement | subject{document / ppe_issue}, documentVersionId, method (in_app / paper_recorded) | Separate from training and from document acceptance. |
| Training | TrainingCourse, TrainingAssignment (≈ TrainingAssignment + TrainingRecord) | refresher rule; scheduledDate, attendanceDate, completionDate, documentId | Attendance ≠ completion ≠ evidence acceptance. |
| PPE | EquipmentItem, EquipmentIssue | replacement rule; identifier, issuedAt, status, replacementDue | Acknowledgement is held in Acknowledgement. |
| Prevention | RiskAssessment | version, supersedesId, hazards[], reviewDate (only if set), documentId, linkedTemplateIds, status | No scores. |
| | PreventiveAction | source, owner, targetDate + justification, requiredEvidence, evidenceRequired, reviewAuthority, affectsReadiness, evidenceDocumentIds, notes[] | |
| CAE | CaeCase (+ CaeParticipant embedded), CaeExchange, ShareLink | exchange: sentAt, receivedAt + receiptConfirmedBy, acknowledgedAt, review | Each step is a separate fact. Share links are simulated. |
| Health (restricted) | HealthOffer, HealthConclusion, QuarantineItem | basis, response; conclusion, measures (operational only), nextReviewDate, clinicalRecordReference (external) | No diagnoses and no clinical files. |
| Monitoring | AssignmentChange | trigger, before/after, focusWorksiteIds, delta{newlyRequired, unchanged, noLongerApplicable, evidenceStillValid, evidenceNeedsReview, newCriticalUnresolved}, status | The delta review record. |
| | ReadinessDecision | kind (confirmed_ready / exception), templateIds, reason, compensatingMeasure, validUntil | Human decisions only. Readiness itself is derived. |
| | ExceptionReview | key, status, owner, history[] | Review state of derived exceptions. |
| Platform | AppNotification, ExportJob, AuditEvent | audit: seq, prevHash/hash (demo), version, recipient, restricted | Append-only. |

**Derived, not stored:**
- the requirement matrix (`domain/requirements.ts`);
- readiness per employee × worksite;
- the exception queue (`domain/exceptions.ts`).

These are recomputed on every read from the versioned rules, so every state is explainable. A backend can cache them but must invalidate the cache on writes.

## 2. Core algorithms

- **Applicability.** For each template, take the approved version in force on the date. It applies to an employee at a worksite if any of these is true:
  - the employee is listed in the version scope (`employeeIds`) or the scope is `appliesToAll`;
  - the role, worksite and risk-tag criteria all match (risk tags are the union of the role's and the worksite's);
  - an active RequirementAssignment targets that employee, role or worksite.

  `perWorksite` requirements produce one item per worksite.
- **Item status (document and training modes):**
  1. A non-revoked not-applicable decision gives `not_applicable`.
  2. Otherwise, take the latest accepted version of the same requirement and check it in this order:
     - a real expiry date in the past gives `expired`;
     - acceptance under an older requirement version, where a later version up to the current one has `invalidatesPriorEvidence`, gives `review_required`;
     - a provider review date that has passed gives `review_due`;
     - a missing provider date where the rule requires one gives `review_required`;
     - an expiry that is `per_document` and `unknown`, or `not_determined`, gives `review_required`;
     - otherwise the item is `accepted`.
  3. With no accepted version, the result is `received` or `in_review`, then `rejected`, then `requested`, then `missing`.
- **Item status (other modes):**
  - Acknowledgement mode needs an acknowledgement of the *current* accepted version of the instruction.
  - PPE mode needs an issued item, the worker's acknowledgement, and no scheduled replacement date in the past.
  - Health mode uses the offer, then the response, then the current conclusion. A voluntary offer still pending, or declined, satisfies the requirement and does not block.
- **Readiness for one employee × worksite** is the first state in this order that has a reason:
  1. **blocked**: a critical, counted item is unsatisfied and not covered by a valid exception, or an open action with `affectsReadiness` exists for that site or employee;
  2. **pending_evaluation**: no accepted risk assessment covers the role at this site, or a change review is pending for this site;
  3. **professional_review**;
  4. **incomplete**;
  5. **in_review**;
  6. **ready**.

  Every reason is returned with it. A confirmation counts only while the state is still ready.
- **Delta review.** Build the items under the before and after shapes (or before and after databases for worksite and role-risk changes) and compare their keys. Evidence is never invalidated by the change itself.

## 3. Proposed API (from the service layer)

| Area | Endpoint (suggested) | Service function |
|---|---|---|
| Requirements | `GET /requirements`, `POST /requirements`, `PUT /requirement-versions/:id`, `POST /requirements/:id/versions`, `POST /requirement-versions/:id/submit` / `approve` / `reject` / `activate`, `POST /requirements/:id/retire`, `POST /requirements/:id/assignments`, `DELETE /requirement-assignments/:id` (end, not delete), `POST /applicability-decisions`, `POST /applicability-decisions/:id/revoke` | requirementService |
| Matrix / readiness | `GET /employees/:id/requirements`, `GET /readiness?worksite=&state=`, `POST /readiness/confirm`, `POST /readiness/exceptions`, `POST /readiness-decisions/:id/revoke` | context, peopleService |
| People / sites | `PUT /employees/:id/assignment` (with `effectiveFrom`), `GET /employees/:id/changes`, `POST /changes/:id/review`, `PUT /worksites/:id`, `POST /worksites/:id/activate` / `deactivate` | peopleService |
| Evidence | `POST /evidence-requests`, `POST /documents` (multipart; scanning + quarantine), `POST /documents/:id/versions`, `POST /document-versions/:id/review-start` / `decision` / `dates`, `GET /document-versions/:id/download` (short-lived signed URL), `POST /acknowledgements` | evidenceService |
| Training / PPE | `/courses`, `/trainings/:id/schedule` / `attendance` / `completion` / `cancel`; `/equipment`, `/equipment-issues`, `/equipment-issues/:id/close` | trainingService |
| Risk / actions | `/assessments` (+ submit, review, mark-for-review, new version), `/actions` (+ assign, progress, submit, review, reopen) | safetyService |
| CAE | `/cae-cases`, `/cae-cases/:id/participants`, `/cae-exchanges` (+ steps, review), `/share-links` (+ revoke; public `GET /s/:token` with recipient verification and expiry) | caeService |
| Health (separate service and database schema) | `/health/offers`, `/health/offers/:id/response`, `/health/conclusions`, `/health/conclusions/:id/measures`, `/health/quarantine/:id` | healthService |
| Reports | `POST /exports {reportId, format, filters, recipient}` (async job for large sets) | reportService |
| Ops | `GET /tasks`, `GET /exceptions`, `POST /exceptions/:key/review`, `GET /notifications`, `PUT /settings`, `PUT /job-roles/:id`, `POST /memberships/:id/revoke` | opsService |

## 4. Backend boundaries and requirements for the next phase

1. **Tenancy and authorisation.**
   - Authorisation must be enforced on every endpoint, file, search, report and job (SEC-01).
   - Out-of-scope ids return "not found".
   - Provider memberships are limited to their company and worksites, with expiry.
2. **Health data in a separate store.**
   - Use its own schema or service, its own encryption keys and a medical-only access profile.
   - Restricted audit records must be readable only by authorised roles.
   - Clinical files are never accepted. Quarantine needs malware scanning, a hold with no ordinary download, and a deletion workflow restricted to medical staff.
3. **File storage.**
   - Private object storage with encryption at rest and short-lived signed downloads.
   - Malware and file-type validation.
   - Clinical-content detection beyond keywords, with human review.
4. **Audit.**
   - Append-only storage (write-once, or a hash chain with SHA-256 server-side).
   - The demo FNV chain in localStorage is **not** tamper-proof.
5. **Dates and reminders.**
   - Scheduled jobs create tasks from real dates only (NFR-06).
   - Email reminders must not contain health details (PLT-08).
6. **Share links.**
   - Random tokens, recipient verification (one-time code), expiry, revocation, an access log and watermarking of downloads.
7. **Retention.**
   - Use per-class schedules approved by the professionals; none are set by law in general.
   - Support legal holds and archive-not-delete for history.
8. **Integrations (later; not assumed).**
   - Prevention-provider APIs or file exchange.
   - E-signature for acknowledgements: routine acknowledgements must not be sold as qualified signatures (BRD p. 20).
9. **Shared master data with NormaOne.**
   - Employees, worksites, customers and memberships should live in the portal core. DatosPilot keeps only its prevention-specific entities.

## 5. Prototype limitations (deliberate)

- **Storage.** localStorage per browser; not secure and not shared. Demo files of 150 KB or less are kept as data URLs; larger files keep metadata only.
- **Identity.** The demo switches users and companies directly, with no authentication or MFA.
- **Not built.** There is no real email, sharing, provider integration or e-signature, and no retention or legal-hold engine.
- **Clinical detection.** Detection of clinical content uses keywords only.
- **Exception limit.** The 30-day exception maximum is a demo product setting.
