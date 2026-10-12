/**
 * Pure helpers for the Empleados screens: counters over the requirement matrix, the "next action"
 * derived from the worst readiness reason, and labels. Nothing here changes data; every action
 * goes through the services.
 */
import { AUTHORITY_LABEL } from '../../domain/permissions';
import type { AppliesVia, MatrixItem, Readiness } from '../../domain/requirements';
import { READINESS_ORDER, type ItemStatus } from '../../domain/status';
import type { AssignmentChange, Database, EmployeeAssignment, ID, ISODate, Msg, ReadinessState } from '../../domain/types';
import { tKey } from '../../i18n';

/** Outstanding from the worker or the requester (nothing accepted yet or no longer valid). */
export const MISSING_STATUSES: ItemStatus[] = ['missing', 'requested', 'rejected', 'expired', 'pending_ack'];
/** Evidence received and waiting for the review authority. */
export const AWAITING_STATUSES: ItemStatus[] = ['received', 'in_review'];
/** A professional decision or a date is needed. */
export const REVIEW_STATUSES: ItemStatus[] = ['review_required', 'review_due'];

export interface ItemCounts {
  counted: number;
  accepted: number;
  missing: number;
  awaiting: number;
  review: number;
  criticalOpen: number;
  notApplicable: number;
}

/** Counters over the counted (mandatory under the approved policy) items. */
export function itemCounts(items: MatrixItem[]): ItemCounts {
  const counted = items.filter((i) => i.counted);
  return {
    counted: counted.length,
    accepted: counted.filter((i) => i.satisfied).length,
    missing: counted.filter((i) => MISSING_STATUSES.includes(i.status)).length,
    awaiting: counted.filter((i) => AWAITING_STATUSES.includes(i.status)).length,
    review: counted.filter((i) => REVIEW_STATUSES.includes(i.status)).length,
    criticalOpen: counted.filter((i) => i.critical && !i.satisfied).length,
    notApplicable: items.filter((i) => i.status === 'not_applicable').length,
  };
}

export const readinessRank = (s: ReadinessState | null) => (s ? READINESS_ORDER.indexOf(s) : READINESS_ORDER.length);

/** Readiness rows ordered from worst to best. */
export const byWorst = (list: Readiness[]) => [...list].sort((a, b) => readinessRank(a.state) - readinessRank(b.state));

/** Current assignment, or the last one (inactive employees keep their history). */
export function displayAssignment(db: Database, employeeId: ID, today: ISODate): EmployeeAssignment | undefined {
  const list = db.assignments.filter((a) => a.employeeId === employeeId).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return list.find((a) => a.effectiveFrom <= today && (!a.effectiveTo || a.effectiveTo >= today)) ?? list.find((a) => a.effectiveFrom <= today) ?? list[0];
}

export const departmentName = (db: Database, id: ID | null | undefined) => (id && db.departments.find((d) => d.id === id)?.name) || '—';
export const worksiteCode = (db: Database, id: ID) => db.worksites.find((w) => w.id === id)?.code ?? '—';

// ─────────────────────────────── Next action ───────────────────────────────

export interface NextAction {
  action: Msg;
  /** Spanish label of the role responsible (translated at render time), or null. */
  owner: string | null;
  worksiteId: ID | null;
  tone: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
}

const WORKER = tKey('Persona trabajadora');
const COORDINATION = AUTHORITY_LABEL.coordinator;
const ACTION_OWNER = tKey('Responsable de la acción preventiva');

const m = (text: string, params?: Msg['params']): Msg => ({ text, params });

/** What should happen next for one requirement item, and who does it. */
export function itemAction(it: MatrixItem, worksiteId: ID | null = null): NextAction {
  const authority = AUTHORITY_LABEL[it.version.reviewAuthority];
  if (it.restricted) return { action: m(tKey('Resolver el requisito restringido (detalle restringido)')), owner: COORDINATION, worksiteId, tone: 'warning' };
  switch (it.status) {
    case 'missing':
    case 'rejected':
    case 'expired':
      return { action: m(tKey('Aportar evidencia: «{name}»'), { name: it.version.name }), owner: authority, worksiteId, tone: it.critical ? 'danger' : 'warning' };
    case 'requested':
      return { action: m(tKey('Aportar la evidencia solicitada: «{name}»'), { name: it.version.name }), owner: authority, worksiteId, tone: it.critical ? 'danger' : 'warning' };
    case 'received':
    case 'in_review':
      return { action: m(tKey('Revisar la evidencia: «{name}»'), { name: it.version.name }), owner: authority, worksiteId, tone: 'info' };
    case 'pending_ack':
      return { action: m(tKey('Confirmar la recepción: «{name}»'), { name: it.version.name }), owner: WORKER, worksiteId, tone: 'warning' };
    case 'review_required':
    case 'review_due':
      return { action: m(tKey('Revisión profesional: «{name}»'), { name: it.version.name }), owner: authority, worksiteId, tone: 'warning' };
    default:
      return { action: m(tKey('Revisar el requisito: «{name}»'), { name: it.version.name }), owner: authority, worksiteId, tone: 'neutral' };
  }
}

/**
 * Next action for an employee, derived from the worst readiness reason (first unresolved item).
 * Uses only data the caller may already see (items are health-masked by the service).
 */
export function nextAction(db: Database, readiness: Readiness[], items: MatrixItem[]): NextAction | null {
  if (!readiness.length) return null;
  const [worst] = byWorst(readiness);
  if (worst.state === 'ready') {
    const unconfirmed = readiness.find((r) => !r.confirmation);
    return unconfirmed
      ? { action: m(tKey('Confirmar la asignación como lista')), owner: COORDINATION, worksiteId: unconfirmed.worksiteId, tone: 'success' }
      : { action: m(tKey('Sin acciones pendientes')), owner: null, worksiteId: null, tone: 'neutral' };
  }
  const reason = worst.reasons.find((r) => r.state === worst.state);
  if (reason?.templateId) {
    const it = items.find((i) => i.template.id === reason.templateId && i.worksiteIds.includes(worst.worksiteId)) ?? items.find((i) => i.template.id === reason.templateId);
    if (it) return itemAction(it, worst.worksiteId);
  }
  if (worst.state === 'pending_evaluation') {
    const change = db.changes.some((c) => c.employeeId === worst.employeeId && c.status === 'pending_review' && c.focusWorksiteIds.includes(worst.worksiteId));
    return change
      ? { action: m(tKey('Completar la revisión de cambios')), owner: COORDINATION, worksiteId: worst.worksiteId, tone: 'warning' }
      : { action: m(tKey('Aportar la evaluación de riesgos que cubra el puesto')), owner: AUTHORITY_LABEL.provider_technical, worksiteId: worst.worksiteId, tone: 'warning' };
  }
  const code = reason?.msg.params?.code;
  if (worst.state === 'blocked' && code) return { action: m(tKey('Resolver la acción preventiva {code}'), { code }), owner: ACTION_OWNER, worksiteId: worst.worksiteId, tone: 'danger' };
  return { action: reason?.msg ?? m(tKey('Revisar la disponibilidad')), owner: COORDINATION, worksiteId: worst.worksiteId, tone: 'warning' };
}

// ─────────────────────────────── Labels ───────────────────────────────

export const VIA_LABEL: Record<AppliesVia, string> = {
  scope: tKey('Ámbito de la versión aprobada'),
  assignment: tKey('Asignación explícita'),
};

export const TRIGGER_LABEL: Record<AssignmentChange['trigger'], string> = {
  employee_change: tKey('Cambio de puesto o centros'),
  worksite_change: tKey('Cambio en un centro de trabajo'),
  requirement_change: tKey('Cambio de requisito'),
};

export const CHANGE_STATUS: Record<AssignmentChange['status'], { label: string; tone: 'warning' | 'success' }> = {
  pending_review: { label: tKey('Revisión pendiente [cambios]'), tone: 'warning' },
  reviewed: { label: tKey('Revisión completada'), tone: 'success' },
};

export const DELTA_GROUPS = [
  { key: 'newlyRequired', label: tKey('Requisitos nuevos'), help: tKey('Pasan a aplicarse con la nueva asignación.') },
  { key: 'newCriticalUnresolved', label: tKey('Nuevos requisitos críticos sin resolver'), help: tKey('Bloquearán la disponibilidad hasta que se resuelvan.') },
  { key: 'unchanged', label: tKey('Requisitos sin cambios'), help: tKey('Siguen aplicándose igual.') },
  { key: 'noLongerApplicable', label: tKey('Ya no aplicables'), help: tKey('Dejan de aplicarse; su evidencia se conserva en el historial.') },
  { key: 'evidenceStillValid', label: tKey('Evidencia existente que sigue siendo válida'), help: tKey('Evidencia aceptada que no se ve afectada por el cambio.') },
  { key: 'evidenceNeedsReview', label: tKey('Evidencia que requiere nueva revisión'), help: tKey('Revisión necesaria, revisión vencida o caducada.') },
] as const;

/** Removes accents and case for search. */
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
