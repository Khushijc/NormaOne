// Deterministic generator for the demo JSON seed in src/data/seed/.
// Run: node scripts/generate-seed.mjs
// All people, companies and identifiers are fictitious. NIFs are generated to pass
// structural checks only and are not intended to match real taxpayers.
// Totals are NOT stored here: the app computes them from the lines on first load.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'seed');
mkdirSync(OUT, { recursive: true });

// ── deterministic PRNG ───────────────────────────────────────────────
let s = 20261009;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ── identifiers ──────────────────────────────────────────────────────
const DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const dni = (n8) => n8 + DNI[Number(n8) % 23];
function entityNif(letter, d7) {
  let sum = 0;
  d7.split('').map(Number).forEach((d, i) => {
    if (i % 2 === 1) sum += d;
    else { const x = d * 2; sum += Math.floor(x / 10) + (x % 10); }
  });
  const c = (10 - (sum % 10)) % 10;
  return letter + d7 + ('NPQRSW'.includes(letter) ? 'JABCDEFGHI'[c] : String(c));
}

// ── dates ────────────────────────────────────────────────────────────
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const ts = (d, hh = 9, mm = 0) => `${d}T${String(hh - 2).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`; // CEST → UTC
const TODAY = '2026-10-09';

const addr = (street, postalCode, city, province, country = 'ES') => ({ street, postalCode, city, province, country });

// ── companies ────────────────────────────────────────────────────────
const C1 = 'cmp_levante', C2 = 'cmp_ibaigane', C3 = 'cmp_ruiz';
const companies = [
  {
    id: C1, legalName: 'Mantenimientos Levante, S.L.', tradeName: 'Mantenimientos Levante', nif: entityNif('B', '9748215'),
    legalForm: 'SL', registeredAddress: addr('Carrer de Sant Vicent Màrtir, 214, bajo', '46007', 'València', 'Valencia'),
    worksites: ['Nave Polígono Fuente del Jarro (Paterna)', 'Oficina Ruzafa (València)'],
    activity: 'Mantenimiento integral de edificios e instalaciones', cnae: '4329', employeeCount: 18,
    taxAdministration: 'AEAT — Delegación Especial de Valencia', timezone: 'Europe/Madrid',
    profileReviewedBy: 'Laura Martín Soler (propietaria) y Asesoría Turia', profileReviewedAt: '2026-09-02',
    modules: { finance: true, time: false, prl: false, privacy: false, notices: false }, createdAt: ts('2026-03-02', 10),
  },
  {
    id: C2, legalName: 'Instalaciones Ibaigane, S.L.', tradeName: 'Ibaigane Instalaciones', nif: entityNif('B', '9532607'),
    legalForm: 'SL', registeredAddress: addr('Ibaigane Kalea, 12, 2.º', '48930', 'Getxo', 'Bizkaia'),
    worksites: ['Taller Erandio'], activity: 'Instalaciones eléctricas y de climatización', cnae: '4321', employeeCount: 9,
    taxAdministration: 'Hacienda Foral de Bizkaia', timezone: 'Europe/Madrid',
    profileReviewedBy: null, profileReviewedAt: null,
    modules: { finance: true, time: false, prl: false, privacy: false, notices: false }, createdAt: ts('2026-09-20', 11),
  },
  {
    id: C3, legalName: 'Carmen Ruiz Vidal', tradeName: 'Carmen Ruiz · Arquitectura Técnica', nif: dni('43187264'),
    legalForm: 'autonomo', registeredAddress: addr('Carrer de Blanquerna, 38, 3.º 1.ª', '07003', 'Palma', 'Illes Balears'),
    worksites: ['Despacho Palma'], activity: 'Servicios técnicos de arquitectura (aparejadora)', cnae: '7112', employeeCount: 1,
    taxAdministration: 'AEAT — Delegación de Illes Balears', timezone: 'Europe/Madrid',
    profileReviewedBy: 'Asesoría Turia', profileReviewedAt: '2026-07-14',
    modules: { finance: true, time: false, prl: false, privacy: false, notices: false }, createdAt: ts('2026-07-01', 9),
  },
];

const decision = (state, deadline, ruleIds, basis, reviewer, reviewedAt, nextReview) => ({ state, deadline, ruleIds, basis, decidedBy: null, reviewer, reviewedAt, nextReview });

const financeConfigs = [
  {
    companyId: C1, taxpayerType: 'IS', territory: 'common_mainland', siiParticipant: false, vatRegime: 'general', priorYearTurnoverBand: 'up_to_8m',
    sifMode: 'verifactu',
    sif: decision('applicable', '2027-01-01', ['rule_sif_is_v3'], 'Sociedad limitada con domicilio fiscal en territorio común, no acogida al SII: obligada por el art. 3.1.a RRSIF.', 'Carlos Gil Ferrando (Asesoría Turia)', '2026-09-02', '2026-11-15'),
    b2b: decision('applicable', '2028-10-06', ['rule_b2b_rest_v1'], 'Volumen de operaciones 2025 ≈ 1,4 M€ (≤ 8 M€). Clientes mayoritariamente empresas establecidas en España.', 'Carlos Gil Ferrando (Asesoría Turia)', '2026-10-07', '2026-12-01'),
    b2bConnectorValidated: false,
    irpfWithholding: { applies: false, ratePct: 0, basis: 'Sociedad: no es contribuyente del IRPF; no practica retención en sus facturas.' },
    defaultPaymentTermsDays: 30, requireDifferentApprover: true,
    approvedTaxCodes: ['IVA21', 'IVA10'],
    configApprovedBy: 'Carlos Gil Ferrando (Asesoría Turia)', configApprovedAt: '2026-09-02', responsibleAdviser: 'Carlos Gil Ferrando (Asesoría Turia)',
  },
  {
    companyId: C2, taxpayerType: 'IS', territory: 'foral_bizkaia', siiParticipant: false, vatRegime: 'general', priorYearTurnoverBand: 'up_to_8m',
    sifMode: 'undecided',
    sif: decision('pending_review', null, [], 'Domicilio fiscal en Bizkaia: el RRSIF común no aplica; rige Batuz/TicketBAI (normativa foral). Configuración no soportada.', null, null, '2026-10-30'),
    b2b: decision('pending_review', null, [], 'Pendiente de análisis por el asesor.', null, null, '2026-10-30'),
    b2bConnectorValidated: false,
    irpfWithholding: { applies: false, ratePct: 0, basis: 'Sociedad.' },
    defaultPaymentTermsDays: 30, requireDifferentApprover: true, approvedTaxCodes: [],
    configApprovedBy: null, configApprovedAt: null, responsibleAdviser: 'Asesor fiscal foral (sin asignar)',
  },
  {
    companyId: C3, taxpayerType: 'IRPF', territory: 'common_balearic', siiParticipant: false, vatRegime: 'general', priorYearTurnoverBand: 'up_to_8m',
    sifMode: 'verifactu',
    sif: decision('applicable', '2027-07-01', ['rule_sif_other_v3'], 'Persona física con actividad profesional en territorio común (art. 3.1.b RRSIF).', 'Carlos Gil Ferrando (Asesoría Turia)', '2026-07-14', '2026-11-15'),
    b2b: decision('applicable', '2028-10-06', ['rule_b2b_rest_v1'], 'Profesional ≤ 8 M€. Comunicación del estado de facturas diferida al 06/10/2029 (DT 3 RD 238/2026).', 'Carlos Gil Ferrando (Asesoría Turia)', '2026-10-07', '2026-12-01'),
    b2bConnectorValidated: false,
    irpfWithholding: { applies: true, ratePct: 15, basis: 'Profesional persona física (LIRPF art. 101.5.a): retención del 15 % cuando el cliente es empresario o profesional.' },
    defaultPaymentTermsDays: 30, requireDifferentApprover: false, approvedTaxCodes: ['IVA21'],
    configApprovedBy: 'Carlos Gil Ferrando (Asesoría Turia)', configApprovedAt: '2026-07-14', responsibleAdviser: 'Carlos Gil Ferrando (Asesoría Turia)',
  },
];

const declaration = {
  softwareName: 'FacturaFlow Conector Fiscal (DEMO)', softwareId: 'FF-DEMO-01', version: '0.9.3-sandbox',
  producerName: 'Proveedor Fiscal Ejemplo, S.A. (ficticio)', producerNif: entityNif('A', '0000017'), declarationDate: '2026-06-30', demo: true,
};
const scenarios = ['Factura completa F1 en territorio común', 'Rectificativa R1–R4 por diferencias o sustitución', 'IVA 21 / 10 / 4 %', 'Retención IRPF profesional'];
const providerConfigs = [
  { companyId: C1, providerName: 'Proveedor fiscal simulado (sandbox)', environment: 'sandbox_mock', status: 'approved', authorisationRef: 'MAND-LEV-2026-004', authorisationExpires: '2027-09-30', componentVersion: '0.9.3-sandbox', producerDeclaration: declaration, supportedScenarios: scenarios, lastHealthCheckAt: ts(TODAY, 8, 5), nextScenario: 'accept' },
  { companyId: C2, providerName: 'Sin proveedor', environment: 'sandbox_mock', status: 'not_configured', authorisationRef: '', authorisationExpires: null, componentVersion: '—', producerDeclaration: null, supportedScenarios: [], lastHealthCheckAt: null, nextScenario: 'accept' },
  { companyId: C3, providerName: 'Proveedor fiscal simulado (sandbox)', environment: 'sandbox_mock', status: 'approved', authorisationRef: 'MAND-CRV-2026-001', authorisationExpires: '2026-10-31', componentVersion: '0.9.3-sandbox', producerDeclaration: declaration, supportedScenarios: scenarios, lastHealthCheckAt: ts(TODAY, 8, 6), nextScenario: 'accept' },
];

const series = [
  { id: 'ser_lev_f25', companyId: C1, code: 'F2025', prefix: 'F2025-', kind: 'ordinary', nextNumber: 214, padding: 4, active: false, description: 'Serie ordinaria 2025 (cerrada; facturas en el sistema anterior)' },
  { id: 'ser_lev_f26', companyId: C1, code: 'F2026', prefix: 'F2026-', kind: 'ordinary', nextNumber: 1, padding: 4, active: true, description: 'Serie ordinaria 2026' },
  { id: 'ser_lev_r26', companyId: C1, code: 'R2026', prefix: 'R2026-', kind: 'rectifying', nextNumber: 1, padding: 3, active: true, description: 'Serie de facturas rectificativas 2026' },
  { id: 'ser_ibg_f26', companyId: C2, code: 'A26', prefix: 'A26/', kind: 'ordinary', nextNumber: 1, padding: 4, active: true, description: 'Serie ordinaria (no aprobada)' },
  { id: 'ser_crv_f26', companyId: C3, code: 'CR26', prefix: 'CR26-', kind: 'ordinary', nextNumber: 1, padding: 3, active: true, description: 'Honorarios 2026' },
  { id: 'ser_crv_r26', companyId: C3, code: 'CRR26', prefix: 'CRR26-', kind: 'rectifying', nextNumber: 1, padding: 3, active: true, description: 'Rectificativas 2026' },
];

const collectionPolicies = [
  { companyId: C1, reminderOffsetsDays: [3, 15, 30], channel: 'email', suppressWhenDisputed: true, showLatePaymentNotice: true },
  { companyId: C2, reminderOffsetsDays: [7, 30], channel: 'email', suppressWhenDisputed: true, showLatePaymentNotice: true },
  { companyId: C3, reminderOffsetsDays: [7, 21], channel: 'email', suppressWhenDisputed: true, showLatePaymentNotice: false },
];

// ── users & memberships ──────────────────────────────────────────────
const users = [
  { id: 'usr_laura', name: 'Laura Martín Soler', email: 'laura.martin@mantenimientoslevante.example', title: 'Gerente y socia', organisation: null },
  { id: 'usr_javier', name: 'Javier Ortega Pons', email: 'javier.ortega@mantenimientoslevante.example', title: 'Administración', organisation: null },
  { id: 'usr_marta', name: 'Marta Soler Vidal', email: 'marta.soler@mantenimientoslevante.example', title: 'Responsable financiera', organisation: null },
  { id: 'usr_elena', name: 'Elena Navarro Gil', email: 'elena.navarro@mantenimientoslevante.example', title: 'Jefa de equipo técnico', organisation: null },
  { id: 'usr_pablo', name: 'Pablo Ruiz Esteve', email: 'pablo.ruiz@mantenimientoslevante.example', title: 'Técnico de mantenimiento', organisation: null },
  { id: 'usr_sergio', name: 'Sergio Llopis Mora', email: 'sergio.llopis@mantenimientoslevante.example', title: 'Técnico de instalaciones', organisation: null },
  { id: 'usr_carlos', name: 'Carlos Gil Ferrando', email: 'carlos.gil@asesoriaturia.example', title: 'Asesor fiscal y contable', organisation: 'Asesoría Turia, S.L.P.' },
  { id: 'usr_nuria', name: 'Nuria Campos Sáez', email: 'nuria@gestoriaanterior.example', title: 'Gestora (mandato finalizado)', organisation: 'Gestoría Campos' },
  { id: 'usr_carmen', name: 'Carmen Ruiz Vidal', email: 'carmen@carmenruiz-at.example', title: 'Arquitecta técnica (titular)', organisation: null },
  { id: 'usr_iker', name: 'Iker Etxeberria Uriarte', email: 'iker@ibaigane.example', title: 'Gerente', organisation: null },
];
const mem = (id, userId, companyId, roles, extra = {}) => ({
  id, userId, companyId, roles, status: 'active', grantedBy: 'usr_laura', grantedAt: ts('2026-03-02', 10), validUntil: null, revokedAt: null, revokedBy: null,
  approvalLimitCents: null, teamUserIds: [], mandateRef: null, ...extra,
});
const memberships = [
  mem('mbr_laura_lev', 'usr_laura', C1, ['owner'], { grantedBy: null }),
  mem('mbr_javier_lev', 'usr_javier', C1, ['admin']),
  mem('mbr_marta_lev', 'usr_marta', C1, ['issuer']),
  mem('mbr_elena_lev', 'usr_elena', C1, ['supervisor', 'employee'], { approvalLimitCents: 30000, teamUserIds: ['usr_pablo', 'usr_sergio'] }),
  mem('mbr_pablo_lev', 'usr_pablo', C1, ['employee']),
  mem('mbr_sergio_lev', 'usr_sergio', C1, ['employee']),
  mem('mbr_carlos_lev', 'usr_carlos', C1, ['gestoria'], { grantedAt: ts('2026-04-01', 9), validUntil: '2027-03-31', mandateRef: 'Mandato de representación y servicios contables MR-2026-117' }),
  mem('mbr_nuria_lev', 'usr_nuria', C1, ['gestoria'], { grantedAt: ts('2026-03-02', 10), status: 'revoked', revokedAt: ts('2026-03-31', 18), revokedBy: 'usr_laura', mandateRef: 'Mandato 2025 (finalizado)' }),
  mem('mbr_carmen_crv', 'usr_carmen', C3, ['owner', 'issuer', 'admin'], { grantedBy: null, grantedAt: ts('2026-07-01', 9) }),
  mem('mbr_carlos_crv', 'usr_carlos', C3, ['gestoria'], { grantedBy: 'usr_carmen', grantedAt: ts('2026-07-01', 9), validUntil: '2027-06-30', mandateRef: 'Hoja de encargo HE-2026-031' }),
  mem('mbr_iker_ibg', 'usr_iker', C2, ['owner', 'issuer', 'admin'], { grantedBy: null, grantedAt: ts('2026-09-20', 11) }),
];

// ── parties ──────────────────────────────────────────────────────────
function party(companyId, id, kind, legalName, idType, idNumber, address, email, extra = {}) {
  return {
    id, companyId, kind, legalName, tradeName: extra.tradeName ?? '', idType, idNumber, address, email, phone: extra.phone ?? `+34 96${Math.floor(1000000 + rnd() * 8999999)}`,
    contactName: extra.contactName ?? '', notes: extra.notes ?? '', archived: extra.archived ?? false, archivedAt: extra.archivedAt ?? null, archivedReason: extra.archivedReason ?? null,
    createdBy: extra.createdBy ?? 'usr_javier', createdAt: extra.createdAt ?? ts('2026-03-10', 10), updatedAt: extra.updatedAt ?? ts('2026-03-10', 10),
  };
}
const cust = (companyId, id, kind, name, idType, idNumber, address, email, extra = {}) => ({
  ...party(companyId, id, kind, name, idType, idNumber, address, email, extra),
  paymentTermsDays: extra.terms ?? 30, deliveryChannel: extra.channel ?? 'email', defaultTaxCode: extra.tax ?? 'IVA21',
});
const supp = (companyId, id, kind, name, idType, idNumber, address, email, extra = {}) => ({
  ...party(companyId, id, kind, name, idType, idNumber, address, email, extra),
  defaultCategory: extra.category ?? 'materiales', ibanMasked: extra.iban ?? `ES${10 + Math.floor(rnd() * 89)} •••• •••• •••• ${1000 + Math.floor(rnd() * 8999)}`, paymentTermsDays: extra.terms ?? 30,
});

const customers = [
  cust(C1, 'cus_torre', 'company', 'Comunidad de Propietarios Torre Turia', 'NIF', entityNif('H', '4612873'), addr('Av. de Pius XII, 46', '46015', 'València', 'Valencia'), 'administracion@fincasturia.example', { contactName: 'Administración de fincas Turia', tradeName: 'CP Torre Turia' }),
  cust(C1, 'cus_marblau', 'company', 'Hotel Mar Blau, S.L.', 'NIF', entityNif('B', '9831542'), addr('Passeig de Neptú, 18', '46011', 'València', 'Valencia'), 'compras@hotelmarblau.example', { contactName: 'Rosa Ibáñez (compras)', terms: 45 }),
  cust(C1, 'cus_dental', 'company', 'Clínica Dental Benimaclet, S.L.P.', 'NIF', entityNif('B', '9877316'), addr('Carrer de Murta, 9', '46020', 'València', 'Valencia'), 'gerencia@dentalbenimaclet.example', { contactName: 'Dr. Andrés Sanz' }),
  cust(C1, 'cus_colegio', 'company', 'Colegio Santa Ana, Coop. V.', 'NIF', entityNif('F', '4631175'), addr('Carrer de la Reina, 101', '46011', 'València', 'Valencia'), 'secretaria@colegiosantaana.example', { contactName: 'Secretaría', terms: 60 }),
  cust(C1, 'cus_horta', 'company', 'Supermercados Horta, S.A.', 'NIF', entityNif('A', '9624519'), addr('Ctra. de Barcelona, km 3', '46120', 'Alboraia', 'Valencia'), 'mantenimiento@superhorta.example', { contactName: 'Departamento de mantenimiento', terms: 60 }),
  cust(C1, 'cus_ruzafa', 'company', 'Gestión Inmobiliaria Ruzafa, S.L.', 'NIF', entityNif('B', '9790233'), addr('Carrer de Cuba, 22', '46006', 'València', 'Valencia'), 'facturas@inmoruzafa.example', { contactName: 'María José Peris' }),
  cust(C1, 'cus_cowork', 'company', 'Coworking Cabanyal, S.L.', 'NIF', entityNif('B', '9855094'), addr('Carrer de la Reina, 205', '46011', 'València', 'Valencia'), 'hola@coworkcabanyal.example', { contactName: 'Iván Ferrer', terms: 15 }),
  cust(C1, 'cus_ferrer', 'self_employed', 'Vicent Ferrer Climent', 'NIF', dni('20817364'), addr('Carrer Major, 14', '46470', 'Catarroja', 'Valencia'), 'vferrer.taller@example.com', { contactName: 'Vicent Ferrer', tradeName: 'Taller Ferrer' }),
  cust(C1, 'cus_perez', 'individual', 'Laura Pérez Gil', 'NIF', dni('48291736'), addr('Carrer de Sueca, 61, 4.ª', '46006', 'València', 'Valencia'), 'laura.perez.gil@example.com', { terms: 0 }),
  cust(C1, 'cus_patraix', 'company', 'Asociación Vecinal Patraix', 'NIF', entityNif('G', '4627719'), addr('Carrer del Patraix, 30', '46018', 'València', 'Valencia'), 'avvpatraix@example.org', { contactName: 'Junta directiva' }),
  cust(C1, 'cus_alboraia', 'public_admin', 'Ajuntament d’Alboraia', 'NIF', entityNif('P', '4600400'), addr('Carrer del Mestre Serrano, 1', '46120', 'Alboraia', 'Valencia'), 'contratacio@alboraia.example', { notes: 'Facturación a AA. PP. vía FACe: fuera del alcance de esta versión.' }),
  cust(C1, 'cus_albufera', 'company', 'Restaurante La Albufera, S.L.', 'NIF', entityNif('B', '9712408'), addr('Carretera del Palmar, 3', '46012', 'El Palmar', 'Valencia'), 'admin@restalbufera.example', { archived: true, archivedAt: ts('2026-06-30', 12), archivedReason: 'Cese de actividad del cliente. Se conservan las facturas emitidas.' }),
  // Ibaigane
  cust(C2, 'cus_ibg_bilbao', 'company', 'Oficinas Abando, S.A.', 'NIF', entityNif('A', '4801932'), addr('Gran Vía, 45', '48011', 'Bilbao', 'Bizkaia'), 'admin@oficinasabando.example', { createdBy: 'usr_iker', createdAt: ts('2026-09-21', 10) }),
  cust(C2, 'cus_ibg_getxo', 'company', 'Residencial Neguri, S.L.', 'NIF', entityNif('B', '4887261'), addr('Avenida Algorta, 77', '48990', 'Getxo', 'Bizkaia'), 'comunidad@neguri.example', { createdBy: 'usr_iker', createdAt: ts('2026-09-21', 10) }),
  // Carmen Ruiz
  cust(C3, 'cus_crv_promo', 'company', 'Promociones Ses Fontanelles, S.L.', 'NIF', entityNif('B', '0784123'), addr('Carrer de Joan Miró, 120', '07015', 'Palma', 'Illes Balears'), 'obras@sesfontanelles.example', { createdBy: 'usr_carmen', createdAt: ts('2026-07-01', 10) }),
  cust(C3, 'cus_crv_cp', 'company', 'Comunidad de Propietarios Edificio Born', 'NIF', entityNif('H', '0759321'), addr('Passeig des Born, 7', '07012', 'Palma', 'Illes Balears'), 'cpborn@fincasbalears.example', { createdBy: 'usr_carmen', createdAt: ts('2026-07-01', 10) }),
  cust(C3, 'cus_crv_arq', 'company', 'Estudio Arquitectura Llevant, S.L.P.', 'NIF', entityNif('B', '0731874'), addr('Carrer de Sant Miquel, 50', '07002', 'Palma', 'Illes Balears'), 'admin@arqllevant.example', { createdBy: 'usr_carmen', createdAt: ts('2026-07-01', 10) }),
  cust(C3, 'cus_crv_part', 'individual', 'Tomeu Vidal Serra', 'NIF', dni('43098125'), addr('Carrer de la Fàbrica, 12', '07013', 'Palma', 'Illes Balears'), 'tomeu.vidal@example.com', { createdBy: 'usr_carmen', createdAt: ts('2026-08-03', 10), terms: 0 }),
];

const suppliers = [
  supp(C1, 'sup_ferreteria', 'company', 'Ferretería Industrial del Túria, S.L.', 'NIF', entityNif('B', '9611482'), addr('Polígono Fuente del Jarro, C/ Ciudad de Sevilla 12', '46988', 'Paterna', 'Valencia'), 'facturacion@ferreteriaturia.example', { category: 'materiales' }),
  supp(C1, 'sup_electrica', 'company', 'Suministros Eléctricos Llevant, S.A.', 'NIF', entityNif('A', '9605517'), addr('Av. del Port, 300', '46024', 'València', 'Valencia'), 'clientes@sellevant.example', { category: 'materiales', terms: 60 }),
  supp(C1, 'sup_telecom', 'company', 'Levante Telecom, S.L.', 'NIF', entityNif('B', '9876640'), addr('Carrer de Colón, 60', '46004', 'València', 'Valencia'), 'facturas@levantetelecom.example', { category: 'telefonia' }),
  supp(C1, 'sup_furgos', 'company', 'Alquiler de Furgonetas Túria, S.L.', 'NIF', entityNif('B', '9640258'), addr('Carrer de Sant Vicent, 150', '46007', 'València', 'Valencia'), 'renting@furgosturia.example', { category: 'vehiculos' }),
  supp(C1, 'sup_seguros', 'company', 'Seguros Mediterráneo, S.A.', 'NIF', entityNif('A', '9622345'), addr('Plaça de l’Ajuntament, 3', '46002', 'València', 'Valencia'), 'empresas@segurosmed.example', { category: 'seguros' }),
  supp(C1, 'sup_turia', 'company', 'Asesoría Turia, S.L.P.', 'NIF', entityNif('B', '9688120'), addr('Carrer de Xàtiva, 15', '46002', 'València', 'Valencia'), 'facturas@asesoriaturia.example', { category: 'servicios_profesionales' }),
  supp(C1, 'sup_abogado', 'self_employed', 'José Martí Llorca', 'NIF', dni('22571936'), addr('Carrer de Colón, 12, 5.º', '46004', 'València', 'Valencia'), 'jmarti.abogado@example.com', { category: 'servicios_profesionales', tradeName: 'Martí Abogados' }),
  supp(C1, 'sup_gasolinera', 'company', 'Estación de Servicio Pista de Silla, S.L.', 'NIF', entityNif('B', '9665471'), addr('Pista de Silla, km 4', '46460', 'Silla', 'Valencia'), 'tickets@espsilla.example', { category: 'combustible' }),
  supp(C3, 'sup_crv_colegio', 'company', 'Colegio Oficial de Aparejadores de Mallorca', 'NIF', entityNif('Q', '0763002'), addr('Carrer de Sant Miquel, 30', '07002', 'Palma', 'Illes Balears'), 'visados@coaatmallorca.example', { category: 'servicios_profesionales', createdBy: 'usr_carmen' }),
  supp(C3, 'sup_crv_software', 'company', 'Programas Técnicos Baleares, S.L.', 'NIF', entityNif('B', '0712290'), addr('Carrer de Aragó, 200', '07008', 'Palma', 'Illes Balears'), 'ventas@ptb.example', { category: 'software', createdBy: 'usr_carmen' }),
];

// ── invoices ─────────────────────────────────────────────────────────
const remoteRecords = {};
const invoices = [], payments = [], disputes = [], fiscalOperations = [], deliveries = [], reminders = [];
const counters = { ser_lev_f26: 1, ser_lev_r26: 1, ser_crv_f26: 1, ser_crv_r26: 1 };
const seriesById = Object.fromEntries(series.map((x) => [x.id, x]));
let lineSeq = 1, opSeq = 1, paySeq = 1, delSeq = 1, remSeq = 1;
const custById = Object.fromEntries(customers.map((c) => [c.id, c]));

function snapshotOf(p) { return { legalName: p.legalName, idType: p.idType, idNumber: p.idNumber, address: p.address }; }
function issuerSnap(companyId) { const c = companies.find((x) => x.id === companyId); return { legalName: c.legalName, idType: 'NIF', idNumber: c.nif, address: c.registeredAddress }; }
const euros = (e) => Math.round(e * 100);
// Mirror of the app's totals (only to size seed payments). The app recomputes authoritative totals.
function payable(lines, whPct, rates) {
  let base = 0; const groups = {};
  for (const l of lines) { const g = Math.round(l.quantity * l.unitPriceCents); const b = g - Math.round((g * l.discountPct) / 100); base += b; groups[l.taxCode] = (groups[l.taxCode] || 0) + b; }
  let tax = 0; for (const [code, b] of Object.entries(groups)) tax += Math.round((b * (rates[code] ?? 0)) / 100);
  return base + tax - (whPct ? Math.round((base * whPct) / 100) : 0);
}
const RATES = { IVA21: 21, IVA10: 10, IVA4: 4 };

/**
 * Scenario keys: paid | partial | unpaid | overdue | disputed | rejected | uncertain | acc_err |
 * rectified | draft | draft_req | approved | delivery_failed
 */
function invoice(def) {
  const { id, companyId, customerId, seriesId, opDate, issueDate, terms, lines, scenario, wh = 0, notes = '', preparedBy = 'usr_javier', issuer = 'usr_marta' } = def;
  const L = lines.map(([description, quantity, unit, taxCode = 'IVA21', discountPct = 0]) => ({ id: `lin_${String(lineSeq++).padStart(4, '0')}`, description, quantity, unitPriceCents: euros(unit), discountPct, taxCode }));
  const draftLike = ['draft', 'draft_req', 'approved'].includes(scenario);
  const issued = !draftLike;
  let number = null;
  if (issued) { const ser = seriesById[seriesId]; number = ser.prefix + String(counters[seriesId]++).padStart(ser.padding, '0'); }
  const due = addDays(issueDate, terms);
  const createdAt = ts(addDays(issueDate, draftLike ? -1 : -2), 10, 12);
  const inv = {
    id, companyId, kind: 'ordinary', seriesId, number, customerId,
    customerSnapshot: issued ? snapshotOf(custById[customerId]) : null, issuerSnapshot: issued ? issuerSnap(companyId) : null,
    issueDate: issued ? issueDate : null, operationDate: opDate !== issueDate ? opDate : null, dueDate: due,
    lines: L, totals: { withholdingPct: wh }, notes, paymentTerms: terms === 0 ? 'Pago al contado' : `Transferencia bancaria a ${terms} días`,
    documentStatus: issued ? 'issued' : scenario === 'approved' ? 'approved' : 'draft',
    review: scenario === 'draft_req' ? { state: 'requested', by: preparedBy, at: ts(TODAY, 9, 40), comment: 'Revisar descuento pactado con el cliente.' } : { state: 'none', by: null, at: null, comment: '' },
    approvedBy: draftLike && scenario !== 'approved' ? null : issuer, approvedAt: draftLike && scenario !== 'approved' ? null : ts(issued ? issueDate : TODAY, 11, 5),
    issuedBy: issued ? issuer : null, issuedAt: issued ? ts(issueDate, 11, 20) : null,
    fiscalStatus: 'not_submitted', providerInvoiceId: null, fiscalRecordId: null, fiscalHash: null, pendingOperationId: null,
    exchangeStatus: 'not_sent', rectification: null, rectifiedByIds: [], createdBy: preparedBy, createdAt, updatedAt: ts(issued ? issueDate : TODAY, 11, 20), version: issued ? 4 : 1,
  };
  if (issued) {
    const opId = `fop_${String(opSeq++).padStart(4, '0')}`;
    const provId = `PRV-${companyId === C1 ? 'LEV' : 'CRV'}-${issueDate.replace(/-/g, '')}-${String(opSeq).padStart(4, '0')}`;
    const op = {
      id: opId, companyId, invoiceId: id, type: 'issue', operationKey: `inv:${id}:issue`, attempt: 1, requestedBy: issuer, requestedAt: ts(issueDate, 11, 19), completedAt: ts(issueDate, 11, 20),
      state: 'accepted', reservedNumber: number, providerRequestId: `req-${opId}`, providerInvoiceId: provId, fiscalRecordId: `SIM-RF-${opId.slice(4)}`,
      responseCode: 'Correcto', responseMessage: 'Registro de alta aceptado (respuesta SIMULADA; no procede de la AEAT).', errors: [], reconciledBy: null, reconciledAt: null, simulated: true,
    };
    inv.fiscalStatus = 'accepted'; inv.providerInvoiceId = provId; inv.fiscalRecordId = op.fiscalRecordId;
    if (scenario === 'rejected') {
      Object.assign(op, { state: 'rejected', providerInvoiceId: null, fiscalRecordId: null, responseCode: 'Incorrecto', responseMessage: 'Registro rechazado (SIMULADO).', errors: [{ code: '1105', message: 'SIMULADO — El NIF del destinatario no está identificado en el censo.' }] });
      inv.fiscalStatus = 'rejected'; inv.providerInvoiceId = null; inv.fiscalRecordId = null;
    } else if (scenario === 'acc_err') {
      Object.assign(op, { state: 'accepted_with_errors', responseCode: 'AceptadoConErrores', responseMessage: 'Registro aceptado con errores (SIMULADO).', errors: [{ code: '2004', message: 'SIMULADO — La fecha de operación es posterior a la de expedición; revise y subsane.' }] });
      inv.fiscalStatus = 'needs_review';
    } else if (scenario === 'uncertain') {
      Object.assign(op, { state: 'uncertain', completedAt: null, providerInvoiceId: null, fiscalRecordId: null, responseCode: null, responseMessage: 'Tiempo de espera agotado (30 s) sin respuesta del proveedor simulado.' });
      inv.fiscalStatus = 'needs_review'; inv.documentStatus = 'approved'; inv.number = null; inv.issuedAt = null; inv.issuedBy = null; inv.customerSnapshot = null; inv.issuerSnapshot = null; inv.issueDate = null;
      inv.providerInvoiceId = null; inv.fiscalRecordId = null; inv.pendingOperationId = opId;
      remoteRecords[op.operationKey] = { processed: true, providerInvoiceId: provId, fiscalRecordId: `SIM-RF-${opId.slice(4)}`, number, processedAt: ts(issueDate, 11, 20), state: 'accepted' };
    }
    if (op.fiscalRecordId) inv.fiscalHash = `demo-${op.fiscalRecordId.toLowerCase()}`;
    fiscalOperations.push(op);
    if (scenario !== 'uncertain' && scenario !== 'rejected') {
      const cust = custById[customerId];
      const failed = scenario === 'delivery_failed';
      deliveries.push({ id: `del_${String(delSeq++).padStart(4, '0')}`, companyId, invoiceId: id, channel: 'email', recipient: cust.email, status: 'sent', detail: 'Enviada por correo con PDF adjunto (simulado).', at: ts(issueDate, 11, 30), by: preparedBy, simulated: true });
      deliveries.push({ id: `del_${String(delSeq++).padStart(4, '0')}`, companyId, invoiceId: id, channel: 'email', recipient: cust.email, status: failed ? 'failed' : 'delivered', detail: failed ? 'Rebote: buzón inexistente (550 5.1.1) — simulado.' : 'Entrega confirmada por el servidor de correo (simulado).', at: ts(issueDate, 11, 31), by: 'system', simulated: true });
      inv.exchangeStatus = failed ? 'delivery_failed' : 'delivered';
    }
  }
  invoices.push(inv);

  // payments
  const amt = payable(L, wh, RATES);
  const pay = (date, cents, method = 'transfer', ref = '') => payments.push({ id: `pay_${String(paySeq++).padStart(4, '0')}`, companyId, invoiceId: id, kind: 'payment', date, amountCents: cents, method, reference: ref || `TRF ${date.replace(/-/g, '')}-${paySeq}`, note: '', reversesPaymentId: null, recordedBy: companyId === C3 ? 'usr_carmen' : 'usr_javier', recordedAt: ts(date, 16, 10) });
  if (scenario === 'paid' && issued) pay(addDays(issueDate, Math.min(terms, 10 + Math.floor(rnd() * 20))), amt, pick(['transfer', 'transfer', 'direct_debit']));
  if (scenario === 'partial') pay(addDays(issueDate, 12), Math.round(amt * 0.5), 'transfer');
  if (scenario === 'disputed') {
    disputes.push({ id: `dsp_${id}`, companyId, invoiceId: id, status: 'open', reason: 'El cliente discute 6 horas de mano de obra del parte de trabajo del 14/08. Pendiente de revisión con el jefe de equipo.', holdReminders: true, openedBy: 'usr_javier', openedAt: ts(addDays(due, 2), 12), resolvedBy: null, resolvedAt: null, resolution: null });
  }
  // reminders for overdue-ish
  if (issued && ['unpaid', 'overdue', 'partial', 'disputed'].includes(scenario) && due < TODAY) {
    const policy = collectionPolicies.find((p) => p.companyId === companyId);
    for (const off of policy.reminderOffsetsDays) {
      const d = addDays(due, off);
      if (d > TODAY) break;
      if (scenario === 'disputed' && d > addDays(due, 2)) {
        reminders.push({ id: `rem_${String(remSeq++).padStart(4, '0')}`, companyId, invoiceId: id, offsetDays: off, status: 'suppressed', reason: 'Suprimido: disputa abierta con retención de recordatorios.', channel: 'email', at: ts(d, 8, 0), by: 'system', simulated: true });
        continue;
      }
      reminders.push({ id: `rem_${String(remSeq++).padStart(4, '0')}`, companyId, invoiceId: id, offsetDays: off, status: 'delivered', reason: `Recordatorio +${off} días tras vencimiento.`, channel: 'email', at: ts(d, 8, 0), by: 'system', simulated: true });
    }
  }
  return inv;
}

const svc = {
  prev: ['Mantenimiento preventivo mensual de instalaciones (contrato)', 1, 420],
  clima: ['Revisión y limpieza de equipos de climatización', 6, 65],
  fontaneria: ['Reparación de fontanería — sustitución de bajante', 1, 380],
  electrico: ['Revisión de cuadro eléctrico y sustitución de diferenciales', 1, 295],
  horas: ['Mano de obra técnico (horas)', 8, 38],
  material: ['Material eléctrico según albarán', 1, 186.4],
  pintura: ['Pintura de zonas comunes (m²)', 140, 7.5],
  urgencia: ['Salida de urgencia fuera de horario', 1, 90],
  ascensor: ['Coordinación con mantenedor de ascensores', 2, 45],
};

let n = 1;
const inv1 = (customerId, issueDate, scenario, lines, extra = {}) => invoice({ id: `inv_lev_${String(n++).padStart(3, '0')}`, companyId: C1, customerId, seriesId: 'ser_lev_f26', opDate: extra.opDate ?? addDays(issueDate, -3), issueDate, terms: extra.terms ?? custById[customerId].paymentTermsDays, lines, scenario, ...extra });

// April–October 2026, in issue-date order (numbers are assigned sequentially).
inv1('cus_torre', '2026-04-03', 'paid', [svc.prev, svc.ascensor]);
inv1('cus_marblau', '2026-04-10', 'paid', [svc.clima, svc.material]);
inv1('cus_dental', '2026-04-24', 'paid', [svc.electrico, svc.horas]);
inv1('cus_torre', '2026-05-04', 'paid', [svc.prev]);
inv1('cus_horta', '2026-05-12', 'paid', [svc.clima, svc.horas, svc.urgencia]);
inv1('cus_albufera', '2026-05-20', 'paid', [svc.fontaneria]);
const rectOriginal = inv1('cus_ruzafa', '2026-05-28', 'paid', [svc.pintura, ['Mano de obra pintor (horas)', 24, 32]]);
inv1('cus_torre', '2026-06-03', 'paid', [svc.prev, svc.ascensor]);
inv1('cus_colegio', '2026-06-15', 'paid', [['Revisión anual de instalación de protección contra incendios', 1, 640], svc.horas]);
inv1('cus_marblau', '2026-06-22', 'paid', [svc.clima, svc.clima.slice(0, 1).concat([4, 65]), svc.material]);
inv1('cus_torre', '2026-07-02', 'paid', [svc.prev]);
inv1('cus_cowork', '2026-07-08', 'paid', [['Instalación de puntos de red y canaletas', 12, 48], svc.material]);
inv1('cus_perez', '2026-07-15', 'paid', [['Reparación de fuga en cocina (vivienda particular)', 1, 140], ['Desplazamiento', 1, 25]], { terms: 0, opDate: '2026-07-15' });
inv1('cus_horta', '2026-07-23', 'partial', [svc.clima, svc.horas, svc.material, ['Sustitución de compresor cámara frigorífica', 1, 1240]]);
inv1('cus_torre', '2026-08-03', 'paid', [svc.prev, svc.urgencia]);
inv1('cus_dental', '2026-08-18', 'disputed', [svc.horas, ['Mano de obra adicional (horas)', 6, 38], svc.electrico]);
inv1('cus_ferrer', '2026-08-26', 'overdue', [['Instalación eléctrica de taller — fase 1', 1, 980], svc.material]);
inv1('cus_torre', '2026-09-02', 'paid', [svc.prev, svc.ascensor]);
inv1('cus_patraix', '2026-09-07', 'overdue', [['Mantenimiento de local social (trimestral)', 1, 360]], { terms: 15 });
inv1('cus_colegio', '2026-09-10', 'unpaid', [svc.pintura, svc.horas], { terms: 60 });
inv1('cus_marblau', '2026-09-16', 'acc_err', [svc.clima, svc.urgencia], { opDate: '2026-09-17' });
inv1('cus_cowork', '2026-09-22', 'delivery_failed', [['Revisión de SAI y cableado', 1, 210]]);
inv1('cus_ruzafa', '2026-09-29', 'unpaid', [['Reparación de persianas motorizadas', 3, 85], svc.horas]);
inv1('cus_torre', '2026-10-01', 'unpaid', [svc.prev]);
inv1('cus_horta', '2026-10-05', 'rejected', [svc.electrico, svc.urgencia]);
const uncertainInv = inv1('cus_marblau', '2026-10-08', 'uncertain', [['Sustitución de termo eléctrico 80 L', 1, 410], svc.horas]);
inv1('cus_dental', '2026-10-09', 'approved', [svc.clima.slice(0, 1).concat([3, 65])], { opDate: '2026-10-06' });
inv1('cus_torre', '2026-10-09', 'draft_req', [['Mantenimiento preventivo mensual de instalaciones (contrato)', 1, 420, 'IVA21', 5]], { opDate: '2026-10-08' });
inv1('cus_patraix', '2026-10-09', 'draft', [['Presupuesto: impermeabilización de cubierta', 1, 1850], ['Descripción pendiente', 1, 0]], { opDate: '2026-10-09' });

// Rectification of inv rectOriginal: by differences, R1 (price error).
{
  const ser = seriesById.ser_lev_r26;
  const id = 'inv_lev_r01';
  const number = ser.prefix + String(counters.ser_lev_r26++).padStart(ser.padding, '0');
  const lines = [{ id: `lin_${String(lineSeq++).padStart(4, '0')}`, description: 'Rectificación por diferencias: m² de pintura facturados de más (140 → 120)', quantity: -20, unitPriceCents: 750, discountPct: 0, taxCode: 'IVA21' }];
  invoices.push({
    id, companyId: C1, kind: 'rectifying', seriesId: 'ser_lev_r26', number, customerId: 'cus_ruzafa', customerSnapshot: snapshotOf(custById.cus_ruzafa), issuerSnapshot: issuerSnap(C1),
    issueDate: '2026-06-09', operationDate: null, dueDate: '2026-06-09', lines, totals: { withholdingPct: 0 }, notes: 'Abono aplicado en el cobro de la factura original.', paymentTerms: 'Compensación con factura original',
    documentStatus: 'issued', review: { state: 'none', by: null, at: null, comment: '' }, approvedBy: 'usr_marta', approvedAt: ts('2026-06-09', 10, 0), issuedBy: 'usr_marta', issuedAt: ts('2026-06-09', 10, 15),
    fiscalStatus: 'accepted', providerInvoiceId: 'PRV-LEV-20260609-R001', fiscalRecordId: 'SIM-RF-R001', fiscalHash: 'demo-sim-rf-r001', pendingOperationId: null, exchangeStatus: 'delivered',
    rectification: { originalInvoiceId: rectOriginal.id, reasonCode: 'R1', method: 'differences', reasonText: 'Error en la medición: se facturaron 140 m² y la superficie real ejecutada fue de 120 m² (acta de medición del 05/06/2026).', requestedBy: 'usr_javier', requestedAt: ts('2026-06-08', 17, 0) },
    rectifiedByIds: [], createdBy: 'usr_javier', createdAt: ts('2026-06-08', 17, 0), updatedAt: ts('2026-06-09', 10, 15), version: 4,
  });
  rectOriginal.documentStatus = 'rectified';
  rectOriginal.rectifiedByIds = [id];
  fiscalOperations.push({ id: `fop_${String(opSeq++).padStart(4, '0')}`, companyId: C1, invoiceId: id, type: 'issue', operationKey: `inv:${id}:issue`, attempt: 1, requestedBy: 'usr_marta', requestedAt: ts('2026-06-09', 10, 14), completedAt: ts('2026-06-09', 10, 15), state: 'accepted', reservedNumber: number, providerRequestId: 'req-r001', providerInvoiceId: 'PRV-LEV-20260609-R001', fiscalRecordId: 'SIM-RF-R001', responseCode: 'Correcto', responseMessage: 'Registro de alta (rectificativa R1, por diferencias) aceptado — SIMULADO.', errors: [], reconciledBy: null, reconciledAt: null, simulated: true });
  deliveries.push({ id: `del_${String(delSeq++).padStart(4, '0')}`, companyId: C1, invoiceId: id, channel: 'email', recipient: custById.cus_ruzafa.email, status: 'delivered', detail: 'Entregada (simulado).', at: ts('2026-06-09', 10, 30), by: 'usr_javier', simulated: true });
  // The original was paid net of the rectification: adjust its payment to (original − 150 € − 21 % IVA).
  const p = payments.find((x) => x.invoiceId === rectOriginal.id);
  p.amountCents -= 15000 + 3150;
  p.note = 'Importe neto tras rectificativa R2026-001.';
}

// Carmen Ruiz — professional invoices with 15 % IRPF withholding.
let m = 1;
const inv3 = (customerId, issueDate, scenario, lines, extra = {}) => invoice({ id: `inv_crv_${String(m++).padStart(3, '0')}`, companyId: C3, customerId, seriesId: 'ser_crv_f26', opDate: extra.opDate ?? addDays(issueDate, -2), issueDate, terms: extra.terms ?? custById[customerId].paymentTermsDays, lines, scenario, wh: extra.wh ?? 15, preparedBy: 'usr_carmen', issuer: 'usr_carmen', ...extra });
inv3('cus_crv_promo', '2026-07-10', 'paid', [['Dirección de ejecución de obra — julio (Ses Fontanelles, 12 viviendas)', 1, 1800]]);
inv3('cus_crv_cp', '2026-07-24', 'paid', [['Informe de evaluación del edificio (IEE)', 1, 950]]);
inv3('cus_crv_promo', '2026-08-10', 'paid', [['Dirección de ejecución de obra — agosto', 1, 1800]]);
inv3('cus_crv_arq', '2026-08-28', 'partial', [['Mediciones y presupuesto de proyecto básico', 1, 1200], ['Visitas de obra adicionales', 3, 90]]);
inv3('cus_crv_promo', '2026-09-10', 'unpaid', [['Dirección de ejecución de obra — septiembre', 1, 1800]]);
inv3('cus_crv_part', '2026-09-18', 'paid', [['Certificado de eficiencia energética de vivienda', 1, 180]], { wh: 0, terms: 0, opDate: '2026-09-18' });
inv3('cus_crv_promo', '2026-10-07', 'draft', [['Dirección de ejecución de obra — octubre', 1, 1800]]);

// Ibaigane — drafts only (issue blocked by gates).
invoice({ id: 'inv_ibg_001', companyId: C2, customerId: 'cus_ibg_bilbao', seriesId: 'ser_ibg_f26', opDate: '2026-10-02', issueDate: '2026-10-09', terms: 30, lines: [['Mantenimiento de climatización — oficinas Gran Vía', 1, 760]], scenario: 'approved', preparedBy: 'usr_iker', issuer: 'usr_iker' });
invoice({ id: 'inv_ibg_002', companyId: C2, customerId: 'cus_ibg_getxo', seriesId: 'ser_ibg_f26', opDate: '2026-10-06', issueDate: '2026-10-09', terms: 30, lines: [['Instalación de punto de recarga en garaje comunitario', 1, 1450]], scenario: 'draft', preparedBy: 'usr_iker', issuer: 'usr_iker' });

// Counters already moved past every reserved number, including the one reserved by the
// "uncertain" operation (the provider did process it; reconciliation will confirm it).
series.find((x) => x.id === 'ser_lev_f26').nextNumber = counters.ser_lev_f26;
series.find((x) => x.id === 'ser_lev_r26').nextNumber = counters.ser_lev_r26;
series.find((x) => x.id === 'ser_crv_f26').nextNumber = counters.ser_crv_f26;

// ── expenses ─────────────────────────────────────────────────────────
const expenses = [], attachments = [];
let expSeq = 1, attSeq = 1;
function attach(companyId, ownerId, fileName, uploadedBy, at, fingerprint) {
  const id = `att_${String(attSeq++).padStart(4, '0')}`;
  attachments.push({ id, companyId, ownerType: 'expense', ownerId, fileName, mimeType: fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', sizeBytes: 80000 + Math.floor(rnd() * 400000), fingerprint: fingerprint ?? `seed-${id}`, dataUrl: null, accessClass: 'finance', uploadedBy, uploadedAt: at, version: 1, supersedesId: null, demo: true });
  return id;
}
function expense(def) {
  const { companyId = C1, kind, supplierId = null, merchantName = '', documentType = 'complete_invoice', documentNumber = '', documentDate, category, description, base, vat = 21, wh = 0, submittedBy, review = 'approved', reviewer = 'usr_marta', comment = '', pay = 'unpaid', recipientNifShown = true, due = null, file, fingerprint, ack = [] } = def;
  const id = `exp_${companyId === C1 ? 'lev' : 'crv'}_${String(expSeq++).padStart(3, '0')}`;
  const baseCents = euros(base); const vatCents = Math.round((baseCents * vat) / 100); const whCents = Math.round((baseCents * wh) / 100);
  const submittedAt = review === 'draft' ? null : ts(addDays(documentDate, 1), 18, 5);
  const reviewedAt = review === 'approved' || review === 'rejected' ? ts(addDays(documentDate, 3), 10, 30) : null;
  const att = file ? [attach(companyId, id, file, submittedBy, submittedAt ?? ts(documentDate, 18), fingerprint)] : [];
  expenses.push({
    id, companyId, kind, supplierId, merchantName, documentType, documentNumber, documentDate, accountingPeriod: documentDate.slice(0, 7), category, description,
    baseCents, vatRatePct: vat, vatCents, withholdingCents: whCents, totalCents: baseCents + vatCents - whCents, recipientNifShown, dueDate: due,
    submittedBy, submittedAt, reviewStatus: review, reviewedBy: reviewedAt ? reviewer : null, reviewedAt, reviewComment: comment,
    paymentStatus: pay, paidAt: pay === 'unpaid' ? null : addDays(documentDate, 20), paymentReference: pay === 'unpaid' ? '' : `PAG-${documentDate.replace(/-/g, '')}`,
    attachmentIds: att, duplicateAcknowledged: ack, extraction: null, createdAt: ts(documentDate, 18), updatedAt: reviewedAt ?? submittedAt ?? ts(documentDate, 18), version: 2,
  });
  return id;
}
const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
for (const mo of months) {
  expense({ kind: 'supplier_invoice', supplierId: 'sup_telecom', documentNumber: `LT-${mo.replace('-', '')}-88213`, documentDate: `${mo}-05`, category: 'telefonia', description: `Telefonía móvil y fibra — ${mo}`, base: 189.5, submittedBy: 'usr_javier', pay: mo === '2026-09' ? 'unpaid' : 'paid', due: `${mo}-20`, file: `factura_levante_telecom_${mo}.pdf` });
  expense({ kind: 'supplier_invoice', supplierId: 'sup_furgos', documentNumber: `AFT/${mo.slice(2).replace('-', '')}/031`, documentDate: `${mo}-01`, category: 'vehiculos', description: `Renting 3 furgonetas — ${mo}`, base: 1140, submittedBy: 'usr_javier', pay: mo === '2026-09' ? 'unpaid' : 'paid', due: `${mo}-10`, file: `renting_furgonetas_${mo}.pdf` });
}
expense({ kind: 'supplier_invoice', supplierId: 'sup_ferreteria', documentNumber: 'FIT-2026-04412', documentDate: '2026-08-12', category: 'materiales', description: 'Material de fontanería y fijaciones', base: 642.3, submittedBy: 'usr_javier', pay: 'paid', due: '2026-09-11', file: 'FIT-2026-04412.pdf', fingerprint: 'seed-dup-fit-04412' });
expense({ kind: 'supplier_invoice', supplierId: 'sup_electrica', documentNumber: 'SEL-26-118734', documentDate: '2026-09-03', category: 'materiales', description: 'Diferenciales, magnetotérmicos y cable', base: 1385.75, submittedBy: 'usr_javier', pay: 'unpaid', due: '2026-11-02', file: 'SEL-26-118734.pdf' });
expense({ kind: 'supplier_invoice', supplierId: 'sup_seguros', documentNumber: 'POL-RC-2026-7781', documentDate: '2026-07-01', category: 'seguros', description: 'Prima anual seguro de responsabilidad civil (exenta de IVA)', base: 1260, vat: 0, submittedBy: 'usr_javier', pay: 'paid', due: '2026-07-15', file: 'poliza_rc_2026.pdf' });
expense({ kind: 'supplier_invoice', supplierId: 'sup_turia', documentNumber: 'AT-2026/0912', documentDate: '2026-09-30', category: 'servicios_profesionales', description: 'Honorarios asesoría contable y fiscal — 3.er trimestre', base: 540, submittedBy: 'usr_javier', pay: 'unpaid', due: '2026-10-15', file: 'AT-2026-0912.pdf' });
expense({ kind: 'supplier_invoice', supplierId: 'sup_abogado', documentNumber: 'JM-26-044', documentDate: '2026-09-15', category: 'servicios_profesionales', description: 'Honorarios por revisión de contrato de mantenimiento (retención IRPF 15 %)', base: 450, wh: 15, submittedBy: 'usr_javier', review: 'submitted', reviewer: null, pay: 'unpaid', due: '2026-10-15', file: 'minuta_JM-26-044.pdf' });
// Possible duplicate: same supplier and number as FIT-2026-04412, uploaded again.
expense({ kind: 'supplier_invoice', supplierId: 'sup_ferreteria', documentNumber: 'FIT-2026-04412', documentDate: '2026-08-12', category: 'materiales', description: 'Material de fontanería (reenvío del proveedor)', base: 642.3, submittedBy: 'usr_javier', review: 'submitted', reviewer: null, pay: 'unpaid', due: '2026-09-11', file: 'FIT-2026-04412 (1).pdf', fingerprint: 'seed-dup-fit-04412' });
expense({ kind: 'supplier_invoice', supplierId: 'sup_ferreteria', documentNumber: 'FIT-2026-05120', documentDate: '2026-10-02', category: 'materiales', description: 'Pintura plástica y rodillos', base: 312.4, submittedBy: 'usr_javier', review: 'draft', reviewer: null, pay: 'unpaid', due: '2026-11-01', file: null });
// Employee expenses
expense({ kind: 'employee_expense', supplierId: 'sup_gasolinera', documentType: 'simplified_invoice', documentNumber: 'T-0099812', documentDate: '2026-09-11', category: 'combustible', description: 'Gasoil furgoneta 4471-LKP', base: 57.85, submittedBy: 'usr_pablo', reviewer: 'usr_elena', pay: 'reimbursed', file: 'ticket_gasoil_0911.jpg', recipientNifShown: true });
expense({ kind: 'employee_expense', merchantName: 'Bar Restaurante El Racó', documentType: 'simplified_invoice', documentNumber: '2026/1534', documentDate: '2026-09-24', category: 'dietas', description: 'Comida en desplazamiento a Gandia (obra Hotel Mar Blau)', base: 13.64, vat: 10, submittedBy: 'usr_pablo', reviewer: 'usr_elena', pay: 'reimbursed', file: 'ticket_comida_0924.jpg', recipientNifShown: false });
expense({ kind: 'employee_expense', merchantName: 'Aparcament Centre Històric', documentType: 'simplified_invoice', documentNumber: 'A-55120', documentDate: '2026-10-01', category: 'aparcamiento', description: 'Aparcamiento intervención urgente Torre Turia', base: 7.44, submittedBy: 'usr_sergio', review: 'submitted', reviewer: null, file: 'ticket_parking_1001.jpg', recipientNifShown: false });
expense({ kind: 'employee_expense', merchantName: 'AP-7 Autopista', documentType: 'receipt_no_vat', documentNumber: '', documentDate: '2026-10-03', category: 'peajes', description: 'Peaje desplazamiento a Castelló', base: 8.9, vat: 0, submittedBy: 'usr_sergio', review: 'submitted', reviewer: null, file: 'peaje_1003.jpg' });
expense({ kind: 'employee_expense', supplierId: 'sup_ferreteria', documentType: 'simplified_invoice', documentNumber: 'FIT-T-77812', documentDate: '2026-10-06', category: 'materiales', description: 'Compra urgente de racores (pagado con tarjeta personal)', base: 372.1, submittedBy: 'usr_pablo', review: 'submitted', reviewer: null, file: 'ticket_racores_1006.jpg', recipientNifShown: true });
expense({ kind: 'employee_expense', merchantName: 'Restaurante Casa Pepa', documentType: 'simplified_invoice', documentNumber: '88/2026', documentDate: '2026-09-19', category: 'dietas', description: 'Cena con cliente (sin justificación de asistentes)', base: 96.36, vat: 10, submittedBy: 'usr_sergio', review: 'rejected', reviewer: 'usr_elena', comment: 'Las comidas con clientes requieren autorización previa de gerencia e indicar asistentes. Reenvíelo con la autorización.', file: 'ticket_cena_0919.jpg', recipientNifShown: false });
expense({ kind: 'employee_expense', merchantName: 'Taxi Valencia (licencia 1123)', documentType: 'simplified_invoice', documentNumber: 'TX-3391', documentDate: '2026-10-07', category: 'desplazamientos', description: 'Taxi a obra Colegio Santa Ana', base: 13.18, vat: 10, submittedBy: 'usr_elena', review: 'draft', reviewer: null, file: null, recipientNifShown: false });
// Carmen Ruiz
expense({ companyId: C3, kind: 'supplier_invoice', supplierId: 'sup_crv_colegio', documentNumber: 'COAAT-V-2026-1188', documentDate: '2026-07-12', category: 'servicios_profesionales', description: 'Visado colegial — dirección de ejecución Ses Fontanelles', base: 210, submittedBy: 'usr_carmen', reviewer: 'usr_carmen', pay: 'paid', file: 'visado_1188.pdf' });
expense({ companyId: C3, kind: 'supplier_invoice', supplierId: 'sup_crv_software', documentNumber: 'PTB-26-0566', documentDate: '2026-09-01', category: 'software', description: 'Licencia anual software de mediciones', base: 395, submittedBy: 'usr_carmen', reviewer: 'usr_carmen', pay: 'paid', file: 'PTB-26-0566.pdf' });

// ── handovers & exports ──────────────────────────────────────────────
const checklist = (doneKeys, by, at) => [
  ['invoices_issued_reconciled', 'Facturas emitidas con resultado fiscal conciliado', true],
  ['fiscal_exceptions', 'Sin excepciones fiscales abiertas (o explicadas)', true],
  ['expenses_reviewed', 'Gastos del periodo revisados (sin pendientes)', true],
  ['evidence_attached', 'Justificantes adjuntos en todos los gastos aprobados', true],
  ['payments_recorded', 'Cobros y pagos del periodo registrados', false],
  ['disputes_noted', 'Disputas abiertas documentadas', false],
  ['export_generated', 'Exportación del periodo generada', true],
].map(([key, label, auto]) => ({ key, label, auto, done: doneKeys.includes(key), doneBy: doneKeys.includes(key) ? by : null, doneAt: doneKeys.includes(key) ? at : null }));
const exportsArr = [
  { id: 'exp_rec_0001', companyId: C1, kind: 'handover.invoices', format: 'csv', fileName: 'levante_facturas_2026-08.csv', periodFrom: '2026-08-01', periodTo: '2026-08-31', filters: 'Facturas emitidas y rectificativas del periodo', recordCount: 3, totalCents: null, fingerprint: 'seed-7d1c0f2a9b11e3c4', scopeNote: 'Exportación operativa para la gestoría. No es una declaración tributaria.', createdBy: 'usr_carlos', createdAt: ts('2026-09-04', 12) },
  { id: 'exp_rec_0002', companyId: C1, kind: 'handover.expenses', format: 'csv', fileName: 'levante_gastos_2026-08.csv', periodFrom: '2026-08-01', periodTo: '2026-08-31', filters: 'Gastos aprobados del periodo', recordCount: 3, totalCents: null, fingerprint: 'seed-a03b8ce41d07f552', scopeNote: 'Exportación operativa para la gestoría. No es una declaración tributaria.', createdBy: 'usr_carlos', createdAt: ts('2026-09-04', 12, 2) },
];
const handovers = [
  { id: 'hnd_lev_2026_08', companyId: C1, periodFrom: '2026-08-01', periodTo: '2026-08-31', label: 'Agosto 2026', status: 'acknowledged', checklist: checklist(['invoices_issued_reconciled', 'fiscal_exceptions', 'expenses_reviewed', 'evidence_attached', 'payments_recorded', 'disputes_noted', 'export_generated'], 'usr_javier', ts('2026-09-03', 17)), exportIds: ['exp_rec_0001', 'exp_rec_0002'], notes: 'Disputa abierta con Clínica Dental Benimaclet documentada.', createdBy: 'usr_javier', createdAt: ts('2026-09-01', 9), deliveredAt: ts('2026-09-03', 17, 30), acknowledgedBy: 'usr_carlos', acknowledgedAt: ts('2026-09-04', 12, 5) },
  { id: 'hnd_lev_2026_09', companyId: C1, periodFrom: '2026-09-01', periodTo: '2026-09-30', label: 'Septiembre 2026', status: 'in_preparation', checklist: checklist(['payments_recorded'], 'usr_javier', ts('2026-10-05', 17)), exportIds: [], notes: '', createdBy: 'usr_javier', createdAt: ts('2026-10-01', 9), deliveredAt: null, acknowledgedBy: null, acknowledgedAt: null },
];

// Remote state of the mock provider: the "uncertain" request WAS processed remotely.
const providerRemote = { records: remoteRecords };
void uncertainInv;

const out = {
  companies, financeConfigs, providerConfigs, series, collectionPolicies, users, memberships, customers, suppliers,
  invoices, payments, disputes, fiscalOperations, deliveries, reminders, expenses, attachments, handovers, exports: exportsArr,
  providerRemote,
};
for (const [k, v] of Object.entries(out)) writeFileSync(join(OUT, `${k}.json`), JSON.stringify(v, null, 2) + '\n');
console.log('Seed written:', Object.entries(out).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : Object.keys(v).length}`).join(', '));
