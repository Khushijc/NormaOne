/**
 * RBAC and Scoped Authorization for PrevenWork.
 * Mini-app 04 (RGPD / LOPDGDD).
 */
import type { Membership, RoleId } from './types';

export class BusinessRuleError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'BusinessRuleError';
    this.details = details;
  }
}

export class PermissionError extends Error {
  constructor(message = 'Acción no permitida para su rol.') {
    super(message);
    this.name = 'PermissionError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'El registro no existe o no pertenece a la empresa activa.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export type Permission =
  | 'ropa.view'
  | 'ropa.manage'
  | 'ropa.review'
  | 'rights.view'
  | 'rights.manage'
  | 'rights.decide_extension'
  | 'rights.decide_retention'
  | 'incidents.view_summary'
  | 'incidents.view_restricted'
  | 'incidents.manage'
  | 'incidents.decide_notification'
  | 'incidents.close'
  | 'documents.view'
  | 'documents.manage'
  | 'documents.approve'
  | 'suppliers.view'
  | 'suppliers.manage'
  | 'suppliers.review'
  | 'retention.view'
  | 'retention.manage'
  | 'retention.erase'
  | 'tasks.view_own'
  | 'tasks.view_all'
  | 'tasks.manage'
  | 'reports.view'
  | 'reports.export_standard'
  | 'reports.export_unredacted'
  | 'audit.view'
  | 'settings.manage';

export interface RoleDef {
  id: RoleId;
  label: string;
  description: string;
  permissions: Permission[];
}

export const ROLES: Record<RoleId, RoleDef> = {
  owner: {
    id: 'owner',
    label: 'Titular / Dirección',
    description: 'Acceso a nivel directivo: resumen ejecutivo de cumplimiento, cuadros de mando e informes aprobados. Sin acceso por defecto al detalle sensible de incidentes.',
    permissions: [
      'ropa.view',
      'rights.view',
      'incidents.view_summary',
      'documents.view',
      'suppliers.view',
      'retention.view',
      'tasks.view_all',
      'reports.view',
      'reports.export_standard',
      'audit.view',
      'settings.manage',
    ],
  },
  privacy_lead: {
    id: 'privacy_lead',
    label: 'Responsable de Privacidad',
    description: 'Gestión operativa integral: tratamientos (RAT), casos de derechos, incidentes de seguridad (incluye detalle sensible), evaluación de proveedores y retención.',
    permissions: [
      'ropa.view', 'ropa.manage', 'ropa.review',
      'rights.view', 'rights.manage', 'rights.decide_extension', 'rights.decide_retention',
      'incidents.view_summary', 'incidents.view_restricted', 'incidents.manage', 'incidents.decide_notification', 'incidents.close',
      'documents.view', 'documents.manage', 'documents.approve',
      'suppliers.view', 'suppliers.manage', 'suppliers.review',
      'retention.view', 'retention.manage', 'retention.erase',
      'tasks.view_own', 'tasks.view_all', 'tasks.manage',
      'reports.view', 'reports.export_standard', 'reports.export_unredacted',
      'audit.view',
      'settings.manage',
    ],
  },
  case_handler: {
    id: 'case_handler',
    label: 'Tramitador de Derechos y Tareas',
    description: 'Acceso a casos y tareas asignadas. Tramitación de solicitudes de acceso, rectificación y comprobaciones internas.',
    permissions: [
      'ropa.view',
      'rights.view', 'rights.manage',
      'incidents.view_summary',
      'documents.view',
      'suppliers.view',
      'retention.view',
      'tasks.view_own',
      'reports.view',
    ],
  },
  employee: {
    id: 'employee',
    label: 'Empleado / Autoservicio',
    description: 'Autoservicio y consulta de políticas públicas. Sin acceso general a casos de privacidad ni brechas de seguridad.',
    permissions: [
      'documents.view',
      'tasks.view_own',
    ],
  },
  dpo_adviser: {
    id: 'dpo_adviser',
    label: 'Delegado / Asesor de Protección de Datos',
    description: 'Asesor legal externo o DPO: revisión especializada de tratamientos, dictámenes, incidentes de seguridad y supervisión de auditoría.',
    permissions: [
      'ropa.view', 'ropa.review',
      'rights.view', 'rights.decide_extension', 'rights.decide_retention',
      'incidents.view_summary', 'incidents.view_restricted', 'incidents.decide_notification',
      'documents.view', 'documents.approve',
      'suppliers.view', 'suppliers.review',
      'retention.view',
      'tasks.view_own', 'tasks.view_all',
      'reports.view', 'reports.export_standard', 'reports.export_unredacted',
      'audit.view',
    ],
  },
  auditor: {
    id: 'auditor',
    label: 'Auditor de Cumplimiento (Solo lectura)',
    description: 'Verificación independiente del historial de auditoría y políticas formalizadas. Sin permisos de modificación.',
    permissions: [
      'ropa.view',
      'rights.view',
      'incidents.view_summary',
      'documents.view',
      'suppliers.view',
      'retention.view',
      'reports.view',
      'audit.view',
    ],
  },
};

export function isMembershipActive(m: Membership | null | undefined, onDate: string): boolean {
  if (!m || m.status !== 'active') return false;
  if (m.validFrom > onDate) return false;
  if (m.validUntil && m.validUntil < onDate) return false;
  return true;
}

export function permsForRoles(roles: RoleId[]): Set<Permission> {
  const out = new Set<Permission>();
  roles.forEach((r) => {
    ROLES[r]?.permissions.forEach((p) => out.add(p));
  });
  return out;
}
