/**
 * Absence management (TIM-05). Future endpoints: /companies/{c}/absences, /absences/{id}/decision,
 * /absences/{id}/cancellation.
 *
 * Absences are separate from attendance: approving leave NEVER creates clock-in/out events or
 * sessions (BRD §09 step 5). Balances are shown only where an adviser-approved allowance exists.
 * Sensitive categories (sick leave) store no diagnosis or medical document.
 */
import { newId } from '../domain/ids';
import { BusinessRuleError, PermissionError } from '../domain/permissions';
import { effectiveValues } from '../domain/records';
import { canTransition, ABSENCE_TRANSITIONS } from '../domain/status';
import { eachDay, isValidISODate, localToInstant, nowInstant, periodOf, weekday } from '../domain/time';
import type { AbsenceRequest, AbsenceType, Attachment, ID, ISODate } from '../domain/types';
import { transact, type Tx } from '../store/db';
import { can, canReview, canSeeAbsenceDetail, employeeName, getCtx, latency, ownCompany, visibleAbsenceEmployeeIds, type Ctx } from './context';

const ACTIVE: AbsenceRequest['status'][] = ['draft', 'pending', 'approved', 'cancel_requested'];

/** Detail shown when a reviewer approves without confirming a warning. */
const CONFLICT_CONFIRM: Record<string, string> = {
  planned_shifts: 'Confirme que ha revisado los turnos planificados en esas fechas.',
  recorded_work: 'Confirme que ha revisado el trabajo registrado en esas fechas.',
};

export interface AbsenceInput {
  employeeId: ID;
  typeId: ID;
  startDate: ISODate;
  endDate: ISODate;
  partial: { startTime: string; endTime: string } | null;
  note: string;
}

export interface Conflict {
  code: string;
  message: { text: string; params?: Record<string, string | number> };
  severity: 'warning' | 'info';
}

export function absenceTypesFor(ctx: Ctx, includeInactive = false): AbsenceType[] {
  return ctx.db.absenceTypes.filter((t) => t.companyId === ctx.company.id && (includeInactive || t.active));
}

function holidayDates(ctx: Ctx, employeeId: ID): Set<ISODate> {
  const emp = ctx.db.employees.find((e) => e.id === employeeId)!;
  const ws = ctx.db.worksites.find((w) => w.id === emp.primaryWorksiteId);
  const cal = ctx.db.calendars.find((c) => c.id === ws?.calendarId);
  return new Set(cal?.holidays.map((h) => h.date) ?? []);
}

/** Days counted against an allowance: natural days, or working days (Mon–Fri, excluding public holidays). */
export function countDays(ctx: Ctx, employeeId: ID, from: ISODate, to: ISODate, unit: 'natural' | 'working'): number {
  const days = eachDay(from, to);
  if (unit === 'natural') return days.length;
  const hol = holidayDates(ctx, employeeId);
  return days.filter((d) => weekday(d) < 5 && !hol.has(d)).length;
}

export function validateAbsence(ctx: Ctx, input: AbsenceInput, ignoreId: ID | null, forSubmit: boolean): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const type = ctx.db.absenceTypes.find((t) => t.id === input.typeId && t.companyId === ctx.company.id && t.active);
  if (!type) errors.push('Seleccione un tipo de ausencia válido.');
  if (!isValidISODate(input.startDate)) errors.push('Indique una fecha de inicio válida.');
  if (!isValidISODate(input.endDate)) errors.push('Indique una fecha de fin válida.');
  if (isValidISODate(input.startDate) && isValidISODate(input.endDate) && input.endDate < input.startDate) errors.push('La fecha de fin no puede ser anterior a la de inicio.');
  if (input.partial) {
    if (!type?.allowsPartialDay) errors.push('Este tipo de ausencia no admite periodos por horas.');
    if (input.startDate !== input.endDate) errors.push('Una ausencia por horas debe empezar y terminar el mismo día.');
    if (!/^\d{2}:\d{2}$/.test(input.partial.startTime) || !/^\d{2}:\d{2}$/.test(input.partial.endTime) || input.partial.endTime <= input.partial.startTime) errors.push('Indique un horario válido (la hora de fin debe ser posterior a la de inicio).');
  }
  if (type && !type.sensitive && type.code === 'OTRA' && input.note.trim().length < 5) errors.push('Describa brevemente la ausencia.');
  if (type?.sensitive && input.note.trim()) warnings.push('No incluya diagnósticos ni datos de salud en la nota: no son necesarios para la gestión de la ausencia.');
  if (type?.code === 'VAC' && input.startDate < ctx.today) errors.push('No se pueden solicitar vacaciones en fechas pasadas.');
  if (isValidISODate(input.startDate) && isValidISODate(input.endDate) && input.endDate >= input.startDate) {
    const dup = ctx.db.absences.find((a) => a.employeeId === input.employeeId && a.id !== ignoreId && ACTIVE.includes(a.status) && a.startDate <= input.endDate && input.startDate <= a.endDate);
    if (dup) errors.push(`Ya existe una solicitud que se solapa con estas fechas (${dup.startDate} → ${dup.endDate}).`);
    const closed = ctx.db.periods.find((p) => p.companyId === ctx.company.id && p.status === 'closed' && (p.period === periodOf(input.startDate) || p.period === periodOf(input.endDate)));
    if (closed) warnings.push(`El periodo ${closed.period} está cerrado: la ausencia constará como cambio posterior al cierre.`);
  }
  if (forSubmit && type?.evidence === 'required') {
    const hasAttachment = ignoreId ? ctx.db.attachments.some((x) => x.ownerId === ignoreId) : false;
    if (!hasAttachment) errors.push('Este tipo de ausencia requiere adjuntar un justificante antes de enviarla.');
  }
  return { errors, warnings };
}

/** Planned shifts, recorded work, other absences and team coverage inside the requested range. */
export function conflictsFor(ctx: Ctx, a: Pick<AbsenceRequest, 'id' | 'employeeId' | 'startDate' | 'endDate' | 'partial'>): Conflict[] {
  const out: Conflict[] = [];
  if (!isValidISODate(a.startDate) || !isValidISODate(a.endDate) || a.endDate < a.startDate) return out;
  const shifts = ctx.db.shifts.filter((s) => {
    if (s.employeeId !== a.employeeId || s.status !== 'planned' || s.date < a.startDate || s.date > a.endDate) return false;
    if (!a.partial) return true;
    const from = localToInstant(s.date, a.partial.startTime, s.timezone);
    const to = localToInstant(s.date, a.partial.endTime, s.timezone);
    if (from.kind !== 'ok' || to.kind !== 'ok') return true;
    return from.instant < s.end && s.start < to.instant;
  });
  if (shifts.length) out.push({ code: 'planned_shifts', severity: 'warning', message: { text: 'Hay {n} turno(s) planificado(s) en estas fechas: revise la planificación (la ausencia no los cancela automáticamente).', params: { n: shifts.length } } });
  const worked = ctx.db.sessions.filter((s) => s.employeeId === a.employeeId && s.date >= a.startDate && s.date <= a.endDate && effectiveValues(ctx.db, s).start);
  if (worked.length && !a.partial) out.push({ code: 'recorded_work', severity: 'warning', message: { text: 'Constan {n} registro(s) de trabajo en estas fechas. La ausencia no los modifica.', params: { n: worked.length } } });
  const emp = ctx.db.employees.find((e) => e.id === a.employeeId);
  if (emp) {
    const colleagues = ctx.db.employees.filter((e) => e.companyId === emp.companyId && e.departmentId === emp.departmentId && e.id !== emp.id && e.status === 'active');
    const away = colleagues.filter((c) => ctx.db.absences.some((x) => x.employeeId === c.id && (x.status === 'approved' || x.status === 'pending') && x.startDate <= a.endDate && a.startDate <= x.endDate));
    if (away.length) out.push({ code: 'team_coverage', severity: 'info', message: { text: '{n} persona(s) del mismo departamento estarán ausentes en parte de estas fechas.', params: { n: away.length } } });
  }
  const hol = emp ? holidayDates(ctx, emp.id) : new Set<string>();
  const holInRange = eachDay(a.startDate, a.endDate).filter((d) => hol.has(d));
  if (holInRange.length) out.push({ code: 'holidays', severity: 'info', message: { text: 'El rango incluye {n} festivo(s) del calendario laboral.', params: { n: holInRange.length } } });
  return out;
}

export interface Balance {
  typeId: ID;
  year: number;
  allowance: number;
  unit: 'natural' | 'working';
  used: number;
  pending: number;
  available: number;
}

/** Balance only when the category has an adviser-approved allowance (TIM-05); otherwise null. */
export function balanceFor(ctx: Ctx, employeeId: ID, typeId: ID, year: number): Balance | null {
  const type = ctx.db.absenceTypes.find((t) => t.id === typeId);
  if (!type?.allowance || !type.allowance.adviserApproved || type.allowance.year !== year) return null;
  const mine = ctx.db.absences.filter((a) => a.employeeId === employeeId && a.typeId === typeId && a.startDate.startsWith(String(year)));
  const sum = (list: AbsenceRequest[]) => list.reduce((acc, a) => acc + countDays(ctx, employeeId, a.startDate, a.endDate, type.allowance!.unit), 0);
  const used = sum(mine.filter((a) => a.status === 'approved' || a.status === 'cancel_requested'));
  const pending = sum(mine.filter((a) => a.status === 'pending'));
  return { typeId, year, allowance: type.allowance.days, unit: type.allowance.unit, used, pending, available: type.allowance.days - used - pending };
}

function canCreateFor(ctx: Ctx, employeeId: ID): boolean {
  if (ctx.employee?.id === employeeId) return can(ctx, 'absences.request_own');
  // HR can register an absence for an employee who has no app access (e.g. sick leave reported by phone).
  return can(ctx, 'absences.review_all');
}

/** Creates a draft or submits directly. Sick leave (no approval required) is registered as approved. */
export async function saveAbsence(input: AbsenceInput, submit: boolean, existingId: ID | null = null): Promise<AbsenceRequest> {
  await latency();
  const ctx = getCtx();
  if (!canCreateFor(ctx, input.employeeId)) throw new PermissionError();
  const existing = existingId ? ownCompany(ctx, ctx.db.absences.find((a) => a.id === existingId)) : null;
  if (existing && existing.status !== 'draft') throw new BusinessRuleError('Solo se pueden editar borradores.');
  const v = validateAbsence(ctx, input, existingId, submit);
  if (v.errors.length) throw new BusinessRuleError('La solicitud no es válida', v.errors);
  const type = ctx.db.absenceTypes.find((t) => t.id === input.typeId)!;
  const at = nowInstant();
  const autoApproved = submit && !type.requiresApproval;
  const status: AbsenceRequest['status'] = !submit ? 'draft' : autoApproved ? 'approved' : 'pending';
  const name = employeeName(ctx.db, input.employeeId);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const history = [...(existing?.history ?? [])];
    if (submit) history.push({ at, by: ctx.user.id, action: autoApproved ? 'registered' : 'submitted', note: ctx.employee?.id === input.employeeId ? null : 'Registrada por RR. HH. en nombre del empleado.' });
    const row: AbsenceRequest = {
      ...(existing ?? { id: newId('abs'), companyId: ctx.company.id, attachmentIds: [], createdBy: ctx.user.id, createdAt: at, reviewerId: null, decidedAt: null, decisionReason: null, acknowledgedConflicts: [] }),
      employeeId: input.employeeId,
      typeId: input.typeId,
      startDate: input.startDate,
      endDate: input.endDate,
      partial: input.partial,
      note: input.note.trim(),
      status,
      submittedAt: submit ? at : null,
      updatedAt: at,
      decidedAt: autoApproved ? at : existing?.decidedAt ?? null,
      decisionReason: autoApproved ? 'Registrada: este tipo de ausencia no requiere aprobación.' : existing?.decisionReason ?? null,
      history,
    } as AbsenceRequest;
    if (existing) tx.update('absences', row.id, row);
    else tx.insert('absences', row);
    tx.audit({ action: submit ? 'absence.submit' : 'absence.create', entityType: 'absence', entityId: row.id, entityLabel: name, employeeId: row.employeeId, summary: `${submit ? (autoApproved ? 'Registrada' : 'Solicitud enviada') : 'Borrador guardado'} · ${row.startDate} → ${row.endDate}.` });
    if (submit && !autoApproved) notifyReviewers(tx, row, name);
    if (autoApproved) notifyHr(tx, row, name);
    return row;
  });
}

function notifyReviewers(tx: Tx, a: AbsenceRequest, name: string) {
  const emp = tx.db.employees.find((e) => e.id === a.employeeId)!;
  const ids = new Set<ID>();
  const mgr = emp.managerEmployeeId ? tx.db.employees.find((e) => e.id === emp.managerEmployeeId) : undefined;
  if (mgr?.userId) ids.add(mgr.userId);
  tx.db.memberships.filter((m) => m.companyId === a.companyId && m.status === 'active' && m.roles.includes('hr_admin')).forEach((m) => ids.add(m.userId));
  if (emp.userId) ids.delete(emp.userId);
  tx.notify({ type: 'absence_pending', title: 'Ausencia pendiente de revisión', body: `${name} ha enviado una solicitud.`, recipientUserIds: [...ids], link: `/ausencias/${a.id}`, dedupeKey: `abs:${a.id}:${a.updatedAt}` });
}

function notifyHr(tx: Tx, a: AbsenceRequest, name: string) {
  const ids = tx.db.memberships.filter((m) => m.companyId === a.companyId && m.status === 'active' && m.roles.includes('hr_admin')).map((m) => m.userId);
  tx.notify({ type: 'absence_registered', title: 'Ausencia registrada', body: `${name}: ausencia registrada que no requiere aprobación.`, recipientUserIds: ids, link: `/ausencias/${a.id}`, dedupeKey: `abs-reg:${a.id}` });
}

function notifyEmployee(tx: Tx, a: AbsenceRequest, title: string) {
  const emp = tx.db.employees.find((e) => e.id === a.employeeId);
  if (emp?.userId) tx.notify({ type: 'absence_decided', title, body: 'Consulte el detalle de la decisión.', recipientUserIds: [emp.userId], link: `/ausencias/${a.id}`, dedupeKey: `absd:${a.id}:${a.status}:${a.updatedAt}` });
}

/** Approve or reject. Approval with warnings requires the reviewer to acknowledge each one. Never creates attendance. */
export async function reviewAbsence(id: ID, decision: 'approve' | 'reject', reason: string, acknowledged: string[] = []): Promise<AbsenceRequest> {
  await latency();
  const ctx = getCtx();
  const a = ownCompany(ctx, ctx.db.absences.find((x) => x.id === id));
  if (!canReview(ctx, a.employeeId, 'absences')) {
    if (ctx.employee?.id === a.employeeId) throw new PermissionError('No puede aprobar ni rechazar sus propias ausencias.');
    throw new PermissionError();
  }
  const to = decision === 'approve' ? 'approved' : 'rejected';
  if (!canTransition(ABSENCE_TRANSITIONS, a.status, to) || a.status !== 'pending') throw new BusinessRuleError('Esta solicitud ya fue resuelta o no está pendiente.');
  if (decision === 'reject' && reason.trim().length < 5) throw new BusinessRuleError('El motivo del rechazo es obligatorio.');
  const warnings = conflictsFor(ctx, a).filter((c) => c.severity === 'warning').map((c) => c.code);
  if (decision === 'approve' && warnings.some((w) => !acknowledged.includes(w))) throw new BusinessRuleError('Revise y confirme los conflictos antes de aprobar.', warnings.map((w) => CONFLICT_CONFIRM[w] ?? 'Hay un conflicto pendiente de confirmar.'));
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const updated = tx.update('absences', id, (x): Partial<AbsenceRequest> => ({ status: to, reviewerId: ctx.user.id, decidedAt: at, decisionReason: reason.trim() || null, acknowledgedConflicts: decision === 'approve' ? warnings : [], updatedAt: at, history: [...x.history, { at, by: ctx.user.id, action: to, note: reason.trim() || null }] }));
    tx.audit({ action: decision === 'approve' ? 'absence.approve' : 'absence.reject', entityType: 'absence', entityId: id, entityLabel: employeeName(ctx.db, a.employeeId), employeeId: a.employeeId, summary: `${decision === 'approve' ? 'Aprobada' : 'Rechazada'} · ${a.startDate} → ${a.endDate}.`, reason: reason.trim() || null, changes: [{ field: 'Estado', before: a.status, after: to }] });
    notifyEmployee(tx, updated, decision === 'approve' ? 'Su solicitud de ausencia se ha aprobado' : 'Su solicitud de ausencia se ha rechazado');
    return updated;
  });
}

/** The employee withdraws a draft or a pending request. */
export async function withdrawAbsence(id: ID, note: string): Promise<AbsenceRequest> {
  await latency();
  const ctx = getCtx();
  const a = ownCompany(ctx, ctx.db.absences.find((x) => x.id === id));
  if (ctx.employee?.id !== a.employeeId && a.createdBy !== ctx.user.id) throw new PermissionError();
  if (!canTransition(ABSENCE_TRANSITIONS, a.status, 'withdrawn')) throw new BusinessRuleError('Solo se pueden retirar solicitudes en borrador o pendientes.');
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('absences', id, (x): Partial<AbsenceRequest> => ({ status: 'withdrawn', updatedAt: at, history: [...x.history, { at, by: ctx.user.id, action: 'withdrawn', note: note.trim() || null }] }));
    tx.audit({ action: 'absence.withdraw', entityType: 'absence', entityId: id, entityLabel: employeeName(ctx.db, a.employeeId), employeeId: a.employeeId, summary: `Retirada · ${a.startDate} → ${a.endDate}.`, reason: note.trim() || null });
    return u;
  });
}

/** Approved leave is never deleted: the employee requests cancellation, a reviewer decides. */
export async function requestCancellation(id: ID, reason: string): Promise<AbsenceRequest> {
  await latency();
  const ctx = getCtx();
  const a = ownCompany(ctx, ctx.db.absences.find((x) => x.id === id));
  if (ctx.employee?.id !== a.employeeId) throw new PermissionError();
  if (a.status !== 'approved') throw new BusinessRuleError('Solo se puede pedir la cancelación de una ausencia aprobada.');
  if (a.startDate <= ctx.today) throw new BusinessRuleError('La ausencia ya ha empezado: contacte con RR. HH. para modificarla.');
  if (reason.trim().length < 5) throw new BusinessRuleError('Indique el motivo de la cancelación.');
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('absences', id, (x): Partial<AbsenceRequest> => ({ status: 'cancel_requested', updatedAt: at, history: [...x.history, { at, by: ctx.user.id, action: 'cancel_requested', note: reason.trim() }] }));
    tx.audit({ action: 'absence.cancel_request', entityType: 'absence', entityId: id, entityLabel: employeeName(ctx.db, a.employeeId), employeeId: a.employeeId, summary: `Cancelación solicitada · ${a.startDate} → ${a.endDate}.`, reason: reason.trim() });
    notifyReviewers(tx, u, employeeName(ctx.db, a.employeeId));
    return u;
  });
}

/** Reviewer decides on a cancellation request, or HR cancels an approved absence directly (with reason). */
export async function decideCancellation(id: ID, accept: boolean, reason: string): Promise<AbsenceRequest> {
  await latency();
  const ctx = getCtx();
  const a = ownCompany(ctx, ctx.db.absences.find((x) => x.id === id));
  if (!canReview(ctx, a.employeeId, 'absences')) throw new PermissionError();
  const direct = a.status === 'approved';
  if (a.status !== 'cancel_requested' && !(direct && accept)) throw new BusinessRuleError('No hay ninguna cancelación pendiente para esta ausencia.');
  if (reason.trim().length < 5) throw new BusinessRuleError('Indique el motivo de la decisión.');
  const to = accept ? 'cancelled' : 'approved';
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('absences', id, (x): Partial<AbsenceRequest> => ({ status: to, updatedAt: at, history: [...x.history, { at, by: ctx.user.id, action: accept ? 'cancelled' : 'cancel_denied', note: reason.trim() }] }));
    tx.audit({ action: accept ? 'absence.cancel' : 'absence.cancel_denied', entityType: 'absence', entityId: id, entityLabel: employeeName(ctx.db, a.employeeId), employeeId: a.employeeId, summary: accept ? `Cancelada · ${a.startDate} → ${a.endDate}. El historial se conserva.` : 'Cancelación denegada: la ausencia sigue aprobada.', reason: reason.trim() });
    notifyEmployee(tx, u, accept ? 'Su ausencia se ha cancelado' : 'Su solicitud de cancelación se ha denegado');
    return u;
  });
}

const MAX_INLINE = 350 * 1024;

/** Restricted-access evidence (demo: kept in this browser only). Not allowed for sensitive categories. */
export async function addAbsenceAttachment(absenceId: ID, file: { name: string; type: string; size: number; dataUrl: string | null }): Promise<Attachment> {
  await latency();
  const ctx = getCtx();
  const a = ownCompany(ctx, ctx.db.absences.find((x) => x.id === absenceId));
  if (ctx.employee?.id !== a.employeeId && !can(ctx, 'absences.review_all')) throw new PermissionError();
  const type = ctx.db.absenceTypes.find((t) => t.id === a.typeId)!;
  if (type.evidence === 'none') throw new BusinessRuleError('Este tipo de ausencia no admite justificantes (minimización de datos).');
  if (!['draft', 'pending'].includes(a.status)) throw new BusinessRuleError('Solo se pueden adjuntar justificantes a solicitudes en borrador o pendientes.');
  if (!/^(application\/pdf|image\/(png|jpeg))$/.test(file.type)) throw new BusinessRuleError('Formato no admitido: use PDF, PNG o JPG.');
  if (file.size > 5 * 1024 * 1024) throw new BusinessRuleError('El archivo supera 5 MB.');
  const att: Attachment = { id: newId('att'), companyId: ctx.company.id, ownerType: 'absence', ownerId: a.id, fileName: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl: file.size <= MAX_INLINE ? file.dataUrl : null, accessClass: 'restricted', uploadedBy: ctx.user.id, uploadedAt: nowInstant() };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('attachments', att);
    tx.update('absences', a.id, (x) => ({ attachmentIds: [...x.attachmentIds, att.id], updatedAt: att.uploadedAt }));
    tx.audit({ action: 'absence.attachment', entityType: 'absence', entityId: a.id, entityLabel: employeeName(ctx.db, a.employeeId), employeeId: a.employeeId, summary: `Justificante adjuntado (${file.name}). Acceso restringido; adjuntar no implica aprobación.` });
    return att;
  });
}

/** Absences visible to the caller. Sensitive categories are masked for those without the right. */
export function visibleAbsences(ctx: Ctx): AbsenceRequest[] {
  const ids = visibleAbsenceEmployeeIds(ctx);
  return ctx.db.absences.filter((a) => a.companyId === ctx.company.id && ids.has(a.employeeId) && (a.status !== 'draft' || a.createdBy === ctx.user.id || a.employeeId === ctx.employee?.id));
}

/** Display label for the category respecting sensitivity (supervisors see a generic label). */
export function absenceTypeLabel(ctx: Ctx, a: AbsenceRequest): string {
  const type = ctx.db.absenceTypes.find((t) => t.id === a.typeId);
  if (!type) return '—';
  return canSeeAbsenceDetail(ctx, a, type) ? type.name : 'Ausencia justificada (categoría reservada)';
}

export function absencesAwaitingMe(ctx: Ctx): AbsenceRequest[] {
  return ctx.db.absences.filter((a) => a.companyId === ctx.company.id && (a.status === 'pending' || a.status === 'cancel_requested') && canReview(ctx, a.employeeId, 'absences'));
}
