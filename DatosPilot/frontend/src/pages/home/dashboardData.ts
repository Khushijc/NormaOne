/**
 * Pure derivations for the Inicio dashboard. Everything is computed from the services' scoped
 * reads (visibleEmployeeIds, itemsFor, visibleReadiness, visibleDocuments, visibleActions,
 * visibleCases, visibleAssessments), so a figure can never include records outside the caller's
 * scope. Health items arrive already masked for non-health viewers.
 */
import type { Permission } from '../../domain/permissions';
import { assignmentOn, versionOn, type MatrixItem, type Readiness } from '../../domain/requirements';
import type { ItemStatus } from '../../domain/status';
import { addDays } from '../../domain/time';
import type { CaeCase, DocumentVersion, Employee, EvidenceDocument, ID, ISODate, PreventiveAction, ReadinessState, RequirementCategory } from '../../domain/types';
import { SECTION_PERMS } from '../../layout/AppShell';
import { casePending, visibleCases } from '../../services/caeService';
import { alertDays, itemsFor, visibleEmployeeIds, visibleReadiness, visibleWorksiteIds } from '../../services/context';
import { canDecide, documentState, visibleDocuments } from '../../services/evidenceService';
import { visibleActions, visibleAssessments } from '../../services/safetyService';
import type { UiCtx } from '../../store/hooks';

export interface DashFilters {
  ws: ID;
  dep: ID;
  emp: ID;
  cat: RequirementCategory | '';
  status: ItemStatus | '';
}

export const NO_FILTERS: DashFilters = { ws: '', dep: '', emp: '', cat: '', status: '' };

export const hasItemFilters = (f: DashFilters) => !!f.cat || !!f.status;
export const hasAnyFilter = (f: DashFilters) => !!(f.ws || f.dep || f.emp || f.cat || f.status);

export type Section = keyof typeof SECTION_PERMS;
export const canOpen = (ctx: UiCtx, section: Section) => (SECTION_PERMS[section] as Permission[]).some((p) => ctx.can(p));

/** Active employees of the company that the caller may see. */
export function scopeEmployees(ctx: UiCtx): Employee[] {
  const ids = visibleEmployeeIds(ctx);
  return ctx.db.employees
    .filter((e) => e.companyId === ctx.company.id && e.status === 'active' && ids.has(e.id))
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'es'));
}

export interface DatedEntry {
  key: string;
  kind: 'provider' | 'assessment' | 'legal';
  date: ISODate;
  label: string;
  employeeId: ID | null;
  worksiteId: ID | null;
  link: string | null;
}

export interface ReviewQueueEntry {
  doc: EvidenceDocument;
  version: DocumentVersion;
  canDecide: boolean;
}

export interface CaeEntry {
  c: CaeCase;
  pending: ReturnType<typeof casePending>;
  open: number;
}

export interface Overview {
  employees: Employee[];
  worksiteIds: ID[];
  items: MatrixItem[];
  counted: MatrixItem[];
  optional: number;
  byStatus: Map<ItemStatus, number>;
  accepted: number;
  otherSatisfied: number;
  missing: number;
  requested: number;
  expired: number;
  professional: number;
  readiness: Readiness[];
  blocked: number;
  reviewQueue: ReviewQueueEntry[];
  openActions: PreventiveAction[];
  overdueActions: PreventiveAction[];
  upcoming: DatedEntry[];
  upcomingReviews: number;
  upcomingExpiries: number;
  cae: CaeEntry[];
  windowEnd: ISODate;
}

const itemMatches = (it: MatrixItem, f: DashFilters) => (!f.cat || it.version.category === f.cat) && (!f.status || it.status === f.status);

export function computeOverview(ctx: UiCtx, f: DashFilters): Overview {
  const db = ctx.db;
  const today = ctx.today;
  const windowEnd = addDays(today, alertDays(ctx));
  const sites = visibleWorksiteIds(ctx);
  const activeSites = new Set(db.worksites.filter((w) => w.companyId === ctx.company.id && w.active && sites.has(w.id)).map((w) => w.id));

  // Employees in scope after the worksite / department / employee filters.
  const shape = new Map(scopeEmployees(ctx).map((e) => [e.id, assignmentOn(db, e.id, today)] as const));
  const employees = scopeEmployees(ctx).filter((e) => {
    const a = shape.get(e.id);
    if (f.emp && e.id !== f.emp) return false;
    if (f.dep && a?.departmentId !== f.dep) return false;
    if (f.ws && !(a?.worksiteIds ?? []).includes(f.ws)) return false;
    return true;
  });
  const empSet = new Set(employees.map((e) => e.id));
  const personFilter = !!(f.emp || f.dep);

  let worksiteIds: ID[];
  if (personFilter) {
    const s = new Set<ID>();
    for (const e of employees) for (const w of shape.get(e.id)?.worksiteIds ?? []) if (activeSites.has(w) && (!f.ws || w === f.ws)) s.add(w);
    worksiteIds = [...s];
  } else worksiteIds = [...activeSites].filter((w) => !f.ws || w === f.ws);
  const siteSet = new Set(worksiteIds);

  // Requirement items (health masked by itemsFor for non-health viewers).
  const items = employees.flatMap((e) => itemsFor(ctx, e.id)).filter((it) => (!f.ws || it.worksiteId === null || it.worksiteId === f.ws) && itemMatches(it, f));
  const counted = items.filter((it) => it.counted);
  const optional = items.filter((it) => !it.counted && it.version.requirementType === 'optional').length;
  const byStatus = new Map<ItemStatus, number>();
  for (const it of counted) byStatus.set(it.status, (byStatus.get(it.status) ?? 0) + 1);
  const n = (s: ItemStatus) => byStatus.get(s) ?? 0;

  // Readiness (employee × worksite).
  const readiness = visibleReadiness(ctx).filter((r) => empSet.has(r.employeeId) && siteSet.has(r.worksiteId) && (!hasItemFilters(f) || r.items.some((it) => itemMatches(it, f))));

  // Evidence review queue: documents with a received / in-review version.
  const itemDocs = new Set(items.map((it) => it.evidence.documentId).filter(Boolean) as ID[]);
  const reviewQueue: ReviewQueueEntry[] = [];
  for (const d of visibleDocuments(ctx)) {
    const pending = documentState(ctx, d.id).pending;
    if (!pending) continue;
    if (f.emp && d.employeeId !== f.emp) continue;
    if (f.dep && (!d.employeeId || !empSet.has(d.employeeId))) continue;
    if (f.ws && !(d.worksiteId ? d.worksiteId === f.ws : !!d.employeeId && empSet.has(d.employeeId))) continue;
    if (f.cat && (!d.templateId || versionOn(db, d.templateId, today)?.category !== f.cat)) continue;
    if (f.status && !itemDocs.has(d.id)) continue;
    reviewQueue.push({ doc: d, version: pending, canDecide: canDecide(ctx, d, pending) });
  }
  reviewQueue.sort((a, b) => a.version.receivedAt.localeCompare(b.version.receivedAt));

  // Preventive actions (filtered by worksite / department / employee only).
  const roleDep = new Map(db.jobRoles.map((r) => [r.id, r.departmentId] as const));
  const actionInScope = (a: PreventiveAction) => {
    if (f.emp && a.employeeId !== f.emp) return false;
    if (f.dep && !((a.employeeId && empSet.has(a.employeeId)) || (a.jobRoleId && roleDep.get(a.jobRoleId) === f.dep))) return false;
    if (f.ws && !(a.worksiteId ? a.worksiteId === f.ws : !!a.employeeId && empSet.has(a.employeeId))) return false;
    return true;
  };
  const openActions = visibleActions(ctx).filter((a) => a.status !== 'resolved' && actionInScope(a));
  const overdueActions = openActions.filter((a) => !!a.targetDate && a.targetDate < today).sort((a, b) => (a.targetDate ?? '').localeCompare(b.targetDate ?? ''));

  // Upcoming dates: only real dates recorded on accepted evidence or set by the assessor.
  const upcoming: DatedEntry[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    // Health items never list dates or names on the dashboard (they belong to the restricted area).
    if (it.restricted) continue;
    const ev = it.evidence;
    const link = ev.documentId ? `/documentacion/${ev.documentId}` : `/empleados/${it.employeeId}?tab=requisitos`;
    const add = (kind: DatedEntry['kind'], date: ISODate | null) => {
      if (!date || date < today || date > windowEnd) return;
      const key = `${kind}|${ev.documentId ?? it.key}|${date}`;
      if (seen.has(key)) return;
      seen.add(key);
      upcoming.push({ key, kind, date, label: it.version.name, employeeId: it.employeeId, worksiteId: it.worksiteId, link });
    };
    add('provider', ev.providerReviewDate);
    add('legal', ev.legalExpiryDate);
  }
  if (!hasItemFilters(f)) {
    for (const a of visibleAssessments(ctx)) {
      if (a.status !== 'accepted' || !a.reviewDate || a.reviewDate < today || a.reviewDate > windowEnd) continue;
      if (a.worksiteId && !siteSet.has(a.worksiteId)) continue;
      if (!a.worksiteId && personFilter && !employees.some((e) => a.jobRoleIds.includes(shape.get(e.id)?.jobRoleId ?? ''))) continue;
      upcoming.push({ key: `ra|${a.id}`, kind: 'assessment', date: a.reviewDate, label: `${a.code} · ${a.title}`, employeeId: null, worksiteId: a.worksiteId, link: `/evaluaciones/${a.id}` });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  // CAE coordination with open points.
  const cae: CaeEntry[] = visibleCases(ctx)
    .filter((c) => c.status !== 'closed' && siteSet.has(c.worksiteId))
    .map((c) => {
      const pending = casePending(ctx, c);
      return { c, pending, open: pending.notSent + pending.noReceipt + pending.noAck + pending.toReview + (pending.followUpOverdue ? 1 : 0) };
    })
    .filter((x) => x.open > 0)
    .sort((a, b) => b.open - a.open);

  return {
    employees,
    worksiteIds,
    items,
    counted,
    optional,
    byStatus,
    accepted: n('accepted'),
    otherSatisfied: n('declined') + n('not_applicable'),
    missing: n('missing') + n('requested'),
    requested: n('requested'),
    expired: items.filter((it) => it.status === 'expired').length,
    professional: n('review_required') + n('review_due'),
    readiness,
    blocked: readiness.filter((r) => r.state === 'blocked').length,
    reviewQueue,
    openActions,
    overdueActions,
    upcoming,
    upcomingReviews: upcoming.filter((u) => u.kind !== 'legal').length,
    upcomingExpiries: upcoming.filter((u) => u.kind === 'legal').length,
    cae,
    windowEnd,
  };
}

export type StateCounts = Record<ReadinessState, number>;

/** Readiness rows grouped by a key (worksite or job role), counted by state. */
export function groupReadiness(rows: Readiness[], keyOf: (r: Readiness) => ID | null): Map<ID, Partial<StateCounts>> {
  const out = new Map<ID, Partial<StateCounts>>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const c = out.get(k) ?? {};
    c[r.state] = (c[r.state] ?? 0) + 1;
    out.set(k, c);
  }
  return out;
}
