/**
 * Role- and action-based permissions (BRD §05, PLT-03).
 *
 * The prototype enforces these in the service layer (every mutation and every scoped read),
 * in route guards and in components. Hiding a button is never the only control. A production
 * backend must enforce the same checks server-side; the browser checks here are a mock-up.
 */
import type { Membership, RoleId } from './types';

export type Permission =
  // Own working time
  | 'time.clock_own'
  | 'time.view_own'
  | 'corrections.request_own'
  | 'absences.request_own'
  | 'reports.own'
  // Team scope (direct reports)
  | 'time.view_team'
  | 'corrections.review_team'
  | 'absences.review_team'
  | 'anomalies.manage_team'
  | 'shifts.manage_team'
  | 'employees.view_team'
  | 'reports.team'
  // Company scope
  | 'time.view_all'
  | 'corrections.review_all'
  | 'corrections.propose'
  | 'absences.view_all'
  | 'absences.review_all'
  | 'absences.view_sensitive'
  | 'anomalies.view_all'
  | 'anomalies.manage_all'
  | 'shifts.manage_all'
  | 'employees.view_all'
  | 'employees.manage'
  | 'policies.view'
  | 'policies.manage'
  | 'reports.all'
  | 'reports.export'
  | 'periods.close'
  | 'audit.view'
  | 'settings.manage'
  | 'records.delete_request'
  // Entitled representative (scoped, minimised, time-bound)
  | 'representative.view';

export interface RoleDef {
  id: RoleId;
  label: string;
  description: string;
  restriction: string;
  permissions: Permission[];
}

const OWN: Permission[] = ['time.clock_own', 'time.view_own', 'corrections.request_own', 'absences.request_own', 'reports.own'];

export const ROLES: Record<RoleId, RoleDef> = {
  employee: {
    id: 'employee',
    label: 'Empleado/a',
    description: 'Registra su propia jornada y pausas, consulta su historial, solicita correcciones y ausencias.',
    restriction: 'Solo sus propios registros.',
    permissions: [...OWN],
  },
  supervisor: {
    id: 'supervisor',
    label: 'Supervisor/a',
    description: 'Revisa los registros, correcciones, ausencias e incidencias de su equipo asignado y planifica sus turnos.',
    restriction: 'Solo su equipo directo; no ve el motivo de ausencias sensibles.',
    permissions: [...OWN, 'time.view_team', 'corrections.review_team', 'absences.review_team', 'anomalies.manage_team', 'shifts.manage_team', 'employees.view_team', 'reports.team', 'reports.export', 'policies.view'],
  },
  hr_admin: {
    id: 'hr_admin',
    label: 'Administración de RR. HH.',
    description: 'Gestiona empleados, turnos, políticas y configuración; revisa registros y correcciones; cierra periodos y exporta.',
    restriction: 'No puede reescribir registros originales: las correcciones quedan trazadas.',
    permissions: [
      ...OWN,
      'time.view_all',
      'corrections.review_all',
      'corrections.propose',
      'absences.view_all',
      'absences.review_all',
      'absences.view_sensitive',
      'anomalies.view_all',
      'anomalies.manage_all',
      'shifts.manage_all',
      'employees.view_all',
      'employees.manage',
      'policies.view',
      'policies.manage',
      'reports.all',
      'reports.export',
      'periods.close',
      'audit.view',
      'settings.manage',
      'records.delete_request',
    ],
  },
  owner: {
    id: 'owner',
    label: 'Propietario/a',
    description: 'Ve el estado operativo de la empresa, aprueba la configuración y nombra responsables.',
    restriction: 'Sin acceso al detalle de ausencias sensibles salvo que tenga además el rol de RR. HH.',
    permissions: [...OWN, 'time.view_all', 'absences.view_all', 'anomalies.view_all', 'employees.view_all', 'policies.view', 'reports.all', 'reports.export', 'audit.view', 'settings.manage'],
  },
  payroll: {
    id: 'payroll',
    label: 'Asesoría laboral (nóminas)',
    description: 'Consulta los resúmenes de periodo, ausencias e incidencias abiertas necesarios para la nómina y exporta.',
    restriction: 'Mandato explícito y con fecha de fin; sin administración de empleados.',
    permissions: ['time.view_all', 'absences.view_all', 'absences.view_sensitive', 'anomalies.view_all', 'employees.view_all', 'policies.view', 'reports.all', 'reports.export'],
  },
  representative: {
    id: 'representative',
    label: 'Representación legal de los trabajadores',
    description: 'Consulta y exporta los registros horarios en el ámbito acreditado (ET art. 34.9).',
    restriction: 'Acceso temporal y minimizado: sin datos de contacto ni motivos de ausencia.',
    permissions: ['representative.view', 'policies.view'],
  },
};

export const ROLE_ORDER: RoleId[] = ['owner', 'hr_admin', 'supervisor', 'employee', 'payroll', 'representative'];

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
  // Clocking and self-service require an employee record in this company.
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
