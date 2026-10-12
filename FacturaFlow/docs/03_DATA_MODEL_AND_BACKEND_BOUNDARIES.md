# Facturas y Gastos: data model and backend boundaries

This document is the starting point for the database and API design. The canonical type definitions are in [`frontend/src/domain/types.ts`](../frontend/src/domain/types.ts).
Every persisted entity has a stable `id` and a `companyId`. `companyId` is the tenant key, and every query must be scoped by it (SEC-01).

## 1. Entities

| Entity | Purpose | Key fields / relationships | Mutability |
|---|---|---|---|
| **Company** | Tenant / taxpayer | NIF, legal form, registered address, worksites, tax administration, `profileReviewedAt`, module entitlements | Editable with audit |
| **FinanceConfig** (1:1 Company) | Applicability facts and decisions | `taxpayerType`, `territory`, `siiParticipant`, `vatRegime`, `priorYearTurnoverBand`, `sifMode`, `sif`/`b2b` *ApplicabilityDecision* (state, deadline, ruleIds, reviewer), `approvedTaxCodes[]`, IRPF withholding, `configApprovedAt` | Changing a fact → re-derive deadlines and withdraw approval |
| **ProviderConfig** (1:1 Company) | Fiscal provider integration | status, mandate ref and expiry, component version, producer declaration, supported scenarios | Integration owner |
| **InvoiceSeries** (N:1 Company) | Correlative numbering | `prefix`, `kind` (ordinary/rectifying), `nextNumber`, `padding`, `active` | Prefix, kind and format frozen once used; the counter never decreases |
| **TaxCode** (global catalogue) | Tax treatments | rate, qualification (S1/S2/E1…), legal reference, mandatory mention, `supportStatus` | Versioned reference data |
| **RuleVersion** (global) | Versioned legal and deadline rules | `key`, `value`, `publicationDate`, `effectiveDate`, `status` (incl. `announced`), sources, `supersedesId` / `supersededById` | Append-only versions |
| **User**, **Membership** (User × Company) | Identity and per-company roles | roles[], `validUntil`, `status` / `revokedAt`, supervisor `approvalLimitCents` and `teamUserIds`, gestoría `mandateRef` | Revocation is a state change, never a delete |
| **Customer**, **Supplier** (N:1 Company) | Parties | kind, legal name, ID type and number, address, terms, defaults; `archived*` | Archived, never deleted |
| **Invoice** (N:1 Company, N:1 Customer, N:1 Series) | Sales invoice / rectifying invoice | `number` (assigned at issue), `customerSnapshot` and `issuerSnapshot` (frozen at issue), `lines[]`, `totals` snapshot, four status tracks, `review`, approval and issue actors, provider IDs, `pendingOperationId`, `rectification` → original, `rectifiedByIds[]` | Editable only while `draft`. Afterwards it changes state only through workflow transitions |
| InvoiceLine (embedded) | Line items | qty, unit price (cents), discount %, `taxCode` | Part of the invoice version |
| **FiscalOperation** (N:1 Invoice) | Each provider call | `operationKey` (idempotency), attempt, reserved number, state, request and response IDs, response code and message, errors, reconciliation actor | Insert, then a single result update |
| **DeliveryEvent** (N:1 Invoice) | Send / delivery / exchange | channel, recipient, status, detail | Insert-only |
| **PaymentEvent** (N:1 Invoice) | Collections | `kind` payment/reversal, date, amount, method, reference, `reversesPaymentId` | Insert-only (reversal = new event) |
| **Dispute** (N:1 Invoice) | Collection dispute | reason, `holdReminders`, open/resolved, resolution | Open → resolved |
| **CollectionReminder** (N:1 Invoice) | Reminder log | offset, status (sent/delivered/failed/**suppressed**), reason | Insert-only |
| **CollectionPolicy** (1:1 Company) | Reminder schedule | offsets, suppress-when-disputed | Editable with audit |
| **ExpenseRecord** (N:1 Company, N:1 Supplier?) | Supplier invoice **or** employee expense (`kind`) | document type and number, dates, accounting period, category, base / VAT / withholding / total, recipient-NIF flag, `submittedBy`, review status and reviewer, payment status, `attachmentIds[]`, acknowledged duplicates, simulated extraction | Editable only in draft or rejected |
| **Attachment** (N:1 owner) | Evidence file metadata | file name, MIME type, size, fingerprint, `accessClass`, `version`, `supersedesId` | Replacing creates a new version |
| **HandoverPackage** (N:1 Company) | Accountant handover per period | period, status, checklist items (auto vs manual), linked exports, delivered and acknowledged actors | in_preparation → delivered → acknowledged |
| **ExportRecord** (N:1 Company) | Every export generated | kind, format, file name, period, filters, record count, total, fingerprint, scope note | Insert-only |
| **AppNotification** | In-app notices | type, non-sensitive title and body, recipient roles and users, link, `dedupeKey`, `readBy` | Read state only |
| **AuditEvent** | Business audit trail | `seq`, actor and roles, company, time, action, entity, summary, reason, changes[], `prevHash` / `hash` chain | **Append-only** |

**Derived (never stored):** collection status, outstanding balance, overdue days, ageing bucket, tasks. Collections are tracked on the *original* invoice: a rectification by differences adds its signed amount, and a rectification by substitution replaces it. See `store/selectors.ts`.

## 2. Status model (four independent tracks)

| Track | Values | Owner of truth |
|---|---|---|
| Document | draft (+ review: requested / returned) → approved → issued → rectified | Portal workflow |
| Fiscal | not_submitted → pending → accepted / rejected / needs_review | **Fiscal provider** (issuance authority, BRD §17) |
| Exchange | not_sent → sent → delivered / delivery_failed (accepted/rejected: B2B only) | Delivery channel |
| Collection | unpaid / partial / paid / disputed (derived) | Payment events and disputes |

## 3. API boundary (what replaces the mock layer)

The `src/services/*.ts` modules are written as the future API. Each call resolves the request context, checks permissions and tenant ownership, validates business rules, mutates state, and appends an audit event, all in one transaction. A backend should implement the same contracts:

| Service function | Suggested endpoint | Server-side rules to enforce |
|---|---|---|
| `saveDraft`, `deleteDraft` | `POST/PUT/DELETE /companies/{c}/invoices[/id]` | draft-only, series kind, tenant scope |
| `requestApproval`, `returnToAuthor`, `approveInvoice`, `revokeApproval` | `POST /invoices/{id}/approval…` | FIN-02 validation; separation of duties |
| `issueInvoice` | `POST /invoices/{id}/issue` (Idempotency-Key = `inv:{id}:issue`) | applicability gate, row lock, number reservation in the same transaction, provider call outside the transaction, uncertain-result lock |
| `reconcileOperation`, `resubmitFiscal` | `POST /fiscal-operations/{id}/reconcile`, `/invoices/{id}/fiscal/resubmit` | provider query by key, never a blind retry |
| `createRectification` | `POST /invoices/{id}/rectifications` | issued originals only, separate series, 4-year limit, one in preparation at a time |
| `recordPayment`, `reversePayment`, `openDisputeOn`, `resolveDispute`, `runReminders` | `/invoices/{id}/payments`, `/disputes`, `/reminders/run` | amount ≤ outstanding, cumulative cash < €1,000, suppression rules |
| `saveExpense`, `submitExpense`, `reviewExpense`, `addAttachment`, `markExpensePaid` | `/companies/{c}/expenses…`, `/attachments` (signed upload URLs) | evidence required, duplicate acknowledgement, supervisor limit, no self-approval |
| `createExport`, `exportHandover`, `deliverHandover`, `acknowledgeHandover` | `/exports`, `/handovers…` | gestoría sees approved / issued records only |
| `updateFinanceConfig`, `recordApplicabilityDecision`, `saveSeries`, `inviteUser`, `revokeMembership` | `/companies/{c}/settings…`, `/memberships` | owner only; immediate revocation (invalidate sessions and queued jobs) |

## 4. External integrations (simulated now)

| Integration | Prototype stand-in | Production need |
|---|---|---|
| Fiscal provider / SIF (VERI\*FACTU) | `services/mock/fiscalProvider.ts`, with separate "remote" state, idempotent by key, scenarios accept / errors / reject / timeout / outage | Provider selected under D-03: per-version producer declaration, AEAT record remission, Huella chaining, QR, CSV acknowledgement |
| B2B e-invoicing (FIN-09, conditional) | Not implemented; blocking gate only | UBL/EN 16931 via SPFE or a private platform, status reporting (accept/reject/paid), PDF companion for > €8 M issuers during the first year |
| E-mail delivery and reminders | `services/mock/channels.ts#sendEmail` | Transactional e-mail provider with bounce webhooks (INT-04) |
| Document recognition | `extractFromDocument` (suggestions only) | Optional OCR. Never auto-approves or decides tax treatment |
| NIF census / VIES | Structural validation only | AEAT census check; VIES for intra-EU numbers |
| Accounting / payroll | CSV (`;`, decimal comma) and JSON exports | Mapping approved by the receiving adviser |

## 5. Known prototype limitations

- Authorisation runs in the browser. Production must enforce it server-side, with MFA for privileged roles.
- localStorage is demo storage only: not encrypted, not shared, and limited to a few MB. Large attachments keep metadata only.
- Fingerprints and the audit hash chain use a non-cryptographic demo hash. Production must use SHA-256 with immutable storage.
- Simplified invoice issue, intra-EU and international operations, special VAT regimes, Canarias/Ceuta/Melilla, foral territories and B2G (FACe) are out of the initial scope and blocked.
- Seed data is anchored to October 2026. The "Fecha simulada" setting moves the working date without rewriting records.
