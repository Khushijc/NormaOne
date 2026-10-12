/**
 * Planning and configuration (TIM-01, PLT-07). Future endpoints: /shifts, /employees,
 * /employees/{id}/relationships, /policies/{key}/versions, /calendars, /absence-types, /protocols.
 *
 * A planned shift is never actual time. Policies and employment terms are effective-dated:
 * a new version applies from its effective date and never recalculates earlier records.
 */
import { newId } from '../domain/ids';
import { BusinessRuleError, PermissionError } from '../domain/permissions';
import { relationshipOn } from '../domain/records';
import { addDays, isValidISODate, localToInstant, minutesBetween, nowInstant } from '../domain/time';
import type { AbsenceType, CollectiveAgreementReference, Employee, EmploymentRelationship, Holiday, ID, ISODate, PlannedShift, RecordingProtocol, WorkingCalendar, WorkingTimePolicy } from '../domain/types';
import { transact } from '../store/db';
import { can, employeeName, getCtx, latency, ownCompany, requirePerm, teamIds, type Ctx } from './context';

// ─────────────────────────────── Shifts ───────────────────────────────

export interface ShiftInput {
  employeeId: ID;
  worksiteId: ID;
  date: ISODate;
  startTime: string;
  endTime: string;
  note: string;
}

export function canManageShiftsFor(ctx: Ctx, employeeId: ID): boolean {
  if (can(ctx, 'shifts.manage_all')) return true;
  return can(ctx, 'shifts.manage_team') && (teamIds(ctx).has(employeeId) || ctx.employee?.id === employeeId);
}

export interface ShiftCheck {
  errors: string[];
  warnings: string[];
  start: string | null;
  end: string | null;
}

/** Validates a planned shift. Overnight shifts end the next day; DST gaps/ambiguities are reported. */
export function checkShift(ctx: Ctx, input: ShiftInput, ignoreId: ID | null): ShiftCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const emp = ctx.db.employees.find((e) => e.id === input.employeeId && e.companyId === ctx.company.id);
  if (!emp) errors.push('Seleccione un empleado.');
  else if (emp.status !== 'active') errors.push('El empleado está desactivado.');
  if (emp && !emp.worksiteIds.includes(input.worksiteId)) errors.push('El centro no está asignado a este empleado.');
  if (!isValidISODate(input.date)) errors.push('Indique una fecha válida.');
  let start: string | null = null;
  let end: string | null = null;
  if (isValidISODate(input.date)) {
    const overnight = input.endTime <= input.startTime;
    const s = localToInstant(input.date, input.startTime);
    const e = localToInstant(overnight ? addDays(input.date, 1) : input.date, input.endTime);
    if (s.kind === 'gap' || e.kind === 'gap') errors.push('Una de las horas no existe ese día por el cambio de hora.');
    else if (s.kind === 'invalid' || e.kind === 'invalid') errors.push('Indique horas válidas (HH:MM).');
    else {
      if (s.kind === 'ambiguous' || e.kind === 'ambiguous') warnings.push('El turno incluye la hora repetida del cambio de hora; se usa la primera aparición.');
      start = s.kind === 'ok' ? s.instant : s.options[0];
      end = e.kind === 'ok' ? e.instant : e.options[0];
      const mins = minutesBetween(start, end);
      if (mins > 14 * 60) errors.push('Un turno planificado no puede superar 14 horas.');
      if (overnight) warnings.push('Turno nocturno: termina al día siguiente.');
      const clash = ctx.db.shifts.find((x) => x.employeeId === input.employeeId && x.status === 'planned' && x.id !== ignoreId && x.start < end! && start! < x.end);
      if (clash) warnings.push('Se solapa con otro turno planificado del mismo empleado (indicador de revisión).');
    }
    const onLeave = ctx.db.absences.find((a) => a.employeeId === input.employeeId && (a.status === 'approved' || a.status === 'pending') && !a.partial && input.date >= a.startDate && input.date <= a.endDate);
    if (onLeave) warnings.push(onLeave.status === 'approved' ? 'El empleado tiene una ausencia aprobada ese día.' : 'El empleado tiene una ausencia pendiente ese día.');
    const ws = ctx.db.worksites.find((w) => w.id === input.worksiteId);
    const holiday = ctx.db.calendars.find((c) => c.id === ws?.calendarId)?.holidays.find((h) => h.date === input.date);
    if (holiday) warnings.push(`Es festivo en el calendario del centro (${holiday.name}).`);
  }
  return { errors, warnings, start, end };
}

export async function saveShift(input: ShiftInput, existingId: ID | null): Promise<PlannedShift> {
  await latency();
  const ctx = getCtx();
  if (!canManageShiftsFor(ctx, input.employeeId)) throw new PermissionError();
  const existing = existingId ? ownCompany(ctx, ctx.db.shifts.find((s) => s.id === existingId)) : null;
  if (existing?.status === 'cancelled') throw new BusinessRuleError('El turno está cancelado.');
  const chk = checkShift(ctx, input, existingId);
  if (chk.errors.length) throw new BusinessRuleError('El turno no es válido', chk.errors);
  const at = nowInstant();
  const row: PlannedShift = { ...(existing ?? { id: newId('shf'), companyId: ctx.company.id, createdBy: ctx.user.id, createdAt: at, status: 'planned' as const }), employeeId: input.employeeId, worksiteId: input.worksiteId, date: input.date, start: chk.start!, end: chk.end!, timezone: ctx.company.timezone, note: input.note.trim(), updatedAt: at };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (existing) tx.update('shifts', row.id, row);
    else tx.insert('shifts', row);
    tx.audit({ action: existing ? 'shift.update' : 'shift.create', entityType: 'shift', entityId: row.id, entityLabel: employeeName(ctx.db, row.employeeId), employeeId: row.employeeId, summary: `Turno planificado ${input.date} ${input.startTime}–${input.endTime}. No genera tiempo trabajado.`, changes: existing ? [{ field: 'Horario', before: `${existing.date} ${existing.start}–${existing.end}`, after: `${row.date} ${row.start}–${row.end}` }] : [] });
    return row;
  });
}

export async function cancelShift(id: ID, reason: string): Promise<PlannedShift> {
  await latency();
  const ctx = getCtx();
  const s = ownCompany(ctx, ctx.db.shifts.find((x) => x.id === id));
  if (!canManageShiftsFor(ctx, s.employeeId)) throw new PermissionError();
  if (s.status === 'cancelled') throw new BusinessRuleError('El turno ya estaba cancelado.');
  if (reason.trim().length < 3) throw new BusinessRuleError('Indique el motivo de la cancelación.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('shifts', id, { status: 'cancelled', note: `${s.note ? `${s.note} · ` : ''}${reason.trim()}`, updatedAt: nowInstant() });
    tx.audit({ action: 'shift.cancel', entityType: 'shift', entityId: id, entityLabel: employeeName(ctx.db, s.employeeId), employeeId: s.employeeId, summary: `Turno del ${s.date} cancelado. Los registros de trabajo no se modifican.`, reason: reason.trim() });
    return u;
  });
}

// ─────────────────────────────── Employees ───────────────────────────────

export interface EmployeeInput {
  code: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  departmentId: ID;
  primaryWorksiteId: ID;
  worksiteIds: ID[];
  managerEmployeeId: ID | null;
  jobTitle: string;
  hireDate: ISODate;
}

export function validateEmployee(ctx: Ctx, input: EmployeeInput, selfId: ID | null): string[] {
  const e: string[] = [];
  if (!input.firstName.trim() || !input.lastName.trim()) e.push('Nombre y apellidos son obligatorios.');
  if (!/^[A-Z]{2,4}-\d{3,}$/.test(input.code.trim())) e.push('El código debe tener el formato ABC-001.');
  if (ctx.db.employees.some((x) => x.companyId === ctx.company.id && x.id !== selfId && x.code === input.code.trim())) e.push('Ya existe un empleado con ese código.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.workEmail.trim())) e.push('Indique un correo de trabajo válido.');
  if (ctx.db.employees.some((x) => x.companyId === ctx.company.id && x.id !== selfId && x.workEmail.toLowerCase() === input.workEmail.trim().toLowerCase())) e.push('Ese correo ya está asignado a otro empleado.');
  if (!ctx.db.departments.some((d) => d.id === input.departmentId && d.companyId === ctx.company.id)) e.push('Seleccione un departamento.');
  if (!input.worksiteIds.length) e.push('Asigne al menos un centro de trabajo.');
  if (!input.worksiteIds.includes(input.primaryWorksiteId)) e.push('El centro principal debe estar entre los centros asignados.');
  if (!isValidISODate(input.hireDate)) e.push('Indique la fecha de alta.');
  if (input.managerEmployeeId && input.managerEmployeeId === selfId) e.push('Un empleado no puede ser su propio responsable.');
  return e;
}

export interface RelationshipInput {
  effectiveFrom: ISODate;
  contractType: EmploymentRelationship['contractType'];
  workdayType: EmploymentRelationship['workdayType'];
  weeklyHours: number;
  partTimePct: number | null;
  agreementId: ID;
  policyKey: string;
  reducedHours: EmploymentRelationship['reducedHours'];
  remoteAllowed: boolean;
  note: string;
}

export function validateRelationship(ctx: Ctx, r: RelationshipInput): string[] {
  const e: string[] = [];
  if (!isValidISODate(r.effectiveFrom)) e.push('Indique la fecha de efecto.');
  if (!(r.weeklyHours > 0 && r.weeklyHours <= 40)) e.push('Las horas semanales deben estar entre 1 y 40 (jornada máxima ordinaria, ET art. 34.1).');
  if (r.workdayType === 'part_time' && !(r.partTimePct && r.partTimePct > 0 && r.partTimePct < 100)) e.push('Indique el porcentaje de parcialidad.');
  if (r.workdayType === 'full_time' && r.partTimePct) e.push('Una jornada a tiempo completo no tiene porcentaje de parcialidad.');
  if (!ctx.db.agreements.some((a) => a.id === r.agreementId && a.companyId === ctx.company.id)) e.push('Seleccione el convenio de referencia.');
  if (!ctx.db.policies.some((p) => p.key === r.policyKey && p.companyId === ctx.company.id)) e.push('Seleccione la política de jornada.');
  if (r.reducedHours && !(r.reducedHours.pct > 0 && r.reducedHours.pct < 100 && r.reducedHours.basis.trim())) e.push('Indique el porcentaje y la base de la reducción de jornada.');
  return e;
}

export async function createEmployee(input: EmployeeInput, rel: RelationshipInput): Promise<Employee> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'employees.manage');
  const errors = [...validateEmployee(ctx, input, null), ...validateRelationship(ctx, { ...rel, effectiveFrom: input.hireDate })];
  if (errors.length) throw new BusinessRuleError('Revise los datos del empleado', errors);
  const at = nowInstant();
  const emp: Employee = { id: newId('emp'), companyId: ctx.company.id, ...input, code: input.code.trim(), firstName: input.firstName.trim(), lastName: input.lastName.trim(), workEmail: input.workEmail.trim(), status: 'active', endDate: null, userId: null, createdAt: at, updatedAt: at };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('employees', emp);
    tx.insert('relationships', { id: newId('rel'), companyId: ctx.company.id, employeeId: emp.id, effectiveTo: null, createdBy: ctx.user.id, createdAt: at, ...rel, effectiveFrom: input.hireDate });
    tx.audit({ action: 'employee.create', entityType: 'employee', entityId: emp.id, entityLabel: `${emp.firstName} ${emp.lastName}`, employeeId: emp.id, summary: `Alta de ${emp.code} con efecto ${emp.hireDate}.` });
    return emp;
  });
}

export async function updateEmployee(id: ID, input: EmployeeInput): Promise<Employee> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'employees.manage');
  const current = ownCompany(ctx, ctx.db.employees.find((e) => e.id === id));
  const errors = validateEmployee(ctx, input, id);
  if (errors.length) throw new BusinessRuleError('Revise los datos del empleado', errors);
  const labels: Record<string, string> = { code: 'Código', firstName: 'Nombre', lastName: 'Apellidos', workEmail: 'Correo de trabajo', departmentId: 'Departamento', primaryWorksiteId: 'Centro principal', worksiteIds: 'Centros', managerEmployeeId: 'Responsable', jobTitle: 'Puesto', hireDate: 'Fecha de alta' };
  const changes = Object.entries(labels)
    .filter(([k]) => JSON.stringify((current as unknown as Record<string, unknown>)[k]) !== JSON.stringify((input as unknown as Record<string, unknown>)[k]))
    .map(([k, field]) => ({ field, before: String((current as unknown as Record<string, unknown>)[k] ?? '—'), after: String((input as unknown as Record<string, unknown>)[k] ?? '—') }));
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('employees', id, { ...input, updatedAt: nowInstant() });
    tx.audit({ action: 'employee.update', entityType: 'employee', entityId: id, entityLabel: `${u.firstName} ${u.lastName}`, employeeId: id, summary: 'Ficha del empleado modificada.', changes });
    return u;
  });
}

/** Deactivation never deletes records: they stay for the four-year retention period (TIM-07, WF-04). */
export async function setEmployeeActive(id: ID, active: boolean, effectiveDate: ISODate, reason: string): Promise<Employee> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'employees.manage');
  const emp = ownCompany(ctx, ctx.db.employees.find((e) => e.id === id));
  if ((emp.status === 'active') === active) throw new BusinessRuleError(active ? 'El empleado ya está activo.' : 'El empleado ya está desactivado.');
  if (reason.trim().length < 5) throw new BusinessRuleError('Indique el motivo.');
  if (!active && !isValidISODate(effectiveDate)) throw new BusinessRuleError('Indique la fecha de baja.');
  if (!active && ctx.db.memberships.some((m) => m.companyId === ctx.company.id && m.employeeId === id && m.userId === ctx.user.id)) throw new BusinessRuleError('No puede desactivar su propia ficha.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('employees', id, { status: active ? 'active' : 'inactive', endDate: active ? null : effectiveDate, updatedAt: nowInstant() });
    const rel = tx.db.relationships.filter((r) => r.employeeId === id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (rel && !active) tx.update('relationships', rel.id, { effectiveTo: effectiveDate });
    if (rel && active) tx.update('relationships', rel.id, { effectiveTo: null });
    // Future planned shifts are cancelled on deactivation; worked records are untouched.
    if (!active) for (const s of tx.db.shifts.filter((x) => x.employeeId === id && x.status === 'planned' && x.date > effectiveDate)) tx.update('shifts', s.id, { status: 'cancelled', note: 'Cancelado por baja del empleado.', updatedAt: nowInstant() });
    tx.audit({ action: active ? 'employee.activate' : 'employee.deactivate', entityType: 'employee', entityId: id, entityLabel: `${emp.firstName} ${emp.lastName}`, employeeId: id, summary: active ? 'Empleado reactivado.' : `Baja con efecto ${effectiveDate}. Sus registros horarios se conservan durante el plazo legal.`, reason: reason.trim() });
    return u;
  });
}

/** New effective-dated version of the employment terms; the previous one ends the day before. */
export async function addRelationshipVersion(employeeId: ID, input: RelationshipInput): Promise<EmploymentRelationship> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'employees.manage');
  const emp = ownCompany(ctx, ctx.db.employees.find((e) => e.id === employeeId));
  const errors = validateRelationship(ctx, input);
  const current = relationshipOn(ctx.db, emp.id, input.effectiveFrom) ?? ctx.db.relationships.filter((r) => r.employeeId === emp.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (current && input.effectiveFrom <= current.effectiveFrom) errors.push(`La nueva versión debe empezar después del ${current.effectiveFrom}.`);
  if (input.effectiveFrom < ctx.today) errors.push('No se puede dar efecto retroactivo: los registros ya realizados mantienen las condiciones vigentes en su fecha.');
  if (errors.length) throw new BusinessRuleError('Revise las condiciones laborales', errors);
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (current) tx.update('relationships', current.id, { effectiveTo: addDays(input.effectiveFrom, -1) });
    const row: EmploymentRelationship = { id: newId('rel'), companyId: ctx.company.id, employeeId: emp.id, effectiveTo: null, createdBy: ctx.user.id, createdAt: at, ...input };
    tx.insert('relationships', row);
    tx.audit({ action: 'relationship.version', entityType: 'employee', entityId: emp.id, entityLabel: `${emp.firstName} ${emp.lastName}`, employeeId: emp.id, summary: `Nuevas condiciones con efecto ${input.effectiveFrom}.`, reason: input.note || null, changes: current ? [{ field: 'Horas semanales', before: String(current.weeklyHours), after: String(input.weeklyHours) }, { field: 'Tipo de jornada', before: current.workdayType, after: input.workdayType }] : [] });
    return row;
  });
}

// ─────────────────────────────── Policies, agreements, calendars, absence types, protocol ───────────────────────────────

export type PolicyPatch = Pick<WorkingTimePolicy, 'breaks' | 'indicators' | 'basis'>;

/** New policy version. Never retroactive: effective from today or later (PLT-07, AC-PLT-03). */
export async function newPolicyVersion(key: string, patch: PolicyPatch, effectiveFrom: ISODate, reason: string): Promise<WorkingTimePolicy> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'policies.manage');
  const versions = ctx.db.policies.filter((p) => p.companyId === ctx.company.id && p.key === key).sort((a, b) => b.version - a.version);
  const latest = versions[0];
  if (!latest) throw new BusinessRuleError('Política no encontrada.');
  const errors: string[] = [];
  if (!isValidISODate(effectiveFrom)) errors.push('Indique la fecha de efecto.');
  if (effectiveFrom < ctx.today) errors.push('La fecha de efecto no puede ser anterior a hoy: las versiones anteriores siguen aplicándose a sus fechas.');
  if (effectiveFrom <= latest.effectiveFrom) errors.push(`Debe ser posterior al inicio de la versión vigente (${latest.effectiveFrom}).`);
  if (reason.trim().length < 10) errors.push('Explique el motivo del cambio y su base (convenio, acuerdo o decisión).');
  const th = patch.indicators;
  if (th.dailyOrdinaryMaxHours <= 0 || th.dailyOrdinaryMaxHours > 12) errors.push('El umbral diario debe estar entre 1 y 12 horas.');
  if (th.minRestBetweenDaysHours < 0 || th.minRestBetweenDaysHours > 24) errors.push('El descanso entre jornadas debe estar entre 0 y 24 horas.');
  if (th.longSessionHours <= 0 || th.shortSessionMinutes < 0 || th.missingClockOutAfterHours < 4) errors.push('Revise los umbrales de sesión.');
  if (!/^\d{2}:\d{2}$/.test(th.nightStart) || !/^\d{2}:\d{2}$/.test(th.nightEnd)) errors.push('Indique la franja nocturna en formato HH:MM.');
  if (errors.length) throw new BusinessRuleError('La nueva versión no es válida', errors);
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('policies', latest.id, { effectiveTo: addDays(effectiveFrom, -1), status: effectiveFrom <= ctx.today ? 'superseded' : latest.status });
    const row: WorkingTimePolicy = { ...latest, ...patch, id: newId('pol'), version: latest.version + 1, effectiveFrom, effectiveTo: null, status: 'active', editedBy: ctx.user.id, editedAt: at, approvedBy: null, supersedesId: latest.id, changeReason: reason.trim() };
    tx.insert('policies', row);
    tx.audit({ action: 'policy.version', entityType: 'policy', entityId: row.id, entityLabel: `${row.name} v${row.version}`, employeeId: null, summary: `Versión ${row.version} con efecto ${effectiveFrom}. Los registros anteriores siguen calculándose con la versión ${latest.version}.`, reason: reason.trim(), changes: [{ field: 'Pausas retribuidas', before: latest.breaks.paidBreakKinds.join(', ') || '—', after: row.breaks.paidBreakKinds.join(', ') || '—' }, { field: 'Umbral diario (h)', before: String(latest.indicators.dailyOrdinaryMaxHours), after: String(row.indicators.dailyOrdinaryMaxHours) }] });
    return row;
  });
}

export async function updateAgreementReview(id: ID, reviewStatus: CollectiveAgreementReference['reviewStatus'], reviewedBy: string, note: string): Promise<CollectiveAgreementReference> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'policies.manage');
  const a = ownCompany(ctx, ctx.db.agreements.find((x) => x.id === id));
  if (reviewStatus === 'adviser_reviewed' && !reviewedBy.trim()) throw new BusinessRuleError('Indique quién ha revisado el convenio.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('agreements', id, { reviewStatus, reviewedBy: reviewedBy.trim() || null, reviewedAt: reviewStatus === 'adviser_reviewed' ? ctx.today : a.reviewedAt, note: note.trim() || a.note });
    tx.audit({ action: 'policy.agreement', entityType: 'agreement', entityId: id, entityLabel: a.name, employeeId: null, summary: 'Estado de revisión del convenio actualizado.', changes: [{ field: 'Revisión', before: a.reviewStatus, after: reviewStatus }] });
    return u;
  });
}

export async function addHoliday(calendarId: ID, holiday: Holiday): Promise<WorkingCalendar> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'policies.manage');
  const cal = ownCompany(ctx, ctx.db.calendars.find((c) => c.id === calendarId));
  if (!isValidISODate(holiday.date) || !holiday.date.startsWith(String(cal.year))) throw new BusinessRuleError(`La fecha debe pertenecer a ${cal.year}.`);
  if (!holiday.name.trim()) throw new BusinessRuleError('Indique el nombre del festivo.');
  if (cal.holidays.some((h) => h.date === holiday.date)) throw new BusinessRuleError('Ya hay un festivo en esa fecha.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('calendars', calendarId, { holidays: [...cal.holidays, { ...holiday, name: holiday.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)) });
    tx.audit({ action: 'calendar.update', entityType: 'calendar', entityId: calendarId, entityLabel: cal.name, employeeId: null, summary: `Festivo añadido: ${holiday.date} (${holiday.name.trim()}). No crea ni elimina registros de asistencia.` });
    return u;
  });
}

export async function removeHoliday(calendarId: ID, date: ISODate, reason: string): Promise<WorkingCalendar> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'policies.manage');
  const cal = ownCompany(ctx, ctx.db.calendars.find((c) => c.id === calendarId));
  const h = cal.holidays.find((x) => x.date === date);
  if (!h) throw new BusinessRuleError('Ese festivo no existe en el calendario.');
  if (reason.trim().length < 5) throw new BusinessRuleError('Indique el motivo.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('calendars', calendarId, { holidays: cal.holidays.filter((x) => x.date !== date) });
    tx.audit({ action: 'calendar.update', entityType: 'calendar', entityId: calendarId, entityLabel: cal.name, employeeId: null, summary: `Festivo eliminado: ${date} (${h.name}).`, reason: reason.trim() });
    return u;
  });
}

export async function updateAbsenceType(id: ID, patch: Partial<Pick<AbsenceType, 'name' | 'requiresApproval' | 'evidence' | 'allowsPartialDay' | 'active' | 'note' | 'allowance'>>, reason: string): Promise<AbsenceType> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'policies.manage');
  const t = ownCompany(ctx, ctx.db.absenceTypes.find((x) => x.id === id));
  if (reason.trim().length < 5) throw new BusinessRuleError('Indique el motivo del cambio.');
  if (t.sensitive && patch.evidence && patch.evidence !== 'none') throw new BusinessRuleError('Las categorías sensibles no admiten justificantes (minimización de datos de salud).');
  if (patch.allowance && !(patch.allowance.days > 0 && patch.allowance.days <= 60)) throw new BusinessRuleError('El saldo anual debe estar entre 1 y 60 días.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('absenceTypes', id, { ...patch, version: t.version + 1, effectiveFrom: ctx.today });
    const changes = Object.keys(patch).map((k) => ({ field: k, before: JSON.stringify((t as unknown as Record<string, unknown>)[k]), after: JSON.stringify((patch as Record<string, unknown>)[k]) }));
    tx.audit({ action: 'absence_type.update', entityType: 'absence_type', entityId: id, entityLabel: t.name, employeeId: null, summary: `Tipo de ausencia actualizado (versión ${t.version + 1}). Las solicitudes existentes no cambian.`, reason: reason.trim(), changes });
    return u;
  });
}

export async function newProtocolVersion(patch: Pick<RecordingProtocol, 'basis' | 'basisReference' | 'consultedRepresentativesOn' | 'correctionProcedure' | 'connectivityFallback' | 'sources'>, effectiveFrom: ISODate): Promise<RecordingProtocol> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'settings.manage');
  const current = ctx.db.protocols.find((p) => p.companyId === ctx.company.id && p.status === 'active');
  const errors: string[] = [];
  if (!patch.basisReference.trim()) errors.push('Indique la referencia del acuerdo, convenio o consulta.');
  if (patch.basis === 'decision_previa_consulta' && ctx.company.workerRepresentation !== 'none' && !patch.consultedRepresentativesOn) errors.push('Indique la fecha de consulta a la representación legal (ET art. 34.9).');
  if (!patch.sources.length) errors.push('Seleccione al menos un medio de registro.');
  if (!isValidISODate(effectiveFrom) || effectiveFrom < ctx.today) errors.push('La fecha de efecto debe ser hoy o posterior.');
  if (errors.length) throw new BusinessRuleError('El protocolo no es válido', errors);
  const at = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (current) tx.update('protocols', current.id, { status: 'superseded' });
    const row: RecordingProtocol = { id: newId('prt'), companyId: ctx.company.id, version: (current?.version ?? 0) + 1, ...patch, effectiveFrom, approvedBy: ctx.user.name, approvedAt: at, status: 'active' };
    tx.insert('protocols', row);
    tx.audit({ action: 'protocol.update', entityType: 'protocol', entityId: row.id, entityLabel: `Protocolo v${row.version}`, employeeId: null, summary: `Nueva versión del protocolo de registro con efecto ${effectiveFrom}.` });
    return row;
  });
}
