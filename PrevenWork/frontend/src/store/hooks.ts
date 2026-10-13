/**
 * React hooks for PrevenWork state & active context.
 */
import { useEffect, useState } from 'react';
import { isMembershipActive, permsForRoles, type Permission } from '../domain/permissions';
import { today } from '../domain/time';
import type { Company, Database, Membership, PersonalDataIncident, RoleId, User } from '../domain/types';
import { getDb, getSession, subscribe } from './db';
import { useLang } from '../i18n';
import { useTheme } from './theme';

export { useLang, useTheme };


export function useDb(): Database {
  const [db, setDb] = useState<Database>(() => getDb());
  useEffect(() => {
    return subscribe(() => setDb({ ...getDb() }));
  }, []);
  return db;
}

export interface Ctx {
  db: Database;
  company: Company;
  user: User;
  membership: Membership | null;
  roles: RoleId[];
  perms: Set<Permission>;
  today: string;
  can: (perm: Permission) => boolean;
  hasRole: (...r: RoleId[]) => boolean;
  canAccessIncident: (inc: PersonalDataIncident) => boolean;
}

export function useCtx(): Ctx {
  const db = useDb();
  const session = getSession();
  const currentDate = today();

  const company = db.companies.find((c) => c.id === session.companyId) ?? db.companies[0];
  const user = db.users.find((u) => u.id === session.userId) ?? db.users[0];

  const membership = db.memberships.find(
    (m) => m.companyId === company.id && m.userId === user.id && isMembershipActive(m, currentDate)
  ) ?? null;

  const roles = membership?.roles ?? [];
  const perms = permsForRoles(roles);

  const can = (perm: Permission) => perms.has(perm);
  const hasRole = (...r: RoleId[]) => roles.some((role) => r.includes(role));

  // Incident access control:
  // Non-restricted incidents are visible if user has incidents.view_summary.
  // Sensitive incidents require 'incidents.view_restricted' (Privacy Lead, DPO Adviser).
  const canAccessIncident = (inc: PersonalDataIncident) => {
    if (!inc.restricted) return can('incidents.view_summary');
    return can('incidents.view_restricted');
  };

  return {
    db,
    company,
    user,
    membership,
    roles,
    perms,
    today: currentDate,
    can,
    hasRole,
    canAccessIncident,
  };
}
