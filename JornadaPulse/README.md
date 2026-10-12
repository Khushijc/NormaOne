# JornadaPulse: working-time records and absences (interactive prototype)

Mini-app 02 of the **Spain SME Compliance Portal** (BRD ES-SME-BRD-001 v1.0, *Jornada y Ausencias*). This frontend-only functional mock-up covers:
- clocking with breaks, durable receipts, «No registrado» failures and overnight / DST handling
- working-time records with transparent durations
- planned vs actual calendar
- absences with review and traceable cancellation
- transparent corrections (original / requested / approved)
- exception review
- reports, exports and period close
- employees, schedules and versioned policies
- role-based access and an append-only audit trail

All data is fictitious.

> **Not legal advice and not a certified time-recording system.** Collective agreement content, review thresholds and absence balances are configurable demo values that need review by a qualified Spanish labour professional. Nothing is connected to payroll, the INSS or any external service.

## Run

```bash
cd frontend
npm install        # .npmrc sets legacy-peer-deps
npm run dev        # http://localhost:3002 (FacturaFlow uses 3001)
npm test           # Vitest: domain rules + acceptance scenarios against the service layer
npm run build      # type-check + production build
```

Requires Node 22.12 or later. Data persists in `localStorage` and is seeded on the first visit, relative to that day, so "today" always has live data. The user menu (top right) has the demo controls:
- switch user or company;
- simulate a connection failure when clocking;
- reset the demo data.

The **ES | EN** switch changes the interface language. Records and exports stay in Spanish.

## Demo users

See [docs/02_DESIGN_AND_TRACEABILITY.md §7](docs/02_DESIGN_AND_TRACEABILITY.md) or the in-app page **Requisitos y pruebas** (`/requisitos`), which can switch to each user directly.

## Documentation

- [docs/01_REGULATORY_RESEARCH.md](docs/01_REGULATORY_RESEARCH.md): official Spanish and EU sources, requirement → source → UI → validation → test mapping, BRD discrepancies, items for professional review
- [docs/02_DESIGN_AND_TRACEABILITY.md](docs/02_DESIGN_AND_TRACEABILITY.md): information architecture, permission matrix, workflows and status transitions, traceability, demo users
- [docs/03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md](docs/03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md): entities, relationships, API contracts and integrations for the backend phase

## Code map

```
frontend/src/domain     rules: types (= future schema), time & DST, permissions, records, anomalies, statuses
frontend/src/data       deterministic seed generator
frontend/src/store      persistence (rollback on write failure), transactions, hooks
frontend/src/services   future API: permission/tenant/scope checks, validation, audit, notifications
frontend/src/pages      screens          frontend/src/components   shared UI
```
