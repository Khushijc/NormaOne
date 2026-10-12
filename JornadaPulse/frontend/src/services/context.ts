/**
 * Request context and scoping: the browser stand-in for what the backend derives from the
 * authenticated session. Every service call resolves it, checks permissions and restricts
 * data to the active company and to the caller's scope (own / team / company / representative).
 */
import { activeRoles, isMembershipActive, NotFoundError, PermissionError, permissionsFor, type Permission } from '../domain/permissions';
import { today } from '../domain/time';
import type { AbsenceRequest, AbsenceType, Actor, Company, Database, Employee, ID, Membership, RoleId, User } from '../domain/types';
import { getDb, getSession } from '../store/db';

export interface Ctx {
  db: Database;
  user: User;
  company: Company;
  membership: Membership | null;
  /** The caller's own employee record in the active company, if any. */
  employee: Employee | null;
  roles: RoleId[];
  perms: Set<Permission>;
  today: string;
  actor: Actor;
}

export function getCtx(db: Database = getDb()): Ctx {
  const s = getSession();
  const user = db.users.find((u) => u.id === s.userId) ?? db.users[0];
  const company = db.companies.find((c) => c.id === s.companyId) ?? db.companies[0];
  const membership = db.memberships.find((m) => m.userId === user.id && m.companyId === company.id) ?? null;
  const d = today(company.timezone);
  const active = membership && isMembershipActive(membership, d) ? membership : null;
  const roles = active ? activeRoles(active, d) : [];
  const employee = active?.employeeId ? db.employees.find((e) => e.id === active.employeeId && e.companyId === company.id) ?? null : null;
  return {
    db,
    user,
    company,
    membership,
    employee,
    roles,
    perms: permissionsFor(membership, d),
    today: d,
    actor: { userId: user.id, name: user.name, roles },
  };
}

export function can(ctx: Ctx, p: Permission): boolean {
  return ctx.perms.has(p);
}

export function requirePerm(ctx: Ctx, ...anyOf: Permission[]) {
  if (!anyOf.some((p) => ctx.perms.has(p))) throw new PermissionError();
}

/** Tenant isolation (SEC-01, AC-PLT-01): another company's record is reported as not found. */
export function ownCompany<T extends { companyId: ID }>(ctx: Ctx, row: T | undefined): T {
  if (!row || row.companyId !== ctx.company.id) throw new NotFoundError();
  return row;
}

/** Direct reports of the caller (supervisor scope). */
export function teamIds(ctx: Ctx): Set<ID> {
  if (!ctx.employee) return new Set();
  return new Set(ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.managerEmployeeId === ctx.employee!.id).map((e) => e.id));
}

export type Scope = 'none' | 'own' | 'team' | 'all' | 'representative';

/** Widest record scope for working-time data. */
export function timeScope(ctx: Ctx): Scope {
  if (can(ctx, 'time.view_all')) return 'all';
  if (can(ctx, 'representative.view')) return 'representative';
  if (can(ctx, 'time.view_team')) return 'team';
  if (can(ctx, 'time.view_own')) return 'own';
  return 'none';
}

/** Employees whose working-time records the caller may read. */
export function visibleEmployeeIds(ctx: Ctx): Set<ID> {
  const companyEmployees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id);
  switch (timeScope(ctx)) {
    case 'all':
    case 'representative':
      return new Set(companyEmployees.map((e) => e.id));
    case 'team': {
      const ids = teamIds(ctx);
      if (ctx.employee) ids.add(ctx.employee.id);
      return ids;
    }
    case 'own':
      return new Set(ctx.employee ? [ctx.employee.id] : []);
    default:
      return new Set();
  }
}

export function canSeeEmployee(ctx: Ctx, employeeId: ID): boolean {
  return visibleEmployeeIds(ctx).has(employeeId);
}

/** Throws NotFound (not Forbidden) so the existence of out-of-scope records is not revealed. */
export function requireEmployeeVisible(ctx: Ctx, employeeId: ID) {
  if (!canSeeEmployee(ctx, employeeId)) throw new NotFoundError();
}

/** Who may review a request about `employeeId` (corrections, absences). Never the employee themself. */
export function canReview(ctx: Ctx, employeeId: ID, kind: 'corrections' | 'absences'): boolean {
  if (ctx.employee?.id === employeeId) return false;
  const emp = ctx.db.employees.find((e) => e.id === employeeId && e.companyId === ctx.company.id);
  if (!emp) return false;
  if (can(ctx, `${kind}.review_all` as Permission)) return true;
  return can(ctx, `${kind}.review_team` as Permission) && teamIds(ctx).has(employeeId);
}

export function employeeName(db: Database, id: ID | null | undefined): string {
  const e = id ? db.employees.find((x) => x.id === id) : undefined;
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

export function userName(db: Database, id: ID | null | undefined): string {
  return (id && db.users.find((u) => u.id === id)?.name) || '—';
}

/** Companies the user can switch to (deliberate company selection, BRD §05). */
export function accessibleCompanies(db: Database, userId: ID): { company: Company; membership: Membership; active: boolean }[] {
  return db.memberships
    .filter((m) => m.userId === userId)
    .map((m) => ({ company: db.companies.find((c) => c.id === m.companyId)!, membership: m, active: isMembershipActive(m, today()) }))
    .filter((x) => !!x.company);
}

/** Sensitive absence categories (sick leave) are visible only to the employee, HR and payroll. */
export function canSeeAbsenceDetail(ctx: Ctx, a: AbsenceRequest, type: AbsenceType | undefined): boolean {
  if (!type?.sensitive) return true;
  return ctx.employee?.id === a.employeeId || can(ctx, 'absences.view_sensitive');
}

/** Absences visible to the caller (representatives see none: minimisation). */
export function visibleAbsenceEmployeeIds(ctx: Ctx): Set<ID> {
  if (can(ctx, 'absences.view_all')) return new Set(ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => e.id));
  if (can(ctx, 'absences.review_team')) {
    const ids = teamIds(ctx);
    if (ctx.employee) ids.add(ctx.employee.id);
    return ids;
  }
  return new Set(ctx.employee ? [ctx.employee.id] : []);
}

/** Simulated network latency for service calls (skipped in tests). */
export function latency(ms = 250): Promise<void> {
  const isTest = typeof process !== 'undefined' && !!process.env?.VITEST;
  return isTest ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));
}
