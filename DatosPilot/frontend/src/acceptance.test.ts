/**
 * Acceptance scenarios (spec §23, BRD AC-PRL-01..04, AC-PLT-01..04) against the service layer.
 * Run with: npx vitest run src/acceptance.test.ts
 *
 * UI-only scenarios (every sidebar route renders, no dead buttons) are covered by the browser
 * walkthrough documented in docs/02_DESIGN_AND_TRACEABILITY.md §8.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from './domain/time';
import { verifyAuditChain } from './domain/audit';
import { READINESS } from './domain/status';
import { allReadiness, readinessFor } from './domain/requirements';
import { getDb, initDatabase, resetDemoData, setSession } from './store/db';
import { can, getCtx, itemsFor, readinessOf, visibleEmployeeIds, visibleReadiness } from './services/context';
import { changeAssignment, confirmReady, grantException, reviewChange, saveWorksite } from './services/peopleService';
import { approveVersion, createTemplate, newVersion, submitForApproval, activateVersion, type VersionInput } from './services/requirementService';
import { acknowledgeDocument, decideDocument, downloadDocument, startReview, submitDocument, visibleDocuments, type SubmitInput } from './services/evidenceService';
import { openClinicalAttachment, recordDeniedAccess, recordResponse, recordOffer } from './services/healthService';
import { addProgress, assignAction, createAction, reviewAction, submitAction } from './services/safetyService';
import { createShareLink, recordExchange, recordExchangeStep, shareableVersions, simulateLinkAccess, revokeShareLink } from './services/caeService';
import { createExport, runReport, EMPTY_FILTERS } from './services/reportService';
import { myTasks, visibleExceptions } from './services/opsService';

const TODAY = '2026-10-12';
const as = (userId: string, companyId = 'cmp_levante') => setSession({ userId, companyId });
const item = (employeeId: string, templateId: string, worksiteId: string | null = null) => getCtx().db && itemsFor(getCtx(), employeeId).find((i) => i.template.id === templateId && (worksiteId === null || i.worksiteId === worksiteId));
const lastAudit = (action: string) => [...getDb().audit].reverse().find((e) => e.action === action);
/** Expects a rejected promise whose message or details match. */
const rejectsWith = async (p: Promise<unknown>, re: RegExp) => {
  try {
    await p;
  } catch (e) {
    const err = e as { message: string; details?: string[] };
    expect([err.message, ...(err.details ?? [])].join(' | ')).toMatch(re);
    return;
  }
  throw new Error('Expected a rejection');
};
const docInput = (p: Partial<SubmitInput>): SubmitInput => ({ categoryId: 'cert_formacion', title: 'Certificado', issuer: 'Formación Segura Turia, S.L.', issueDate: '2026-10-05', expiryMode: 'none', legalExpiryDate: null, providerReviewDate: null, internalFollowUpDate: null, file: { name: 'certificado.pdf', size: 1200, type: 'application/pdf', dataUrl: null }, containsClinical: false, sourceReference: '', notes: '', ...p });

beforeEach(() => {
  setClock(new Date(`${TODAY}T08:00:00Z`));
  resetDemoData();
  initDatabase();
});

describe('Requirements and assignments', () => {
  it('1-2 · AC-PRL-01: a new worksite adds its requirements and keeps unrelated accepted evidence valid', async () => {
    as('usr_javier');
    const before = itemsFor(getCtx(), 'emp_pablo');
    const acceptedBefore = before.filter((i) => i.status === 'accepted').map((i) => i.key);
    const change = await changeAssignment('emp_pablo', { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_torre', 'ws_colegio', 'ws_oficina', 'ws_nou'] }, TODAY, 'Nuevo contrato Nou Campus');
    const newNames = change.delta.newlyRequired.map((d) => d.templateId);
    expect(newNames).toContain('tpl_inst_nou');
    expect(newNames).toContain('tpl_pemp');
    expect(change.delta.newCriticalUnresolved.length).toBeGreaterThan(0);
    const after = itemsFor(getCtx(), 'emp_pablo');
    for (const k of acceptedBefore) expect(after.find((i) => i.key === k)?.status).toBe('accepted');
    expect(readinessFor(getDb(), 'cmp_levante', 'emp_pablo', 'ws_torre', TODAY, 30).state).toBe('ready');
    expect(readinessFor(getDb(), 'cmp_levante', 'emp_pablo', 'ws_nou', TODAY, 30).state).toBe('blocked');
    expect(getDb().assignments.filter((a) => a.employeeId === 'emp_pablo')).toHaveLength(2);
  });

  it('3 · a role change opens a delta review that the coordinator completes', async () => {
    as('usr_javier');
    const c = await changeAssignment('emp_raul', { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_torre', 'ws_dental'] }, TODAY, 'Promoción a técnico');
    expect(c.status).toBe('pending_review');
    expect(c.delta.newlyRequired.some((d) => d.templateId === 'tpl_altura')).toBe(true);
    expect(c.delta.noLongerApplicable.length + c.delta.unchanged.length).toBeGreaterThan(0);
    await expect(reviewChange(c.id, 'ok', true)).rejects.toThrow();
    as('usr_marina');
    const r = await reviewChange(c.id, 'Revisado; se solicitan los nuevos requisitos.', true);
    expect(r.status).toBe('reviewed');
    expect(getDb().requests.some((q) => q.employeeId === 'emp_raul' && q.templateId === 'tpl_altura' && q.status === 'open')).toBe(true);
  });

  it('4 · versioning keeps history and never rewrites evidence reviewed under an earlier version', async () => {
    const pablo = item('emp_pablo', 'tpl_altura')!;
    expect(pablo.status).toBe('accepted');
    const dv = getDb().docVersions.find((v) => v.id === pablo.evidence.acceptedVersionId)!;
    expect(dv.requirementVersionId).toBe('tpl_altura_v1');
    expect(getDb().versions.filter((v) => v.templateId === 'tpl_altura')).toHaveLength(2);
    // ER-002 v2 invalidates earlier chemicals training: flagged for review, not silently deleted.
    const amparo = item('emp_amparo', 'tpl_quimicos')!;
    expect(amparo.status).toBe('review_required');
    expect(getDb().docVersions.find((v) => v.id === amparo.evidence.acceptedVersionId)?.status).toBe('accepted');
  });

  it('5 · optional and not-applicable requirements do not block readiness', () => {
    const javier = itemsFor(getCtx(), 'emp_javier');
    expect(javier.find((i) => i.template.id === 'tpl_pvd')?.counted).toBe(false);
    const marta = readinessFor(getDb(), 'cmp_levante', 'emp_marta', 'ws_oficina', TODAY, 30);
    expect(marta.items.find((i) => i.template.id === 'tpl_pvd')).toBeTruthy();
    expect(marta.state).toBe('ready');
    const jm = readinessFor(getDb(), 'cmp_levante', 'emp_josemi', 'ws_horta', TODAY, 30);
    expect(jm.items.find((i) => i.template.id === 'tpl_carretilla')?.status).toBe('not_applicable');
    expect(jm.state).toBe('ready');
    expect(item('emp_elena', 'tpl_casco')?.status).toBe('not_applicable');
  });

  it('6 · an administrator cannot create and activate a mandatory medical-fitness rule', async () => {
    as('usr_javier');
    const input: VersionInput = { name: 'Reconocimiento médico obligatorio anual', description: '', purpose: '', category: 'health_surveillance', evidenceMode: 'health', requirementType: 'mandatory_policy', scope: { jobRoleIds: [], worksiteIds: [], riskTags: [], employeeIds: [], appliesToAll: true }, perWorksite: false, source: { kind: 'internal_policy', label: 'Decisión de administración', url: null, assessmentId: null }, applicabilityNote: 'Para toda la plantilla', reviewAuthority: 'provider_medical', responsibleReviewer: 'x', evidenceRequired: 'Certificado', expiryRule: 'none', reviewRule: { kind: 'none', months: null, setBy: null }, policyReviewDate: null, courseId: null, equipmentItemId: null, instructionDocumentId: null, health: { kind: 'mandatory_exception', exceptionGround: null, representativesReportOn: null, professionalReference: null }, effectiveFrom: TODAY, changeReason: 'Política', invalidatesPriorEvidence: false, critical: true };
    const { version } = await createTemplate(input);
    expect(version.critical).toBe(false); // an admin cannot set "critical"
    await expect(activateVersion(version.id)).rejects.toThrow();
    await expect(approveVersion(version.id, { critical: true, exceptionAllowed: false, note: 'yo', policyReviewDate: null })).rejects.toThrow();
    await submitForApproval(version.id);
    as('usr_clara');
    await rejectsWith(approveVersion(version.id, { critical: false, exceptionAllowed: false, note: 'Revisado', policyReviewDate: null }), /informe previo/);
    expect(getDb().versions.find((v) => v.id === version.id)?.status).toBe('pending_approval');
    expect(itemsFor(getCtx(), 'emp_pablo').some((i) => i.template.id === version.templateId)).toBe(false);
  });
});

describe('Documents', () => {
  it('7-8 · submit → received, review → accepted by the configured authority only', async () => {
    as('usr_pablo');
    const before = getDb().audit.length;
    const r = await submitDocument(docInput({ employeeId: 'emp_pablo', templateId: 'tpl_pvd', title: 'PVD Pablo' }));
    expect(r.version.status).toBe('received');
    expect(getDb().audit.length).toBeGreaterThan(before);
    await expect(decideDocument(r.version.id, 'accept', { note: 'x' })).rejects.toThrow();
    as('usr_javier'); // administrator: not a review authority
    await expect(decideDocument(r.version.id, 'accept', { note: 'x' })).rejects.toThrow();
    as('usr_marina');
    await startReview(r.version.id);
    const ok = await decideDocument(r.version.id, 'accept', { note: 'Correcto' });
    expect(ok.status).toBe('accepted');
  });

  it('9-10 · a rejected document is kept and a replacement creates a new version', async () => {
    const fatima = item('emp_fatima', 'tpl_quimicos')!;
    expect(fatima.status).toBe('rejected');
    as('usr_amparo');
    await expect(submitDocument(docInput({ documentId: fatima.evidence.documentId, title: 'Química Fátima v2' }))).rejects.toThrow(); // supervisors do not upload
    as('usr_marina');
    const r = await submitDocument(docInput({ documentId: fatima.evidence.documentId, title: 'Química Fátima v2' }));
    expect(r.version.version).toBe(2);
    const versions = getDb().docVersions.filter((v) => v.documentId === fatima.evidence.documentId);
    expect(versions.map((v) => v.status).sort()).toEqual(['received', 'rejected']);
  });

  it('11-13 · no-expiry acceptance, separate provider review date, missing date → review required', async () => {
    as('usr_javier');
    const r = await submitDocument(docInput({ employeeId: 'emp_raul', templateId: 'tpl_biologico', title: 'Riesgo biológico Raúl', expiryMode: 'none' }));
    as('usr_marina');
    await decideDocument(r.version.id, 'accept', { note: 'Sin caducidad según el emisor' });
    expect(item('emp_raul', 'tpl_biologico')?.status).toBe('accepted');
    // Interval set by the provider: the review date is stored separately from legal expiry.
    as('usr_marina');
    const alt = await submitDocument(docInput({ employeeId: 'emp_oscar', templateId: 'tpl_altura', title: 'Altura Óscar (2)' }));
    as('usr_jorge');
    await decideDocument(alt.version.id, 'accept', { note: 'ok' });
    const ov = getDb().docVersions.find((v) => v.id === alt.version.id)!;
    expect(ov.legalExpiryDate).toBeNull();
    expect(ov.providerReviewDate).toBe('2029-10-05');
    // Unknown expiry where the rule requires the document's date: review required, no invented date.
    const lucia = item('emp_lucia', 'tpl_biologico')!;
    expect(lucia.status).toBe('review_required');
    expect(lucia.evidence.legalExpiryDate).toBeNull();
  });
});

describe('Health-related privacy', () => {
  it('14-15 · AC-PRL-03: a supervisor sees the minimum status; the clinical attachment is denied and audited', async () => {
    as('usr_elena');
    const raul = itemsFor(getCtx(), 'emp_raul').find((i) => i.template.id === 'tpl_vs_oferta')!;
    expect(raul.reason.text).toMatch(/detalle restringido/);
    expect(JSON.stringify(raul)).not.toMatch(/15 kg/);
    await expect(openClinicalAttachment('emp_raul')).rejects.toThrow();
    const e = lastAudit('health.access_denied')!;
    expect(e.actor.userId).toBe('usr_elena');
    expect(e.restricted).toBe(true);
    recordDeniedAccess('Área restringida (ruta /salud)');
    as('usr_clara');
    await expect(openClinicalAttachment('emp_raul')).resolves.toMatch(/custodiada/);
  });

  it('16 · general documents, search scope and exports do not expose restricted health data', async () => {
    as('usr_javier');
    expect(visibleDocuments(getCtx()).some((d) => d.accessClass === 'quarantined' || d.accessClass === 'health')).toBe(false);
    const rep = runReport(getCtx(), 'employee_evidence', EMPTY_FILTERS);
    expect(JSON.stringify(rep.rows)).not.toMatch(/15 kg|Apto|apto con/);
    await expect(createExport({ reportId: 'health', format: 'json', filters: EMPTY_FILTERS, recipient: '', download: false })).rejects.toThrow();
    as('usr_marina');
    const { content } = await createExport({ reportId: 'employee_evidence', format: 'json', filters: EMPTY_FILTERS, recipient: 'Cliente', download: false });
    expect(content).not.toMatch(/15 kg/);
    // Uploading a clinical file sends it to quarantine instead of the ordinary record.
    const q = await submitDocument(docInput({ employeeId: 'emp_rocio', title: 'Informe médico del reconocimiento', categoryId: 'otros' }));
    expect(q.quarantined).toBe(true);
    as('usr_javier');
    expect(visibleDocuments(getCtx()).some((d) => d.id === q.document.id)).toBe(false);
    await expect(downloadDocument(q.version.id)).rejects.toThrow();
  });

  it('17 · a lawful decline of an optional offer is not classified as non-compliance', async () => {
    expect(item('emp_sergio', 'tpl_vs_oferta')?.status).toBe('declined');
    expect(item('emp_sergio', 'tpl_vs_oferta')?.satisfied).toBe(true);
    as('usr_marina');
    const offer = await recordOffer({ employeeId: 'emp_daniela', templateId: 'tpl_vs_oferta', basis: 'voluntary', offeredAt: TODAY });
    await recordResponse(offer.id, 'declined', TODAY);
    as('usr_clara');
    expect(itemsFor(getCtx(), 'emp_daniela').find((i) => i.template.id === 'tpl_vs_oferta')?.satisfied).toBe(true);
    await expect(recordOffer({ employeeId: 'emp_daniela', templateId: 'tpl_vs_oferta', basis: 'mandatory_exception', offeredAt: TODAY })).rejects.toThrow();
  });
});

describe('Readiness and preventive actions', () => {
  it('18-19 · AC-PRL-04: a missing critical training keeps readiness blocked until accepted evidence', async () => {
    as('usr_marina');
    let r = readinessOf(getCtx(), 'emp_oscar', 'ws_dental');
    expect(r.state).toBe('blocked');
    await expect(confirmReady('emp_oscar', 'ws_dental', 'ok')).rejects.toThrow(/No se puede marcar/);
    const pending = item('emp_oscar', 'tpl_altura')!;
    as('usr_jorge');
    await decideDocument(pending.evidence.pendingVersionId!, 'accept', { note: 'Certificado correcto' });
    r = readinessOf(getCtx(), 'emp_oscar', 'ws_dental');
    expect(r.reasons.some((x) => x.templateId === 'tpl_altura')).toBe(false);
    expect(getDb().audit.some((e) => e.action === 'readiness.change' && e.employeeId === 'emp_oscar')).toBe(true);
    // Routine override of a mandatory control is refused.
    await rejectsWith(grantException({ employeeId: 'emp_ivan', worksiteId: 'ws_horta', templateIds: ['tpl_altura'], reason: 'Urgencia del cliente', compensatingMeasure: 'Supervisión', validUntil: '2026-10-20' }), /no permite excepciones/);
  });

  it('20-21 · an unresolved action stays visible and cannot be submitted without the configured evidence', async () => {
    as('usr_marina');
    const a = await createAction({ title: 'Revisar extintor del almacén', description: '', source: { kind: 'review_finding', refId: null, label: 'Revisión interna' }, employeeId: null, jobRoleId: null, worksiteId: 'ws_oficina', priority: 'medium', requiredEvidence: 'Foto del extintor revisado', evidenceRequired: true, reviewAuthority: 'coordinator', affectsReadiness: false });
    await assignAction(a.id, 'usr_javier', '2026-10-30', 'Visita del mantenedor');
    as('usr_javier');
    await addProgress(a.id, 'Contactado el mantenedor');
    await rejectsWith(submitAction(a.id, 'Hecho'), /Falta la evidencia/);
    expect(visibleExceptions(getCtx()).some((e) => e.key === `action:${a.id}`)).toBe(true);
    await submitDocument(docInput({ title: 'Foto extintor', categoryId: 'evidencia_accion', worksiteId: 'ws_oficina', actionId: a.id }));
    expect(getDb().actions.find((x) => x.id === a.id)?.status).toBe('in_progress'); // upload does not close it
    await submitAction(a.id, 'Revisado por el mantenedor');
    await expect(reviewAction(a.id, 'accept', 'ok')).rejects.toThrow(); // the owner cannot accept it
    as('usr_marina');
    expect((await reviewAction(a.id, 'accept', 'Comprobado')).status).toBe('resolved');
  });

  it('22 · readiness is labelled as evidence readiness, not professional safety approval', () => {
    const r = readinessFor(getDb(), 'cmp_levante', 'emp_pablo', 'ws_torre', TODAY, 30);
    expect(r.state).toBe('ready');
    expect(READINESS.ready.label).toBe('Listo según los requisitos configurados');
    expect(READINESS.ready.help).toMatch(/No es una aprobación profesional/);
  });
});

describe('CAE and exports', () => {
  it('23-24 · sent, received and acknowledged are separate facts', async () => {
    as('usr_marina');
    const docs = shareableVersions(getCtx(), getDb().caeCases.find((c) => c.id === 'cae_002')!);
    const x = await recordExchange({ caseId: 'cae_002', direction: 'sent', subject: 'ER-002 v2', documentVersionId: docs[0].version.id, senderParticipantId: 'p2', recipientParticipantId: 'p1', sentAt: TODAY, followUp: '' });
    expect(x.sentAt).toBeTruthy();
    expect(x.receivedAt).toBeNull();
    expect(x.acknowledgedAt).toBeNull();
    await rejectsWith(recordExchangeStep(x.id, 'acknowledged', { date: TODAY, confirmedBy: '' }), /recepción/);
    await recordExchangeStep(x.id, 'receipt', { date: TODAY, confirmedBy: 'Rafael Soler' });
    const done = await recordExchangeStep(x.id, 'acknowledged', { date: TODAY, confirmedBy: '' });
    expect(done.acknowledgedAt).toBeTruthy();
  });

  it('25-27 · CAE package: only approved, relevant evidence; links scoped; export audited', async () => {
    as('usr_marina');
    const kase = getDb().caeCases.find((c) => c.id === 'cae_001')!;
    const allowed = shareableVersions(getCtx(), kase);
    expect(allowed.every((x) => x.version.status === 'accepted' && x.doc.accessClass === 'ordinary' && !x.doc.employeeId)).toBe(true);
    expect(allowed.some((x) => x.doc.worksiteId === 'ws_horta')).toBe(false);
    const personal = getDb().docVersions.find((v) => v.documentId === 'doc_delitos_pablo')!;
    await expect(createShareLink(kase.id, 'p1', [personal.id], '2026-10-20')).rejects.toThrow();
    const link = await createShareLink(kase.id, 'p1', [allowed[0].version.id], '2026-10-20');
    await simulateLinkAccess(link.id);
    await revokeShareLink(link.id, 'Fin del intercambio');
    await expect(simulateLinkAccess(link.id)).rejects.toThrow(/revocado/);
    const { job, content } = await createExport({ reportId: 'cae_package', format: 'csv', filters: { ...EMPTY_FILTERS, caseId: kase.id }, recipient: 'Hoteles Mar Blau, S.L.', download: false });
    expect(content).not.toMatch(/Delincuentes|Informe médico/);
    expect(job.openItems).toBeGreaterThan(0); // unresolved items stay visible
    const e = lastAudit('export.create')!;
    expect(e.recipient).toBe('Hoteles Mar Blau, S.L.');
  });
});

describe('General functionality', () => {
  it('29 · scoped search: a supervisor sees only their team and coordinated worksites', () => {
    as('usr_amparo');
    const ids = visibleEmployeeIds(getCtx());
    expect(ids.has('emp_lucia')).toBe(true);
    expect(ids.has('emp_javier')).toBe(false);
    as('usr_pablo');
    expect([...visibleEmployeeIds(getCtx())]).toEqual(['emp_pablo']);
    expect(visibleReadiness(getCtx()).every((r) => r.employeeId === 'emp_pablo')).toBe(true);
  });

  it('30 · dashboard-level metrics update after an action (readiness and tasks)', async () => {
    as('usr_jorge');
    const before = allReadiness(getDb(), 'cmp_levante', TODAY, 30).filter((r) => r.state === 'blocked').length;
    const tasks = myTasks(getCtx()).length;
    const v = item('emp_oscar', 'tpl_altura')!.evidence.pendingVersionId!;
    await decideDocument(v, 'accept', { note: 'ok' });
    expect(myTasks(getCtx()).length).toBeLessThan(tasks);
    expect(allReadiness(getDb(), 'cmp_levante', TODAY, 30).filter((r) => r.state === 'blocked').length).toBeLessThan(before);
  });

  it('31 · role permissions restrict actions and exports', async () => {
    as('usr_andres'); // employee + prevention delegate
    await expect(createExport({ reportId: 'employee_evidence', format: 'csv', filters: EMPTY_FILTERS, recipient: '', download: false })).resolves.toBeTruthy(); // own only
    const own = await createExport({ reportId: 'employee_evidence', format: 'json', filters: EMPTY_FILTERS, recipient: '', download: false });
    expect(own.content).not.toMatch(/Pablo Ruiz/);
    const agg = await createExport({ reportId: 'actions', format: 'json', filters: EMPTY_FILTERS, recipient: '', download: false });
    expect(agg.content).not.toMatch(/Iván Castelló/);
    await expect(createExport({ reportId: 'audit', format: 'json', filters: EMPTY_FILTERS, recipient: '', download: false })).rejects.toThrow();
    as('usr_laura'); // owner: operational view, no health
    await expect(openClinicalAttachment('emp_raul')).rejects.toThrow();
    as('usr_ramon'); // revoked provider
    expect(getCtx().perms.size).toBe(0);
  });

  it('32 · AC-PLT-01: company-scoped data cannot be read or changed from another company', async () => {
    as('usr_iker', 'cmp_ibaigane');
    expect(visibleDocuments(getCtx()).every((d) => d.companyId === 'cmp_ibaigane')).toBe(true);
    const levanteDoc = getDb().docVersions.find((v) => v.companyId === 'cmp_levante')!;
    await expect(downloadDocument(levanteDoc.id)).rejects.toThrow(/no existe/);
    await expect(changeAssignment('emp_pablo', { jobRoleId: 'jr_tec_mant', departmentId: 'dep_mant', worksiteIds: ['ws_torre'] }, TODAY, 'x')).rejects.toThrow();
    as('usr_jorge', 'cmp_ibaigane');
    expect([...visibleEmployeeIds(getCtx())].sort()).toEqual(['emp_ane', 'emp_mikel']);
  });

  it('33-34 · data persists in the store and reset restores the initial dataset', async () => {
    as('usr_marina');
    await acknowledgeDocument('doc_info_tec', 'emp_ivan').catch(() => undefined);
    const n = getDb().audit.length;
    initDatabase(); // reload from storage
    expect(getDb().audit.length).toBe(n);
    resetDemoData();
    expect(getDb().audit.filter((e) => e.companyId === 'cmp_levante')).toHaveLength(1);
    expect(verifyAuditChain(getDb().audit.filter((e) => e.companyId === 'cmp_levante')).ok).toBe(true);
  });

  it('worksite risk change opens delta reviews without invalidating evidence', async () => {
    as('usr_javier');
    const w = getDb().worksites.find((x) => x.id === 'ws_torre')!;
    const { reviews } = await saveWorksite({ ...w, riskTags: [...w.riskTags, 'altura'] }, w.id, 'Limpieza de la cubierta incluida en el contrato');
    expect(reviews).toBeGreaterThan(0);
    const nerea = getDb().changes.find((c) => c.trigger === 'worksite_change' && c.employeeId === 'emp_nerea')!;
    expect(nerea.delta.newlyRequired.some((d) => d.templateId === 'tpl_altura')).toBe(true);
    expect(nerea.focusWorksiteIds).toEqual(['ws_torre']);
    expect(item('emp_fatima', 'tpl_prl_inicial')?.status).toBe('accepted');
    expect(item('emp_pablo', 'tpl_altura')?.status).toBe('accepted');
  });

  it('exception workflow only where the approved policy permits it, time-limited and audited', async () => {
    as('usr_javier');
    await changeAssignment('emp_sergio', { jobRoleId: 'jr_tec_inst', departmentId: 'dep_mant', worksiteIds: ['ws_marblau', 'ws_horta', 'ws_oficina', 'ws_nou'] }, TODAY, 'Nou Campus');
    as('usr_jorge');
    await rejectsWith(grantException({ employeeId: 'emp_sergio', worksiteId: 'ws_nou', templateIds: ['tpl_pemp'], reason: 'Trabajo acompañado del operador del titular', compensatingMeasure: 'Operador acreditado del titular', validUntil: '2026-12-31' }), /máximo/);
    const ex = await grantException({ employeeId: 'emp_sergio', worksiteId: 'ws_nou', templateIds: ['tpl_pemp'], reason: 'Trabajo acompañado del operador del titular', compensatingMeasure: 'Operador acreditado del titular', validUntil: '2026-10-30' });
    expect(ex.kind).toBe('exception');
    const r = readinessFor(getDb(), 'cmp_levante', 'emp_sergio', 'ws_nou', TODAY, 30);
    expect(r.reasons.some((x) => x.templateId === 'tpl_pemp' && x.state === 'blocked')).toBe(false);
    expect(lastAudit('readiness.exception')?.actor.userId).toBe('usr_jorge');
  });

  it('a new template version takes effect only from its date and keeps the previous version', async () => {
    as('usr_marina');
    const cur = getDb().versions.find((v) => v.id === 'tpl_pvd_v1')!;
    const v2 = await newVersion('tpl_pvd', { ...cur, effectiveFrom: '2026-11-01', changeReason: 'Nuevo curso en línea' });
    await activateVersion(v2.id);
    expect(getDb().versions.find((v) => v.id === 'tpl_pvd_v1')?.effectiveTo).toBe('2026-10-31');
    expect(itemsFor(getCtx(), 'emp_javier').find((i) => i.template.id === 'tpl_pvd')?.version.version).toBe(1);
    await expect(newVersion('tpl_pvd', { ...cur, effectiveFrom: '2026-01-01', changeReason: 'Retroactivo' })).rejects.toThrow();
  });
});

describe('Integration fixes', () => {
  it('seed ids are unique within every collection and company', () => {
    const db = getDb() as unknown as Record<string, unknown>;
    for (const [name, rows] of Object.entries(db)) {
      if (!Array.isArray(rows)) continue;
      // Vocabularies (risk tags, document categories) reuse the same key in each company.
      const ids = rows.map((r) => r as { id?: string; companyId?: string }).filter((r) => r.id).map((r) => `${r.companyId ?? ''}:${r.id}`);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });

  it('the owner of a preventive action can attach its evidence without the general upload permission', async () => {
    as('usr_elena');
    expect(can(getCtx(), 'evidence.upload')).toBe(false);
    const r = await submitDocument(docInput({ categoryId: 'evidencia_accion', title: 'Parte de reparación AP-008', employeeId: null, worksiteId: 'ws_cowork', actionId: 'act_008' }));
    expect(getDb().actions.find((a) => a.id === 'act_008')?.evidenceDocumentIds).toContain(r.document.id);
    await expect(submitDocument(docInput({ categoryId: 'evidencia_accion', title: 'Otra', employeeId: null, worksiteId: 'ws_torre', actionId: 'act_006' }))).rejects.toThrow();
  });

  it('a worker can only confirm receipt of information assigned to them', async () => {
    as('usr_pablo');
    await rejectsWith(acknowledgeDocument('doc_info_limp'), /no está asignada/);
  });
});
