/**
 * Requirement templates and policies (PRL-01, PRL-02, PLT-07).
 *
 * - Versions are effective-dated and never retroactive; an approved version closes the previous
 *   one the day before it takes effect, and history is kept.
 * - Mandatory, critical, exception-capable and health-related versions need professional
 *   approval (four-eyes: never by their author). Only a professional approver can set
 *   "critical" or "exception allowed"; an ordinary administrator's draft cannot.
 * - Health-related requirements can only be approved by the medical provider, and a mandatory
 *   one needs an LPRL art. 22.1 ground, the representatives' prior report and a professional
 *   reference. An administrator cannot invent a mandatory medical-fitness rule.
 */
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { REQUIREMENT_TYPE } from '../domain/status';
import { affectedBy, latestVersion, versionOn, versionsOf, isApproved } from '../domain/requirements';
import { addDays, nowInstant } from '../domain/time';
import { newId } from '../domain/ids';
import type { ApplicabilityDecision, ID, ISODate, RequirementAssignment, RequirementTemplate, RequirementVersion } from '../domain/types';
import { transact, type Tx } from '../store/db';
import { auditReadinessChanges, audience, checkDate, employeeUser, usersWithRole } from './common';
import { alertDays, can, canReviewAuthority, employeeName, getCtx, latency, ownCompany, requirePerm, type Ctx } from './context';

export type VersionInput = Pick<
  RequirementVersion,
  | 'name'
  | 'description'
  | 'purpose'
  | 'category'
  | 'evidenceMode'
  | 'requirementType'
  | 'scope'
  | 'perWorksite'
  | 'source'
  | 'applicabilityNote'
  | 'reviewAuthority'
  | 'responsibleReviewer'
  | 'evidenceRequired'
  | 'expiryRule'
  | 'reviewRule'
  | 'policyReviewDate'
  | 'courseId'
  | 'equipmentItemId'
  | 'instructionDocumentId'
  | 'health'
  | 'effectiveFrom'
  | 'changeReason'
  | 'invalidatesPriorEvidence'
> & { critical?: boolean; exceptionAllowed?: boolean };

/** Whether a version needs a professional approval before it can take effect. */
export function needsProfessionalApproval(v: Pick<RequirementVersion, 'requirementType' | 'critical' | 'category' | 'exceptionAllowed' | 'evidenceMode'>): boolean {
  return v.requirementType === 'mandatory_policy' || v.critical || v.exceptionAllowed || v.category === 'health_surveillance' || v.evidenceMode === 'health';
}

const isHealth = (v: Pick<RequirementVersion, 'category' | 'evidenceMode'>) => v.category === 'health_surveillance' || v.evidenceMode === 'health';

/** The approval permission a version requires. */
export function approvalPermission(v: Pick<RequirementVersion, 'category' | 'evidenceMode'>) {
  return isHealth(v) ? ('requirements.approve_health' as const) : ('requirements.approve_professional' as const);
}

export function validateVersion(ctx: Ctx, input: VersionInput, opts: { forApproval?: boolean } = {}): string[] {
  const e: string[] = [];
  if (!input.name.trim()) e.push('Nombre: obligatorio.');
  if (!input.evidenceRequired.trim()) e.push('Evidencia requerida: obligatoria.');
  if (!input.source.label.trim()) e.push('Fuente o referencia: obligatoria (norma, evaluación, criterio del proveedor o requisito del cliente).');
  if (!input.applicabilityNote.trim()) e.push('Explicación de la aplicabilidad: obligatoria.');
  const s = input.scope;
  if (!s.appliesToAll && !s.jobRoleIds.length && !s.worksiteIds.length && !s.riskTags.length && !s.employeeIds.length) e.push('Ámbito: indique puestos, centros, riesgos o empleados, o marque «toda la plantilla».');
  const from = checkDate(e, input.effectiveFrom, 'Fecha de efecto', { required: true });
  if (from && from < ctx.today) e.push('La fecha de efecto no puede ser anterior a hoy: los cambios de política no son retroactivos.');
  checkDate(e, input.policyReviewDate, 'Fecha de revisión de la política');
  if (input.evidenceMode === 'training' && !input.courseId) e.push('Requisito de formación: vincule un curso del catálogo.');
  if (input.evidenceMode === 'ppe_issue' && !input.equipmentItemId) e.push('Requisito de EPI: vincule un equipo del catálogo.');
  if (input.evidenceMode === 'acknowledgement' && !input.instructionDocumentId) e.push('Requisito de confirmación: vincule el documento de información o instrucciones.');
  if (input.reviewRule.kind === 'interval' && (!input.reviewRule.months || input.reviewRule.months <= 0 || !input.reviewRule.setBy?.trim())) e.push('Periodicidad de revisión: indique los meses y quién la fijó (proveedor o profesional). No se aplican periodicidades por defecto.');
  if (isHealth(input)) {
    if (input.evidenceMode !== 'health') e.push('La vigilancia de la salud se registra como oferta y conclusión en el área restringida (modo «salud»).');
    if (input.reviewAuthority !== 'provider_medical') e.push('La autoridad de revisión de un requisito de salud es el servicio médico.');
    if (input.health?.kind === 'mandatory_exception' && opts.forApproval) {
      if (!input.health.exceptionGround) e.push('Reconocimiento obligatorio: indique el supuesto del art. 22.1 LPRL.');
      if (!input.health.representativesReportOn) e.push('Reconocimiento obligatorio: falta la fecha del informe previo de la representación (art. 22.1 LPRL).');
      if (!input.health.professionalReference?.trim()) e.push('Reconocimiento obligatorio: falta la referencia de la decisión profesional.');
    }
  } else if (input.evidenceMode === 'health') e.push('El modo «salud» solo se usa en requisitos de vigilancia de la salud.');
  return e;
}

const INPUT_KEYS = ['name', 'description', 'purpose', 'category', 'evidenceMode', 'requirementType', 'scope', 'perWorksite', 'source', 'applicabilityNote', 'reviewAuthority', 'responsibleReviewer', 'evidenceRequired', 'expiryRule', 'reviewRule', 'policyReviewDate', 'courseId', 'equipmentItemId', 'instructionDocumentId', 'health', 'effectiveFrom', 'changeReason', 'invalidatesPriorEvidence'] as const;

/** Only the editable fields: ids, status and approval data never come from the caller. */
function pickInput(input: VersionInput): Omit<VersionInput, 'critical' | 'exceptionAllowed'> {
  return Object.fromEntries(INPUT_KEYS.map((k) => [k, input[k]])) as Omit<VersionInput, 'critical' | 'exceptionAllowed'>;
}

function buildVersion(ctx: Ctx, templateId: ID, n: number, input: VersionInput): RequirementVersion {
  const professional = can(ctx, 'requirements.approve_professional') || can(ctx, 'requirements.approve_health');
  return {
    id: newId('rqv'),
    companyId: ctx.company.id,
    templateId,
    version: n,
    ...pickInput(input),
    // Critical / exception flags only from a professional approver (never from an admin's free text).
    critical: professional ? !!input.critical : false,
    exceptionAllowed: professional ? !!input.exceptionAllowed : false,
    effectiveTo: null,
    status: 'draft',
    createdBy: ctx.user.id,
    createdAt: nowInstant(),
    approvedBy: null,
    approvedAt: null,
    approvalNote: null,
  };
}

export async function createTemplate(input: VersionInput): Promise<{ template: RequirementTemplate; version: RequirementVersion }> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.draft', 'requirements.manage');
  const errors = validateVersion(ctx, input);
  if (errors.length) throw new BusinessRuleError('Revise el requisito', errors);
  const count = ctx.db.templates.filter((t) => t.companyId === ctx.company.id).length;
  const template: RequirementTemplate = { id: newId('tpl'), companyId: ctx.company.id, code: `REQ-${String(count + 1).padStart(3, '0')}`, createdAt: nowInstant(), createdBy: ctx.user.id, retiredAt: null };
  const version = buildVersion(ctx, template.id, 1, input);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('templates', template);
    tx.insert('versions', version);
    tx.audit({ action: 'requirement.create', entityType: 'requirement', entityId: template.id, entityLabel: `${template.code} · ${version.name}`, summary: `Borrador creado: ${REQUIREMENT_TYPE[version.requirementType].label}.`, version: 'v1', reason: version.changeReason || null });
    return { template, version };
  });
}

/** Edits a draft (or a version whose approval was rejected). Approved versions are never edited. */
export async function updateDraft(versionId: ID, input: VersionInput): Promise<RequirementVersion> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.draft', 'requirements.manage');
  const v = ownCompany(ctx, ctx.db.versions.find((x) => x.id === versionId));
  if (v.status !== 'draft' && v.status !== 'rejected') throw new BusinessRuleError('Solo se editan borradores. Para cambiar una versión aprobada, cree una nueva versión.');
  const errors = validateVersion(ctx, input);
  if (errors.length) throw new BusinessRuleError('Revise el requisito', errors);
  const t = ctx.db.templates.find((x) => x.id === v.templateId)!;
  const next = buildVersion(ctx, v.templateId, v.version, input);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const updated = tx.update('versions', v.id, { ...next, id: v.id, createdBy: v.createdBy, createdAt: v.createdAt, status: 'draft' });
    tx.audit({ action: 'requirement.version', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${updated.name}`, summary: 'Borrador modificado.', version: `v${v.version}` });
    return updated;
  });
}

/** Starts a new draft version from the latest one (the approved history is untouched). */
export async function newVersion(templateId: ID, input: VersionInput): Promise<RequirementVersion> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.draft', 'requirements.manage');
  const t = ownCompany(ctx, ctx.db.templates.find((x) => x.id === templateId));
  if (t.retiredAt) throw new BusinessRuleError('El requisito está retirado.');
  const last = latestVersion(ctx.db, t.id);
  if (last && (last.status === 'draft' || last.status === 'pending_approval')) throw new BusinessRuleError('Ya hay una versión en borrador o pendiente de aprobación.');
  if (!input.changeReason.trim()) throw new BusinessRuleError('Indique el motivo del cambio de versión.');
  const errors = validateVersion(ctx, input);
  if (errors.length) throw new BusinessRuleError('Revise el requisito', errors);
  const v = buildVersion(ctx, t.id, (last?.version ?? 0) + 1, input);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('versions', v);
    tx.audit({ action: 'requirement.version', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${v.name}`, summary: `Nueva versión en borrador (v${v.version}).`, version: `v${v.version}`, reason: v.changeReason });
    return v;
  });
}

export async function submitForApproval(versionId: ID): Promise<RequirementVersion> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.draft', 'requirements.manage');
  const v = ownCompany(ctx, ctx.db.versions.find((x) => x.id === versionId));
  if (v.status !== 'draft' && v.status !== 'rejected') throw new BusinessRuleError('Solo se envían borradores.');
  const t = ctx.db.templates.find((x) => x.id === v.templateId)!;
  const approverRoles = isHealth(v) ? (['provider_medical'] as const) : (['provider_technical'] as const);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('versions', v.id, { status: 'pending_approval' });
    tx.audit({ action: 'requirement.submit', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${v.name}`, summary: isHealth(v) ? 'Enviado al servicio médico para su aprobación.' : 'Enviado al servicio de prevención para su aprobación.', version: `v${v.version}` });
    tx.notify({ type: 'requirement.submit', title: 'Requisito pendiente de aprobación profesional', body: v.name, recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, [...approverRoles], ctx.today), ctx.user.id), link: `/requisitos/${t.id}`, dedupeKey: `rq-submit:${v.id}` });
    return u;
  });
}

function closePrevious(ctx: Ctx, templateId: ID, newFrom: ISODate, tx: Tx) {
  for (const p of versionsOf(ctx.db, templateId)) {
    if (!isApproved(p) || p.status === 'retired') continue;
    if (p.effectiveTo && p.effectiveTo < newFrom) continue;
    const to = addDays(newFrom, -1);
    tx.update('versions', p.id, { effectiveTo: to, status: newFrom <= ctx.today ? 'superseded' : p.status });
  }
}

export interface ApprovalInput {
  critical: boolean;
  exceptionAllowed: boolean;
  note: string;
  policyReviewDate: ISODate | null;
}

/** Professional approval: the approver sets "critical" and "exception allowed" and takes responsibility. */
export async function approveVersion(versionId: ID, input: ApprovalInput): Promise<RequirementVersion> {
  await latency();
  const ctx = getCtx();
  const v = ownCompany(ctx, ctx.db.versions.find((x) => x.id === versionId));
  const perm = approvalPermission(v);
  if (!can(ctx, perm)) throw new PermissionError(isHealth(v) ? 'Solo el servicio médico puede aprobar requisitos de vigilancia de la salud.' : 'Solo un profesional del servicio de prevención puede aprobar este requisito.');
  if (v.status !== 'pending_approval') throw new BusinessRuleError('La versión no está pendiente de aprobación.');
  if (v.createdBy === ctx.user.id) throw new PermissionError('Quien redactó la versión no puede aprobarla (doble control).');
  if (!input.note.trim()) throw new BusinessRuleError('Indique la base profesional de la aprobación.');
  const errors = validateVersion(ctx, { ...v, critical: input.critical, exceptionAllowed: input.exceptionAllowed }, { forApproval: true });
  if (v.effectiveFrom < ctx.today) errors.push('La fecha de efecto ya ha pasado: cree una nueva versión con una fecha igual o posterior a hoy.');
  if (input.exceptionAllowed && v.source.kind === 'law') errors.push('Un control exigido por una norma no admite excepciones de rutina.');
  if (errors.length) throw new BusinessRuleError('No se puede aprobar', errors);
  const t = ctx.db.templates.find((x) => x.id === v.templateId)!;
  const affected = affectedBy(ctx.db, ctx.company.id, t.id, ctx.today, alertDays(ctx)).map((i) => i.employeeId);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    closePrevious(ctx, t.id, v.effectiveFrom, tx);
    const u = tx.update('versions', v.id, { status: 'active', critical: input.critical, exceptionAllowed: input.exceptionAllowed, approvedBy: ctx.user.id, approvedAt: nowInstant(), approvalNote: input.note.trim(), policyReviewDate: input.policyReviewDate });
    tx.audit({
      action: 'requirement.approve',
      entityType: 'requirement',
      entityId: t.id,
      entityLabel: `${t.code} · ${v.name}`,
      summary: `Aprobada la versión ${v.version} con efecto ${v.effectiveFrom}. Crítico: ${input.critical ? 'sí' : 'no'}. Excepción validada: ${input.exceptionAllowed ? 'sí' : 'no'}.`,
      version: `v${v.version}`,
      reason: input.note.trim(),
    });
    tx.notify({ type: 'requirement.approve', title: 'Requisito aprobado', body: `${t.code} · ${v.name} (v${v.version})`, recipientUserIds: audience([v.createdBy, ...usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today)], ctx.user.id), link: `/requisitos/${t.id}`, dedupeKey: `rq-approve:${v.id}` });
    const now = affectedBy({ ...tx.db }, ctx.company.id, t.id, ctx.today, alertDays(ctx)).map((i) => i.employeeId);
    auditReadinessChanges(tx, ctx, [...affected, ...now], `${t.code} v${v.version} aprobada`);
    return u;
  });
}

export async function rejectApproval(versionId: ID, reason: string): Promise<RequirementVersion> {
  await latency();
  const ctx = getCtx();
  const v = ownCompany(ctx, ctx.db.versions.find((x) => x.id === versionId));
  if (!can(ctx, approvalPermission(v))) throw new PermissionError();
  if (v.status !== 'pending_approval') throw new BusinessRuleError('La versión no está pendiente de aprobación.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  const t = ctx.db.templates.find((x) => x.id === v.templateId)!;
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('versions', v.id, { status: 'rejected', approvalNote: reason.trim() });
    tx.audit({ action: 'requirement.reject', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${v.name}`, summary: 'Aprobación rechazada; la versión no produce efectos.', version: `v${v.version}`, reason: reason.trim() });
    tx.notify({ type: 'requirement.reject', title: 'Aprobación de requisito rechazada', body: `${t.code} · ${v.name}`, recipientUserIds: audience([v.createdBy], ctx.user.id), link: `/requisitos/${t.id}`, dedupeKey: `rq-reject:${v.id}` });
    return u;
  });
}

/** Activates a version that does not need professional approval (optional / not applicable, non-health). */
export async function activateVersion(versionId: ID): Promise<RequirementVersion> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.manage');
  const v = ownCompany(ctx, ctx.db.versions.find((x) => x.id === versionId));
  if (v.status !== 'draft') throw new BusinessRuleError('Solo se activan borradores.');
  if (needsProfessionalApproval(v)) throw new BusinessRuleError('Este requisito necesita la aprobación de un profesional antes de aplicarse.', ['Envíelo a aprobación: los requisitos obligatorios, críticos o de salud no se activan directamente.']);
  const errors = validateVersion(ctx, v);
  if (errors.length) throw new BusinessRuleError('Revise el requisito', errors);
  const t = ctx.db.templates.find((x) => x.id === v.templateId)!;
  return transact(ctx.actor, ctx.company.id, (tx) => {
    closePrevious(ctx, t.id, v.effectiveFrom, tx);
    const u = tx.update('versions', v.id, { status: 'active', approvedBy: ctx.user.id, approvedAt: nowInstant(), approvalNote: 'Activado por la coordinación (sin aprobación profesional requerida).' });
    tx.audit({ action: 'requirement.activate', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${v.name}`, summary: `Versión ${v.version} activada con efecto ${v.effectiveFrom} (${REQUIREMENT_TYPE[v.requirementType].label}).`, version: `v${v.version}` });
    return u;
  });
}

export async function retireTemplate(templateId: ID, effectiveTo: ISODate, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.manage', 'requirements.approve_professional', 'requirements.approve_health');
  const t = ownCompany(ctx, ctx.db.templates.find((x) => x.id === templateId));
  const current = versionOn(ctx.db, t.id, ctx.today) ?? versionsOf(ctx.db, t.id).filter(isApproved).pop();
  if (!current) throw new BusinessRuleError('El requisito no tiene versiones aprobadas: elimine el borrador desde su versión.');
  if (needsProfessionalApproval(current) && !can(ctx, approvalPermission(current))) throw new PermissionError('Retirar un requisito obligatorio, crítico o de salud requiere la decisión de un profesional.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo de la retirada.');
  if (!effectiveTo || effectiveTo < addDays(ctx.today, -1)) throw new BusinessRuleError('La retirada no puede ser retroactiva: elija hoy o una fecha posterior.');
  const affected = affectedBy(ctx.db, ctx.company.id, t.id, ctx.today, alertDays(ctx)).map((i) => i.employeeId);
  transact(ctx.actor, ctx.company.id, (tx) => {
    for (const v of versionsOf(ctx.db, t.id)) {
      if (!isApproved(v) || (v.effectiveTo && v.effectiveTo <= effectiveTo)) continue;
      if (v.effectiveFrom > effectiveTo) tx.update('versions', v.id, { status: 'retired', effectiveTo: addDays(v.effectiveFrom, -1) });
      else tx.update('versions', v.id, { status: 'retired', effectiveTo });
    }
    tx.update('templates', t.id, { retiredAt: nowInstant(), retireReason: reason.trim() });
    tx.audit({ action: 'requirement.retire', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${current.name}`, summary: `Retirado con efecto ${effectiveTo}. El historial y las evidencias se conservan.`, reason: reason.trim(), version: `v${current.version}` });
    auditReadinessChanges(tx, ctx, affected, `${t.code} retirado`);
  });
}

/** Assigns an approved template to an employee, role or worksite (effective-dated, audited). */
export async function assignTemplate(templateId: ID, target: RequirementAssignment['target'], effectiveFrom: ISODate, reason: string): Promise<RequirementAssignment> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.assign');
  const t = ownCompany(ctx, ctx.db.templates.find((x) => x.id === templateId));
  const v = versionOn(ctx.db, t.id, ctx.today) ?? versionsOf(ctx.db, t.id).find((x) => isApproved(x) && x.status !== 'retired' && x.effectiveFrom > ctx.today);
  if (!v || t.retiredAt) throw new BusinessRuleError('Solo se asignan requisitos aprobados y vigentes.');
  const errors: string[] = [];
  const from = checkDate(errors, effectiveFrom, 'Fecha de efecto', { required: true });
  if (from && from < ctx.today) errors.push('La asignación no puede ser retroactiva.');
  if (!reason.trim()) errors.push('Motivo: obligatorio.');
  const exists = target.kind === 'employee' ? ctx.db.employees.find((e) => e.id === target.id && e.companyId === ctx.company.id) : target.kind === 'role' ? ctx.db.jobRoles.find((r) => r.id === target.id && r.companyId === ctx.company.id) : ctx.db.worksites.find((w) => w.id === target.id && w.companyId === ctx.company.id);
  if (!exists) throw new NotFoundError();
  if (ctx.db.requirementAssignments.some((a) => a.templateId === t.id && a.target.kind === target.kind && a.target.id === target.id && !a.effectiveTo)) errors.push('Ya existe una asignación vigente para este destino.');
  if (errors.length) throw new BusinessRuleError('Revise la asignación', errors);
  const row: RequirementAssignment = { id: newId('rqa'), companyId: ctx.company.id, templateId: t.id, target, effectiveFrom: from!, effectiveTo: null, reason: reason.trim(), assignedBy: ctx.user.id, assignedAt: nowInstant(), endedBy: null, endReason: null };
  const label = target.kind === 'employee' ? employeeName(ctx.db, target.id) : target.kind === 'role' ? ctx.db.jobRoles.find((r) => r.id === target.id)!.name : ctx.db.worksites.find((w) => w.id === target.id)!.name;
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('requirementAssignments', row);
    tx.audit({ action: 'requirement.assign', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${v.name}`, summary: `Asignado a ${label} desde ${row.effectiveFrom}.`, reason: row.reason, version: `v${v.version}`, employeeId: target.kind === 'employee' ? target.id : null });
    const now = affectedBy({ ...tx.db }, ctx.company.id, t.id, ctx.today, alertDays(ctx)).map((i) => i.employeeId);
    auditReadinessChanges(tx, ctx, now, `${t.code} asignado`);
    for (const id of new Set(now)) tx.notify({ type: 'requirement.assign', title: 'Nuevo requisito asignado', body: v.name, recipientUserIds: audience([employeeUser(ctx.db, id)], ctx.user.id), link: '/mis-tareas', dedupeKey: `rq-assign:${row.id}:${id}` });
    return row;
  });
}

/** Ending an assignment reduces requirements: coordination or a professional must decide it. */
export async function endAssignment(assignmentId: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'requirements.manage', 'requirements.approve_professional');
  const a = ownCompany(ctx, ctx.db.requirementAssignments.find((x) => x.id === assignmentId));
  if (a.effectiveTo) throw new BusinessRuleError('La asignación ya está finalizada.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  const t = ctx.db.templates.find((x) => x.id === a.templateId)!;
  const affected = affectedBy(ctx.db, ctx.company.id, t.id, ctx.today, alertDays(ctx)).map((i) => i.employeeId);
  // Ends yesterday, so it no longer applies today. One that starts today or later is cancelled (end before start).
  const cancelled = a.effectiveFrom >= ctx.today;
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('requirementAssignments', a.id, { effectiveTo: addDays(ctx.today, -1), endedBy: ctx.user.id, endReason: reason.trim() });
    tx.audit({ action: 'requirement.unassign', entityType: 'requirement', entityId: t.id, entityLabel: t.code, summary: cancelled ? 'Asignación cancelada antes de surtir efecto; las evidencias se conservan.' : 'Asignación finalizada; las evidencias se conservan.', reason: reason.trim(), employeeId: a.target.kind === 'employee' ? a.target.id : null });
    auditReadinessChanges(tx, ctx, affected, `${t.code}: asignación finalizada`);
  });
}

/** An authorised reviewer marks a requirement as not applicable to one employee, with reason. */
export async function markNotApplicable(templateId: ID, employeeId: ID, worksiteId: ID | null, reason: string): Promise<ApplicabilityDecision> {
  await latency();
  const ctx = getCtx();
  const t = ownCompany(ctx, ctx.db.templates.find((x) => x.id === templateId));
  const v = versionOn(ctx.db, t.id, ctx.today);
  if (!v) throw new BusinessRuleError('El requisito no tiene una versión vigente.');
  const allowed = canReviewAuthority(ctx, v.reviewAuthority, employeeId) || can(ctx, approvalPermission(v));
  if (!allowed) throw new PermissionError('Solo la autoridad de revisión del requisito puede marcarlo como no aplicable.');
  if (reason.trim().length < 10) throw new BusinessRuleError('Explique por qué no aplica (mínimo 10 caracteres).');
  if (ctx.db.applicability.some((d) => d.templateId === t.id && d.employeeId === employeeId && (d.worksiteId ?? null) === worksiteId && !d.revokedAt)) throw new BusinessRuleError('Ya existe una decisión de no aplicabilidad vigente.');
  const row: ApplicabilityDecision = { id: newId('apd'), companyId: ctx.company.id, templateId: t.id, employeeId, worksiteId, decision: 'not_applicable', reason: reason.trim(), decidedBy: ctx.user.id, decidedAt: nowInstant(), revokedAt: null, revokedBy: null };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('applicability', row);
    tx.audit({ action: 'requirement.not_applicable', entityType: 'requirement', entityId: t.id, entityLabel: `${t.code} · ${v.name}`, summary: `No aplicable a ${employeeName(ctx.db, employeeId)}.`, reason: row.reason, employeeId, restricted: v.category === 'health_surveillance', version: `v${v.version}` });
    auditReadinessChanges(tx, ctx, [employeeId], `${t.code} no aplicable`);
    return row;
  });
}

export async function revokeNotApplicable(decisionId: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  const d = ownCompany(ctx, ctx.db.applicability.find((x) => x.id === decisionId));
  const v = versionOn(ctx.db, d.templateId, ctx.today);
  if (!v || !(canReviewAuthority(ctx, v.reviewAuthority, d.employeeId) || can(ctx, approvalPermission(v)))) throw new PermissionError();
  if (d.revokedAt) throw new BusinessRuleError('La decisión ya está revocada.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('applicability', d.id, { revokedAt: nowInstant(), revokedBy: ctx.user.id });
    tx.audit({ action: 'requirement.applicable_again', entityType: 'requirement', entityId: d.templateId, entityLabel: v.name, summary: `Vuelve a aplicarse a ${employeeName(ctx.db, d.employeeId)}.`, reason: reason.trim(), employeeId: d.employeeId });
    auditReadinessChanges(tx, ctx, [d.employeeId], 'decisión de no aplicabilidad revocada');
  });
}

/** Templates with their current, latest and pending versions (requirement catalogue). */
export function templateRows(ctx: Ctx) {
  if (!can(ctx, 'requirements.view')) return [];
  return ctx.db.templates
    .filter((t) => t.companyId === ctx.company.id)
    .map((t) => {
      const versions = versionsOf(ctx.db, t.id);
      const current = versionOn(ctx.db, t.id, ctx.today) ?? null;
      const latest = versions[versions.length - 1] ?? null;
      const pending = versions.find((v) => v.status === 'pending_approval') ?? null;
      const scheduled = versions.find((v) => isApproved(v) && v.status !== 'retired' && v.effectiveFrom > ctx.today) ?? null;
      return { template: t, current, latest, pending, scheduled, display: current ?? latest!, versions };
    });
}
