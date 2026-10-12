# DatosPilot: regulatory research and requirement traceability

Scope: mini-app 03 **PRL y Documentación** of the Spain SME Compliance Portal (BRD ES-SME-BRD-001 v1.0, 7 Oct 2026, pages 4–8, 13–14 and 19–23). This research was completed on **12 October 2026**, before implementation. Every BOE identifier, article and URL below was confirmed on the official site that day.

> **This is not legal advice.** The mock-up coordinates evidence. Under the BRD (p. 6) professional decisions stay with people. The product does not certify compliance with Spanish occupational-safety law and does not say that a workplace is safe. Items marked **(P)** need a qualified prevention, labour or privacy professional.

## 1. Official sources (source register)

| ID | Source | Identifier / URL | Status (12/10/2026) |
|---|---|---|---|
| L1 | Ley 31/1995 de Prevención de Riesgos Laborales (LPRL) | BOE-A-1995-24292 — https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292 | In force. The consolidated text was last updated 09/04/2026 by Ley 1/2026 (BOE-A-2026-7967), which changes art. 7.1.a and DA 5ª only, with no change to employer duties. |
| L2 | RD 39/1997, Reglamento de los Servicios de Prevención (RSP) | BOE-A-1997-1853 — https://www.boe.es/buscar/act.php?id=BOE-A-1997-1853 | In force. |
| L3 | RD 171/2004, coordinación de actividades empresariales (CAE) | BOE-A-2004-1848 — https://www.boe.es/buscar/act.php?id=BOE-A-2004-1848 | In force; never amended. |
| L4 | RD 773/1997, equipos de protección individual (EPI) | BOE-A-1997-12735 — https://www.boe.es/buscar/act.php?id=BOE-A-1997-12735 | In force; updated by RD 1076/2021. |
| L5 | RD 843/2011, resources for the health activity of prevention services | BOE-A-2011-11428 | In force. It applies to the prevention service, not to the employer. |
| L6 | RD 614/2001, electrical risk | BOE-A-2001-11881 — https://www.boe.es/buscar/act.php?id=BOE-A-2001-11881 | In force. Art. 5 covers training and information; annex I defines «trabajador autorizado». |
| L7 | Reg. (EU) 2016/679 (GDPR) | CELEX 32016R0679 — https://eur-lex.europa.eu/eli/reg/2016/679/oj | In force. |
| L8 | LO 3/2018 (LOPDGDD) | BOE-A-2018-16673 — https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673 | In force; art. 9 unchanged. |
| L9 | RDLeg 5/2000 (LISOS) | BOE-A-2000-15060 — https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060 | In force. Used for context only (art. 4.3 limitation periods; arts. 11–13 infringements). |
| L10 | LO 8/2021, child protection (art. 57: certificate for regular contact with minors) | BOE-A-2021-9347 — https://www.boe.es/buscar/act.php?id=BOE-A-2021-9347 | In force. Whether it applies to a contractor's staff at a school is a question for (P). |
| L11 | Ley 41/2002, art. 17 (retention of clinical records by health centres) | BOE-A-2002-22188 | In force. The duty falls on health centres; it shows that clinical records sit outside the portal. |
| L12 | RD 665/1997, art. 9 (40-year retention for carcinogens) | BOE-A-1997-11145 | In force. Specialist regime; **out of scope**. |
| L13 | RD 1627/1997 (construction works) and Ley 32/2006 (subcontracting in construction); TPC under the VII Convenio general de la construcción (BOE-A-2023-19903) | BOE-A-1997-22614, BOE-A-2006-18205 | In force; **out of scope** (BRD p. 13). |
| L14 | RD 486/1997 workplaces, plus RDL 4/2023 (adverse weather) | BOE-A-1997-8669; BOE-A-2023-11187 | In force. Conditional: outdoor work under AEMET orange or red warnings. |
| G1 | AEPD, «La protección de datos en las relaciones laborales» (**updated December 2025**) | https://www.aepd.es/guias/la-proteccion-de-datos-en-las-relaciones-laborales.pdf | Guidance. |
| G2 | INSST, Coordinación de actividades empresariales | https://www.insst.es/materias/transversales/gestion-prevencion/cae | Guidance. |
| G3 | INSST, Guía técnica EPI (2022) | insst.es (non-binding under RD 773/1997 DF 1ª) | Guidance. It recommends delivery records; a signature is "not the only possible way". |
| D1 | Draft reform of the LPRL, Estatuto and RSP (draft of 16/03/2026; draft bill approved by the Council of Ministers on 28/04/2026) | mites.gob.es / lamoncloa.gob.es | **Draft, not law.** Its proposed entry into force is 02/01/2027. It is **not applied** in the mock-up and is flagged for monitoring. |
| D2 | RD 893/2024 (household employees) | BOE-A-2024-18182; DF 1ª annulled by the Supreme Court (BOE-A-2025-20797) | Out of scope: it applies to households, not to these SMEs. |

## 2. Verified rules that shape the product

1. **Prevention plan, risk evaluation and planning** (LPRL art. 16; RSP arts. 2–9)
   - The evaluation must be updated when working conditions change and reviewed after damage to health (LPRL 16.2.a; RSP 4.2 and 6).
   - Art. 7 RSP sets the documentation fields: job, risks, affected workers, result and measures, method.
   - Planning sets deadlines, responsible people and resources.
   - **The method and the ratings are professional decisions (P).** DatosPilot stores evaluations and does not calculate scores.
2. **Information** (LPRL art. 18): each worker is told directly about the risks of their job. This is modelled as an acknowledgement of the current version, and **an acknowledgement is not training**.
3. **Training** (LPRL art. 19): given at hiring, on a change of functions and on new technology or equipment, and «repetirse periódicamente, si fuera necesario». **There is no universal annual training**: the frequency is a professional decision, and the mock-up applies a refresher interval only when a provider sets one.
4. **PPE** (LPRL art. 17.2; RD 773/1997 arts. 3–8)
   - PPE is residual to collective protection and must be supplied free of charge and replaced.
   - Workers are informed before use, preferably in writing.
   - **Which equipment is needed is decided by the evaluation (P)**: the catalogue items in the demo are illustrative only.
5. **Health surveillance** (LPRL art. 22; RSP 37.3)
   - Surveillance is voluntary. The exceptions need a **prior report from the representatives**.
   - Results are confidential. The employer receives only **conclusions on fitness** or on the need for measures (22.4).
   - The AEPD guide (G1) confirms that the employer only knows «apto/no apto» or the tasks that can be performed. The prevention service is the controller of the clinical data.
   - **The portal stores no diagnoses and no clinical reports.** A lawful decline is not non-compliance.
6. **Documentation** (LPRL art. 23): the plan, the evaluation, the planning, the health checks and their conclusions, and the list of accidents. **No retention period is set (P).** LISOS art. 4.3 limitation periods (1, 3 and 5 years) are context, not a retention rule.
7. **CAE** (LPRL art. 24; RD 171/2004)
   - Information is exchanged before work starts and on relevant change.
   - It must be **in writing for serious or very serious risks**.
   - The site owner gives information and instructions (arts. 6–8), each employer passes them to its own workers (art. 9), and a principal contractor monitors its contractors (art. 10).
   - Coordination means are listed in arts. 11–14. Whether to designate a coordinator is decided under art. 13 **(P)**.
   - Construction falls under DA 1ª and is **out of scope**.
8. **Data protection**
   - Health data is special-category data (GDPR art. 9; LOPDGDD art. 9.2). LPRL art. 22 is the legal basis, not consent.
   - Data must be minimised (GDPR 5.1.c) and secured (art. 32).
   - Criminal-record certificates are covered by GDPR art. 10 and are kept with **restricted** access.
9. **Worker participation** (LPRL arts. 33–36)
   - In firms of up to 30 workers, the delegado de personal is the delegado de prevención (35.2).
   - Delegates can access information subject to the limits in art. 22.4 (36.2). Access is therefore modelled as aggregated and minimised, with no health data (P).

## 3. Requirement traceability (BRD and research → implementation)

Applicability codes:

| Code | Meaning |
|---|---|
| **C** | Confirmed |
| **Cd** | Conditional |
| **F** | Future |
| **U** | Unresolved |
| **P** | Professional review required |

Origin codes:

| Code | Meaning |
|---|---|
| **BRD** | Explicit BRD requirement |
| **LAW** | Verified legal requirement |
| **DES** | Design recommendation |
| **ASM** | Assumption |

| ID | Requirement | Origin | Source | Applicability | Data impact | UI impact | Validation | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| PRL-01 | Templates by role and worksite with applicability, source, responsible professional, review/expiry logic and effective dates; an ordinary admin cannot invent a medical-fitness rule | BRD | L1 arts. 16, 19, 22 | C | RequirementTemplate, RequirementVersion (scope, source, reviewAuthority, expiryRule, reviewRule, health) | Requisitos PRL | Effective date ≥ today; scope required; health only via medical approval with art. 22.1 ground, representatives' report and reference; critical flag only from the professional approver; four-eyes | acc. 4, 6; template versioning test |
| PRL-02 | Each assignment linked to the applicable requirement version; a role or site change opens a delta review | BRD | L1 art. 16.2.a; RSP 4.2 | C | EmployeeAssignment (effective-dated), AssignmentChange.delta, DocumentVersion.requirementVersionId | Empleados → Puestos y centros / Cambios; Centros | No retroactive change; delta computed by the rules; evidence never invalidated by the change itself | acc. 1–3; worksite risk change |
| PRL-03 | Version training, acknowledgements, equipment records and prevention evidence; received / in review / accepted / rejected / superseded | BRD | L1 arts. 18, 19, 23; L4 | C | EvidenceDocument, DocumentVersion, Acknowledgement, TrainingAssignment, EquipmentIssue | Documentación, Formación, EPI | Upload is not approval; rejected versions kept; replacement creates a new version; reviewer = configured authority, never the submitter | acc. 7–10 |
| PRL-04 | Restricted fitness conclusions; no full medical reports; quarantine of misplaced clinical files | BRD + LAW | L1 art. 22.4; L7 art. 9; G1 | C (P on what to share) | HealthOffer, HealthConclusion (no diagnosis), QuarantineItem; restricted audit | Aptitud y vigilancia de la salud | Measures text rejects clinical words; files flagged or matching a keyword are quarantined; downloads denied and audited | acc. 14–17 |
| PRL-05 | Reminders from approved expiry/review dates; no-expiry documents; recurring review without false "expired" | BRD | L1 art. 19 | C | legalExpiryDate / expiryMode, providerReviewDate, internalFollowUpDate | Documentación, Incidencias, Inicio | Missing date → "review required"; "expired" only with a real expiry | acc. 11–13 |
| PRL-06 | CAE checklists with parties, risks, instructions, acknowledgements, corrective actions; sharing links scoped to worksite and expiry | BRD (C) | L3 arts. 4–13; G2 | Cd (shared workplaces) | CaeCase, CaeParticipant, CaeExchange (sent ≠ received ≠ acknowledged ≠ reviewed), ShareLink | Coordinación CAE | Only accepted, ordinary, site-relevant documents can be sent or shared; link expiry ≤ setting; revoked or expired links refused and audited | acc. 23–27 |
| PRL-07 | Evidence readiness separate from professional safety approval; configured critical assignment blocked; no routine override of mandatory controls | BRD | DES | C | ReadinessDecision (confirmed_ready / exception) | Empleados → Resumen; Inicio | "Ready" can be confirmed only when the derived state is ready; exceptions only where the approved version allows them, never for `source=law`, maximum 30 days, with reason and compensating measure | acc. 18–19, 22; exception test |
| PRL-08 | Employee/worksite evidence package with versions, decisions and open actions; redact what the recipient may not receive | BRD | L7 art. 5.1.c | C | ExportJob (scope, recipient, openItems, redacted, fingerprint) | Informes y exportaciones; CAE | Rows rebuilt by the service from the caller's scope; health masked; audited | acc. 16, 25–27, 31 |
| AC-PRL-01 | Change a technician's site: new items appear; unrelated accepted documents stay valid | BRD | — | C | as PRL-02 | Empleados | — | acc. 1–2 |
| AC-PRL-02 | Document with no expiry accepted; separate approved review date | BRD | — | C | expiryMode='none', providerReviewDate | Documentación | — | acc. 11–12 |
| AC-PRL-03 | A supervisor opens a fitness status, tries the clinical attachment: status scoped, attachment unavailable, attempt audited | BRD | L1 art. 22.4 | C | audit `health.access_denied` (restricted) | Empleados → Requisitos; /salud guard | — | acc. 14–15 |
| AC-PRL-04 | Missing critical training keeps readiness blocked until qualified review; CAE package only approved, site-relevant evidence | BRD | — | C | — | Empleados; CAE | — | acc. 18–19, 25 |
| PLT-05 | Versioned documents with type, source, uploader, dates, linked entity, access class, review state | BRD | — | C | EvidenceDocument.accessClass, DocumentVersion | Documentación | — | acc. 9–10 |
| PLT-06 | Append-only audit (creation, review, corrections, permissions, exports) | BRD | — | C | AuditEvent (version, recipient, restricted, demo hash chain) | Auditoría; every detail page | Audit events produced by actions only (the seed writes one import event) | acc. 27, 33–34 |
| PLT-07 | Versioned rules; no silent change of history; nothing active before its effective date | BRD | — | C | RequirementVersion.effectiveFrom/To | Requisitos PRL | — | version test |
| PLT-03 | Role/action permissions; delegation expiry; immediate revocation | BRD | — | C | Membership (roles, roleValidUntil, validUntil, worksiteScope, status) | All; Configuración → Accesos | Checks in services, route guards and components | acc. 29, 31–32 |
| R-INFO | Direct information per job; acknowledgement of the current version | LAW | L1 art. 18 | C | Acknowledgement.documentVersionId | Mis tareas, Documentación | A new document version requires a new acknowledgement | seed (Sergio, Carmen) |
| R-TRAIN | No universal frequency; refresher only if set by a provider | LAW | L1 art. 19 | C (frequency P) | ReviewRule.setBy | Formación, Requisitos | Interval requires months and source | acc. 12 |
| R-PPE | Issue ≠ acknowledgement ≠ supporting evidence; the app does not decide sufficiency | LAW + DES | L4 arts. 3–8; G3 | C (choice P) | EquipmentIssue, Acknowledgement | EPI | Identifier when configured; replacement date only when configured | readiness seed (Raúl, Iván) |
| R-CAE-W | Written information for serious risks; instructions passed to workers | LAW | L3 arts. 4.3, 8, 9 | Cd (P on severity) | CaeExchange, site-instruction requirements | CAE, Centros | — | acc. 23 |
| R-HS | Voluntary offer; exceptions only with the representatives' report; employer receives conclusions only | LAW | L1 art. 22 | C (exceptions P) | HealthOffer.basis, HealthBasis | Salud | A mandatory offer requires an approved exception requirement; a decline on mandatory basis is refused | acc. 6, 17 |
| R-DP | Minimisation, restricted health and criminal-record data, access logging | LAW | L7 arts. 5, 9, 10, 32; L8 art. 9; G1 | C | AccessClass, restricted audit | All lists, exports, notifications | Notifications never carry health detail | acc. 16 |
| R-REP | Prevention delegate access subject to art. 22.4 limits | LAW + ASM | L1 arts. 35–36 | C (scope P) | Membership role representative with roleValidUntil | Inicio, Centros, Evaluaciones, Acciones, Informes | Aggregated only; names masked in actions | acc. 31 |
| R-RET | Retention schedule per document class | BRD | L1 art. 23; L9 art. 4.3; L11 | U (P) | — (documented boundary) | — | Not implemented: needs an approved schedule | — |
| R-CONS | Construction / hazardous specialist scope excluded | BRD + LAW | L13, L12 | Out of scope | RiskTag.specialist | Evaluaciones, Centros, Configuración | Specialist tags rejected in assessments, worksites and job roles | validation |
| R-REFORM | LPRL/RSP reform (draft) | — | D1 | F | — | Fuentes y pruebas | Not applied | — |
| R-HEAT | Adverse-weather measures for outdoor work | LAW | L14 | Cd | — | — | Not modelled (no outdoor-work profile in the demo); a future configurable requirement | — |

## 4. Differences between the BRD and the verified sources

- **BRD S08 cites LPRL arts. 16, 19 and 22–24.** The research adds arts. 17–18 (PPE, information), 25 (especially sensitive workers), 28 (temporary and ETT workers), 29 (worker duties) and 35–36 (delegates). These shape the information, PPE and representative scope.
- **AEPD guidance** was updated in December 2025, after the BRD's reference set. The new edition is cited.
- **The draft reform** (D1) post-dates the BRD and is not law; it is flagged, not implemented.
- **Retention.** The BRD asks for "a role/document-specific schedule approved by the employer and prevention/privacy advisers". The research confirms there is no general legal period, so the mock-up stores none.

## 5. Items for professional review (P)

1. The prevention modality and whether a simplified plan fits (LPRL 30.5, RSP 2.4 and 11).
2. The evaluation method, ratings and review triggers (RSP 4–6).
3. Training contents and frequency (LPRL 19), including whether a refresher is "necesaria".
4. Which PPE is needed and its replacement intervals (RD 773/1997 arts. 4–6).
5. Mandatory health-surveillance exceptions, protocols, what the employer receives beyond "apto / no apto", and what supervisors may see (LPRL 22; G1).
6. CAE: whether a risk is serious or very serious (written form), whether to designate a coordinator, and whether work counts as the principal's "propia actividad".
7. The retention schedule per document class and legal holds.
8. Data-protection set-up: controller/processor roles (SPA as controller of clinical data), DPIA, access profiles and legal-basis notices.
9. Whether LO 8/2021 art. 57 applies to contractor staff at schools.
10. The prevention delegate's access scope (LPRL 36 with the 22.4 limits).
11. Monitoring of the draft reform (D1).
