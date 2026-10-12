# JornadaPulse — regulatory research and requirement mapping

Prepared 12 October 2026 for the frontend prototype of mini-app 02 *Jornada y Ausencias* (BRD ES-SME-BRD-001 v1.0, §09–10, §05–06, §17, §19).
This is product research, **not legal advice**. Every item marked *Revisión profesional* must be confirmed by a qualified Spanish labour adviser (graduado social / abogado laboralista) before a live release. The BRD itself states that it "is not a certification of legal compliance".

## A. Status keys

| Key | Meaning in this document and in the app's rule register |
|---|---|
| **Confirmado** | In force; read on the official BOE / EUR-Lex / CURIA / AEPD source on the date above. |
| **BRD** | Stated by the BRD as a product requirement (not necessarily a legal rule). |
| **Proyecto (no vigente)** | Official draft or announced rule; **not** published in the BOE. The app may be *prepared* for it but must never present it as an obligation. |
| **Configurable** | Depends on the collective agreement (convenio), contract, company agreement or employer policy. Stored as a versioned policy with source, editor and effective date. |
| **Revisión profesional** | Interpretation not verifiable from the text alone; requires adviser sign-off. |
| **Diseño** | Product-design recommendation (ours), not a legal or BRD requirement. |

## B. Official sources consulted

| ID | Source | URL | Notes |
|---|---|---|---|
| L1 | Real Decreto Legislativo 2/2015, Estatuto de los Trabajadores (ET), consolidated text (last update 03/10/2026) | https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430 | Arts. 12.4.c, 34, 35, 36, 37, 38 read. Art. 34 last modified 29/06/2023. |
| L2 | Ley 4/2026, de 1 de octubre (derechos de las personas con discapacidad), DF 10ª — modifies ET art. 37.6; in force 23/10/2026 | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-20528 | Changes reduced working-time (reducción de jornada) rules for carers; **not yet in force** on 12/10/2026. |
| L3 | Proyecto de Real Decreto por el que se desarrolla el ET en materia de registro de jornada (Ministerio de Trabajo, audiencia pública 09/10/2025) | https://expinterweb.mites.gob.es/participa/listado/download/6cb63e79-48a8-4e99-9784-3a0b26ae6106 | Draft only. Urgent processing authorised 30/09/2025. Not found in the BOE as of 12/10/2026 (secondary sources report a critical Consejo de Estado opinion in March 2026 and no approval). **Recheck before launch.** |
| L4 | Directive 2003/88/EC concerning certain aspects of the organisation of working time | https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32003L0088 | Daily rest (art. 3), breaks (art. 4), weekly rest (art. 5), annual leave (art. 7). |
| L5 | CJEU judgment of 14 May 2019, C‑55/18, CCOO v Deutsche Bank SAE (ECLI:EU:C:2019:402) | https://curia.europa.eu/juris/liste.jsf?num=C-55/18 | A system that is *objective, reliable and accessible* for measuring daily working time. |
| L6 | Regulation (EU) 2016/679 (GDPR) | https://eur-lex.europa.eu/eli/reg/2016/679/oj | Art. 5(1)(c) minimisation; art. 9 special categories (health); art. 25 privacy by design. |
| L7 | Ley Orgánica 3/2018 (LOPDGDD), arts. 87–91 (digital rights at work: devices, disconnection, video, geolocation) | https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673 | Art. 88 digital disconnection policy; art. 90 geolocation. |
| L8 | AEPD, *Guía sobre tratamientos de control de presencia mediante sistemas biométricos* (23/11/2023) and press note | https://www.aepd.es/guias/guia-control-presencia-biometrico.pdf · https://www.aepd.es/prensa-y-comunicacion/notas-de-prensa/la-aepd-publica-una-guia-sobre-la-utilizacion-de-datos | Biometric time-recording is high-risk special-category processing; consent does not lift the art. 9 prohibition in employment. |
| L9 | Real Decreto 1060/2022 (modifies RD 625/2014 on temporary incapacity management): since 01/04/2023 the worker no longer delivers sick-leave certificates to the employer; the INSS communicates them electronically | https://www.boe.es/buscar/doc.php?id=BOE-A-2023-160 (in force 01/04/2023; forms: Orden ISM/2/2023, BOE-A-2023-781) | Drives "no medical documents collected" design. |
| L10 | Resolución de 17/10/2025, Dirección General de Trabajo, fiestas laborales 2026 | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-21667 | Comunitat Valenciana 2026: 1/1, 6/1, 19/3, 3/4, 6/4, 1/5, 24/6, 15/8, 9/10, 12/10, 8/12, 25/12 (+2 local). |
| L11 | Orden PCM/186/2022, de 11 de marzo (summer-time calendar 2022–2026, under RD 236/2002 / Directive 2000/84/EC) | https://www.boe.es/diario_boe/txt.php?id=BOE-A-2022-4026 | 2026: summer time starts Sunday 29/03 (02:00→03:00), ends Sunday 25/10 (03:00→02:00); one hour earlier in Canarias. No calendar for 2027+ published yet. |
| L12 | Ministerio de Trabajo, *Guía sobre el registro de jornada* (2019) | https://www.mites.gob.es/ficheros/ministerio/GuiaRegistroJornada.pdf | Official guidance (the site's TLS certificate failed to verify from our tooling; content cross-checked through secondary citations). |

BRD references used: §09–10 (TIM-01…09, AC-TIM-01…04), §05 roles, §06 PLT-01…10 and AC-PLT-01…04, §17 WF-01/WF-04, §19 SEC-01…06 and the retention schedule.

## C. Requirement → source → UI → validation → test

| # | Requirement | Source | Applicability | UI impact | Validation / rule in the app | Test |
|---|---|---|---|---|---|---|
| R01 | Daily record with the **specific start and finish time** of each worker's working day | L1 art. 34.9; BRD TIM-02 | Confirmado | *Mi jornada* clock in/out; *Registros horarios* | Each work session has a start event and (eventually) an end event; times shown to the minute with zone | `clock-in/out creates events and a session` |
| R02 | Records kept **four years**, available to workers, representatives and the Labour Inspectorate | L1 art. 34.9; BRD TIM-07, AC-TIM-04 | Confirmado | Retention panel on records and employee pages; "Representante" role; exports | Delete of a time record younger than the retention end is **blocked** and the attempt is audited; deactivating an employee never removes records | `purge blocked inside retention; decision audited` |
| R03 | Part-time: record **day by day, totalled monthly**; copy of the monthly summary given with the payslip; monthly summaries kept ≥ 4 years | L1 art. 12.4.c; BRD TIM-06, AC-TIM-03 | Confirmado | *Informes → Resumen mensual tiempo parcial*; employee "Mis resúmenes" | Monthly summary generated per period with version and generation date; summary of ordinary + complementary hours | `part-time monthly summary carries version/date` |
| R04 | Overtime: daily record totalled in the pay period; copy of the summary to the worker | L1 art. 35.5 | Confirmado | Period summaries | Totals per pay period; **no automatic overtime classification** (see R12) | `period totals match sessions` |
| R05 | How the record is organised: by collective agreement, company agreement or, failing those, employer decision after consulting worker representatives | L1 art. 34.9 | Configurable | *Configuración → Protocolo de registro*: basis (convenio / acuerdo / decisión previa consulta), date, reference | Protocol must exist before period close; shows its basis and version | `period close blocked without approved protocol` |
| R06 | System must be **objective, reliable and accessible** | L5; L4 (as interpreted) | Confirmado (EU case law) | Event receipts, immutable originals, employee self-access | Events are append-only; corrections never overwrite; employee can view/export own records | `correction keeps original event` |
| R07 | Record actual start/end and configurable breaks; capture event time, receipt time, workplace zone, source and unique event ID; return a durable receipt | BRD TIM-02, step 2 | BRD | *Mi jornada* receipt panel "Registrado · recibo #…" | Success shown only after the store write succeeds; receipt ID displayed | `success only after persistence` |
| R08 | Connectivity failure → show **"No registrado"** and a documented correction fallback; offline auto-clocking deferred | BRD §09 exceptions; L3 art. 4.d (draft) | BRD | Simulated failure toggle (demo); "No registrado" state with *Solicitar corrección* | No event is written; the failed attempt is logged as a non-recorded attempt and can seed a correction request | `simulated failure writes no event` |
| R09 | Repeated clicks must not duplicate start/end; impossible transitions blocked | BRD TIM-03 (duplicates); Diseño | BRD | Buttons disabled while pending; state machine | Idempotency key per action; clock-out without open session rejected | `duplicate clock-in rejected` |
| R10 | Flag missing, duplicate, overlapping or unusually long sessions as **review flags, not misconduct** | BRD TIM-03, step 3 | BRD | *Incidencias* | Neutral wording; anomalies derived from data; resolution never edits the original | `anomaly detection from data` |
| R11 | Never convert a planned shift into actual time; do not auto-deduct lunch or cap recorded hours | BRD §09 rules, TIM-03 | BRD | Calendar layers, legend "Planificado ≠ Registrado" | Net time = gross − *recorded* unpaid breaks only; no cap | `planned shift creates no session`, `no automatic deduction` |
| R12 | Overtime, complementary hours, entitlements, compensatory rest are configuration-dependent; no universal "> 6 h = overtime" rule | BRD §09; L1 arts. 12.5, 35 | Configurable | *Turnos y horarios → Indicadores de revisión* | Indicators labelled "Indicador de revisión (configurable)"; thresholds versioned with editor and effective date | `indicator uses policy version effective on the work date` |
| R13 | 12 h minimum between end of one working day and start of next | L1 art. 34.3; L4 art. 3 (11 h) | Confirmado (minimum) / Configurable (agreement may regulate exceptions; RD 1561/1995 special regimes) | Review indicator "Descanso entre jornadas < 12 h" | Flag only; never block recording | `short rest flagged, recording allowed` |
| R14 | Maximum 9 ordinary hours per day unless agreement sets another distribution | L1 art. 34.3 | Configurable | Review indicator | Threshold from policy (default 9 h, editable with source) | `daily indicator threshold from policy` |
| R15 | Break of ≥ 15 min when continuous working day > 6 h; counts as working time only if agreement/contract says so | L1 art. 34.4; L4 art. 4 | Confirmado (minimum) / Configurable (paid or not) | Break policy: *pausa retribuida / no retribuida* per policy | Paid breaks are not subtracted from net time; unpaid breaks are; **missing break is only a review indicator** | `paid break not deducted` |
| R16 | Weekly rest 1.5 days (accumulable up to 14 days); annual leave ≥ 30 natural days | L1 arts. 37.1, 38.1; L4 arts. 5, 7 | Confirmado (minimum) / Configurable (agreement) | Absence policy for *Vacaciones* (allowance configurable, demo default 30 natural days, labelled) | Balance shown only where a policy defines an allowance; adviser approval flag on the policy | `balance hidden without approved policy` |
| R17 | Night work 22:00–06:00; night workers ≤ 8 h average over 15 days | L1 art. 36.1 | Confirmado / Revisión profesional (classification of night worker) | Review indicator "Trabajo nocturno" on sessions | Indicator only | `night indicator for overnight session` |
| R18 | Paid leave types exist in law (marriage 15 days, serious illness/hospitalisation of relative 5 days, death of relative 2 days (+2 with travel), moving 1 day, public duties, prenatal exams, force majeure up to 4 days/year art. 37.9 …) — **agreements often improve them** | L1 art. 37.3, 37.9 | Confirmado (statutory minimums) / Configurable | *Configuración → Tipos de ausencia* with legal reference text and "revisar convenio" | Categories are configurable records; durations are informative references, never auto-approved entitlements | `category config versioned` |
| R19 | Reduction of working time for carers (art. 37.6) **changes on 23/10/2026** (Ley 4/2026 DF 10ª) | L2 | Confirmado (future effective date) | Employment relationship: *reducción de jornada* with effective date | Stored as an effective-dated relationship attribute; no automatic recalculation | `relationship change effective-dated` |
| R20 | Sick leave (IT): since April 2023 the worker does not deliver certificates; the INSS informs the employer electronically. Diagnoses are health data | L9; L6 art. 9 | Confirmado | *Ausencias* "Baja médica (IT)" — **no upload, no diagnosis field** | Category flagged `sensitive`; only dates and status stored; reason field disabled | `sick-leave form has no diagnosis/upload` |
| R21 | Biometric clocking is high-risk; consent not a valid basis in employment | L8; L6 art. 9; BRD §09 ("no facial recognition, fingerprint or continuous GPS") | Confirmado / BRD | Clocking sources: web, mobile app (simulated), kiosk PIN, manual correction. **No biometric source exists** | Source enum excludes biometrics | — |
| R22 | Geolocation and digital disconnection: specific safeguards | L7 arts. 88, 90 | Confirmado | No GPS capture; worksite chosen by the employee from a list | Location stored as declared worksite, not coordinates | — |
| R23 | Holidays: national/regional (12) + 2 local per municipality; vary by region | L10 | Confirmado (2026 Valencia list) | *Calendario* holiday layer; *Configuración → Calendarios laborales* per worksite | Calendars per worksite, versioned by year; holidays never create attendance | `holiday layer creates no session` |
| R24 | DST: store unambiguous instants + workplace zone; overnight shifts across DST must give correct elapsed time | BRD §09, AC-TIM-02; L11 | BRD / Confirmado (dates) | Session detail shows UTC instant, local time and zone offset | Durations computed on instants, never on local wall-clock strings | `overnight DST session = 7 h elapsed (29/03/2026)` |
| R25 | Corrections: preserve original, requested and approved values; reviewer and timestamp; notify outcome | BRD TIM-04, AC-TIM-01 | BRD | *Solicitudes de corrección* | Original events immutable; correction adds a superseding layer; employee notified | `approved correction preserves original` |
| R26 | Modifications need authorisation of **both** company and worker; disagreement recorded; representation informed | L3 art. 4.b (draft) | Proyecto (no vigente) → Diseño | Company-initiated corrections require employee *conformidad* or record *discrepancia* | Employer-proposed correction stays "Pendiente de conformidad" until employee accepts/disagrees | `employer correction awaits employee` |
| R27 | Record mode (on-site / remote), nature of hours, waiting times, conciliation measures | L3 art. 3 (draft) | Proyecto (no vigente) → Diseño | Session field *Modalidad: presencial / a distancia*; nature of hours left as review classification | Fields optional and labelled "preparado para el proyecto de RD" | — |
| R28 | Representatives' access must minimise personal data (no DNI, address, family data) | L3 art. 6.2 (draft); L6 art. 5(1)(c) | Proyecto / Confirmado (GDPR minimisation) | *Representante* role sees pseudonymised exports | Export for representatives omits DNI/NIE and personal contact data | `representative export minimised` |
| R29 | Absence: categories, calendar conflicts, approval authority, adviser-approved balances; evidence access-restricted and separate from time totals | BRD TIM-05 | BRD | *Ausencias* | Conflict detection vs planned shifts and other absences; approval never creates attendance | `approval creates no attendance` |
| R30 | Period close/export with unresolved exceptions disclosed; export ≠ payroll | BRD TIM-08, step 6 | BRD | *Informes y exportaciones → Cierre de periodo* | Export metadata lists open anomalies and pending corrections; close allowed only with acknowledgement | `export discloses open exceptions` |
| R31 | Company isolation; role- and action-based permissions; append-only audit; effective-dated rules | BRD PLT-02/03/06/07, SEC-01/05, AC-PLT-01/03 | BRD | All screens | Services check tenant + permission; audit chain; policy versions never retro-applied | `cross-company read refused`, `policy change not retroactive` |
| R32 | Basic clocking without biometrics; offline sync and location evidence only after review | BRD TIM-09 (P1) | BRD (deferred) | Not implemented; shown as "Fuera del alcance" | — | — |

## D. Discrepancies and clarifications versus the BRD

1. **Digital registration decree.** The BRD (cut-off 7/10/2026) does not mention the draft Royal Decree (L3). The app is prepared for its likely content (mode, breaks, traceable dual-consent modifications) but presents nothing from it as an obligation.
2. **Breaks.** ET art. 34.9 requires start and finish times; recording breaks is not explicitly required by the current Act, but the draft decree (L3 art. 3.d) would require unpaid breaks. The BRD asks for configurable breaks — implemented as *recorded* breaks with policy-defined paid/unpaid treatment.
3. **Sick-leave evidence.** The prompt's "attach simulated supporting documentation where the workflow requires it" must not apply to IT sick leave (L9). Evidence upload is enabled per category, and disabled for *Baja médica (IT)*.
4. **"Asunto personal" days** are not a statutory right under the ET; they exist only where a collective agreement grants them. The demo category is labelled *según convenio*.
5. **Art. 37.6** changes on 23/10/2026 (L2): relevant to employment relationships with *reducción de jornada*; modelled as effective-dated data, no calculation.

## E. Items requiring professional review (shown in the app's rule register)

| ID | Item |
|---|---|
| P1 | Applicable collective agreement for each demo company (e.g. *limpieza de edificios y locales* provincial agreement) — break pay, daily maximum, personal days, holiday allowance. |
| P2 | Whether the 15-minute break is paid under that agreement. |
| P3 | Classification of night workers and night-work premiums. |
| P4 | Overtime vs complementary-hours treatment for part-time contracts (art. 12.5 pacts). |
| P5 | Absence balances (vacation counting in natural vs working days, carry-over). |
| P6 | Final status and content of the digital registration decree (L3) before launch. |
| P7 | Representatives' access scope and pseudonymisation. |
| P8 | Retention beyond four years when there is litigation or inspection (legal holds). |
