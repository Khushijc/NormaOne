/**
 * Role- and action-based permissions (BRD §05, PLT-03).
 *
 * Enforced in the service layer (every mutation and every scoped read), in route guards and in
 * components. Hiding a button is never the only control. A production backend must enforce the
 * same checks server-side; the browser checks here are a mock-up.
 */
import type { Membership, ReviewAuthority, RoleId } from './types';

export type Permission =
  // Own records (employee self-service)
  | 'own.view'
  | 'own.submit'
  | 'own.acknowledge'
  // Team (supervisor): minimum readiness information for direct reports and coordinated sites
  | 'team.view'
  | 'team.acknowledge_site'
  // Company scope
  | 'employees.view_all'
  | 'employees.manage'
  | 'worksites.view'
  | 'worksites.manage'
  | 'requirements.view'
  | 'requirements.draft'
  | 'requirements.manage'
  | 'requirements.assign'
  | 'requirements.approve_professional'
  | 'requirements.approve_health'
  | 'evidence.view_all'
  | 'evidence.request'
  | 'evidence.upload'
  | 'evidence.review'
  | 'training.manage'
  | 'ppe.manage'
  | 'risk.view'
  | 'risk.register'
  | 'risk.review'
  | 'actions.view_all'
  | 'actions.manage'
  | 'actions.review'
  | 'cae.view'
  | 'cae.manage'
  | 'readiness.view_all'
  | 'readiness.decide'
  | 'readiness.exception'
  | 'changes.review'
  | 'exceptions.manage'
  | 'health.view_conclusions'
  | 'health.manage'
  | 'reports.view'
  | 'reports.export'
  | 'audit.view'
  | 'settings.manage'
  // Entitled representative (delegado de prevención): aggregated, minimised, time-bound
  | 'representative.view';

export interface RoleDef {
  id: RoleId;
  label: string;
  description: string;
  restriction: string;
  permissions: Permission[];
}

const OWN: Permission[] = ['own.view', 'own.submit', 'own.acknowledge'];

export const ROLES: Record<RoleId, RoleDef> = {
  owner: {
    id: 'owner',
    label: 'Propietario/a',
    description: 'Ve el estado operativo de la prevención, los informes y la auditoría; configura la empresa.',
    restriction: 'La titularidad de la empresa no da acceso a datos de salud ni a documentos restringidos.',
    permissions: ['employees.view_all', 'worksites.view', 'requirements.view', 'evidence.view_all', 'risk.view', 'actions.view_all', 'cae.view', 'readiness.view_all', 'reports.view', 'reports.export', 'audit.view', 'settings.manage'],
  },
  company_admin: {
    id: 'company_admin',
    label: 'Administración de la empresa',
    description: 'Mantiene empleados y centros, asigna plantillas aprobadas, gestiona la documentación ordinaria, sigue la disponibilidad y las acciones, y genera informes.',
    restriction: 'No aprueba requisitos ni evidencias, no crea requisitos médicos obligatorios y no accede al área de salud.',
    permissions: [
      ...OWN,
      'employees.view_all',
      'employees.manage',
      'worksites.view',
      'worksites.manage',
      'requirements.view',
      'requirements.draft',
      'requirements.assign',
      'evidence.view_all',
      'evidence.request',
      'evidence.upload',
      'training.manage',
      'ppe.manage',
      'risk.view',
      'risk.register',
      'actions.view_all',
      'actions.manage',
      'cae.view',
      'cae.manage',
      'readiness.view_all',
      'exceptions.manage',
      'reports.view',
      'reports.export',
      'audit.view',
      'settings.manage',
    ],
  },
  prl_coordinator: {
    id: 'prl_coordinator',
    label: 'Coordinación de PRL',
    description: 'Gestiona la matriz de requisitos, solicita y revisa la documentación preventiva ordinaria, coordina con el servicio de prevención, sigue las acciones y gestiona la CAE.',
    restriction: 'Solo revisa evidencias cuya autoridad de revisión es la coordinación; ve conclusiones de aptitud, nunca informes clínicos.',
    permissions: [
      ...OWN,
      'employees.view_all',
      'worksites.view',
      'requirements.view',
      'requirements.draft',
      'requirements.manage',
      'requirements.assign',
      'evidence.view_all',
      'evidence.request',
      'evidence.upload',
      'evidence.review',
      'training.manage',
      'ppe.manage',
      'risk.view',
      'risk.register',
      'actions.view_all',
      'actions.manage',
      'actions.review',
      'cae.view',
      'cae.manage',
      'readiness.view_all',
      'readiness.decide',
      'changes.review',
      'exceptions.manage',
      'health.view_conclusions',
      'reports.view',
      'reports.export',
      'audit.view',
    ],
  },
  supervisor: {
    id: 'supervisor',
    label: 'Supervisor/a',
    description: 'Ve la disponibilidad de su equipo y de los centros que coordina, los requisitos pendientes y las acciones asignadas; confirma instrucciones de centro.',
    restriction: 'Información mínima necesaria: sin documentos clínicos ni toda la documentación de cada empleado.',
    permissions: [...OWN, 'team.view', 'team.acknowledge_site', 'reports.view'],
  },
  employee: {
    id: 'employee',
    label: 'Empleado/a',
    description: 'Consulta sus requisitos, aporta documentación, ve el resultado de las revisiones, confirma la información recibida y ve su formación y sus equipos.',
    restriction: 'Solo sus propios registros.',
    permissions: [...OWN],
  },
  provider_technical: {
    id: 'provider_technical',
    label: 'Servicio de prevención (técnico)',
    description: 'Aprueba requisitos y evaluaciones de riesgos, revisa la evidencia que le corresponde, valida resoluciones de acciones y registra decisiones profesionales.',
    restriction: 'Solo las empresas y centros asignados en su concierto; sin acceso al área de salud.',
    permissions: [
      'employees.view_all',
      'worksites.view',
      'requirements.view',
      'requirements.draft',
      'requirements.approve_professional',
      'evidence.view_all',
      'evidence.request',
      'evidence.upload',
      'evidence.review',
      'risk.view',
      'risk.register',
      'risk.review',
      'actions.view_all',
      'actions.manage',
      'actions.review',
      'cae.view',
      'readiness.view_all',
      'readiness.decide',
      'readiness.exception',
      'changes.review',
      'reports.view',
      'reports.export',
    ],
  },
  provider_medical: {
    id: 'provider_medical',
    label: 'Servicio de prevención (medicina del trabajo)',
    description: 'Registra ofertas de vigilancia de la salud, respuestas y conclusiones de aptitud; gestiona documentos clínicos subidos por error (cuarentena).',
    restriction: 'Solo el área de salud de las empresas asignadas. Los informes clínicos se custodian fuera del portal.',
    permissions: ['employees.view_all', 'requirements.view', 'requirements.approve_health', 'health.view_conclusions', 'health.manage', 'readiness.view_all'],
  },
  representative: {
    id: 'representative',
    label: 'Delegado/a de prevención',
    description: 'Consulta información agregada de prevención (evaluaciones, acciones, disponibilidad por centro y formación) en el ámbito acreditado.',
    restriction: 'Acceso temporal y minimizado: sin documentos individuales ni datos de salud (LPRL arts. 22.4 y 36).',
    permissions: ['representative.view', 'risk.view', 'reports.view'],
  },
};

export const ROLE_ORDER: RoleId[] = ['owner', 'company_admin', 'prl_coordinator', 'supervisor', 'employee', 'provider_technical', 'provider_medical', 'representative'];

/** Permission that allows deciding evidence/actions for each review authority. */
export const AUTHORITY_ROLE: Record<ReviewAuthority, RoleId> = {
  coordinator: 'prl_coordinator',
  provider_technical: 'provider_technical',
  provider_medical: 'provider_medical',
};

export const AUTHORITY_LABEL: Record<ReviewAuthority, string> = {
  coordinator: 'Coordinación de PRL',
  provider_technical: 'Servicio de prevención (técnico)',
  provider_medical: 'Servicio de prevención (medicina del trabajo)',
};

export function isMembershipActive(m: Membership, todayISO: string): boolean {
  if (m.status !== 'active') return false;
  if (m.validFrom && todayISO < m.validFrom) return false;
  if (m.validUntil && todayISO > m.validUntil) return false;
  return true;
}

/** Roles of a membership that are inside their term on a date. */
export function activeRoles(m: Membership, todayISO: string): RoleId[] {
  return m.roles.filter((r) => {
    const until = m.roleValidUntil?.[r];
    return !until || todayISO <= until;
  });
}

export function permissionsFor(m: Membership | null | undefined, todayISO: string): Set<Permission> {
  const out = new Set<Permission>();
  if (!m || !isMembershipActive(m, todayISO)) return out;
  for (const r of activeRoles(m, todayISO)) ROLES[r].permissions.forEach((p) => out.add(p));
  // Self-service requires an employee record in this company.
  if (!m.employeeId) OWN.forEach((p) => out.delete(p));
  return out;
}

export class PermissionError extends Error {
  constructor(message = 'Acción no permitida para su rol.') {
    super(message);
    this.name = 'PermissionError';
  }
}

export class BusinessRuleError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'BusinessRuleError';
    this.details = details;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'El registro no existe o no pertenece a la empresa activa.') {
    super(message);
    this.name = 'NotFoundError';
  }
}
