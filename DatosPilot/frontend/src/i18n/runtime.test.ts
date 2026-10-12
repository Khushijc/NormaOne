/**
 * Runtime-generated text must have an English rendering. Records stay in Spanish; this checks
 * that t() can display each of them in English: status labels and helps, roles, audit labels,
 * exception and readiness messages, seeded and newly generated audit summaries and notifications,
 * the error messages that services raise in common workflows, and the reference data that
 * i18n/localizeDb translates for display. Proper names (people, companies, customer sites) are
 * deliberately left untranslated and excluded below.
 * Run alone with: npx vitest run src/i18n
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasEnglish, setLangForTests } from './index';
import { AUDIT_ACTION_LABEL } from '../domain/audit';
import { detectExceptions, EXCEPTION_TYPE_LABEL } from '../domain/exceptions';
import { AUTHORITY_LABEL, ROLES } from '../domain/permissions';
import { allReadiness, maskItem, matrixFor } from '../domain/requirements';
import * as STATUS from '../domain/status';
import { setClock } from '../domain/time';
import type { Msg } from '../domain/types';
import { getDb, initDatabase, resetDemoData, setSession } from '../store/db';
import { getCtx } from '../services/context';
import { createCase, recordExchange, recordExchangeStep, reviewExchange, createShareLink, revokeShareLink, simulateLinkAccess, shareableVersions, closeCase, updateCase, addParticipant } from '../services/caeService';
import { acknowledgeDocument, acknowledgeIssue, cancelRequest, decideDocument, downloadDocument, requestEvidence, startReview, submitDocument, updateDates, type SubmitInput } from '../services/evidenceService';
import { confirmMeasures, handleQuarantine, openClinicalAttachment, recordConclusion, recordDeniedAccess, recordOffer, recordResponse, logAreaView } from '../services/healthService';
import { ACTION_LABEL, myTasks, revokeMembership, saveJobRole, switchIdentity, updateException, updateSettings, visibleExceptions } from '../services/opsService';
import { changeAssignment, confirmReady, grantException, revokeDecision, reviewChange, saveWorksite, setWorksiteActive, updateEmployee } from '../services/peopleService';
import { createExport, EMPTY_FILTERS, EXPORT_NOTICE, REPORTS, runReport } from '../services/reportService';
import { activateVersion, approveVersion, assignTemplate, createTemplate, endAssignment, markNotApplicable, newVersion, rejectApproval, retireTemplate, revokeNotApplicable, submitForApproval, updateDraft, type VersionInput } from '../services/requirementService';
import { addProgress, assignAction, createAction, markAssessmentForReview, registerAssessment, reopenAction, reviewAction, reviewAssessment, submitAction, submitAssessment } from '../services/safetyService';
import { assignTraining, cancelTraining, closeIssue, issueEquipment, recordAttendance, recordCompletion, saveCourse, saveEquipment, scheduleTraining } from '../services/trainingService';

const TODAY = '2026-10-12';
const LEV = 'cmp_levante';

const out = new Map<string, string>();
const add = (where: string, s: string | null | undefined) => {
  if (s && s.trim() && /\p{L}{2,}/u.test(s)) out.set(s, where);
};
const addMsg = (where: string, m: Msg | null | undefined) => {
  if (!m) return;
  add(where, m.text);
  for (const v of Object.values(m.params ?? {})) if (typeof v === 'string') addValue(`${where} (param)`, v);
};
const tryCall = async (where: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    const raw = e as { message?: string; details?: string[] };
    add(`${where} (error)`, raw.message);
    (raw.details ?? []).forEach((x) => add(`${where} (detail)`, x));
  }
};
const as = (userId: string, companyId = LEV) => setSession({ userId, companyId });

/** Proper names stay untranslated: people, companies, customer sites, providers, participants. */
const PROPER = new Set<string>();
function collectProperNames() {
  const db = getDb();
  db.users.forEach((u) => [u.name, u.organisation].forEach((s) => s && PROPER.add(s)));
  db.employees.forEach((e) => PROPER.add(`${e.firstName} ${e.lastName}`));
  db.companies.forEach((c) => [c.legalName, c.tradeName].forEach((s) => PROPER.add(s)));
  db.customers.forEach((c) => [c.name, c.contactName].forEach((s) => PROPER.add(s)));
  db.worksites.filter((w) => w.kind === 'customer').forEach((w) => PROPER.add(w.name));
  db.worksites.forEach((w) => PROPER.add(w.siteContactName));
  db.providers.forEach((p) => [p.name, p.contactName].forEach((s) => PROPER.add(s)));
  db.caeCases.forEach((c) => c.participants.forEach((p) => [p.organisation, p.contactName].forEach((s) => PROPER.add(s))));
  db.caeExchanges.forEach((x) => x.receiptConfirmedBy && PROPER.add(x.receiptConfirmedBy));
  // Provider and issuer names written as plain organisation names.
  ['Prevención Albufera, S.L.', 'Formación Segura Turia, S.L.', 'Sistema (carga de demostración)', 'Rafael Soler', 'Toni Vives', 'Jorge Sanz Albert (Prevención Albufera)'].forEach((s) => PROPER.add(s));
}
/** Values that are not language: names, dates, codes, numbers, identifiers. */
/** Free text typed by this test into the service calls (user data: never translated). */
const TYPED = new Set([
  'Requisito de prueba', 'Reconocimiento médico obligatorio', 'Formación obligatoria de prueba', 'PVD Marta', 'Auxilios Marta', 'Informe médico', 'Documento', 'Altura Óscar', 'Certificado',
  'Curso de prueba', 'Curso de prueba (editado)', 'Equipo de prueba', 'Evaluación de prueba', 'Revisar extintor del almacén', 'Foto extintor', 'Coordinación de prueba', 'Relación de personal asignado',
  'Planificación', 'Instrucciones del titular', 'Plan de emergencia', 'Almacén auxiliar', 'Almacén', 'Mozo/a de almacén', 'Duplicado', 'Trabajo acompañado del operador del titular', 'Operador acreditado del titular',
  'Cambio de productos en la cocina del hotel.', 'Falta el plano del local.', 'Correcta.', 'Nueva versión aceptada.', 'Ya no se usa', 'Fin de la prueba', 'Asignación de prueba', 'Nuevo curso',
  'Curso de primeros auxilios', 'Ya no es necesaria', 'Correcto', 'Certificado ilegible', 'Fechas confirmadas con el emisor', 'Convocatoria de otoño', 'Curso aplazado por el proveedor', 'Roto en el centro', 'Cambio de puesto',
  'Contenido', 'Editado', 'Oficina', 'Fatiga visual', 'Pausas', 'Limpieza', 'Política interna', 'Personal de oficina.', 'Coordinación', 'Evitar cargas de más de 10 kg.', 'Puesto actual', 'Puesto', 'HCL-DANIELA', 'Aplicadas con ayudas mecánicas.',
  'Nuevo contrato Nou Campus', 'Promoción a técnico', 'Revisado; se solicitan los nuevos requisitos.', 'Limpieza de la cubierta incluida en el contrato', 'Nueva actividad', 'Fin del contrato', 'Contrato renovado', 'Matriz revisada.', 'Cambio de funciones', 'El operador ya no está disponible',
  'Evaluación ER-002 revisada', 'Carga y descarga.', 'Limpieza de oficinas, zonas comunes y locales de clientes.', 'Revisar esta semana', 'En análisis', 'Resuelto', 'Vuelve a aparecer', 'Asignada', 'informe médico', 'Cliente', 'Falta la etiqueta de revisión.', 'Etiqueta añadida', 'Comprobado', 'El extintor vuelve a estar descargado.',
  'Visita del mantenedor', 'Contactado el mantenedor', 'Revisado por el mantenedor', 'Falta el informe previo de la representación.', 'No trabaja en altura según la visita técnica.', 'Vuelve a trabajar en altura.', 'Falta el plan de emergencia.', 'Fin del intercambio', 'Fin de la concurrencia', 'Devuelto al servicio médico.', 'Retirado.',
]);
const isNotText = (s: string) =>
  PROPER.has(s) ||
  TYPED.has(s) ||
  // "<code> <typed title>", "<code> · <typed title> (vN)"
  TYPED.has(s.replace(/ \(v\d+\)$/, '').replace(/^[A-Z]{2,5}(-[A-Z]{2,5})?-\d{2,4}( · | )/, '')) ||
  /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(s) ||
  /^[A-Z]{2,5}(-[A-Z]{2,5})?-\d{2,4}$/.test(s) ||
  /^v\d+$/.test(s) ||
  /^[\d\s.,/:%€-]+$/.test(s) ||
  /^[a-z_]+(, [a-z_]+)*$/.test(s) ||
  s.split(/, | · | → /).every((p) => PROPER.has(p) || TYPED.has(p) || p === '—' || /^[A-Z]{2,5}(-[A-Z]{2,5})?-\d{2,4}( v\d+)?$/.test(p) || /^[a-z]+_[a-z0-9]+$/.test(p));
const addValue = (where: string, s: string | null | undefined) => {
  if (s && !isNotText(s)) add(where, s);
};

const docInput = (p: Partial<SubmitInput>): SubmitInput => ({ categoryId: 'cert_formacion', title: 'Certificado', issuer: 'Formación Segura Turia, S.L.', issueDate: '2026-10-05', expiryMode: 'none', legalExpiryDate: null, providerReviewDate: null, internalFollowUpDate: null, file: { name: 'certificado.pdf', size: 1200, type: 'application/pdf', dataUrl: null }, containsClinical: false, sourceReference: '', notes: '', ...p });

const versionInput = (p: Partial<VersionInput> = {}): VersionInput => ({
  name: 'Requisito de prueba',
  description: '',
  purpose: '',
  category: 'training',
  evidenceMode: 'document',
  requirementType: 'optional',
  scope: { jobRoleIds: ['jr_admin'], worksiteIds: [], riskTags: [], employeeIds: [], appliesToAll: false },
  perWorksite: false,
  source: { kind: 'internal_policy', label: 'Política interna', url: null, assessmentId: null },
  applicabilityNote: 'Personal de oficina.',
  reviewAuthority: 'coordinator',
  responsibleReviewer: 'Coordinación',
  evidenceRequired: 'Certificado',
  expiryRule: 'none',
  reviewRule: { kind: 'none', months: null, setBy: null },
  policyReviewDate: null,
  courseId: null,
  equipmentItemId: null,
  instructionDocumentId: null,
  health: null,
  effectiveFrom: TODAY,
  changeReason: 'Versión inicial',
  invalidatesPriorEvidence: false,
  ...p,
});

async function exerciseRequirements() {
  as('usr_javier');
  await tryCall('createTemplate', () => createTemplate(versionInput({ name: '', evidenceRequired: '', source: { kind: 'law', label: '', url: null, assessmentId: null }, applicabilityNote: '', scope: { jobRoleIds: [], worksiteIds: [], riskTags: [], employeeIds: [], appliesToAll: false }, effectiveFrom: '2026-01-01', evidenceMode: 'training', policyReviewDate: 'x' })));
  await tryCall('createTemplate', () => createTemplate(versionInput({ evidenceMode: 'ppe_issue', reviewRule: { kind: 'interval', months: null, setBy: null } })));
  await tryCall('createTemplate', () => createTemplate(versionInput({ evidenceMode: 'acknowledgement' })));
  await tryCall('createTemplate', () => createTemplate(versionInput({ category: 'health_surveillance', evidenceMode: 'document', reviewAuthority: 'coordinator' })));
  await tryCall('createTemplate', () => createTemplate(versionInput({ evidenceMode: 'health' })));
  const health = await createTemplate(versionInput({ name: 'Reconocimiento médico obligatorio', category: 'health_surveillance', evidenceMode: 'health', requirementType: 'mandatory_policy', reviewAuthority: 'provider_medical', health: { kind: 'mandatory_exception', exceptionGround: null, representativesReportOn: null, professionalReference: null } }));
  await tryCall('activateVersion', () => activateVersion(health.version.id));
  await tryCall('approveVersion', () => approveVersion(health.version.id, { critical: false, exceptionAllowed: false, note: 'x', policyReviewDate: null }));
  await submitForApproval(health.version.id);
  as('usr_jorge');
  await tryCall('approveVersion', () => approveVersion(health.version.id, { critical: false, exceptionAllowed: false, note: 'x', policyReviewDate: null }));
  as('usr_clara');
  await tryCall('approveVersion', () => approveVersion(health.version.id, { critical: false, exceptionAllowed: false, note: '', policyReviewDate: null }));
  await tryCall('approveVersion', () => approveVersion(health.version.id, { critical: false, exceptionAllowed: true, note: 'Revisado', policyReviewDate: null }));
  await rejectApproval(health.version.id, 'Falta el informe previo de la representación.');
  await tryCall('rejectApproval', () => rejectApproval(health.version.id, ''));

  as('usr_marina');
  const opt = await createTemplate(versionInput());
  await updateDraft(opt.version.id, versionInput({ description: 'Editado' }));
  await activateVersion(opt.version.id);
  await tryCall('updateDraft', () => updateDraft(opt.version.id, versionInput()));
  await tryCall('activateVersion', () => activateVersion(opt.version.id));
  await tryCall('submitForApproval', () => submitForApproval(opt.version.id));
  await tryCall('newVersion', () => newVersion(opt.template.id, versionInput({ changeReason: '' })));
  await newVersion(opt.template.id, versionInput({ effectiveFrom: '2026-11-01', changeReason: 'Nuevo curso' }));
  await tryCall('newVersion', () => newVersion(opt.template.id, versionInput({ changeReason: 'Otra' })));
  const asg = await assignTemplate(opt.template.id, { kind: 'employee', id: 'emp_marta' }, TODAY, 'Asignación de prueba');
  await assignTemplate(opt.template.id, { kind: 'role', id: 'jr_admin' }, TODAY, 'Asignación de prueba');
  await assignTemplate(opt.template.id, { kind: 'worksite', id: 'ws_oficina' }, TODAY, 'Asignación de prueba');
  await tryCall('assignTemplate', () => assignTemplate(opt.template.id, { kind: 'employee', id: 'emp_marta' }, '2026-01-01', ''));
  await endAssignment(asg.id, 'Fin de la prueba');
  await tryCall('endAssignment', () => endAssignment(asg.id, 'x'));
  await tryCall('endAssignment', () => endAssignment(getDb().requirementAssignments.find((a) => !a.effectiveTo)!.id, ''));
  await tryCall('retireTemplate', () => retireTemplate(opt.template.id, TODAY, ''));
  await tryCall('retireTemplate', () => retireTemplate(opt.template.id, '2026-01-01', 'Prueba'));
  await retireTemplate(opt.template.id, TODAY, 'Ya no se usa');
  await tryCall('newVersion', () => newVersion(opt.template.id, versionInput({ changeReason: 'x' })));
  await tryCall('assignTemplate', () => assignTemplate(opt.template.id, { kind: 'employee', id: 'emp_marta' }, TODAY, 'x'));

  // Professional approval of a mandatory version (with readiness changes).
  const mand = await createTemplate(versionInput({ name: 'Formación obligatoria de prueba', requirementType: 'mandatory_policy', source: { kind: 'law', label: 'Ley 31/1995 (LPRL), art. 19', url: null, assessmentId: null } }));
  await submitForApproval(mand.version.id);
  as('usr_jorge');
  await tryCall('approveVersion', () => approveVersion(mand.version.id, { critical: true, exceptionAllowed: true, note: 'Base', policyReviewDate: null }));
  await approveVersion(mand.version.id, { critical: true, exceptionAllowed: false, note: 'Conforme a la evaluación', policyReviewDate: null });
  await tryCall('approveVersion', () => approveVersion(mand.version.id, { critical: true, exceptionAllowed: false, note: 'x', policyReviewDate: null }));
  await tryCall('retireTemplate', () => retireTemplate('tpl_anual_medico', TODAY, 'x'));
  as('usr_marina');
  await tryCall('retireTemplate', () => retireTemplate(mand.template.id, TODAY, 'x'));
  await tryCall('markNotApplicable', () => markNotApplicable('tpl_altura', 'emp_pablo', null, 'x'));
  as('usr_jorge');
  await tryCall('markNotApplicable', () => markNotApplicable('tpl_altura', 'emp_pablo', null, 'corto'));
  const na = await markNotApplicable('tpl_altura', 'emp_pablo', null, 'No trabaja en altura según la visita técnica.');
  await tryCall('markNotApplicable', () => markNotApplicable('tpl_altura', 'emp_pablo', null, 'No trabaja en altura según la visita técnica.'));
  await tryCall('revokeNotApplicable', () => revokeNotApplicable(na.id, ''));
  await revokeNotApplicable(na.id, 'Vuelve a trabajar en altura.');
  await tryCall('revokeNotApplicable', () => revokeNotApplicable(na.id, 'x'));
  await tryCall('markNotApplicable', () => markNotApplicable('tpl_vs_altura', 'emp_pablo', null, 'Sin versión vigente'));
}

async function exerciseEvidence() {
  as('usr_marina');
  await tryCall('requestEvidence', () => requestEvidence({ employeeId: 'emp_ivan', templateId: 'tpl_prl_inicial', followUpDate: '2026-01-01', note: '' }));
  await tryCall('requestEvidence', () => requestEvidence({ employeeId: 'emp_ivan', templateId: 'tpl_vs_altura', followUpDate: null, note: '' }));
  const rq = await requestEvidence({ employeeId: 'emp_marta', templateId: 'tpl_auxilios', followUpDate: '2026-10-20', note: 'Curso de primeros auxilios' });
  await requestEvidence({ employeeId: 'emp_marta', templateId: 'tpl_pvd', followUpDate: null, note: '' });
  await tryCall('cancelRequest', () => cancelRequest(rq.id, ''));
  await cancelRequest(rq.id, 'Ya no es necesaria');
  await tryCall('cancelRequest', () => cancelRequest(rq.id, 'x'));
  as('usr_javier');
  await tryCall('submitDocument', () => submitDocument(docInput({ title: '', issuer: '', categoryId: 'nope', issueDate: '2027-01-01', expiryMode: 'date', legalExpiryDate: '2026-01-01', providerReviewDate: 'mal', internalFollowUpDate: 'mal', file: { name: 'x.pdf', size: 20 * 1024 * 1024, type: 'application/pdf', dataUrl: null } })));
  await tryCall('submitDocument', () => submitDocument(docInput({ employeeId: 'emp_pablo', templateId: 'tpl_vs_oferta' })));
  await tryCall('submitDocument', () => submitDocument(docInput({ employeeId: 'emp_pablo', templateId: 'tpl_calzado' })));
  await tryCall('submitDocument', () => submitDocument(docInput({ employeeId: 'emp_pablo', templateId: 'tpl_vs_altura' })));
  await tryCall('submitDocument', () => submitDocument(docInput({ employeeId: 'emp_pablo', templateId: 'tpl_info_tec' })));
  const a = await submitDocument(docInput({ employeeId: 'emp_marta', templateId: 'tpl_pvd', title: 'PVD Marta' }));
  const b = await submitDocument(docInput({ employeeId: 'emp_marta', templateId: 'tpl_auxilios', title: 'Auxilios Marta' }));
  await submitDocument(docInput({ documentId: b.document.id, title: 'Auxilios Marta', file: null }));
  await submitDocument(docInput({ employeeId: 'emp_rocio', title: 'Informe médico', categoryId: 'otros' }));
  await submitDocument(docInput({ employeeId: 'emp_rocio', title: 'Documento', categoryId: 'otros', containsClinical: true }));
  as('usr_marina');
  await startReview(a.version.id);
  await tryCall('startReview', () => startReview(a.version.id));
  await tryCall('decideDocument', () => decideDocument(a.version.id, 'reject', { note: '' }));
  await decideDocument(a.version.id, 'accept', { note: 'Correcto' });
  await tryCall('decideDocument', () => decideDocument(a.version.id, 'accept', { note: 'x' }));
  await decideDocument(b.version.id, 'reject', { note: '', rejectionReason: 'Certificado ilegible' });
  await tryCall('updateDates', () => updateDates(b.version.id, { expiryMode: 'none', legalExpiryDate: null, providerReviewDate: null, internalFollowUpDate: null, reason: 'x' }));
  await tryCall('updateDates', () => updateDates(a.version.id, { expiryMode: 'date', legalExpiryDate: null, providerReviewDate: 'mal', internalFollowUpDate: null, reason: '' }));
  await updateDates(a.version.id, { expiryMode: 'date', legalExpiryDate: '2027-10-01', providerReviewDate: '2027-04-01', internalFollowUpDate: '2027-03-01', reason: 'Fechas confirmadas con el emisor' });
  await downloadDocument(a.version.id);
  const b2 = getDb().docVersions.find((v) => v.documentId === b.document.id && v.version === 2)!;
  await tryCall('downloadDocument', () => downloadDocument(b2.id));
  await tryCall('downloadDocument', () => downloadDocument(getDb().docVersions.find((v) => v.documentId === 'doc_q_rocio')!.id));
  // Provider-set review interval (computed review date note).
  const alt = await submitDocument(docInput({ employeeId: 'emp_oscar', templateId: 'tpl_altura', title: 'Altura Óscar' }));
  as('usr_jorge');
  await decideDocument(alt.version.id, 'accept', { note: 'ok' });
  await decideDocument(getDb().docVersions.find((v) => v.documentId === 'doc_altura_oscar' && v.status === 'received')!.id, 'reject', { note: '', rejectionReason: 'Duplicado' });
  // Acknowledgements.
  as('usr_pablo');
  await tryCall('acknowledgeDocument', () => acknowledgeDocument('doc_info_tec'));
  await tryCall('acknowledgeDocument', () => acknowledgeDocument('doc_delitos_pablo'));
  as('usr_marina');
  await acknowledgeDocument('doc_info_tec', 'emp_ivan');
  await tryCall('acknowledgeDocument', () => acknowledgeDocument('doc_info_tec', 'emp_ivan'));
  as('usr_laura');
  await tryCall('acknowledgeDocument', () => acknowledgeDocument('doc_info_tec'));
  as('usr_javier');
  const raulCalzado = getDb().issues.find((i) => i.employeeId === 'emp_raul' && i.itemId === 'eq_calzado')!;
  await acknowledgeIssue(raulCalzado.id, 'emp_raul');
  await tryCall('acknowledgeIssue', () => acknowledgeIssue(raulCalzado.id, 'emp_raul'));
  await tryCall('acknowledgeIssue', () => acknowledgeIssue(getDb().issues.find((i) => i.status === 'lost')!.id, 'emp_daniela'));
  as('usr_sergio');
  const sergioIssue = getDb().issues.find((i) => i.employeeId === 'emp_ivan' && i.itemId === 'eq_casco')!;
  await tryCall('acknowledgeIssue', () => acknowledgeIssue(sergioIssue.id));
}

async function exerciseTrainingAndPpe() {
  as('usr_marina');
  const course = { title: 'Curso de prueba', providerName: 'Formación Segura Turia, S.L.', modality: 'presencial' as const, durationHours: 4, contentSummary: 'Contenido', riskTags: [], refresher: { kind: 'none' as const, months: null, setBy: null } };
  await tryCall('saveCourse', () => saveCourse({ ...course, title: '', providerName: '', durationHours: 500, refresher: { kind: 'interval', months: null, setBy: null } }));
  const c = await saveCourse(course);
  await saveCourse({ ...course, title: 'Curso de prueba (editado)' }, c.id);
  await tryCall('assignTraining', () => assignTraining({ employeeId: 'emp_marta', courseId: c.id, templateId: null, scheduledDate: '2026-01-01', note: '' }));
  const tr = await assignTraining({ employeeId: 'emp_marta', courseId: c.id, templateId: null, scheduledDate: null, note: '' });
  await tryCall('assignTraining', () => assignTraining({ employeeId: 'emp_marta', courseId: c.id, templateId: null, scheduledDate: null, note: '' }));
  await tryCall('scheduleTraining', () => scheduleTraining(tr.id, '2026-01-01'));
  await scheduleTraining(tr.id, '2026-10-12');
  await tryCall('recordCompletion', () => recordCompletion(tr.id, TODAY, 2));
  await tryCall('recordAttendance', () => recordAttendance(tr.id, '2027-01-01'));
  await recordAttendance(tr.id, TODAY);
  await tryCall('recordAttendance', () => recordAttendance(tr.id, TODAY));
  await tryCall('scheduleTraining', () => scheduleTraining(tr.id, TODAY));
  await tryCall('recordCompletion', () => recordCompletion(tr.id, '2027-01-01', 900));
  await recordCompletion(tr.id, TODAY, 4);
  await tryCall('cancelTraining', () => cancelTraining(tr.id, 'x'));
  const tr2 = await assignTraining({ employeeId: 'emp_javier', courseId: c.id, templateId: null, scheduledDate: '2026-10-20', note: 'Convocatoria de otoño' });
  await tryCall('cancelTraining', () => cancelTraining(tr2.id, ''));
  await cancelTraining(tr2.id, 'Curso aplazado por el proveedor');
  const eq = { name: 'Equipo de prueba', type: 'Protección de manos', description: '', jobRoleIds: [], riskTags: [], worksiteIds: [], replacement: { kind: 'none' as const, months: null, setBy: null }, identifierRequired: true };
  await tryCall('saveEquipment', () => saveEquipment({ ...eq, name: '', type: '', replacement: { kind: 'interval', months: null, setBy: null } }));
  const item = await saveEquipment(eq);
  await saveEquipment({ ...eq, description: 'Editado' }, item.id);
  await tryCall('issueEquipment', () => issueEquipment({ employeeId: 'emp_marta', itemId: 'nope', identifier: '', size: '', worksiteId: null, issuedAt: '2027-01-01', replacementDue: '2026-01-01', note: '' }));
  await tryCall('issueEquipment', () => issueEquipment({ employeeId: 'emp_marta', itemId: item.id, identifier: '', size: '', worksiteId: null, issuedAt: TODAY, replacementDue: '2026-01-01', note: '' }));
  const iss = await issueEquipment({ employeeId: 'emp_marta', itemId: item.id, identifier: 'L-001', size: 'M', worksiteId: null, issuedAt: TODAY, replacementDue: null, note: '' });
  const iss2 = await issueEquipment({ employeeId: 'emp_marta', itemId: item.id, identifier: 'L-002', size: 'M', worksiteId: null, issuedAt: TODAY, replacementDue: null, note: '' }, iss.id);
  await tryCall('issueEquipment', () => issueEquipment({ employeeId: 'emp_marta', itemId: item.id, identifier: 'L-003', size: 'M', worksiteId: null, issuedAt: TODAY, replacementDue: null, note: '' }, iss.id));
  await tryCall('closeIssue', () => closeIssue(iss.id, 'returned', TODAY, 'x'));
  await tryCall('closeIssue', () => closeIssue(iss2.id, 'returned', '2027-01-01', ''));
  await closeIssue(iss2.id, 'lost', TODAY, 'Roto en el centro');
  const iss3 = await issueEquipment({ employeeId: 'emp_javier', itemId: item.id, identifier: 'L-004', size: 'L', worksiteId: null, issuedAt: TODAY, replacementDue: null, note: '' });
  await closeIssue(iss3.id, 'returned', TODAY, 'Cambio de puesto');
}

async function exerciseSafety() {
  as('usr_marina');
  const base = { title: 'Evaluación de prueba', worksiteId: 'ws_oficina', activity: 'Oficina', jobRoleIds: [], providerId: 'prv_albufera', assessorName: 'Jorge Sanz Albert', issueDate: '2026-10-01', effectiveDate: null, reviewDate: null, hazards: [{ id: '', riskTag: 'pvd', description: 'Fatiga visual', measures: 'Pausas' }], preventiveMeasures: '', documentId: null, linkedTemplateIds: [], ownerUserId: 'usr_marina' };
  await tryCall('registerAssessment', () => registerAssessment({ ...base, title: '', activity: '', worksiteId: null, assessorName: '', issueDate: '2027-01-01', reviewDate: '2026-01-01', hazards: [{ id: '', riskTag: 'espacio_confinado', description: '', measures: '' }] }));
  const ra = await registerAssessment(base);
  await tryCall('submitAssessment', () => submitAssessment(ra.id));
  await tryCall('registerAssessment', () => registerAssessment(base, ra.id));
  const ra2 = await registerAssessment({ ...base, documentId: 'doc_ra_003' }, 'ra_003');
  await tryCall('registerAssessment', () => registerAssessment(base, 'ra_003'));
  await tryCall('reviewAssessment', () => reviewAssessment(ra2.id, 'accept', 'x'));
  await tryCall('markAssessmentForReview', () => markAssessmentForReview('ra_004', ''));
  await markAssessmentForReview('ra_004', 'Cambio de productos en la cocina del hotel.');
  const withDoc = await registerAssessment({ ...base, documentId: 'doc_ra_003' });
  await submitAssessment(withDoc.id);
  as('usr_jorge');
  await tryCall('reviewAssessment', () => reviewAssessment(withDoc.id, 'accept', ''));
  await reviewAssessment(withDoc.id, 'start', '');
  await reviewAssessment(withDoc.id, 'return', 'Falta el plano del local.');
  await reviewAssessment('ra_005', 'accept', 'Correcta.');
  as('usr_marina');
  await submitAssessment(ra2.id);
  as('usr_jorge');
  await reviewAssessment(ra2.id, 'accept', 'Nueva versión aceptada.');

  as('usr_marina');
  const input = { title: 'Revisar extintor del almacén', description: '', source: { kind: 'review_finding' as const, refId: null, label: 'Revisión interna' }, employeeId: null, jobRoleId: null, worksiteId: 'ws_oficina', priority: 'medium' as const, requiredEvidence: 'Foto del extintor revisado', evidenceRequired: true, reviewAuthority: 'coordinator' as const, affectsReadiness: false };
  await tryCall('createAction', () => createAction({ ...input, title: '', source: { kind: 'other', refId: null, label: '' }, requiredEvidence: '', affectsReadiness: true }));
  const a = await createAction(input);
  await tryCall('addProgress', () => addProgress(a.id, 'x'));
  await tryCall('submitAction', () => submitAction(a.id, 'x'));
  await tryCall('assignAction', () => assignAction(a.id, 'usr_nadie', '2026-01-01', ''));
  await assignAction(a.id, 'usr_javier', '2026-10-30', 'Visita del mantenedor');
  await assignAction(a.id, 'usr_javier', null, '');
  as('usr_javier');
  await tryCall('addProgress', () => addProgress(a.id, ''));
  await addProgress(a.id, 'Contactado el mantenedor');
  await tryCall('submitAction', () => submitAction(a.id, ''));
  await submitDocument(docInput({ title: 'Foto extintor', categoryId: 'evidencia_accion', worksiteId: 'ws_oficina', actionId: a.id }));
  await submitAction(a.id, 'Revisado por el mantenedor');
  await tryCall('addProgress', () => addProgress(a.id, 'x'));
  await tryCall('reviewAction', () => reviewAction(a.id, 'accept', 'ok'));
  as('usr_marina');
  await tryCall('reviewAction', () => reviewAction(a.id, 'reject', ''));
  await reviewAction(a.id, 'reject', 'Falta la etiqueta de revisión.');
  as('usr_javier');
  await submitAction(a.id, 'Etiqueta añadida');
  as('usr_marina');
  await reviewAction(a.id, 'accept', 'Comprobado');
  await tryCall('addProgress', () => addProgress(a.id, 'x'));
  await tryCall('reopenAction', () => reopenAction(a.id, ''));
  await reopenAction(a.id, 'El extintor vuelve a estar descargado.');
  await tryCall('reviewAction', () => reviewAction('act_006', 'accept', 'x'));
}

async function exerciseCae() {
  as('usr_marina');
  const caseInput = { worksiteId: 'ws_cowork', title: 'Coordinación de prueba', activities: 'Limpieza', risksSummary: '', coordinationMeans: '', followUpOwnerId: 'usr_marina', nextFollowUp: '2026-10-20', openQuestions: '' };
  await tryCall('createCase', () => createCase({ ...caseInput, worksiteId: 'nope', title: '', nextFollowUp: '2026-01-01', followUpOwnerId: null }, [{ organisation: '', role: 'titular', contactName: '', contactEmail: '', isOwnCompany: true }]));
  await tryCall('createCase', () => createCase({ ...caseInput, worksiteId: 'ws_torre' }, [{ organisation: 'Cabanyal Cowork, S.L.', role: 'titular', contactName: 'Inés Valls', contactEmail: '', isOwnCompany: false }]));
  const kase = await createCase(caseInput, [{ organisation: 'Cabanyal Cowork, S.L.', role: 'titular', contactName: 'Inés Valls', contactEmail: '', isOwnCompany: false }, { organisation: 'Mantenimientos Levante, S.L.', role: 'contratista', contactName: 'Marina Peris Climent', contactEmail: '', isOwnCompany: true }]);
  await updateCase(kase.id, { ...caseInput, nextFollowUp: '2026-10-25' });
  await tryCall('addParticipant', () => addParticipant(kase.id, { organisation: '', role: 'concurrente', contactName: '', contactEmail: '' }));
  await addParticipant(kase.id, { organisation: 'Ascensores Mediterráneo, S.L.', role: 'concurrente', contactName: 'Toni Vives', contactEmail: '' });
  const own = kase.participants.find((p) => p.isOwnCompany)!.id;
  const other = kase.participants.find((p) => !p.isOwnCompany)!.id;
  await tryCall('recordExchange', () => recordExchange({ caseId: kase.id, direction: 'sent', subject: '', documentVersionId: 'dv_0001', senderParticipantId: other, recipientParticipantId: other, sentAt: '2027-01-01', followUp: '' }));
  await tryCall('recordExchange', () => recordExchange({ caseId: kase.id, direction: 'received', subject: 'x', documentVersionId: null, senderParticipantId: own, recipientParticipantId: other, sentAt: null, followUp: '' }));
  const sent = await recordExchange({ caseId: kase.id, direction: 'sent', subject: 'Relación de personal asignado', documentVersionId: null, senderParticipantId: own, recipientParticipantId: other, sentAt: null, followUp: '' });
  await tryCall('recordExchangeStep', () => recordExchangeStep(sent.id, 'receipt', { date: TODAY, confirmedBy: '' }));
  await tryCall('recordExchangeStep', () => recordExchangeStep(sent.id, 'acknowledged', { date: TODAY, confirmedBy: '' }));
  await recordExchangeStep(sent.id, 'sent', { date: TODAY, confirmedBy: '' });
  await tryCall('recordExchangeStep', () => recordExchangeStep(sent.id, 'sent', { date: '2027-01-01', confirmedBy: '' }));
  await tryCall('recordExchangeStep', () => recordExchangeStep(sent.id, 'receipt', { date: '2026-10-01', confirmedBy: '' }));
  await recordExchangeStep(sent.id, 'receipt', { date: TODAY, confirmedBy: 'Inés Valls' });
  await tryCall('recordExchangeStep', () => recordExchangeStep(sent.id, 'receipt', { date: TODAY, confirmedBy: 'Inés Valls' }));
  await recordExchangeStep(sent.id, 'acknowledged', { date: TODAY, confirmedBy: '' });
  await tryCall('recordExchangeStep', () => recordExchangeStep(sent.id, 'acknowledged', { date: TODAY, confirmedBy: '' }));
  const sent2 = await recordExchange({ caseId: kase.id, direction: 'sent', subject: 'Planificación', documentVersionId: null, senderParticipantId: own, recipientParticipantId: other, sentAt: TODAY, followUp: '' });
  void sent2;
  const rec = await recordExchange({ caseId: kase.id, direction: 'received', subject: 'Instrucciones del titular', documentVersionId: null, senderParticipantId: other, recipientParticipantId: own, sentAt: TODAY, followUp: '' });
  await tryCall('recordExchangeStep', () => recordExchangeStep(rec.id, 'sent', { date: TODAY, confirmedBy: '' }));
  await tryCall('reviewExchange', () => reviewExchange(rec.id, 'accepted', ''));
  await reviewExchange(rec.id, 'rejected', 'Falta el plan de emergencia.');
  await tryCall('reviewExchange', () => reviewExchange(rec.id, 'accepted', 'x'));
  const rec2 = await recordExchange({ caseId: kase.id, direction: 'received', subject: 'Plan de emergencia', documentVersionId: null, senderParticipantId: other, recipientParticipantId: own, sentAt: TODAY, followUp: '' });
  await reviewExchange(rec2.id, 'accepted', 'Correcto.');
  const c1 = getDb().caeCases.find((c) => c.id === 'cae_001')!;
  const allowed = shareableVersions(getCtx(), c1);
  await tryCall('createShareLink', () => createShareLink(c1.id, 'p2', [], '2027-12-01'));
  await tryCall('createShareLink', () => createShareLink(c1.id, 'p1', ['dv_nope'], '2026-10-20'));
  const link = await createShareLink(c1.id, 'p1', [allowed[0].version.id], '2026-10-20');
  await simulateLinkAccess(link.id);
  await tryCall('revokeShareLink', () => revokeShareLink(link.id, ''));
  await revokeShareLink(link.id, 'Fin del intercambio');
  await tryCall('revokeShareLink', () => revokeShareLink(link.id, 'x'));
  await tryCall('simulateLinkAccess', () => simulateLinkAccess(link.id));
  await tryCall('closeCase', () => closeCase(kase.id, ''));
  await closeCase(kase.id, 'Fin de la concurrencia');
  await tryCall('closeCase', () => closeCase(kase.id, 'x'));
  await tryCall('updateCase', () => updateCase(kase.id, caseInput));
  await tryCall('recordExchange', () => recordExchange({ caseId: kase.id, direction: 'sent', subject: 'x', documentVersionId: null, senderParticipantId: own, recipientParticipantId: other, sentAt: null, followUp: '' }));
  await tryCall('createShareLink', () => createShareLink(kase.id, other, [allowed[0].version.id], '2026-10-20'));
  as('usr_javier');
  await tryCall('reviewExchange', () => reviewExchange('x_003', 'accepted', 'x'));
}

async function exerciseHealth() {
  as('usr_elena');
  await tryCall('openClinicalAttachment', () => openClinicalAttachment('emp_raul'));
  await tryCall('recordOffer', () => recordOffer({ employeeId: 'emp_daniela', templateId: 'tpl_vs_oferta', basis: 'voluntary', offeredAt: TODAY }));
  recordDeniedAccess('Área restringida (ruta /salud)');
  as('usr_marina');
  logAreaView();
  await tryCall('recordOffer', () => recordOffer({ employeeId: 'emp_daniela', templateId: 'tpl_vs_oferta', basis: 'mandatory_exception', offeredAt: '2027-01-01' }));
  await tryCall('recordOffer', () => recordOffer({ employeeId: 'emp_andres', templateId: 'tpl_vs_oferta', basis: 'voluntary', offeredAt: TODAY }));
  const offer = await recordOffer({ employeeId: 'emp_daniela', templateId: 'tpl_vs_oferta', basis: 'voluntary', offeredAt: TODAY });
  await tryCall('recordResponse', () => recordResponse(offer.id, 'accepted', '2026-01-01'));
  await recordResponse(offer.id, 'accepted', TODAY);
  await tryCall('recordResponse', () => recordResponse(offer.id, 'declined', TODAY));
  const offer2 = await recordOffer({ employeeId: 'emp_ivan', templateId: 'tpl_vs_oferta', basis: 'voluntary', offeredAt: TODAY });
  await recordResponse(offer2.id, 'declined', TODAY);
  as('usr_clara');
  await tryCall('recordConclusion', () => recordConclusion({ employeeId: 'emp_daniela', offerId: 'ho_nope', conclusion: 'fit_with_measures', scope: '', measures: 'Diagnóstico de lumbalgia', conclusionDate: '2027-01-01', nextReviewDate: '2026-01-01', clinicalRecordReference: '' }));
  await tryCall('recordConclusion', () => recordConclusion({ employeeId: 'emp_daniela', offerId: offer.id, conclusion: 'fit_with_measures', scope: 'Puesto', measures: '', conclusionDate: TODAY, nextReviewDate: null, clinicalRecordReference: 'HCL-1' }));
  const hc = await recordConclusion({ employeeId: 'emp_daniela', offerId: offer.id, conclusion: 'fit_with_measures', scope: 'Puesto actual', measures: 'Evitar cargas de más de 10 kg.', conclusionDate: TODAY, nextReviewDate: null, clinicalRecordReference: 'HCL-DANIELA' });
  await openClinicalAttachment('emp_raul');
  as('usr_marina');
  await tryCall('confirmMeasures', () => confirmMeasures(hc.id, ''));
  await tryCall('confirmMeasures', () => confirmMeasures('hc_elena', 'x'));
  await tryCall('confirmMeasures', () => confirmMeasures(hc.id, 'Aplicadas con ayudas mecánicas.'));
  as('usr_clara');
  await tryCall('confirmMeasures', () => confirmMeasures(hc.id, 'x'));
  await tryCall('handleQuarantine', () => handleQuarantine('q_001', 'returned_to_provider', ''));
  await handleQuarantine('q_001', 'returned_to_provider', 'Devuelto al servicio médico.');
  await tryCall('handleQuarantine', () => handleQuarantine('q_001', 'file_removed', 'x'));
  const q2 = getDb().quarantine.find((q) => q.status === 'quarantined');
  if (q2) await handleQuarantine(q2.id, 'file_removed', 'Retirado.');
}

async function exercisePeople() {
  as('usr_javier');
  await tryCall('changeAssignment', () => changeAssignment('emp_teresa', { jobRoleId: 'jr_limp', departmentId: 'dep_limp', worksiteIds: ['ws_torre'] }, TODAY, 'x'));
  await tryCall('changeAssignment', () => changeAssignment('emp_pablo', { jobRoleId: 'nope', departmentId: 'nope', worksiteIds: [] }, '2026-01-01', ''));
  await tryCall('changeAssignment', () => changeAssignment('emp_pablo', { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_torre', 'ws_colegio', 'ws_oficina'] }, TODAY, 'Sin cambios'));
  await tryCall('changeAssignment', () => changeAssignment('emp_pablo', { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_torre', 'ws_nope'] }, TODAY, 'x'));
  const chg = await changeAssignment('emp_pablo', { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_torre', 'ws_colegio', 'ws_oficina', 'ws_nou'] }, TODAY, 'Nuevo contrato Nou Campus');
  await changeAssignment('emp_raul', { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_dental'] }, '2026-11-01', 'Promoción a técnico');
  await tryCall('changeAssignment', () => changeAssignment('emp_raul', { jobRoleId: 'jr_tec_inst', departmentId: 'dep_mant', worksiteIds: ['ws_dental'] }, '2026-11-02', 'Otro'));
  as('usr_marina');
  await tryCall('reviewChange', () => reviewChange(chg.id, '', true));
  await reviewChange(chg.id, 'Revisado; se solicitan los nuevos requisitos.', true);
  await tryCall('reviewChange', () => reviewChange(chg.id, 'x', false));
  as('usr_javier');
  await tryCall('updateEmployee', () => updateEmployee('emp_marta', { managerEmployeeId: 'emp_marta' }));
  await updateEmployee('emp_marta', { managerEmployeeId: 'emp_marina' });
  const w = getDb().worksites.find((x) => x.id === 'ws_torre')!;
  await tryCall('saveWorksite', () => saveWorksite({ ...w, name: '', address: '', customerId: null, coordinatorEmployeeId: 'emp_teresa', riskTags: ['obra_construccion'] }, w.id, ''));
  await tryCall('saveWorksite', () => saveWorksite({ ...w, riskTags: [...w.riskTags, 'altura'] }, w.id, ''));
  await saveWorksite({ ...w, riskTags: [...w.riskTags, 'altura'] }, w.id, 'Limpieza de la cubierta incluida en el contrato');
  const ws = await saveWorksite({ ...w, name: 'Almacén auxiliar', kind: 'own', customerId: null, riskTags: [] }, undefined, '');
  await saveWorksite({ ...ws.worksite, activities: 'Almacén' }, ws.worksite.id, 'Nueva actividad');
  await tryCall('setWorksiteActive', () => setWorksiteActive(ws.worksite.id, true, 'x'));
  await tryCall('setWorksiteActive', () => setWorksiteActive(ws.worksite.id, false, ''));
  await setWorksiteActive('ws_cowork', false, 'Fin del contrato');
  await setWorksiteActive('ws_cowork', true, 'Contrato renovado');
  as('usr_marina');
  await tryCall('confirmReady', () => confirmReady('emp_oscar', 'ws_dental', 'ok'));
  await tryCall('confirmReady', () => confirmReady('emp_marina', 'ws_oficina', 'ok'));
  await tryCall('confirmReady', () => confirmReady('emp_marta', 'ws_oficina', ''));
  const okRow = allReadiness(getDb(), LEV, TODAY, 30).find((r) => r.state === 'ready' && r.employeeId !== 'emp_marina')!;
  const ready = await confirmReady(okRow.employeeId, okRow.worksiteId, 'Matriz revisada.');
  await revokeDecision(ready.id, 'Cambio de funciones');
  await tryCall('revokeDecision', () => revokeDecision(ready.id, 'x'));
  as('usr_jorge');
  await tryCall('grantException', () => grantException({ employeeId: 'emp_ivan', worksiteId: 'ws_horta', templateIds: ['tpl_altura'], reason: 'Urgencia', compensatingMeasure: '', validUntil: '2027-12-31' }));
  await tryCall('grantException', () => grantException({ employeeId: 'emp_ivan', worksiteId: 'ws_horta', templateIds: [], reason: 'Urgencia del cliente', compensatingMeasure: 'x', validUntil: '2026-10-20' }));
  await tryCall('grantException', () => grantException({ employeeId: 'emp_ivan', worksiteId: 'ws_horta', templateIds: ['tpl_pemp'], reason: 'Urgencia del cliente', compensatingMeasure: 'x', validUntil: '2026-10-20' }));
  await tryCall('grantException', () => grantException({ employeeId: 'emp_pablo', worksiteId: 'ws_nou', templateIds: ['tpl_pemp'], reason: 'Trabajo acompañado del operador del titular', compensatingMeasure: 'Operador acreditado del titular', validUntil: '2026-12-31' }));
  const ex = await grantException({ employeeId: 'emp_pablo', worksiteId: 'ws_nou', templateIds: ['tpl_pemp'], reason: 'Trabajo acompañado del operador del titular', compensatingMeasure: 'Operador acreditado del titular', validUntil: '2026-10-30' });
  allReadiness(getDb(), LEV, TODAY, 30).forEach((r) => r.reasons.forEach((x) => addMsg('readiness reason (after exception)', x.msg)));
  await revokeDecision(ex.id, 'El operador ya no está disponible');
}

async function exerciseOps() {
  as('usr_marina');
  const list = visibleExceptions(getCtx());
  const open = list.find((e) => e.status === 'open' && !e.restricted)!;
  await tryCall('updateException', () => updateException(open.key, 'reopen', 'x'));
  await tryCall('updateException', () => updateException(open.key, 'assign', ''));
  await tryCall('updateException', () => updateException(open.key, 'assign', 'x', 'usr_nadie'));
  await updateException(open.key, 'assign', 'Revisar esta semana', 'usr_javier');
  await updateException(open.key, 'investigate', 'En análisis');
  await updateException(open.key, 'resolve', 'Resuelto');
  await tryCall('updateException', () => updateException(open.key, 'acknowledge', 'x'));
  await updateException(open.key, 'reopen', 'Vuelve a aparecer');
  for (const e of visibleExceptions(getCtx()).filter((x) => x.status === 'open' && !x.restricted).slice(0, 40)) await updateException(e.key, 'assign', 'Asignada', 'usr_javier');
  as('usr_javier');
  await tryCall('updateSettings', () => updateSettings({ alertWindowDays: 0, shareLinkMaxDays: 200, clinicalKeywords: [] }));
  await updateSettings({ alertWindowDays: 45, shareLinkMaxDays: 30, clinicalKeywords: ['informe médico'] });
  await tryCall('saveJobRole', () => saveJobRole({ name: '', departmentId: 'nope', tasks: '', riskTags: ['espacio_confinado'] }, null, ''));
  await tryCall('saveJobRole', () => saveJobRole({ name: 'Limpiador/a', departmentId: 'dep_limp', tasks: 'x', riskTags: ['altura'] }, 'jr_limp', ''));
  await saveJobRole({ name: 'Limpiador/a', departmentId: 'dep_limp', tasks: 'Limpieza de oficinas, zonas comunes y locales de clientes.', riskTags: ['quimicos_limpieza', 'caidas_mismo_nivel', 'manipulacion_cargas', 'altura'] }, 'jr_limp', 'Evaluación ER-002 revisada');
  await saveJobRole({ name: 'Mozo/a de almacén', departmentId: 'dep_mant', tasks: 'Carga y descarga.', riskTags: [] }, null, '');
  await tryCall('revokeMembership', () => revokeMembership('mbr_javier_levante', 'x'));
  await tryCall('revokeMembership', () => revokeMembership('mbr_ramon_levante', 'x'));
  await tryCall('revokeMembership', () => revokeMembership('mbr_lucia_levante', ''));
  await revokeMembership('mbr_lucia_levante', 'Fin del contrato');
  switchIdentity('usr_ramon', LEV);
  switchIdentity('usr_marina', LEV);
  myTasks(getCtx()).forEach((tk) => add('task', tk.title));
  for (const id of ['usr_jorge', 'usr_clara', 'usr_pablo', 'usr_amparo', 'usr_javier']) {
    as(id);
    myTasks(getCtx()).forEach((tk) => add(`task (${id})`, tk.title));
  }
}

async function exerciseReports() {
  as('usr_marina');
  const f = { ...EMPTY_FILTERS, worksiteId: 'ws_oficina', departmentId: 'dep_adm', employeeId: 'emp_marta', category: 'training', status: 'accepted' };
  for (const r of REPORTS) {
    for (const filters of [EMPTY_FILTERS, f, { ...EMPTY_FILTERS, caseId: 'cae_001' }]) {
      as(r.restricted ? 'usr_clara' : 'usr_marina');
      try {
        const res = runReport(getCtx(), r.id, filters);
        addValue(`report ${r.id} scope`, res.scope);
        res.columns.forEach((c) => add(`report ${r.id} column`, c.label));
        for (const row of res.rows.slice(0, 60)) {
          for (const [k, v] of Object.entries(row)) {
            if (typeof v !== 'string') continue;
            // Free reference text in rows (titles, names, sources) is checked through the seed below.
            if (['empleado', 'centro', 'requisito', 'documento', 'titulo', 'origen', 'curso', 'equipo', 'elemento', 'observaciones', 'puesto', 'fuente', 'evaluador', 'registro', 'resumen', 'motivo', 'actor', 'presentado_por', 'revisor', 'responsable', 'emisor', 'puestos', 'identificador', 'medidas', 'huella', 'motivos'].includes(k)) continue;
            addValue(`report ${r.id} value (${k})`, v);
          }
        }
      } catch {
        /* report not available to this role */
      }
    }
  }
  as('usr_marina');
  await createExport({ reportId: 'employee_evidence', format: 'csv', filters: EMPTY_FILTERS, recipient: '', download: false });
  await createExport({ reportId: 'readiness', format: 'json', filters: EMPTY_FILTERS, recipient: 'Cliente', download: false });
  await createExport({ reportId: 'actions', format: 'csv', filters: EMPTY_FILTERS, recipient: 'Cliente', download: false });
  as('usr_lucia');
  await tryCall('createExport', () => createExport({ reportId: 'audit', format: 'json', filters: EMPTY_FILTERS, recipient: '', download: false }));
}

function collectStatic() {
  for (const [name, table] of Object.entries(STATUS)) {
    if (typeof table !== 'object' || !table || Array.isArray(table)) continue;
    for (const v of Object.values(table as Record<string, unknown>)) {
      if (typeof v === 'string') add(name, v);
      else if (v && typeof v === 'object' && 'label' in v) {
        const meta = v as { label: string; help?: string };
        add(name, meta.label);
        add(name, meta.help);
      }
    }
  }
  for (const r of Object.values(ROLES)) [r.label, r.description, r.restriction].forEach((s) => add('ROLES', s));
  for (const [n, tbl] of Object.entries({ AUDIT_ACTION_LABEL, EXCEPTION_TYPE_LABEL, AUTHORITY_LABEL, ACTION_LABEL })) for (const s of Object.values(tbl as Record<string, string>)) add(n, s);
  add('export', EXPORT_NOTICE);
  for (const r of REPORTS) [r.title, r.description].forEach((s) => add('report', s));
  add('error default', 'Acción no permitida para su rol.');
  add('error default', 'El registro no existe o no pertenece a la empresa activa.');
  [
    'Se ha superado el espacio de almacenamiento local. Elimine archivos de demostración o restablezca los datos.',
    'No se pudo guardar en el almacenamiento local.',
    'Los datos locales no se podían leer. Se ha guardado una copia ({key}) y se han cargado datos de demostración.',
    'Los datos locales tienen otra versión de esquema. Se ha guardado una copia ({key}) y se han cargado datos de demostración.',
    'Faltaban colecciones en los datos locales ({list}). Se han restaurado los datos de referencia; el resto se conserva.',
  ].forEach((s) => add('storage', s));
}

function collectDerived() {
  const db = getDb();
  for (const companyId of [LEV, 'cmp_ibaigane']) {
    for (const e of detectExceptions(db, companyId, TODAY, 30)) {
      addMsg(`exception ${e.type} source`, e.source);
      addMsg(`exception ${e.type} reason`, e.reason);
      addMsg(`exception ${e.type} next`, e.nextAction);
    }
    for (const r of allReadiness(db, companyId, TODAY, 30)) {
      r.reasons.forEach((x) => addMsg('readiness reason', x.msg));
      for (const it of r.items) {
        addMsg('item reason', it.reason);
        addMsg('item reason (masked)', maskItem(it, false).reason);
      }
    }
    for (const emp of db.employees.filter((e) => e.companyId === companyId)) for (const it of matrixFor(db, companyId, emp.id, TODAY, 30)) addMsg('matrix reason', it.reason);
  }
}

function collectRecords() {
  const db = getDb();
  for (const e of db.audit) {
    add(`audit.summary ${e.action}`, e.summary);
    for (const c of e.changes) {
      add('audit.change field', c.field);
      // Values are only language when the field holds a label (status, readiness, expiry, job role).
      if (['Estado', 'Disponibilidad', 'Caducidad legal', 'Puesto'].includes(c.field)) [c.before, c.after].forEach((v) => addValue('audit.change value', v));
    }
  }
  for (const n of db.notifications) {
    add(`notification ${n.type} title`, n.title);
    addValue(`notification ${n.type} body`, n.body);
  }
}

/** Reference texts that i18n/localizeDb translates (seed only; anything users type stays as typed). */
function collectReference() {
  const db = getDb();
  const ref = (where: string, s: string | null | undefined) => addValue(where, s);
  db.companies.forEach((c) => [c.activity, c.preventionNote].forEach((s) => ref('company', s)));
  db.departments.forEach((d) => ref('department', d.name));
  db.users.forEach((u) => ref('user.title', u.title));
  db.memberships.forEach((m) => ref('membership.reference', m.reference));
  db.jobRoles.forEach((r) => [r.name, r.tasks].forEach((s) => ref('jobRole', s)));
  db.assignments.forEach((a) => ref('assignment.changeReason', a.changeReason));
  db.worksites.forEach((w) => [w.kind === 'own' ? w.name : null, w.activities].forEach((s) => ref('worksite', s)));
  db.providers.forEach((p) => ref('provider.contractReference', p.contractReference));
  db.riskTags.forEach((r) => ref('riskTag', r.label));
  db.categories.forEach((c) => ref('category', c.label));
  db.versions.forEach((v) => [v.name, v.description, v.purpose, v.applicabilityNote, v.evidenceRequired, v.responsibleReviewer, v.changeReason, v.approvalNote, v.source.label, v.reviewRule.setBy].forEach((s) => ref('version', s)));
  db.documents.forEach((d) => ref('document.title', d.title));
  db.docVersions.forEach((v) => [v.issuer, v.decisionNote, v.rejectionReason].forEach((s) => ref('docVersion', s)));
  db.acknowledgements.forEach((a) => ref('acknowledgement', a.statement));
  db.courses.forEach((c) => [c.title, c.contentSummary, c.refresher.setBy].forEach((s) => ref('course', s)));
  db.trainings.forEach((x) => ref('training.note', x.note));
  db.equipment.forEach((e) => [e.name, e.type, e.description, e.replacement.setBy].forEach((s) => ref('equipment', s)));
  db.assessments.forEach((a) => {
    [a.title, a.activity, a.assessorName, a.preventiveMeasures, a.reviewNote].forEach((s) => ref('assessment', s));
    a.hazards.forEach((h) => [h.description, h.measures].forEach((s) => ref('hazard', s)));
  });
  db.actions.forEach((a) => {
    [a.title, a.description, a.targetJustification, a.requiredEvidence, a.resolutionNote, a.source.label].forEach((s) => ref('action', s));
    a.notes.forEach((n) => ref('action.note', n.text));
  });
  db.caeCases.forEach((c) => [c.title, c.activities, c.risksSummary, c.coordinationMeans, c.openQuestions].forEach((s) => ref('caeCase', s)));
  db.caeExchanges.forEach((x) => [x.subject, x.reviewNote, x.followUp].forEach((s) => ref('caeExchange', s)));
  db.healthConclusions.forEach((c) => [c.scope, c.measures, c.clinicalRecordReference].forEach((s) => ref('healthConclusion', s)));
  db.changes.forEach((c) => [c.reason, c.reviewNote].forEach((s) => ref('change', s)));
  db.applicability.forEach((d) => ref('applicability', d.reason));
  db.readinessDecisions.forEach((d) => ref('readinessDecision', d.reason));
  db.requests.forEach((r) => ref('request', r.note));
  db.exceptionReviews.forEach((r) => ref('exceptionReview.snapshot', r.snapshot));
}

describe('runtime text has English renderings', () => {
  const seedOut = new Map<string, string>();
  beforeAll(async () => {
    setClock(new Date(`${TODAY}T08:00:00Z`));
    resetDemoData();
    initDatabase();
    setSession({ userId: 'usr_marina', companyId: LEV });
    collectProperNames();
    // Seed: reference data, derived messages, seeded audit and notifications.
    collectReference();
    collectDerived();
    collectRecords();
    for (const [k, v] of out) seedOut.set(k, v);
    collectStatic();
    await exerciseRequirements();
    await exerciseEvidence();
    await exerciseTrainingAndPpe();
    await exerciseSafety();
    await exerciseCae();
    await exerciseHealth();
    await exercisePeople();
    await exerciseOps();
    await exerciseReports();
    collectDerived();
    collectRecords();
    setLangForTests('en');
  });
  afterAll(() => {
    setLangForTests('es');
    setClock(null);
    resetDemoData();
  });

  it('seeded reference data, derived messages, seeded audit and notifications', () => {
    const missing = [...seedOut].filter(([s]) => !hasEnglish(s)).map(([s, where]) => `[${where}] ${s}`);
    expect(missing, `No English rendering for:\n${missing.join('\n')}`).toEqual([]);
  });

  it('labels, service messages, generated audit summaries, notifications and errors', () => {
    const missing = [...out].filter(([s]) => !seedOut.has(s) && !hasEnglish(s)).map(([s, where]) => `[${where}] ${s}`);
    expect(missing, `No English rendering for:\n${missing.join('\n')}`).toEqual([]);
  });
});
