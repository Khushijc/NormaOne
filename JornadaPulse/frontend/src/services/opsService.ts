/**
 * Exception review, notifications, pending actions and demo session switching.
 * Future endpoints: /anomalies/{key}/review, /notifications, /me/tasks, /session.
 */
import { listAnomalies, isOpenStatus, type Anomaly } from '../domain/anomalies';
import { newId } from '../domain/ids';
import { BusinessRuleError, PermissionError } from '../domain/permissions';
import { nowInstant } from '../domain/time';
import type { AnomalyReview, AnomalyStatus, AppNotification, ID } from '../domain/types';
import { patchUiOnly, setSession, transact } from '../store/db';
import { absencesAwaitingMe } from './absenceService';
import { can, employeeName, getCtx, latency, teamIds, userName, visibleEmployeeIds, type Ctx } from './context';
import { correctionsAwaitingMe } from './correctionService';

// ─────────────────────────────── Exceptions ───────────────────────────────

/** Anomalies visible to the caller: company-wide, or own team for supervisors. */
export function visibleAnomalies(ctx: Ctx, nowIso?: string): Anomaly[] {
  if (!can(ctx, 'anomalies.view_all') && !can(ctx, 'anomalies.manage_team')) return [];
  const visible = can(ctx, 'anomalies.view_all') ? visibleEmployeeIds(ctx) : teamIds(ctx);
  return listAnomalies(ctx.db, ctx.company.id, nowIso).filter((a) => visible.has(a.employeeId));
}

export function canManageAnomaly(ctx: Ctx, a: Anomaly): boolean {
  if (ctx.employee?.id === a.employeeId) return false; // nobody reviews their own exceptions
  if (can(ctx, 'anomalies.manage_all')) return true;
  return can(ctx, 'anomalies.manage_team') && teamIds(ctx).has(a.employeeId);
}

export type AnomalyAction = 'assign' | 'acknowledge' | 'investigate' | 'resolve' | 'dismiss' | 'reopen' | 'comment';

const NEXT: Record<AnomalyAction, AnomalyStatus | null> = { assign: null, acknowledge: 'acknowledged', investigate: 'investigating', resolve: 'resolved', dismiss: 'dismissed', reopen: 'open', comment: null };

/**
 * Records a review step. Resolving or dismissing requires a note. The underlying record is never
 * edited: a data problem is fixed through a correction request, which then resolves the anomaly.
 */
export async function reviewAnomaly(key: string, action: AnomalyAction, note: string, assigneeId?: ID | null): Promise<AnomalyReview> {
  await latency();
  const ctx = getCtx();
  const a = visibleAnomalies(ctx).find((x) => x.key === key);
  if (!a) throw new BusinessRuleError('La incidencia no existe o está fuera de su ámbito.');
  if (!canManageAnomaly(ctx, a)) throw new PermissionError(ctx.employee?.id === a.employeeId ? 'No puede revisar incidencias de sus propios registros.' : undefined);
  if ((action === 'resolve' || action === 'dismiss') && note.trim().length < 5) throw new BusinessRuleError('Explique la resolución o el motivo del descarte.');
  if (action === 'comment' && !note.trim()) throw new BusinessRuleError('Escriba un comentario.');
  if (action === 'reopen' && isOpenStatus(a.status)) throw new BusinessRuleError('La incidencia ya está abierta.');
  if ((action === 'acknowledge' || action === 'investigate' || action === 'resolve' || action === 'dismiss') && !isOpenStatus(a.status)) throw new BusinessRuleError('La incidencia ya está cerrada; reábrala primero.');
  if (action === 'assign') {
    if (!assigneeId) throw new BusinessRuleError('Seleccione a quién asignarla.');
    const m = ctx.db.memberships.find((x) => x.userId === assigneeId && x.companyId === ctx.company.id && x.status === 'active' && (x.roles.includes('hr_admin') || x.roles.includes('supervisor')));
    if (!m) throw new BusinessRuleError('Solo se puede asignar a RR. HH. o a una persona supervisora de la empresa.');
  }
  const at = nowInstant();
  const status = NEXT[action] ?? a.status;
  const entry = { at, by: ctx.user.id, action, note: action === 'assign' ? `Asignada a ${userName(ctx.db, assigneeId)}.${note.trim() ? ` ${note.trim()}` : ''}` : note.trim() || null };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const existing = tx.db.anomalyReviews.find((r) => r.companyId === ctx.company.id && r.key === key);
    const snapshot = { key: a.key, type: a.type, companyId: a.companyId, employeeId: a.employeeId, date: a.date, ref: a.ref, reason: a.reason, severity: a.severity };
    let row: AnomalyReview;
    if (existing) {
      row = tx.update('anomalyReviews', existing.id, (r): Partial<AnomalyReview> => ({ status, assigneeId: action === 'assign' ? assigneeId! : r.assigneeId, resolution: action === 'resolve' || action === 'dismiss' ? note.trim() : action === 'reopen' ? null : r.resolution, history: [...r.history, entry], snapshot: r.snapshot ?? snapshot, updatedAt: at }));
    } else {
      row = { id: newId('anr'), companyId: ctx.company.id, key, snapshot, assigneeId: action === 'assign' ? assigneeId! : null, status, history: [entry], resolution: action === 'resolve' || action === 'dismiss' ? note.trim() : null, updatedAt: at };
      tx.insert('anomalyReviews', row);
    }
    tx.audit({ action: 'anomaly.update', entityType: 'anomaly', entityId: key, entityLabel: employeeName(ctx.db, a.employeeId), employeeId: a.employeeId, summary: `Incidencia «${a.type}» del ${a.date}: ${action}.`, reason: entry.note });
    if (action === 'assign' && assigneeId && assigneeId !== ctx.user.id) tx.notify({ type: 'anomaly_assigned', title: 'Incidencia asignada para revisión', body: 'Tiene una incidencia de registro horario asignada.', recipientUserIds: [assigneeId], link: `/incidencias?clave=${encodeURIComponent(key)}`, dedupeKey: `anm:${key}:${at}` });
    return row;
  });
}

// ─────────────────────────────── Notifications ───────────────────────────────

export function myNotifications(ctx: Ctx): AppNotification[] {
  return ctx.db.notifications.filter((n) => n.companyId === ctx.company.id && n.recipientUserIds.includes(ctx.user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function markRead(id: ID) {
  const ctx = getCtx();
  const n = ctx.db.notifications.find((x) => x.id === id && x.companyId === ctx.company.id);
  if (!n || n.readBy.includes(ctx.user.id)) return;
  patchUiOnly('notifications', id, { readBy: [...n.readBy, ctx.user.id] });
}

export function markAllRead() {
  const ctx = getCtx();
  for (const n of myNotifications(ctx).filter((x) => !x.readBy.includes(ctx.user.id))) patchUiOnly('notifications', n.id, { readBy: [...n.readBy, ctx.user.id] });
}

// ─────────────────────────────── Pending actions (task inbox, PLT-04) ───────────────────────────────

export interface PendingActions {
  corrections: number;
  absences: number;
  anomalies: number;
  myProposals: number;
  myNotRecorded: number;
}

export function pendingActions(ctx: Ctx): PendingActions {
  const corr = correctionsAwaitingMe(ctx);
  return {
    corrections: corr.filter((c) => c.status === 'pending' || (c.status === 'pending_employee' && c.employeeId !== ctx.employee?.id)).length,
    absences: absencesAwaitingMe(ctx).length,
    anomalies: visibleAnomalies(ctx).filter((a) => a.active && isOpenStatus(a.status) && canManageAnomaly(ctx, a)).length,
    myProposals: corr.filter((c) => c.status === 'pending_employee' && c.employeeId === ctx.employee?.id).length,
    myNotRecorded: ctx.employee ? ctx.db.failedAttempts.filter((f) => f.employeeId === ctx.employee!.id && !f.correctionId).length : 0,
  };
}

// ─────────────────────────────── Demo identity switching (audited, BRD §05) ───────────────────────────────

export function switchIdentity(userId: ID, companyId: ID) {
  const ctx = getCtx();
  const target = ctx.db.memberships.find((m) => m.userId === userId && m.companyId === companyId);
  setSession({ userId, companyId });
  if (target) {
    const after = getCtx();
    // Audit in the target company; an inactive membership still records the access attempt.
    try {
      transact(after.actor, companyId, (tx) => {
        tx.audit({ action: 'session.switch', entityType: 'session', entityId: target.id, entityLabel: after.user.name, summary: after.perms.size ? 'Acceso a la empresa (cambio de usuario de demostración).' : 'Intento de acceso con un acceso no vigente: sin permisos.' });
      });
    } catch {
      /* storage full: switching still works; nothing else is written */
    }
  }
}
