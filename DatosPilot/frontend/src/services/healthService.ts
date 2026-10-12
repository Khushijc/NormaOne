/**
 * Restricted health area (LPRL art. 22; GDPR art. 9; PRL-04, AC-PRL-03).
 *
 * - The portal stores only: offers, the worker's response, and the minimum fitness conclusion
 *   (apto / apto con medidas / no apto) with operational measures. No diagnoses, no clinical
 *   reports: the clinical record stays with the medical service (external reference only).
 * - A voluntary offer may be declined; a decline is not non-compliance. A mandatory examination
 *   exists only when an approved requirement records an art. 22.1 exception.
 * - Every denied attempt to open restricted content is audited (restricted event).
 */
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { versionOn } from '../domain/requirements';
import { nowInstant } from '../domain/time';
import { newId } from '../domain/ids';
import type { FitnessConclusion, HealthConclusion, HealthOffer, ID, ISODate } from '../domain/types';
import { transact } from '../store/db';
import { auditReadinessChanges, audience, checkDate, usersWithRole } from './common';
import { can, canSeeEmployee, canSeeHealth, employeeName, getCtx, latency, ownCompany, requireEmployeeVisible, type Ctx } from './context';

/** Suppresses duplicate denial events from React double effects (same user + resource within 2 s). */
const recent = new Map<string, number>();

/** Audits a denied attempt to open restricted health content. Never throws. */
export function recordDeniedAccess(resource: string, employeeId: ID | null = null): void {
  const ctx = getCtx();
  const key = `${ctx.user.id}|${ctx.company.id}|${resource}`;
  const t = Date.now();
  if ((recent.get(key) ?? 0) > t - 2000) return;
  recent.set(key, t);
  try {
    transact(ctx.actor, ctx.company.id, (tx) => {
      tx.audit({ action: 'health.access_denied', entityType: 'health', entityId: employeeId ?? 'area', entityLabel: 'Área restringida de salud', summary: `Acceso denegado: ${resource}.`, employeeId, restricted: true });
      tx.notify({ type: 'health.denied', title: 'Intento de acceso a contenido restringido', body: `${ctx.user.name}: ${resource}`, recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, ['provider_medical'], ctx.today)), link: '/auditoria?restringido=1', dedupeKey: `deny:${key}:${t}` });
    });
  } catch {
    /* storage full: the denial itself still applies */
  }
}

function requireHealth(ctx: Ctx, manage: boolean, resource: string, employeeId: ID | null = null) {
  const ok = manage ? can(ctx, 'health.manage') : canSeeHealth(ctx);
  if (!ok) {
    recordDeniedAccess(resource, employeeId);
    throw new PermissionError('Contenido restringido: no autorizado para su rol. El intento queda registrado.');
  }
}

/** Opening the area is logged once per user and day (access to restricted data, BRD SEC-04). */
export function logAreaView(): void {
  const ctx = getCtx();
  if (!canSeeHealth(ctx)) return;
  const key = `view|${ctx.user.id}|${ctx.company.id}|${ctx.today}`;
  if (recent.has(key)) return;
  recent.set(key, Date.now());
  if (ctx.db.audit.some((e) => e.companyId === ctx.company.id && e.action === 'health.view' && e.actor.userId === ctx.user.id && e.at.slice(0, 10) === ctx.today)) return;
  try {
    transact(ctx.actor, ctx.company.id, (tx) => tx.audit({ action: 'health.view', entityType: 'health', entityId: 'area', entityLabel: 'Área restringida de salud', summary: 'Consulta del área restringida (primer acceso del día).', restricted: true }));
  } catch {
    /* ignore */
  }
}

export function healthRows(ctx: Ctx) {
  if (!canSeeHealth(ctx)) return [];
  return ctx.db.employees
    .filter((e) => e.companyId === ctx.company.id && e.status === 'active' && canSeeEmployee(ctx, e.id))
    .map((e) => {
      const offers = ctx.db.healthOffers.filter((o) => o.employeeId === e.id).sort((a, b) => b.offeredAt.localeCompare(a.offeredAt));
      const conclusions = ctx.db.healthConclusions.filter((c) => c.employeeId === e.id).sort((a, b) => b.conclusionDate.localeCompare(a.conclusionDate));
      return { employee: e, offer: offers[0] ?? null, offers, conclusion: conclusions.find((c) => c.status === 'current') ?? null, conclusions };
    });
}

export async function recordOffer(input: { employeeId: ID; templateId: ID | null; basis: HealthOffer['basis']; offeredAt: ISODate }): Promise<HealthOffer> {
  await latency();
  const ctx = getCtx();
  requireHealth(ctx, false, 'Registrar oferta de vigilancia de la salud', input.employeeId);
  requireEmployeeVisible(ctx, input.employeeId);
  const errors: string[] = [];
  const d = checkDate(errors, input.offeredAt, 'Fecha de la oferta', { required: true });
  if (d && d > ctx.today) errors.push('La fecha de la oferta no puede ser futura.');
  if (input.basis === 'mandatory_exception') {
    const v = input.templateId ? versionOn(ctx.db, input.templateId, ctx.today) : undefined;
    if (!v || v.health?.kind !== 'mandatory_exception' || v.status !== 'active') errors.push('Un reconocimiento obligatorio requiere un requisito aprobado por el servicio médico con una excepción del art. 22.1 LPRL.');
  }
  if (ctx.db.healthOffers.some((o) => o.employeeId === input.employeeId && o.response === 'pending')) errors.push('Ya hay una oferta pendiente de respuesta.');
  if (errors.length) throw new BusinessRuleError('Revise la oferta', errors);
  const row: HealthOffer = { id: newId('ho'), companyId: ctx.company.id, employeeId: input.employeeId, templateId: input.templateId, basis: input.basis, offeredAt: d!, offeredBy: ctx.user.id, response: 'pending', respondedAt: null, recordedBy: null };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('healthOffers', row);
    tx.audit({ action: 'health.offer', entityType: 'health', entityId: row.id, entityLabel: employeeName(ctx.db, input.employeeId), summary: input.basis === 'voluntary' ? 'Oferta voluntaria registrada.' : 'Reconocimiento obligatorio (excepción art. 22.1) registrado.', employeeId: input.employeeId, restricted: true });
    auditReadinessChanges(tx, ctx, [input.employeeId], 'oferta de vigilancia de la salud');
    return row;
  });
}

export async function recordResponse(offerId: ID, response: 'accepted' | 'declined', date: ISODate): Promise<HealthOffer> {
  await latency();
  const ctx = getCtx();
  const o = ownCompany(ctx, ctx.db.healthOffers.find((x) => x.id === offerId));
  requireHealth(ctx, false, 'Registrar respuesta a la oferta', o.employeeId);
  if (o.response !== 'pending') throw new BusinessRuleError('La oferta ya tiene respuesta.');
  if (response === 'declined' && o.basis === 'mandatory_exception') throw new BusinessRuleError('El reconocimiento es obligatorio por una excepción confirmada profesionalmente: la negativa debe tratarla el servicio médico, no se registra como una respuesta ordinaria.');
  const errors: string[] = [];
  const d = checkDate(errors, date, 'Fecha de la respuesta', { required: true });
  if (d && (d < o.offeredAt || d > ctx.today)) errors.push('La respuesta debe estar entre la oferta y hoy.');
  if (errors.length) throw new BusinessRuleError('Revise la respuesta', errors);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('healthOffers', o.id, { response, respondedAt: d, recordedBy: ctx.user.id });
    tx.audit({ action: 'health.response', entityType: 'health', entityId: o.id, entityLabel: employeeName(ctx.db, o.employeeId), summary: response === 'accepted' ? 'Oferta aceptada.' : 'Oferta voluntaria no aceptada (no es un incumplimiento).', employeeId: o.employeeId, restricted: true });
    auditReadinessChanges(tx, ctx, [o.employeeId], 'respuesta a la oferta');
    return u;
  });
}

export interface ConclusionInput {
  employeeId: ID;
  offerId: ID | null;
  conclusion: FitnessConclusion;
  scope: string;
  measures: string;
  conclusionDate: ISODate;
  nextReviewDate: ISODate | null;
  clinicalRecordReference: string;
}

export async function recordConclusion(input: ConclusionInput): Promise<HealthConclusion> {
  await latency();
  const ctx = getCtx();
  requireHealth(ctx, true, 'Registrar conclusión de aptitud', input.employeeId);
  requireEmployeeVisible(ctx, input.employeeId);
  const errors: string[] = [];
  const d = checkDate(errors, input.conclusionDate, 'Fecha de la conclusión', { required: true });
  if (d && d > ctx.today) errors.push('La conclusión no puede tener fecha futura.');
  const next = checkDate(errors, input.nextReviewDate, 'Próxima revisión (indicada por el servicio médico)');
  if (next && d && next <= d) errors.push('La próxima revisión debe ser posterior a la conclusión.');
  if (!input.scope.trim()) errors.push('Ámbito (puesto o tareas evaluadas): obligatorio.');
  if (input.conclusion !== 'fit' && !input.measures.trim()) errors.push('Indique las medidas preventivas o las tareas afectadas (sin diagnósticos).');
  const hit = ctx.settings.clinicalKeywords.find((k) => k && input.measures.toLowerCase().includes(k.toLowerCase()));
  if (hit || /diagn[oó]stic|patolog|enfermedad|tratamiento|medicaci/i.test(input.measures)) errors.push('Las medidas no pueden contener información clínica (diagnósticos, enfermedades o tratamientos). Describa solo la limitación operativa.');
  if (!input.clinicalRecordReference.trim()) errors.push('Referencia externa del expediente clínico: obligatoria (el informe no se guarda en el portal).');
  const offer = input.offerId ? ctx.db.healthOffers.find((o) => o.id === input.offerId && o.companyId === ctx.company.id) : undefined;
  if (input.offerId && (!offer || offer.response !== 'accepted')) errors.push('La conclusión debe corresponder a una oferta aceptada o a un reconocimiento obligatorio.');
  if (errors.length) throw new BusinessRuleError('Revise la conclusión', errors);
  const provider = ctx.membership?.providerId ?? ctx.db.providers.find((p) => p.companyId === ctx.company.id && p.specialties.includes('medicina'))?.id ?? '';
  const row: HealthConclusion = { id: newId('hc'), companyId: ctx.company.id, employeeId: input.employeeId, offerId: input.offerId, providerId: provider, scope: input.scope.trim(), conclusion: input.conclusion, measures: input.measures.trim(), conclusionDate: d!, nextReviewDate: next, clinicalRecordReference: input.clinicalRecordReference.trim(), recordedBy: ctx.user.id, recordedAt: nowInstant(), measuresConfirmedAt: null, measuresConfirmedBy: null, status: 'current' };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    for (const c of ctx.db.healthConclusions) if (c.employeeId === input.employeeId && c.status === 'current') tx.update('healthConclusions', c.id, { status: 'superseded' });
    tx.insert('healthConclusions', row);
    tx.audit({ action: 'health.conclusion', entityType: 'health', entityId: row.id, entityLabel: employeeName(ctx.db, input.employeeId), summary: 'Conclusión de aptitud registrada (sin datos clínicos).', employeeId: input.employeeId, restricted: true });
    if (input.conclusion !== 'fit') tx.notify({ type: 'health.measures', title: 'Conclusión con medidas o restricciones', body: `${employeeName(ctx.db, input.employeeId)}: revise el área restringida.`, recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today), ctx.user.id), link: `/salud?empleado=${input.employeeId}`, dedupeKey: `hc:${row.id}` });
    auditReadinessChanges(tx, ctx, [input.employeeId], 'conclusión del servicio médico');
    return row;
  });
}

/** The coordinator confirms that the operational measures have been put in place. */
export async function confirmMeasures(conclusionId: ID, note: string): Promise<HealthConclusion> {
  await latency();
  const ctx = getCtx();
  const c = ownCompany(ctx, ctx.db.healthConclusions.find((x) => x.id === conclusionId));
  requireHealth(ctx, false, 'Confirmar medidas preventivas', c.employeeId);
  if (c.conclusion !== 'fit_with_measures' || c.status !== 'current') throw new BusinessRuleError('Solo se confirman medidas de una conclusión vigente «apto con medidas».');
  if (c.measuresConfirmedAt) throw new BusinessRuleError('Las medidas ya constan como aplicadas.');
  if (!note.trim()) throw new BusinessRuleError('Describa cómo se han aplicado las medidas.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('healthConclusions', c.id, { measuresConfirmedAt: nowInstant(), measuresConfirmedBy: ctx.user.id });
    tx.audit({ action: 'health.measures_confirmed', entityType: 'health', entityId: c.id, entityLabel: employeeName(ctx.db, c.employeeId), summary: 'Medidas preventivas aplicadas.', reason: note.trim(), employeeId: c.employeeId, restricted: true });
    auditReadinessChanges(tx, ctx, [c.employeeId], 'medidas preventivas aplicadas');
    return u;
  });
}

/**
 * "Open the clinical attachment": the portal never holds it. Unauthorised users are denied and
 * audited (AC-PRL-03); medical staff get the external custody reference.
 */
export async function openClinicalAttachment(employeeId: ID): Promise<string> {
  await latency(100);
  const ctx = getCtx();
  if (!can(ctx, 'health.manage')) {
    recordDeniedAccess(`Documento clínico de ${employeeName(ctx.db, employeeId)}`, employeeId);
    throw new PermissionError('Documento clínico no disponible para su rol. El intento queda registrado.');
  }
  const c = ctx.db.healthConclusions.find((x) => x.employeeId === employeeId && x.companyId === ctx.company.id && x.status === 'current');
  if (!c) throw new NotFoundError();
  transact(ctx.actor, ctx.company.id, (tx) => tx.audit({ action: 'health.view', entityType: 'health', entityId: c.id, entityLabel: employeeName(ctx.db, employeeId), summary: 'Consulta de la referencia del expediente clínico externo.', employeeId, restricted: true }));
  return c.clinicalRecordReference;
}

export async function handleQuarantine(id: ID, action: 'returned_to_provider' | 'file_removed', note: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requireHealth(ctx, true, 'Gestionar documento en cuarentena');
  const q = ownCompany(ctx, ctx.db.quarantine.find((x) => x.id === id));
  if (q.status !== 'quarantined') throw new BusinessRuleError('El documento ya se ha gestionado.');
  if (!note.trim()) throw new BusinessRuleError('Indique una nota de gestión.');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('quarantine', q.id, { status: action, handledBy: ctx.user.id, handledAt: nowInstant(), note: note.trim() });
    // The misplaced clinical file is removed from the portal; the metadata of the event is kept.
    tx.update('docVersions', q.documentVersionId, { file: null, notes: action === 'returned_to_provider' ? 'Archivo devuelto al servicio médico y retirado del portal.' : 'Archivo retirado del portal por el servicio médico.' });
    tx.audit({ action: 'quarantine.handle', entityType: 'document', entityId: q.documentId, entityLabel: 'Documento en cuarentena', summary: action === 'returned_to_provider' ? 'Devuelto al servicio médico; archivo retirado del portal.' : 'Archivo retirado del portal.', reason: note.trim(), restricted: true });
  });
}

export function quarantineRows(ctx: Ctx) {
  if (!can(ctx, 'health.manage')) return [];
  return ctx.db.quarantine.filter((q) => q.companyId === ctx.company.id).map((q) => ({ q, doc: ctx.db.documents.find((d) => d.id === q.documentId)!, version: ctx.db.docVersions.find((v) => v.id === q.documentVersionId)! }));
}
