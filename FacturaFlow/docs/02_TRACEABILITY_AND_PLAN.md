# Facturas y Gastos — Requirements traceability and implementation plan

Companion to [01_REGULATORY_RESEARCH.md](01_REGULATORY_RESEARCH.md). Source IDs `[Sxx]` refer to the BRD reference register. Research IDs `A1…E5` refer to the research register.

## 1. Stack decision

The repository contained only empty `frontend/` and `backend/` folders for each mini-app. There was no framework, theme or convention to reuse.
Chosen stack, kept deliberately small:

- Vite 6, React 19 and TypeScript 5.8 (strict)
- React Router 7
- lucide-react icons
- Vitest 4 for domain and acceptance tests
- Hand-written CSS design tokens. No UI kit, which keeps the theme portable to the other four mini-apps.

## 2. Architecture (future-backend boundaries)

```
src/domain/     Pure business rules: types (= future schema), tax calc, validation, NIF, permissions, applicability gates, status meta
src/data/seed/  Mock JSON (companies, users, parties, invoices, expenses…) → materialised into the DB on first visit
src/store/      localStorage persistence (versioned, corruption-safe), in-memory DB, React bindings
src/services/   Application services = FUTURE API. Each call re-checks permissions + business rules, appends audit events.
src/services/mock/  Simulated external systems (fiscal provider, email delivery, document extraction). Replaceable by HTTP clients.
src/components/ Reusable UI primitives      src/layout/ App shell      src/pages/ Screens
```

Services are `async` and add simulated latency, so the UI already handles loading and error states the way it will with a real API.

## 3. Requirements traceability checklist

Legend: ✅ implemented in the prototype · ◐ partially (prototype limitation stated) · ⛔ conditional and disabled by design · 🧪 automated test in `src/**/*.test.ts`

### Facturas y Gastos (BRD §07–08)

| Req | Basis | Feature | Screen / workflow | Validation rules | Acceptance test | Open / review |
|---|---|---|---|---|---|---|
| **FIN-01** P0 ✅ | [S01–S06]; A1–A3, B1–B2 | Taxpayer profile with separate SIF and B2B applicability decisions (deadline, rule version, reviewer). Issue gate with a reason and an owner for each block. | Configuración → Fiscal y aplicabilidad; issue banner on the invoice; Integración fiscal | Block issue if: unsupported territory, SII participant, non-general VAT regime, config not approved, SIF pending, mode undecided, provider missing/expired/suspended, no producer declaration, or B2B in force without a connector | AC-FIN-04 🧪; demo company *Instalaciones Ibaigane* (Bizkaia) shows the blocked state | U1, U3 |
| **FIN-02** P0 ✅ | [S19]; C1–C4, D1–D8 | Customers and suppliers; configurable series; line editor; per-rate tax breakdown; mandatory mentions; approval validation | Clientes, Proveedores, Factura (editor), Configuración → Series / Tipos impositivos | Required art. 6 data; recipient NIF for B2B; no unsupported or unapproved tax code; totals recomputed; due date ≤ 60 days B2B; issue-deadline warning | 🧪 totals, NIF, validation | U6, U7 |
| **FIN-03** P0 ✅ | A6; INT-02 | Issue via simulated provider with an idempotency key `inv:<id>:issue`. Double-click guard. Uncertain outcome locks re-issue until reconciled. | Factura → Emitir; Integración fiscal → Operaciones / Conciliar | No issue while an operation is `uncertain`. A retry reuses the same key and the same reserved number. | **AC-FIN-01** 🧪 | — |
| **FIN-04** P0 ✅ | A5–A6 | Original snapshot, provider IDs, fiscal result, response history. Four independent status tracks. | Factura → Resumen / Fiscal / Envíos / Cobros | Status tracks are never collapsed. No "compliant" label. | **AC-FIN-02** 🧪 | — |
| **FIN-05** P0 ✅ | C5–C6 | Linked rectifying invoice (R1–R4, substitution or differences) in its own series, reason, approval and issue. Original preserved. Annulment and cancellation shown as separate, non-interchangeable actions. | Factura → Rectificar (wizard) | Reason required; 4-year limit; only issued originals; no in-place edit or delete of issued invoices | **AC-FIN-03** 🧪 | U10 |
| **FIN-06** P0 ✅ | D10 | Supplier invoices and employee expenses; attachments (local demo files); duplicate detection (number, amount+date, file fingerprint); submit → approve/reject with reason; supervisor limits; simulated extraction that never approves | Gastos (lista, alta, detalle) | Evidence required to submit; VAT consistency; simplified-invoice deductibility warning; duplicate acknowledgement | 🧪 duplicates | — |
| **FIN-07** P0 ✅ | D8–D9 | Full and partial payments, reversals, disputes with reminder hold, reminder policy with suppression log, ageing view | Cobros; Factura → Cobros | Amount ≤ outstanding; cash limit ≥ €1,000 blocked; no reminder when paid or on dispute hold; payment never inferred from delivery | 🧪 payments / reminders | — |
| **FIN-08** P0 ✅ | A8; [S04] | Period exports (CSV/JSON) of invoices, expenses, payments and exceptions, with reconciliation totals and counts; component version + producer declaration displayed | Gestoría; Informes; Integración fiscal | Export records count, totals, scope note and fingerprint | Manual demo (§5) | — |
| **FIN-09** C ⛔ | B1–B5 | Not implemented. Shown as a conditional capability with deadline, status "No validado", and a "no preparado para B2B" label on PDF output. | Configuración → Fiscal; Integración fiscal | Blocks issue once the B2B deadline is reached without a validated connector | AC-FIN-04 🧪 | U3, U4 |

### Shared platform requirements applied to this module (BRD §06, §18, §19)

| Req | Feature in prototype | Screen | Test |
|---|---|---|---|
| PLT-01 ✅ | Company profile, module entitlements, reviewed-profile gate | Configuración → Empresa | AC-FIN-04 🧪 |
| PLT-02 ✅ | Stable IDs, `companyId` on every record, scoped selectors, deliberate company switch | Top bar company switcher | AC-PLT-01 (direct URL to another company's invoice → "No disponible") 🧪 |
| PLT-03 ✅◐ | Role- and action-based permissions, re-checked in services; owner manages memberships, expiry and revocation. MFA is **not** simulated (production requirement). | Configuración → Usuarios y permisos; demo user switcher | AC-PLT-02 🧪 |
| PLT-04 ✅ | Task inbox with owner, backup owner, trigger, due date, and *internal target* vs *legal deadline* labels | Tareas | — |
| PLT-05 ✅◐ | Attachment metadata, versioning (replace = new version), access class. Upload ≠ approval. | Gasto → Justificantes | — |
| PLT-06 ✅ | Append-only audit with actor, company, time, reason, before/after and a demo hash chain | Auditoría; Historial tabs | 🧪 |
| PLT-07 ✅ | Versioned rule register (SIF and B2B deadlines incl. superseded and *announced* versions); a rule never applies before its effective date | Configuración → Reglas y fuentes | AC-PLT-03 🧪 |
| PLT-08 ✅◐ | In-app notifications (read/unread, links, non-sensitive previews); simulated e-mail reminders with failure visibility | Campana, Tareas, Cobros | — |
| PLT-09 ✅ | Spanish UI, EUR, dd/mm/aaaa, Europe/Madrid timestamps, scoped search, exports | All | — |
| PLT-10 ✅◐ | Archive instead of delete; issued records undeletable; retention schedule displayed; explicit demo reset | Configuración → Datos | — |
| AC-PLT-04 ✅ | A fiscal exception cannot be closed without a reconciliation result | Integración fiscal | 🧪 |
| INT-01…05 ✅◐ | Request/response IDs, idempotency keys, failure queue with owner, manual resolution path, provider outage/version/authorisation-expiry status | Integración fiscal | 🧪 |
| SEC-05 ✅◐ | No ordinary deletion of business history; export fingerprints (demo, non-cryptographic) | Auditoría, Exportaciones | — |
| NFR-07 ✅◐ | Labelled fields, keyboard navigation, visible focus, status text + icon (not colour alone) | All | Manual |

## 4. Screen map

| Route | Screen | Primary roles |
|---|---|---|
| `/` | Panel de finanzas (KPIs → filtered lists, period filter, activity) | Owner, admin, issuer, gestoría |
| `/facturas` · `/facturas/nueva` · `/facturas/:id` · `/facturas/:id/editar` · `/facturas/:id/vista` · `/facturas/:id/rectificar` | Invoices: list, editor, detail (tabs), print preview, rectification wizard | Admin (prepare), issuer (approve/issue) |
| `/cobros` | Collections: ageing, overdue, reminders, disputes, payment history | Admin, owner |
| `/clientes` · `/clientes/:id` | Customers | Admin |
| `/proveedores` · `/proveedores/:id` | Suppliers | Admin |
| `/gastos` · `/gastos/nuevo` · `/gastos/:id` | Supplier invoices and employee expenses | Employee, supervisor, admin |
| `/integracion-fiscal` | Provider status, gate, operations log, exceptions, reconciliation, simulation controls | Issuer, admin |
| `/gestoria` | Accountant workspace: assigned companies, handover checklist, exports | Gestoría |
| `/informes` | Operational reports + export | Owner, admin, gestoría |
| `/tareas` | Notifications and tasks | All |
| `/auditoria` | Audit log | Owner, admin, issuer |
| `/configuracion` | Company, fiscal applicability, series, tax codes, collections policy, users and permissions, rules and sources, demo data | Owner |
| `/requisitos` | In-app traceability: requirement → screen → how to demonstrate | All |

## 5. Status transitions

```
Documento:   draft ──(solicitar aprobación)──▶ draft·requested ──approve──▶ approved ──issue (provider)──▶ issued ──rectify issued──▶ rectified
                 ◀──────(devolver con comentario)──┘          ◀─(revoke approval)─┘
Fiscal:      not_submitted ─issue─▶ pending ─▶ accepted | rejected | needs_review(accepted_with_errors | uncertain)
             uncertain ─reconcile─▶ accepted (provider had processed) | not_processed → retry with SAME key
             rejected ─correct via rectification / resubmit─▶ pending
Envío:       not_sent ─send─▶ sent ─▶ delivered | delivery_failed ─retry─▶ sent      (accepted/rejected: B2B only, disabled)
Cobro:       derived — unpaid ─▶ partial ─▶ paid; any + open dispute ⇒ disputed (reminders held)
Gasto:       draft ─submit─▶ submitted ─▶ approved | rejected ─(edit + resubmit)─▶ submitted ; approved ─▶ paid/reimbursed
```

## 6. Demo companies (tenants)

| Company | Profile | Purpose |
|---|---|---|
| **Mantenimientos Levante, S.L.** (Valencia) | IS taxpayer, 18 employees, general regime, approved provider; SIF deadline 1 Jan 2027; turnover ≤ €8 M → B2B 6 Oct 2028 | Full end-to-end demo |
| **Carmen Ruiz Arquitectura Técnica** (autónoma, Palma) | IRPF taxpayer; SIF deadline 1 Jul 2027; 15 % IRPF withholding; B2B status reporting deferred to 2029 | Per-taxpayer deadlines, withholding |
| **Instalaciones Ibaigane, S.L.** (Bilbao) | Foral Bizkaia, not reviewed | Blocked activation with owner (AC-FIN-04) |

## 7. Acceptance scenarios: how to demonstrate

| AC | Steps in the prototype |
|---|---|
| AC-FIN-01 | As *Marta Soler (emisora)*, set the simulation to "Tiempo de espera (procesada)", issue an approved invoice, and click *Emitir* again. It is blocked: "pendiente de conciliación". Then *Conciliar*: both attempts resolve to the same provider ID and number, and only one invoice exists. |
| AC-FIN-02 | Set the simulation to "Rechazo" and issue. The invoice stays visible, *Fiscal: Rechazado*, and an exception task is assigned in Tareas and Integración fiscal. |
| AC-FIN-03 | Open an issued invoice → *Rectificar* → choose the reason and method → approve → issue. The original is unchanged, its status becomes *Rectificada*, and the link, reason and reviewer are visible on both invoices. |
| AC-FIN-04 | Switch to *Instalaciones Ibaigane*. *Emitir* is disabled, with blocking reasons and owner. Alternatively, in Configuración set turnover > €8 M and a demo date past the deadline: blocked for B2B without a connector. |

## 8. Validation results (9 Oct 2026)

| Check | Result |
|---|---|
| `npm run build` (TypeScript strict + Vite production build) | Pass. No type errors and no bundle warnings. |
| `npm test`: 20 Vitest scenarios | Pass. Covers AC-FIN-01 (×3), AC-FIN-02, AC-FIN-03 (×2), AC-FIN-04 (×2), AC-PLT-01/02/03, PLT-06 audit chain, separation of duties, payments, the cash limit, reminder suppression, expense duplicates and the supervisor limit. |
| Route smoke test, headless Edge: 44 routes and 7 role views | All render, with 0 console errors or warnings. Gestoría cannot open drafts. A revoked adviser is blocked. A cross-company URL shows "Registro no disponible". |
| UI end-to-end workflow, headless Edge | Pass. Steps: draft → request approval → admin cannot approve → issuer approves → issue with simulated timeout → re-issue blocked → reconcile (exactly one F2026-0027) → partial payment → rectification by differences issued (R2026-002), original preserved → employee expense with uploaded file → supervisor approval → persistence after reload → audit chain intact → explicit reset. 0 console errors. |
| Mobile (390 px) | No horizontal page overflow; tables scroll within their container. |
