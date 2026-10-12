# DatosPilot: design, permissions, workflows and validation

## 1. Information architecture (sidebar)

| Section | Route | Purpose | Visible to (any of) |
|---|---|---|---|
| Inicio | `/` | Readiness and documentation overview, filters, drill-down, quick actions | Any active membership (content scoped) |
| Mis tareas | `/mis-tareas` | Unified task inbox: own pending items and the reviews assigned to me | Any active membership |
| Requisitos PRL | `/requisitos`, `/requisitos/:id` | Versioned requirement templates, approvals, assignments, affected employees | requirements.view |
| Empleados | `/empleados`, `/empleados/:id` | Directory, profile tabs, matrix, delta reviews, readiness decisions | employees.view_all, team.view (own profile: own.view) |
| Centros de trabajo | `/centros`, `/centros/:id` | Worksites, risks, instructions, readiness by site | worksites.view, team.view, representative.view |
| Documentación | `/documentacion`, `/documentacion/:id` | Evidence and versions, review, dates, downloads (demo), acknowledgements | evidence.view_all, team.view, own.view |
| Formación e información | `/formacion` | Catalogue, assignments (attendance / completion / evidence kept separate) | training.manage, employees.view_all, team.view, own.view |
| Equipos de protección (EPI) | `/epi` | Catalogue, issues, acknowledgements, replacement | ppe.manage, employees.view_all, team.view, own.view |
| Evaluaciones de riesgos | `/evaluaciones`, `/evaluaciones/:id` | Assessment register and workflow (no scores) | risk.view, representative.view |
| Acciones preventivas | `/acciones`, `/acciones/:id` | Action register and review workflow | actions.view_all, representative.view, team.view, own.view |
| Coordinación CAE | `/cae`, `/cae/:id` | Shared-worksite coordination, exchanges, simulated links, package | cae.view, representative.view |
| Aptitud y vigilancia de la salud 🔒 | `/salud` | Restricted: offers, responses, minimum conclusions, quarantine | health.view_conclusions, health.manage (direct access by anyone else is **denied and audited**) |
| Incidencias y revisiones | `/incidencias` | Derived exception queue with review workflow | exceptions.manage, readiness.view_all, team.view, health.manage |
| Informes y exportaciones | `/informes` | 14 reports, preview, CSV/JSON export with metadata | reports.view, own.view |
| Configuración | `/configuracion` | Company prevention data, alert window and quarantine terms, job roles and risks, access | settings.manage |
| Auditoría | `/auditoria` | Append-only log with chain check | audit.view |
| Fuentes y pruebas | `/fuentes` | Sources, BRD mapping and «probar como…» demos | everyone |

Navigation to the other portal modules lives in **NormaOne** only; DatosPilot has no cross-module menu.

## 2. Roles and permission matrix

| Capability | Owner | Company admin | PRL coordinator | Supervisor | Employee | SPA technician | SPA doctor | Prevention delegate |
|---|---|---|---|---|---|---|---|---|
| View employees / matrix | all | all | all | team + coordinated sites (masked) | own | contracted scope | all (minimal) | — (aggregates) |
| Change role / worksite | — | ✓ | — | — | — | — | — | — |
| Draft requirement | — | ✓ | ✓ | — | — | ✓ | — | — |
| Activate optional requirement | — | — | ✓ | — | — | — | — | — |
| Approve mandatory / critical requirement | — | — | — | — | — | ✓ (not own) | — | — |
| Approve health requirement | — | — | — | — | — | — | ✓ (not own) | — |
| Assign approved template | — | ✓ | ✓ | — | — | — | — | — |
| Submit evidence | — | ✓ (upload) | ✓ | — | own | ✓ | — | — |
| Accept / reject evidence | — | — | where authority = coordinator | — | — | where authority = SPA technician | — (health area only) | — |
| Mark requirement not applicable | — | — | authority | — | — | authority | — | — |
| Confirm assignment ready | — | — | ✓ (only if ready) | — | — | ✓ | — | — |
| Authorised exception | — | — | — | — | — | ✓ (only where the version allows) | — | — |
| Review change (delta) | — | — | ✓ | — | — | ✓ | — | — |
| Risk assessments | view | register | register | — | — | register + review | — | view accepted |
| Preventive actions | view | create / assign | create / review (coordinator) | own / assigned | own | create / review (technical) | — | view (masked) |
| CAE | view | manage | manage + review | — | — | view | — | view |
| Health area | — | — | conclusions, offers, measures | — | — | — | full (conclusions, quarantine) | — |
| Exports | ✓ | ✓ | ✓ | — | own summary | scope | health report | aggregates |
| Audit | ✓ | ✓ | ✓ | — | own events | — | restricted events | — |
| Settings / access | ✓ | ✓ | — | — | — | — | — | — |

Enforcement happens in three places:
1. **Services**: every read is scoped and every mutation re-checks permission.
2. **Route guards**: `RequirePerm`, plus `HealthGuard`, which audits denials.
3. **Components**: actions are hidden or disabled, with an explanation.

Out-of-scope or other-company ids show "not found" (AC-PLT-01). A revoked membership has no permissions.

## 3. Main workflows and status transitions

- **Requirement version.**
  - The lifecycle is draft → (submit) pending_approval → approve → active, or → rejected (editable again).
  - Optional and not-applicable non-health versions go draft → active, activated by the coordinator.
  - An approved version closes the previous one the day before its effective date.
  - A version is never edited after approval: changes create a new version.
  - Retirement sets an end date; history is kept.
- **Evidence.**
  - Request: «Solicitado».
  - Submit: received. Then optionally in_review, then accepted or rejected.
  - Accepting supersedes the previously accepted version of the same requirement.
  - A replacement is version n+1.
  - A clinical flag or keyword sends the file to quarantine instead.
- **Training.** assigned → scheduled → attended → completed (or cancelled). The evidence document is accepted separately.
- **PPE.** Issued, then acknowledged by the worker (a separate fact), then returned, replaced or lost.
- **Risk assessment.**
  - draft → submitted → under_review → accepted (returned to draft if rejected).
  - accepted → review_required.
  - A new version supersedes the old one on acceptance.
- **Preventive action.**
  - open → assigned (owner + justified target date) → in_progress → pending_review.
  - Submission is blocked without the configured evidence.
  - From pending_review the action becomes resolved (accepted by the authority, never by its owner) or reopened.
  - A resolved action can be reopened.
- **CAE exchange.**
  - sent → receipt confirmed (by the named recipient) → acknowledgement of understanding.
  - Received information gets a review decision (pending → accepted or rejected).
  - Share links have an expiry and can be revoked; an access to a revoked or expired link is refused and audited.
- **Health.**
  - Offer (voluntary, or a mandatory exception only with an approved requirement) → response (accepted or declined) → conclusion (medical only).
  - "Fit with measures" counts only once the coordinator confirms the measures are applied.
- **Role / worksite change.**
  - A new effective-dated assignment creates an AssignmentChange with its delta (pending_review), which the coordinator reviews and can use to request the new evidence.
  - Worksite risk changes and job-role risk changes open reviews for the affected employees.
- **Readiness.**
  - The state is derived. «Confirmar como lista» is allowed only when the state is ready.
  - An exception is allowed only on versions with `exceptionAllowed` and never on a `law` source. It lasts at most 30 days and needs a reason and a compensating measure.

## 4. Mock data (fictional)

- **Mantenimientos Levante, S.L.:**
  - 19 employees (one former);
  - 10 job roles and 8 worksites (7 customer sites, including the new Residencia Nou Campus);
  - 24 requirement templates (one pending admin proposal, one retired, one scheduled version, two with version history);
  - about 120 documents and versions (accepted, received, in review, rejected, superseded, expired, unknown expiry, quarantined);
  - acknowledgements of current and old versions;
  - training at different stages and PPE issues with and without acknowledgement;
  - 9 risk assessments (accepted, superseded, under review, review required, draft) and 8 preventive actions (every status);
  - 4 CAE cases with 8 exchanges and 1 share link;
  - health offers in every state and a fit-with-measures conclusion;
  - 2 change reviews.
- **Instalaciones Ibaigane, S.L.:** a minimal second company used for isolation tests.

## 5. Demo users

| User | Role | Demonstrates |
|---|---|---|
| Marina Peris (default) | PRL coordinator | Matrix, reviews, CAE, delta review, readiness confirmation |
| Javier Ortega | Company admin | Changes of role/site (AC-PRL-01), uploads, cannot approve, cannot invent a medical rule |
| Laura Martín | Owner | Operational view without health access |
| Elena Navarro / Amparo Ribes | Supervisors | Team readiness only; clinical attachment denied and audited (AC-PRL-03) |
| Pablo Ruiz / Sergio Llopis / Lucía Martínez | Employees | Own tasks, acknowledgements, own submissions |
| Andrés Ferrer | Employee + prevention delegate (mandate to 15/05/2028) | Aggregated, masked access |
| Jorge Sanz | SPA technician | Approvals, assessment review, exceptions; also Ibaigane (worksite-scoped) |
| Clara Ivars | SPA occupational doctor | Health area, quarantine, health requirement approval |
| Ramón Gil | Revoked former provider | Access denied |
| Iker Etxeberria | Ibaigane owner + coordinator | Company isolation |

## 6. Traceability

See `01_REGULATORY_RESEARCH.md` §3 for requirement → source → applicability → data → UI → validation → test.

The automated acceptance suite is `frontend/src/acceptance.test.ts` (spec §23 scenarios 1–34 plus extra rules). The in-app page **Fuentes y pruebas** links each BRD acceptance criterion to a demo user and screen.

## 7. Design choices

- Visual style: the portal's tokens and components (shared with FacturaFlow and JornadaPulse), restrained light-blue/neutral with status colours.
- **Status colours.** The readiness palette was validated with the dataviz checker in light and dark mode. Status is always shown with an icon, a text label, a legend and a table alternative.
- **Readiness language.** «Listo según los requisitos configurados» always appears alongside a disclaimer: it is not a professional safety approval.
- **Language.** The interface is Spanish-first with an ES/EN switch. Records, audit and exports stay in Spanish, and seeded reference texts are translated for display only.

## 8. Validation results

The latest pass was on 12/10/2026, against the dev server on port 3003 with freshly seeded data. Every check passed.

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | Clean (strict, `noUnusedLocals`). |
| `npx vitest run` | 3 files, 36 tests passed, made up of 27 acceptance scenarios and 9 i18n checks (missing English, conflicting keys, untranslated JSX text, placeholders, and runtime messages from every service flow). |
| `npm run build` | Succeeds; screens are split into lazy-loaded chunks. |
| Route smoke test: 9 demo users × 24 routes, including detail pages | 0 console errors. Each role reaches the screens in the permission matrix (§2). Other screens show «Esta sección no está disponible para su rol», and out-of-scope records show «Registro no disponible». The revoked provider (Ramón) sees only «Sin acceso activo» and the public sources page. |
| Mobile check at 375 px (coordinator, employee, doctor, delegate × every route) | No horizontal page scroll. |
| English interface (5 users × 27 routes) | No Spanish interface text left. Only proper names, such as the training provider's company name, stay in Spanish. |
| Privacy flow | A supervisor opening `/salud` directly is denied and the attempt is audited as restricted. The admin's audit page hides restricted events and says so. The occupational doctor sees the denial in the restricted audit excerpt. No diagnosis or clinical-record text appears in the health area. |

Additional checks made while building the screens:
- Acceptance tests 1–34 (spec §23) for the service layer: role and worksite changes with delta, four-eyes approval, upload ≠ approval, CAE sent ≠ received ≠ acknowledged, a lawful decline that is not marked non-compliant, critical blocking with no override, exceptions only where the version allows them, and clinical files sent to quarantine.
- Integration rules added after the screens were built:
  - seed ids are unique per company;
  - action owners can attach evidence;
  - receipt confirmation is limited to information assigned to the person;
  - received CAE documents must belong to the case or its site.
- Browser walkthroughs by the screen contributors covered:
  - coordinator: request evidence, mark not applicable, complete a change review, create and activate an optional requirement, assign and end an assignment;
  - admin: role/worksite change with a live delta preview; the admin's own proposed health rule cannot be approved;
  - SPA technician: start review and accept, exception on PEMP, accept an action;
  - doctor: rejects an unsupported health rule; quarantine;
  - supervisor: scoped team, and a clinical attachment request denied with a toast and audited;
  - employee: own record only; confirms receipt from Mis tareas;
  - delegate: masked, aggregated views.

Known limitations of this pass:
- Deactivating a worksite, or changing only its activities, opens requirement reviews only for people whose requirements actually change.
- Some English plurals read «1 participants».
- Health access-denial notifications are translated only for the resource names in use today.
