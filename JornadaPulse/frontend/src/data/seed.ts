/**
 * Deterministic demo dataset, generated RELATIVE to an anchor instant (the first visit), so the
 * "today" views always have live data. Tests pass a fixed anchor.
 *
 * All people, companies and records are fictitious. Company, user and customer-site ids match
 * the FacturaFlow mini-app (shared portal identities, PLT-02).
 *
 * Every scenario the BRD and the spec ask to demonstrate is seeded on purpose and listed in
 * SCENARIOS (shown on the Requirements page).
 */
import { chainAuditEvent } from '../domain/audit';
import { receiptFor } from '../domain/ids';
import { addDays, at, DEFAULT_TZ, localDate, now, startOfMonth, weekday, addMonths, periodOf } from '../domain/time';
import type {
  AbsenceRequest,
  AbsenceType,
  Actor,
  AnomalyReview,
  AttendanceEvent,
  AuditEvent,
  BreakKind,
  ClockSource,
  CollectiveAgreementReference,
  Company,
  CorrectionRequest,
  Database,
  Department,
  Employee,
  EmploymentRelationship,
  EventType,
  FailedAttempt,
  ID,
  ISODate,
  ISOInstant,
  Membership,
  PlannedShift,
  RecordingProtocol,
  ReportingPeriod,
  RoleId,
  SessionValues,
  User,
  WorkingCalendar,
  WorkingTimePolicy,
  WorkMode,
  WorkSession,
  Worksite,
} from '../domain/types';
import { SCHEMA_VERSION } from '../store/storage';

const TZ = DEFAULT_TZ;

// ─────────────────────────────── Deterministic helpers ───────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addMin(iso: ISOInstant, minutes: number): ISOInstant {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

// ─────────────────────────────── Reference data ───────────────────────────────

const COMPANIES: Company[] = [
  { id: 'cmp_levante', legalName: 'Mantenimientos Levante, S.L.', tradeName: 'Mantenimientos Levante', nif: 'B97482152', timezone: TZ, province: 'Valencia', employeeCount: 18, activity: 'Mantenimiento integral y limpieza de edificios e instalaciones', workerRepresentation: 'delegados' },
  { id: 'cmp_ibaigane', legalName: 'Instalaciones Ibaigane, S.L.', tradeName: 'Ibaigane Instalaciones', nif: 'B95326070', timezone: TZ, province: 'Bizkaia', employeeCount: 9, activity: 'Instalaciones eléctricas y de climatización', workerRepresentation: 'none' },
];

const DEPARTMENTS: Department[] = [
  { id: 'dep_adm', companyId: 'cmp_levante', name: 'Administración' },
  { id: 'dep_mant', companyId: 'cmp_levante', name: 'Mantenimiento técnico' },
  { id: 'dep_limp', companyId: 'cmp_levante', name: 'Limpieza' },
  { id: 'dep_iba', companyId: 'cmp_ibaigane', name: 'Instalaciones' },
];

const WORKSITES: Worksite[] = [
  { id: 'ws_oficina', companyId: 'cmp_levante', name: 'Oficina y almacén', kind: 'own', address: 'Carrer de Sant Vicent Màrtir, 214, bajo', city: 'València', timezone: TZ, calendarId: 'cal_vlc_2026', active: true },
  { id: 'ws_torre', companyId: 'cmp_levante', name: 'Comunidad de Propietarios Torre Turia', kind: 'customer', address: 'Av. de Pius XII, 46', city: 'València', timezone: TZ, calendarId: 'cal_vlc_2026', active: true },
  { id: 'ws_marblau', companyId: 'cmp_levante', name: 'Hotel Mar Blau', kind: 'customer', address: 'Passeig de Neptú, 18', city: 'València', timezone: TZ, calendarId: 'cal_vlc_2026', active: true },
  { id: 'ws_dental', companyId: 'cmp_levante', name: 'Clínica Dental Benimaclet', kind: 'customer', address: 'Carrer de Murta, 9', city: 'València', timezone: TZ, calendarId: 'cal_vlc_2026', active: true },
  { id: 'ws_colegio', companyId: 'cmp_levante', name: 'Colegio Santa Ana', kind: 'customer', address: 'Carrer de la Reina, 101', city: 'València', timezone: TZ, calendarId: 'cal_vlc_2026', active: true },
  { id: 'ws_horta', companyId: 'cmp_levante', name: 'Supermercados Horta (Alboraia)', kind: 'customer', address: 'Ctra. de Barcelona, km 3', city: 'Alboraia', timezone: TZ, calendarId: 'cal_vlc_2026', active: true },
  { id: 'ws_cowork', companyId: 'cmp_levante', name: 'Coworking Cabanyal', kind: 'customer', address: 'Carrer de la Reina, 205', city: 'València', timezone: TZ, calendarId: 'cal_vlc_2026', active: true },
  { id: 'ws_getxo', companyId: 'cmp_ibaigane', name: 'Taller Getxo', kind: 'own', address: 'Ibaigane Kalea, 12', city: 'Getxo', timezone: TZ, calendarId: 'cal_iba_2026', active: true },
];

const CALENDARS: WorkingCalendar[] = [
  {
    id: 'cal_vlc_2026',
    companyId: 'cmp_levante',
    name: 'València ciudad 2026',
    year: 2026,
    source: 'Resolución de 17/10/2025 de la Dirección General de Trabajo (fiestas laborales 2026); fiestas locales de València según resolución autonómica de 12/11/2025 (fuente secundaria: verificar en el DOGV).',
    sourceUrl: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-21667',
    holidays: [
      { date: '2026-01-01', name: 'Año Nuevo', scope: 'national' },
      { date: '2026-01-06', name: 'Epifanía del Señor', scope: 'national' },
      { date: '2026-01-22', name: 'San Vicente Mártir', scope: 'local' },
      { date: '2026-03-19', name: 'San José', scope: 'national' },
      { date: '2026-04-03', name: 'Viernes Santo', scope: 'national' },
      { date: '2026-04-06', name: 'Lunes de Pascua', scope: 'regional' },
      { date: '2026-04-13', name: 'San Vicente Ferrer', scope: 'local' },
      { date: '2026-05-01', name: 'Fiesta del Trabajo', scope: 'national' },
      { date: '2026-06-24', name: 'San Juan', scope: 'regional' },
      { date: '2026-08-15', name: 'Asunción de la Virgen', scope: 'national' },
      { date: '2026-10-09', name: 'Día de la Comunitat Valenciana', scope: 'regional' },
      { date: '2026-10-12', name: 'Fiesta Nacional de España', scope: 'national' },
      { date: '2026-12-08', name: 'Inmaculada Concepción', scope: 'national' },
      { date: '2026-12-25', name: 'Natividad del Señor', scope: 'national' },
    ],
  },
  {
    id: 'cal_iba_2026',
    companyId: 'cmp_ibaigane',
    name: 'Getxo 2026 (incompleto)',
    year: 2026,
    source: 'Solo fiestas nacionales no sustituibles de la Resolución de 17/10/2025. Fiestas autonómicas del País Vasco y locales de Getxo pendientes de cargar y verificar.',
    sourceUrl: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-21667',
    holidays: [
      { date: '2026-01-01', name: 'Año Nuevo', scope: 'national' },
      { date: '2026-04-03', name: 'Viernes Santo', scope: 'national' },
      { date: '2026-05-01', name: 'Fiesta del Trabajo', scope: 'national' },
      { date: '2026-08-15', name: 'Asunción de la Virgen', scope: 'national' },
      { date: '2026-10-12', name: 'Fiesta Nacional de España', scope: 'national' },
      { date: '2026-12-08', name: 'Inmaculada Concepción', scope: 'national' },
      { date: '2026-12-25', name: 'Natividad del Señor', scope: 'national' },
    ],
  },
];

const AGREEMENTS: CollectiveAgreementReference[] = [
  { id: 'agr_limp', companyId: 'cmp_levante', name: 'Convenio colectivo provincial de limpieza de edificios y locales de Valencia', code: null, scope: 'Personal de limpieza', sourceUrl: 'https://expinterweb.mites.gob.es/regcon/', reviewStatus: 'pending_review', reviewedBy: null, reviewedAt: null, note: 'Referencia. El contenido (pausas, jornada máxima diaria, asuntos propios) no está cargado: se configura como política tras la revisión de la asesoría laboral.' },
  { id: 'agr_metal', companyId: 'cmp_levante', name: 'Convenio colectivo provincial de la industria del metal de Valencia', code: null, scope: 'Personal técnico de mantenimiento', sourceUrl: 'https://expinterweb.mites.gob.es/regcon/', reviewStatus: 'adviser_reviewed', reviewedBy: 'Rosa Bellver Gil (Asesoría Turia)', reviewedAt: '2026-01-20', note: 'Revisado para la política de mantenimiento v1 (pausa de bocadillo retribuida). Datos de demostración.' },
  { id: 'agr_ofi', companyId: 'cmp_levante', name: 'Convenio colectivo de oficinas y despachos de la provincia de Valencia', code: null, scope: 'Personal de administración', sourceUrl: 'https://expinterweb.mites.gob.es/regcon/', reviewStatus: 'reference_only', reviewedBy: null, reviewedAt: null, note: 'Solo referencia; sin reglas configuradas a partir de su contenido.' },
  { id: 'agr_iba', companyId: 'cmp_ibaigane', name: 'Convenio colectivo del metal de Bizkaia', code: null, scope: 'Toda la plantilla', sourceUrl: 'https://expinterweb.mites.gob.es/regcon/', reviewStatus: 'pending_review', reviewedBy: null, reviewedAt: null, note: 'Pendiente de revisión.' },
];

const BASE_INDICATORS = {
  dailyOrdinaryMaxHours: 9,
  minRestBetweenDaysHours: 12,
  longSessionHours: 10,
  shortSessionMinutes: 15,
  continuousWorkBreakAfterHours: 6,
  minBreakMinutes: 15,
  nightStart: '22:00',
  nightEnd: '06:00',
  missingClockOutAfterHours: 14,
};

function buildPolicies(anchorDate: ISODate): WorkingTimePolicy[] {
  const monthStart = startOfMonth(anchorDate);
  return [
    { id: 'pol_limp_v1', companyId: 'cmp_levante', key: 'limpieza', name: 'Jornada — Limpieza', version: 1, effectiveFrom: '2026-01-01', effectiveTo: addDays(monthStart, -1), status: 'superseded', agreementId: 'agr_limp', breaks: { paidBreakKinds: [], paidBreakMinutes: 0 }, indicators: { ...BASE_INDICATORS }, basis: 'Decisión de la empresa previa consulta al delegado de personal (umbrales de demostración; convenio pendiente de revisión).', editedBy: 'usr_javier', editedAt: '2026-01-02T08:00:00.000Z', approvedBy: null, supersedesId: null, changeReason: 'Versión inicial.' },
    { id: 'pol_limp_v2', companyId: 'cmp_levante', key: 'limpieza', name: 'Jornada — Limpieza', version: 2, effectiveFrom: monthStart, effectiveTo: null, status: 'active', agreementId: 'agr_limp', breaks: { paidBreakKinds: ['rest'], paidBreakMinutes: 15 }, indicators: { ...BASE_INDICATORS }, basis: 'Revisión del convenio: el descanso de 15 minutos computa como tiempo de trabajo efectivo (pendiente de validación por la asesoría laboral).', editedBy: 'usr_javier', editedAt: `${addDays(monthStart, -3)}T09:00:00.000Z`, approvedBy: null, supersedesId: 'pol_limp_v1', changeReason: 'El descanso pasa a ser retribuido desde el primer día del mes. Los registros anteriores siguen calculándose con la versión 1.' },
    { id: 'pol_mant_v1', companyId: 'cmp_levante', key: 'mantenimiento', name: 'Jornada — Mantenimiento técnico', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, status: 'active', agreementId: 'agr_metal', breaks: { paidBreakKinds: ['rest'], paidBreakMinutes: 20 }, indicators: { ...BASE_INDICATORS, longSessionHours: 11 }, basis: 'Convenio del metal de Valencia revisado por la asesoría laboral (datos de demostración).', editedBy: 'usr_javier', editedAt: '2026-01-20T10:00:00.000Z', approvedBy: 'Rosa Bellver Gil (Asesoría Turia)', supersedesId: null, changeReason: 'Versión inicial.' },
    { id: 'pol_ofi_v1', companyId: 'cmp_levante', key: 'oficina', name: 'Jornada — Administración', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, status: 'active', agreementId: 'agr_ofi', breaks: { paidBreakKinds: [], paidBreakMinutes: 0 }, indicators: { ...BASE_INDICATORS }, basis: 'Decisión de la empresa previa consulta (sin reglas de convenio cargadas).', editedBy: 'usr_javier', editedAt: '2026-01-02T08:00:00.000Z', approvedBy: null, supersedesId: null, changeReason: 'Versión inicial.' },
    { id: 'pol_iba_v1', companyId: 'cmp_ibaigane', key: 'general', name: 'Jornada — General', version: 1, effectiveFrom: '2026-01-01', effectiveTo: null, status: 'active', agreementId: 'agr_iba', breaks: { paidBreakKinds: [], paidBreakMinutes: 0 }, indicators: { ...BASE_INDICATORS }, basis: 'Pendiente de revisión.', editedBy: 'usr_iker', editedAt: '2026-01-05T08:00:00.000Z', approvedBy: null, supersedesId: null, changeReason: 'Versión inicial.' },
  ];
}

const PROTOCOLS: RecordingProtocol[] = [
  {
    id: 'prt_levante_v1',
    companyId: 'cmp_levante',
    version: 1,
    basis: 'decision_previa_consulta',
    basisReference: 'Decisión de la empresa tras consulta al delegado de personal (acta de 10/06/2024).',
    consultedRepresentativesOn: '2024-06-10',
    effectiveFrom: '2024-07-01',
    sources: ['web', 'mobile', 'kiosk_pin'],
    correctionProcedure: 'Cualquier error u omisión se corrige mediante una solicitud de corrección con explicación obligatoria. La revisa la persona supervisora o RR. HH.; el registro original nunca se modifica.',
    connectivityFallback: 'Si un fichaje no se registra (sin conexión), la aplicación muestra «No registrado». La persona trabajadora anota la hora y la comunica mediante una solicitud de corrección en cuanto sea posible.',
    approvedBy: 'Laura Martín Soler',
    approvedAt: '2024-06-20T10:00:00.000Z',
    status: 'active',
  },
  {
    id: 'prt_iba_v1',
    companyId: 'cmp_ibaigane',
    version: 1,
    basis: 'decision_previa_consulta',
    basisReference: 'Decisión de la empresa (sin representación legal de los trabajadores).',
    consultedRepresentativesOn: null,
    effectiveFrom: '2025-01-01',
    sources: ['web', 'mobile'],
    correctionProcedure: 'Solicitud de corrección revisada por la gerencia.',
    connectivityFallback: 'Comunicar el fichaje no registrado mediante una solicitud de corrección.',
    approvedBy: 'Iker Etxeberria Uriarte',
    approvedAt: '2025-01-02T09:00:00.000Z',
    status: 'active',
  },
];

function absenceTypes(): AbsenceType[] {
  const base = { companyId: 'cmp_levante', active: true, version: 1, effectiveFrom: '2026-01-01' };
  const list: Omit<AbsenceType, 'companyId' | 'active' | 'version' | 'effectiveFrom'>[] = [
    { id: 'abt_vac', code: 'VAC', name: 'Vacaciones', legalReference: 'ET art. 38.1 (mínimo 30 días naturales; el convenio puede mejorarlo)', paid: 'paid', requiresApproval: true, evidence: 'none', sensitive: false, allowsPartialDay: false, allowance: { days: 30, unit: 'natural', year: 2026, adviserApproved: true }, referenceDuration: '30 días naturales al año (mínimo legal)', note: 'Saldo de demostración validado por la asesoría laboral.', colour: 'blue' },
    { id: 'abt_it', code: 'IT', name: 'Baja médica (incapacidad temporal)', legalReference: 'RD 625/2014 (mod. RD 1060/2022): el INSS comunica el parte a la empresa; la persona trabajadora no entrega copia', paid: 'depends', requiresApproval: false, evidence: 'none', sensitive: true, allowsPartialDay: false, allowance: null, referenceDuration: null, note: 'No se recoge diagnóstico ni documentación médica. Se registra para planificación; no requiere aprobación.', colour: 'rose' },
    { id: 'abt_mat', code: 'PR-MAT', name: 'Permiso retribuido · matrimonio o pareja de hecho', legalReference: 'ET art. 37.3.a', paid: 'paid', requiresApproval: true, evidence: 'optional', sensitive: false, allowsPartialDay: false, allowance: null, referenceDuration: '15 días naturales (mínimo legal)', note: 'Revisar mejoras del convenio.', colour: 'teal' },
    { id: 'abt_fam', code: 'PR-FAM', name: 'Permiso retribuido · accidente, enfermedad grave u hospitalización de familiar', legalReference: 'ET art. 37.3.b', paid: 'paid', requiresApproval: true, evidence: 'optional', sensitive: true, allowsPartialDay: false, allowance: null, referenceDuration: '5 días (mínimo legal)', note: 'Categoría sensible: se oculta a supervisores y representantes.', colour: 'teal' },
    { id: 'abt_fall', code: 'PR-FALL', name: 'Permiso retribuido · fallecimiento de familiar', legalReference: 'ET art. 37.3.b bis', paid: 'paid', requiresApproval: true, evidence: 'optional', sensitive: false, allowsPartialDay: false, allowance: null, referenceDuration: '2 días; 4 con desplazamiento (mínimo legal)', note: '', colour: 'teal' },
    { id: 'abt_mud', code: 'PR-MUD', name: 'Permiso retribuido · traslado de domicilio', legalReference: 'ET art. 37.3.c', paid: 'paid', requiresApproval: true, evidence: 'optional', sensitive: false, allowsPartialDay: false, allowance: null, referenceDuration: '1 día (mínimo legal)', note: '', colour: 'teal' },
    { id: 'abt_deber', code: 'PR-DEB', name: 'Permiso retribuido · deber inexcusable o exámenes prenatales (horas)', legalReference: 'ET art. 37.3.d y f', paid: 'paid', requiresApproval: true, evidence: 'optional', sensitive: false, allowsPartialDay: true, allowance: null, referenceDuration: 'Tiempo indispensable', note: '', colour: 'violet' },
    { id: 'abt_fm', code: 'FM', name: 'Ausencia por fuerza mayor familiar', legalReference: 'ET art. 37.9', paid: 'depends', requiresApproval: true, evidence: 'optional', sensitive: false, allowsPartialDay: true, allowance: null, referenceDuration: 'Hasta 4 días al año retribuidos (mínimo legal)', note: 'La parte retribuida depende del cómputo anual; la determina la asesoría.', colour: 'violet' },
    { id: 'abt_pnr', code: 'PNR', name: 'Permiso no retribuido', legalReference: 'Acuerdo entre las partes', paid: 'unpaid', requiresApproval: true, evidence: 'none', sensitive: false, allowsPartialDay: false, allowance: null, referenceDuration: null, note: '', colour: 'grey' },
    { id: 'abt_ap', code: 'AP', name: 'Asuntos propios (según convenio)', legalReference: 'No es un permiso del ET: solo si el convenio aplicable lo reconoce', paid: 'depends', requiresApproval: true, evidence: 'none', sensitive: false, allowsPartialDay: false, allowance: null, referenceDuration: null, note: 'Sin saldo configurado: el convenio de limpieza está pendiente de revisión.', colour: 'amber' },
    { id: 'abt_otra', code: 'OTRA', name: 'Otras ausencias', legalReference: 'Según política de la empresa', paid: 'depends', requiresApproval: true, evidence: 'optional', sensitive: false, allowsPartialDay: true, allowance: null, referenceDuration: null, note: '', colour: 'grey' },
  ];
  return [
    ...list.map((t) => ({ ...base, ...t })),
    { ...base, companyId: 'cmp_ibaigane', id: 'abt_iba_vac', code: 'VAC', name: 'Vacaciones', legalReference: 'ET art. 38.1', paid: 'paid', requiresApproval: true, evidence: 'none', sensitive: false, allowsPartialDay: false, allowance: null, referenceDuration: '30 días naturales al año (mínimo legal)', note: 'Saldo no configurado.', colour: 'blue' },
  ];
}

const USERS: User[] = [
  { id: 'usr_laura', name: 'Laura Martín Soler', email: 'laura.martin@mantenimientoslevante.example', title: 'Gerente y socia', organisation: null },
  { id: 'usr_javier', name: 'Javier Ortega Pons', email: 'javier.ortega@mantenimientoslevante.example', title: 'Administración y RR. HH.', organisation: null },
  { id: 'usr_elena', name: 'Elena Navarro Gil', email: 'elena.navarro@mantenimientoslevante.example', title: 'Jefa de equipo técnico', organisation: null },
  { id: 'usr_amparo', name: 'Amparo Ribes Bosch', email: 'amparo.ribes@mantenimientoslevante.example', title: 'Encargada de limpieza', organisation: null },
  { id: 'usr_pablo', name: 'Pablo Ruiz Esteve', email: 'pablo.ruiz@mantenimientoslevante.example', title: 'Técnico de mantenimiento', organisation: null },
  { id: 'usr_sergio', name: 'Sergio Llopis Mora', email: 'sergio.llopis@mantenimientoslevante.example', title: 'Técnico de instalaciones', organisation: null },
  { id: 'usr_lucia', name: 'Lucía Martínez Peiró', email: 'lucia.martinez@mantenimientoslevante.example', title: 'Limpiadora (tiempo parcial)', organisation: null },
  { id: 'usr_andres', name: 'Andrés Ferrer Moll', email: 'andres.ferrer@mantenimientoslevante.example', title: 'Técnico y delegado de personal', organisation: null },
  { id: 'usr_rosa', name: 'Rosa Bellver Gil', email: 'rosa.bellver@asesoriaturia.example', title: 'Graduada social · nóminas', organisation: 'Asesoría Turia, S.L.P.' },
  { id: 'usr_nuria', name: 'Nuria Campos Sáez', email: 'nuria@gestoriaanterior.example', title: 'Gestora laboral (mandato finalizado)', organisation: 'Gestoría Campos' },
  { id: 'usr_iker', name: 'Iker Etxeberria Uriarte', email: 'iker@ibaigane.example', title: 'Gerente', organisation: null },
  { id: 'usr_ane', name: 'Ane Zubizarreta Goikoetxea', email: 'ane@ibaigane.example', title: 'Técnica de climatización', organisation: null },
];

// ─────────────────────────────── Employees and their weekly patterns ───────────────────────────────

interface ShiftSpec {
  start: string;
  end: string;
  site: ID;
  /** Recorded breaks for the actual session (kind, local start, minutes). */
  breaks?: { kind: BreakKind; at: string; minutes: number }[];
}

interface EmpSpec {
  e: Omit<Employee, 'companyId' | 'createdAt' | 'updatedAt' | 'status' | 'endDate'> & { companyId?: ID; status?: Employee['status']; endDate?: ISODate | null };
  rel: Omit<EmploymentRelationship, 'id' | 'companyId' | 'employeeId' | 'createdBy' | 'createdAt' | 'effectiveTo' | 'note' | 'reducedHours' | 'remoteAllowed'> & Partial<Pick<EmploymentRelationship, 'reducedHours' | 'remoteAllowed' | 'note'>>;
  /** Shifts for a weekday (0 = Monday). */
  week: (wd: number, date: ISODate) => ShiftSpec[];
  worksHolidays?: boolean;
  remoteDays?: number[];
}

const MON_FRI = (wd: number) => wd < 5;
const tech = (site: ID) => (wd: number): ShiftSpec[] => (MON_FRI(wd) ? [{ start: '07:30', end: '15:30', site, breaks: [{ kind: 'rest', at: '10:30', minutes: 20 }] }] : []);

const EMPLOYEES: EmpSpec[] = [
  { e: { id: 'emp_javier', code: 'EMP-001', firstName: 'Javier', lastName: 'Ortega Pons', workEmail: 'javier.ortega@mantenimientoslevante.example', departmentId: 'dep_adm', primaryWorksiteId: 'ws_oficina', worksiteIds: ['ws_oficina'], managerEmployeeId: null, jobTitle: 'Administración y RR. HH.', hireDate: '2019-02-01', userId: 'usr_javier' }, rel: { effectiveFrom: '2019-02-01', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_ofi', policyKey: 'oficina', remoteAllowed: true }, week: (wd) => (wd < 4 ? [{ start: '08:00', end: '17:00', site: 'ws_oficina', breaks: [{ kind: 'meal', at: '14:00', minutes: 60 }] }] : wd === 4 ? [{ start: '08:00', end: '15:00', site: 'ws_oficina' }] : []), remoteDays: [4] },
  { e: { id: 'emp_marta', code: 'EMP-002', firstName: 'Marta', lastName: 'Soler Vidal', workEmail: 'marta.soler@mantenimientoslevante.example', departmentId: 'dep_adm', primaryWorksiteId: 'ws_oficina', worksiteIds: ['ws_oficina'], managerEmployeeId: 'emp_javier', jobTitle: 'Responsable financiera', hireDate: '2020-09-01', userId: null }, rel: { effectiveFrom: '2025-09-01', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 35, partTimePct: null, agreementId: 'agr_ofi', policyKey: 'oficina', reducedHours: { pct: 12.5, basis: 'Reducción de jornada por cuidado de menor de 12 años (ET art. 37.6)' }, remoteAllowed: true }, week: (wd) => (MON_FRI(wd) ? [{ start: '08:30', end: '15:30', site: 'ws_oficina' }] : []) },
  { e: { id: 'emp_elena', code: 'EMP-003', firstName: 'Elena', lastName: 'Navarro Gil', workEmail: 'elena.navarro@mantenimientoslevante.example', departmentId: 'dep_mant', primaryWorksiteId: 'ws_oficina', worksiteIds: ['ws_oficina', 'ws_torre', 'ws_marblau', 'ws_colegio'], managerEmployeeId: 'emp_javier', jobTitle: 'Jefa de equipo técnico', hireDate: '2018-05-14', userId: 'usr_elena' }, rel: { effectiveFrom: '2018-05-14', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_metal', policyKey: 'mantenimiento' }, week: tech('ws_oficina') },
  { e: { id: 'emp_pablo', code: 'EMP-004', firstName: 'Pablo', lastName: 'Ruiz Esteve', workEmail: 'pablo.ruiz@mantenimientoslevante.example', departmentId: 'dep_mant', primaryWorksiteId: 'ws_torre', worksiteIds: ['ws_torre', 'ws_colegio', 'ws_oficina'], managerEmployeeId: 'emp_elena', jobTitle: 'Técnico de mantenimiento', hireDate: '2021-03-01', userId: 'usr_pablo' }, rel: { effectiveFrom: '2021-03-01', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_metal', policyKey: 'mantenimiento' }, week: (wd) => tech(wd % 2 ? 'ws_colegio' : 'ws_torre')(wd) },
  { e: { id: 'emp_sergio', code: 'EMP-005', firstName: 'Sergio', lastName: 'Llopis Mora', workEmail: 'sergio.llopis@mantenimientoslevante.example', departmentId: 'dep_mant', primaryWorksiteId: 'ws_marblau', worksiteIds: ['ws_marblau', 'ws_horta', 'ws_oficina'], managerEmployeeId: 'emp_elena', jobTitle: 'Técnico de instalaciones', hireDate: '2020-01-13', userId: 'usr_sergio' }, rel: { effectiveFrom: '2020-01-13', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_metal', policyKey: 'mantenimiento' }, week: tech('ws_marblau') },
  { e: { id: 'emp_andres', code: 'EMP-006', firstName: 'Andrés', lastName: 'Ferrer Moll', workEmail: 'andres.ferrer@mantenimientoslevante.example', departmentId: 'dep_mant', primaryWorksiteId: 'ws_colegio', worksiteIds: ['ws_colegio', 'ws_torre'], managerEmployeeId: 'emp_elena', jobTitle: 'Técnico de mantenimiento', hireDate: '2017-09-04', userId: 'usr_andres' }, rel: { effectiveFrom: '2017-09-04', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_metal', policyKey: 'mantenimiento' }, week: tech('ws_colegio') },
  { e: { id: 'emp_ivan', code: 'EMP-007', firstName: 'Iván', lastName: 'Castelló Peris', workEmail: 'ivan.castello@mantenimientoslevante.example', departmentId: 'dep_mant', primaryWorksiteId: 'ws_horta', worksiteIds: ['ws_horta', 'ws_marblau'], managerEmployeeId: 'emp_elena', jobTitle: 'Técnico de mantenimiento', hireDate: '2026-06-01', userId: null }, rel: { effectiveFrom: '2026-06-01', contractType: 'temporal', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_metal', policyKey: 'mantenimiento' }, week: tech('ws_horta') },
  { e: { id: 'emp_raul', code: 'EMP-008', firstName: 'Raúl', lastName: 'Gómez Sanchis', workEmail: 'raul.gomez@mantenimientoslevante.example', departmentId: 'dep_mant', primaryWorksiteId: 'ws_torre', worksiteIds: ['ws_torre', 'ws_dental'], managerEmployeeId: 'emp_elena', jobTitle: 'Oficial de fontanería', hireDate: '2022-02-07', userId: null }, rel: { effectiveFrom: '2022-02-07', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_metal', policyKey: 'mantenimiento' }, week: tech('ws_torre') },
  { e: { id: 'emp_oscar', code: 'EMP-009', firstName: 'Óscar', lastName: 'Pérez Llorens', workEmail: 'oscar.perez@mantenimientoslevante.example', departmentId: 'dep_mant', primaryWorksiteId: 'ws_dental', worksiteIds: ['ws_dental', 'ws_cowork'], managerEmployeeId: 'emp_elena', jobTitle: 'Técnico de climatización', hireDate: '2023-04-17', userId: null }, rel: { effectiveFrom: '2023-04-17', contractType: 'fijo_discontinuo', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_metal', policyKey: 'mantenimiento' }, week: tech('ws_dental') },
  { e: { id: 'emp_amparo', code: 'EMP-010', firstName: 'Amparo', lastName: 'Ribes Bosch', workEmail: 'amparo.ribes@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_oficina', worksiteIds: ['ws_oficina', 'ws_marblau', 'ws_dental', 'ws_colegio', 'ws_torre', 'ws_cowork', 'ws_horta'], managerEmployeeId: 'emp_javier', jobTitle: 'Encargada de limpieza', hireDate: '2016-11-02', userId: 'usr_amparo' }, rel: { effectiveFrom: '2016-11-02', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (MON_FRI(wd) ? [{ start: '08:00', end: '16:00', site: 'ws_oficina', breaks: [{ kind: 'rest', at: '11:00', minutes: 15 }] }] : []) },
  // BRD illustrative scenario: a cleaning employee who works at two customer sites every day.
  { e: { id: 'emp_lucia', code: 'EMP-011', firstName: 'Lucía', lastName: 'Martínez Peiró', workEmail: 'lucia.martinez@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_dental', worksiteIds: ['ws_dental', 'ws_cowork'], managerEmployeeId: 'emp_amparo', jobTitle: 'Limpiadora', hireDate: '2024-02-05', userId: 'usr_lucia' }, rel: { effectiveFrom: '2024-02-05', contractType: 'indefinido', workdayType: 'part_time', weeklyHours: 15, partTimePct: 37.5, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (MON_FRI(wd) ? [{ start: '07:00', end: '09:00', site: 'ws_dental' }, { start: '18:00', end: '20:00', site: 'ws_cowork' }] : []) },
  { e: { id: 'emp_rocio', code: 'EMP-012', firstName: 'Rocío', lastName: 'Navarro Vila', workEmail: 'rocio.navarro@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_marblau', worksiteIds: ['ws_marblau'], managerEmployeeId: 'emp_amparo', jobTitle: 'Limpiadora', hireDate: '2022-05-09', userId: null }, rel: { effectiveFrom: '2022-05-09', contractType: 'indefinido', workdayType: 'part_time', weeklyHours: 25, partTimePct: 62.5, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (MON_FRI(wd) ? [{ start: '09:00', end: '14:00', site: 'ws_marblau' }] : []), worksHolidays: true },
  { e: { id: 'emp_fatima', code: 'EMP-013', firstName: 'Fátima', lastName: 'El Amrani', workEmail: 'fatima.elamrani@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_colegio', worksiteIds: ['ws_colegio', 'ws_torre'], managerEmployeeId: 'emp_amparo', jobTitle: 'Limpiadora', hireDate: '2023-09-11', userId: null }, rel: { effectiveFrom: '2023-09-11', contractType: 'indefinido', workdayType: 'part_time', weeklyHours: 20, partTimePct: 50, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (MON_FRI(wd) ? [{ start: '15:00', end: '19:00', site: wd === 2 ? 'ws_torre' : 'ws_colegio' }] : []) },
  { e: { id: 'emp_carmen', code: 'EMP-014', firstName: 'Carmen', lastName: 'Soriano Lluch', workEmail: 'carmen.soriano@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_marblau', worksiteIds: ['ws_marblau'], managerEmployeeId: 'emp_amparo', jobTitle: 'Gobernanta de limpieza', hireDate: '2019-06-03', userId: null }, rel: { effectiveFrom: '2019-06-03', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (MON_FRI(wd) ? [{ start: '07:00', end: '15:00', site: 'ws_marblau', breaks: [{ kind: 'rest', at: '10:00', minutes: 15 }] }] : []), worksHolidays: true },
  { e: { id: 'emp_daniela', code: 'EMP-015', firstName: 'Daniela', lastName: 'Pop', workEmail: 'daniela.pop@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_marblau', worksiteIds: ['ws_marblau'], managerEmployeeId: 'emp_amparo', jobTitle: 'Limpiadora', hireDate: '2025-03-03', userId: null }, rel: { effectiveFrom: '2025-03-03', contractType: 'indefinido', workdayType: 'part_time', weeklyHours: 30, partTimePct: 75, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (MON_FRI(wd) ? [{ start: '14:00', end: '20:00', site: 'ws_marblau', breaks: [{ kind: 'rest', at: '17:00', minutes: 15 }] }] : []), worksHolidays: true },
  { e: { id: 'emp_josemi', code: 'EMP-016', firstName: 'José Miguel', lastName: 'Tormo Ibáñez', workEmail: 'josemiguel.tormo@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_horta', worksiteIds: ['ws_horta'], managerEmployeeId: 'emp_amparo', jobTitle: 'Peón de limpieza', hireDate: '2021-10-18', userId: null }, rel: { effectiveFrom: '2021-10-18', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (wd < 6 && wd !== 2 ? [{ start: '06:00', end: wd === 5 ? '10:00' : '14:00', site: 'ws_horta', breaks: wd === 5 ? [] : [{ kind: 'rest', at: '09:30', minutes: 15 }] }] : []) },
  { e: { id: 'emp_nerea', code: 'EMP-017', firstName: 'Nerea', lastName: 'Alcaraz Ferri', workEmail: 'nerea.alcaraz@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_torre', worksiteIds: ['ws_torre'], managerEmployeeId: 'emp_amparo', jobTitle: 'Limpiadora', hireDate: '2025-11-03', userId: null }, rel: { effectiveFrom: '2025-11-03', contractType: 'indefinido', workdayType: 'part_time', weeklyHours: 15, partTimePct: 37.5, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: (wd) => (wd === 0 || wd === 2 || wd === 4 ? [{ start: '16:00', end: '21:00', site: 'ws_torre' }] : []) },
  // Former employee: records kept for the four-year retention period (AC-TIM-04).
  { e: { id: 'emp_teresa', code: 'EMP-018', firstName: 'Teresa', lastName: 'Vidal Roig', workEmail: 'teresa.vidal@mantenimientoslevante.example', departmentId: 'dep_limp', primaryWorksiteId: 'ws_torre', worksiteIds: ['ws_torre'], managerEmployeeId: 'emp_amparo', jobTitle: 'Limpiadora', hireDate: '2022-03-01', userId: null, status: 'inactive', endDate: '2025-06-30' }, rel: { effectiveFrom: '2022-03-01', contractType: 'indefinido', workdayType: 'part_time', weeklyHours: 20, partTimePct: 50, agreementId: 'agr_limp', policyKey: 'limpieza' }, week: () => [] },
  // Second company (isolation tests).
  { e: { id: 'emp_ane', companyId: 'cmp_ibaigane', code: 'IBA-001', firstName: 'Ane', lastName: 'Zubizarreta Goikoetxea', workEmail: 'ane@ibaigane.example', departmentId: 'dep_iba', primaryWorksiteId: 'ws_getxo', worksiteIds: ['ws_getxo'], managerEmployeeId: null, jobTitle: 'Técnica de climatización', hireDate: '2021-01-11', userId: 'usr_ane' }, rel: { effectiveFrom: '2021-01-11', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_iba', policyKey: 'general' }, week: (wd) => (MON_FRI(wd) ? [{ start: '08:00', end: '16:00', site: 'ws_getxo', breaks: [{ kind: 'meal', at: '13:00', minutes: 30 }] }] : []) },
  { e: { id: 'emp_mikel', companyId: 'cmp_ibaigane', code: 'IBA-002', firstName: 'Mikel', lastName: 'Arrieta Uribe', workEmail: 'mikel@ibaigane.example', departmentId: 'dep_iba', primaryWorksiteId: 'ws_getxo', worksiteIds: ['ws_getxo'], managerEmployeeId: 'emp_ane', jobTitle: 'Electricista', hireDate: '2022-04-04', userId: null }, rel: { effectiveFrom: '2022-04-04', contractType: 'indefinido', workdayType: 'full_time', weeklyHours: 40, partTimePct: null, agreementId: 'agr_iba', policyKey: 'general' }, week: (wd) => (MON_FRI(wd) ? [{ start: '07:00', end: '15:00', site: 'ws_getxo' }] : []) },
];

function memberships(): Membership[] {
  const m = (id: string, userId: ID, companyId: ID, roles: RoleId[], employeeId: ID | null, extra: Partial<Membership> = {}): Membership => ({ id, userId, companyId, roles, employeeId, validFrom: '2024-01-01', validUntil: null, roleValidUntil: {}, status: 'active', revokedAt: null, reference: null, ...extra });
  return [
    m('mem_laura', 'usr_laura', 'cmp_levante', ['owner'], null),
    m('mem_javier', 'usr_javier', 'cmp_levante', ['hr_admin', 'employee'], 'emp_javier'),
    m('mem_elena', 'usr_elena', 'cmp_levante', ['supervisor', 'employee'], 'emp_elena'),
    m('mem_amparo', 'usr_amparo', 'cmp_levante', ['supervisor', 'employee'], 'emp_amparo'),
    m('mem_pablo', 'usr_pablo', 'cmp_levante', ['employee'], 'emp_pablo'),
    m('mem_sergio', 'usr_sergio', 'cmp_levante', ['employee'], 'emp_sergio'),
    m('mem_lucia', 'usr_lucia', 'cmp_levante', ['employee'], 'emp_lucia'),
    m('mem_andres', 'usr_andres', 'cmp_levante', ['employee', 'representative'], 'emp_andres', { roleValidUntil: { representative: '2028-05-14' }, reference: 'Delegado de personal elegido el 15/05/2024 (mandato de 4 años)' }),
    m('mem_rosa', 'usr_rosa', 'cmp_levante', ['payroll'], null, { validFrom: '2026-04-01', validUntil: '2027-03-31', reference: 'Mandato de gestión laboral MR-2026-031' }),
    m('mem_nuria', 'usr_nuria', 'cmp_levante', ['payroll'], null, { validFrom: '2024-01-01', validUntil: '2026-03-31', reference: 'Mandato anterior finalizado' }),
    m('mem_iker', 'usr_iker', 'cmp_ibaigane', ['owner', 'hr_admin'], null),
    m('mem_ane', 'usr_ane', 'cmp_ibaigane', ['supervisor', 'employee'], 'emp_ane'),
  ];
}

export const DEMO_USERS_NOTE = 'Usuarios ficticios. El selector de usuario sustituye al inicio de sesión real.';

// ─────────────────────────────── Builder ───────────────────────────────

export function buildSeedDatabase(anchor: Date = now()): Database {
  const rng = mulberry32(20261012);
  const jitter = (max: number) => Math.round((rng() * 2 - 1) * max);
  const nowIso = anchor.toISOString();
  const T = localDate(anchor, TZ);
  const counters = new Map<string, number>();
  const nid = (p: string) => {
    const n = (counters.get(p) ?? 0) + 1;
    counters.set(p, n);
    return `${p}_${String(n).padStart(5, '0')}`;
  };

  const holidays = new Set(CALENDARS.flatMap((c) => c.holidays.map((h) => `${c.id}:${h.date}`)));
  const isHoliday = (calId: ID, d: ISODate) => holidays.has(`${calId}:${d}`);
  const isWorkday = (d: ISODate) => weekday(d) < 5 && !isHoliday('cal_vlc_2026', d);
  /** nth working day before T (n ≥ 1). */
  const wdBefore = (n: number): ISODate => {
    let d = T;
    let k = 0;
    while (k < n) {
      d = addDays(d, -1);
      if (isWorkday(d)) k++;
    }
    return d;
  };
  /** nth working day after T (n ≥ 1). */
  const wdAfter = (n: number): ISODate => {
    let d = T;
    let k = 0;
    while (k < n) {
      d = addDays(d, 1);
      if (isWorkday(d)) k++;
    }
    return d;
  };

  const employees: Employee[] = EMPLOYEES.map((s) => ({ companyId: 'cmp_levante', status: 'active', endDate: null, ...s.e, createdAt: `${s.e.hireDate}T08:00:00.000Z`, updatedAt: `${s.e.hireDate}T08:00:00.000Z` }) as Employee);
  const empById = new Map(employees.map((e) => [e.id, e]));
  const relationships: EmploymentRelationship[] = EMPLOYEES.map((s) => ({
    id: nid('rel'),
    companyId: s.e.companyId ?? 'cmp_levante',
    employeeId: s.e.id,
    effectiveTo: s.e.endDate ?? null,
    reducedHours: null,
    remoteAllowed: false,
    note: '',
    createdBy: 'usr_javier',
    createdAt: `${s.rel.effectiveFrom}T08:00:00.000Z`,
    ...s.rel,
  }));
  // Lucía's hours increased: the earlier version is kept (effective-dated history).
  const lucia = relationships.find((r) => r.employeeId === 'emp_lucia')!;
  const luciaChange = addDays(T, -20);
  lucia.weeklyHours = 10;
  lucia.partTimePct = 25;
  lucia.effectiveTo = addDays(luciaChange, -1);
  relationships.push({ ...lucia, id: nid('rel'), effectiveFrom: luciaChange, effectiveTo: null, weeklyHours: 15, partTimePct: 37.5, note: 'Ampliación de jornada pactada (novación del contrato).', createdAt: `${addDays(luciaChange, -5)}T09:00:00.000Z` });

  const shifts: PlannedShift[] = [];
  const events: AttendanceEvent[] = [];
  const sessions: WorkSession[] = [];

  const actorOf = (userId: ID) => {
    const u = USERS.find((x) => x.id === userId)!;
    return u.id;
  };

  function addShift(emp: Employee, date: ISODate, spec: ShiftSpec, createdBy = 'usr_javier'): PlannedShift {
    const start = at(date, spec.start);
    const endDate = spec.end <= spec.start ? addDays(date, 1) : date;
    const sh: PlannedShift = { id: nid('shf'), companyId: emp.companyId, employeeId: emp.id, worksiteId: spec.site, start, end: at(endDate, spec.end), timezone: TZ, date, status: 'planned', note: '', createdBy: actorOf(createdBy), createdAt: `${addDays(date, -14)}T09:00:00.000Z`, updatedAt: `${addDays(date, -14)}T09:00:00.000Z` };
    shifts.push(sh);
    return sh;
  }

  function addEvent(emp: Employee, sessionId: ID, type: EventType, atIso: ISOInstant, site: ID, opts: { source?: ClockSource; mode?: WorkMode; breakKind?: BreakKind | null; correctionId?: ID | null } = {}): AttendanceEvent {
    const id = nid('evt');
    const ev: AttendanceEvent = {
      id,
      companyId: emp.companyId,
      employeeId: emp.id,
      sessionId,
      type,
      at: atIso,
      receivedAt: addMin(atIso, 0.03 + rng() * 0.05),
      timezone: TZ,
      source: opts.source ?? (rng() < 0.6 ? 'mobile' : rng() < 0.5 ? 'web' : 'kiosk_pin'),
      worksiteId: site,
      mode: opts.mode ?? 'onsite',
      breakKind: opts.breakKind ?? null,
      idempotencyKey: `seed:${id}`,
      receipt: receiptFor(id),
      recordedBy: emp.userId ?? 'usr_javier',
      correctionId: opts.correctionId ?? null,
    };
    events.push(ev);
    return ev;
  }

  /** Creates a session with its events. `end` null = open session. */
  function addSession(emp: Employee, start: ISOInstant, end: ISOInstant | null, site: ID, breaks: { kind: BreakKind; start: ISOInstant; end: ISOInstant | null }[] = [], opts: { source?: ClockSource; mode?: WorkMode; origin?: WorkSession['origin']; correctionId?: ID | null } = {}): WorkSession {
    const id = nid('ses');
    const evOpts = { source: opts.source, mode: opts.mode, correctionId: opts.correctionId };
    const startEv = addEvent(emp, id, 'clock_in', start, site, evOpts);
    const brs = breaks
      .filter((b) => !end || b.start < end)
      .filter((b) => b.start <= nowIso)
      .map((b) => {
        const s = addEvent(emp, id, 'break_start', b.start, site, { ...evOpts, breakKind: b.kind });
        const e = b.end && b.end <= nowIso ? addEvent(emp, id, 'break_end', b.end, site, { ...evOpts, breakKind: b.kind }) : null;
        return { id: nid('brk'), startEventId: s.id, endEventId: e?.id ?? null, kind: b.kind };
      });
    const endEv = end ? addEvent(emp, id, 'clock_out', end, site, evOpts) : null;
    const s: WorkSession = { id, companyId: emp.companyId, employeeId: emp.id, worksiteId: site, timezone: TZ, mode: opts.mode ?? 'onsite', date: localDate(start, TZ), startEventId: startEv.id, endEventId: endEv?.id ?? null, breaks: brs, correctionIds: [], origin: opts.origin ?? 'clocked', createdAt: start, updatedAt: end ?? start };
    sessions.push(s);
    return s;
  }

  // ─── Absences first (they shape the generated attendance) ───
  const absences: AbsenceRequest[] = [];
  const mkAbs = (empId: ID, typeId: ID, start: ISODate, end: ISODate, status: AbsenceRequest['status'], extra: Partial<AbsenceRequest> = {}): AbsenceRequest => {
    const emp = empById.get(empId)!;
    const submittedAt = status === 'draft' ? null : `${addDays(start < T ? start : T, -12)}T08:15:00.000Z`;
    const a: AbsenceRequest = { id: nid('abs'), companyId: emp.companyId, employeeId: empId, typeId, startDate: start, endDate: end, partial: null, note: '', attachmentIds: [], status, submittedAt, createdBy: emp.userId ?? 'usr_javier', createdAt: submittedAt ?? `${addDays(T, -1)}T18:00:00.000Z`, updatedAt: submittedAt ?? `${addDays(T, -1)}T18:00:00.000Z`, reviewerId: null, decidedAt: null, decisionReason: null, acknowledgedConflicts: [], history: [], ...extra };
    absences.push(a);
    return a;
  };
  const decided = (_reviewer: ID, daysBeforeStart: number, start: ISODate) => `${addDays(start < T ? start : T, -daysBeforeStart)}T11:20:00.000Z`;

  const pabloVacStart = wdAfter(8);
  const vacPablo = mkAbs('emp_pablo', 'abt_vac', pabloVacStart, addDays(pabloVacStart, 4), 'approved', { note: 'Vacaciones de otoño.', reviewerId: 'usr_elena', decidedAt: decided('usr_elena', 9, pabloVacStart) });
  const elenaVacStart = wdAfter(14);
  const vacElena = mkAbs('emp_elena', 'abt_vac', elenaVacStart, addDays(elenaVacStart, 4), 'pending', { note: 'Semana de vacaciones.' });
  const luciaAp = wdAfter(3);
  mkAbs('emp_lucia', 'abt_ap', luciaAp, luciaAp, 'pending', { note: 'Gestión personal.' });
  const rocioMud = wdBefore(6);
  mkAbs('emp_rocio', 'abt_mud', rocioMud, rocioMud, 'approved', { note: 'Cambio de domicilio.', reviewerId: 'usr_amparo', decidedAt: decided('usr_amparo', 5, rocioMud) });
  const sergioIt = wdBefore(16);
  mkAbs('emp_sergio', 'abt_it', sergioIt, addDays(sergioIt, 3), 'approved', { submittedAt: `${sergioIt}T07:40:00.000Z`, createdBy: 'usr_sergio', createdAt: `${sergioIt}T07:40:00.000Z`, reviewerId: null, decidedAt: `${sergioIt}T07:40:00.000Z`, decisionReason: 'Registrada: la baja médica no requiere aprobación.' });
  const fatimaVac = wdAfter(10);
  mkAbs('emp_fatima', 'abt_vac', fatimaVac, addDays(fatimaVac, 2), 'rejected', { note: 'Viaje familiar.', reviewerId: 'usr_amparo', decidedAt: `${addDays(T, -2)}T12:05:00.000Z`, decisionReason: 'Coincide con la limpieza general del colegio antes de la inspección; proponga otra semana.' });
  const andresWd = wdAfter(5);
  mkAbs('emp_andres', 'abt_pnr', andresWd, andresWd, 'withdrawn', { note: 'Gestión de herencia.', decisionReason: null });
  const carmenVac = wdAfter(20);
  mkAbs('emp_carmen', 'abt_vac', carmenVac, addDays(carmenVac, 4), 'cancel_requested', { note: 'Vacaciones.', reviewerId: 'usr_amparo', decidedAt: `${addDays(T, -15)}T10:00:00.000Z` });
  const raulPnr = wdBefore(9);
  mkAbs('emp_raul', 'abt_pnr', raulPnr, raulPnr, 'approved', { note: 'Asunto familiar acordado con la empresa.', reviewerId: 'usr_elena', decidedAt: decided('usr_elena', 4, raulPnr) });
  mkAbs('emp_daniela', 'abt_vac', wdAfter(25), addDays(wdAfter(25), 6), 'draft', { note: '' });
  const martaDeb = wdAfter(2);
  mkAbs('emp_marta', 'abt_deber', martaDeb, martaDeb, 'pending', { partial: { startTime: '10:00', endTime: '12:00' }, note: 'Citación en el juzgado como testigo.' });
  // Deliberate conflict: approved vacation while a planned shift still exists (Incidencias).
  const oscarVac = wdAfter(4);
  mkAbs('emp_oscar', 'abt_vac', oscarVac, oscarVac, 'approved', { note: 'Día de vacaciones.', reviewerId: 'usr_elena', decidedAt: `${addDays(T, -6)}T09:30:00.000Z` });

  const finalHistory = (a: AbsenceRequest) => {
    const h: AbsenceRequest['history'] = [];
    if (a.submittedAt) h.push({ at: a.submittedAt, by: a.createdBy, action: a.typeId === 'abt_it' ? 'registered' : 'submitted', note: null });
    if (a.status === 'approved' && a.reviewerId) h.push({ at: a.decidedAt!, by: a.reviewerId, action: 'approved', note: a.decisionReason });
    if (a.status === 'rejected') h.push({ at: a.decidedAt!, by: a.reviewerId!, action: 'rejected', note: a.decisionReason });
    if (a.status === 'withdrawn') h.push({ at: `${addDays(T, -1)}T17:30:00.000Z`, by: a.createdBy, action: 'withdrawn', note: 'Ya no es necesaria.' });
    if (a.status === 'cancel_requested') {
      h.push({ at: a.decidedAt!, by: a.reviewerId!, action: 'approved', note: null });
      h.push({ at: `${addDays(T, -1)}T09:10:00.000Z`, by: 'usr_javier', action: 'cancel_requested', note: 'La empleada pide trasladar las vacaciones a diciembre (comunicado a RR. HH.).' });
    }
    a.history = h;
  };
  absences.forEach(finalHistory);

  const absentFullDay = (empId: ID, d: ISODate) => absences.some((a) => a.employeeId === empId && !a.partial && (a.status === 'approved' || a.status === 'cancel_requested') && d >= a.startDate && d <= a.endDate);

  // ─── Shifts and actual sessions, T-35 … T+21 ───
  const from = addDays(T, -35);
  const to = addDays(T, 21);
  const skipSession = new Set<string>(); // `${empId}:${date}` handled by scenarios
  const scenarioDates = {
    pabloMissing: wdBefore(1),
    ivanMissing: wdBefore(3),
    sergioNight: wdBefore(5),
    sergioLong: wdBefore(11),
    raulOverlap: wdBefore(7),
    oscarDuplicate: wdBefore(4),
    danielaShort: wdBefore(8),
    rocioCorrected: wdBefore(10),
    carmenRejected: wdBefore(12),
    andresProposed: wdBefore(6),
    josemiDisagree: wdBefore(25),
    nereaWithdrawn: (() => { let n = 13; while (![0, 2, 4].includes(weekday(wdBefore(n)))) n++; return wdBefore(n); })(),
    fatimaFailed: wdBefore(2),
    luciaFailed: wdBefore(1),
  };
  for (const [k, d] of Object.entries(scenarioDates)) {
    const emp = k.replace(/[A-Z].*$/, '');
    skipSession.add(`emp_${emp === 'josemi' ? 'josemi' : emp}:${d}`);
  }

  for (const spec of EMPLOYEES) {
    const emp = empById.get(spec.e.id)!;
    const calId = WORKSITES.find((w) => w.id === emp.primaryWorksiteId)!.calendarId;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (d < emp.hireDate || (emp.endDate && d > emp.endDate)) continue;
      if (isHoliday(calId, d) && !spec.worksHolidays) continue;
      const specs = spec.week(weekday(d), d);
      if (!specs.length) continue;
      const fullDayOff = absentFullDay(emp.id, d);
      // Shifts on approved leave days are cancelled by the planner, except the deliberate conflict.
      const keepConflict = emp.id === 'emp_oscar' && d === oscarVac;
      if (fullDayOff && !keepConflict) continue;
      for (const sp of specs) {
        const sh = addShift(emp, d, sp, emp.departmentId === 'dep_limp' ? 'usr_amparo' : emp.departmentId === 'dep_mant' ? 'usr_elena' : 'usr_javier');
        if (d > T || fullDayOff) continue;
        if (skipSession.has(`${emp.id}:${d}`)) continue;
        // Actual time: what really happened, with natural variation. Never copied from the plan.
        const start = addMin(sh.start, jitter(7));
        if (start > nowIso) continue;
        let end: ISOInstant | null = addMin(sh.end, jitter(9) + (rng() < 0.12 ? 25 + Math.round(rng() * 30) : 0));
        if (end > nowIso) end = null;
        const remote = spec.remoteDays?.includes(weekday(d)) ?? false;
        const brs = (sp.breaks ?? [])
          .filter(() => rng() > 0.12) // sometimes no break is recorded → review indicator
          .map((b) => {
            const bs = addMin(at(d, b.at), jitter(10));
            return { kind: b.kind, start: bs, end: addMin(bs, b.minutes + jitter(4)) };
          });
        addSession(emp, start, end, sp.site, brs, { mode: remote ? 'remote' : 'onsite', source: remote ? 'web' : undefined });
      }
    }
  }

  // ─── Scenario sessions ───
  const E = (id: ID) => empById.get(id)!;
  // AC-TIM-01: Pablo forgot to clock out → incomplete session + pending correction.
  const pabloSes = addSession(E('emp_pablo'), at(scenarioDates.pabloMissing, '07:28'), null, 'ws_torre', [{ kind: 'rest', start: at(scenarioDates.pabloMissing, '10:31'), end: at(scenarioDates.pabloMissing, '10:52') }]);
  // Iván: missing clock-out without any correction yet.
  addSession(E('emp_ivan'), at(scenarioDates.ivanMissing, '07:33'), null, 'ws_horta');
  // Sergio: overnight emergency intervention (planned) crossing midnight.
  const nightDate = scenarioDates.sergioNight;
  addShift(E('emp_sergio'), nightDate, { start: '22:00', end: '06:00', site: 'ws_horta' }, 'usr_elena');
  addSession(E('emp_sergio'), at(addDays(nightDate, 0), '07:31'), at(nightDate, '15:34'), 'ws_marblau', [{ kind: 'rest', start: at(nightDate, '10:30'), end: at(nightDate, '10:50') }]);
  addSession(E('emp_sergio'), at(nightDate, '22:04'), at(addDays(nightDate, 1), '06:07'), 'ws_horta', [{ kind: 'meal', start: at(addDays(nightDate, 1), '02:00'), end: at(addDays(nightDate, 1), '02:30') }]);
  // Sergio: unusually long day (boiler breakdown at the hotel).
  addSession(E('emp_sergio'), at(scenarioDates.sergioLong, '07:25'), at(scenarioDates.sergioLong, '19:05'), 'ws_marblau', [{ kind: 'rest', start: at(scenarioDates.sergioLong, '10:40'), end: at(scenarioDates.sergioLong, '11:00') }, { kind: 'meal', start: at(scenarioDates.sergioLong, '14:00'), end: at(scenarioDates.sergioLong, '14:30') }]);
  // Raúl: overlapping sessions (kiosk at the site + mobile app) → review.
  addSession(E('emp_raul'), at(scenarioDates.raulOverlap, '07:29'), at(scenarioDates.raulOverlap, '15:32'), 'ws_torre', [], { source: 'kiosk_pin' });
  addSession(E('emp_raul'), at(scenarioDates.raulOverlap, '15:05'), at(scenarioDates.raulOverlap, '17:10'), 'ws_dental', [], { source: 'mobile' });
  // Óscar: duplicate clock-in imported from a terminal (double tap).
  {
    const s = addSession(E('emp_oscar'), at(scenarioDates.oscarDuplicate, '07:27'), at(scenarioDates.oscarDuplicate, '15:31'), 'ws_dental', [], { source: 'import' });
    addEvent(E('emp_oscar'), s.id, 'clock_in', addMin(at(scenarioDates.oscarDuplicate, '07:27'), 1), 'ws_dental', { source: 'import' });
  }
  // Daniela: 3-minute session (clocked in and out by mistake) + her real afternoon session.
  addSession(E('emp_daniela'), at(scenarioDates.danielaShort, '13:52'), at(scenarioDates.danielaShort, '13:55'), 'ws_marblau');
  addSession(E('emp_daniela'), at(scenarioDates.danielaShort, '14:02'), at(scenarioDates.danielaShort, '20:04'), 'ws_marblau', [{ kind: 'rest', start: at(scenarioDates.danielaShort, '17:00'), end: at(scenarioDates.danielaShort, '17:15') }]);
  // Rocío: wrong clock-out time, corrected and approved (original preserved).
  const rocioSes = addSession(E('emp_rocio'), at(scenarioDates.rocioCorrected, '08:58'), at(scenarioDates.rocioCorrected, '12:10'), 'ws_marblau');
  // Carmen: correction rejected with reason.
  const carmenSes = addSession(E('emp_carmen'), at(scenarioDates.carmenRejected, '07:05'), at(scenarioDates.carmenRejected, '15:02'), 'ws_marblau', [{ kind: 'rest', start: at(scenarioDates.carmenRejected, '10:05'), end: at(scenarioDates.carmenRejected, '10:20') }]);
  // Andrés: company proposes adding a missing break → awaits the employee's agreement.
  const andresSes = addSession(E('emp_andres'), at(scenarioDates.andresProposed, '07:30'), at(scenarioDates.andresProposed, '15:35'), 'ws_colegio');
  // José Miguel: older correction applied with the employee's recorded disagreement.
  const josemiSes = addSession(E('emp_josemi'), at(scenarioDates.josemiDisagree, '05:58'), at(scenarioDates.josemiDisagree, '14:40'), 'ws_horta', [{ kind: 'rest', start: at(scenarioDates.josemiDisagree, '09:30'), end: at(scenarioDates.josemiDisagree, '09:45') }]);
  // Nerea: correction withdrawn by the employee.
  const nereaDate = scenarioDates.nereaWithdrawn;
  const nereaSes = addSession(E('emp_nerea'), at(nereaDate, '16:02'), at(nereaDate, '20:20'), 'ws_torre');
  // Fátima: connectivity failure at clock-in; she filed a correction to add the session.
  const fatimaFailed: FailedAttempt = { id: nid('fat'), companyId: 'cmp_levante', employeeId: 'emp_fatima', action: 'clock_in', attemptedAt: at(scenarioDates.fatimaFailed, '15:01'), worksiteId: 'ws_colegio', reason: 'Sin conexión con el servidor (simulación).', correctionId: null };
  // Lucía: afternoon clock-in at the coworking failed; no correction filed yet ("No registrado").
  addSession(E('emp_lucia'), at(scenarioDates.luciaFailed, '07:02'), at(scenarioDates.luciaFailed, '09:01'), 'ws_dental');
  const luciaFailed: FailedAttempt = { id: nid('fat'), companyId: 'cmp_levante', employeeId: 'emp_lucia', action: 'clock_in', attemptedAt: at(scenarioDates.luciaFailed, '18:00'), worksiteId: 'ws_cowork', reason: 'Sin conexión con el servidor (simulación).', correctionId: null };
  // AC-TIM-02: overnight shift across the change to summer time (29/03/2026: 02:00 → 03:00).
  addShift(E('emp_sergio'), '2026-03-28', { start: '22:00', end: '06:00', site: 'ws_horta' }, 'usr_elena');
  addSession(E('emp_sergio'), at('2026-03-28', '22:00'), at('2026-03-29', '06:00'), 'ws_horta', [], { source: 'mobile' });
  // AC-TIM-04: a three-year-old record of a former employee (inside the four-year retention period).
  addShift(E('emp_teresa'), '2023-10-05', { start: '07:30', end: '11:30', site: 'ws_torre' }, 'usr_amparo');
  addSession(E('emp_teresa'), at('2023-10-05', '07:31'), at('2023-10-05', '11:33'), 'ws_torre', [], { source: 'kiosk_pin' });

  // ─── Corrections ───
  const corrections: CorrectionRequest[] = [];
  const snapshot = (s: WorkSession): SessionValues => {
    const st = events.find((e) => e.id === s.startEventId)!;
    const en = s.endEventId ? events.find((e) => e.id === s.endEventId) : undefined;
    return {
      start: st.at,
      end: en?.at ?? null,
      breaks: s.breaks.map((b) => ({ start: events.find((e) => e.id === b.startEventId)!.at, end: b.endEventId ? events.find((e) => e.id === b.endEventId)!.at : null, kind: b.kind })),
      worksiteId: s.worksiteId,
      mode: s.mode,
    };
  };
  const mkCorr = (c: Omit<CorrectionRequest, 'id' | 'companyId' | 'history'> & { history?: CorrectionRequest['history'] }): CorrectionRequest => {
    const r: CorrectionRequest = { id: nid('cor'), companyId: 'cmp_levante', history: [], ...c };
    corrections.push(r);
    return r;
  };

  const pabloOrig = snapshot(pabloSes);
  mkCorr({ employeeId: 'emp_pablo', sessionId: pabloSes.id, failedAttemptId: null, date: pabloSes.date, kind: 'missing_clock_out', initiatedBy: 'employee', original: pabloOrig, requested: { ...pabloOrig, end: at(pabloSes.date, '15:34') }, approved: null, explanation: 'Terminé la revisión del grupo de presión en Torre Turia y olvidé fichar la salida. Salí a las 15:34 (lo confirma el parte de trabajo firmado por el administrador de la finca).', status: 'pending', requestedBy: 'usr_pablo', requestedAt: `${addDays(T, 0)}T06:45:00.000Z` > nowIso ? nowIso : `${T}T06:45:00.000Z`, reviewerId: null, decidedAt: null, decisionReason: null, employeeResponse: null, history: [{ at: `${T}T06:45:00.000Z` > nowIso ? nowIso : `${T}T06:45:00.000Z`, by: 'usr_pablo', action: 'requested', note: null }] });

  const rocioOrig = snapshot(rocioSes);
  const rocioReq = { ...rocioOrig, end: at(rocioSes.date, '14:05') };
  const rocioApp = { ...rocioOrig, end: at(rocioSes.date, '14:00') };
  const rocioCorr = mkCorr({ employeeId: 'emp_rocio', sessionId: rocioSes.id, failedAttemptId: null, date: rocioSes.date, kind: 'wrong_end', initiatedBy: 'employee', original: rocioOrig, requested: rocioReq, approved: rocioApp, explanation: 'Fiché la salida al bajar al almacén a las 12:10 y seguí trabajando en la planta 3 hasta las 14:05.', status: 'approved', requestedBy: 'usr_javier', requestedAt: `${addDays(rocioSes.date, 1)}T08:10:00.000Z`, reviewerId: 'usr_amparo', decidedAt: `${addDays(rocioSes.date, 1)}T12:40:00.000Z`, decisionReason: 'Confirmado con la gobernanta del hotel; la planta 3 se terminó a las 14:00, que es la hora aprobada.', employeeResponse: null, history: [{ at: `${addDays(rocioSes.date, 1)}T08:10:00.000Z`, by: 'usr_javier', action: 'requested', note: 'Registrada por RR. HH. a petición de la empleada (no tiene usuario en la aplicación).' }, { at: `${addDays(rocioSes.date, 1)}T12:40:00.000Z`, by: 'usr_amparo', action: 'approved', note: 'Aprobada con hora de salida 14:00.' }] });
  rocioSes.correctionIds.push(rocioCorr.id);

  const carmenOrig = snapshot(carmenSes);
  mkCorr({ employeeId: 'emp_carmen', sessionId: carmenSes.id, failedAttemptId: null, date: carmenSes.date, kind: 'wrong_start', initiatedBy: 'employee', original: carmenOrig, requested: { ...carmenOrig, start: at(carmenSes.date, '06:30') }, approved: null, explanation: 'Llegué antes para preparar el carro de limpieza.', status: 'rejected', requestedBy: 'usr_javier', requestedAt: `${addDays(carmenSes.date, 1)}T09:00:00.000Z`, reviewerId: 'usr_amparo', decidedAt: `${addDays(carmenSes.date, 2)}T10:15:00.000Z`, decisionReason: 'El control de acceso del hotel registra la llegada a las 07:02; se mantiene el registro original. Puede aportar más información en una nueva solicitud.', employeeResponse: null, history: [{ at: `${addDays(carmenSes.date, 1)}T09:00:00.000Z`, by: 'usr_javier', action: 'requested', note: null }, { at: `${addDays(carmenSes.date, 2)}T10:15:00.000Z`, by: 'usr_amparo', action: 'rejected', note: null }] });

  const andresOrig = snapshot(andresSes);
  mkCorr({ employeeId: 'emp_andres', sessionId: andresSes.id, failedAttemptId: null, date: andresSes.date, kind: 'missing_break', initiatedBy: 'company', original: andresOrig, requested: { ...andresOrig, breaks: [{ start: at(andresSes.date, '10:30'), end: at(andresSes.date, '10:50'), kind: 'rest' }] }, approved: null, explanation: 'El parte de trabajo del colegio indica una pausa de bocadillo de 10:30 a 10:50 que no se registró.', status: 'pending_employee', requestedBy: 'usr_javier', requestedAt: `${addDays(T, -2)}T09:30:00.000Z`, reviewerId: null, decidedAt: null, decisionReason: null, employeeResponse: null, history: [{ at: `${addDays(T, -2)}T09:30:00.000Z`, by: 'usr_javier', action: 'proposed', note: null }] });

  const josemiOrig = snapshot(josemiSes);
  const josemiApp = { ...josemiOrig, end: at(josemiSes.date, '14:05') };
  const josemiCorr = mkCorr({ employeeId: 'emp_josemi', sessionId: josemiSes.id, failedAttemptId: null, date: josemiSes.date, kind: 'wrong_end', initiatedBy: 'company', original: josemiOrig, requested: josemiApp, approved: josemiApp, explanation: 'El supermercado cerró la zona de limpieza a las 14:05; la salida registrada a las 14:40 corresponde a la recogida de material personal.', status: 'applied_with_disagreement', requestedBy: 'usr_javier', requestedAt: `${addDays(josemiSes.date, 1)}T09:00:00.000Z`, reviewerId: 'usr_javier', decidedAt: `${addDays(josemiSes.date, 3)}T09:00:00.000Z`, decisionReason: 'Se aplica la corrección. Se ha informado al delegado de personal de la discrepancia.', employeeResponse: { at: `${addDays(josemiSes.date, 2)}T08:00:00.000Z`, agreed: false, comment: 'Estuve ordenando el almacén del cliente hasta las 14:40 por indicación del encargado de tienda.' }, history: [{ at: `${addDays(josemiSes.date, 1)}T09:00:00.000Z`, by: 'usr_javier', action: 'proposed', note: null }, { at: `${addDays(josemiSes.date, 2)}T08:00:00.000Z`, by: 'usr_javier', action: 'employee_disagreed', note: 'Respuesta recogida por RR. HH. en presencia del empleado.' }, { at: `${addDays(josemiSes.date, 3)}T09:00:00.000Z`, by: 'usr_javier', action: 'applied_with_disagreement', note: 'Delegado de personal informado.' }] });
  josemiSes.correctionIds.push(josemiCorr.id);

  const nereaOrig = snapshot(nereaSes);
  mkCorr({ employeeId: 'emp_nerea', sessionId: nereaSes.id, failedAttemptId: null, date: nereaSes.date, kind: 'wrong_end', initiatedBy: 'employee', original: nereaOrig, requested: { ...nereaOrig, end: at(nereaSes.date, '21:00') }, approved: null, explanation: 'Creo que salí a las 21:00.', status: 'withdrawn', requestedBy: 'usr_javier', requestedAt: `${addDays(nereaSes.date, 1)}T10:00:00.000Z`, reviewerId: null, decidedAt: `${addDays(nereaSes.date, 1)}T16:00:00.000Z`, decisionReason: null, employeeResponse: null, history: [{ at: `${addDays(nereaSes.date, 1)}T10:00:00.000Z`, by: 'usr_javier', action: 'requested', note: null }, { at: `${addDays(nereaSes.date, 1)}T16:00:00.000Z`, by: 'usr_javier', action: 'withdrawn', note: 'La empleada confirma que la hora registrada (20:20) es correcta.' }] });

  const fatimaCorr = mkCorr({ employeeId: 'emp_fatima', sessionId: null, failedAttemptId: fatimaFailed.id, date: scenarioDates.fatimaFailed, kind: 'connectivity', initiatedBy: 'employee', original: null, requested: { start: at(scenarioDates.fatimaFailed, '15:01'), end: at(scenarioDates.fatimaFailed, '19:03'), breaks: [], worksiteId: 'ws_colegio', mode: 'onsite' }, approved: null, explanation: 'La aplicación mostró «No registrado» al fichar la entrada en el colegio (sin cobertura en el sótano). Trabajé de 15:01 a 19:03.', status: 'pending', requestedBy: 'usr_javier', requestedAt: `${addDays(scenarioDates.fatimaFailed, 1)}T07:30:00.000Z` > nowIso ? nowIso : `${addDays(scenarioDates.fatimaFailed, 1)}T07:30:00.000Z`, reviewerId: null, decidedAt: null, decisionReason: null, employeeResponse: null, history: [] });
  fatimaCorr.history = [{ at: fatimaCorr.requestedAt, by: 'usr_javier', action: 'requested', note: 'Registrada por RR. HH. a petición de la empleada.' }];
  fatimaFailed.correctionId = fatimaCorr.id;

  // ─── Reporting periods ───
  const curPeriod = periodOf(T);
  const prevPeriod = periodOf(addMonths(startOfMonth(T), -1));
  const prev2Period = periodOf(addMonths(startOfMonth(T), -2));
  const periods: ReportingPeriod[] = [
    { id: nid('per'), companyId: 'cmp_levante', period: prev2Period, status: 'closed', closedBy: 'usr_javier', closedAt: `${addMonths(startOfMonth(T), -1)}T09:00:00.000Z`, openExceptionsAtClose: 0, closeNote: 'Sin incidencias abiertas.', reopenedBy: null, reopenedAt: null, reopenReason: null, history: [{ at: `${addMonths(startOfMonth(T), -1)}T09:00:00.000Z`, by: 'usr_javier', action: 'closed', note: null }] },
    { id: nid('per'), companyId: 'cmp_levante', period: prevPeriod, status: 'closed', closedBy: 'usr_javier', closedAt: `${startOfMonth(T)}T10:30:00.000Z`, openExceptionsAtClose: 2, closeNote: 'Se entrega a la asesoría con 2 incidencias abiertas declaradas (corrección con discrepancia y sesión sin turno planificado).', reopenedBy: null, reopenedAt: null, reopenReason: null, history: [{ at: `${startOfMonth(T)}T10:30:00.000Z`, by: 'usr_javier', action: 'closed', note: 'Cierre con incidencias declaradas.' }] },
    { id: nid('per'), companyId: 'cmp_levante', period: curPeriod, status: 'open', closedBy: null, closedAt: null, openExceptionsAtClose: 0, closeNote: null, reopenedBy: null, reopenedAt: null, reopenReason: null, history: [] },
    { id: nid('per'), companyId: 'cmp_ibaigane', period: curPeriod, status: 'open', closedBy: null, closedAt: null, openExceptionsAtClose: 0, closeNote: null, reopenedBy: null, reopenedAt: null, reopenReason: null, history: [] },
  ];

  // ─── Anomaly reviews (some already acknowledged / under investigation) ───
  const anomalyReviews: AnomalyReview[] = [];
  const raulOverlapSessions = sessions.filter((s) => s.employeeId === 'emp_raul' && s.date === scenarioDates.raulOverlap);
  if (raulOverlapSessions.length >= 2) {
    const [a, b] = raulOverlapSessions.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    anomalyReviews.push({ id: nid('anr'), companyId: 'cmp_levante', key: `ovl:${a.id}:${b.id}`, snapshot: null, assigneeId: 'usr_elena', status: 'investigating', history: [{ at: `${addDays(scenarioDates.raulOverlap, 1)}T08:00:00.000Z`, by: 'usr_elena', action: 'assigned', note: 'Asignada a Elena Navarro.' }, { at: `${addDays(scenarioDates.raulOverlap, 1)}T08:05:00.000Z`, by: 'usr_elena', action: 'investigating', note: 'Comprobando si el terminal de Torre Turia y la app registraron la misma salida.' }], resolution: null, updatedAt: `${addDays(scenarioDates.raulOverlap, 1)}T08:05:00.000Z` });
  }

  // ─── Notifications ───
  const notifications = [
    { id: nid('ntf'), companyId: 'cmp_levante', type: 'correction_pending', title: 'Corrección pendiente de revisión', body: 'Pablo Ruiz Esteve ha solicitado corregir una salida.', recipientUserIds: ['usr_elena'], link: `/correcciones/${corrections[0].id}`, createdAt: corrections[0].requestedAt, readBy: [], dedupeKey: `corr:${corrections[0].id}` },
    { id: nid('ntf'), companyId: 'cmp_levante', type: 'correction_proposed', title: 'La empresa propone corregir su registro', body: 'Revise la propuesta y dé su conformidad o deje constancia de su discrepancia.', recipientUserIds: ['usr_andres'], link: '/correcciones', createdAt: `${addDays(T, -2)}T09:30:00.000Z`, readBy: [], dedupeKey: 'corr-proposed-andres' },
    { id: nid('ntf'), companyId: 'cmp_levante', type: 'absence_pending', title: 'Ausencia pendiente de revisión', body: 'Hay una solicitud de vacaciones de su equipo.', recipientUserIds: ['usr_javier'], link: `/ausencias/${vacElena.id}`, createdAt: vacElena.submittedAt!, readBy: [], dedupeKey: `abs:${vacElena.id}` },
    { id: nid('ntf'), companyId: 'cmp_levante', type: 'absence_decided', title: 'Su solicitud de vacaciones se ha aprobado', body: 'Consulte el detalle de la decisión.', recipientUserIds: ['usr_pablo'], link: `/ausencias/${vacPablo.id}`, createdAt: vacPablo.decidedAt!, readBy: [], dedupeKey: `absd:${vacPablo.id}` },
  ];

  // ─── Audit trail ───
  const audit: AuditEvent[] = [];
  const userName = (id: ID) => USERS.find((u) => u.id === id)?.name ?? id;
  const memRoles = (userId: ID, companyId: ID) => memberships().find((m) => m.userId === userId && m.companyId === companyId)?.roles ?? [];
  const actor = (userId: ID, companyId = 'cmp_levante'): Actor => ({ userId, name: userName(userId), roles: memRoles(userId, companyId) });
  const pending: { companyId: ID; at: ISOInstant; actor: Actor; action: string; entityType: string; entityId: ID; entityLabel: string; employeeId: ID | null; summary: string; reason: string | null }[] = [];
  const empName = (id: ID) => {
    const e = empById.get(id)!;
    return `${e.firstName} ${e.lastName}`;
  };
  for (const c of COMPANIES) {
    const count = events.filter((e) => e.companyId === c.id).length;
    pending.push({ companyId: c.id, at: addMin(nowIso, -1), actor: actor(c.id === 'cmp_levante' ? 'usr_javier' : 'usr_iker', c.id), action: 'demo.seed', entityType: 'company', entityId: c.id, entityLabel: c.tradeName, employeeId: null, summary: `Histórico de demostración cargado: ${count} eventos de fichaje con su recibo.`, reason: null });
  }
  for (const p of buildPolicies(T)) {
    pending.push({ companyId: p.companyId, at: p.editedAt, actor: actor(p.editedBy, p.companyId), action: 'policy.version', entityType: 'policy', entityId: p.id, entityLabel: `${p.name} v${p.version}`, employeeId: null, summary: `Versión ${p.version} en vigor desde ${p.effectiveFrom}.`, reason: p.changeReason });
  }
  for (const a of absences) {
    for (const h of a.history) {
      const action = h.action === 'submitted' ? 'absence.submit' : h.action === 'registered' ? 'absence.submit' : h.action === 'approved' ? 'absence.approve' : h.action === 'rejected' ? 'absence.reject' : h.action === 'withdrawn' ? 'absence.withdraw' : 'absence.cancel_request';
      pending.push({ companyId: a.companyId, at: h.at, actor: actor(h.by), action, entityType: 'absence', entityId: a.id, entityLabel: empName(a.employeeId), employeeId: a.employeeId, summary: `${action === 'absence.submit' ? 'Solicitud enviada' : action === 'absence.approve' ? 'Aprobada' : action === 'absence.reject' ? 'Rechazada' : action === 'absence.withdraw' ? 'Retirada' : 'Cancelación solicitada'} · ${a.startDate} → ${a.endDate}.`, reason: h.note });
    }
  }
  for (const c of corrections) {
    for (const h of c.history) {
      const action = h.action === 'requested' ? 'correction.request' : h.action === 'proposed' ? 'correction.propose' : h.action === 'approved' ? 'correction.approve' : h.action === 'rejected' ? 'correction.reject' : h.action === 'withdrawn' ? 'correction.withdraw' : h.action === 'employee_disagreed' ? 'correction.employee_response' : 'correction.approve';
      pending.push({ companyId: c.companyId, at: h.at, actor: actor(h.by), action, entityType: 'correction', entityId: c.id, entityLabel: empName(c.employeeId), employeeId: c.employeeId, summary: `Corrección del ${c.date}: ${action === 'correction.request' ? 'solicitada' : action === 'correction.propose' ? 'propuesta por la empresa' : action === 'correction.approve' ? 'aplicada; el registro original se conserva' : action === 'correction.reject' ? 'rechazada' : action === 'correction.withdraw' ? 'retirada' : 'el empleado manifiesta su discrepancia'}.`, reason: h.note });
    }
  }
  for (const p of periods.filter((x) => x.status === 'closed')) {
    pending.push({ companyId: p.companyId, at: p.closedAt!, actor: actor(p.closedBy!), action: 'period.close', entityType: 'period', entityId: p.id, entityLabel: p.period, employeeId: null, summary: `Periodo ${p.period} cerrado con ${p.openExceptionsAtClose} incidencias abiertas declaradas.`, reason: p.closeNote });
  }
  const lastEvents = events.filter((e) => e.at >= `${addDays(T, -2)}T00:00:00.000Z` && e.at <= nowIso).sort((a, b) => a.at.localeCompare(b.at));
  for (const e of lastEvents) {
    const emp = empById.get(e.employeeId)!;
    pending.push({ companyId: e.companyId, at: e.receivedAt, actor: actor(emp.userId ?? 'usr_javier', e.companyId), action: `time.${e.type}`, entityType: 'event', entityId: e.id, entityLabel: empName(e.employeeId), employeeId: e.employeeId, summary: `Recibo ${e.receipt}.`, reason: null });
  }
  pending.push({ companyId: 'cmp_levante', at: fatimaFailed.attemptedAt, actor: actor('usr_javier'), action: 'time.not_recorded', entityType: 'failed_attempt', entityId: fatimaFailed.id, entityLabel: empName('emp_fatima'), employeeId: 'emp_fatima', summary: 'Intento de entrada no registrado (fallo de conexión simulado).', reason: null });
  pending.push({ companyId: 'cmp_levante', at: luciaFailed.attemptedAt, actor: actor('usr_lucia'), action: 'time.not_recorded', entityType: 'failed_attempt', entityId: luciaFailed.id, entityLabel: empName('emp_lucia'), employeeId: 'emp_lucia', summary: 'Intento de entrada no registrado (fallo de conexión simulado).', reason: null });
  pending.sort((a, b) => a.at.localeCompare(b.at));
  for (const p of pending.filter((x) => x.at <= nowIso)) {
    let prev: AuditEvent | undefined;
    for (let i = audit.length - 1; i >= 0; i--) if (audit[i].companyId === p.companyId) {
      prev = audit[i];
      break;
    }
    audit.push(chainAuditEvent(prev, { id: nid('aud'), ...p, changes: [] }));
  }

  const failedAttempts = [fatimaFailed, luciaFailed];

  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: nowIso,
    companies: COMPANIES,
    departments: DEPARTMENTS,
    worksites: WORKSITES,
    users: USERS,
    memberships: memberships(),
    employees,
    relationships,
    agreements: AGREEMENTS,
    policies: buildPolicies(T),
    calendars: CALENDARS,
    protocols: PROTOCOLS,
    shifts,
    events,
    sessions,
    failedAttempts,
    corrections,
    absenceTypes: absenceTypes(),
    absences,
    attachments: [],
    anomalyReviews,
    periods,
    exports: [],
    notifications,
    retentionDecisions: [],
    audit,
  };
}
