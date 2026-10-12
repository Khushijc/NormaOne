# DatosPilot: PRL y Documentación (interactive prototype)

Mini-app 03 of the **Spain SME Compliance Portal** (BRD ES-SME-BRD-001 v1.0, *PRL y Documentación*). This frontend-only functional mock-up covers:
- versioned requirement templates with professional approval
- employee and worksite requirement matrices with delta reviews when roles or sites change
- versioned evidence with reviews, separate legal, provider and internal dates, and quarantine of misplaced clinical files
- training (attendance, completion and evidence kept separate)
- PPE issue and acknowledgement
- a risk-assessment register (no scoring)
- preventive actions with evidence-based closure
- shared-worksite coordination (CAE) with simulated scoped links
- a restricted health area holding only minimum fitness conclusions
- explainable assignment readiness with critical blocking and controlled exceptions
- an exception queue
- reports and exports with redaction
- role-based access, notifications and an append-only audit trail

All data is fictitious.

> **Not legal advice; not a certified prevention system.** DatosPilot coordinates evidence. It does not replace the prevention service, does not perform risk assessments or medical decisions, and does not certify compliance with Spanish occupational-safety law or say that any workplace is safe. Configurable rules need review by qualified professionals (see `docs/01_REGULATORY_RESEARCH.md` §5).

## Run

```bash
cd frontend
npm install        # .npmrc sets legacy-peer-deps
npm run dev        # http://localhost:3003 (FacturaFlow 3001, JornadaPulse 3002)
npm test           # Vitest: acceptance scenarios against the service layer + i18n coverage
npm run build      # type-check + production build
```

Requires Node 22.12 or later.

**Demo data.** Data persists in `localStorage` (demo only: not secure storage and not tamper-proof). It is seeded on the first visit, relative to that day. The user menu (top right) switches demo users and companies and resets the demo data.

**Language.** The **ES | EN** switch changes the interface language. Records and exports stay in Spanish.

## Documentation

- [docs/01_REGULATORY_RESEARCH.md](docs/01_REGULATORY_RESEARCH.md): official sources, requirement traceability, BRD discrepancies, professional-review items
- [docs/02_DESIGN_AND_TRACEABILITY.md](docs/02_DESIGN_AND_TRACEABILITY.md): information architecture, permission matrix, workflows, demo users, validation
- [docs/03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md](docs/03_DATA_MODEL_AND_BACKEND_BOUNDARIES.md): entities, derived logic, proposed API and backend boundaries
- [docs/BUILD_BRIEF_SCREENS.md](docs/BUILD_BRIEF_SCREENS.md): contributor rules
- In-app: **Fuentes y pruebas** (`/fuentes`)

## Code map

```
frontend/src/domain     types (= future schema), permissions, applicability/readiness engine, exceptions, statuses, audit chain
frontend/src/data       deterministic seed generator
frontend/src/store      persistence (rollback on write failure), transactions, hooks
frontend/src/services   future API: permission/tenant/scope checks, validation, audit, notifications, exports
frontend/src/pages      screens          frontend/src/components   shared UI
```
