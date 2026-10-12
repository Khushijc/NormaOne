/**
 * Request context and scoping: the browser stand-in for what the backend derives from the
 * authenticated session. Every service call resolves it, checks permissions and restricts data to
 * the active company and to the caller's scope (own / team / company / provider scope /
 * representative). Linking records never widens access (BRD §17).
 */
import { activeRoles, AUTHORITY_ROLE, isMembershipActive, NotFoundError, PermissionError, permissionsFor, type Permission } from '../domain/permissions';
import { assignmentOn, maskItem, matrixFor, readinessFor, allReadiness, type MatrixItem, type Readiness } from '../domain/requirements';
import { today } from '../domain/time';
import type { Actor, Company, CompanySettings, Database, EvidenceDocument, ID, Membership, ReviewAuthority, RoleId, User, Employee } from '../domain/types';
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
  settings: CompanySettings;
}

const DEFAULT_SETTINGS: Omit<CompanySettings, 'id' | 'companyId'> = { alertWindowDays: 30, clinicalKeywords: [], shareLinkMaxDays: 30, updatedBy: null, updatedAt: null };

export function getCtx(db: Database = getDb()): Ctx {
  const s = getSession();
  const user = db.users.find((u) => u.id === s.userId) ?? db.users[0];
  const company = db.companies.find((c) => c.id === s.companyId) ?? db.companies[0];
  const membership = db.memberships.find((m) => m.userId === user.id && m.companyId === company.id) ?? null;
  const d = today(company.timezone);
  const active = membership && isMembershipActive(membership, d) ? membership : null;
  const roles = active ? activeRoles(active, d) : [];
  const employee = active?.employeeId ? db.employees.find((e) => e.id === active.employeeId && e.companyId === company.id) ?? null : null;
  const settings = db.settings.find((x) => x.companyId === company.id) ?? { id: 'set_default', companyId: company.id, ...DEFAULT_SETTINGS };
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
    settings,
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

export const alertDays = (ctx: Ctx) => ctx.settings.alertWindowDays;

// ─────────────────────────────── Scope ───────────────────────────────

/** External users limited to some worksites (provider concierto); null = no worksite restriction. */
export function worksiteScope(ctx: Ctx): Set<ID> | null {
  const s = ctx.membership?.worksiteScope;
  return s ? new Set(s) : null;
}

/** Direct reports of the caller (supervisor scope). */
export function teamIds(ctx: Ctx): Set<ID> {
  if (!ctx.employee) return new Set();
  return new Set(ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.managerEmployeeId === ctx.employee!.id).map((e) => e.id));
}

/** Worksites whose internal coordinator is the caller. */
export function coordinatedWorksiteIds(ctx: Ctx): Set<ID> {
  if (!ctx.employee) return new Set();
  return new Set(ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && w.coordinatorEmployeeId === ctx.employee!.id).map((w) => w.id));
}

const companyEmployees = (ctx: Ctx) => ctx.db.employees.filter((e) => e.companyId === ctx.company.id);

/** Employees whose individual prevention records the caller may read. */
export function visibleEmployeeIds(ctx: Ctx): Set<ID> {
  if (can(ctx, 'employees.view_all')) {
    const scope = worksiteScope(ctx);
    if (!scope) return new Set(companyEmployees(ctx).map((e) => e.id));
    return new Set(companyEmployees(ctx).filter((e) => (assignmentOn(ctx.db, e.id, ctx.today)?.worksiteIds ?? []).some((w) => scope.has(w))).map((e) => e.id));
  }
  const ids = new Set<ID>();
  if (can(ctx, 'team.view')) {
    teamIds(ctx).forEach((id) => ids.add(id));
    const sites = coordinatedWorksiteIds(ctx);
    for (const e of companyEmployees(ctx)) if ((assignmentOn(ctx.db, e.id, ctx.today)?.worksiteIds ?? []).some((w) => sites.has(w))) ids.add(e.id);
  }
  if (can(ctx, 'own.view') && ctx.employee) ids.add(ctx.employee.id);
  return ids;
}

export function canSeeEmployee(ctx: Ctx, employeeId: ID): boolean {
  return visibleEmployeeIds(ctx).has(employeeId);
}

/** Throws NotFound (not Forbidden) so the existence of out-of-scope records is not revealed. */
export function requireEmployeeVisible(ctx: Ctx, employeeId: ID) {
  if (!canSeeEmployee(ctx, employeeId)) throw new NotFoundError();
}

/** Worksites the caller may see. Representatives see all worksites in aggregate. */
export function visibleWorksiteIds(ctx: Ctx): Set<ID> {
  const all = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id);
  if (can(ctx, 'worksites.view') || can(ctx, 'representative.view')) {
    const scope = worksiteScope(ctx);
    return new Set(all.filter((w) => !scope || scope.has(w.id)).map((w) => w.id));
  }
  const ids = new Set<ID>();
  if (can(ctx, 'team.view')) {
    coordinatedWorksiteIds(ctx).forEach((id) => ids.add(id));
    for (const e of teamIds(ctx)) (assignmentOn(ctx.db, e, ctx.today)?.worksiteIds ?? []).forEach((w) => ids.add(w));
  }
  if (ctx.employee) (assignmentOn(ctx.db, ctx.employee.id, ctx.today)?.worksiteIds ?? []).forEach((w) => ids.add(w));
  return ids;
}

export function canSeeHealth(ctx: Ctx): boolean {
  return can(ctx, 'health.view_conclusions') || can(ctx, 'health.manage');
}

/** Whether the caller may decide items of a review authority (never on their own evidence). */
export function canReviewAuthority(ctx: Ctx, authority: ReviewAuthority, employeeId?: ID | null): boolean {
  if (employeeId && ctx.employee?.id === employeeId) return false;
  if (authority === 'provider_medical') return can(ctx, 'health.manage');
  return can(ctx, 'evidence.review') && ctx.roles.includes(AUTHORITY_ROLE[authority]);
}

/**
 * Document visibility. Health and quarantined documents never appear in general lists; clinical
 * files are not readable by anyone in the portal (quarantine is handled by medical staff only).
 */
export function canSeeDocument(ctx: Ctx, d: EvidenceDocument): boolean {
  if (d.companyId !== ctx.company.id) return false;
  if (d.accessClass === 'health' || d.accessClass === 'quarantined') return can(ctx, 'health.manage');
  const own = !!ctx.employee && d.employeeId === ctx.employee.id;
  if (own) return true;
  if (d.employeeId && !canSeeEmployee(ctx, d.employeeId)) return false;
  if (d.accessClass === 'restricted') return can(ctx, 'evidence.review') || can(ctx, 'requirements.approve_professional');
  if (can(ctx, 'evidence.view_all')) {
    const scope = worksiteScope(ctx);
    return !scope || !d.worksiteId || scope.has(d.worksiteId);
  }
  // Worksite instructions and shared information are readable by people assigned to that worksite.
  if (!d.employeeId && d.worksiteId) return visibleWorksiteIds(ctx).has(d.worksiteId);
  if (!d.employeeId && !d.worksiteId && d.categoryId === 'info_riesgos') return !!ctx.employee;
  return false;
}

/** Requirement items of an employee as the caller may see them (health details masked). */
export function itemsFor(ctx: Ctx, employeeId: ID): MatrixItem[] {
  if (!canSeeEmployee(ctx, employeeId)) return [];
  const health = canSeeHealth(ctx) || ctx.employee?.id === employeeId;
  return matrixFor(ctx.db, ctx.company.id, employeeId, ctx.today, alertDays(ctx)).map((it) => maskItem(it, health));
}

function maskReadiness(ctx: Ctx, r: Readiness): Readiness {
  const health = canSeeHealth(ctx) || ctx.employee?.id === r.employeeId;
  return health ? r : { ...r, items: r.items.map((it) => maskItem(it, false)) };
}

/** Readiness rows (employee × worksite) visible to the caller. Representatives get none here (aggregates only). */
export function visibleReadiness(ctx: Ctx): Readiness[] {
  const ids = visibleEmployeeIds(ctx);
  return allReadiness(ctx.db, ctx.company.id, ctx.today, alertDays(ctx)).filter((r) => ids.has(r.employeeId)).map((r) => maskReadiness(ctx, r));
}

/** Aggregated readiness by worksite for representatives and dashboards (no individual detail). */
export function readinessAggregate(ctx: Ctx): { worksiteId: ID; counts: Record<string, number>; total: number }[] {
  const sites = visibleWorksiteIds(ctx);
  const rows = allReadiness(ctx.db, ctx.company.id, ctx.today, alertDays(ctx));
  const map = new Map<ID, Record<string, number>>();
  for (const r of rows) {
    if (!sites.has(r.worksiteId)) continue;
    const c = map.get(r.worksiteId) ?? {};
    c[r.state] = (c[r.state] ?? 0) + 1;
    map.set(r.worksiteId, c);
  }
  return [...map.entries()].map(([worksiteId, counts]) => ({ worksiteId, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }));
}

export function readinessOf(ctx: Ctx, employeeId: ID, worksiteId: ID): Readiness {
  requireEmployeeVisible(ctx, employeeId);
  return maskReadiness(ctx, readinessFor(ctx.db, ctx.company.id, employeeId, worksiteId, ctx.today, alertDays(ctx)));
}

// ─────────────────────────────── Names ───────────────────────────────

export function employeeName(db: Database, id: ID | null | undefined): string {
  const e = id ? db.employees.find((x) => x.id === id) : undefined;
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

export function userName(db: Database, id: ID | null | undefined): string {
  return (id && db.users.find((u) => u.id === id)?.name) || '—';
}

export function worksiteName(db: Database, id: ID | null | undefined): string {
  return (id && db.worksites.find((w) => w.id === id)?.name) || '—';
}

export function roleName(db: Database, id: ID | null | undefined): string {
  return (id && db.jobRoles.find((r) => r.id === id)?.name) || '—';
}

/** Companies the user can switch to (deliberate company selection, BRD §05). */
export function accessibleCompanies(db: Database, userId: ID): { company: Company; membership: Membership; active: boolean }[] {
  return db.memberships
    .filter((m) => m.userId === userId)
    .map((m) => ({ company: db.companies.find((c) => c.id === m.companyId)!, membership: m, active: isMembershipActive(m, today()) }))
    .filter((x) => !!x.company);
}

/** Simulated network latency for service calls (skipped in tests). */
export function latency(ms = 200): Promise<void> {
  const isTest = typeof process !== 'undefined' && !!process.env?.VITEST;
  return isTest ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));
}
