/**
 * Risk assessments (record management, not an assessment engine) and preventive actions.
 *
 * - The app stores assessments produced by the assessor/provider. It never computes risk scores
 *   and an accepted assessment is not a statement that a workplace is safe.
 * - Accepting a new version supersedes the previous one (kept). Construction / hazardous-process
 *   assessments are outside the initial scope.
 * - An action is closed only by the configured review authority accepting the resolution; it
 *   cannot be submitted without the required evidence, and an upload never closes it.
 */
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { ACTION_TRANSITIONS, ASSESSMENT_TRANSITIONS } from '../domain/status';
import { nowInstant } from '../domain/time';
import { newId } from '../domain/ids';
import type { ActionStatus, AssessmentStatus, Hazard, ID, ISODate, PreventiveAction, RiskAssessment } from '../domain/types';
import { transact } from '../store/db';
import { auditReadinessChanges, audience, checkDate, usersWithRole } from './common';
import { can, canReviewAuthority, canSeeEmployee, getCtx, latency, ownCompany, requirePerm, visibleWorksiteIds, type Ctx } from './context';

// ─────────────────────────────── Risk assessments ───────────────────────────────

export type AssessmentInput = Pick<RiskAssessment, 'title' | 'worksiteId' | 'activity' | 'jobRoleIds' | 'providerId' | 'assessorName' | 'issueDate' | 'effectiveDate' | 'reviewDate' | 'hazards' | 'preventiveMeasures' | 'documentId' | 'linkedTemplateIds' | 'ownerUserId'>;

export function validateAssessment(ctx: Ctx, input: AssessmentInput): string[] {
  const e: string[] = [];
  if (!input.title.trim()) e.push('Título: obligatorio.');
  if (!input.activity.trim()) e.push('Actividad: obligatoria.');
  if (!input.worksiteId && !input.jobRoleIds.length) e.push('Indique el centro o los puestos evaluados.');
  if (!input.assessorName.trim()) e.push('Evaluador: obligatorio (personal competente, RD 39/1997 art. 4.3).');
  const issue = checkDate(e, input.issueDate, 'Fecha de emisión');
  checkDate(e, input.effectiveDate, 'Fecha de efecto');
  const review = checkDate(e, input.reviewDate, 'Fecha de revisión (si el evaluador la estableció)');
  if (review && issue && review <= issue) e.push('La revisión debe ser posterior a la emisión.');
  if (issue && issue > ctx.today) e.push('La fecha de emisión no puede ser futura.');
  input.hazards.forEach((h, i) => {
    if (!h.description.trim()) e.push(`Peligro ${i + 1}: descripción obligatoria.`);
  });
  const specialist = input.hazards.filter((h) => ctx.db.riskTags.some((r) => r.companyId === ctx.company.id && r.id === h.riskTag && r.specialist));
  if (specialist.length) e.push('Incluye riesgos de alcance especializado (construcción, espacios confinados…): quedan fuera del alcance inicial del producto y requieren un circuito aprobado aparte.');
  return e;
}

function nextCode(ctx: Ctx): string {
  const n = new Set(ctx.db.assessments.filter((a) => a.companyId === ctx.company.id).map((a) => a.code)).size + 1;
  return `ER-${String(n).padStart(3, '0')}`;
}

export async function registerAssessment(input: AssessmentInput, supersedesId?: ID): Promise<RiskAssessment> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'risk.register');
  const errors = validateAssessment(ctx, input);
  const prev = supersedesId ? ownCompany(ctx, ctx.db.assessments.find((a) => a.id === supersedesId)) : null;
  if (prev && prev.status !== 'accepted' && prev.status !== 'review_required') errors.push('Solo se crea una nueva versión de una evaluación aceptada o marcada para revisión.');
  if (prev && ctx.db.assessments.some((a) => a.supersedesId === prev.id && a.status !== 'superseded')) errors.push('Ya existe una nueva versión en curso.');
  if (errors.length) throw new BusinessRuleError('Revise la evaluación', errors);
  const row: RiskAssessment = { id: newId('ra'), companyId: ctx.company.id, code: prev?.code ?? nextCode(ctx), version: prev ? prev.version + 1 : 1, supersedesId: prev?.id ?? null, status: 'draft', reviewNote: null, reviewedBy: null, reviewedAt: null, createdBy: ctx.user.id, createdAt: nowInstant(), ...input, hazards: input.hazards.map((h, i) => ({ ...h, id: h.id || `hz_${i + 1}` })) };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('assessments', row);
    tx.audit({ action: 'assessment.register', entityType: 'assessment', entityId: row.id, entityLabel: `${row.code} · ${row.title}`, summary: prev ? `Nueva versión ${row.version} en borrador.` : 'Evaluación registrada en borrador.', version: `v${row.version}` });
    return row;
  });
}

export async function updateAssessment(id: ID, input: AssessmentInput): Promise<RiskAssessment> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'risk.register');
  const a = ownCompany(ctx, ctx.db.assessments.find((x) => x.id === id));
  if (a.status !== 'draft') throw new BusinessRuleError('Solo se editan borradores; para cambiar una evaluación aceptada cree una nueva versión.');
  const errors = validateAssessment(ctx, input);
  if (errors.length) throw new BusinessRuleError('Revise la evaluación', errors);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('assessments', a.id, { ...input });
    tx.audit({ action: 'assessment.register', entityType: 'assessment', entityId: a.id, entityLabel: `${a.code} · ${input.title}`, summary: 'Borrador modificado.', version: `v${a.version}` });
    return u;
  });
}

function move(a: RiskAssessment, to: AssessmentStatus) {
  if (!ASSESSMENT_TRANSITIONS[a.status].includes(to)) throw new BusinessRuleError('Cambio de estado no permitido para esta evaluación.');
}

export async function submitAssessment(id: ID): Promise<RiskAssessment> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'risk.register');
  const a = ownCompany(ctx, ctx.db.assessments.find((x) => x.id === id));
  move(a, 'submitted');
  if (!a.documentId) throw new BusinessRuleError('Vincule el documento de la evaluación antes de enviarla.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('assessments', a.id, { status: 'submitted' });
    tx.audit({ action: 'assessment.submit', entityType: 'assessment', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: 'Enviada al servicio de prevención para su revisión.', version: `v${a.version}` });
    tx.notify({ type: 'assessment.submit', title: 'Evaluación pendiente de revisión', body: `${a.code} ${a.title}`, recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, ['provider_technical'], ctx.today), ctx.user.id), link: `/evaluaciones/${a.id}`, dedupeKey: `ra-sub:${a.id}:${a.version}` });
    return u;
  });
}

export async function reviewAssessment(id: ID, decision: 'start' | 'accept' | 'return', note: string): Promise<RiskAssessment> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'risk.review');
  const a = ownCompany(ctx, ctx.db.assessments.find((x) => x.id === id));
  const to: AssessmentStatus = decision === 'start' ? 'under_review' : decision === 'accept' ? 'accepted' : 'draft';
  move(a, to);
  if (decision !== 'start' && !note.trim()) throw new BusinessRuleError('Indique la nota de revisión.');
  const prev = a.supersedesId ? ctx.db.assessments.find((x) => x.id === a.supersedesId) : undefined;
  const affected = ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => e.id);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('assessments', a.id, { status: to, reviewNote: note.trim() || a.reviewNote, reviewedBy: decision === 'start' ? a.reviewedBy : ctx.user.id, reviewedAt: decision === 'start' ? a.reviewedAt : nowInstant(), effectiveDate: decision === 'accept' ? a.effectiveDate ?? ctx.today : a.effectiveDate });
    if (decision === 'accept' && prev && prev.status !== 'superseded') {
      tx.update('assessments', prev.id, { status: 'superseded' });
      tx.audit({ action: 'assessment.supersede', entityType: 'assessment', entityId: prev.id, entityLabel: `${prev.code} v${prev.version}`, summary: `Sustituida por la versión ${a.version} (se conserva).`, version: `v${prev.version}` });
    }
    tx.audit({ action: decision === 'start' ? 'assessment.review_start' : decision === 'accept' ? 'assessment.accept' : 'assessment.return', entityType: 'assessment', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: decision === 'accept' ? 'Aceptada como registro vigente. No declara que el centro sea seguro.' : decision === 'return' ? 'Devuelta a borrador.' : 'Revisión iniciada.', reason: note.trim() || null, version: `v${a.version}` });
    if (decision !== 'start') tx.notify({ type: `assessment.${decision}`, title: decision === 'accept' ? 'Evaluación aceptada' : 'Evaluación devuelta', body: `${a.code} ${a.title}`, recipientUserIds: audience([a.ownerUserId, a.createdBy], ctx.user.id), link: `/evaluaciones/${a.id}`, dedupeKey: `ra-dec:${a.id}:${decision}:${Date.now()}` });
    if (decision === 'accept') auditReadinessChanges(tx, ctx, affected, `${a.code} aceptada`);
    return u;
  });
}

export async function markAssessmentForReview(id: ID, reason: string): Promise<RiskAssessment> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'risk.register', 'risk.review');
  const a = ownCompany(ctx, ctx.db.assessments.find((x) => x.id === id));
  move(a, 'review_required');
  if (!reason.trim()) throw new BusinessRuleError('Indique la causa (cambio de condiciones, daño a la salud, nuevo equipo…).');
  const affected = ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => e.id);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('assessments', a.id, { status: 'review_required', reviewNote: reason.trim() });
    tx.audit({ action: 'assessment.review_required', entityType: 'assessment', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: 'Marcada para revisión.', reason: reason.trim(), version: `v${a.version}` });
    tx.notify({ type: 'assessment.review_required', title: 'Evaluación marcada para revisión', body: `${a.code} ${a.title}`, recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, ['provider_technical', 'prl_coordinator'], ctx.today), ctx.user.id), link: `/evaluaciones/${a.id}`, dedupeKey: `ra-rr:${a.id}:${Date.now()}` });
    auditReadinessChanges(tx, ctx, affected, `${a.code} marcada para revisión`);
    return u;
  });
}

export function visibleAssessments(ctx: Ctx): RiskAssessment[] {
  if (!can(ctx, 'risk.view') && !can(ctx, 'representative.view')) return [];
  const sites = visibleWorksiteIds(ctx);
  const rep = !can(ctx, 'risk.register') && can(ctx, 'representative.view');
  return ctx.db.assessments.filter((a) => a.companyId === ctx.company.id && (!a.worksiteId || sites.has(a.worksiteId)) && (!rep || a.status === 'accepted' || a.status === 'review_required' || a.status === 'superseded'));
}

export const emptyHazard = (): Hazard => ({ id: '', riskTag: '', description: '', measures: '' });

// ─────────────────────────────── Preventive actions ───────────────────────────────

export type ActionInput = Pick<PreventiveAction, 'title' | 'description' | 'source' | 'employeeId' | 'jobRoleId' | 'worksiteId' | 'priority' | 'requiredEvidence' | 'evidenceRequired' | 'reviewAuthority' | 'affectsReadiness'>;

export async function createAction(input: ActionInput): Promise<PreventiveAction> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'actions.manage');
  const errors: string[] = [];
  if (!input.title.trim()) errors.push('Título: obligatorio.');
  if (!input.source.label.trim()) errors.push('Origen: obligatorio (requisito, revisión, evaluación, CAE…).');
  if (input.evidenceRequired && !input.requiredEvidence.trim()) errors.push('Describa la evidencia necesaria para cerrarla.');
  if (input.affectsReadiness && !can(ctx, 'requirements.approve_professional')) errors.push('Solo un profesional del servicio de prevención puede decidir que una acción condiciona la disponibilidad.');
  if (input.employeeId && !canSeeEmployee(ctx, input.employeeId)) throw new NotFoundError();
  if (errors.length) throw new BusinessRuleError('Revise la acción', errors);
  const count = ctx.db.actions.filter((a) => a.companyId === ctx.company.id).length;
  const now = nowInstant();
  const row: PreventiveAction = { id: newId('act'), companyId: ctx.company.id, code: `AP-${String(count + 1).padStart(3, '0')}`, ...input, title: input.title.trim(), ownerUserId: null, targetDate: null, targetJustification: '', status: 'open', evidenceDocumentIds: [], resolutionNote: null, notes: [{ at: now, by: ctx.user.id, kind: 'created', text: input.source.label }], createdBy: ctx.user.id, createdAt: now, resolvedAt: null };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('actions', row);
    tx.audit({ action: 'action.create', entityType: 'action', entityId: row.id, entityLabel: `${row.code} · ${row.title}`, summary: `Creada desde: ${row.source.label}.`, employeeId: row.employeeId });
    if (row.affectsReadiness) auditReadinessChanges(tx, ctx, ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => e.id), `${row.code} creada`);
    return row;
  });
}

function getAction(ctx: Ctx, id: ID) {
  return ownCompany(ctx, ctx.db.actions.find((a) => a.id === id));
}

function step(a: PreventiveAction, to: ActionStatus) {
  if (!ACTION_TRANSITIONS[a.status].includes(to)) throw new BusinessRuleError('Cambio de estado no permitido para esta acción.');
}

export async function assignAction(id: ID, ownerUserId: ID, targetDate: ISODate | null, justification: string): Promise<PreventiveAction> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'actions.manage');
  const a = getAction(ctx, id);
  step(a, 'assigned');
  const errors: string[] = [];
  if (!ctx.db.memberships.some((m) => m.userId === ownerUserId && m.companyId === ctx.company.id && m.status === 'active')) errors.push('Responsable: debe tener acceso a la empresa.');
  const d = checkDate(errors, targetDate, 'Fecha objetivo');
  if (d && !justification.trim()) errors.push('Justifique la fecha objetivo (no se fijan plazos sin base).');
  if (d && d < ctx.today) errors.push('La fecha objetivo no puede estar en el pasado.');
  if (errors.length) throw new BusinessRuleError('Revise la asignación', errors);
  const now = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('actions', a.id, { ownerUserId, targetDate: d, targetJustification: justification.trim(), status: a.status === 'open' || a.status === 'reopened' || a.status === 'assigned' ? 'assigned' : a.status, notes: [...a.notes, { at: now, by: ctx.user.id, kind: 'assigned', text: `Responsable: ${ctx.db.users.find((x) => x.id === ownerUserId)?.name ?? ownerUserId}${d ? `; fecha objetivo ${d}` : ''}.` }] });
    tx.audit({ action: 'action.assign', entityType: 'action', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: 'Responsable y fecha objetivo asignados.', employeeId: a.employeeId, changes: [{ field: 'Responsable', before: ctx.db.users.find((x) => x.id === a.ownerUserId)?.name ?? '—', after: ctx.db.users.find((x) => x.id === ownerUserId)?.name ?? '—' }, { field: 'Fecha objetivo', before: a.targetDate ?? '—', after: d ?? '—' }], reason: justification.trim() || null });
    tx.notify({ type: 'action.assign', title: 'Acción preventiva asignada', body: `${a.code} ${a.title}`, recipientUserIds: audience([ownerUserId], ctx.user.id), link: `/acciones/${a.id}`, dedupeKey: `act-asg:${a.id}:${ownerUserId}:${Date.now()}` });
    return u;
  });
}

const isOwner = (ctx: Ctx, a: PreventiveAction) => a.ownerUserId === ctx.user.id;

export async function addProgress(id: ID, text: string): Promise<PreventiveAction> {
  await latency();
  const ctx = getCtx();
  const a = getAction(ctx, id);
  if (!isOwner(ctx, a) && !can(ctx, 'actions.manage')) throw new PermissionError();
  if (a.status === 'resolved' || a.status === 'open') throw new BusinessRuleError(a.status === 'open' ? 'Asigne primero un responsable.' : 'La acción está resuelta; reábrala si el problema persiste.');
  if (a.status === 'pending_review') throw new BusinessRuleError('La acción está pendiente de revisión.');
  if (!text.trim()) throw new BusinessRuleError('Describa el avance.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('actions', a.id, { status: 'in_progress', notes: [...a.notes, { at: nowInstant(), by: ctx.user.id, kind: 'progress', text: text.trim() }] });
    tx.audit({ action: 'action.progress', entityType: 'action', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: 'Avance registrado.', reason: text.trim(), employeeId: a.employeeId });
    return u;
  });
}

/** Submit for review: blocked without the configured evidence (AC-PLT-04). */
export async function submitAction(id: ID, resolution: string): Promise<PreventiveAction> {
  await latency();
  const ctx = getCtx();
  const a = getAction(ctx, id);
  if (!isOwner(ctx, a) && !can(ctx, 'actions.manage')) throw new PermissionError();
  step(a, 'pending_review');
  const errors: string[] = [];
  if (!resolution.trim()) errors.push('Describa la resolución.');
  if (a.evidenceRequired) {
    const docs = ctx.db.docVersions.filter((v) => a.evidenceDocumentIds.includes(v.documentId) && v.status !== 'rejected' && v.status !== 'superseded');
    if (!docs.length) errors.push(`Falta la evidencia requerida: ${a.requiredEvidence}`);
  }
  if (errors.length) throw new BusinessRuleError('No se puede enviar a revisión', errors);
  const reviewers = a.reviewAuthority === 'coordinator' ? usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today) : usersWithRole(ctx.db, ctx.company.id, ['provider_technical'], ctx.today);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('actions', a.id, { status: 'pending_review', resolutionNote: resolution.trim(), notes: [...a.notes, { at: nowInstant(), by: ctx.user.id, kind: 'submitted', text: resolution.trim() }] });
    tx.audit({ action: 'action.submit', entityType: 'action', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: 'Enviada a revisión con su evidencia.', reason: resolution.trim(), employeeId: a.employeeId });
    tx.notify({ type: 'action.submit', title: 'Acción enviada a revisión', body: `${a.code} ${a.title}`, recipientUserIds: audience(reviewers, ctx.user.id), link: `/acciones/${a.id}`, dedupeKey: `act-sub:${a.id}:${Date.now()}` });
    return u;
  });
}

export function canReviewAction(ctx: Ctx, a: PreventiveAction): boolean {
  return can(ctx, 'actions.review') && canReviewAuthority(ctx, a.reviewAuthority === 'provider_medical' ? 'provider_technical' : a.reviewAuthority) && !isOwner(ctx, a);
}

export async function reviewAction(id: ID, decision: 'accept' | 'reject', note: string): Promise<PreventiveAction> {
  await latency();
  const ctx = getCtx();
  const a = getAction(ctx, id);
  if (!canReviewAction(ctx, a)) throw new PermissionError('Solo la autoridad de revisión configurada (y no el responsable) puede decidir.');
  step(a, decision === 'accept' ? 'resolved' : 'reopened');
  if (!note.trim()) throw new BusinessRuleError('Indique la nota de revisión.');
  const now = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('actions', a.id, { status: decision === 'accept' ? 'resolved' : 'reopened', resolvedAt: decision === 'accept' ? now : null, notes: [...a.notes, { at: now, by: ctx.user.id, kind: decision === 'accept' ? 'accepted' : 'rejected', text: note.trim() }] });
    tx.audit({ action: decision === 'accept' ? 'action.accept' : 'action.reject', entityType: 'action', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: decision === 'accept' ? 'Resolución aceptada; acción resuelta.' : 'Resolución rechazada; acción reabierta.', reason: note.trim(), employeeId: a.employeeId });
    tx.notify({ type: `action.${decision}`, title: decision === 'accept' ? 'Acción resuelta' : 'Acción reabierta', body: `${a.code} ${a.title}`, recipientUserIds: audience([a.ownerUserId, a.createdBy], ctx.user.id), link: `/acciones/${a.id}`, dedupeKey: `act-dec:${a.id}:${Date.now()}` });
    if (a.affectsReadiness) auditReadinessChanges(tx, ctx, ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => e.id), `${a.code} ${decision === 'accept' ? 'resuelta' : 'reabierta'}`);
    return u;
  });
}

export async function reopenAction(id: ID, reason: string): Promise<PreventiveAction> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'actions.manage');
  const a = getAction(ctx, id);
  step(a, 'reopened');
  if (!reason.trim()) throw new BusinessRuleError('Indique por qué se reabre.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('actions', a.id, { status: 'reopened', resolvedAt: null, notes: [...a.notes, { at: nowInstant(), by: ctx.user.id, kind: 'reopened', text: reason.trim() }] });
    tx.audit({ action: 'action.reopen', entityType: 'action', entityId: a.id, entityLabel: `${a.code} · ${a.title}`, summary: 'Acción reabierta.', reason: reason.trim(), employeeId: a.employeeId });
    if (a.affectsReadiness) auditReadinessChanges(tx, ctx, ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => e.id), `${a.code} reabierta`);
    return u;
  });
}

/** Actions visible to the caller. Representatives see them without the person concerned. */
export function visibleActions(ctx: Ctx): PreventiveAction[] {
  const mine = (a: PreventiveAction) => a.ownerUserId === ctx.user.id || (!!ctx.employee && a.employeeId === ctx.employee.id);
  return ctx.db.actions
    .filter((a) => a.companyId === ctx.company.id)
    .filter((a) => {
      if (can(ctx, 'actions.view_all')) return !a.employeeId || canSeeEmployee(ctx, a.employeeId);
      if (can(ctx, 'representative.view')) return true;
      if (can(ctx, 'team.view')) return mine(a) || (!!a.employeeId && canSeeEmployee(ctx, a.employeeId)) || (!!a.worksiteId && visibleWorksiteIds(ctx).has(a.worksiteId));
      return mine(a);
    })
    .map((a) => (!can(ctx, 'actions.view_all') && can(ctx, 'representative.view') && a.employeeId && a.employeeId !== ctx.employee?.id ? { ...a, employeeId: null, title: maskName(ctx, a.title, a.employeeId), description: maskName(ctx, a.description, a.employeeId) } : a));
}

/** Removes a person's name (full, first + first surname, first name) from a text. */
function maskName(ctx: Ctx, text: string, employeeId: ID): string {
  const e = ctx.db.employees.find((x) => x.id === employeeId);
  if (!e) return text;
  const variants = [`${e.firstName} ${e.lastName}`, `${e.firstName} ${e.lastName.split(' ')[0]}`, e.firstName];
  return variants.reduce((s, v) => s.split(v).join('•••'), text);
}
