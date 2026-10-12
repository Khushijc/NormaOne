# Facturas y Gastos — Regulatory research register

**Research date:** 9 October 2026 · **BRD baseline:** ES-SME-BRD-001 v1.0 (7 Oct 2026)
**Scope:** common-territory (mainland + Balearic) service SMEs, 5–49 employees.

> This register supports the product prototype. It is **not legal advice** and does not certify compliance.
> Every item marked *Professional review* must be confirmed by a qualified Spanish tax adviser before any live use.

**Method.** Two research passes used official sources only. These were BOE consolidated texts (boe.es, plus the open-data API), the AEAT sede and developer pages, the Hacienda press note, and the EU Official Journal. The EU Official Journal was read via the BOE mirror because EUR-Lex blocked automated access.
Commercial blogs appeared in search results but were used only to locate official documents.
Where something was **not** read directly, the Status column says so.

Status key: **Confirmed** = read in the official text and in force · **Conditional** = depends on taxpayer facts or a future date · **Unresolved** = could not be verified officially · **Professional review** = requires adviser judgement · **Announced** = public statement with no published legal instrument.

---

## A. Billing-system software (RRSIF / SIF / VERI\*FACTU)

| # | Requirement | Official source | Applicability / exclusions | Date | Status | Product consequence |
|---|---|---|---|---|---|---|
| A1 | Adapted billing systems: IS taxpayers **before 1 Jan 2027**; all other in-scope taxpayers **before 1 Jul 2027** | RD 1007/2023, DF 4 as amended by RD 254/2025 (BOE-A-2025-6600) and RDL 15/2025 DF 1 (BOE-A-2025-24446; convalidated BOE-A-2025-25695) — https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840 | Art. 3.1: IS taxpayers, IRPF taxpayers with economic activity, IRNR with a permanent establishment, entidades en atribución de rentas | 2027-01-01 / 2027-07-01 | Confirmed | The deadline is derived per taxpayer from versioned rules (`sif.deadline.is`, `sif.deadline.other`). There is no single universal date. |
| A2 | Hacienda intends to **postpone pending VERI\*FACTU obligations to October 2028** | Hacienda press note, 5 Oct 2026 — https://www.hacienda.gob.es/sgt/gabsehacienda/nota-informativa-verifactu.pdf | No instrument, exact day or taxpayer split published. The AEAT page (8 Oct 2026) calls it a "previsión". | — | **Announced** | Stored as an `announced` rule version that is **never applied**. A banner explains it. The 2027 dates stay in force. |
| A3 | Scope exclusions | RD 1007/2023 arts. 1.3, 3.3, 4, 5; AEAT FAQ (21 Jul 2026) — https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/cuestiones-generales-ambitos-aplicacion.html | SII filers are excluded (art. 3.3). Foral taxpayers (Basque Country, Navarra) fall under their own regimes. **Canarias, Ceuta and Melilla ARE in RRSIF scope** (with IGIC/IPSI). | — | Confirmed | Onboarding asks for territory, SII status and taxpayer type. SII, foral and Canarias/Ceuta/Melilla issue is **disabled** as a *product-scope* decision (BRD §02), not because the law excludes them. |
| A4 | Two compliance modes: VERI\*FACTU (automatic remission, hash chain) or non-VERI\*FACTU (XAdES-signed records, event log, kept available for AEAT). Once chosen, VERI\*FACTU is kept until year end. | RD 1007/2023 arts. 8–12, 15, 16; Orden HAC/1177/2024 — https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138 | Per taxpayer | In force since 29 Oct 2024 | Confirmed | The mode is stored in the finance configuration, and issue is blocked while it is "undecided". The first integration is a provider-supported VERI\*FACTU route (BRD §03). |
| A5 | Invoice record (*registro de alta*) fields: IDFactura (issuer NIF + series/number + date), TipoFactura F1/F2/F3/R1–R5, TipoRectificativa S/I, Desglose (Impuesto, ClaveRegimen, CalificacionOperacion S1/S2/N1/N2, OperacionExenta E1–E6), CuotaTotal, ImporteTotal, chaining Huella (SHA-256), SistemaInformatico | Orden HAC/1177/2024 arts. 10, 11, 13 and Annex; AEAT WS description v1.0.3 — https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf | All SIF records | — | Confirmed | Tax codes carry a qualification code (S1/S2/E1…). Rectifying invoices carry R1–R4 and the S/I method. The prototype records a *demo* fingerprint, **not** a real Huella. |
| A6 | AEAT response states: per record **Correcto / AceptadoConErrores / Incorrecto**; per submission Correcto / ParcialmenteCorrecto / Incorrecto; CSV acknowledgement code | Same as A5 | — | — | Confirmed | Mapped to BRD fiscal track: Correcto → *Aceptado*; AceptadoConErrores → *Requiere revisión*; Incorrecto → *Rechazado*; timeout → *Requiere revisión* (uncertain). All responses are labelled **simulated**. |
| A7 | Invoice must carry a QR code and the legend "VERI\*FACTU" / "Factura verificable en la sede electrónica de la AEAT" when records are sent to AEAT | RD 1619/2012 art. 6.5; Orden HAC/1177/2024 arts. 20–21 | VERI\*FACTU mode | — | Confirmed | The preview shows a **"QR simulado — no verificable"** placeholder. The legal legend is withheld because the prototype is not a SIF. |
| A8 | Producer *declaración responsable* per version. AEAT does not certify software. | RD 1007/2023 art. 13; Orden HAC/1177/2024 art. 15; examples — https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/EjemplosDeclaracionResponsable.pdf | Producers (art. 3.2) | Producer adaptation deadline ≈ 29 Jul 2025 (**already passed**) | Confirmed | Integration screen shows component version + declaration (demo content, labelled). Issue is blocked if no declaration. The product never claims "AEAT-certified". |

## B. Domestic B2B electronic invoicing

| # | Requirement | Official source | Applicability / exclusions | Date | Status | Product consequence |
|---|---|---|---|---|---|---|
| B1 | Mandatory B2B e-invoicing framework | Ley 18/2022 art. 12 (art. 2 bis Ley 56/2007) — BOE-A-2022-15818; **RD 238/2026** (BOE-A-2026-7295, BOE 31 Mar 2026) — https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-7295 | Invoices to businesses/professionals established in Spain (art. 3). Simplified invoices are excluded except art. 7.2 cases (art. 4). | — | Confirmed | Separate `b2b` applicability decision from `sif` (FIN-01). |
| B2 | Clock start: **Orden HAC/1028/2026** in force **6 Oct 2026**. Turnover > €8 M → **6 Oct 2027**; all others → **6 Oct 2028** | Orden HAC/1028/2026 (BOE-A-2026-20587) — https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-20587; AEAT news 7 Oct 2026 — https://sede.agenciatributaria.gob.es/Sede/todas-noticias/2026/octubre/7/solucion-publica-facturacion-electronica.html | Turnover per art. 121 LIVA, previous year | 2027-10-06 / 2028-10-06 | Confirmed (first-day and turnover-year interpretation: *Professional review*) | Deadline is derived from the turnover band. An unknown band means an unknown deadline, which triggers a warning. |
| B3 | Formats: EN 16931 semantic model in UBL, CII, EDIFACT or Facturae. The public solution (SPFE) uses UBL. Invoices issued through a private platform require a faithful copy sent to SPFE at issue. | RD 238/2026 arts. 6–7; Orden HAC/1028/2026 | — | — | Confirmed (technical annexes **not reviewed**) | **FIN-09 (C)**: not implemented. A PDF-only flow is labelled **"no preparado para B2B"**. |
| B4 | Status reporting: acceptance/rejection and full payment (with date) within 4 days. Silence = presumed acceptance. | RD 238/2026 arts. 10, 12 | Companies ≤ €8 M from 2028-10-06. **Individuals and entidades en atribución de rentas ≤ €8 M: deferred to 2029-10-06 (DT 3)** | — | Confirmed | The exchange track already models *accepted/rejected by customer*. Those states are disabled until a validated connector exists. |
| B5 | Transitional: issuers > €8 M must send a PDF alongside the e-invoice for their first 12 months unless the recipient waives it | RD 238/2026 DT 2 | > €8 M only | 2027-10-06 → 2028-10-06 | Confirmed | Recorded in the rule register for future implementation. |
| B6 | EU ViDA: Member States may impose domestic e-invoicing without authorisation. From **1 Jul 2030**: structured e-invoice definition and intra-EU digital reporting. | Directive (EU) 2025/516 — https://eur-lex.europa.eu/eli/dir/2025/516/oj | Intra-EU from 2030 | 2030-07-01 | Confirmed | Out of scope. The data model keeps EN 16931-mappable fields (line, tax breakdown, party IDs). |
| B7 | Directive 2006/112/EC arts. 217–240 (art. 226 invoice content) | https://eur-lex.europa.eu/eli/dir/2006/112/oj | — | — | **Unresolved** (EUR-Lex not re-read; transposed by RD 1619/2012, which was read) | Spanish transposition (C1) is used as the operative rule. |

## C. Invoice content, numbering and rectification

| # | Requirement | Official source | Status | Product consequence |
|---|---|---|---|---|
| C1 | Complete invoice content (art. 6.1): number + series (correlative); issue date; issuer and recipient name, NIF and address; description; unit price excl. tax and discounts; rate(s); tax amount shown separately; operation date if different; special mentions (exemption reference, "inversión del sujeto pasivo", "régimen especial del criterio de caja", "facturación por el destinatario"). Art. 6.2: a separate base for each rate and for exempt / reverse-charge lines. | RD 1619/2012 — https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696 (consolidated 31 Mar 2026) | Confirmed | FIN-02 validation blocks approval when any of these is missing. The tax breakdown is calculated per treatment, and mentions are printed automatically from the tax code. |
| C2 | Recipient NIF is required for domestic B2B (art. 6.1.d), which in practice means always for a business recipient | RD 1619/2012 art. 6.1.d | Confirmed (B2C cases: **Professional review**) | Approval is blocked for a business customer without a valid NIF. For a private individual without a NIF, the system shows a warning to confirm with the adviser. |
| C3 | Number assigned correlatively within each series. A separate series is mandatory for rectifying invoices. | Art. 6.1.a | Confirmed | Number assigned **at issue** (drafts never consume numbers). Rectifying series `R` is locked to rectifying invoices. |
| C4 | Issue deadline: at the time of the operation; for business recipients, before the 16th of the following month | Art. 11 | Confirmed | Warning if the operation date makes the invoice late. |
| C5 | Rectification: required for errors in art. 6/7 content, wrong tax, or base changes (LIVA art. 80). Within **4 years** of accrual. Must identify the rectified invoice. Either by **differences** or by **substitution**. The word "rectificativa" is **not** literally required; the separate series is. | Art. 15; Ley 37/1992 art. 80 | Confirmed | Rectification wizard: reason code R1–R4, method S/I, mandatory reason text, original link, 4-year check. The original is preserved and its document status becomes *Rectificada*. |
| C6 | Issued invoices cannot be cancelled or deleted. Fiscal-record *annulment* (registro de anulación) is a distinct SIF operation. | Orden HAC/1177/2024 art. 11; RD 1619/2012 art. 15 | Confirmed (when annulment is appropriate: **Professional review**) | Three separate actions are shown. **Rectify** is available. **Annul fiscal record** requires an adviser's decision and is simulated. **Delete/cancel** is not available for issued invoices. |
| C7 | Simplified invoices: ≤ €400 (≤ €3,000 for art. 4.2 activities). Art. 7.2: the recipient may request their NIF and a separate VAT quota. | Arts. 4, 7 | Confirmed | Issuing simplified invoices is **outside the initial scope**. On the expense side, a simplified invoice without the recipient NIF is flagged as possibly non-deductible. |
| C8 | Invoicing by the recipient / third party needs a prior agreement and a separate series | Art. 5 | Confirmed | Out of scope; documented. |
| C9 | Conservation: keep issued and received invoices for the LGT limitation period. Electronic storage must guarantee integrity, legibility and AEAT online access. | RD 1619/2012 arts. 19–23 | Confirmed | Originals are preserved. Issued records can never be hard-deleted in the UI. |

## D. VAT, withholding and payment rules

| # | Requirement | Official source | Status | Product consequence |
|---|---|---|---|---|
| D1 | IVA rates: **21 %** (art. 90), **10 % / 4 %** (art. 91). No temporary 0 %/5 % rates in force in Oct 2026. Temporary energy rate (RDL 7/2026) has expired. | Ley 37/1992 — https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740 (consolidated 7 Oct 2026) | Confirmed | Configurable tax catalogue. A company may only use codes its adviser has approved (FIN-02). 10 % and 4 % require confirmation that the service qualifies. |
| D2 | RDL 29/2026 (BOE-A-2026-20823) changes art. 91 for housing and short-term lets from 1 Dec 2026, pending Congress validation | BOE-A-2026-20823 | **Conditional** | Not used by service SMEs in scope. Recorded in the rule register only. |
| D3 | Exemptions (art. 20.Uno) need a legal reference on the invoice | Art. 20; RD 1619/2012 art. 6.1.j | Confirmed; classification needs **Professional review** | "Exento art. 20" is *requires review* and blocked unless approved for the company. |
| D4 | Reverse charge (art. 84.Uno.2º.f construction / renovation work; g electronics) requires the mention "inversión del sujeto pasivo" | Art. 84; RD 1619/2012 art. 6.1.m | Confirmed; applicability needs **Professional review** | Code ISP: 0 % with automatic mention. *Requires review*. |
| D5 | Canarias, Ceuta, Melilla are outside the VAT territory (IGIC/IPSI) | Art. 3.Dos | Confirmed | Customers with postcodes 35/38/51/52 trigger a warning. IGIC/IPSI codes are *unsupported*. |
| D6 | Recargo de equivalencia (retailers) and criterio de caja regimes | Arts. 148–163; 163 decies–sexiesdecies | Confirmed | *Unsupported* in the first release. The company gate blocks issue for any non-general regime. |
| D7 | IRPF withholding on professional fees: 15 % general; 7 % in the first year of activity and the 2 following (requires a signed statement kept by the payer) | Ley 35/2006 art. 101.5.a (BOE-A-2006-20764); RD 439/2007 arts. 75, 76, 95 (BOE-A-2007-6820) | Confirmed | Withholding appears only when the issuer is an individual professional and the customer is a business. It reduces the payable amount, not the total. |
| D8 | Late payment B2B: default 30 days; agreed terms **never above 60 days**; automatic interest at ECB + 8 pts (**10.40 % for H2 2026**, BOE-A-2026-14327); €40 compensation | Ley 3/2004 — https://www.boe.es/buscar/act.php?id=BOE-A-2004-21830 | Confirmed | Customer terms > 60 days and B2B due dates > 60 days are **blocked**. Terms > 30 days show a warning. Overdue B2B invoices show *informational* interest and €40; nothing is charged automatically. |
| D9 | Cash payments: **€1,000 or more** prohibited when either party acts as a business; split payments are aggregated | Ley 7/2012 art. 7 as amended by Ley 11/2021 (BOE-A-2012-13416) | Confirmed | Recording cash that brings the cumulative cash for an invoice to ≥ €1,000 is **blocked**. |
| D10 | Input-VAT deduction requires a complete invoice; a simplified invoice needs the recipient NIF and a separate quota (art. 7.2) | Ley 37/1992 art. 97; RD 1619/2012 art. 7.2 | Confirmed | Expense warning: "IVA posiblemente no deducible". The gestoría decides; approval never sets the tax treatment (FIN-06). |
| D11 | Retention: LGT 4-year limitation (art. 66, 70; up to 10 years in art. 66 bis cases); Código de Comercio art. 30: **6 years** | LGT BOE-A-2003-23186; CCom — https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627 | Confirmed (schedule: **Professional review**) | The default financial retention shown is 6 years, adviser-approved. Issued records cannot be deleted (PLT-10). |

## E. Identification and personal data

| # | Requirement | Official source | Status | Product consequence |
|---|---|---|---|---|
| E1 | DNI: 8 digits + letter `TRWAGMYFPDXBNJZSQVHLCKE`[n mod 23]. NIE: X/Y/Z → 0/1/2, same rule. | RD 1065/2007 arts. 18–22 (BOE-A-2007-15984) | Confirmed (letter table via Interior Ministry page snippet) | Hard validation. |
| E2 | Entity NIF: letter (A B C D E F G H J N P Q R S U V W) + 7 digits + control character | Orden EHA/451/2008 (BOE-A-2008-3580) | Letters confirmed; **control algorithm Unresolved** (not officially published) | The common algorithm is applied as a **warning only**. The backend must verify against the AEAT census service. |
| E3 | K/L/M NIF control letter | RD 1065/2007 arts. 19.2, 20.2 | **Unresolved** | Format check only. |
| E4 | EU VAT numbers are verified via VIES | — | Not fetched | Format check only. Intra-EU operations are out of scope. |
| E5 | GDPR art. 6.1.b/c legal bases; minimisation (5.1.c); erasure exception for legal obligations (17.3.b). LOPDGDD art. 19 (sole-trader contact data); art. 32 (blocking). | Reg. (EU) 2016/679 — https://eur-lex.europa.eu/eli/reg/2016/679/oj; LO 3/2018 — BOE-A-2018-16673 | Confirmed; retention policy: **Professional review** | Parties collect invoice-necessary fields only. Archiving is used instead of deleting. Erasure requests are a Privacidad-module concern (blocking, not deletion). |

---

## F. Discrepancies between the BRD and official sources

1. **VERI\*FACTU postponement (A2).** The BRD (7 Oct 2026) does not mention the Hacienda announcement of 5 Oct 2026. It is *not law*, and the BRD's 2027 dates remain correct. The prototype shows both and applies only the in-force rule.
2. **Producer deadline (A8).** The BRD omits that the producer adaptation window (≈ 29 Jul 2025) has already passed. Any provider chosen under D-03 must already hold a declaration.
3. **Canarias / Ceuta / Melilla (A3).** The BRD lists them as disabled. RRSIF *does* apply to those taxpayers. Disabling them is a valid **product-scope** choice, but it must not be described as a legal exclusion.
4. **Fiscal status vocabulary (A6).** The BRD's four fiscal states are a product abstraction over AEAT's per-record states. The mapping is documented above. ParcialmenteCorrecto (batch-level) is handled per record.
5. **B2B transitional rules (B4–B5).** The BRD mentions "additional time for status reporting by certain individuals". Official text: DT 3 defers status reporting to **6 Oct 2029** for individuals and entidades en atribución de rentas ≤ €8 M. DT 2 is an extra *obligation* (PDF alongside) for > €8 M issuers, not a relief.
6. **Retention (D11).** The BRD requires an adviser-approved schedule. Research supports a 6-year commercial minimum, with LGT extensions. The 4-year time-record period must not be reused.

## G. Unresolved items requiring professional review

| ID | Item | Owner (BRD D-01) |
|---|---|---|
| U1 | The instrument, date and scope of the announced VERI\*FACTU postponement to Oct 2028 | Compliance lead |
| U2 | Outcome of RDL 15/2025 being processed as a bill (BOCG 15-A-82-1) | Compliance lead |
| U3 | B2B first day of application (6 vs 7 Oct) and the turnover year for the €8 M test | Tax adviser |
| U4 | SPFE technical specifications (UBL profile, web services) and SIF/SPFE convergence | Integration owner |
| U5 | Official entity-NIF and K/L/M control algorithms; AEAT census check integration | Integration owner |
| U6 | Exemption (art. 20) and reverse-charge (art. 84) classification per customer service | Tax adviser |
| U7 | Whether art. 6.1.d requires the recipient NIF for B2C invoices in each case | Tax adviser |
| U8 | Final retention schedule for financial records (6 years vs LGT extensions) | Tax adviser + privacy lead |
| U9 | Directive 2006/112/EC art. 226 text (EUR-Lex not re-read) | Compliance lead |
| U10 | When fiscal-record annulment (vs rectification) is appropriate | Tax adviser |
