/**
 * Cross-cutting operations: notifications, the task inbox, exceptions review, identity switching
 * (demo login) and company settings.
 */
import { BusinessRuleError, NotFoundError, PermissionError, isMembershipActive } from '../domain/permissions';
import { detectExceptions, isOpenException, withReviews, type ExceptionView } from '../domain/exceptions';
import { EXCEPTION_STATUS } from '../domain/status';
import { assignmentOn, buildItems, diffItems } from '../domain/requirements';
import { nowInstant } from '../domain/time';
import { newId } from '../domain/ids';
import type { AppNotification, CompanySettings, ExceptionStatus, ID, JobRole } from '../domain/types';
import { patchUiOnly, setSession, transact } from '../store/db';
import { approvalPermission } from './requirementService';
import { auditReadinessChanges, audience, riskLabels, snap, usersWithRole } from './common';
import { alertDays, can, canSeeEmployee, canSeeHealth, getCtx, itemsFor, latency, ownCompany, requirePerm, visibleWorksiteIds, type Ctx } from './context';
import { canDecide, visibleDocuments } from './evidenceService';
import { canReviewAction, visibleActions } from './safetyService';
import { casePending, visibleCases } from './caeService';
import { visibleIssues, visibleTrainings } from './trainingService';

// ─────────────────────────────── Notifications ───────────────────────────────

/** Notifications addressed to the caller in the active company (no health details in any body). */
export function myNotifications(ctx: Ctx): AppNotification[] {
  if (!ctx.membership || !ctx.perms.size) return [];
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

// ─────────────────────────────── Identity (demo login) ───────────────────────────────

export function switchIdentity(userId: ID, companyId: ID) {
  const ctx = getCtx();
  const target = ctx.db.memberships.find((m) => m.userId === userId && m.companyId === companyId);
  setSession({ userId, companyId });
  if (target) {
    const after = getCtx();
    try {
      transact(after.actor, companyId, (tx) => {
        tx.audit({ action: 'session.switch', entityType: 'session', entityId: target.id, entityLabel: after.user.name, summary: after.perms.size ? 'Acceso a la empresa (cambio de usuario de demostración).' : 'Intento de acceso con un acceso no vigente: sin permisos.' });
      });
    } catch {
      /* storage full: switching still works; nothing else is written */
    }
  }
}

// ─────────────────────────────── Task inbox (PLT-04) ───────────────────────────────

export interface Task {
  id: string;
  kind: 'acknowledge' | 'submit' | 'resubmit' | 'ppe_ack' | 'training' | 'review_document' | 'approve_requirement' | 'review_action' | 'action_owner' | 'review_change' | 'review_assessment' | 'cae_followup' | 'health' | 'quarantine';
  title: string;
  detail: string;
  link: string;
  due: string | null;
}

/** What the caller must do next: their own pending items and the reviews assigned to them. */
export function myTasks(ctx: Ctx): Task[] {
  const out: Task[] = [];
  if (!ctx.membership || !ctx.perms.size) return out;
  if (ctx.employee && can(ctx, 'own.view')) {
    for (const it of itemsFor(ctx, ctx.employee.id)) {
      if (!it.counted && it.version.requirementType !== 'optional') continue;
      if (it.status === 'pending_ack' && it.version.evidenceMode === 'acknowledgement') out.push({ id: `ack:${it.key}`, kind: 'acknowledge', title: 'Confirmar la recepción de información', detail: it.version.name, link: it.evidence.documentId ? `/documentacion/${it.evidence.documentId}` : '/documentacion', due: null });
      if ((it.status === 'missing' || it.status === 'requested') && (it.version.evidenceMode === 'document' || it.version.evidenceMode === 'training')) out.push({ id: `sub:${it.key}`, kind: 'submit', title: 'Aportar evidencia', detail: it.version.name, link: `/documentacion?nuevo=1&requisito=${it.template.id}`, due: it.evidence.internalFollowUpDate });
      if (it.status === 'rejected') out.push({ id: `res:${it.key}`, kind: 'resubmit', title: 'Evidencia rechazada: presentar una nueva versión', detail: it.version.name, link: it.evidence.documentId ? `/documentacion/${it.evidence.documentId}` : '/documentacion', due: null });
    }
    for (const i of visibleIssues(ctx).filter((x) => x.employeeId === ctx.employee!.id && x.status === 'issued')) {
      if (!ctx.db.acknowledgements.some((a) => a.subject.kind === 'ppe_issue' && a.subject.id === i.id)) out.push({ id: `ppe:${i.id}`, kind: 'ppe_ack', title: 'Confirmar la recepción de un equipo', detail: ctx.db.equipment.find((x) => x.id === i.itemId)?.name ?? '', link: '/epi?tab=mis-equipos', due: null });
    }
    for (const t of visibleTrainings(ctx).filter((x) => x.employeeId === ctx.employee!.id && (x.status === 'assigned' || x.status === 'scheduled'))) out.push({ id: `trn:${t.id}`, kind: 'training', title: 'Formación pendiente', detail: ctx.db.courses.find((c) => c.id === t.courseId)?.title ?? '', link: '/formacion?tab=mi-formacion', due: t.scheduledDate });
  }
  for (const d of visibleDocuments(ctx)) {
    for (const v of ctx.db.docVersions.filter((x) => x.documentId === d.id && (x.status === 'received' || x.status === 'in_review'))) {
      if (canDecide(ctx, d, v)) out.push({ id: `rev:${v.id}`, kind: 'review_document', title: 'Revisar documento', detail: `${d.code} · ${d.title}`, link: `/documentacion/${d.id}`, due: null });
    }
  }
  for (const v of ctx.db.versions.filter((x) => x.companyId === ctx.company.id && x.status === 'pending_approval')) {
    if (can(ctx, approvalPermission(v)) && v.createdBy !== ctx.user.id) out.push({ id: `apr:${v.id}`, kind: 'approve_requirement', title: 'Aprobar requisito', detail: `${v.name} (v${v.version})`, link: `/requisitos/${v.templateId}`, due: null });
  }
  for (const a of visibleActions(ctx)) {
    if (a.status === 'pending_review' && canReviewAction(ctx, a)) out.push({ id: `act:${a.id}`, kind: 'review_action', title: 'Revisar resolución de acción', detail: `${a.code} · ${a.title}`, link: `/acciones/${a.id}`, due: a.targetDate });
    else if (a.ownerUserId === ctx.user.id && a.status !== 'resolved' && a.status !== 'pending_review') out.push({ id: `own:${a.id}`, kind: 'action_owner', title: 'Acción preventiva asignada', detail: `${a.code} · ${a.title}`, link: `/acciones/${a.id}`, due: a.targetDate });
  }
  if (can(ctx, 'changes.review')) for (const c of ctx.db.changes.filter((x) => x.companyId === ctx.company.id && x.status === 'pending_review' && canSeeEmployee(ctx, x.employeeId))) out.push({ id: `chg:${c.id}`, kind: 'review_change', title: 'Revisar cambio de puesto o centro', detail: `${ctx.db.employees.find((e) => e.id === c.employeeId)?.firstName ?? ''} · ${c.delta.newlyRequired.length} requisitos nuevos`, link: `/empleados/${c.employeeId}?tab=cambios`, due: null });
  if (can(ctx, 'risk.review')) for (const a of ctx.db.assessments.filter((x) => x.companyId === ctx.company.id && (x.status === 'submitted' || x.status === 'under_review' || x.status === 'review_required'))) out.push({ id: `ra:${a.id}`, kind: 'review_assessment', title: 'Revisar evaluación de riesgos', detail: `${a.code} · ${a.title}`, link: `/evaluaciones/${a.id}`, due: a.reviewDate });
  for (const c of visibleCases(ctx)) {
    if (c.followUpOwnerId !== ctx.user.id || c.status === 'closed') continue;
    const p = casePending(ctx, c);
    if (p.notSent + p.noReceipt + p.noAck + p.toReview > 0 || p.followUpOverdue) out.push({ id: `cae:${c.id}`, kind: 'cae_followup', title: 'Seguimiento de coordinación CAE', detail: `${c.code} · ${c.title}`, link: `/cae/${c.id}`, due: c.nextFollowUp });
  }
  if (can(ctx, 'health.manage')) {
    const q = ctx.db.quarantine.filter((x) => x.companyId === ctx.company.id && x.status === 'quarantined').length;
    if (q) out.push({ id: 'quarantine', kind: 'quarantine', title: 'Documentos en cuarentena', detail: `${q}`, link: '/salud?tab=cuarentena', due: null });
  }
  return out;
}

// ─────────────────────────────── Exceptions ───────────────────────────────

/** Exceptions visible to the caller: scoped to their employees/worksites; health ones only to health roles. */
export function visibleExceptions(ctx: Ctx): ExceptionView[] {
  if (!ctx.membership || !ctx.perms.size) return [];
  const all = withReviews(ctx.db, ctx.company.id, detectExceptions(ctx.db, ctx.company.id, ctx.today, alertDays(ctx)));
  const sites = visibleWorksiteIds(ctx);
  const broad = can(ctx, 'exceptions.manage') || can(ctx, 'readiness.view_all');
  return all.filter((e) => {
    if (e.restricted) return e.type === 'quarantine' ? can(ctx, 'health.manage') : canSeeHealth(ctx);
    if (e.employeeId) return canSeeEmployee(ctx, e.employeeId) && (broad || can(ctx, 'team.view') || e.employeeId === ctx.employee?.id);
    if (e.worksiteId) return sites.has(e.worksiteId) && (broad || can(ctx, 'team.view'));
    return broad;
  });
}

export type ExceptionAction = 'assign' | 'acknowledge' | 'investigate' | 'resolve' | 'reopen';
const TARGET: Record<ExceptionAction, ExceptionStatus> = { assign: 'assigned', acknowledge: 'acknowledged', investigate: 'investigating', resolve: 'resolved', reopen: 'reopened' };

export const ACTION_LABEL: Record<ExceptionAction, string> = { assign: 'Asignar', acknowledge: 'Marcar como vista', investigate: 'Investigar', resolve: 'Resolver', reopen: 'Reabrir' };

export function canManageException(ctx: Ctx, e: ExceptionView): boolean {
  if (e.restricted) return can(ctx, 'health.manage') || (e.type === 'health_pending' && can(ctx, 'health.view_conclusions'));
  return can(ctx, 'exceptions.manage') || e.ownerUserId === ctx.user.id;
}

export async function updateException(key: string, action: ExceptionAction, note: string, ownerUserId?: ID): Promise<void> {
  await latency();
  const ctx = getCtx();
  const e = visibleExceptions(ctx).find((x) => x.key === key);
  if (!e) throw new NotFoundError();
  if (!canManageException(ctx, e)) throw new PermissionError();
  if (action === 'reopen' && e.status !== 'resolved') throw new BusinessRuleError('Solo se reabren incidencias resueltas.');
  if (action !== 'reopen' && e.status === 'resolved') throw new BusinessRuleError('La incidencia está resuelta; reábrala primero.');
  if (!note.trim()) throw new BusinessRuleError('Indique una nota (queda en el historial).');
  if (action === 'assign' && (!ownerUserId || !ctx.db.memberships.some((m) => m.userId === ownerUserId && m.companyId === ctx.company.id && isMembershipActive(m, ctx.today)))) throw new BusinessRuleError('Seleccione un responsable con acceso vigente.');
  const now = nowInstant();
  const to = TARGET[action];
  const reasonText = e.reason.params ? Object.entries(e.reason.params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), e.reason.text) : e.reason.text;
  transact(ctx.actor, ctx.company.id, (tx) => {
    const entry = { at: now, by: ctx.user.id, status: to, note: note.trim() };
    if (e.review) tx.update('exceptionReviews', e.review.id, { status: to, ownerUserId: action === 'assign' ? ownerUserId! : e.review.ownerUserId, history: [...e.review.history, entry], snapshot: reasonText, updatedAt: now });
    else tx.insert('exceptionReviews', { id: newId('exr'), companyId: ctx.company.id, key, status: to, ownerUserId: action === 'assign' ? ownerUserId! : e.ownerUserId, history: [entry], snapshot: reasonText, updatedAt: now });
    tx.audit({ action: 'exception.update', entityType: 'exception', entityId: key, entityLabel: e.source.params ? Object.entries(e.source.params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), e.source.text) : e.source.text, summary: `${EXCEPTION_STATUS[e.status].label} → ${EXCEPTION_STATUS[to].label}.`, reason: note.trim(), employeeId: e.employeeId, restricted: e.restricted });
    if (action === 'assign') tx.notify({ type: 'exception.assign', title: 'Incidencia asignada', body: e.restricted ? 'Incidencia del área restringida' : reasonText, recipientUserIds: audience([ownerUserId], ctx.user.id), link: '/incidencias', dedupeKey: `exc:${key}:${now}` });
  });
}

export const openCount = (list: ExceptionView[]) => list.filter((e) => isOpenException(e.status)).length;

// ─────────────────────────────── Settings ───────────────────────────────

export async function updateSettings(patch: Pick<CompanySettings, 'alertWindowDays' | 'clinicalKeywords' | 'shareLinkMaxDays'>): Promise<CompanySettings> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.manage');
  const errors: string[] = [];
  if (!Number.isInteger(patch.alertWindowDays) || patch.alertWindowDays < 1 || patch.alertWindowDays > 180) errors.push('Ventana de aviso: entre 1 y 180 días.');
  if (!Number.isInteger(patch.shareLinkMaxDays) || patch.shareLinkMaxDays < 1 || patch.shareLinkMaxDays > 90) errors.push('Caducidad máxima de enlaces: entre 1 y 90 días.');
  if (!patch.clinicalKeywords.filter((k) => k.trim()).length) errors.push('Mantenga al menos un término de detección de contenido clínico.');
  if (errors.length) throw new BusinessRuleError('Revise la configuración', errors);
  const current = ctx.settings;
  const next: CompanySettings = { ...current, ...patch, clinicalKeywords: patch.clinicalKeywords.map((k) => k.trim()).filter(Boolean), updatedBy: ctx.user.id, updatedAt: nowInstant() };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (ctx.db.settings.some((s) => s.id === current.id)) tx.update('settings', current.id, next);
    else tx.insert('settings', { ...next, id: newId('set') });
    tx.audit({ action: 'settings.update', entityType: 'settings', entityId: current.id, entityLabel: 'Configuración de DatosPilot', summary: 'Configuración modificada (valores de producto, no plazos legales).', changes: [{ field: 'Ventana de aviso (días)', before: String(current.alertWindowDays), after: String(next.alertWindowDays) }, { field: 'Caducidad máxima de enlaces (días)', before: String(current.shareLinkMaxDays), after: String(next.shareLinkMaxDays) }, { field: 'Términos de cuarentena', before: current.clinicalKeywords.join(', '), after: next.clinicalKeywords.join(', ') }].filter((c) => c.before !== c.after) });
    return next;
  });
}

/** Changing a job role's risks re-evaluates requirements of everyone in the role (delta reviews). */
export async function saveJobRole(input: Pick<JobRole, 'name' | 'departmentId' | 'tasks' | 'riskTags'>, id: ID | null, reason: string): Promise<{ role: JobRole; reviews: number }> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.manage');
  const errors: string[] = [];
  if (!input.name.trim()) errors.push('Nombre: obligatorio.');
  if (!ctx.db.departments.some((d) => d.id === input.departmentId && d.companyId === ctx.company.id)) errors.push('Departamento: obligatorio.');
  if (input.riskTags.some((t) => ctx.db.riskTags.some((r) => r.id === t && r.companyId === ctx.company.id && r.specialist))) errors.push('Riesgos de alcance especializado: fuera del alcance inicial.');
  const existing = id ? ownCompany(ctx, ctx.db.jobRoles.find((r) => r.id === id)) : null;
  const riskChanged = !!existing && [...existing.riskTags].sort().join() !== [...input.riskTags].sort().join();
  if (riskChanged && !reason.trim()) errors.push('Indique el motivo del cambio de riesgos (normalmente, la evaluación de riesgos revisada).');
  if (errors.length) throw new BusinessRuleError('Revise el puesto', errors);
  const role: JobRole = existing ? { ...existing, ...input, name: input.name.trim() } : { id: newId('jr'), companyId: ctx.company.id, active: true, ...input, name: input.name.trim() };
  const people = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active' && assignmentOn(ctx.db, e.id, ctx.today)?.jobRoleId === role.id).map((e) => e.id);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (existing) tx.update('jobRoles', role.id, role);
    else tx.insert('jobRoles', role);
    let reviews = 0;
    if (riskChanged) {
      const after = snap(tx);
      for (const id2 of people) {
        const a = assignmentOn(ctx.db, id2, ctx.today)!;
        const shape = { jobRoleId: a.jobRoleId, departmentId: a.departmentId, worksiteIds: a.worksiteIds };
        const delta = diffItems(buildItems(ctx.db, ctx.company.id, id2, shape, { date: ctx.today, alertDays: alertDays(ctx) }), buildItems(after, ctx.company.id, id2, shape, { date: ctx.today, alertDays: alertDays(ctx) }));
        if (!delta.newlyRequired.length && !delta.noLongerApplicable.length) continue;
        reviews++;
        tx.insert('changes', { id: newId('chg'), companyId: ctx.company.id, employeeId: id2, trigger: 'requirement_change', focusWorksiteIds: shape.worksiteIds, before: shape, after: shape, effectiveFrom: ctx.today, reason: `Cambio de riesgos del puesto ${role.name}: ${reason.trim()}`, delta, status: 'pending_review', createdBy: ctx.user.id, createdAt: nowInstant(), reviewedBy: null, reviewedAt: null, reviewNote: null });
      }
      if (reviews) tx.notify({ type: 'change.review', title: 'Cambio de riesgos de un puesto: revisar requisitos', body: `${role.name} · ${reviews} personas`, recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today), ctx.user.id), link: '/incidencias?tipo=change_review', dedupeKey: `jr:${role.id}:${Date.now()}` });
      auditReadinessChanges(tx, ctx, people, `riesgos del puesto ${role.name}`);
    }
    tx.audit({ action: 'settings.update', entityType: 'job_role', entityId: role.id, entityLabel: role.name, summary: existing ? `Puesto modificado${reviews ? `; ${reviews} revisiones de requisitos abiertas` : ''}.` : 'Puesto creado.', reason: reason.trim() || null, changes: existing ? [{ field: 'Riesgos', before: riskLabels(ctx, existing.riskTags), after: riskLabels(ctx, role.riskTags) }].filter((c) => c.before !== c.after) : [] });
    return { role, reviews };
  });
}

/** Immediate revocation of a membership (provider end of contract, mandate end…). */
export async function revokeMembership(membershipId: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.manage');
  const m = ownCompany(ctx, ctx.db.memberships.find((x) => x.id === membershipId));
  if (m.userId === ctx.user.id) throw new BusinessRuleError('No puede revocar su propio acceso.');
  if (m.status === 'revoked') throw new BusinessRuleError('El acceso ya está revocado.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('memberships', m.id, { status: 'revoked', revokedAt: nowInstant() });
    tx.audit({ action: 'settings.update', entityType: 'membership', entityId: m.id, entityLabel: ctx.db.users.find((u) => u.id === m.userId)?.name ?? m.userId, summary: 'Acceso revocado de inmediato: se bloquean lecturas, descargas y acciones posteriores.', reason: reason.trim() });
  });
}