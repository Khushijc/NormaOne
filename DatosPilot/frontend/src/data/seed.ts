/**
 * Deterministic demo dataset, built relative to an anchor date (today on first visit) so that
 * expiry, review and target dates are always "live". Everything here is FICTIONAL: people,
 * companies, customer sites and the prevention provider are invented for the demo.
 *
 * Shared identifiers with FacturaFlow and JornadaPulse: companies (cmp_levante, cmp_ibaigane),
 * users and employees. DatosPilot adds Marina Peris (EMP-019, PRL coordinator), the external
 * prevention-service users and the new customer site Residencia Nou Campus.
 *
 * The audit log is NOT pre-filled with invented events: the seed writes one "demo data loaded"
 * event per company; every later event comes from an actual action in the mock-up. Historical
 * facts (who reviewed what, when) live on the records themselves.
 */
import { chainAuditEvent } from '../domain/audit';
import { computeDelta } from '../domain/requirements';
import { addDays, addMonths, at, today } from '../domain/time';
import type {
  Acknowledgement,
  ActionNote,
  AssignmentChange,
  CaeCase,
  CaeExchange,
  Company,
  CompanySettings,
  CustomerOrganisation,
  Database,
  Department,
  DocStatus,
  DocumentCategory,
  DocumentVersion,
  Employee,
  EmployeeAssignment,
  EquipmentIssue,
  EquipmentItem,
  EvidenceDocument,
  EvidenceRequest,
  HealthConclusion,
  HealthOffer,
  ID,
  ISODate,
  JobRole,
  Membership,
  PreventionProvider,
  PreventiveAction,
  RequirementScope,
  RequirementTemplate,
  RequirementVersion,
  RiskAssessment,
  RiskTag,
  TrainingAssignment,
  TrainingCourse,
  User,
  Worksite,
  AppNotification,
  AuditEvent,
} from '../domain/types';

const TZ = 'Europe/Madrid';
const LEV = 'cmp_levante';
const IBA = 'cmp_ibaigane';

// ─────────────────────────────── Reference data ───────────────────────────────

const COMPANIES: Company[] = [
  {
    id: LEV,
    legalName: 'Mantenimientos Levante, S.L.',
    tradeName: 'Mantenimientos Levante',
    nif: 'B97482152',
    timezone: TZ,
    province: 'Valencia',
    employeeCount: 19,
    activity: 'Mantenimiento integral y limpieza de edificios e instalaciones',
    preventionModality: ['spa', 'designated_workers'],
    preventionNote: 'Concierto con un servicio de prevención ajeno para las cuatro especialidades; una trabajadora designada coordina la gestión diaria. Modalidad registrada por la empresa; no la decide la aplicación.',
    hasPreventionDelegates: true,
  },
  {
    id: IBA,
    legalName: 'Instalaciones Ibaigane, S.L.',
    tradeName: 'Ibaigane Instalaciones',
    nif: 'B95326070',
    timezone: TZ,
    province: 'Bizkaia',
    employeeCount: 9,
    activity: 'Instalaciones eléctricas y de climatización',
    preventionModality: ['spa'],
    preventionNote: 'Concierto con un servicio de prevención ajeno.',
    hasPreventionDelegates: false,
  },
];

const DEPARTMENTS: Department[] = [
  { id: 'dep_adm', companyId: LEV, name: 'Administración' },
  { id: 'dep_mant', companyId: LEV, name: 'Mantenimiento técnico' },
  { id: 'dep_limp', companyId: LEV, name: 'Limpieza' },
  { id: 'dep_iba', companyId: IBA, name: 'Instalaciones' },
];

const USERS: User[] = [
  { id: 'usr_laura', name: 'Laura Martín Soler', email: 'laura.martin@mantenimientoslevante.example', title: 'Gerente y socia', organisation: null },
  { id: 'usr_javier', name: 'Javier Ortega Pons', email: 'javier.ortega@mantenimientoslevante.example', title: 'Administración y RR. HH.', organisation: null },
  { id: 'usr_marina', name: 'Marina Peris Climent', email: 'marina.peris@mantenimientoslevante.example', title: 'Coordinadora de PRL (trabajadora designada)', organisation: null },
  { id: 'usr_elena', name: 'Elena Navarro Gil', email: 'elena.navarro@mantenimientoslevante.example', title: 'Jefa de equipo técnico', organisation: null },
  { id: 'usr_amparo', name: 'Amparo Ribes Bosch', email: 'amparo.ribes@mantenimientoslevante.example', title: 'Encargada de limpieza', organisation: null },
  { id: 'usr_pablo', name: 'Pablo Ruiz Esteve', email: 'pablo.ruiz@mantenimientoslevante.example', title: 'Técnico de mantenimiento', organisation: null },
  { id: 'usr_sergio', name: 'Sergio Llopis Mora', email: 'sergio.llopis@mantenimientoslevante.example', title: 'Técnico de instalaciones', organisation: null },
  { id: 'usr_lucia', name: 'Lucía Martínez Peiró', email: 'lucia.martinez@mantenimientoslevante.example', title: 'Limpiadora (tiempo parcial)', organisation: null },
  { id: 'usr_andres', name: 'Andrés Ferrer Moll', email: 'andres.ferrer@mantenimientoslevante.example', title: 'Técnico y delegado de prevención', organisation: null },
  { id: 'usr_jorge', name: 'Jorge Sanz Albert', email: 'jorge.sanz@prevencionalbufera.example', title: 'Técnico superior en PRL', organisation: 'Prevención Albufera, S.L. (SPA)' },
  { id: 'usr_clara', name: 'Clara Ivars Monzó', email: 'clara.ivars@prevencionalbufera.example', title: 'Médica del trabajo', organisation: 'Prevención Albufera, S.L. (SPA)' },
  { id: 'usr_ramon', name: 'Ramón Gil Ortiz', email: 'ramon.gil@prevencionesanteriores.example', title: 'Técnico de PRL (concierto finalizado)', organisation: 'Prevenciones Anteriores, S.L.' },
  { id: 'usr_iker', name: 'Iker Etxeberria Uriarte', email: 'iker@ibaigane.example', title: 'Gerente', organisation: null },
  { id: 'usr_ane', name: 'Ane Zubizarreta Goikoetxea', email: 'ane@ibaigane.example', title: 'Técnica de climatización', organisation: null },
];

const RISK_TAGS: [string, string, boolean][] = [
  ['altura', 'Trabajos en altura (escaleras y plataformas)', false],
  ['electrico_bt', 'Riesgo eléctrico en baja tensión', false],
  ['herramientas', 'Herramientas manuales y portátiles', false],
  ['manipulacion_cargas', 'Manipulación manual de cargas', false],
  ['quimicos_limpieza', 'Productos químicos de limpieza', false],
  ['caidas_mismo_nivel', 'Caídas al mismo nivel (suelos mojados)', false],
  ['pvd', 'Pantallas de visualización de datos', false],
  ['gases_fluorados', 'Equipos con gases fluorados', false],
  ['trafico_interno', 'Tráfico de vehículos en el centro (carga y descarga)', false],
  ['riesgo_biologico', 'Riesgo biológico (residuos sanitarios)', false],
  ['cocina_industrial', 'Cocinas industriales (superficies calientes)', false],
  ['menores', 'Trabajo en centros con menores', false],
  ['espacio_confinado', 'Espacios confinados (fuera del alcance inicial)', true],
  ['obra_construccion', 'Obras de construcción, RD 1627/1997 (fuera del alcance inicial)', true],
];

const JOB_ROLES: JobRole[] = [
  { id: 'jr_admin', companyId: LEV, name: 'Administrativo/a', departmentId: 'dep_adm', tasks: 'Gestión administrativa y atención telefónica en oficina.', riskTags: ['pvd'], active: true },
  { id: 'jr_coord', companyId: LEV, name: 'Coordinación de PRL y administración', departmentId: 'dep_adm', tasks: 'Coordinación preventiva interna y visitas a centros de clientes.', riskTags: ['pvd'], active: true },
  { id: 'jr_jefe_eq', companyId: LEV, name: 'Jefatura de equipo técnico', departmentId: 'dep_mant', tasks: 'Supervisión de trabajos de mantenimiento e intervenciones puntuales.', riskTags: ['altura', 'electrico_bt', 'herramientas'], active: true },
  { id: 'jr_tec_mant', companyId: LEV, name: 'Técnico/a de mantenimiento', departmentId: 'dep_mant', tasks: 'Mantenimiento preventivo y correctivo de instalaciones de edificios.', riskTags: ['altura', 'electrico_bt', 'herramientas', 'manipulacion_cargas'], active: true },
  { id: 'jr_tec_inst', companyId: LEV, name: 'Técnico/a de instalaciones (climatización)', departmentId: 'dep_mant', tasks: 'Montaje y mantenimiento de equipos de climatización.', riskTags: ['altura', 'electrico_bt', 'gases_fluorados', 'herramientas'], active: true },
  { id: 'jr_fontanero', companyId: LEV, name: 'Oficial de fontanería', departmentId: 'dep_mant', tasks: 'Reparaciones de fontanería y saneamiento.', riskTags: ['herramientas', 'manipulacion_cargas'], active: true },
  { id: 'jr_enc_limp', companyId: LEV, name: 'Encargado/a de limpieza', departmentId: 'dep_limp', tasks: 'Organización de equipos de limpieza y limpieza en centros.', riskTags: ['quimicos_limpieza', 'caidas_mismo_nivel'], active: true },
  { id: 'jr_gobernanta', companyId: LEV, name: 'Gobernanta de limpieza', departmentId: 'dep_limp', tasks: 'Supervisión de la limpieza de habitaciones y zonas comunes del hotel.', riskTags: ['quimicos_limpieza', 'caidas_mismo_nivel'], active: true },
  { id: 'jr_limp', companyId: LEV, name: 'Limpiador/a', departmentId: 'dep_limp', tasks: 'Limpieza de oficinas, zonas comunes y locales de clientes.', riskTags: ['quimicos_limpieza', 'caidas_mismo_nivel', 'manipulacion_cargas'], active: true },
  { id: 'jr_iba_tec', companyId: IBA, name: 'Técnico/a de climatización', departmentId: 'dep_iba', tasks: 'Instalación y mantenimiento de climatización.', riskTags: ['altura', 'electrico_bt'], active: true },
];

const CUSTOMERS: CustomerOrganisation[] = [
  { id: 'cus_torre', companyId: LEV, name: 'Comunidad de Propietarios Torre Turia', nif: 'H98000001', contactName: 'Vicent Puig (administrador de fincas)', contactEmail: 'admin@torreturia.example' },
  { id: 'cus_marblau', companyId: LEV, name: 'Hoteles Mar Blau, S.L.', nif: 'B98000002', contactName: 'Núria Ferrando (jefa de mantenimiento)', contactEmail: 'mantenimiento@marblau.example' },
  { id: 'cus_dental', companyId: LEV, name: 'Clínica Dental Benimaclet, S.L.P.', nif: 'B98000003', contactName: 'Dra. Paula Cerdà', contactEmail: 'direccion@dentalbenimaclet.example' },
  { id: 'cus_colegio', companyId: LEV, name: 'Fundación Colegio Santa Ana', nif: 'G98000004', contactName: 'Josep Martí (gerencia)', contactEmail: 'gerencia@colegiosantaana.example' },
  { id: 'cus_horta', companyId: LEV, name: 'Supermercados Horta, S.A.', nif: 'A98000005', contactName: 'Rafael Soler (coordinador de seguridad)', contactEmail: 'seguridad@superhorta.example' },
  { id: 'cus_cowork', companyId: LEV, name: 'Cabanyal Cowork, S.L.', nif: 'B98000006', contactName: 'Inés Valls', contactEmail: 'hola@cabanyalcowork.example' },
  { id: 'cus_nou', companyId: LEV, name: 'Residencias Nou Campus, S.L.', nif: 'B98000007', contactName: 'Marc Gil (responsable de instalaciones)', contactEmail: 'instalaciones@noucampus.example' },
];

const PROVIDERS: PreventionProvider[] = [
  { id: 'prv_albufera', companyId: LEV, name: 'Prevención Albufera, S.L.', kind: 'spa', specialties: ['seguridad', 'higiene', 'ergonomia', 'medicina'], contractReference: 'Concierto SPA-2026-0412', contractValidUntil: '2026-12-31', contactName: 'Jorge Sanz Albert', contactEmail: 'jorge.sanz@prevencionalbufera.example' },
  { id: 'prv_formacion', companyId: LEV, name: 'Formación Segura Turia, S.L.', kind: 'training', specialties: [], contractReference: 'Pedido marco 2026', contractValidUntil: null, contactName: 'Eva Roig', contactEmail: 'cursos@formacionseguraturia.example' },
  { id: 'prv_anterior', companyId: LEV, name: 'Prevenciones Anteriores, S.L.', kind: 'spa', specialties: ['seguridad', 'higiene', 'ergonomia'], contractReference: 'Concierto 2021-118 (finalizado el 31/03/2026)', contractValidUntil: '2026-03-31', contactName: 'Ramón Gil Ortiz', contactEmail: 'ramon.gil@prevencionesanteriores.example' },
  { id: 'prv_iba', companyId: IBA, name: 'Prevención Albufera, S.L.', kind: 'spa', specialties: ['seguridad', 'higiene', 'ergonomia', 'medicina'], contractReference: 'Concierto SPA-2026-0977', contractValidUntil: '2027-02-28', contactName: 'Jorge Sanz Albert', contactEmail: 'jorge.sanz@prevencionalbufera.example' },
];

const CATEGORIES: [string, string, DocumentCategory['accessClass']][] = [
  ['cert_formacion', 'Certificado de formación', 'ordinary'],
  ['asistencia_formacion', 'Registro de asistencia a formación', 'ordinary'],
  ['info_riesgos', 'Información de riesgos y medidas preventivas', 'ordinary'],
  ['instruccion_centro', 'Instrucciones de seguridad del centro', 'ordinary'],
  ['entrega_epi', 'Registro de entrega de EPI', 'ordinary'],
  ['doc_spa', 'Documento del servicio de prevención', 'ordinary'],
  ['coordinacion', 'Registro de coordinación (CAE)', 'ordinary'],
  ['evaluacion_riesgos', 'Evaluación de riesgos', 'ordinary'],
  ['autorizacion', 'Autorización o habilitación', 'ordinary'],
  ['doc_empleado', 'Documentación del empleado (restringida)', 'restricted'],
  ['evidencia_accion', 'Evidencia de acción preventiva', 'ordinary'],
  ['otros', 'Otra evidencia aprobada', 'ordinary'],
];

interface EmpSpec {
  id: ID;
  companyId?: ID;
  code: string;
  first: string;
  last: string;
  hire: ISODate;
  manager: ID | null;
  user: ID | null;
  role: ID;
  dep: ID;
  sites: ID[];
  status?: 'inactive';
  end?: ISODate;
}

const EMPLOYEES: EmpSpec[] = [
  { id: 'emp_javier', code: 'EMP-001', first: 'Javier', last: 'Ortega Pons', hire: '2019-02-01', manager: null, user: 'usr_javier', role: 'jr_admin', dep: 'dep_adm', sites: ['ws_oficina'] },
  { id: 'emp_marta', code: 'EMP-002', first: 'Marta', last: 'Soler Vidal', hire: '2020-09-01', manager: 'emp_javier', user: null, role: 'jr_admin', dep: 'dep_adm', sites: ['ws_oficina'] },
  { id: 'emp_elena', code: 'EMP-003', first: 'Elena', last: 'Navarro Gil', hire: '2018-05-14', manager: 'emp_javier', user: 'usr_elena', role: 'jr_jefe_eq', dep: 'dep_mant', sites: ['ws_oficina', 'ws_torre', 'ws_marblau', 'ws_colegio'] },
  { id: 'emp_pablo', code: 'EMP-004', first: 'Pablo', last: 'Ruiz Esteve', hire: '2021-03-01', manager: 'emp_elena', user: 'usr_pablo', role: 'jr_tec_mant', dep: 'dep_mant', sites: ['ws_torre', 'ws_colegio', 'ws_oficina'] },
  { id: 'emp_sergio', code: 'EMP-005', first: 'Sergio', last: 'Llopis Mora', hire: '2020-01-13', manager: 'emp_elena', user: 'usr_sergio', role: 'jr_tec_inst', dep: 'dep_mant', sites: ['ws_marblau', 'ws_horta', 'ws_oficina'] },
  { id: 'emp_andres', code: 'EMP-006', first: 'Andrés', last: 'Ferrer Moll', hire: '2017-09-04', manager: 'emp_elena', user: 'usr_andres', role: 'jr_tec_mant', dep: 'dep_mant', sites: ['ws_colegio', 'ws_torre'] },
  { id: 'emp_ivan', code: 'EMP-007', first: 'Iván', last: 'Castelló Peris', hire: '2026-06-01', manager: 'emp_elena', user: null, role: 'jr_tec_mant', dep: 'dep_mant', sites: ['ws_marblau', 'ws_horta'] },
  { id: 'emp_raul', code: 'EMP-008', first: 'Raúl', last: 'Gómez Sanchis', hire: '2022-02-07', manager: 'emp_elena', user: null, role: 'jr_fontanero', dep: 'dep_mant', sites: ['ws_torre', 'ws_dental'] },
  { id: 'emp_oscar', code: 'EMP-009', first: 'Óscar', last: 'Pérez Llorens', hire: '2023-04-17', manager: 'emp_elena', user: null, role: 'jr_tec_inst', dep: 'dep_mant', sites: ['ws_dental', 'ws_cowork'] },
  { id: 'emp_amparo', code: 'EMP-010', first: 'Amparo', last: 'Ribes Bosch', hire: '2016-11-02', manager: 'emp_javier', user: 'usr_amparo', role: 'jr_enc_limp', dep: 'dep_limp', sites: ['ws_oficina', 'ws_marblau', 'ws_dental', 'ws_colegio', 'ws_torre', 'ws_cowork', 'ws_horta'] },
  { id: 'emp_lucia', code: 'EMP-011', first: 'Lucía', last: 'Martínez Peiró', hire: '2024-02-05', manager: 'emp_amparo', user: 'usr_lucia', role: 'jr_limp', dep: 'dep_limp', sites: ['ws_dental', 'ws_cowork'] },
  { id: 'emp_rocio', code: 'EMP-012', first: 'Rocío', last: 'Navarro Vila', hire: '2022-05-09', manager: 'emp_amparo', user: null, role: 'jr_limp', dep: 'dep_limp', sites: ['ws_marblau'] },
  { id: 'emp_fatima', code: 'EMP-013', first: 'Fátima', last: 'El Amrani', hire: '2023-09-11', manager: 'emp_amparo', user: null, role: 'jr_limp', dep: 'dep_limp', sites: ['ws_colegio', 'ws_torre'] },
  { id: 'emp_carmen', code: 'EMP-014', first: 'Carmen', last: 'Soriano Lluch', hire: '2019-06-03', manager: 'emp_amparo', user: null, role: 'jr_gobernanta', dep: 'dep_limp', sites: ['ws_marblau'] },
  { id: 'emp_daniela', code: 'EMP-015', first: 'Daniela', last: 'Pop', hire: '2025-03-03', manager: 'emp_amparo', user: null, role: 'jr_limp', dep: 'dep_limp', sites: ['ws_marblau'] },
  { id: 'emp_josemi', code: 'EMP-016', first: 'José Miguel', last: 'Tormo Ibáñez', hire: '2021-10-18', manager: 'emp_amparo', user: null, role: 'jr_limp', dep: 'dep_limp', sites: ['ws_horta'] },
  { id: 'emp_nerea', code: 'EMP-017', first: 'Nerea', last: 'Alcaraz Ferri', hire: '2025-11-03', manager: 'emp_amparo', user: null, role: 'jr_limp', dep: 'dep_limp', sites: ['ws_torre'] },
  { id: 'emp_teresa', code: 'EMP-018', first: 'Teresa', last: 'Vidal Roig', hire: '2022-03-01', manager: 'emp_amparo', user: null, role: 'jr_limp', dep: 'dep_limp', sites: ['ws_torre'], status: 'inactive', end: '2025-06-30' },
  { id: 'emp_marina', code: 'EMP-019', first: 'Marina', last: 'Peris Climent', hire: '2024-09-02', manager: 'emp_javier', user: 'usr_marina', role: 'jr_coord', dep: 'dep_adm', sites: ['ws_oficina'] },
  { id: 'emp_ane', companyId: IBA, code: 'IBA-001', first: 'Ane', last: 'Zubizarreta Goikoetxea', hire: '2021-01-11', manager: null, user: 'usr_ane', role: 'jr_iba_tec', dep: 'dep_iba', sites: ['ws_getxo'] },
  { id: 'emp_mikel', companyId: IBA, code: 'IBA-002', first: 'Mikel', last: 'Arrieta Uribe', hire: '2022-04-04', manager: 'emp_ane', user: null, role: 'jr_iba_tec', dep: 'dep_iba', sites: ['ws_getxo'] },
];

/** Authority → the user who decides in the demo. */
const REVIEWER: Record<string, ID> = { coordinator: 'usr_marina', provider_technical: 'usr_jorge', provider_medical: 'usr_clara' };

// ─────────────────────────────── Builder ───────────────────────────────

export function buildSeedDatabase(anchor: ISODate = today(TZ)): Database {
  const D = (n: number) => addDays(anchor, n);
  const T = (n: number, time = '10:00') => at(D(n), time, TZ);
  const seededAt = T(0, '08:00');

  const worksites: Worksite[] = [
    { id: 'ws_oficina', companyId: LEV, code: 'CT-01', name: 'Oficina y almacén', kind: 'own', address: 'Carrer de Sant Vicent Màrtir, 214, bajo', municipality: 'València', customerId: null, siteContactName: 'Javier Ortega Pons', siteContactPhone: '960 000 101', coordinatorEmployeeId: 'emp_marina', activities: 'Oficina, almacén de material y carga de furgonetas.', riskTags: ['manipulacion_cargas'], sharedWorkplace: false, active: true, updatedAt: T(-200) },
    { id: 'ws_torre', companyId: LEV, code: 'CT-02', name: 'Comunidad de Propietarios Torre Turia', kind: 'customer', address: 'Av. de Pius XII, 46', municipality: 'València', customerId: 'cus_torre', siteContactName: 'Vicent Puig', siteContactPhone: '960 000 202', coordinatorEmployeeId: 'emp_elena', activities: 'Mantenimiento de zonas comunes, garaje y cubierta; limpieza de portales.', riskTags: ['caidas_mismo_nivel'], sharedWorkplace: true, active: true, updatedAt: T(-120) },
    { id: 'ws_marblau', companyId: LEV, code: 'CT-03', name: 'Hotel Mar Blau', kind: 'customer', address: 'Passeig de Neptú, 18', municipality: 'València', customerId: 'cus_marblau', siteContactName: 'Núria Ferrando', siteContactPhone: '960 000 303', coordinatorEmployeeId: 'emp_amparo', activities: 'Limpieza de habitaciones y zonas comunes; mantenimiento de climatización.', riskTags: ['cocina_industrial', 'caidas_mismo_nivel'], sharedWorkplace: true, active: true, updatedAt: T(-25) },
    { id: 'ws_dental', companyId: LEV, code: 'CT-04', name: 'Clínica Dental Benimaclet', kind: 'customer', address: 'Carrer de Murta, 9', municipality: 'València', customerId: 'cus_dental', siteContactName: 'Dra. Paula Cerdà', siteContactPhone: '960 000 404', coordinatorEmployeeId: 'emp_amparo', activities: 'Limpieza de consultas y retirada de residuos asimilables; fontanería.', riskTags: ['riesgo_biologico'], sharedWorkplace: true, active: true, updatedAt: T(-12) },
    { id: 'ws_colegio', companyId: LEV, code: 'CT-05', name: 'Colegio Santa Ana', kind: 'customer', address: 'Carrer de la Reina, 101', municipality: 'València', customerId: 'cus_colegio', siteContactName: 'Josep Martí', siteContactPhone: '960 000 505', coordinatorEmployeeId: 'emp_elena', activities: 'Mantenimiento y limpieza en horario escolar y extraescolar.', riskTags: ['menores'], sharedWorkplace: true, active: true, updatedAt: T(-90) },
    { id: 'ws_horta', companyId: LEV, code: 'CT-06', name: 'Supermercados Horta (Alboraia)', kind: 'customer', address: 'Ctra. de Barcelona, km 3', municipality: 'Alboraia', customerId: 'cus_horta', siteContactName: 'Rafael Soler', siteContactPhone: '960 000 606', coordinatorEmployeeId: 'emp_elena', activities: 'Limpieza de sala de ventas y muelle; mantenimiento de cámaras.', riskTags: ['trafico_interno'], sharedWorkplace: true, active: true, updatedAt: T(-40) },
    { id: 'ws_cowork', companyId: LEV, code: 'CT-07', name: 'Coworking Cabanyal', kind: 'customer', address: 'Carrer de la Reina, 205', municipality: 'València', customerId: 'cus_cowork', siteContactName: 'Inés Valls', siteContactPhone: '960 000 707', coordinatorEmployeeId: 'emp_amparo', activities: 'Limpieza de oficinas compartidas; mantenimiento del cuarto técnico.', riskTags: ['caidas_mismo_nivel'], sharedWorkplace: false, active: true, updatedAt: T(-300) },
    { id: 'ws_nou', companyId: LEV, code: 'CT-08', name: 'Residencia Universitaria Nou Campus', kind: 'customer', address: 'Av. dels Tarongers, 30', municipality: 'València', customerId: 'cus_nou', siteContactName: 'Marc Gil', siteContactPhone: '960 000 808', coordinatorEmployeeId: 'emp_elena', activities: 'Nuevo contrato: mantenimiento de climatización y alumbrado del atrio (plataforma elevadora).', riskTags: ['cocina_industrial'], sharedWorkplace: true, active: true, updatedAt: T(-2) },
    { id: 'ws_getxo', companyId: IBA, code: 'CT-01', name: 'Taller Getxo', kind: 'own', address: 'Ibaigane Kalea, 12', municipality: 'Getxo', customerId: null, siteContactName: 'Iker Etxeberria Uriarte', siteContactPhone: '940 000 101', coordinatorEmployeeId: 'emp_ane', activities: 'Taller y almacén.', riskTags: [], sharedWorkplace: false, active: true, updatedAt: T(-300) },
  ];

  const settings: CompanySettings[] = [LEV, IBA].map((c) => ({
    id: `set_${c}`,
    companyId: c,
    alertWindowDays: 30,
    clinicalKeywords: ['informe médico', 'historia clínica', 'diagnóstico', 'analítica', 'resultado clínico', 'receta', 'reconocimiento médico completo'],
    shareLinkMaxDays: 30,
    updatedBy: null,
    updatedAt: null,
  }));

  const memberships: Membership[] = [
    mem('usr_laura', LEV, ['owner'], null),
    mem('usr_javier', LEV, ['company_admin'], 'emp_javier'),
    mem('usr_marina', LEV, ['prl_coordinator'], 'emp_marina', { reference: 'Designación como trabajadora designada (acta de 02/09/2024); formación de nivel intermedio en PRL.' }),
    mem('usr_elena', LEV, ['supervisor'], 'emp_elena'),
    mem('usr_amparo', LEV, ['supervisor'], 'emp_amparo'),
    mem('usr_pablo', LEV, ['employee'], 'emp_pablo'),
    mem('usr_sergio', LEV, ['employee'], 'emp_sergio'),
    mem('usr_lucia', LEV, ['employee'], 'emp_lucia'),
    mem('usr_andres', LEV, ['employee', 'representative'], 'emp_andres', { roleValidUntil: { representative: '2028-05-15' }, reference: 'Delegado de personal y, por ello, delegado de prevención (LPRL art. 35.2; plantilla de hasta 30 personas). Mandato hasta el 15/05/2028.' }),
    mem('usr_jorge', LEV, ['provider_technical'], null, { providerId: 'prv_albufera', reference: 'Concierto SPA-2026-0412 (seguridad, higiene, ergonomía) hasta el 31/12/2026.', validUntil: '2026-12-31' }),
    mem('usr_clara', LEV, ['provider_medical'], null, { providerId: 'prv_albufera', reference: 'Concierto SPA-2026-0412 (medicina del trabajo) hasta el 31/12/2026.', validUntil: '2026-12-31' }),
    mem('usr_ramon', LEV, ['provider_technical'], null, { providerId: 'prv_anterior', reference: 'Concierto 2021-118 finalizado el 31/03/2026.', validUntil: '2026-03-31', status: 'revoked', revokedAt: '2026-03-31T22:00:00.000Z' }),
    mem('usr_iker', IBA, ['owner', 'prl_coordinator'], null),
    mem('usr_ane', IBA, ['employee'], 'emp_ane'),
    mem('usr_jorge', IBA, ['provider_technical'], null, { providerId: 'prv_iba', reference: 'Concierto SPA-2026-0977, limitado al taller de Getxo.', worksiteScope: ['ws_getxo'], validUntil: '2027-02-28' }),
  ];

  const employees: Employee[] = EMPLOYEES.map((e) => ({
    id: e.id,
    companyId: e.companyId ?? LEV,
    code: e.code,
    firstName: e.first,
    lastName: e.last,
    status: e.status ?? 'active',
    hireDate: e.hire,
    endDate: e.end ?? null,
    managerEmployeeId: e.manager,
    userId: e.user,
    createdAt: at(e.hire, '09:00', TZ),
  }));

  const assignments: EmployeeAssignment[] = [];
  for (const e of EMPLOYEES) {
    const companyId = e.companyId ?? LEV;
    if (e.id === 'emp_sergio') {
      assignments.push(asg(e, companyId, 'v1', e.hire, '2025-12-31', ['ws_oficina', 'ws_marblau'], 'Alta en la empresa'));
      assignments.push(asg(e, companyId, 'v2', '2026-01-01', null, e.sites, 'Nuevo contrato con Supermercados Horta'));
    } else if (e.id === 'emp_ivan') {
      assignments.push(asg(e, companyId, 'v1', e.hire, D(-4), ['ws_marblau'], 'Alta en la empresa'));
      assignments.push(asg(e, companyId, 'v2', D(-3), null, e.sites, 'Refuerzo en Supermercados Horta'));
    } else {
      assignments.push(asg(e, companyId, 'v1', e.hire, e.end ?? null, e.sites, 'Alta en la empresa'));
    }
  }

  // ─────────────────────────────── Requirement templates ───────────────────────────────
  const templates: RequirementTemplate[] = [];
  const versions: RequirementVersion[] = [];
  let tplSeq = 0;
  const TPL: Record<string, ID> = {};
  const VER: Record<string, ID> = {};
  const scope = (p: Partial<RequirementScope>): RequirementScope => ({ jobRoleIds: [], worksiteIds: [], riskTags: [], employeeIds: [], appliesToAll: false, ...p });

  type VSpec = Partial<RequirementVersion> & Pick<RequirementVersion, 'name' | 'category' | 'evidenceMode' | 'scope' | 'evidenceRequired'>;
  const req = (key: string, companyId: ID, specs: VSpec[], extra: Partial<RequirementTemplate> = {}) => {
    tplSeq += companyId === LEV ? 1 : 0;
    const id = `tpl_${key}`;
    TPL[key] = id;
    const code = companyId === LEV ? `REQ-${String(tplSeq).padStart(3, '0')}` : 'REQ-001';
    templates.push({ id, companyId, code, createdAt: specs[0].createdAt ?? T(-500), createdBy: specs[0].createdBy ?? 'usr_marina', retiredAt: null, ...extra });
    specs.forEach((s, i) => {
      const vid = `${id}_v${i + 1}`;
      VER[`${key}#${i + 1}`] = vid;
      VER[key] = vid;
      const authority = s.reviewAuthority ?? 'coordinator';
      versions.push({
        id: vid,
        companyId,
        templateId: id,
        version: i + 1,
        description: '',
        purpose: '',
        requirementType: 'mandatory_policy',
        perWorksite: false,
        source: { kind: 'law', label: '', url: null, assessmentId: null },
        applicabilityNote: '',
        reviewAuthority: authority,
        responsibleReviewer: authority === 'coordinator' ? 'Marina Peris Climent (coordinación de PRL)' : authority === 'provider_technical' ? 'Jorge Sanz Albert (Prevención Albufera)' : 'Clara Ivars Monzó (medicina del trabajo, Prevención Albufera)',
        expiryRule: 'none',
        reviewRule: { kind: 'none', months: null, setBy: null },
        policyReviewDate: null,
        critical: false,
        exceptionAllowed: false,
        invalidatesPriorEvidence: false,
        courseId: null,
        equipmentItemId: null,
        instructionDocumentId: null,
        health: null,
        effectiveFrom: '2025-01-15',
        effectiveTo: null,
        status: 'active',
        changeReason: 'Versión inicial',
        createdBy: 'usr_marina',
        createdAt: T(-500),
        approvedBy: authority === 'provider_medical' ? 'usr_clara' : 'usr_jorge',
        approvedAt: T(-490),
        approvalNote: 'Aprobado conforme a la evaluación de riesgos y la planificación vigentes.',
        ...s,
      });
    });
  };

  const LPRL = (a: string) => `https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292#a${a}`;
  const TECH_ROLES = ['jr_tec_mant', 'jr_tec_inst', 'jr_jefe_eq', 'jr_fontanero'];
  const CLEAN_ROLES = ['jr_limp', 'jr_enc_limp', 'jr_gobernanta'];

  req('info_tec', LEV, [
    { name: 'Información de riesgos y medidas — puestos técnicos', category: 'information', evidenceMode: 'acknowledgement', scope: scope({ jobRoleIds: TECH_ROLES }), evidenceRequired: 'Confirmación de recepción de la ficha de información del puesto (versión vigente).', description: 'Ficha de información sobre los riesgos del puesto y las medidas de prevención y emergencia.', purpose: 'Informar directamente a cada persona de los riesgos específicos de su puesto.', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 18', url: LPRL('18'), assessmentId: null }, applicabilityNote: 'Puestos técnicos según la evaluación ER-001. La confirmación acredita la recepción, no la formación.', instructionDocumentId: 'doc_info_tec' },
  ]);
  req('info_limp', LEV, [
    { name: 'Información de riesgos y medidas — limpieza', category: 'information', evidenceMode: 'acknowledgement', scope: scope({ jobRoleIds: CLEAN_ROLES }), evidenceRequired: 'Confirmación de recepción de la ficha de información del puesto.', description: 'Ficha de información de riesgos de los puestos de limpieza.', purpose: 'Informar directamente de los riesgos del puesto.', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 18', url: LPRL('18'), assessmentId: null }, applicabilityNote: 'Puestos de limpieza según la evaluación ER-002.', instructionDocumentId: 'doc_info_limp' },
  ]);
  req('info_ofi', LEV, [
    { name: 'Información de riesgos y medidas — oficina', category: 'information', evidenceMode: 'acknowledgement', scope: scope({ jobRoleIds: ['jr_admin', 'jr_coord'] }), evidenceRequired: 'Confirmación de recepción de la ficha de información.', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 18', url: LPRL('18'), assessmentId: null }, applicabilityNote: 'Puestos de oficina según la evaluación ER-003.', instructionDocumentId: 'doc_info_ofi' },
    { name: 'Información de riesgos y medidas — oficina', category: 'information', evidenceMode: 'acknowledgement', scope: scope({ jobRoleIds: ['jr_admin', 'jr_coord'] }), evidenceRequired: 'Confirmación de recepción de la ficha de información (incluye el nuevo plan de emergencia).', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 18', url: LPRL('18'), assessmentId: null }, applicabilityNote: 'Puestos de oficina según la evaluación ER-003.', instructionDocumentId: 'doc_info_ofi', effectiveFrom: D(15), changeReason: 'Se incorpora el nuevo plan de emergencia del local (entra en vigor en la fecha de efecto).', createdAt: T(-5), approvedAt: T(-4) },
  ]);
  versions.find((v) => v.id === 'tpl_info_ofi_v1')!.effectiveTo = D(14);
  req('prl_inicial', LEV, [
    { name: 'Formación en PRL del puesto (inicial)', category: 'training', evidenceMode: 'training', scope: scope({ appliesToAll: true }), evidenceRequired: 'Certificado o registro de la formación teórico-práctica del puesto.', description: 'Formación teórica y práctica centrada en el puesto, al contratar o cambiar de funciones.', purpose: 'Formación suficiente y adecuada en materia preventiva.', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 19', url: LPRL('19'), assessmentId: null }, applicabilityNote: 'Toda la plantilla. Se repite al cambiar funciones o equipos; el servicio de prevención no ha fijado una periodicidad (art. 19: «si fuera necesario»).', courseId: 'crs_prl_puesto' },
  ]);
  req('altura', LEV, [
    { name: 'Formación en trabajos en altura', category: 'training', evidenceMode: 'training', scope: scope({ jobRoleIds: ['jr_tec_mant', 'jr_tec_inst'] }), evidenceRequired: 'Certificado del curso de trabajos en altura y uso de escaleras.', source: { kind: 'risk_assessment', label: 'Evaluación ER-001 (medida 3.2)', url: null, assessmentId: 'ra_001' }, applicabilityNote: 'Técnicos que usan escaleras y plataformas según ER-001.', reviewAuthority: 'provider_technical', critical: true, reviewRule: { kind: 'interval', months: 36, setBy: 'Prevención Albufera: criterio técnico en la planificación 2025' }, courseId: 'crs_altura', effectiveFrom: '2025-01-15', effectiveTo: D(-61), status: 'superseded' },
    { name: 'Formación en trabajos en altura', category: 'training', evidenceMode: 'training', scope: scope({ riskTags: ['altura'] }), evidenceRequired: 'Certificado del curso de trabajos en altura y uso de escaleras.', source: { kind: 'risk_assessment', label: 'Evaluación ER-001 (medida 3.2)', url: null, assessmentId: 'ra_001' }, applicabilityNote: 'Puestos con riesgo de trabajos en altura (incluye la jefatura de equipo). La evidencia aceptada con la versión 1 sigue siendo válida.', reviewAuthority: 'provider_technical', critical: true, reviewRule: { kind: 'interval', months: 36, setBy: 'Prevención Albufera: criterio técnico en la planificación 2025' }, courseId: 'crs_altura', effectiveFrom: D(-60), changeReason: 'Se amplía a la jefatura de equipo (ER-001 revisada); no exige repetir evidencias.', createdAt: T(-65), approvedAt: T(-62) },
  ]);
  req('electrico', LEV, [
    { name: 'Autorización para trabajos con riesgo eléctrico', category: 'authorisation', evidenceMode: 'document', scope: scope({ riskTags: ['electrico_bt'] }), evidenceRequired: 'Autorización escrita del empresario basada en la formación recibida (trabajador autorizado).', description: 'Autorización para trabajos sin tensión en instalaciones de baja tensión.', source: { kind: 'law', label: 'RD 614/2001, art. 5 y anexo I (trabajador autorizado)', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2001-11881', assessmentId: null }, applicabilityNote: 'Puestos con riesgo eléctrico según ER-001. El tipo de autorización lo determina el servicio de prevención.', reviewAuthority: 'provider_technical', critical: true },
  ]);
  req('quimicos', LEV, [
    { name: 'Formación en productos químicos de limpieza', category: 'training', evidenceMode: 'training', scope: scope({ riskTags: ['quimicos_limpieza'] }), evidenceRequired: 'Certificado del curso de manipulación segura de productos de limpieza.', source: { kind: 'risk_assessment', label: 'Evaluación ER-002 v1', url: null, assessmentId: 'ra_002a' }, applicabilityNote: 'Puestos de limpieza.', courseId: 'crs_quimicos', effectiveFrom: '2024-01-15', effectiveTo: D(-21), status: 'superseded', createdAt: T(-700), approvedAt: T(-690) },
    { name: 'Formación en productos químicos de limpieza', category: 'training', evidenceMode: 'training', scope: scope({ riskTags: ['quimicos_limpieza'] }), evidenceRequired: 'Certificado del curso actualizado (incluye los nuevos desinfectantes).', source: { kind: 'risk_assessment', label: 'Evaluación ER-002 v2', url: null, assessmentId: 'ra_002' }, applicabilityNote: 'Puestos de limpieza. Cambio de proveedor de desinfectantes: la evidencia anterior debe revisarse.', courseId: 'crs_quimicos', effectiveFrom: D(-20), invalidatesPriorEvidence: true, changeReason: 'Nuevos desinfectantes (ER-002 v2): se exige revisar la formación acreditada.', createdAt: T(-24), approvedAt: T(-22) },
  ]);
  req('calzado', LEV, [{ name: 'Entrega de calzado de seguridad', category: 'ppe', evidenceMode: 'ppe_issue', scope: scope({ jobRoleIds: TECH_ROLES }), evidenceRequired: 'Registro de entrega con confirmación de recepción.', source: { kind: 'risk_assessment', label: 'Evaluación ER-001 (EPI necesarios)', url: null, assessmentId: 'ra_001' }, applicabilityNote: 'Puestos técnicos. La idoneidad del modelo la determina la evaluación, no la aplicación.', equipmentItemId: 'eq_calzado' }]);
  req('guantes', LEV, [{ name: 'Entrega de guantes de protección química', category: 'ppe', evidenceMode: 'ppe_issue', scope: scope({ riskTags: ['quimicos_limpieza'] }), evidenceRequired: 'Registro de entrega con confirmación de recepción.', source: { kind: 'risk_assessment', label: 'Evaluación ER-002 v2', url: null, assessmentId: 'ra_002' }, applicabilityNote: 'Puestos de limpieza.', equipmentItemId: 'eq_guantes' }]);
  req('casco', LEV, [{ name: 'Entrega de casco con barboquejo', category: 'ppe', evidenceMode: 'ppe_issue', scope: scope({ riskTags: ['altura'] }), evidenceRequired: 'Registro de entrega con confirmación de recepción.', source: { kind: 'risk_assessment', label: 'Evaluación ER-001 (EPI necesarios)', url: null, assessmentId: 'ra_001' }, applicabilityNote: 'Puestos con trabajos en altura.', equipmentItemId: 'eq_casco' }]);
  req('altavis', LEV, [{ name: 'Chaleco de alta visibilidad (muelle de Supermercados Horta)', category: 'ppe', evidenceMode: 'ppe_issue', scope: scope({ worksiteIds: ['ws_horta'] }), evidenceRequired: 'Registro de entrega con confirmación de recepción.', source: { kind: 'customer_requirement', label: 'Normas de acceso del titular (CAE-002)', url: null, assessmentId: null }, applicabilityNote: 'Personal que accede al muelle de carga.', equipmentItemId: 'eq_altavis' }]);
  req('vs_oferta', LEV, [
    { name: 'Oferta de vigilancia de la salud', category: 'health_surveillance', evidenceMode: 'health', scope: scope({ appliesToAll: true }), evidenceRequired: 'Registro de la oferta, la respuesta y, si se acepta, la conclusión de aptitud (sin datos clínicos).', description: 'Oferta voluntaria de vigilancia de la salud según los protocolos del servicio médico.', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 22', url: LPRL('22'), assessmentId: null }, applicabilityNote: 'Voluntaria: la negativa de la persona trabajadora no es un incumplimiento. Las excepciones del art. 22.1 requieren decisión profesional e informe previo de la representación.', reviewAuthority: 'provider_medical', health: { kind: 'voluntary', exceptionGround: null, representativesReportOn: null, professionalReference: 'Protocolos de vigilancia por puesto de Prevención Albufera' } },
  ]);
  req('vs_altura', LEV, [
    { name: 'Reconocimiento médico obligatorio para trabajos en altura', category: 'health_surveillance', evidenceMode: 'health', scope: scope({ riskTags: ['altura'] }), evidenceRequired: 'Conclusión de aptitud antes de trabajar en altura.', source: { kind: 'internal_policy', label: 'Propuesta de la administración', url: null, assessmentId: null }, applicabilityNote: 'Propuesta interna sin informe de la representación ni confirmación del servicio médico.', reviewAuthority: 'provider_medical', critical: false, health: { kind: 'mandatory_exception', exceptionGround: 'danger_to_others', representativesReportOn: null, professionalReference: null }, status: 'pending_approval', createdBy: 'usr_javier', createdAt: T(-6), approvedBy: null, approvedAt: null, approvalNote: null, effectiveFrom: D(10), changeReason: 'Propuesta: hacer obligatorio el reconocimiento para trabajos en altura.' },
  ], { createdBy: 'usr_javier', createdAt: T(-6) });
  const inst = (key: string, site: ID, name: string, doc: ID, critical: boolean, label: string) =>
    req(key, LEV, [{ name, category: 'site_instruction', evidenceMode: 'acknowledgement', perWorksite: true, scope: scope({ worksiteIds: [site] }), evidenceRequired: 'Confirmación de recepción de la versión vigente de las instrucciones del titular.', source: { kind: 'customer_requirement', label, url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2004-1848#a8', assessmentId: null }, applicabilityNote: 'Todo el personal asignado al centro (RD 171/2004, arts. 8 y 9: el titular da instrucciones y cada empresa las transmite a su personal).', critical, instructionDocumentId: doc }]);
  inst('inst_marblau', 'ws_marblau', 'Instrucciones de seguridad — Hotel Mar Blau', 'doc_inst_marblau', false, 'Instrucciones del titular (CAE-001)');
  inst('inst_horta', 'ws_horta', 'Instrucciones de seguridad — Supermercados Horta', 'doc_inst_horta', true, 'Instrucciones del titular (CAE-002)');
  inst('inst_dental', 'ws_dental', 'Instrucciones del centro — Clínica Dental (residuos)', 'doc_inst_dental', false, 'Instrucciones del titular (residuos sanitarios)');
  inst('inst_nou', 'ws_nou', 'Instrucciones de seguridad — Residencia Nou Campus', 'doc_inst_nou', true, 'Instrucciones del titular (CAE-004)');
  versions.find((v) => v.templateId === 'tpl_inst_nou')!.effectiveFrom = D(-2);
  req('biologico', LEV, [{ name: 'Formación en riesgo biológico y residuos sanitarios', category: 'training', evidenceMode: 'training', scope: scope({ worksiteIds: ['ws_dental'] }), evidenceRequired: 'Certificado del curso; si el emisor indica caducidad, debe constar.', source: { kind: 'risk_assessment', label: 'Evaluación ER-006 (Clínica Dental)', url: null, assessmentId: 'ra_006' }, applicabilityNote: 'Personal asignado a la clínica.', courseId: 'crs_biologico', expiryRule: 'per_document' }]);
  req('delitos', LEV, [{ name: 'Certificado negativo del Registro Central de Delincuentes Sexuales', category: 'employee_document', evidenceMode: 'document', scope: scope({ worksiteIds: ['ws_colegio'] }), evidenceRequired: 'Certificado aportado por la persona trabajadora (acceso restringido).', description: 'Lo exige el titular para el acceso al centro escolar.', source: { kind: 'customer_requirement', label: 'Exigencia del titular; LO 8/2021, art. 57 (aplicabilidad pendiente de revisión profesional)', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2021-9347', assessmentId: null }, applicabilityNote: 'Personal con acceso al centro escolar. Si hay contacto habitual con menores es una cuestión de interpretación profesional. Datos de condenas: acceso restringido (RGPD art. 10).', critical: true }]);
  req('pvd', LEV, [{ name: 'Formación en pantallas de visualización', category: 'training', evidenceMode: 'training', scope: scope({ riskTags: ['pvd'] }), evidenceRequired: 'Registro de la formación en línea.', source: { kind: 'provider_policy', label: 'Recomendación del servicio de prevención', url: null, assessmentId: null }, applicabilityNote: 'Recomendada; no cuenta como evidencia obligatoria pendiente.', requirementType: 'optional', courseId: 'crs_pvd' }]);
  req('pemp', LEV, [{ name: 'Formación de operador de plataforma elevadora (PEMP)', category: 'training', evidenceMode: 'training', scope: scope({ worksiteIds: ['ws_nou'], jobRoleIds: ['jr_tec_mant', 'jr_tec_inst', 'jr_jefe_eq'] }), evidenceRequired: 'Certificado de operador de PEMP.', source: { kind: 'risk_assessment', label: 'Evaluación ER-007 (borrador) y requisito del titular', url: null, assessmentId: 'ra_007' }, applicabilityNote: 'Técnicos asignados a la Residencia Nou Campus (atrio).', reviewAuthority: 'provider_technical', critical: true, exceptionAllowed: true, approvalNote: 'Excepción validada: trabajo acompañado por un operador acreditado del titular durante un máximo de 30 días mientras se obtiene la formación.', courseId: 'crs_pemp', effectiveFrom: D(-2), createdAt: T(-3), approvedAt: T(-2) }]);
  req('carretilla', LEV, [{ name: 'Formación de operador de carretilla elevadora', category: 'training', evidenceMode: 'training', scope: scope({ worksiteIds: ['ws_horta'] }), evidenceRequired: '—', source: { kind: 'risk_assessment', label: 'Evaluación ER-005 (borrador en revisión)', url: null, assessmentId: 'ra_005' }, applicabilityNote: 'El personal de Mantenimientos Levante no maneja carretillas en el centro: las maneja el personal del titular.', requirementType: 'not_applicable' }]);
  req('auxilios', LEV, [{ name: 'Primeros auxilios y emergencias (personas designadas)', category: 'training', evidenceMode: 'training', scope: scope({ employeeIds: ['emp_javier', 'emp_marina'] }), evidenceRequired: 'Certificado del curso de primeros auxilios.', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 20 (medidas de emergencia)', url: LPRL('20'), assessmentId: null }, applicabilityNote: 'Personas designadas en el plan de emergencia de la oficina.', courseId: 'crs_auxilios' }]);
  req('anual_medico', LEV, [
    { name: 'Certificado médico anual para toda la plantilla', category: 'health_surveillance', evidenceMode: 'document', scope: scope({ appliesToAll: true }), evidenceRequired: 'Certificado médico.', source: { kind: 'internal_policy', label: 'Práctica anterior de la empresa', url: null, assessmentId: null }, applicabilityNote: 'Retirado: no existe una obligación general de certificado médico anual; se sustituye por la oferta voluntaria (REQ-012).', reviewAuthority: 'provider_medical', effectiveFrom: '2023-01-01', effectiveTo: '2024-12-31', status: 'retired', approvedBy: 'usr_ramon', changeReason: 'Política anterior', createdAt: '2022-12-15T09:00:00.000Z', approvedAt: '2022-12-20T09:00:00.000Z' },
  ], { retiredAt: '2024-12-20T09:00:00.000Z', retireReason: 'No existe una obligación general de certificado médico anual; se sustituye por la oferta voluntaria (REQ-012).' });
  req('iba_altura', IBA, [{ name: 'Formación en trabajos en altura', category: 'training', evidenceMode: 'training', scope: scope({ riskTags: ['altura'] }), evidenceRequired: 'Certificado del curso.', source: { kind: 'risk_assessment', label: 'Evaluación ER-IBA-01', url: null, assessmentId: 'ra_iba' }, reviewAuthority: 'provider_technical', critical: true, createdBy: 'usr_iker', courseId: 'crs_iba_altura' }], { createdBy: 'usr_iker' });

  // ─────────────────────────────── Courses and equipment ───────────────────────────────
  const none = { kind: 'none' as const, months: null, setBy: null };
  const courses: TrainingCourse[] = [
    { id: 'crs_prl_puesto', companyId: LEV, code: 'CUR-01', title: 'Formación en PRL del puesto (inicial)', providerName: 'Prevención Albufera, S.L.', modality: 'presencial', durationHours: 6, contentSummary: 'Riesgos del puesto, medidas, emergencias y derechos y obligaciones.', riskTags: [], refresher: none, active: true },
    { id: 'crs_altura', companyId: LEV, code: 'CUR-02', title: 'Trabajos en altura y uso de escaleras', providerName: 'Formación Segura Turia, S.L.', modality: 'presencial', durationHours: 8, contentSummary: 'Escaleras portátiles, plataformas, sistemas anticaídas básicos.', riskTags: ['altura'], refresher: { kind: 'interval', months: 36, setBy: 'Prevención Albufera: criterio técnico en la planificación 2025' }, active: true },
    { id: 'crs_electrico', companyId: LEV, code: 'CUR-03', title: 'Riesgo eléctrico: trabajos sin tensión', providerName: 'Formación Segura Turia, S.L.', modality: 'presencial', durationHours: 8, contentSummary: 'Las cinco reglas de oro, consignación y verificación de ausencia de tensión.', riskTags: ['electrico_bt'], refresher: none, active: true },
    { id: 'crs_quimicos', companyId: LEV, code: 'CUR-04', title: 'Productos químicos de limpieza (actualizado)', providerName: 'Prevención Albufera, S.L.', modality: 'mixta', durationHours: 3, contentSummary: 'Etiquetado, fichas de datos de seguridad, mezclas prohibidas y nuevos desinfectantes.', riskTags: ['quimicos_limpieza'], refresher: none, active: true },
    { id: 'crs_biologico', companyId: LEV, code: 'CUR-05', title: 'Riesgo biológico en centros sanitarios', providerName: 'Prevención Albufera, S.L.', modality: 'online', durationHours: 2, contentSummary: 'Residuos sanitarios, pinchazos y actuación ante exposición.', riskTags: ['riesgo_biologico'], refresher: none, active: true },
    { id: 'crs_pvd', companyId: LEV, code: 'CUR-06', title: 'Pantallas de visualización de datos', providerName: 'Prevención Albufera, S.L.', modality: 'online', durationHours: 1, contentSummary: 'Ergonomía del puesto con pantalla.', riskTags: ['pvd'], refresher: none, active: true },
    { id: 'crs_auxilios', companyId: LEV, code: 'CUR-07', title: 'Primeros auxilios y emergencias', providerName: 'Formación Segura Turia, S.L.', modality: 'presencial', durationHours: 8, contentSummary: 'Soporte vital básico y actuación en emergencias.', riskTags: [], refresher: { kind: 'not_determined', months: null, setBy: null }, active: true },
    { id: 'crs_pemp', companyId: LEV, code: 'CUR-08', title: 'Operador de plataformas elevadoras móviles de personal', providerName: 'Formación Segura Turia, S.L.', modality: 'presencial', durationHours: 8, contentSummary: 'Manejo seguro de PEMP.', riskTags: ['altura'], refresher: none, active: true },
    { id: 'crs_iba_altura', companyId: IBA, code: 'CUR-01', title: 'Trabajos en altura', providerName: 'Prevención Albufera, S.L.', modality: 'presencial', durationHours: 8, contentSummary: 'Trabajos en altura.', riskTags: ['altura'], refresher: none, active: true },
  ];

  const equipment: EquipmentItem[] = [
    { id: 'eq_calzado', companyId: LEV, code: 'EPI-01', name: 'Calzado de seguridad', type: 'Protección de pies', description: 'Ejemplo ilustrativo. El modelo y la categoría los determina la evaluación de riesgos.', jobRoleIds: TECH_ROLES, riskTags: ['manipulacion_cargas', 'herramientas'], worksiteIds: [], replacement: { kind: 'not_determined', months: null, setBy: null }, identifierRequired: false, active: true },
    { id: 'eq_casco', companyId: LEV, code: 'EPI-02', name: 'Casco de protección con barboquejo', type: 'Protección de la cabeza', description: 'Ejemplo ilustrativo. Vida útil según el folleto informativo del fabricante.', jobRoleIds: ['jr_tec_mant', 'jr_tec_inst', 'jr_jefe_eq'], riskTags: ['altura'], worksiteIds: [], replacement: { kind: 'per_document', months: null, setBy: 'Folleto informativo del fabricante' }, identifierRequired: true, active: true },
    { id: 'eq_guantes', companyId: LEV, code: 'EPI-03', name: 'Guantes de protección química', type: 'Protección de manos', description: 'Ejemplo ilustrativo. El tipo lo determinan las fichas de datos de seguridad de los productos.', jobRoleIds: CLEAN_ROLES, riskTags: ['quimicos_limpieza'], worksiteIds: [], replacement: none, identifierRequired: false, active: true },
    { id: 'eq_altavis', companyId: LEV, code: 'EPI-04', name: 'Chaleco de alta visibilidad', type: 'Ropa de señalización', description: 'Exigido por el titular para el muelle de carga.', jobRoleIds: [], riskTags: ['trafico_interno'], worksiteIds: ['ws_horta'], replacement: none, identifierRequired: false, active: true },
    { id: 'eq_gafas', companyId: LEV, code: 'EPI-05', name: 'Gafas de protección', type: 'Protección ocular', description: 'Disponible a demanda; no hay un requisito configurado.', jobRoleIds: [], riskTags: ['herramientas'], worksiteIds: [], replacement: none, identifierRequired: false, active: true },
  ];

  // ─────────────────────────────── Documents ───────────────────────────────
  const documents: EvidenceDocument[] = [];
  const docVersions: DocumentVersion[] = [];
  const trainings: TrainingAssignment[] = [];
  const acknowledgements: Acknowledgement[] = [];
  const issues: EquipmentIssue[] = [];
  const requests: EvidenceRequest[] = [];
  let docSeq = 0;
  let dvSeq = 0;
  const empName = (id: ID) => {
    const e = EMPLOYEES.find((x) => x.id === id)!;
    return `${e.first} ${e.last}`;
  };
  const userOf = (id: ID) => EMPLOYEES.find((x) => x.id === id)?.user ?? 'usr_marina';
  const fileOf = (name: string, size = 180_000): DocumentVersion['file'] => ({ name, size, type: 'application/pdf', dataUrl: null });
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const newDoc = (d: Omit<EvidenceDocument, 'code' | 'companyId' | 'createdAt' | 'createdBy'> & Partial<Pick<EvidenceDocument, 'companyId' | 'createdAt' | 'createdBy'>>) => {
    docSeq++;
    const doc: EvidenceDocument = { companyId: LEV, createdAt: T(-300), createdBy: 'usr_marina', code: `DOC-${String(docSeq).padStart(4, '0')}`, ...d };
    documents.push(doc);
    return doc;
  };
  const newVersion = (doc: EvidenceDocument, v: Partial<DocumentVersion> & { status: DocStatus; days: number }) => {
    dvSeq++;
    const n = docVersions.filter((x) => x.documentId === doc.id).length + 1;
    const { days, ...rest } = v;
    const decided = v.status === 'accepted' || v.status === 'rejected' || v.status === 'superseded';
    const row: DocumentVersion = {
      id: `dv_${String(dvSeq).padStart(4, '0')}`,
      companyId: doc.companyId,
      documentId: doc.id,
      version: n,
      issuer: 'Prevención Albufera, S.L.',
      issueDate: D(days - 2),
      expiryMode: 'none',
      legalExpiryDate: null,
      providerReviewDate: null,
      internalFollowUpDate: null,
      receivedAt: T(days, '09:30'),
      submittedBy: 'usr_marina',
      file: fileOf(`${slug(doc.title)}_v${n}.pdf`),
      requirementVersionId: null,
      reviewerId: decided ? 'usr_marina' : null,
      reviewStartedAt: decided || v.status === 'in_review' ? T(days + 1, '09:00') : null,
      reviewedAt: decided ? T(days + 1, '12:00') : null,
      decisionNote: v.status === 'accepted' || v.status === 'superseded' ? 'Comprobados emisor, ámbito y fechas.' : null,
      rejectionReason: null,
      supersededBy: null,
      sourceReference: '',
      notes: '',
      ...rest,
    };
    docVersions.push(row);
    return row;
  };

  // Information sheets and worksite instructions (no employee): acknowledged by workers.
  const infoDoc = (id: ID, title: string, categoryId: string, worksiteId: ID | null, issuer: string, vers: { days: number; status: DocStatus }[]) => {
    const doc = newDoc({ id, title, categoryId, employeeId: null, worksiteId, caseId: null, templateId: null, accessClass: 'ordinary', createdAt: T(vers[0].days) });
    const rows = vers.map((v) => newVersion(doc, { ...v, issuer, reviewerId: v.status === 'received' ? null : 'usr_marina' }));
    for (let k = 0; k < rows.length - 1; k++) if (rows[k].status === 'superseded') rows[k].supersededBy = rows[k + 1].id;
    return rows;
  };
  const [infoTec1, infoTec2] = infoDoc('doc_info_tec', 'Ficha de información de riesgos — puestos técnicos', 'info_riesgos', null, 'Prevención Albufera, S.L.', [{ days: -400, status: 'superseded' }, { days: -30, status: 'accepted' }]);
  const [infoLimp] = infoDoc('doc_info_limp', 'Ficha de información de riesgos — limpieza', 'info_riesgos', null, 'Prevención Albufera, S.L.', [{ days: -21, status: 'accepted' }]);
  const [infoOfi] = infoDoc('doc_info_ofi', 'Ficha de información de riesgos — oficina', 'info_riesgos', null, 'Prevención Albufera, S.L.', [{ days: -380, status: 'accepted' }]);
  const [marblau1, marblau2] = infoDoc('doc_inst_marblau', 'Instrucciones de seguridad para empresas externas — Hotel Mar Blau', 'instruccion_centro', 'ws_marblau', 'Hoteles Mar Blau, S.L.', [{ days: -300, status: 'superseded' }, { days: -25, status: 'accepted' }]);
  const [horta1] = infoDoc('doc_inst_horta', 'Normas de acceso y circulación en el muelle — Supermercados Horta', 'instruccion_centro', 'ws_horta', 'Supermercados Horta, S.A.', [{ days: -280, status: 'accepted' }]);
  const [dental1] = infoDoc('doc_inst_dental', 'Instrucciones de gestión de residuos — Clínica Dental Benimaclet', 'instruccion_centro', 'ws_dental', 'Clínica Dental Benimaclet, S.L.P.', [{ days: -200, status: 'accepted' }]);
  infoDoc('doc_inst_nou', 'Instrucciones de seguridad y plan de emergencia — Residencia Nou Campus', 'instruccion_centro', 'ws_nou', 'Residencias Nou Campus, S.L.', [{ days: -2, status: 'accepted' }]);

  let ackSeq = 0;
  const ack = (empId: ID, doc: ID, dv: DocumentVersion, days: number) => {
    ackSeq++;
    acknowledgements.push({ id: `ack_${String(ackSeq).padStart(4, '0')}`, companyId: LEV, employeeId: empId, subject: { kind: 'document', id: doc }, documentVersionId: dv.id, acknowledgedAt: T(days, '08:15'), method: userOf(empId) === 'usr_marina' && empId !== 'emp_marina' ? 'paper_recorded' : 'in_app', recordedBy: userOf(empId), statement: 'He recibido y leído la información. La confirmación no sustituye a la formación.' });
  };

  /** Evidence document for an employee + requirement. */
  const ev = (empId: ID, key: string, o: { status: DocStatus | 'accepted_old'; days?: number; expiryMode?: DocumentVersion['expiryMode']; legalExpiryDate?: ISODate | null; providerReviewDate?: ISODate | null; rejection?: string; issuer?: string; submittedBy?: ID }) => {
    const v = versions.find((x) => x.id === VER[key])!;
    const tid = TPL[key];
    const old = o.status === 'accepted_old';
    const status: DocStatus = o.status === 'accepted_old' ? 'accepted' : o.status;
    const days = o.days ?? -150;
    const reqVersionId = old ? VER[`${key}#1`] : VER[key];
    const category = v.category === 'authorisation' ? 'autorizacion' : v.category === 'employee_document' ? 'doc_empleado' : 'cert_formacion';
    const doc = newDoc({ id: `doc_${key}_${empId.slice(4)}`, title: `${v.name} — ${empName(empId)}`, categoryId: category, employeeId: empId, worksiteId: null, caseId: null, templateId: tid, accessClass: category === 'doc_empleado' ? 'restricted' : 'ordinary', createdAt: T(days), createdBy: o.submittedBy ?? 'usr_marina' });
    const reviewer = REVIEWER[v.reviewAuthority];
    let providerReviewDate = o.providerReviewDate ?? null;
    const issueDate = D(days - 2);
    if (providerReviewDate === null && v.reviewRule.kind === 'interval' && v.reviewRule.months && (status === 'accepted')) providerReviewDate = addMonths(issueDate, v.reviewRule.months);
    const decided = status !== 'received' && status !== 'in_review';
    const row = newVersion(doc, {
      status,
      days,
      issuer: o.issuer ?? (v.category === 'authorisation' ? 'Mantenimientos Levante, S.L. (con informe del SPA)' : v.category === 'employee_document' ? 'Ministerio de Justicia (aportado por la persona trabajadora)' : courses.find((c) => c.id === v.courseId)?.providerName ?? 'Prevención Albufera, S.L.'),
      expiryMode: o.expiryMode ?? 'none',
      legalExpiryDate: o.legalExpiryDate ?? null,
      providerReviewDate,
      requirementVersionId: reqVersionId,
      submittedBy: o.submittedBy ?? 'usr_marina',
      reviewerId: decided || status === 'in_review' ? reviewer : null,
      rejectionReason: o.rejection ?? null,
      decisionNote: status === 'rejected' ? null : status === 'accepted' ? 'Comprobados emisor, ámbito y fechas.' : null,
    });
    if (v.evidenceMode === 'training' && v.courseId) {
      trainings.push({ id: `trn_${key}_${empId.slice(4)}`, companyId: LEV, employeeId: empId, courseId: v.courseId, templateId: tid, assignedBy: 'usr_marina', assignedAt: T(days - 30), scheduledDate: D(days - 5), attendanceRecordedAt: T(days - 4), attendanceDate: D(days - 5), completionRecordedAt: T(days - 4), completionDate: D(days - 5), hours: courses.find((c) => c.id === v.courseId)?.durationHours ?? null, documentId: doc.id, status: 'completed', note: '' });
    }
    return row;
  };
  const request = (empId: ID, key: string, days: number, followUp: number | null, note = '') => {
    requests.push({ id: `rq_${key}_${empId.slice(4)}`, companyId: LEV, employeeId: empId, worksiteId: null, templateId: TPL[key], requestedBy: 'usr_marina', requestedAt: T(days), followUpDate: followUp === null ? null : D(followUp), note, status: 'open', documentId: null, closedAt: null });
  };
  let issSeq = 0;
  const issue = (empId: ID, item: ID, o: { days?: number; ack?: boolean; replacementDue?: ISODate | null; status?: EquipmentIssue['status']; identifier?: string; size?: string; site?: ID | null } = {}) => {
    issSeq++;
    const row: EquipmentIssue = { id: `iss_${String(issSeq).padStart(4, '0')}`, companyId: LEV, employeeId: empId, itemId: item, identifier: o.identifier ?? (item === 'eq_casco' ? `CAS-${1000 + issSeq}` : ''), size: o.size ?? (item === 'eq_calzado' ? '42' : item === 'eq_guantes' ? 'M' : ''), worksiteId: o.site ?? null, issuedAt: D(o.days ?? -200), issuedBy: 'usr_javier', status: o.status ?? 'issued', returnedAt: null, replacedById: null, replacementDue: o.replacementDue ?? null, documentId: null, note: '' };
    issues.push(row);
    if (o.ack !== false && row.status === 'issued') {
      ackSeq++;
      acknowledgements.push({ id: `ack_${String(ackSeq).padStart(4, '0')}`, companyId: LEV, employeeId: empId, subject: { kind: 'ppe_issue', id: row.id }, documentVersionId: null, acknowledgedAt: at(row.issuedAt, '08:20', TZ), method: userOf(empId) === 'usr_marina' ? 'paper_recorded' : 'in_app', recordedBy: userOf(empId), statement: 'He recibido el equipo y las instrucciones de uso y mantenimiento del fabricante.' });
    }
    return row;
  };

  // ── Technicians
  for (const e of ['emp_elena', 'emp_pablo', 'emp_sergio', 'emp_andres', 'emp_raul']) ack(e, 'doc_info_tec', infoTec2, -28);
  ack('emp_oscar', 'doc_info_tec', infoTec1, -390);
  for (const e of ['emp_elena', 'emp_pablo', 'emp_sergio', 'emp_andres', 'emp_raul', 'emp_oscar']) ev(e, 'prl_inicial', { status: 'accepted', days: -600 });
  ev('emp_elena', 'altura', { status: 'accepted', days: -40, providerReviewDate: D(20) });
  ev('emp_pablo', 'altura', { status: 'accepted_old', days: -320 });
  ev('emp_sergio', 'altura', { status: 'accepted_old', days: -250 });
  ev('emp_andres', 'altura', { status: 'accepted_old', days: -380, providerReviewDate: D(12) });
  ev('emp_oscar', 'altura', { status: 'received', days: -3 });
  for (const e of ['emp_elena', 'emp_pablo', 'emp_sergio', 'emp_andres', 'emp_oscar']) ev(e, 'electrico', { status: 'accepted', days: -330 });
  for (const e of ['emp_elena', 'emp_pablo', 'emp_sergio', 'emp_andres', 'emp_ivan', 'emp_oscar']) issue(e, 'eq_calzado', { days: e === 'emp_ivan' ? -130 : -260 });
  issue('emp_raul', 'eq_calzado', { days: -9, ack: false });
  for (const e of ['emp_pablo', 'emp_andres', 'emp_oscar']) issue(e, 'eq_casco', { days: -240, replacementDue: '2029-03-31' });
  issue('emp_sergio', 'eq_casco', { days: -900, replacementDue: D(10) });
  issue('emp_ivan', 'eq_casco', { days: -2, ack: false, replacementDue: '2030-05-31' });
  ack('emp_sergio', 'doc_inst_marblau', marblau1, -290);
  for (const e of ['emp_elena', 'emp_ivan']) ack(e, 'doc_inst_marblau', marblau2, -20);
  ack('emp_sergio', 'doc_inst_horta', horta1, -270);
  issue('emp_sergio', 'eq_altavis', { days: -270, site: 'ws_horta' });
  issue('emp_ivan', 'eq_altavis', { days: -2, ack: false, site: 'ws_horta' });
  ack('emp_raul', 'doc_inst_dental', dental1, -190);
  ack('emp_oscar', 'doc_inst_dental', dental1, -190);
  ev('emp_oscar', 'biologico', { status: 'accepted', days: -720, expiryMode: 'date', legalExpiryDate: D(-10), issuer: 'Prevención Albufera, S.L. (certificado con validez de 2 años indicada por el emisor)' });
  for (const e of ['emp_elena', 'emp_pablo', 'emp_andres']) ev(e, 'delitos', { status: 'accepted', days: -400, submittedBy: userOf(e) });
  request('emp_ivan', 'prl_inicial', -10, 5, 'Curso programado en la próxima convocatoria.');
  request('emp_ivan', 'electrico', -10, 10);
  request('emp_raul', 'biologico', -12, 4);

  // ── Cleaning
  for (const e of ['emp_amparo', 'emp_lucia', 'emp_rocio', 'emp_fatima', 'emp_carmen', 'emp_daniela', 'emp_josemi']) ack(e, 'doc_info_limp', infoLimp, -18);
  for (const e of ['emp_amparo', 'emp_lucia', 'emp_rocio', 'emp_fatima', 'emp_carmen', 'emp_daniela', 'emp_josemi']) ev(e, 'prl_inicial', { status: 'accepted', days: -500 });
  ev('emp_nerea', 'prl_inicial', { status: 'received', days: -2 });
  for (const e of ['emp_amparo', 'emp_rocio', 'emp_carmen']) ev(e, 'quimicos', { status: 'accepted_old', days: -260 });
  for (const e of ['emp_lucia', 'emp_daniela', 'emp_josemi']) ev(e, 'quimicos', { status: 'accepted', days: -12 });
  ev('emp_fatima', 'quimicos', { status: 'rejected', days: -9, rejection: 'El certificado corresponde al curso anterior (no incluye los nuevos desinfectantes).' });
  request('emp_nerea', 'quimicos', -6, 8);
  for (const e of ['emp_amparo', 'emp_lucia', 'emp_rocio', 'emp_fatima', 'emp_carmen', 'emp_josemi', 'emp_nerea']) issue(e, 'eq_guantes', { days: -60 });
  issue('emp_daniela', 'eq_guantes', { days: -60, status: 'lost' });
  requests.push({ id: 'rq_guantes_daniela', companyId: LEV, employeeId: 'emp_daniela', worksiteId: null, templateId: TPL.guantes, requestedBy: 'usr_amparo', requestedAt: T(-1), followUpDate: D(2), note: 'Guantes deteriorados: solicitar reposición.', status: 'open', documentId: null, closedAt: null });
  for (const e of ['emp_amparo', 'emp_rocio', 'emp_daniela', 'emp_elena']) if (e !== 'emp_elena') ack(e, 'doc_inst_marblau', marblau2, -20);
  ack('emp_carmen', 'doc_inst_marblau', marblau1, -280);
  for (const e of ['emp_amparo', 'emp_josemi']) {
    ack(e, 'doc_inst_horta', horta1, -270);
    issue(e, 'eq_altavis', { days: -270, site: 'ws_horta' });
  }
  for (const e of ['emp_amparo', 'emp_lucia']) ack(e, 'doc_inst_dental', dental1, -190);
  ev('emp_amparo', 'biologico', { status: 'accepted', days: -100, expiryMode: 'none' });
  ev('emp_lucia', 'biologico', { status: 'accepted', days: -80, expiryMode: 'unknown' });
  ev('emp_fatima', 'delitos', { status: 'accepted', days: -380, submittedBy: 'usr_amparo' });
  ev('emp_amparo', 'delitos', { status: 'in_review', days: -4, submittedBy: 'usr_amparo' });

  // ── Office
  for (const e of ['emp_javier', 'emp_marta', 'emp_marina']) {
    ack(e, 'doc_info_ofi', infoOfi, -360);
    ev(e, 'prl_inicial', { status: 'accepted', days: -400 });
  }
  ev('emp_javier', 'pvd', { status: 'accepted', days: -300 });
  ev('emp_javier', 'auxilios', { status: 'accepted', days: -200 });
  ev('emp_marina', 'auxilios', { status: 'received', days: -5 });

  // Training assignments without evidence yet (attendance / completion are separate facts).
  const trn = (id: string, empId: ID, course: ID, key: string, status: TrainingAssignment['status'], o: Partial<TrainingAssignment> = {}) =>
    trainings.push({ id, companyId: LEV, employeeId: empId, courseId: course, templateId: TPL[key], assignedBy: 'usr_marina', assignedAt: T(-10), scheduledDate: null, attendanceRecordedAt: null, attendanceDate: null, completionRecordedAt: null, completionDate: null, hours: null, documentId: null, status, note: '', ...o });
  trn('trn_altura_ivan', 'emp_ivan', 'crs_altura', 'altura', 'scheduled', { scheduledDate: D(6), note: 'Convocatoria de Formación Segura Turia.' });
  trn('trn_prl_ivan', 'emp_ivan', 'crs_prl_puesto', 'prl_inicial', 'scheduled', { scheduledDate: D(2) });
  trn('trn_quimicos_nerea', 'emp_nerea', 'crs_quimicos', 'quimicos', 'assigned');
  trn('trn_biologico_raul', 'emp_raul', 'crs_biologico', 'biologico', 'attended', { attendanceRecordedAt: T(-1), attendanceDate: D(-1), note: 'Asistió a la sesión en línea; falta la prueba final.' });
  trn('trn_quimicos_amparo_v2', 'emp_amparo', 'crs_quimicos', 'quimicos', 'scheduled', { scheduledDate: D(9) });

  // Ibaigane (isolation tests).
  {
    const doc: EvidenceDocument = { id: 'doc_iba_altura_ane', companyId: IBA, code: 'DOC-IBA-0001', categoryId: 'cert_formacion', title: 'Formación en trabajos en altura — Ane Zubizarreta Goikoetxea', employeeId: 'emp_ane', worksiteId: null, caseId: null, templateId: TPL.iba_altura, accessClass: 'ordinary', createdAt: T(-200), createdBy: 'usr_iker' };
    documents.push(doc);
    docVersions.push({ id: 'dv_iba_0001', companyId: IBA, documentId: doc.id, version: 1, issuer: 'Prevención Albufera, S.L.', issueDate: D(-202), expiryMode: 'none', legalExpiryDate: null, providerReviewDate: null, internalFollowUpDate: null, receivedAt: T(-200), submittedBy: 'usr_iker', file: fileOf('formacion_altura_ane.pdf'), status: 'accepted', requirementVersionId: VER.iba_altura, reviewerId: 'usr_jorge', reviewStartedAt: T(-199), reviewedAt: T(-199), decisionNote: 'Correcto.', rejectionReason: null, supersededBy: null, sourceReference: '', notes: '' });
  }

  // ─────────────────────────────── Risk assessments ───────────────────────────────
  const raDoc = (id: ID, title: string, site: ID | null, days: number, status: DocStatus = 'accepted', companyId: ID = LEV) => {
    const doc = newDoc({ id, title, categoryId: 'evaluacion_riesgos', employeeId: null, worksiteId: site, caseId: null, templateId: null, accessClass: 'ordinary', createdAt: T(days), companyId, createdBy: companyId === LEV ? 'usr_marina' : 'usr_iker' });
    newVersion(doc, { status, days, issuer: 'Prevención Albufera, S.L.', reviewerId: status === 'accepted' ? 'usr_jorge' : null });
    return doc.id;
  };
  const hz = (riskTag: string, description: string, measures: string, i: number) => ({ id: `hz_${i}`, riskTag, description, measures });
  const ra = (p: Partial<RiskAssessment> & Pick<RiskAssessment, 'id' | 'code' | 'title' | 'activity' | 'status'>): RiskAssessment => ({
    companyId: LEV,
    worksiteId: null,
    jobRoleIds: [],
    providerId: 'prv_albufera',
    assessorName: 'Jorge Sanz Albert (técnico superior en PRL)',
    version: 1,
    supersedesId: null,
    issueDate: null,
    effectiveDate: null,
    reviewDate: null,
    hazards: [],
    preventiveMeasures: '',
    documentId: null,
    ownerUserId: 'usr_marina',
    linkedTemplateIds: [],
    reviewNote: null,
    reviewedBy: p.status === 'accepted' || p.status === 'superseded' || p.status === 'review_required' ? 'usr_jorge' : null,
    reviewedAt: null,
    createdBy: 'usr_marina',
    createdAt: T(-300),
    ...p,
  });
  const assessments: RiskAssessment[] = [
    ra({ id: 'ra_001', code: 'ER-001', title: 'Evaluación de riesgos — puestos de mantenimiento técnico', activity: 'Mantenimiento de instalaciones en edificios de clientes', jobRoleIds: ['jr_tec_mant', 'jr_tec_inst', 'jr_jefe_eq'], status: 'accepted', issueDate: '2025-01-10', effectiveDate: '2025-01-15', hazards: [hz('altura', 'Caída a distinto nivel desde escaleras y cubiertas', 'Escaleras con marcado y revisión; formación específica; casco con barboquejo.', 1), hz('electrico_bt', 'Contacto eléctrico en cuadros de baja tensión', 'Trabajos sin tensión; autorización según RD 614/2001.', 2), hz('manipulacion_cargas', 'Sobreesfuerzos con equipos y materiales', 'Ayudas mecánicas y trabajo en pareja para cargas pesadas.', 3)], preventiveMeasures: 'Ver planificación 2025-2026. La periodicidad de revisión no está establecida por el evaluador.', documentId: raDoc('doc_ra_001', 'ER-001 Evaluación de riesgos — mantenimiento técnico', null, -640), linkedTemplateIds: ['tpl_altura', 'tpl_electrico', 'tpl_calzado', 'tpl_casco'], reviewedAt: T(-630), createdAt: T(-640) }),
    ra({ id: 'ra_002a', code: 'ER-002', title: 'Evaluación de riesgos — puestos de limpieza', activity: 'Limpieza de locales y zonas comunes', jobRoleIds: CLEAN_ROLES, status: 'superseded', issueDate: '2024-01-08', effectiveDate: '2024-01-15', hazards: [hz('quimicos_limpieza', 'Exposición a productos de limpieza', 'Fichas de datos de seguridad; guantes; formación.', 1)], documentId: raDoc('doc_ra_002a', 'ER-002 v1 Evaluación de riesgos — limpieza', null, -1000, 'superseded'), reviewedAt: T(-990), createdAt: T(-1000) }),
    ra({ id: 'ra_002', code: 'ER-002', version: 2, supersedesId: 'ra_002a', title: 'Evaluación de riesgos — puestos de limpieza', activity: 'Limpieza de locales y zonas comunes', jobRoleIds: CLEAN_ROLES, status: 'accepted', issueDate: D(-24), effectiveDate: D(-20), reviewDate: addMonths(D(-24), 12), hazards: [hz('quimicos_limpieza', 'Exposición a nuevos desinfectantes (cambio de proveedor)', 'Actualizar formación; guantes de nitrilo según las fichas de seguridad; prohibición de mezclas.', 1), hz('caidas_mismo_nivel', 'Resbalones en suelos mojados', 'Señalización de suelo mojado; calzado antideslizante.', 2), hz('manipulacion_cargas', 'Carros y bolsas de residuos', 'Carros con ruedas en buen estado; limitar el peso de las bolsas.', 3)], preventiveMeasures: 'El evaluador fija una revisión a los 12 meses por el cambio de productos.', documentId: raDoc('doc_ra_002', 'ER-002 v2 Evaluación de riesgos — limpieza', null, -24), linkedTemplateIds: ['tpl_quimicos', 'tpl_guantes'], reviewedAt: T(-22), createdAt: T(-24) }),
    ra({ id: 'ra_003', code: 'ER-003', title: 'Evaluación de riesgos — oficina', activity: 'Trabajo administrativo con pantallas', jobRoleIds: ['jr_admin', 'jr_coord'], status: 'accepted', issueDate: '2025-02-01', effectiveDate: '2025-02-01', hazards: [hz('pvd', 'Fatiga visual y postural', 'Pausas, ajuste del puesto, formación recomendada.', 1)], documentId: raDoc('doc_ra_003', 'ER-003 Evaluación de riesgos — oficina', 'ws_oficina', -620), reviewedAt: T(-610), createdAt: T(-620) }),
    ra({ id: 'ra_004', code: 'ER-004', title: 'Actividad en Hotel Mar Blau (cocinas y lavandería)', activity: 'Limpieza y mantenimiento en zonas de servicio del hotel', worksiteId: 'ws_marblau', status: 'accepted', issueDate: D(-26), effectiveDate: D(-25), hazards: [hz('cocina_industrial', 'Quemaduras con superficies calientes en cocina', 'Coordinar horarios con cocina; instrucciones del titular.', 1)], documentId: raDoc('doc_ra_004', 'ER-004 Actividad en Hotel Mar Blau', 'ws_marblau', -26), reviewedAt: T(-24), createdAt: T(-26) }),
    ra({ id: 'ra_005', code: 'ER-005', title: 'Supermercados Horta — limpieza y mantenimiento en muelle', activity: 'Trabajos en el muelle de carga', worksiteId: 'ws_horta', status: 'under_review', issueDate: D(-7), hazards: [hz('trafico_interno', 'Atropello por vehículos de reparto y carretillas del titular', 'Coordinar horarios; chaleco de alta visibilidad; zonas señalizadas.', 1)], documentId: raDoc('doc_ra_005', 'ER-005 Supermercados Horta (borrador)', 'ws_horta', -7, 'in_review'), linkedTemplateIds: ['tpl_altavis'], createdAt: T(-7) }),
    ra({ id: 'ra_006', code: 'ER-006', title: 'Clínica Dental Benimaclet — residuos y riesgo biológico', activity: 'Limpieza de consultas y retirada de residuos', worksiteId: 'ws_dental', status: 'review_required', issueDate: '2025-03-12', effectiveDate: '2025-03-15', hazards: [hz('riesgo_biologico', 'Pinchazos con material desechado incorrectamente', 'Contenedores rígidos; guantes; protocolo de actuación.', 1)], reviewNote: 'El titular ha reformado la sala de esterilización (CAE): el evaluador debe revisar la evaluación (RD 39/1997, art. 4.2).', documentId: raDoc('doc_ra_006', 'ER-006 Clínica Dental Benimaclet', 'ws_dental', -575), linkedTemplateIds: ['tpl_biologico'], reviewedAt: T(-570), createdAt: T(-575) }),
    ra({ id: 'ra_007', code: 'ER-007', title: 'Residencia Nou Campus — climatización y alumbrado del atrio', activity: 'Mantenimiento con plataforma elevadora en el atrio', worksiteId: 'ws_nou', status: 'draft', hazards: [hz('altura', 'Trabajo en plataforma elevadora en el atrio', 'Operador formado; balizamiento de la zona; coordinación con el titular.', 1)], linkedTemplateIds: ['tpl_pemp'], createdAt: T(-2) }),
    ra({ id: 'ra_iba', companyId: IBA, code: 'ER-IBA-01', title: 'Evaluación de riesgos — técnicos de climatización', activity: 'Instalaciones', jobRoleIds: ['jr_iba_tec'], status: 'accepted', issueDate: '2025-01-20', effectiveDate: '2025-01-20', ownerUserId: 'usr_iker', createdBy: 'usr_iker', providerId: 'prv_iba', documentId: raDoc('doc_ra_iba', 'ER-IBA-01 Evaluación de riesgos', null, -600, 'accepted', IBA), reviewedAt: T(-590) }),
  ];

  // ─────────────────────────────── Preventive actions ───────────────────────────────
  const note = (days: number, by: ID, kind: ActionNote['kind'], text: string): ActionNote => ({ at: T(days, '11:00'), by, kind, text });
  const act = (p: Partial<PreventiveAction> & Pick<PreventiveAction, 'id' | 'code' | 'title' | 'status'>): PreventiveAction => ({
    companyId: LEV,
    description: '',
    source: { kind: 'other', refId: null, label: '' },
    employeeId: null,
    jobRoleId: null,
    worksiteId: null,
    priority: 'medium',
    ownerUserId: null,
    targetDate: null,
    targetJustification: '',
    requiredEvidence: '',
    evidenceRequired: true,
    reviewAuthority: 'coordinator',
    affectsReadiness: false,
    evidenceDocumentIds: [],
    resolutionNote: null,
    notes: [],
    createdBy: 'usr_marina',
    createdAt: T(-30),
    resolvedAt: null,
    ...p,
  });
  const evidenceDoc = (id: ID, title: string, site: ID | null, days: number, status: DocStatus) => {
    const doc = newDoc({ id, title, categoryId: 'evidencia_accion', employeeId: null, worksiteId: site, caseId: null, templateId: null, accessClass: 'ordinary', createdAt: T(days) });
    newVersion(doc, { status, days, issuer: 'Mantenimientos Levante, S.L.', reviewerId: status === 'received' ? null : 'usr_marina' });
    return doc.id;
  };
  const actions: PreventiveAction[] = [
    act({ id: 'act_001', code: 'AP-001', title: 'Sustituir la escalera de tijera dañada del almacén', description: 'La visita técnica detectó un peldaño deformado.', source: { kind: 'provider_review', refId: null, label: 'Visita técnica del SPA' }, worksiteId: 'ws_oficina', priority: 'high', ownerUserId: 'usr_javier', targetDate: D(-5), targetJustification: 'Plazo propuesto por el SPA en el informe de visita.', requiredEvidence: 'Albarán o foto de la escalera nueva y retirada de la dañada.', status: 'in_progress', notes: [note(-30, 'usr_marina', 'created', 'Creada desde el informe de visita.'), note(-29, 'usr_marina', 'assigned', 'Asignada a Javier Ortega.'), note(-8, 'usr_javier', 'progress', 'Pedido realizado al proveedor.')], createdAt: T(-30) }),
    act({ id: 'act_002', code: 'AP-002', title: 'Señalizar la zona de limpieza en el muelle de carga', description: 'Durante la limpieza del muelle no hay separación con los vehículos de reparto.', source: { kind: 'risk_assessment', refId: 'ra_005', label: 'ER-005 (borrador)' }, worksiteId: 'ws_horta', ownerUserId: 'usr_elena', targetDate: D(10), targetJustification: 'Antes del inicio del nuevo turno de limpieza del muelle.', requiredEvidence: 'Foto de la señalización y confirmación del titular.', status: 'assigned', reviewAuthority: 'provider_technical', notes: [note(-6, 'usr_marina', 'created', 'Creada desde ER-005.'), note(-6, 'usr_marina', 'assigned', 'Asignada a Elena Navarro.')], createdAt: T(-6) }),
    act({ id: 'act_003', code: 'AP-003', title: 'Formación en altura de Iván Castelló antes de asignarle trabajos en altura', source: { kind: 'requirement_gap', refId: 'tpl_altura', label: 'REQ-005 sin evidencia' }, employeeId: 'emp_ivan', priority: 'high', ownerUserId: 'usr_marina', targetDate: D(6), targetJustification: 'Fecha del curso programado.', requiredEvidence: 'Certificado del curso aceptado por el SPA.', status: 'assigned', reviewAuthority: 'provider_technical', notes: [note(-3, 'usr_marina', 'created', 'Creada desde la revisión de cambios.')], createdAt: T(-3) }),
    act({ id: 'act_004', code: 'AP-004', title: 'Revisar la evaluación de la clínica tras la reforma de la sala de esterilización', source: { kind: 'cae', refId: 'cae_003', label: 'Información recibida del titular' }, worksiteId: 'ws_dental', priority: 'medium', status: 'open', reviewAuthority: 'provider_technical', requiredEvidence: 'Nueva versión de ER-006 aceptada.', notes: [note(-12, 'usr_marina', 'created', 'El titular comunicó la reforma.')], createdAt: T(-12) }),
    act({ id: 'act_005', code: 'AP-005', title: 'Reponer el botiquín de la furgoneta 2', source: { kind: 'review_finding', refId: null, label: 'Revisión interna' }, priority: 'low', ownerUserId: 'usr_javier', targetDate: D(-40), targetJustification: 'Revisión mensual de botiquines.', requiredEvidence: 'Foto del botiquín repuesto.', status: 'resolved', evidenceDocumentIds: [evidenceDoc('doc_ev_botiquin', 'Foto del botiquín repuesto (furgoneta 2)', null, -45, 'accepted')], resolutionNote: 'Repuesto y comprobado.', notes: [note(-50, 'usr_marina', 'created', 'Detectado en la revisión mensual.'), note(-45, 'usr_javier', 'submitted', 'Botiquín repuesto.'), note(-44, 'usr_marina', 'accepted', 'Comprobado.')], resolvedAt: T(-44), createdAt: T(-50) }),
    act({ id: 'act_006', code: 'AP-006', title: 'Punto de lavado de ojos en la lavandería del hotel', description: 'El titular instalará un lavaojos portátil; comprobar su ubicación y señalización.', source: { kind: 'cae', refId: 'cae_001', label: 'Reunión de coordinación' }, worksiteId: 'ws_marblau', ownerUserId: 'usr_amparo', targetDate: D(3), targetJustification: 'Acordado en la reunión de coordinación.', requiredEvidence: 'Foto del lavaojos instalado y señalizado.', status: 'pending_review', reviewAuthority: 'provider_technical', evidenceDocumentIds: [evidenceDoc('doc_ev_lavaojos', 'Foto del lavaojos instalado (lavandería)', 'ws_marblau', -1, 'received')], notes: [note(-20, 'usr_marina', 'created', 'Acordado con el hotel.'), note(-20, 'usr_marina', 'assigned', 'Asignada a Amparo Ribes.'), note(-1, 'usr_amparo', 'submitted', 'Instalado y señalizado; adjunto foto.')], createdAt: T(-20) }),
    act({ id: 'act_007', code: 'AP-007', title: 'Orden y limpieza del cuarto de productos (Coworking)', source: { kind: 'review_finding', refId: null, label: 'Visita de la coordinadora' }, worksiteId: 'ws_cowork', ownerUserId: 'usr_amparo', targetDate: D(4), targetJustification: 'Nueva visita prevista.', requiredEvidence: 'Foto del cuarto ordenado con productos etiquetados.', status: 'reopened', evidenceDocumentIds: [evidenceDoc('doc_ev_cuarto', 'Foto del cuarto de productos', 'ws_cowork', -10, 'rejected')], notes: [note(-25, 'usr_marina', 'created', 'Productos sin etiquetar en envases reutilizados.'), note(-10, 'usr_amparo', 'submitted', 'Ordenado.'), note(-9, 'usr_marina', 'rejected', 'Siguen dos envases sin etiqueta original.')], createdAt: T(-25) }),
    act({ id: 'act_008', code: 'AP-008', title: 'Reparar la iluminación de emergencia del cuarto técnico (Coworking)', description: 'Según la política aprobada por el SPA, no se asignan trabajos en el cuarto técnico hasta repararla.', source: { kind: 'provider_review', refId: null, label: 'Visita técnica del SPA' }, worksiteId: 'ws_cowork', priority: 'high', ownerUserId: 'usr_elena', targetDate: D(7), targetJustification: 'Disponibilidad del electricista del titular.', requiredEvidence: 'Parte de reparación y comprobación de funcionamiento.', status: 'in_progress', reviewAuthority: 'provider_technical', affectsReadiness: true, notes: [note(-4, 'usr_jorge', 'created', 'Condiciona la asignación al centro.'), note(-4, 'usr_marina', 'assigned', 'Asignada a Elena Navarro.')], createdBy: 'usr_jorge', createdAt: T(-4) }),
  ];

  // ─────────────────────────────── CAE ───────────────────────────────
  const own = (id: string, contact = 'Marina Peris Climent'): CaeCase['participants'][number] => ({ id, organisation: 'Mantenimientos Levante, S.L.', role: 'contratista', contactName: contact, contactEmail: 'marina.peris@mantenimientoslevante.example', isOwnCompany: true });
  const caeCases: CaeCase[] = [
    { id: 'cae_001', companyId: LEV, code: 'CAE-001', worksiteId: 'ws_marblau', title: 'Coordinación con Hotel Mar Blau', status: 'active', participants: [{ id: 'p1', organisation: 'Hoteles Mar Blau, S.L.', role: 'titular', contactName: 'Núria Ferrando', contactEmail: 'mantenimiento@marblau.example', isOwnCompany: false }, own('p2'), { id: 'p3', organisation: 'Ascensores Mediterráneo, S.L.', role: 'concurrente', contactName: 'Toni Vives', contactEmail: 'tvives@ascensoresmed.example', isOwnCompany: false }], activities: 'Limpieza de habitaciones y zonas comunes; mantenimiento de climatización; mantenimiento de ascensores (empresa concurrente).', risksSummary: 'Cocinas y lavandería (titular); productos químicos (nuestra actividad); trabajos en cuarto de máquinas de ascensores (concurrente).', coordinationMeans: 'Intercambio de información por escrito e instrucciones del titular; reunión trimestral.', followUpOwnerId: 'usr_marina', nextFollowUp: D(5), openQuestions: '¿Horario de mantenimiento de ascensores coincide con la limpieza de la planta 0?', createdBy: 'usr_marina', createdAt: T(-310), closedAt: null },
    { id: 'cae_002', companyId: LEV, code: 'CAE-002', worksiteId: 'ws_horta', title: 'Coordinación con Supermercados Horta', status: 'active', participants: [{ id: 'p1', organisation: 'Supermercados Horta, S.A.', role: 'titular', contactName: 'Rafael Soler', contactEmail: 'seguridad@superhorta.example', isOwnCompany: false }, own('p2', 'Elena Navarro Gil')], activities: 'Limpieza de sala y muelle; mantenimiento de cámaras frigoríficas.', risksSummary: 'Tráfico de vehículos y carretillas del titular en el muelle; frío en cámaras.', coordinationMeans: 'Instrucciones del titular e intercambio de información.', followUpOwnerId: 'usr_elena', nextFollowUp: D(3), openQuestions: 'Confirmar franja horaria sin carga y descarga para la limpieza del muelle.', createdBy: 'usr_marina', createdAt: T(-290), closedAt: null },
    { id: 'cae_003', companyId: LEV, code: 'CAE-003', worksiteId: 'ws_dental', title: 'Coordinación con Clínica Dental Benimaclet', status: 'active', participants: [{ id: 'p1', organisation: 'Clínica Dental Benimaclet, S.L.P.', role: 'titular', contactName: 'Dra. Paula Cerdà', contactEmail: 'direccion@dentalbenimaclet.example', isOwnCompany: false }, own('p2', 'Amparo Ribes Bosch')], activities: 'Limpieza de consultas; fontanería puntual.', risksSummary: 'Residuos sanitarios y material punzante.', coordinationMeans: 'Instrucciones del titular.', followUpOwnerId: 'usr_marina', nextFollowUp: D(14), openQuestions: '', createdBy: 'usr_marina', createdAt: T(-210), closedAt: null },
    { id: 'cae_004', companyId: LEV, code: 'CAE-004', worksiteId: 'ws_nou', title: 'Inicio de actividad en Residencia Nou Campus', status: 'open', participants: [{ id: 'p1', organisation: 'Residencias Nou Campus, S.L.', role: 'titular', contactName: 'Marc Gil', contactEmail: 'instalaciones@noucampus.example', isOwnCompany: false }, own('p2', 'Elena Navarro Gil')], activities: 'Mantenimiento de climatización y alumbrado del atrio con plataforma elevadora.', risksSummary: 'Pendiente de recibir la información de riesgos del titular sobre el atrio y las cocinas.', coordinationMeans: 'Pendiente de acordar.', followUpOwnerId: 'usr_elena', nextFollowUp: D(1), openQuestions: 'Solicitar al titular la información de riesgos del atrio y su plan de emergencia completo. Enviar ER-007 cuando el SPA la acepte.', createdBy: 'usr_marina', createdAt: T(-2), closedAt: null },
  ];
  const xch = (p: Partial<CaeExchange> & Pick<CaeExchange, 'id' | 'caseId' | 'direction' | 'subject' | 'senderParticipantId' | 'recipientParticipantId'>): CaeExchange => ({ companyId: LEV, documentId: null, documentVersionId: null, versionLabel: 'v1', sentAt: null, receivedAt: null, receiptConfirmedBy: null, acknowledgedAt: null, review: 'not_required', reviewedBy: null, reviewNote: null, followUp: '', createdBy: 'usr_marina', createdAt: T(-30), ...p });
  const raV = (docId: ID) => docVersions.filter((x) => x.documentId === docId).pop()!;
  const caeExchanges: CaeExchange[] = [
    xch({ id: 'x_001', caseId: 'cae_001', direction: 'received', subject: 'Instrucciones de seguridad para empresas externas (v2)', documentId: 'doc_inst_marblau', documentVersionId: marblau2.id, versionLabel: 'v2', senderParticipantId: 'p1', recipientParticipantId: 'p2', sentAt: T(-26), receivedAt: T(-25), receiptConfirmedBy: 'Marina Peris Climent', review: 'accepted', reviewedBy: 'usr_marina', reviewNote: 'Transmitidas al personal asignado (REQ-014).', createdAt: T(-25) }),
    xch({ id: 'x_002', caseId: 'cae_001', direction: 'sent', subject: 'Evaluación de riesgos de los puestos de limpieza (ER-002 v2)', documentId: 'doc_ra_002', documentVersionId: raV('doc_ra_002').id, versionLabel: 'v2', senderParticipantId: 'p2', recipientParticipantId: 'p1', sentAt: T(-15), receivedAt: T(-14), receiptConfirmedBy: 'Núria Ferrando', acknowledgedAt: T(-10), createdAt: T(-15) }),
    xch({ id: 'x_003', caseId: 'cae_001', direction: 'received', subject: 'Información de riesgos del cuarto de máquinas de ascensores', senderParticipantId: 'p3', recipientParticipantId: 'p2', sentAt: T(-6), receivedAt: T(-6), receiptConfirmedBy: 'Marina Peris Climent', review: 'pending', createdAt: T(-6) }),
    xch({ id: 'x_004', caseId: 'cae_001', direction: 'sent', subject: 'Relación de personal asignado y formación acreditada', versionLabel: 'v1', senderParticipantId: 'p2', recipientParticipantId: 'p1', sentAt: T(-3), createdAt: T(-3), followUp: 'Pedir confirmación de recepción.' }),
    xch({ id: 'x_005', caseId: 'cae_002', direction: 'received', subject: 'Normas de acceso y circulación en el muelle', documentId: 'doc_inst_horta', documentVersionId: horta1.id, senderParticipantId: 'p1', recipientParticipantId: 'p2', sentAt: T(-281), receivedAt: T(-280), receiptConfirmedBy: 'Elena Navarro Gil', review: 'accepted', reviewedBy: 'usr_marina', reviewNote: 'Correcto.', createdAt: T(-280) }),
    xch({ id: 'x_006', caseId: 'cae_002', direction: 'sent', subject: 'Planificación de la limpieza del muelle', senderParticipantId: 'p2', recipientParticipantId: 'p1', sentAt: T(-20), receivedAt: T(-19), receiptConfirmedBy: 'Rafael Soler', createdAt: T(-20), followUp: 'Esperando acuse de comprensión y confirmación de horarios.' }),
    xch({ id: 'x_007', caseId: 'cae_003', direction: 'received', subject: 'Comunicación de la reforma de la sala de esterilización', senderParticipantId: 'p1', recipientParticipantId: 'p2', sentAt: T(-12), receivedAt: T(-12), receiptConfirmedBy: 'Amparo Ribes Bosch', review: 'accepted', reviewedBy: 'usr_marina', reviewNote: 'Genera AP-004 (revisión de ER-006).', createdAt: T(-12) }),
    xch({ id: 'x_008', caseId: 'cae_004', direction: 'received', subject: 'Instrucciones de seguridad y plan de emergencia', documentId: 'doc_inst_nou', documentVersionId: raV('doc_inst_nou').id, senderParticipantId: 'p1', recipientParticipantId: 'p2', sentAt: T(-2), receivedAt: T(-2), receiptConfirmedBy: 'Elena Navarro Gil', review: 'accepted', reviewedBy: 'usr_marina', reviewNote: 'Falta la información de riesgos del atrio.', createdAt: T(-2) }),
  ];
  const shareLinks = [
    { id: 'lnk_001', companyId: LEV, caseId: 'cae_001', recipientParticipantId: 'p1', token: 'demo-7f3a2c91', documentVersionIds: [raV('doc_ra_002').id], createdBy: 'usr_marina', createdAt: T(-15), expiresOn: D(15), revokedAt: null, accessLog: [T(-14, '16:20')] },
  ];

  // ─────────────────────────────── Health (restricted) ───────────────────────────────
  const healthOffers: HealthOffer[] = [];
  const healthConclusions: HealthConclusion[] = [];
  const offer = (empId: ID, response: HealthOffer['response'], days = -120) => {
    const id = `ho_${empId.slice(4)}`;
    healthOffers.push({ id, companyId: LEV, employeeId: empId, templateId: TPL.vs_oferta, basis: 'voluntary', offeredAt: D(days), offeredBy: 'usr_marina', response, respondedAt: response === 'pending' ? null : D(days + 5), recordedBy: response === 'pending' ? null : 'usr_clara' });
    return id;
  };
  const conclude = (empId: ID, conclusion: HealthConclusion['conclusion'], o: Partial<HealthConclusion> = {}) => {
    const offerId = offer(empId, 'accepted');
    if (conclusion) healthConclusions.push({ id: `hc_${empId.slice(4)}`, companyId: LEV, employeeId: empId, offerId, providerId: 'prv_albufera', scope: 'Puesto actual según el protocolo del servicio médico', conclusion, measures: '', conclusionDate: D(-100), nextReviewDate: null, clinicalRecordReference: `Historia clínico-laboral custodiada por Prevención Albufera (ref. HCL-${empId.slice(4).toUpperCase()})`, recordedBy: 'usr_clara', recordedAt: T(-100), measuresConfirmedAt: null, measuresConfirmedBy: null, status: 'current', ...o });
  };
  for (const e of ['emp_elena', 'emp_pablo', 'emp_amparo', 'emp_fatima', 'emp_josemi', 'emp_marta', 'emp_marina']) conclude(e, 'fit');
  conclude('emp_carmen', 'fit', { nextReviewDate: D(25) });
  conclude('emp_raul', 'fit_with_measures', { measures: 'Evitar la manipulación manual de cargas superiores a 15 kg sin ayuda mecánica.' });
  offer('emp_oscar', 'accepted', -20);
  for (const e of ['emp_sergio', 'emp_lucia', 'emp_javier']) offer(e, 'declined');
  for (const e of ['emp_andres', 'emp_rocio', 'emp_nerea']) offer(e, 'pending', -15);

  // Clinical document uploaded by mistake: quarantined, never shown in ordinary lists.
  const qDoc = newDoc({ id: 'doc_q_rocio', title: 'Informe médico revisión (subido por error)', categoryId: 'otros', employeeId: 'emp_rocio', worksiteId: null, caseId: null, templateId: null, accessClass: 'quarantined', createdAt: T(-4), createdBy: 'usr_amparo' });
  const qVer = newVersion(qDoc, { status: 'received', days: -4, issuer: '—', submittedBy: 'usr_amparo', reviewerId: null, file: { name: 'informe_medico_rocio.pdf', size: 240_000, type: 'application/pdf', dataUrl: null } });
  const quarantine = [{ id: 'q_001', companyId: LEV, documentId: qDoc.id, documentVersionId: qVer.id, detectedBy: 'keyword' as const, quarantinedAt: T(-4, '10:05'), uploaderId: 'usr_amparo', status: 'quarantined' as const, handledBy: null, handledAt: null, note: null }];

  // ─────────────────────────────── Decisions ───────────────────────────────
  const applicability = [{ id: 'apd_001', companyId: LEV, templateId: TPL.casco, employeeId: 'emp_elena', worksiteId: null, decision: 'not_applicable' as const, reason: 'Desde 2026 realiza funciones de supervisión a pie de suelo; no trabaja en altura (informe de visita del SPA).', decidedBy: 'usr_jorge', decidedAt: T(-50), revokedAt: null, revokedBy: null }];
  const readinessDecisions = [{ id: 'rd_001', companyId: LEV, employeeId: 'emp_elena', worksiteId: 'ws_torre', kind: 'confirmed_ready' as const, templateIds: [], reason: 'Revisada la matriz de requisitos antes de la campaña de cubiertas.', compensatingMeasure: null, validUntil: null, decidedBy: 'usr_marina', decidedAt: T(-15), stateAtDecision: 'ready' as const, revokedAt: null }];
  const exceptionReviews = [{ id: 'exr_001', companyId: LEV, key: 'action:act_001', status: 'acknowledged' as const, ownerUserId: 'usr_javier', history: [{ at: T(-4), by: 'usr_javier', status: 'acknowledged' as const, note: 'Pedido en curso; el proveedor entrega esta semana.' }], snapshot: 'Vencida', updatedAt: T(-4) }];

  // ─────────────────────────────── Assemble ───────────────────────────────
  const riskTags: RiskTag[] = [LEV, IBA].flatMap((c) => RISK_TAGS.map(([id, label, specialist]) => ({ id, companyId: c, label, specialist })));
  const categories: DocumentCategory[] = [LEV, IBA].flatMap((c) => CATEGORIES.map(([id, label, accessClass]) => ({ id, companyId: c, label, accessClass, active: true })));

  const db: Database = {
    schemaVersion: 1,
    seededAt,
    companies: COMPANIES,
    settings,
    departments: DEPARTMENTS,
    users: USERS,
    memberships,
    employees,
    jobRoles: JOB_ROLES,
    assignments,
    customers: CUSTOMERS,
    worksites,
    providers: PROVIDERS,
    riskTags,
    templates,
    versions,
    requirementAssignments: [],
    applicability,
    categories,
    requests,
    documents,
    docVersions,
    acknowledgements,
    courses,
    trainings,
    equipment,
    issues,
    assessments,
    actions,
    caeCases,
    caeExchanges,
    shareLinks,
    healthOffers,
    healthConclusions,
    quarantine,
    changes: [],
    readinessDecisions,
    exceptionReviews,
    notifications: [],
    exports: [],
    audit: [],
  };

  // Change reviews (delta computed with the real rules).
  const ivanBefore = { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_marblau'] };
  const ivanAfter = { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_marblau', 'ws_horta'] };
  const sergioBefore = { jobRoleId: 'jr_tec_inst', departmentId: 'dep_mant', worksiteIds: ['ws_oficina', 'ws_marblau'] };
  const sergioAfter = { jobRoleId: 'jr_tec_inst', departmentId: 'dep_mant', worksiteIds: ['ws_marblau', 'ws_horta', 'ws_oficina'] };
  const changes: AssignmentChange[] = [
    { id: 'chg_001', companyId: LEV, employeeId: 'emp_sergio', trigger: 'employee_change', focusWorksiteIds: ['ws_horta'], before: sergioBefore, after: sergioAfter, effectiveFrom: '2026-01-01', reason: 'Nuevo contrato con Supermercados Horta', delta: computeDelta(db, LEV, 'emp_sergio', sergioBefore, sergioAfter, anchor, 30), status: 'reviewed', createdBy: 'usr_javier', createdAt: '2025-12-15T09:00:00.000Z', reviewedBy: 'usr_marina', reviewedAt: '2025-12-18T09:00:00.000Z', reviewNote: 'Entregadas las instrucciones del titular y el chaleco.' },
    { id: 'chg_002', companyId: LEV, employeeId: 'emp_ivan', trigger: 'employee_change', focusWorksiteIds: ['ws_horta'], before: ivanBefore, after: ivanAfter, effectiveFrom: D(-3), reason: 'Refuerzo en Supermercados Horta', delta: computeDelta(db, LEV, 'emp_ivan', ivanBefore, ivanAfter, anchor, 30), status: 'pending_review', createdBy: 'usr_javier', createdAt: T(-3), reviewedBy: null, reviewedAt: null, reviewNote: null },
  ];
  db.changes = changes;

  // Notifications consistent with the seeded state (recipients only; no health details).
  const n = (id: string, companyId: ID, type: string, title: string, body: string, to: ID[], link: string, days: number): AppNotification => ({ id, companyId, type, title, body, recipientUserIds: to, link, createdAt: T(days, '09:00'), readBy: [], dedupeKey: id });
  db.notifications = [
    n('ntf_s1', LEV, 'evidence.submit', 'Documento presentado', 'Formación en trabajos en altura — Óscar Pérez Llorens', ['usr_jorge'], '/documentacion/doc_altura_oscar', -3),
    n('ntf_s2', LEV, 'change.review', 'Cambio de centro pendiente de revisar', 'Iván Castelló Peris · Supermercados Horta (Alboraia)', ['usr_marina'], '/empleados/emp_ivan?tab=cambios', -3),
    n('ntf_s3', LEV, 'assessment.submit', 'Evaluación pendiente de revisión', 'ER-005 Supermercados Horta — limpieza y mantenimiento en muelle', ['usr_jorge'], '/evaluaciones/ra_005', -7),
    n('ntf_s4', LEV, 'action.submit', 'Acción enviada a revisión', 'AP-006 Punto de lavado de ojos en la lavandería del hotel', ['usr_jorge'], '/acciones/act_006', -1),
    n('ntf_s5', LEV, 'evidence.reject', 'Evidencia rechazada', 'Formación en productos químicos de limpieza — Fátima El Amrani', ['usr_amparo'], '/documentacion/doc_quimicos_fatima', -8),
    n('ntf_s6', LEV, 'quarantine', 'Documento en cuarentena', 'Un archivo con posible contenido clínico requiere gestión.', ['usr_clara'], '/salud?tab=cuarentena', -4),
    n('ntf_s7', LEV, 'requirement.submit', 'Requisito pendiente de aprobación profesional', 'Reconocimiento médico obligatorio para trabajos en altura', ['usr_clara'], '/requisitos/tpl_vs_altura', -6),
    n('ntf_s8', LEV, 'ack.pending', 'Información pendiente de confirmar', 'Instrucciones de seguridad — Hotel Mar Blau (versión 2)', ['usr_sergio'], '/mis-tareas', -20),
  ];

  // One import event per company; later events are produced by real actions.
  db.audit = [LEV, IBA].map((companyId) => {
    const counts = `${db.documents.filter((d) => d.companyId === companyId).length} documentos, ${db.versions.filter((v) => v.companyId === companyId).length} versiones de requisitos, ${db.employees.filter((e) => e.companyId === companyId).length} empleados`;
    return chainAuditEvent(undefined, { id: `aud_seed_${companyId}`, companyId, at: seededAt, actor: { userId: 'system', name: 'Sistema (carga de demostración)', roles: [] }, action: 'demo.seed', entityType: 'demo', entityId: companyId, entityLabel: 'Datos de demostración', employeeId: null, summary: `Datos de demostración cargados con sus fechas originales (${counts}). Los eventos posteriores proceden de acciones reales en el prototipo.`, reason: null, changes: [], version: null, recipient: null, restricted: false });
  }) as AuditEvent[];

  return db;
}

function mem(userId: ID, companyId: ID, roles: Membership['roles'], employeeId: ID | null, extra: Partial<Membership> = {}): Membership {
  return { id: `mbr_${userId.slice(4)}_${companyId.slice(4)}`, userId, companyId, roles, roleValidUntil: {}, employeeId, status: 'active', validFrom: null, validUntil: null, providerId: null, worksiteScope: null, reference: null, revokedAt: null, ...extra };
}

function asg(e: EmpSpec, companyId: ID, v: string, from: ISODate, to: ISODate | null, sites: ID[], reason: string): EmployeeAssignment {
  return { id: `asg_${e.id.slice(4)}_${v}`, companyId, employeeId: e.id, jobRoleId: e.role, departmentId: e.dep, worksiteIds: sites, effectiveFrom: from, effectiveTo: to, changeReason: reason, createdBy: 'usr_javier', createdAt: at(from, '09:00', TZ) };
}