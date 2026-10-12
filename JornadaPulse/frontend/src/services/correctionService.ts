/**
 * Transparent corrections (TIM-04, AC-TIM-01). Future endpoints:
 *   POST /sessions/{id}/corrections · POST /corrections/{id}/decision · POST /corrections/{id}/employee-response
 *
 * Original events are never edited. An approved correction adds a reviewed layer (approved
 * values) that becomes the effective record; original, requested and approved values, reviewer,
 * time and reason are kept. Company-initiated corrections need the employee's agreement or a
 * recorded disagreement (design prepared for draft RD art. 4.b).
 */
import { detectAnomalies } from '../domain/anomalies';
import { newId, receiptFor } from '../domain/ids';
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { effectiveValues } from '../domain/records';
import { localDate, minutesBetween, nowInstant, periodOf } from '../domain/time';
import type { AnomalyReview, CorrectionKind, CorrectionRequest, ID, ISODate, SessionValues, WorkSession } from '../domain/types';
import { transact, type Tx } from '../store/db';
import { can, canReview, employeeName, getCtx, latency, ownCompany, requireEmployeeVisible, requirePerm, type Ctx } from './context';

const ACTIVE: CorrectionRequest['status'][] = ['pending', 'pending_employee'];

export interface CorrectionInput {
  employeeId: ID;
  sessionId: ID | null;
  failedAttemptId?: ID | null;
  /** Working day (required when adding a session that was never recorded). */
  date: ISODate;
  kind: CorrectionKind;
  requested: SessionValues;
  explanation: string;
}

export interface ValuesCheck {
  errors: string[];
  warnings: string[];
}

/** Validates proposed session values (requests, proposals and reviewer adjustments). */
export function checkValues(ctx: Ctx, employeeId: ID, values: SessionValues, ignoreSessionId: ID | null): ValuesCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const emp = ctx.db.employees.find((e) => e.id === employeeId && e.companyId === ctx.company.id);
  if (!emp) throw new NotFoundError();
  const nowIso = nowInstant();
  if (!values.start) errors.push('Indique la hora de entrada.');
  if (!values.end) errors.push('Indique la hora de salida.');
  if (values.start && values.end) {
    const gross = minutesBetween(values.start, values.end);
    if (gross <= 0) errors.push('La salida debe ser posterior a la entrada.');
    else if (gross > 24 * 60) errors.push('Una sesión no puede durar más de 24 horas; registre jornadas separadas.');
    if (values.end > nowIso) errors.push('No se pueden registrar horas futuras.');
    values.breaks.forEach((b, i) => {
      if (!b.end) errors.push(`La pausa ${i + 1} no tiene hora de fin.`);
      else if (b.end <= b.start) errors.push(`La pausa ${i + 1} termina antes de empezar.`);
      if (b.start < values.start! || (b.end && b.end > values.end!)) errors.push(`La pausa ${i + 1} queda fuera de la jornada.`);
    });
    const sorted = [...values.breaks].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].end && sorted[i].start < sorted[i - 1].end!) errors.push('Hay pausas que se solapan entre sí.');
    // Overlap with other sessions of the same employee: reviewer must see it.
    for (const s of ctx.db.sessions.filter((x) => x.employeeId === employeeId && x.id !== ignoreSessionId)) {
      const v = effectiveValues(ctx.db, s);
      if (!v.start) continue;
      const otherEnd = v.end ?? nowIso;
      if (values.start < otherEnd && v.start < values.end) {
        warnings.push(`Se solapa con otra sesión registrada del ${s.date}.`);
        break;
      }
    }
    if (gross > 12 * 60) warnings.push('La sesión propuesta supera las 12 horas.');
  }
  if (values.worksiteId && !emp.worksiteIds.includes(values.worksiteId)) errors.push('El centro indicado no está asignado al empleado.');
  if (values.start) {
    const p = periodOf(localDate(values.start, ctx.company.timezone));
    const period = ctx.db.periods.find((x) => x.companyId === ctx.company.id && x.period === p);
    if (period?.status === 'closed') errors.push(`El periodo ${p} está cerrado. RR. HH. debe reabrirlo (queda registrado) antes de corregirlo.`);
  }
  return { errors, warnings };
}

function sameValues(a: SessionValues | null, b: SessionValues): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

function validateRequest(ctx: Ctx, input: CorrectionInput): { session: WorkSession | null; original: SessionValues | null; check: ValuesCheck } {
  const errors: string[] = [];
  if (input.explanation.trim().length < 10) errors.push('La explicación es obligatoria (al menos 10 caracteres).');
  let session: WorkSession | null = null;
  let original: SessionValues | null = null;
  if (input.sessionId) {
    session = ownCompany(ctx, ctx.db.sessions.find((s) => s.id === input.sessionId));
    if (session.employeeId !== input.employeeId) throw new NotFoundError();
    original = effectiveValues(ctx.db, session);
    if (ctx.db.corrections.some((c) => c.sessionId === session!.id && ACTIVE.includes(c.status))) errors.push('Ya hay una corrección en curso para este registro. Espere a su resolución o retírela.');
    if (sameValues(original, input.requested)) errors.push('Los valores solicitados son iguales a los actuales.');
  } else if (input.kind !== 'missing_session' && input.kind !== 'connectivity') {
    errors.push('Seleccione el registro que desea corregir.');
  }
  if (input.failedAttemptId) {
    const f = ownCompany(ctx, ctx.db.failedAttempts.find((x) => x.id === input.failedAttemptId));
    if (f.employeeId !== input.employeeId) throw new NotFoundError();
    if (f.correctionId) errors.push('Este fichaje no registrado ya tiene una solicitud de corrección.');
  }
  const check = checkValues(ctx, input.employeeId, input.requested, session?.id ?? null);
  return { session, original, check: { errors: [...errors, ...check.errors], warnings: check.warnings } };
}

/** Employee asks to correct their own record (or to add a session that was not recorded). */
export async function requestCorrection(input: CorrectionInput): Promise<CorrectionRequest> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'corrections.request_own');
  if (ctx.employee?.id !== input.employeeId) throw new PermissionError('Solo puede solicitar correcciones de sus propios registros.');
  return create(ctx, input, 'employee', false);
}

/**
 * Company-initiated correction (HR). `onBehalf` registers an employee's request for someone without
 * app access (status pending); otherwise it is a company proposal awaiting the employee's agreement.
 */
export async function proposeCorrection(input: CorrectionInput, onBehalf: boolean): Promise<CorrectionRequest> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'corrections.propose');
  requireEmployeeVisible(ctx, input.employeeId);
  if (ctx.employee?.id === input.employeeId) throw new BusinessRuleError('Para sus propios registros use «Solicitar corrección»: no puede proponerse correcciones a sí mismo.');
  return create(ctx, input, onBehalf ? 'employee' : 'company', onBehalf);
}

function create(ctx: Ctx, input: CorrectionInput, initiatedBy: 'employee' | 'company', onBehalf: boolean): CorrectionRequest {
  const { session, original, check } = validateRequest(ctx, input);
  if (check.errors.length) throw new BusinessRuleError('La solicitud no es válida', check.errors);
  const at = nowInstant();
  const c: CorrectionRequest = {
    id: newId('cor'),
    companyId: ctx.company.id,
    employeeId: input.employeeId,
    sessionId: session?.id ?? null,
    failedAttemptId: input.failedAttemptId ?? null,
    date: session?.date ?? input.date,
    kind: input.kind,
    initiatedBy,
    original,
    requested: input.requested,
    approved: null,
    explanation: input.explanation.trim(),
    status: initiatedBy === 'company' ? 'pending_employee' : 'pending',
    requestedBy: ctx.user.id,
    requestedAt: at,
    reviewerId: null,
    decidedAt: null,
    decisionReason: null,
    employeeResponse: null,
    history: [{ at, by: ctx.user.id, action: initiatedBy === 'company' ? 'proposed' : 'requested', note: onBehalf ? 'Registrada por RR. HH. a petición del empleado.' : null }],
  };
  const name = employeeName(ctx.db, input.employeeId);
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('corrections', c);
    if (c.failedAttemptId) tx.update('failedAttempts', c.failedAttemptId, { correctionId: c.id });
    tx.audit({ action: initiatedBy === 'company' ? 'correction.propose' : 'correction.request', entityType: 'correction', entityId: c.id, entityLabel: name, employeeId: c.employeeId, summary: `Corrección del ${c.date}: ${initiatedBy === 'company' ? 'propuesta por la empresa' : 'solicitada'}.`, reason: c.explanation, changes: diffChanges(original, input.requested) });
    if (initiatedBy === 'company') {
      const emp = tx.db.employees.find((e) => e.id === c.employeeId);
      if (emp?.userId) tx.notify({ type: 'correction_proposed', title: 'La empresa propone corregir su registro', body: 'Revise la propuesta y dé su conformidad o deje constancia de su discrepancia.', recipientUserIds: [emp.userId], link: `/correcciones/${c.id}`, dedupeKey: `corr-prop:${c.id}` });
    } else {
      tx.notify({ type: 'correction_pending', title: 'Corrección pendiente de revisión', body: `${name} ha solicitado una corrección.`, recipientUserIds: reviewerUserIds(tx, c.employeeId), link: `/correcciones/${c.id}`, dedupeKey: `corr:${c.id}` });
    }
  });
  return c;
}

/** Users who can review requests about an employee: the direct manager and HR. */
function reviewerUserIds(tx: Tx, employeeId: ID): ID[] {
  const emp = tx.db.employees.find((e) => e.id === employeeId)!;
  const ids = new Set<ID>();
  const mgr = emp.managerEmployeeId ? tx.db.employees.find((e) => e.id === emp.managerEmployeeId) : undefined;
  if (mgr?.userId) ids.add(mgr.userId);
  tx.db.memberships.filter((m) => m.companyId === emp.companyId && m.status === 'active' && m.roles.includes('hr_admin')).forEach((m) => ids.add(m.userId));
  if (emp.userId) ids.delete(emp.userId);
  return [...ids];
}

function fmt(v: string | null | undefined): string {
  return v ? new Date(v).toISOString() : '—';
}

function diffChanges(before: SessionValues | null, after: SessionValues): { field: string; before: string; after: string }[] {
  const out: { field: string; before: string; after: string }[] = [];
  if (!before || before.start !== after.start) out.push({ field: 'Entrada', before: fmt(before?.start), after: fmt(after.start) });
  if (!before || before.end !== after.end) out.push({ field: 'Salida', before: fmt(before?.end), after: fmt(after.end) });
  if (!before || JSON.stringify(before.breaks) !== JSON.stringify(after.breaks)) out.push({ field: 'Pausas', before: String(before?.breaks.length ?? 0), after: String(after.breaks.length) });
  if (!before || before.worksiteId !== after.worksiteId) out.push({ field: 'Centro', before: before?.worksiteId ?? '—', after: after.worksiteId ?? '—' });
  return out;
}

/** Writes the approved values: a new reviewed layer, or a new session for a never-recorded day. */
function apply(tx: Tx, ctx: Ctx, c: CorrectionRequest, approved: SessionValues) {
  const at = nowInstant();
  // Keep the history of anomalies that this correction resolves.
  const before = detectAnomalies(tx.db, ctx.company.id, at).filter((a) => (c.sessionId && a.ref.kind === 'session' && a.ref.id === c.sessionId) || (c.failedAttemptId && a.ref.id === c.failedAttemptId) || (a.ref.kind === 'correction' && a.ref.id === c.id));
  if (c.sessionId) {
    tx.update('sessions', c.sessionId, (s) => ({ correctionIds: [...s.correctionIds, c.id], updatedAt: at }));
  } else {
    // Missing session: create it from the approved values; events are marked as coming from the correction.
    const sessionId = newId('ses');
    const mk = (type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end', when: string, kind: 'rest' | 'meal' | 'other' | null) => {
      const id = newId('evt');
      tx.insert('events', { id, companyId: c.companyId, employeeId: c.employeeId, sessionId, type, at: when, receivedAt: at, timezone: ctx.company.timezone, source: 'correction', worksiteId: approved.worksiteId!, mode: approved.mode, breakKind: kind, idempotencyKey: `correction:${c.id}:${type}:${when}`, receipt: receiptFor(id), recordedBy: ctx.user.id, correctionId: c.id });
      return id;
    };
    const startId = mk('clock_in', approved.start!, null);
    const breaks = approved.breaks.map((b) => ({ id: newId('brk'), startEventId: mk('break_start', b.start, b.kind), endEventId: b.end ? mk('break_end', b.end, b.kind) : null, kind: b.kind }));
    const endId = mk('clock_out', approved.end!, null);
    tx.insert('sessions', { id: sessionId, companyId: c.companyId, employeeId: c.employeeId, worksiteId: approved.worksiteId!, timezone: ctx.company.timezone, mode: approved.mode, date: localDate(approved.start!, ctx.company.timezone), startEventId: startId, endEventId: endId, breaks, correctionIds: [], origin: 'correction', createdAt: at, updatedAt: at });
    tx.update('corrections', c.id, { sessionId });
  }
  for (const a of before) {
    const existing = tx.db.anomalyReviews.find((r) => r.companyId === ctx.company.id && r.key === a.key);
    const entry = { at, by: ctx.user.id, action: 'resolved', note: 'Resuelta por la corrección aprobada; el registro original se conserva.' };
    if (existing) tx.update('anomalyReviews', existing.id, (r): Partial<AnomalyReview> => ({ status: 'resolved', resolution: entry.note, history: [...r.history, entry], snapshot: r.snapshot ?? a, updatedAt: at }));
    else tx.insert('anomalyReviews', { id: newId('anr'), companyId: ctx.company.id, key: a.key, snapshot: a, assigneeId: ctx.user.id, status: 'resolved', history: [entry], resolution: entry.note, updatedAt: at } satisfies AnomalyReview);
  }
}

function notifyOutcome(tx: Tx, c: CorrectionRequest, approved: boolean) {
  const emp = tx.db.employees.find((e) => e.id === c.employeeId);
  if (!emp?.userId) return;
  tx.notify({ type: 'correction_decided', title: approved ? 'Su corrección se ha aprobado' : 'Su corrección se ha rechazado', body: 'Consulte el detalle y el motivo de la decisión.', recipientUserIds: [emp.userId], link: `/correcciones/${c.id}`, dedupeKey: `corr-dec:${c.id}` });
}

/** Reviewer decision. Approved values default to the requested ones and are re-validated. */
export async function reviewCorrection(id: ID, decision: 'approve' | 'reject', reason: string, approvedValues?: SessionValues): Promise<CorrectionRequest> {
  await latency();
  const ctx = getCtx();
  const c = ownCompany(ctx, ctx.db.corrections.find((x) => x.id === id));
  if (!canReview(ctx, c.employeeId, 'corrections')) {
    if (ctx.employee?.id === c.employeeId) throw new PermissionError('No puede aprobar ni rechazar sus propias correcciones.');
    throw new PermissionError();
  }
  if (c.status !== 'pending') throw new BusinessRuleError('Esta corrección ya fue resuelta o no está pendiente de revisión.');
  if (c.requestedBy === ctx.user.id) throw new PermissionError('Quien registró la solicitud no puede decidirla: debe revisarla otra persona autorizada.');
  if (decision === 'reject' && reason.trim().length < 5) throw new BusinessRuleError('Indique el motivo del rechazo.');
  const approved = approvedValues ?? c.requested;
  if (decision === 'approve') {
    const chk = checkValues(ctx, c.employeeId, approved, c.sessionId);
    if (chk.errors.length) throw new BusinessRuleError('Los valores aprobados no son válidos', chk.errors);
  }
  const at = nowInstant();
  const name = employeeName(ctx.db, c.employeeId);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const updated = tx.update('corrections', id, (x): Partial<CorrectionRequest> => ({
      status: decision === 'approve' ? 'approved' : 'rejected',
      approved: decision === 'approve' ? approved : null,
      reviewerId: ctx.user.id,
      decidedAt: at,
      decisionReason: reason.trim() || null,
      history: [...x.history, { at, by: ctx.user.id, action: decision === 'approve' ? 'approved' : 'rejected', note: reason.trim() || null }],
    }));
    if (decision === 'approve') apply(tx, ctx, updated, approved);
    tx.audit({ action: decision === 'approve' ? 'correction.approve' : 'correction.reject', entityType: 'correction', entityId: id, entityLabel: name, employeeId: c.employeeId, summary: decision === 'approve' ? `Corrección del ${c.date}: aplicada; el registro original se conserva.` : `Corrección del ${c.date}: rechazada.`, reason: reason.trim() || null, changes: decision === 'approve' ? diffChanges(c.original, approved) : [] });
    notifyOutcome(tx, updated, decision === 'approve');
    return tx.get('corrections', id)!;
  });
}

/** Employee response to a company proposal: agreement applies it; disagreement is recorded for HR. */
export async function respondToProposal(id: ID, agreed: boolean, comment: string): Promise<CorrectionRequest> {
  await latency();
  const ctx = getCtx();
  const c = ownCompany(ctx, ctx.db.corrections.find((x) => x.id === id));
  const emp = ctx.db.employees.find((e) => e.id === c.employeeId);
  // An employee without app access answers through HR, who records the answer on their behalf.
  const onBehalf = ctx.employee?.id !== c.employeeId;
  if (onBehalf && !(can(ctx, 'corrections.propose') && !emp?.userId)) throw new PermissionError('Solo el empleado afectado puede responder a la propuesta.');
  if (c.status !== 'pending_employee' || c.employeeResponse) throw new BusinessRuleError('Esta propuesta ya tiene respuesta.');
  if (!agreed && comment.trim().length < 5) throw new BusinessRuleError('Explique brevemente su discrepancia.');
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const updated = tx.update('corrections', id, (x): Partial<CorrectionRequest> => ({
      status: agreed ? 'approved' : 'pending_employee',
      approved: agreed ? x.requested : null,
      reviewerId: agreed ? x.requestedBy : null,
      decidedAt: agreed ? at : null,
      decisionReason: agreed ? 'Conformidad del empleado.' : null,
      employeeResponse: { at, agreed, comment: comment.trim() },
      history: [...x.history, { at, by: ctx.user.id, action: agreed ? 'employee_agreed' : 'employee_disagreed', note: onBehalf ? `Respuesta del empleado recogida por RR. HH. (sin acceso a la aplicación). ${comment.trim()}`.trim() : comment.trim() || null }],
    }));
    if (agreed) apply(tx, ctx, updated, updated.requested);
    tx.audit({ action: 'correction.employee_response', entityType: 'correction', entityId: id, entityLabel: employeeName(ctx.db, c.employeeId), employeeId: c.employeeId, summary: agreed ? 'El empleado da su conformidad: corrección aplicada.' : 'El empleado manifiesta su discrepancia.', reason: comment.trim() || null });
    if (!agreed) tx.notify({ type: 'correction_disagreement', title: 'Discrepancia con una corrección propuesta', body: 'El empleado no está de acuerdo. Decida si la retira o la aplica dejando constancia.', recipientUserIds: [c.requestedBy], link: `/correcciones/${id}`, dedupeKey: `corr-dis:${id}` });
    return tx.get('corrections', id)!;
  });
}

/** After a recorded disagreement, HR applies the proposal (disagreement stays on record) — representatives must be informed. */
export async function applyWithDisagreement(id: ID, note: string): Promise<CorrectionRequest> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'corrections.propose');
  const c = ownCompany(ctx, ctx.db.corrections.find((x) => x.id === id));
  if (c.status !== 'pending_employee' || !c.employeeResponse || c.employeeResponse.agreed) throw new BusinessRuleError('Solo se puede aplicar con discrepancia una propuesta que el empleado ha rechazado.');
  if (note.trim().length < 10) throw new BusinessRuleError('Indique el motivo y cómo se ha informado a la representación legal de los trabajadores.');
  const chk = checkValues(ctx, c.employeeId, c.requested, c.sessionId);
  if (chk.errors.length) throw new BusinessRuleError('Los valores no son válidos', chk.errors);
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const updated = tx.update('corrections', id, (x): Partial<CorrectionRequest> => ({ status: 'applied_with_disagreement', approved: x.requested, reviewerId: ctx.user.id, decidedAt: at, decisionReason: note.trim(), history: [...x.history, { at, by: ctx.user.id, action: 'applied_with_disagreement', note: note.trim() }] }));
    apply(tx, ctx, updated, updated.requested);
    tx.audit({ action: 'correction.approve', entityType: 'correction', entityId: id, entityLabel: employeeName(ctx.db, c.employeeId), employeeId: c.employeeId, summary: 'Corrección aplicada con la discrepancia del empleado registrada.', reason: note.trim(), changes: diffChanges(c.original, c.requested) });
    notifyOutcome(tx, updated, true);
    return tx.get('corrections', id)!;
  });
}

/** The requester withdraws a correction that has not been decided. */
export async function withdrawCorrection(id: ID, note: string): Promise<CorrectionRequest> {
  await latency();
  const ctx = getCtx();
  const c = ownCompany(ctx, ctx.db.corrections.find((x) => x.id === id));
  const isRequester = c.requestedBy === ctx.user.id || ctx.employee?.id === c.employeeId && c.initiatedBy === 'employee';
  const isCompanyProposal = c.initiatedBy === 'company' && can(ctx, 'corrections.propose');
  if (!isRequester && !isCompanyProposal) throw new PermissionError();
  if (!['pending', 'pending_employee'].includes(c.status)) throw new BusinessRuleError('Solo se pueden retirar correcciones pendientes.');
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('corrections', id, (x): Partial<CorrectionRequest> => ({ status: 'withdrawn', decidedAt: at, history: [...x.history, { at, by: ctx.user.id, action: 'withdrawn', note: note.trim() || null }] }));
    if (c.failedAttemptId) tx.update('failedAttempts', c.failedAttemptId, { correctionId: null });
    tx.audit({ action: 'correction.withdraw', entityType: 'correction', entityId: id, entityLabel: employeeName(ctx.db, c.employeeId), employeeId: c.employeeId, summary: `Corrección del ${c.date}: retirada.`, reason: note.trim() || null });
    return tx.get('corrections', id)!;
  });
}

/** Corrections visible to the caller (own, team, or all). */
export function visibleCorrections(ctx: Ctx): CorrectionRequest[] {
  return ctx.db.corrections.filter((c) => {
    if (c.companyId !== ctx.company.id) return false;
    if (ctx.employee?.id === c.employeeId) return true;
    return can(ctx, 'corrections.review_all') || can(ctx, 'corrections.propose') || can(ctx, 'time.view_all') || (can(ctx, 'corrections.review_team') && canReview(ctx, c.employeeId, 'corrections'));
  });
}

/** Corrections awaiting an action from the caller. */
export function correctionsAwaitingMe(ctx: Ctx): CorrectionRequest[] {
  return ctx.db.corrections.filter((c) => c.companyId === ctx.company.id && ((c.status === 'pending' && canReview(ctx, c.employeeId, 'corrections')) || (c.status === 'pending_employee' && !c.employeeResponse && ctx.employee?.id === c.employeeId) || (c.status === 'pending_employee' && !!c.employeeResponse && !c.employeeResponse.agreed && can(ctx, 'corrections.propose'))));
}
