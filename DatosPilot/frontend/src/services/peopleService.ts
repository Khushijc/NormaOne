/**
 * Employees, worksites, change (delta) reviews and assignment-readiness decisions.
 *
 * - A role/department/worksite change creates a new effective-dated assignment (history kept)
 *   and a delta review computed with the versioned rules (PRL-02, AC-PRL-01). Existing evidence
 *   is never invalidated by the change itself.
 * - A worksite change (risks, activities, deactivation) opens delta reviews for the employees
 *   assigned to it.
 * - "Ready" can be confirmed only when the derived state is ready. A blocked assignment can be
 *   covered only by an authorised, time-limited exception where the approved requirement allows
 *   it (never for a legally mandatory control).
 */
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { READINESS } from '../domain/status';
import { fillMsg } from '../domain/exceptions';
import { addDays, nowInstant } from '../domain/time';
import { newId } from '../domain/ids';
import { assignmentOn, buildItems, computeDelta, diffItems, readinessFor, versionOn, type AssignmentShape } from '../domain/requirements';
import type { AssignmentChange, Employee, EmployeeAssignment, ID, ISODate, ReadinessDecision, RequirementDelta, Worksite } from '../domain/types';
import { transact, type Tx } from '../store/db';
import { auditReadinessChanges, audience, checkDate, employeeUser, managerUser, riskLabels, snap, usersWithRole } from './common';
import { alertDays, can, employeeName, getCtx, latency, ownCompany, requireEmployeeVisible, requirePerm, roleName, worksiteName, type Ctx } from './context';

/** Exceptions are time-limited (product setting for the demo; the approving professional may set less). */
export const EXCEPTION_MAX_DAYS = 30;

// ─────────────────────────────── Employees ───────────────────────────────

export function currentShape(ctx: Ctx, employeeId: ID): AssignmentShape | null {
  const a = assignmentOn(ctx.db, employeeId, ctx.today);
  return a ? { jobRoleId: a.jobRoleId, departmentId: a.departmentId, worksiteIds: a.worksiteIds } : null;
}

/** Delta preview without saving (shown before confirming a change). */
export function previewChange(ctx: Ctx, employeeId: ID, after: AssignmentShape, effectiveFrom: ISODate): RequirementDelta | null {
  const before = currentShape(ctx, employeeId);
  if (!before) return null;
  const date = effectiveFrom > ctx.today ? effectiveFrom : ctx.today;
  return computeDelta(ctx.db, ctx.company.id, employeeId, before, after, date, alertDays(ctx));
}

export function validateShape(ctx: Ctx, s: AssignmentShape): string[] {
  const e: string[] = [];
  if (!ctx.db.jobRoles.some((r) => r.id === s.jobRoleId && r.companyId === ctx.company.id && r.active)) e.push('Puesto: obligatorio.');
  if (!ctx.db.departments.some((d) => d.id === s.departmentId && d.companyId === ctx.company.id)) e.push('Departamento: obligatorio.');
  if (!s.worksiteIds.length) e.push('Asigne al menos un centro de trabajo.');
  if (s.worksiteIds.some((w) => !ctx.db.worksites.some((x) => x.id === w && x.companyId === ctx.company.id && x.active))) e.push('Solo se asignan centros activos de la empresa.');
  return e;
}

export async function changeAssignment(employeeId: ID, after: AssignmentShape, effectiveFrom: ISODate, reason: string): Promise<AssignmentChange> {
  await latency(300);
  const ctx = getCtx();
  requirePerm(ctx, 'employees.manage');
  requireEmployeeVisible(ctx, employeeId);
  const emp = ownCompany(ctx, ctx.db.employees.find((e) => e.id === employeeId));
  if (emp.status !== 'active') throw new BusinessRuleError('El empleado no está activo.');
  const current = assignmentOn(ctx.db, employeeId, ctx.today);
  if (!current) throw new BusinessRuleError('El empleado no tiene una asignación vigente.');
  const errors = validateShape(ctx, after);
  const from = checkDate(errors, effectiveFrom, 'Fecha de efecto', { required: true });
  if (from && from < ctx.today) errors.push('El cambio no puede ser retroactivo: elija hoy o una fecha posterior.');
  if (from && from <= current.effectiveFrom) errors.push('La fecha de efecto debe ser posterior al inicio de la asignación vigente.');
  if (!reason.trim()) errors.push('Motivo del cambio: obligatorio.');
  const same = current.jobRoleId === after.jobRoleId && current.departmentId === after.departmentId && [...current.worksiteIds].sort().join() === [...after.worksiteIds].sort().join();
  if (same) errors.push('No hay cambios respecto a la asignación vigente.');
  if (ctx.db.assignments.some((a) => a.employeeId === employeeId && a.effectiveFrom > ctx.today)) errors.push('Ya hay un cambio programado para este empleado.');
  if (errors.length) throw new BusinessRuleError('Revise el cambio', errors);
  const before = { jobRoleId: current.jobRoleId, departmentId: current.departmentId, worksiteIds: current.worksiteIds };
  const delta = computeDelta(ctx.db, ctx.company.id, employeeId, before, after, from! > ctx.today ? from! : ctx.today, alertDays(ctx));
  const now = nowInstant();
  const row: EmployeeAssignment = { id: newId('asg'), companyId: ctx.company.id, employeeId, ...after, effectiveFrom: from!, effectiveTo: null, changeReason: reason.trim(), createdBy: ctx.user.id, createdAt: now };
  const focus = before.jobRoleId !== after.jobRoleId ? after.worksiteIds : after.worksiteIds.filter((w) => !before.worksiteIds.includes(w));
  const change: AssignmentChange = { id: newId('chg'), companyId: ctx.company.id, employeeId, trigger: 'employee_change', focusWorksiteIds: focus, before, after, effectiveFrom: from!, reason: reason.trim(), delta, status: 'pending_review', createdBy: ctx.user.id, createdAt: now, reviewedBy: null, reviewedAt: null, reviewNote: null };
  const diff = (a: string[], b: string[]) => a.filter((x) => !b.includes(x)).map((w) => worksiteName(ctx.db, w));
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('assignments', current.id, { effectiveTo: addDays(from!, -1) });
    tx.insert('assignments', row);
    tx.insert('changes', change);
    tx.audit({
      action: 'employee.assignment',
      entityType: 'employee',
      entityId: employeeId,
      entityLabel: employeeName(ctx.db, employeeId),
      summary: `Cambio con efecto ${from}: ${delta.newlyRequired.length} requisitos nuevos, ${delta.noLongerApplicable.length} ya no aplicables, ${delta.newCriticalUnresolved.length} críticos sin resolver. Las evidencias existentes no se invalidan.`,
      reason: reason.trim(),
      employeeId,
      changes: [
        { field: 'Puesto', before: roleName(ctx.db, before.jobRoleId), after: roleName(ctx.db, after.jobRoleId) },
        { field: 'Centros añadidos', before: '—', after: diff(after.worksiteIds, before.worksiteIds).join(', ') || '—' },
        { field: 'Centros retirados', before: diff(before.worksiteIds, after.worksiteIds).join(', ') || '—', after: '—' },
      ].filter((c) => c.before !== c.after),
    });
    tx.notify({ type: 'change.review', title: 'Cambio de puesto o centro pendiente de revisar', body: `${employeeName(ctx.db, employeeId)} · ${delta.newlyRequired.length} requisitos nuevos`, recipientUserIds: audience([...usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today), managerUser(ctx.db, employeeId)], ctx.user.id), link: `/empleados/${employeeId}?tab=cambios`, dedupeKey: `chg:${change.id}` });
    auditReadinessChanges(tx, ctx, [employeeId], 'cambio de puesto o centro');
    return change;
  });
}

export async function reviewChange(changeId: ID, note: string, requestNew: boolean): Promise<AssignmentChange> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'changes.review');
  const c = ownCompany(ctx, ctx.db.changes.find((x) => x.id === changeId));
  requireEmployeeVisible(ctx, c.employeeId);
  if (c.status !== 'pending_review') throw new BusinessRuleError('La revisión ya está completada.');
  if (!note.trim()) throw new BusinessRuleError('Indique la nota de revisión.');
  // Requests for newly required document/training items that have no evidence yet.
  const toRequest = requestNew
    ? c.delta.newlyRequired.filter((d) => {
        const v = versionOn(ctx.db, d.templateId, ctx.today);
        return v && (v.evidenceMode === 'document' || v.evidenceMode === 'training') && (d.evidence === 'missing') && !ctx.db.requests.some((r) => r.status === 'open' && r.employeeId === c.employeeId && r.templateId === d.templateId);
      })
    : [];
  const now = nowInstant();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('changes', c.id, { status: 'reviewed', reviewedBy: ctx.user.id, reviewedAt: now, reviewNote: note.trim() });
    for (const d of toRequest) {
      tx.insert('requests', { id: newId('rq'), companyId: ctx.company.id, employeeId: c.employeeId, worksiteId: d.worksiteId, templateId: d.templateId, requestedBy: ctx.user.id, requestedAt: now, followUpDate: null, note: 'Solicitada desde la revisión de cambios.', status: 'open', documentId: null, closedAt: null });
    }
    tx.audit({ action: 'change.review', entityType: 'employee', entityId: c.employeeId, entityLabel: employeeName(ctx.db, c.employeeId), summary: `Revisión de cambios completada${toRequest.length ? `; ${toRequest.length} evidencias solicitadas` : ''}.`, reason: note.trim(), employeeId: c.employeeId });
    if (toRequest.length) tx.notify({ type: 'evidence.request', title: 'Nueva solicitud de evidencia', body: `${toRequest.length} requisitos nuevos`, recipientUserIds: audience([employeeUser(ctx.db, c.employeeId)], ctx.user.id), link: '/mis-tareas', dedupeKey: `chg-rq:${c.id}` });
    auditReadinessChanges(tx, ctx, [c.employeeId], 'revisión de cambios completada');
    return u;
  });
}

export async function updateEmployee(employeeId: ID, patch: Pick<Employee, 'managerEmployeeId'>): Promise<Employee> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'employees.manage');
  const e = ownCompany(ctx, ctx.db.employees.find((x) => x.id === employeeId));
  if (patch.managerEmployeeId === e.id) throw new BusinessRuleError('Una persona no puede ser su propia supervisora.');
  if (patch.managerEmployeeId && !ctx.db.employees.some((x) => x.id === patch.managerEmployeeId && x.companyId === ctx.company.id && x.status === 'active')) throw new NotFoundError();
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('employees', e.id, { managerEmployeeId: patch.managerEmployeeId });
    tx.audit({ action: 'employee.update', entityType: 'employee', entityId: e.id, entityLabel: employeeName(ctx.db, e.id), summary: 'Supervisor/a modificado.', employeeId: e.id, changes: [{ field: 'Supervisor/a', before: employeeName(ctx.db, e.managerEmployeeId), after: employeeName(ctx.db, patch.managerEmployeeId) }] });
    return u;
  });
}

// ─────────────────────────────── Worksites ───────────────────────────────

export type WorksiteInput = Omit<Worksite, 'id' | 'companyId' | 'code' | 'active' | 'updatedAt'>;

export function validateWorksite(ctx: Ctx, input: WorksiteInput): string[] {
  const e: string[] = [];
  if (!input.name.trim()) e.push('Nombre: obligatorio.');
  if (!input.address.trim() || !input.municipality.trim()) e.push('Dirección y municipio: obligatorios.');
  if (input.kind === 'customer' && !input.customerId) e.push('Centro de cliente: indique la organización.');
  if (input.coordinatorEmployeeId && !ctx.db.employees.some((x) => x.id === input.coordinatorEmployeeId && x.companyId === ctx.company.id && x.status === 'active')) e.push('Coordinador/a interno: debe ser un empleado activo.');
  if (input.riskTags.some((t) => ctx.db.riskTags.some((r) => r.id === t && r.companyId === ctx.company.id && r.specialist))) e.push('Riesgos de alcance especializado (construcción, espacios confinados…): fuera del alcance inicial; requieren un circuito aprobado aparte.');
  return e;
}

/** Employees assigned (now) to a worksite. */
export function employeesAt(ctx: Ctx, worksiteId: ID): ID[] {
  return ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active' && assignmentOn(ctx.db, e.id, ctx.today)?.worksiteIds.includes(worksiteId)).map((e) => e.id);
}

/** Opens delta reviews for employees whose requirements change because of a worksite update. */
function worksiteDeltas(ctx: Ctx, tx: Tx, worksiteId: ID, reason: string): number {
  const after = snap(tx);
  let n = 0;
  for (const id of employeesAt(ctx, worksiteId)) {
    const a = assignmentOn(ctx.db, id, ctx.today)!;
    const shape = { jobRoleId: a.jobRoleId, departmentId: a.departmentId, worksiteIds: a.worksiteIds };
    const delta = diffItems(buildItems(ctx.db, ctx.company.id, id, shape, { date: ctx.today, alertDays: alertDays(ctx) }), buildItems(after, ctx.company.id, id, { ...shape, worksiteIds: after.worksites.find((w) => w.id === worksiteId)?.active ? shape.worksiteIds : shape.worksiteIds.filter((w) => w !== worksiteId) }, { date: ctx.today, alertDays: alertDays(ctx) }));
    if (!delta.newlyRequired.length && !delta.noLongerApplicable.length) continue;
    n++;
    tx.insert('changes', { id: newId('chg'), companyId: ctx.company.id, employeeId: id, trigger: 'worksite_change', focusWorksiteIds: [worksiteId], before: shape, after: shape, effectiveFrom: ctx.today, reason, delta, status: 'pending_review', createdBy: ctx.user.id, createdAt: nowInstant(), reviewedBy: null, reviewedAt: null, reviewNote: null });
  }
  return n;
}

export async function saveWorksite(input: WorksiteInput, id?: ID, reason = ''): Promise<{ worksite: Worksite; reviews: number }> {
  await latency(300);
  const ctx = getCtx();
  requirePerm(ctx, 'worksites.manage');
  const errors = validateWorksite(ctx, input);
  const existing = id ? ownCompany(ctx, ctx.db.worksites.find((w) => w.id === id)) : null;
  const riskChanged = !!existing && [...existing.riskTags].sort().join() !== [...input.riskTags].sort().join();
  if (existing && (riskChanged || existing.activities !== input.activities) && !reason.trim()) errors.push('Indique el motivo del cambio de riesgos o actividades (se revisarán los requisitos del personal asignado).');
  if (errors.length) throw new BusinessRuleError('Revise el centro', errors);
  const count = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id).length;
  const now = nowInstant();
  const row: Worksite = existing ? { ...existing, ...input, updatedAt: now } : { id: newId('ws'), companyId: ctx.company.id, code: `CT-${String(count + 1).padStart(2, '0')}`, active: true, updatedAt: now, ...input };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (existing) tx.update('worksites', row.id, row);
    else tx.insert('worksites', row);
    const reviews = existing && riskChanged ? worksiteDeltas(ctx, tx, row.id, `Cambio de riesgos del centro: ${reason.trim()}`) : 0;
    tx.audit({
      action: existing ? 'worksite.update' : 'worksite.create',
      entityType: 'worksite',
      entityId: row.id,
      entityLabel: `${row.code} · ${row.name}`,
      summary: existing ? `Centro modificado${reviews ? `; ${reviews} revisiones de requisitos abiertas` : ''}.` : 'Centro creado.',
      reason: reason.trim() || null,
      changes: existing ? [{ field: 'Riesgos', before: riskLabels(ctx, existing.riskTags), after: riskLabels(ctx, row.riskTags) }, { field: 'Actividades', before: existing.activities, after: row.activities }].filter((c) => c.before !== c.after) : [],
    });
    if (reviews) tx.notify({ type: 'change.review', title: 'Cambio en un centro: revisar requisitos', body: `${row.name} · ${reviews} personas`, recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today), ctx.user.id), link: `/centros/${row.id}`, dedupeKey: `ws-chg:${row.id}:${now}` });
    if (existing) auditReadinessChanges(tx, ctx, employeesAt(ctx, row.id), `cambio en ${row.name}`);
    return { worksite: row, reviews };
  });
}

export async function setWorksiteActive(id: ID, active: boolean, reason: string): Promise<{ reviews: number }> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'worksites.manage');
  const w = ownCompany(ctx, ctx.db.worksites.find((x) => x.id === id));
  if (w.active === active) throw new BusinessRuleError(active ? 'El centro ya está activo.' : 'El centro ya está inactivo.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  const people = employeesAt(ctx, w.id);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('worksites', w.id, { active, updatedAt: nowInstant() });
    const reviews = worksiteDeltas(ctx, tx, w.id, `${active ? 'Reactivación' : 'Desactivación'} del centro: ${reason.trim()}`);
    tx.audit({ action: active ? 'worksite.activate' : 'worksite.deactivate', entityType: 'worksite', entityId: w.id, entityLabel: `${w.code} · ${w.name}`, summary: `${active ? 'Centro reactivado' : 'Centro desactivado'}; ${people.length} personas asignadas, ${reviews} revisiones de requisitos abiertas. El historial se conserva.`, reason: reason.trim() });
    auditReadinessChanges(tx, ctx, people, `${w.name} ${active ? 'reactivado' : 'desactivado'}`);
    return { reviews };
  });
}

// ─────────────────────────────── Readiness decisions ───────────────────────────────

export async function confirmReady(employeeId: ID, worksiteId: ID, note: string): Promise<ReadinessDecision> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'readiness.decide');
  requireEmployeeVisible(ctx, employeeId);
  if (ctx.employee?.id === employeeId) throw new PermissionError('No puede confirmar su propia asignación.');
  const r = readinessFor(ctx.db, ctx.company.id, employeeId, worksiteId, ctx.today, alertDays(ctx));
  if (!assignmentOn(ctx.db, employeeId, ctx.today)?.worksiteIds.includes(worksiteId)) throw new NotFoundError();
  if (r.state !== 'ready') throw new BusinessRuleError(`No se puede marcar como lista: ${READINESS[r.state].label}.`, r.reasons.filter((x) => x.state === r.state).map((x) => fillMsg(x.msg)));
  if (!note.trim()) throw new BusinessRuleError('Indique la nota de la confirmación.');
  const row: ReadinessDecision = { id: newId('rd'), companyId: ctx.company.id, employeeId, worksiteId, kind: 'confirmed_ready', templateIds: [], reason: note.trim(), compensatingMeasure: null, validUntil: null, decidedBy: ctx.user.id, decidedAt: nowInstant(), stateAtDecision: r.state, revokedAt: null };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('readinessDecisions', row);
    tx.audit({ action: 'readiness.confirm', entityType: 'readiness', entityId: `${employeeId}|${worksiteId}`, entityLabel: `${employeeName(ctx.db, employeeId)} · ${worksiteName(ctx.db, worksiteId)}`, summary: 'Asignación confirmada como lista según los requisitos configurados. No es una aprobación profesional de seguridad.', reason: row.reason, employeeId });
    tx.notify({ type: 'readiness.confirm', title: 'Asignación confirmada', body: `${employeeName(ctx.db, employeeId)} · ${worksiteName(ctx.db, worksiteId)}`, recipientUserIds: audience([managerUser(ctx.db, employeeId)], ctx.user.id), link: `/empleados/${employeeId}`, dedupeKey: `rd:${row.id}` });
    return row;
  });
}

export async function grantException(input: { employeeId: ID; worksiteId: ID; templateIds: ID[]; reason: string; compensatingMeasure: string; validUntil: ISODate }): Promise<ReadinessDecision> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'readiness.exception');
  requireEmployeeVisible(ctx, input.employeeId);
  const r = readinessFor(ctx.db, ctx.company.id, input.employeeId, input.worksiteId, ctx.today, alertDays(ctx));
  const errors: string[] = [];
  if (!input.templateIds.length) errors.push('Seleccione el requisito crítico que cubre la excepción.');
  for (const tid of input.templateIds) {
    const v = versionOn(ctx.db, tid, ctx.today);
    const item = r.items.find((i) => i.template.id === tid);
    if (!v || !item) errors.push('El requisito no aplica a esta asignación.');
    else if (!v.exceptionAllowed || v.source.kind === 'law') errors.push(`«${v.name}»: la política aprobada no permite excepciones (control obligatorio).`);
    else if (item.satisfied) errors.push(`«${v.name}»: ya está resuelto.`);
  }
  if (input.reason.trim().length < 10) errors.push('Explique el motivo (mínimo 10 caracteres).');
  if (!input.compensatingMeasure.trim()) errors.push('Indique la medida compensatoria validada.');
  const until = checkDate(errors, input.validUntil, 'Válida hasta', { required: true });
  if (until && (until < ctx.today || until > addDays(ctx.today, EXCEPTION_MAX_DAYS))) errors.push(`La excepción es temporal: como máximo ${EXCEPTION_MAX_DAYS} días.`);
  if (errors.length) throw new BusinessRuleError('No se puede registrar la excepción', errors);
  const row: ReadinessDecision = { id: newId('rd'), companyId: ctx.company.id, employeeId: input.employeeId, worksiteId: input.worksiteId, kind: 'exception', templateIds: input.templateIds, reason: input.reason.trim(), compensatingMeasure: input.compensatingMeasure.trim(), validUntil: until, decidedBy: ctx.user.id, decidedAt: nowInstant(), stateAtDecision: r.state, revokedAt: null };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('readinessDecisions', row);
    tx.audit({ action: 'readiness.exception', entityType: 'readiness', entityId: `${input.employeeId}|${input.worksiteId}`, entityLabel: `${employeeName(ctx.db, input.employeeId)} · ${worksiteName(ctx.db, input.worksiteId)}`, summary: `Excepción autorizada hasta ${until} con medida compensatoria: ${row.compensatingMeasure}`, reason: row.reason, employeeId: input.employeeId });
    tx.notify({ type: 'readiness.exception', title: 'Excepción autorizada', body: `${employeeName(ctx.db, input.employeeId)} · ${worksiteName(ctx.db, input.worksiteId)} hasta ${until}`, recipientUserIds: audience([managerUser(ctx.db, input.employeeId), ...usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today)], ctx.user.id), link: `/empleados/${input.employeeId}`, dedupeKey: `rdx:${row.id}` });
    auditReadinessChanges(tx, ctx, [input.employeeId], 'excepción autorizada');
    return row;
  });
}

export async function revokeDecision(id: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  const d = ownCompany(ctx, ctx.db.readinessDecisions.find((x) => x.id === id));
  requirePerm(ctx, d.kind === 'exception' ? 'readiness.exception' : 'readiness.decide');
  if (d.revokedAt) throw new BusinessRuleError('La decisión ya está revocada.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('readinessDecisions', d.id, { revokedAt: nowInstant() });
    tx.audit({ action: 'readiness.exception_revoke', entityType: 'readiness', entityId: `${d.employeeId}|${d.worksiteId}`, entityLabel: `${employeeName(ctx.db, d.employeeId)} · ${worksiteName(ctx.db, d.worksiteId)}`, summary: d.kind === 'exception' ? 'Excepción revocada.' : 'Confirmación revocada.', reason: reason.trim(), employeeId: d.employeeId });
    auditReadinessChanges(tx, ctx, [d.employeeId], 'decisión revocada');
  });
}

export const changesFor = (ctx: Ctx, employeeId: ID) => (can(ctx, 'employees.view_all') || can(ctx, 'team.view') || ctx.employee?.id === employeeId ? ctx.db.changes.filter((c) => c.companyId === ctx.company.id && c.employeeId === employeeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []);
