# JornadaPulse — design, workflows and traceability

Frontend-only functional mock-up of mini-app 02 *Jornada y Ausencias*. Research and sources: [01_REGULATORY_RESEARCH.md](01_REGULATORY_RESEARCH.md). Data model and backend boundaries: [03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md](03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md).

## 1. Stack and reuse (Phase A findings)

- `JornadaPulse/frontend` was empty. The only existing implementation in the portal is FacturaFlow: Vite 6, React 19, TypeScript 5.8, React Router 7, lucide-react, Vitest, a hand-written design system (`styles/app.css`, `components/ui.tsx`) and an i18n layer (`t()`, ES/EN switch).
- JornadaPulse reuses that stack, the design tokens, the UI kit, the toast and action helpers, the i18n layer and the store pattern (seed on first visit, `transact()`, append-only audit chain). No new framework or UI library is introduced.
- Shared portal identities: same company ids (`cmp_levante`, `cmp_ibaigane`), user ids (`usr_laura`, `usr_javier`, `usr_elena`, `usr_pablo`, `usr_sergio`…) and customer sites as FacturaFlow. In production they come from the shared platform (PLT-02). The two prototypes keep separate browser storage.

## 2. Architecture

```
src/domain     pure rules: types (= future schema), time & DST, permissions, effective values,
               durations, indicators, anomaly detection, status transitions
src/data       deterministic seed generated relative to the first visit (fixed historic DST case)
src/store      localStorage persistence (rollback on write failure), transactions, hooks
src/services   the future API: permission + tenant + scope checks, validation, audit, notifications
src/components shared UI (kit, filters, values editor, export, audit list)
src/pages      screens
src/i18n       Spanish source text + English dictionary
```

## 3. Information architecture

| # | Sidebar item | Route | Who sees it |
|---|---|---|---|
| 1 | Inicio | `/` | Everyone with active access (content adapts to role) |
| 2 | Mi jornada | `/mi-jornada` | Users with an employee record (`time.clock_own`) |
| 3 | Registros horarios | `/registros`, `/registros/:id` | own / team / company / representative scope |
| 4 | Calendario | `/calendario` | own / team / company |
| 5 | Ausencias | `/ausencias`, `/ausencias/:id`, `?nueva=1` | own requests; team / company reviewers |
| 6 | Solicitudes de corrección | `/correcciones`, `/correcciones/:id`, `?nueva=1&sesion=…&fallo=…` | own; reviewers; HR proposals |
| 7 | Equipo | `/equipo`, `/equipo/:id` | supervisors (team), HR, owner, payroll (read) |
| 8 | Turnos y horarios | `/turnos` | supervisors (team shifts), HR (all), policies read-only for supervisors/payroll |
| 9 | Incidencias | `/incidencias` | supervisors (team), HR, owner, payroll (read) |
| 10 | Informes y exportaciones | `/informes` | own reports (employee), team, company, payroll, representative (minimised) |
| 11 | Configuración | `/configuracion` | HR administrator, owner |
| 12 | Auditoría | `/auditoria` | HR administrator, owner |
| — | Requisitos y pruebas | `/requisitos` | everyone (demo guide) |

## 4. Roles and permissions (route + service + component level)

| Permission | Employee | Supervisor | HR admin | Owner | Payroll adviser | Representative |
|---|---|---|---|---|---|---|
| Clock in/out, breaks (own) | ✓ | ✓ | ✓ (if employee) | — | — | ✓ (as employee) |
| View records | own | team + own | all | all | all (read) | all, minimised |
| Request correction (own) | ✓ | ✓ | ✓ | — | — | ✓ |
| Review correction | — | team | all | — | — | — |
| Propose correction (company) | — | — | ✓ | — | — | — |
| Request absence (own) | ✓ | ✓ | ✓ | — | — | ✓ |
| Review absence | — | team | all | — | — | — |
| See sensitive absence category | own | — | ✓ | — | ✓ | — |
| Plan shifts | — | team | all | — | — | — |
| Employees | — | view team | manage | view | view | — |
| Policies / agreements / calendars | — | view | manage | view | view | view |
| Exceptions | — | manage team | manage all | view | view | — |
| Reports / exports | own | team | all | all | all | minimised |
| Close / reopen period | — | — | ✓ | — | — | — |
| Audit log | own events | own events | ✓ | ✓ | — | — |

Rules: nobody reviews their own correction, absence or exception. Access is time-bound (payroll mandate end date, representative term). An expired membership has no permissions (Nuria Campos). Another company's record is reported as "not found". Every check runs in the service layer; hiding a button is never the only control. A production backend must repeat them server-side.

## 5. Workflows and status transitions

**Clocking (Mi jornada).** State machine: `not_started → working ⇄ on_break → complete`. Rejected transitions: a second clock-in while open, clock-out while on a break, clock-out or break with no open session. Each action carries an idempotency key, so a repeated click returns the same receipt. Success appears only after the transaction is persisted; a storage failure rolls back. With the simulated connection failure on, no event is written, a *FailedAttempt* is logged and the UI shows **«No registrado»** with *Solicitar corrección*. An open session older than the policy threshold (14 h) is **Incompleto**. It is never auto-completed.

**Corrections.** `pending → approved | rejected | withdrawn`. Company proposals: `pending_employee → approved` (employee agrees) or a recorded disagreement, then HR `applied_with_disagreement` or `withdrawn`. Original events are immutable. An approved correction adds a layer (`approved` values) that becomes the effective record. For a never-recorded day, approval creates a session whose events are marked `source: correction`. Validation:
- mandatory explanation (≥ 10 characters);
- end after start, ≤ 24 h, no future times, breaks inside the session and not overlapping;
- worksite assigned to the employee;
- one active request per record;
- closed periods blocked until reopened;
- DST gaps rejected, and repeated hours require a choice.

**Absences.** `draft → pending → approved | rejected | withdrawn`; `approved → cancel_requested → cancelled | approved`. Approved records are never deleted.
- Sick leave (IT) is registered without approval, with no diagnosis or document.
- Validation: end ≥ start; partial days only for categories that allow them, on the same day, with a valid time range; no overlapping active request; no vacation in the past; evidence when required.
- Conflicts shown before approval: planned shifts, recorded work, team coverage, holidays. Warnings must be acknowledged one by one.
- **Approval never creates attendance.**

**Exceptions.** Detected from data on every read: missing clock-out or clock-in, overlaps, duplicate events, long/short sessions, off-schedule or unplanned sessions, shift–absence conflicts, unreviewed corrections, «No registrado» attempts. Review steps: assign → acknowledge → investigate → resolve / dismiss (note required) → reopen. Resolving never edits the record. An approved correction resolves its anomalies and keeps their history.

**Period close.**
- Requires an approved recording protocol (ET art. 34.9) and explicit acknowledgement of open items.
- The number of open items at close is stored.
- Every export carries the current open exceptions and pending corrections in its metadata.
- Reopening needs a reason.

**Policies and employment terms.** New versions only take effect from today or later, and earlier records keep the version in force on their date (PLT-07). Seed example: the cleaning policy v2 makes the 15-minute rest paid from the 1st of the current month, while September records still use v1.

## 6. Traceability (requirement → screen → test)

| Requirement | Screen(s) | Automated test (`src/*.test.ts`) |
|---|---|---|
| TIM-01 policy versions, part/full time | Equipo (condiciones), Turnos y horarios (políticas) | *selects the policy version in force*, *a new policy version is never retroactive* |
| TIM-02 events, receipt, zone, source, idempotency | Mi jornada, detalle de registro | *records clock-in, breaks and clock-out…*, *never duplicates an event…* |
| TIM-03 flags, no plan→actual, no auto-deduction | Incidencias, Calendario | *detects the seeded anomalies*, *a planned shift never becomes actual time* |
| TIM-04 corrections with original/requested/approved | Solicitudes de corrección | *keeps the original, requested and approved values*, *refuses unauthorised and self approval*, *company proposals…* |
| TIM-05 absences, conflicts, authority, balances | Ausencias | *validates dates, overlaps and partial days*, *approval … never creates attendance*, *shows a balance only…*, *sick leave…* |
| TIM-06 daily/period summaries, part-time monthly | Informes | *produces the part-time monthly summary with version and date* |
| TIM-07 four-year retention | Detalle de registro, Equipo | *blocks deleting a three-year-old record (AC-TIM-04)* |
| TIM-08 export with exceptions disclosed | Informes (cierre y exportaciones) | *exports exactly the filtered rows and discloses open exceptions*, *closing a period requires acknowledging…* |
| AC-TIM-01 missing clock-out | Mi jornada → corrección → revisión | *shows a forgotten clock-out as incomplete*, *keeps the original…* |
| AC-TIM-02 overnight across DST | Registros (29/03/2026, Sergio Llopis) | *computes the real elapsed time of an overnight shift across the spring DST change* |
| AC-TIM-03 part-time monthly summary | Informes → Resumen mensual tiempo parcial | *produces the part-time monthly summary…* |
| AC-TIM-04 retention control | Detalle de registro (Teresa Vidal, 05/10/2023) | *blocks deleting a three-year-old record…* |
| PLT-03 permissions, PLT-01/AC-PLT-01 isolation | All | *scopes records by role*, *refuses another company record as "not found"*, *gives representatives minimised exports* |
| PLT-06 audit | Auditoría | *chains audit events and survives a reload* |

## 7. Demo accounts

| User | Company | Roles | Use it to show |
|---|---|---|---|
| Javier Ortega Pons | Mantenimientos Levante | HR admin + employee | configuration, company review, proposals, period close |
| Laura Martín Soler | Levante | Owner | company overview without sensitive absence detail |
| Elena Navarro Gil | Levante | Supervisor (technicians) + employee | team review, shift planning |
| Amparo Ribes Bosch | Levante | Supervisor (cleaning) + employee | absences and corrections of the cleaning team |
| Pablo Ruiz Esteve | Levante | Employee | forgotten clock-out (AC-TIM-01), own records only |
| Lucía Martínez Peiró | Levante | Employee, part-time, two customer sites | BRD scenario; «No registrado» attempt; part-time summary |
| Sergio Llopis Mora | Levante | Employee | overnight shifts incl. the DST night |
| Andrés Ferrer Moll | Levante | Employee + workers' representative (until 14/05/2028) | minimised representative access; company proposal awaiting his agreement |
| Rosa Bellver Gil | Levante | Payroll adviser (mandate until 31/03/2027) | period summaries and exports, no administration |
| Nuria Campos Sáez | Levante | Payroll adviser, mandate ended 31/03/2026 | access denied |
| Iker Etxeberria Uriarte | Instalaciones Ibaigane | Owner + HR | company isolation |

## 8. Validation results (12 October 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` (Vitest) | **43 / 43** — domain rules (10), acceptance scenarios (25), i18n coverage (8, incl. runtime text from real workflows) |
| `npm run build` | passes; initial bundle 89 kB (screens load on demand) |
| Browser sweep (Edge, 9 demo users × 13 routes) | 0 console errors; each role reaches only its permitted screens; expired mandate (Nuria Campos) blocked everywhere; no horizontal overflow at 375 px |
| End-to-end UI workflow | 14/14: a double click creates exactly one event and shows the receipt; clock-out is blocked while on a break; the full cycle produces 4 events; the simulated failure shows «No registrado» and writes no event, logs a failed attempt and offers a correction; data persists after reload; the audit chain verifies; the actions and the menu user switch are audited; English mode works; an explicit reset restores the seed |
| Per-screen checks by the screen builders | AC-TIM-01…04 walkthroughs, correction approval/rejection/proposal/disagreement, absence review with conflict acknowledgement (no attendance created), shift planning incl. DST gap and overnight, period close/reopen, exports matching the on-screen rows |
| Privacy | sick-leave category and reasons masked for owner and supervisors on absences, reports, employee pages, calendar and audit log; visible to HR and the payroll adviser (entitled) |
| English crawl | the only text still in Spanish is business data and official Spanish titles of laws: department names, free-text notes, policy names |

### Known limitations and recommended backend rules

- **Four-eyes control:**
  - Corrections already enforce it: whoever registered a request on an employee's behalf cannot decide it.
  - Absences registered by HR on someone's behalf can still be approved by the same HR user. The seed has no second reviewer for some employees, so add this rule server-side together with a reviewer-assignment policy.
- **Worksite time zones:** shifts and validation use the worksite time zone; clocking and records use the company zone stored on each event. Sites in another zone (e.g. Canarias) need per-site clocking zones in production.
- **Working-day counting:** `countDays('working')` counts Monday to Friday minus holidays, not each employee's actual work pattern. Balances are therefore shown only where the adviser approved the allowance.
- **Not built:** offline clocking, location evidence and biometrics are out of scope (BRD TIM-09, AEPD guidance).
