import type { Membership, RoleId } from './types';

/**
 * Action-level permissions (BRD §05, PLT-03).
 *
 * IMPORTANT: this prototype evaluates permissions in the browser. In production every
 * action must be re-authorised server-side; hiding a button is not access control.
 */
export type Permission =
  | 'dashboard.view'
  | 'customers.view'
  | 'customers.manage'
  | 'suppliers.view'
  | 'suppliers.manage'
  | 'invoices.view'
  | 'invoices.view_drafts'
  | 'invoices.edit_draft'
  | 'invoices.approve'
  | 'invoices.issue'
  | 'invoices.deliver'
  | 'invoices.rectify_request'
  | 'payments.record'
  | 'payments.reverse'
  | 'disputes.manage'
  | 'reminders.send'
  | 'expenses.submit_own'
  | 'expenses.view_all'
  | 'expenses.manage_supplier'
  | 'expenses.review_team'
  | 'expenses.review_all'
  | 'expenses.record_payment'
  | 'fiscal.view'
  | 'fiscal.reconcile'
  | 'fiscal.simulate'
  | 'handover.view'
  | 'handover.manage'
  | 'handover.acknowledge'
  | 'exports.create'
  | 'reports.view'
  | 'audit.view'
  | 'settings.view'
  | 'settings.company'
  | 'settings.users';

export interface RoleDef {
  id: RoleId;
  label: string;
  description: string;
  restriction: string;
  permissions: Permission[];
}

const READ_FINANCE: Permission[] = ['dashboard.view', 'customers.view', 'suppliers.view', 'invoices.view', 'reports.view', 'fiscal.view'];

export const ROLES: Record<RoleId, RoleDef> = {
  owner: {
    id: 'owner',
    label: 'Propietario/a',
    description: 'Configura la empresa, ve el estado operativo, nombra aprobadores y autoriza asesores.',
    restriction: 'Puede asignarse otros roles; la propiedad no da acceso a datos sensibles de otros módulos.',
    permissions: [
      ...READ_FINANCE,
      'invoices.view_drafts',
      'invoices.edit_draft',
      'invoices.approve',
      'invoices.issue',
      'invoices.deliver',
      'invoices.rectify_request',
      'payments.record',
      'payments.reverse',
      'disputes.manage',
      'reminders.send',
      'customers.manage',
      'suppliers.manage',
      'expenses.submit_own',
      'expenses.view_all',
      'expenses.manage_supplier',
      'expenses.review_all',
      'expenses.record_payment',
      'fiscal.reconcile',
      'fiscal.simulate',
      'handover.view',
      'handover.manage',
      'exports.create',
      'audit.view',
      'settings.view',
      'settings.company',
      'settings.users',
    ],
  },
  admin: {
    id: 'admin',
    label: 'Administración',
    description: 'Mantiene datos maestros, prepara facturas, registra cobros y coordina gastos.',
    restriction: 'No aprueba ni emite facturas; no puede reescribir registros emitidos.',
    permissions: [
      ...READ_FINANCE,
      'invoices.view_drafts',
      'invoices.edit_draft',
      'invoices.deliver',
      'invoices.rectify_request',
      'payments.record',
      'disputes.manage',
      'reminders.send',
      'customers.manage',
      'suppliers.manage',
      'expenses.submit_own',
      'expenses.view_all',
      'expenses.manage_supplier',
      'expenses.record_payment',
      'fiscal.reconcile',
      'handover.view',
      'handover.manage',
      'exports.create',
      'audit.view',
      'settings.view',
    ],
  },
  issuer: {
    id: 'issuer',
    label: 'Emisor/a autorizado/a',
    description: 'Revisa, aprueba y emite facturas y rectificativas a través del proveedor fiscal.',
    restriction: 'Solo dentro de la empresa para la que tiene autorización.',
    permissions: [
      ...READ_FINANCE,
      'invoices.view_drafts',
      'invoices.edit_draft',
      'invoices.approve',
      'invoices.issue',
      'invoices.deliver',
      'invoices.rectify_request',
      'payments.reverse',
      'fiscal.reconcile',
      'expenses.submit_own',
      'audit.view',
      'settings.view',
    ],
  },
  employee: {
    id: 'employee',
    label: 'Empleado/a',
    description: 'Presenta sus propios gastos con justificante y consulta su estado.',
    restriction: 'Solo sus propios registros.',
    permissions: ['expenses.submit_own'],
  },
  supervisor: {
    id: 'supervisor',
    label: 'Supervisor/a de gastos',
    description: 'Revisa y aprueba gastos de su equipo dentro de su límite de autorización.',
    restriction: 'Solo su equipo y hasta su importe máximo; sin acceso a facturas de venta.',
    permissions: ['expenses.submit_own', 'expenses.review_team'],
  },
  gestoria: {
    id: 'gestoria',
    label: 'Gestoría / asesoría contable',
    description: 'Accede a facturas emitidas, documentos aprobados y exportaciones; prepara el traspaso contable.',
    restriction: 'Requiere mandato explícito del cliente. Sin acceso a borradores, RR. HH., salud ni privacidad.',
    permissions: [...READ_FINANCE, 'expenses.view_all', 'handover.view', 'handover.acknowledge', 'exports.create'],
  },
};

export const ROLE_ORDER: RoleId[] = ['owner', 'admin', 'issuer', 'supervisor', 'employee', 'gestoria'];

/** Effective permissions for an active, non-expired membership. */
export function permissionsFor(membership: Membership | null | undefined, todayISO: string): Set<Permission> {
  const set = new Set<Permission>();
  if (!membership || membership.status !== 'active') return set;
  if (membership.validUntil && membership.validUntil < todayISO) return set;
  for (const r of membership.roles) ROLES[r].permissions.forEach((p) => set.add(p));
  return set;
}

export function isMembershipActive(m: Membership, todayISO: string): boolean {
  return m.status === 'active' && (!m.validUntil || m.validUntil >= todayISO);
}

export class PermissionError extends Error {
  constructor(public permission: Permission | string, message?: string) {
    super(message ?? `Acción no permitida para su rol (${permission}).`);
    this.name = 'PermissionError';
  }
}

export class BusinessRuleError extends Error {
  constructor(message: string, public details: string[] = []) {
    super(message);
    this.name = 'BusinessRuleError';
  }
}
