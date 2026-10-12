# Screen build brief (for contributors)

Read first: `docs/02_DESIGN_AND_TRACEABILITY.md` (IA, roles, workflows) and `docs/01_REGULATORY_RESEARCH.md` (what is law, what is configurable, what needs professional review). Project root: `JornadaPulse/frontend`.

## Hard rules

1. **No Python** anywhere, not even as a shell helper. Edit files with the Edit/Write tools; Node only for throw-away read-only checks in a temp folder. Do not run `npm install`, do not start a dev server (one already runs on http://localhost:3002), do not touch git.
2. **Do not change** `src/domain/**`, `src/services/**`, `src/store/**`, `src/data/**`, `src/components/**` or `src/layout/**`. They are shared and tested. If you need a service change or find a bug there, describe it in your final report (file, function, problem, proposed fix) instead of editing. You may add small pure helpers inside your own page files.
3. **All business actions go through the services** (`src/services/*`), never by editing the store directly. Show success toasts only from the service result (use `useAction().run/runOk` from `components/ui`). Never show a success message for something that did not happen.
4. **Permissions at component level too.** Use `useCtx()` (`ctx.can(perm)`, `ctx.employee`, `ctx.roles`) to decide what to render. Hide or disable actions the user may not perform, but remember the service re-checks (so a disabled button is not the only control). Use the scope helpers from `services/context` (`visibleEmployeeIds`, `canReview`, `canSeeAbsenceDetail`, …) to choose which data to show.
5. **Neutral language.** An anomaly or indicator is a request for review, never a finding of misconduct. Indicators are labelled as configurable review indicators. Never claim legal compliance or certification. Keep "simulated"/"demo" labels honest.
6. **Planned ≠ actual ≠ absence ≠ payroll.** Never present planned shifts as worked time, never fabricate attendance from absences, never deduct breaks that were not recorded, never cap hours.
7. **Times**: show local workplace time with `TimeText` (tooltip carries the UTC instant and offset; "+1" for the next day). Durations with `DurationText` / `formatDuration`. Dates with `formatDate` / `formatDateLong`. Never hand-format.
8. **Spanish-first UI with English translation**: every user-visible string is Spanish source text wrapped in `t()` from `src/i18n` (keys are the Spanish text; `t('Hola {name}', { name })` for parameters). Module-level label constants: mark with `tKey('…')` and render with `t(x)`. Domain/service messages (`Msg` objects `{text, params}`) render with `msg(m)` from `components/bits`; service error messages are already translated by the toast (`describeError`). Add an English entry for every new key to **your own** dictionary part file `src/i18n/en/<part>.ts` (British English, sentence case, professional). Before adding, grep `src/i18n/en/*.ts`: if the key already exists, reuse it and do not redefine it with a different English value (a test fails on conflicts). Never pass a template literal with `${}` to `t()`.
9. **States**: every list/table needs an empty state (`EmptyState`), every form inline validation + service error toast, every destructive or decisive action a confirmation (`ConfirmDialog` / `Modal`) with a reason where the service needs one. Pagination for long tables (`usePaged` + `Pagination`), sorting via `useSort`/`SortHeader`/`sortRows`.
10. **Styles**: reuse classes from `src/styles/app.css` (look at it: `card`, `kpi`, `table-wrap`/`table`, `toolbar`, `badge`, `callout`, `grid-2/3`, `grid-main-side`, `stack`, `row`, `timeline`, `tabs` …). Put any new CSS only in your own file `src/styles/areas/<area>.css` using the existing CSS variables (light and dark). Layout must work at 375 px width without horizontal page scroll (tables scroll inside `.table-wrap`).
11. **Accessibility**: labelled inputs, buttons with text or `aria-label`, focusable interactive elements, sufficient contrast (use tokens), charts with a table alternative (`GroupedBarChart` from `components/charts` already provides one; its `format` defaults to hours).
12. Look at FacturaFlow for proven page patterns (read-only reference): `../../FacturaFlow/frontend/src/pages/DashboardPage.tsx`, `invoices/InvoiceListPage.tsx`, `invoices/InvoiceDetailPage.tsx`, `SettingsPage.tsx`.

## Shared building blocks (already written)

- `components/ui.tsx`: `PageHeader`, `Card`, `Callout`, `EmptyState`, `KV`, `Badge`, `StatusBadge`, `SimulatedTag`, `Button`, `Field`, `TextField`, `SelectField`, `TextAreaField`, `Checkbox`, `Tabs`, `Modal`, `ConfirmDialog` (`requireReason`, `reasonLabel`, `onConfirm(reason)`), `SortHeader`, `useSort`, `sortRows`, `Pagination`, `usePaged`, `useAction` (`run(fn, successMsg | (result)=>msg)`, `runOk`), `useToast`, `DateText`, `DateTimeText`.
- `components/bits.tsx`: `msg()`, `RecordStatusBadge`, `TimeText`, `DurationText`, `EmployeeLink`, `IndicatorBadges`, `ValuesView`, `INDICATOR_LABEL`.
- `components/ValuesEditor.tsx`: `ValuesEditor`, `stateFromValues`, `toValues` (session values with DST gap/ambiguity handling).
- `components/FilterBar.tsx` (uses `Filters` from reportService), `components/ExportButton.tsx` (CSV/JSON with metadata + audit), `components/AuditList.tsx`, `components/guards.tsx` (`RecordNotFound`).
- `components/charts.tsx`: `GroupedBarChart({ groups, series, ariaLabel, format?, groupHeader? })`.

## Services (the future API)

- `services/context.ts`: `getCtx`, `can`, `visibleEmployeeIds`, `timeScope`, `teamIds`, `canReview(ctx, employeeId, 'corrections'|'absences')`, `canSeeAbsenceDetail`, `visibleAbsenceEmployeeIds`, `employeeName`, `userName`, `accessibleCompanies`.
- `services/timeService.ts`: `myStatus(ctx)`, `clock({action, worksiteId, mode, breakKind?, idempotencyKey})` → `{event, session, receipt, duplicate}` / throws `NotRecordedError` (has `failedAttemptId`), `requestRecordDeletion(sessionId, reason)` → `RetentionDecision`, `retentionUntil(date)`, `getSession(ctx,id)`, `failedAttemptsFor(ctx, employeeId)`.
- `services/correctionService.ts`: `checkValues`, `requestCorrection(input)`, `proposeCorrection(input, onBehalf)`, `reviewCorrection(id, 'approve'|'reject', reason, approvedValues?)`, `respondToProposal(id, agreed, comment)`, `applyWithDisagreement(id, note)`, `withdrawCorrection(id, note)`, `visibleCorrections(ctx)`, `correctionsAwaitingMe(ctx)`.
- `services/absenceService.ts`: `absenceTypesFor`, `validateAbsence`, `conflictsFor`, `balanceFor`, `countDays`, `saveAbsence(input, submit, existingId?)`, `reviewAbsence(id, decision, reason, acknowledgedCodes)`, `withdrawAbsence`, `requestCancellation`, `decideCancellation`, `addAbsenceAttachment`, `visibleAbsences`, `absenceTypeLabel`, `absencesAwaitingMe`.
- `services/planningService.ts`: shifts (`checkShift`, `saveShift`, `cancelShift`, `canManageShiftsFor`), employees (`validateEmployee`, `createEmployee`, `updateEmployee`, `setEmployeeActive`, `validateRelationship`, `addRelationshipVersion`), policies (`newPolicyVersion`, `updateAgreementReview`, `addHoliday`, `removeHoliday`, `updateAbsenceType`, `newProtocolVersion`).
- `services/reportService.ts`: `Filters`, `EMPTY_FILTERS`, `describeFilters`, `recordRows` + `RECORD_COLUMNS`, `summaryRows` + `SUMMARY_COLUMNS`, `partTimeEmployees`, `partTimeSummary`, `absenceRows` + `ABSENCE_COLUMNS`, `correctionRows` + `CORRECTION_COLUMNS`, `exceptionRows` + `EXCEPTION_COLUMNS`, `planVsActualRows` + `PLAN_COLUMNS`, `periodRange`, `periodStatus`, `closePeriod`, `reopenPeriod`, `createExport`.
- `services/opsService.ts`: `visibleAnomalies`, `canManageAnomaly`, `reviewAnomaly(key, action, note, assigneeId?)`, `myNotifications`, `markRead`, `pendingActions`, `switchIdentity`.
- Domain: `domain/records.ts` (`effectiveValues`, `originalValues`, `appliedCorrections`, `sessionDurations`, `sessionState`, `recordStatus`, `sessionIndicators`, `policyForSession`, `policyOn`, `relationshipOn`), `domain/anomalies.ts` (`ANOMALY_LABEL`, `ANOMALY_STATUS_LABEL`, `isOpenStatus`), `domain/status.ts` (labels and transitions), `domain/time.ts`, `domain/indexes.ts` (`index(db)` fast lookups), `domain/permissions.ts` (`ROLES`).

## Cross-screen links (use these URLs, do not import other agents' components)

- New correction: `/correcciones?nueva=1&sesion=<sessionId>` or `/correcciones?nueva=1&fallo=<failedAttemptId>` or `/correcciones?nueva=1` (missing session). HR proposal: `/correcciones?nueva=1&sesion=<id>&empleado=<employeeId>`.
- New absence: `/ausencias?nueva=1` (optionally `&desde=YYYY-MM-DD`).
- Record detail `/registros/<sessionId>`, absence `/ausencias/<id>`, correction `/correcciones/<id>`, employee `/equipo/<employeeId>`, exceptions filtered `/incidencias?tipo=<type>` or `?clave=<key>`, records filtered `/registros?estado=<status>&desde=…&hasta=…&empleado=…`, calendar `/calendario?fecha=YYYY-MM-DD&vista=dia|semana|mes`.

## Verification before reporting

- `npx tsc --noEmit -p tsconfig.json` clean.
- `npx vitest run` — the domain and acceptance suites must stay green. `src/i18n` tests list missing English keys / untranslated JSX per file: none of the failures may be in your files (others are working in parallel).
- Optional browser check: `node <scratchpad>/e2e/jp-smoke.mjs` style scripts with playwright-core are available in `C:/Users/khush/AppData/Local/Temp/claude/c--Users-khush-OneDrive-Desktop-spanish/8721b6ae-70d9-4c3e-8b66-69612d016fab/scratchpad/e2e` (Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`). Session switching: set localStorage `jornadapulse.v1.session` to `{"userId":"usr_pablo","companyId":"cmp_levante"}` before navigating.

Report: files changed, what each screen does, permissions handled, any service change you need, and anything you could not finish.
