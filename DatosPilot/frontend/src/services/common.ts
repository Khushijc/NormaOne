/**
 * Helpers shared by the services: notifications to configured roles, readiness-change auditing,
 * date validation and labels for audit summaries.
 *
 * Derived data (matrix, readiness) is cached per database object. Inside a transaction, derived
 * values must therefore be computed on the pre-transaction database (`ctx.db`) or on a fresh
 * shallow copy (`snap(tx)`), never on `tx.db` before it is mutated.
 */
import { isMembershipActive } from '../domain/permissions';
import { READINESS } from '../domain/status';
import { assignmentOn, readinessFor } from '../domain/requirements';
import { isValidISODate } from '../domain/time';
import type { Database, ID, ISODate, ReadinessState, RoleId } from '../domain/types';
import type { Tx } from '../store/db';
import { alertDays, employeeName, worksiteName, type Ctx } from './context';

export const snap = (tx: Tx): Database => ({ ...tx.db });

/** Users of the company holding one of the roles (active memberships only). */
export function usersWithRole(db: Database, companyId: ID, roles: RoleId[], date: ISODate): ID[] {
  return [...new Set(db.memberships.filter((m) => m.companyId === companyId && isMembershipActive(m, date) && m.roles.some((r) => roles.includes(r))).map((m) => m.userId))];
}

export function employeeUser(db: Database, employeeId: ID | null | undefined): ID | null {
  return (employeeId && db.employees.find((e) => e.id === employeeId)?.userId) || null;
}

/** Supervisor (direct manager) user of an employee, if they have an account. */
export function managerUser(db: Database, employeeId: ID | null | undefined): ID | null {
  const e = employeeId ? db.employees.find((x) => x.id === employeeId) : undefined;
  return employeeUser(db, e?.managerEmployeeId ?? null);
}

type ReadinessMap = Map<string, { state: ReadinessState; employeeId: ID; worksiteId: ID }>;

export function readinessSnapshot(db: Database, ctx: Ctx, employeeIds: Iterable<ID>): ReadinessMap {
  const out: ReadinessMap = new Map();
  for (const id of new Set(employeeIds)) {
    const e = db.employees.find((x) => x.id === id && x.companyId === ctx.company.id);
    if (!e || e.status !== 'active') continue;
    const a = assignmentOn(db, id, ctx.today);
    for (const w of a?.worksiteIds ?? []) {
      if (!db.worksites.find((x) => x.id === w)?.active) continue;
      out.set(`${id}|${w}`, { state: readinessFor(db, ctx.company.id, id, w, ctx.today, alertDays(ctx)).state, employeeId: id, worksiteId: w });
    }
  }
  return out;
}

/**
 * Records "readiness changed" audit events and notifications for the employees affected by an
 * action, comparing the state before the transaction with the state after it.
 */
export function auditReadinessChanges(tx: Tx, ctx: Ctx, employeeIds: Iterable<ID>, cause: string) {
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return;
  const before = readinessSnapshot(ctx.db, ctx, ids);
  const after = readinessSnapshot(snap(tx), ctx, ids);
  for (const [key, a] of after) {
    const b = before.get(key);
    if (b && b.state === a.state) continue;
    const label = `${employeeName(ctx.db, a.employeeId)} · ${worksiteName(ctx.db, a.worksiteId)}`;
    tx.audit({
      action: 'readiness.change',
      entityType: 'readiness',
      entityId: key,
      entityLabel: label,
      employeeId: a.employeeId,
      summary: `Disponibilidad: ${b ? READINESS[b.state].label : 'sin calcular'} → ${READINESS[a.state].label}. Causa: ${cause}`,
      changes: [{ field: 'Disponibilidad', before: b ? READINESS[b.state].label : '—', after: READINESS[a.state].label }],
    });
    const to = [managerUser(ctx.db, a.employeeId), ...usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today)].filter((x): x is ID => !!x && x !== ctx.user.id);
    tx.notify({ type: 'readiness.change', title: 'Cambio de disponibilidad', body: `${label}: ${READINESS[a.state].label}`, recipientUserIds: [...new Set(to)], link: `/empleados/${a.employeeId}?tab=resumen`, dedupeKey: `ready:${key}:${a.state}:${Date.now()}` });
  }
}

/** Risk-tag labels for audit change values (never raw ids). */
export function riskLabels(ctx: Ctx, ids: string[]): string {
  return ids.map((id) => ctx.db.riskTags.find((r) => r.id === id && r.companyId === ctx.company.id)?.label ?? id).join(', ') || '—';
}

export function checkDate(errors: string[], value: string | null | undefined, label: string, opts: { required?: boolean } = {}): ISODate | null {
  if (!value) {
    if (opts.required) errors.push(`${label}: obligatorio.`);
    return null;
  }
  if (!isValidISODate(value)) {
    errors.push(`${label}: fecha no válida.`);
    return null;
  }
  return value;
}

export const audience = (ids: (ID | null | undefined)[], except?: ID) => [...new Set(ids.filter((x): x is ID => !!x && x !== except))];
