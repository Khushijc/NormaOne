/**
 * Training catalogue and assignments, and PPE catalogue and issues.
 *
 * Attendance, completion, acknowledgement and evidence acceptance are separate facts: none of
 * them implies another, and none of them alone satisfies a training requirement (only accepted
 * evidence does). PPE issue, the worker's acknowledgement and any supporting document are also
 * tracked separately; the app never decides that an item is sufficient for a risk.
 */
import { BusinessRuleError, PermissionError } from '../domain/permissions';
import { addMonths, nowInstant } from '../domain/time';
import { newId } from '../domain/ids';
import type { EquipmentIssue, EquipmentItem, ID, ISODate, TrainingAssignment, TrainingCourse } from '../domain/types';
import { transact } from '../store/db';
import { auditReadinessChanges, audience, checkDate, employeeUser } from './common';
import { can, canSeeEmployee, employeeName, getCtx, latency, ownCompany, requireEmployeeVisible, requirePerm, type Ctx } from './context';

// ─────────────────────────────── Training ───────────────────────────────

export type CourseInput = Omit<TrainingCourse, 'id' | 'companyId' | 'code' | 'active'>;

export function validateCourse(input: CourseInput): string[] {
  const e: string[] = [];
  if (!input.title.trim()) e.push('Título: obligatorio.');
  if (!input.providerName.trim()) e.push('Proveedor: obligatorio.');
  if (input.durationHours !== null && (input.durationHours <= 0 || input.durationHours > 400)) e.push('Duración: entre 0 y 400 horas.');
  if (input.refresher.kind === 'interval' && (!input.refresher.months || !input.refresher.setBy?.trim())) e.push('Reciclaje: indique los meses y quién fijó la periodicidad. No se aplica ninguna periodicidad por defecto.');
  return e;
}

export async function saveCourse(input: CourseInput, id?: ID): Promise<TrainingCourse> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'training.manage');
  const errors = validateCourse(input);
  if (errors.length) throw new BusinessRuleError('Revise el curso', errors);
  const existing = id ? ownCompany(ctx, ctx.db.courses.find((c) => c.id === id)) : null;
  const count = ctx.db.courses.filter((c) => c.companyId === ctx.company.id).length;
  const row: TrainingCourse = existing ? { ...existing, ...input } : { id: newId('crs'), companyId: ctx.company.id, code: `CUR-${String(count + 1).padStart(2, '0')}`, active: true, ...input };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (existing) tx.update('courses', row.id, row);
    else tx.insert('courses', row);
    tx.audit({ action: 'course.save', entityType: 'course', entityId: row.id, entityLabel: `${row.code} · ${row.title}`, summary: existing ? 'Curso modificado.' : 'Curso añadido al catálogo.' });
    return row;
  });
}

export async function assignTraining(input: { employeeId: ID; courseId: ID; templateId: ID | null; scheduledDate: ISODate | null; note: string }): Promise<TrainingAssignment> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'training.manage');
  requireEmployeeVisible(ctx, input.employeeId);
  const course = ownCompany(ctx, ctx.db.courses.find((c) => c.id === input.courseId));
  const errors: string[] = [];
  const d = checkDate(errors, input.scheduledDate, 'Fecha prevista');
  if (d && d < ctx.today) errors.push('La fecha prevista no puede estar en el pasado.');
  if (ctx.db.trainings.some((x) => x.employeeId === input.employeeId && x.courseId === course.id && ['assigned', 'scheduled', 'attended'].includes(x.status))) errors.push('Ya hay una formación abierta de este curso para esta persona.');
  if (errors.length) throw new BusinessRuleError('Revise la asignación', errors);
  const row: TrainingAssignment = { id: newId('trn'), companyId: ctx.company.id, employeeId: input.employeeId, courseId: course.id, templateId: input.templateId, assignedBy: ctx.user.id, assignedAt: nowInstant(), scheduledDate: d, attendanceRecordedAt: null, attendanceDate: null, completionRecordedAt: null, completionDate: null, hours: null, documentId: null, status: d ? 'scheduled' : 'assigned', note: input.note.trim() };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('trainings', row);
    tx.audit({ action: 'training.assign', entityType: 'training', entityId: row.id, entityLabel: `${course.code} · ${course.title}`, summary: `Asignada a ${employeeName(ctx.db, input.employeeId)}${d ? `; prevista el ${d}` : ''}.`, employeeId: input.employeeId });
    tx.notify({ type: 'training.assign', title: 'Formación asignada', body: course.title, recipientUserIds: audience([employeeUser(ctx.db, input.employeeId)], ctx.user.id), link: '/mis-tareas', dedupeKey: `trn:${row.id}` });
    return row;
  });
}

function getTraining(ctx: Ctx, id: ID): TrainingAssignment {
  requirePerm(ctx, 'training.manage');
  const t = ownCompany(ctx, ctx.db.trainings.find((x) => x.id === id));
  if (!canSeeEmployee(ctx, t.employeeId)) throw new PermissionError();
  return t;
}

export async function scheduleTraining(id: ID, date: ISODate): Promise<TrainingAssignment> {
  await latency();
  const ctx = getCtx();
  const t = getTraining(ctx, id);
  if (t.status !== 'assigned' && t.status !== 'scheduled') throw new BusinessRuleError('Solo se programan formaciones pendientes.');
  const errors: string[] = [];
  const d = checkDate(errors, date, 'Fecha prevista', { required: true });
  if (d && d < ctx.today) errors.push('La fecha prevista no puede estar en el pasado.');
  if (errors.length) throw new BusinessRuleError('Revise la fecha', errors);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('trainings', t.id, { scheduledDate: d, status: 'scheduled' });
    tx.audit({ action: 'training.schedule', entityType: 'training', entityId: t.id, entityLabel: t.courseId, summary: `Prevista el ${d}.`, employeeId: t.employeeId, changes: [{ field: 'Fecha prevista', before: t.scheduledDate ?? '—', after: d! }] });
    return u;
  });
}

export async function recordAttendance(id: ID, date: ISODate): Promise<TrainingAssignment> {
  await latency();
  const ctx = getCtx();
  const t = getTraining(ctx, id);
  if (t.status !== 'assigned' && t.status !== 'scheduled') throw new BusinessRuleError('La asistencia ya está registrada o la formación está cerrada.');
  const errors: string[] = [];
  const d = checkDate(errors, date, 'Fecha de asistencia', { required: true });
  if (d && d > ctx.today) errors.push('La asistencia no puede registrarse con fecha futura.');
  if (errors.length) throw new BusinessRuleError('Revise la fecha', errors);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('trainings', t.id, { attendanceDate: d, attendanceRecordedAt: nowInstant(), status: 'attended' });
    tx.audit({ action: 'training.attendance', entityType: 'training', entityId: t.id, entityLabel: t.courseId, summary: `Asistencia el ${d}. La asistencia no acredita la finalización ni sustituye a la evidencia.`, employeeId: t.employeeId });
    auditReadinessChanges(tx, ctx, [t.employeeId], 'asistencia a formación');
    return u;
  });
}

export async function recordCompletion(id: ID, date: ISODate, hours: number | null): Promise<TrainingAssignment> {
  await latency();
  const ctx = getCtx();
  const t = getTraining(ctx, id);
  if (t.status !== 'attended') throw new BusinessRuleError('Registre primero la asistencia: la finalización es un hecho distinto.');
  const errors: string[] = [];
  const d = checkDate(errors, date, 'Fecha de finalización', { required: true });
  if (d && (d > ctx.today || (t.attendanceDate && d < t.attendanceDate))) errors.push('La finalización debe estar entre la asistencia y hoy.');
  if (hours !== null && (hours <= 0 || hours > 400)) errors.push('Horas: entre 0 y 400.');
  if (errors.length) throw new BusinessRuleError('Revise la finalización', errors);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('trainings', t.id, { completionDate: d, completionRecordedAt: nowInstant(), hours, status: 'completed' });
    tx.audit({ action: 'training.completion', entityType: 'training', entityId: t.id, entityLabel: t.courseId, summary: `Finalizada el ${d}. El requisito se cumple solo cuando se acepte la evidencia.`, employeeId: t.employeeId });
    auditReadinessChanges(tx, ctx, [t.employeeId], 'finalización de formación');
    return u;
  });
}

export async function cancelTraining(id: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  const t = getTraining(ctx, id);
  if (t.status === 'completed' || t.status === 'cancelled') throw new BusinessRuleError('La formación ya está cerrada.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('trainings', t.id, { status: 'cancelled', note: `${t.note ? `${t.note} · ` : ''}Cancelada: ${reason.trim()}` });
    tx.audit({ action: 'training.cancel', entityType: 'training', entityId: t.id, entityLabel: t.courseId, summary: 'Formación cancelada.', reason: reason.trim(), employeeId: t.employeeId });
  });
}

/** Training rows visible to the caller (own, team or company). */
export function visibleTrainings(ctx: Ctx): TrainingAssignment[] {
  return ctx.db.trainings.filter((t) => t.companyId === ctx.company.id && canSeeEmployee(ctx, t.employeeId) && (can(ctx, 'training.manage') || can(ctx, 'employees.view_all') || can(ctx, 'team.view') || t.employeeId === ctx.employee?.id));
}

// ─────────────────────────────── PPE ───────────────────────────────

export type EquipmentInput = Omit<EquipmentItem, 'id' | 'companyId' | 'code' | 'active'>;

export async function saveEquipment(input: EquipmentInput, id?: ID): Promise<EquipmentItem> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'ppe.manage');
  const errors: string[] = [];
  if (!input.name.trim()) errors.push('Nombre: obligatorio.');
  if (!input.type.trim()) errors.push('Tipo: obligatorio.');
  if (input.replacement.kind === 'interval' && (!input.replacement.months || !input.replacement.setBy?.trim())) errors.push('Sustitución periódica: indique los meses y su fuente (fabricante o servicio de prevención).');
  if (errors.length) throw new BusinessRuleError('Revise el equipo', errors);
  const existing = id ? ownCompany(ctx, ctx.db.equipment.find((x) => x.id === id)) : null;
  const count = ctx.db.equipment.filter((x) => x.companyId === ctx.company.id).length;
  const row: EquipmentItem = existing ? { ...existing, ...input } : { id: newId('eq'), companyId: ctx.company.id, code: `EPI-${String(count + 1).padStart(2, '0')}`, active: true, ...input };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (existing) tx.update('equipment', row.id, row);
    else tx.insert('equipment', row);
    tx.audit({ action: 'equipment.save', entityType: 'equipment', entityId: row.id, entityLabel: `${row.code} · ${row.name}`, summary: existing ? 'Equipo modificado en el catálogo.' : 'Equipo añadido al catálogo.' });
    return row;
  });
}

export interface IssueInput {
  employeeId: ID;
  itemId: ID;
  identifier: string;
  size: string;
  worksiteId: ID | null;
  issuedAt: ISODate;
  replacementDue: ISODate | null;
  note: string;
}

export function validateIssue(ctx: Ctx, input: IssueInput): string[] {
  const e: string[] = [];
  const item = ctx.db.equipment.find((x) => x.id === input.itemId && x.companyId === ctx.company.id);
  if (!item) e.push('Equipo: obligatorio.');
  if (item?.identifierRequired && !input.identifier.trim()) e.push('Este equipo requiere identificador (número de serie o lote).');
  const d = checkDate(e, input.issuedAt, 'Fecha de entrega', { required: true });
  if (d && d > ctx.today) e.push('La entrega no puede tener fecha futura.');
  const r = checkDate(e, input.replacementDue, 'Revisión o sustitución programada');
  if (r && d && r <= d) e.push('La revisión o sustitución debe ser posterior a la entrega.');
  return e;
}

/** Suggested replacement date only when the catalogue item has a configured interval. */
export function suggestedReplacement(item: EquipmentItem | undefined, issuedAt: ISODate): ISODate | null {
  return item?.replacement.kind === 'interval' && item.replacement.months ? addMonths(issuedAt, item.replacement.months) : null;
}

export async function issueEquipment(input: IssueInput, replacing?: ID): Promise<EquipmentIssue> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'ppe.manage');
  requireEmployeeVisible(ctx, input.employeeId);
  const errors = validateIssue(ctx, input);
  const prev = replacing ? ownCompany(ctx, ctx.db.issues.find((x) => x.id === replacing)) : null;
  if (prev && prev.status !== 'issued' && prev.status !== 'lost') errors.push('Solo se sustituye un equipo entregado o perdido.');
  if (errors.length) throw new BusinessRuleError('Revise la entrega', errors);
  const item = ctx.db.equipment.find((x) => x.id === input.itemId)!;
  const row: EquipmentIssue = { id: newId('iss'), companyId: ctx.company.id, employeeId: input.employeeId, itemId: item.id, identifier: input.identifier.trim(), size: input.size.trim(), worksiteId: input.worksiteId, issuedAt: input.issuedAt, issuedBy: ctx.user.id, status: 'issued', returnedAt: null, replacedById: null, replacementDue: input.replacementDue, documentId: null, note: input.note.trim() };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('issues', row);
    if (prev) {
      tx.update('issues', prev.id, { status: prev.status === 'lost' ? 'lost' : 'replaced', replacedById: row.id });
      tx.audit({ action: 'ppe.replace', entityType: 'ppe', entityId: prev.id, entityLabel: item.name, summary: `Sustituido por una nueva entrega (${row.issuedAt}).`, employeeId: input.employeeId });
    }
    tx.audit({ action: 'ppe.issue', entityType: 'ppe', entityId: row.id, entityLabel: `${item.code} · ${item.name}`, summary: `Entregado a ${employeeName(ctx.db, input.employeeId)} el ${row.issuedAt}${row.identifier ? ` (${row.identifier})` : ''}. Pendiente de la confirmación de recepción.`, employeeId: input.employeeId });
    tx.notify({ type: 'ppe.issue', title: 'Confirme la recepción de un equipo', body: item.name, recipientUserIds: audience([employeeUser(ctx.db, input.employeeId)], ctx.user.id), link: '/mis-tareas', dedupeKey: `iss:${row.id}` });
    auditReadinessChanges(tx, ctx, [input.employeeId], `entrega de ${item.name}`);
    return row;
  });
}

export async function closeIssue(id: ID, status: 'returned' | 'lost', date: ISODate, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'ppe.manage');
  const i = ownCompany(ctx, ctx.db.issues.find((x) => x.id === id));
  if (i.status !== 'issued') throw new BusinessRuleError('El equipo no está entregado.');
  const errors: string[] = [];
  const d = checkDate(errors, date, 'Fecha', { required: true });
  if (d && (d > ctx.today || d < i.issuedAt)) errors.push('La fecha debe estar entre la entrega y hoy.');
  if (!reason.trim()) errors.push('Motivo: obligatorio.');
  if (errors.length) throw new BusinessRuleError('Revise los datos', errors);
  const item = ctx.db.equipment.find((x) => x.id === i.itemId);
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('issues', i.id, { status, returnedAt: d, note: `${i.note ? `${i.note} · ` : ''}${reason.trim()}` });
    tx.audit({ action: status === 'returned' ? 'ppe.return' : 'ppe.lost', entityType: 'ppe', entityId: i.id, entityLabel: item?.name ?? i.itemId, summary: status === 'returned' ? `Devuelto el ${d}.` : `Perdido o dañado (${d}); requiere una nueva entrega.`, reason: reason.trim(), employeeId: i.employeeId });
    auditReadinessChanges(tx, ctx, [i.employeeId], `${item?.name ?? 'EPI'} ${status === 'returned' ? 'devuelto' : 'perdido'}`);
  });
}

export function visibleIssues(ctx: Ctx): EquipmentIssue[] {
  return ctx.db.issues.filter((i) => i.companyId === ctx.company.id && canSeeEmployee(ctx, i.employeeId));
}
