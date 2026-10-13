/**
 * Service Context and Authorization helper.
 */
import { PermissionError, isMembershipActive, permsForRoles, type Permission } from '../domain/permissions';
import { today } from '../domain/time';
import type { Company, Database, Membership, RoleId, User } from '../domain/types';
import { getDb, getSession } from '../store/db';

export interface ServiceCtx {
  db: Database;
  company: Company;
  user: User;
  membership: Membership;
  roles: RoleId[];
  perms: Set<Permission>;
  today: string;
  can: (p: Permission) => boolean;
  assert: (p: Permission, msg?: string) => void;
}

export function getServiceCtx(): ServiceCtx {
  const db = getDb();
  const session = getSession();
  const currentDate = today();

  const company = db.companies.find((c) => c.id === session.companyId);
  if (!company) throw new Error('Empresa activa no encontrada');

  const user = db.users.find((u) => u.id === session.userId);
  if (!user) throw new Error('Usuario activo no encontrado');

  const membership = db.memberships.find(
    (m) => m.companyId === company.id && m.userId === user.id && isMembershipActive(m, currentDate)
  );
  if (!membership) {
    throw new PermissionError('El usuario no tiene una membresía activa en la empresa seleccionada.');
  }

  const perms = permsForRoles(membership.roles);
  const can = (p: Permission) => perms.has(p);
  const assert = (p: Permission, msg?: string) => {
    if (!can(p)) throw new PermissionError(msg ?? 'Acción no permitida para su rol.');
  };

  return {
    db,
    company,
    user,
    membership,
    roles: membership.roles,
    perms,
    today: currentDate,
    can,
    assert,
  };
}
