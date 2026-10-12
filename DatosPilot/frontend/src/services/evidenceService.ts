/**
 * Documents and evidence (PRL-03, PRL-04, PRL-05, PLT-05).
 *
 * - Upload never implies approval: a submitted version is "received" until the configured review
 *   authority decides. Rejected versions stay as history; a replacement is a new version.
 * - Accepting a version supersedes the previously accepted one for the same requirement.
 * - Legal expiry, provider review and internal follow-up dates are separate; a missing date
 *   stays missing and the item shows "review required".
 * - A file that may contain clinical information (uploader flag or configured keywords) goes to
 *   quarantine for authorised medical handling and is never shown in ordinary lists.
 * - Files are DEMO files: metadata is stored; a small text/image file may be kept as a data URL in
 *   localStorage for the download demo. Nothing is securely stored.
 */
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { matrixFor, versionOn } from '../domain/requirements';
import { addMonths, nowInstant } from '../domain/time';
import { newId } from '../domain/ids';
import type { Acknowledgement, DemoFile, DocumentVersion, EvidenceDocument, EvidenceRequest, ID, ISODate, ReviewAuthority } from '../domain/types';
import { transact } from '../store/db';
import { auditReadinessChanges, audience, checkDate, employeeUser, managerUser, usersWithRole } from './common';
import { alertDays, can, canReviewAuthority, canSeeDocument, canSeeEmployee, employeeName, getCtx, latency, ownCompany, requireEmployeeVisible, requirePerm, type Ctx } from './context';
import { recordDeniedAccess } from './healthService';

/** Largest file kept as content in the demo (localStorage is small and not secure). */
export const DEMO_FILE_MAX_BYTES = 150_000;

export interface SubmitInput {
  /** Existing document → new version (replacement). */
  documentId?: ID | null;
  employeeId?: ID | null;
  worksiteId?: ID | null;
  templateId?: ID | null;
  categoryId: string;
  title: string;
  issuer: string;
  issueDate: ISODate | null;
  expiryMode: DocumentVersion['expiryMode'];
  legalExpiryDate: ISODate | null;
  providerReviewDate: ISODate | null;
  internalFollowUpDate: ISODate | null;
  file: DemoFile | null;
  /** The uploader indicates the file may contain clinical information. */
  containsClinical: boolean;
  sourceReference: string;
  notes: string;
  trainingId?: ID | null;
  actionId?: ID | null;
}

export interface SubmitResult {
  quarantined: boolean;
  document: EvidenceDocument;
  version: DocumentVersion;
}

/** Review authority of a document: the linked requirement's, otherwise the PRL coordination. */
export function authorityOf(ctx: Ctx, doc: EvidenceDocument): ReviewAuthority {
  if (!doc.templateId) return 'coordinator';
  return versionOn(ctx.db, doc.templateId, ctx.today)?.reviewAuthority ?? 'coordinator';
}

export function canDecide(ctx: Ctx, doc: EvidenceDocument, v?: DocumentVersion): boolean {
  if (doc.accessClass === 'health' || doc.accessClass === 'quarantined') return false;
  if (v && v.submittedBy === ctx.user.id) return false;
  return canReviewAuthority(ctx, authorityOf(ctx, doc), doc.employeeId);
}

export function clinicalKeywordHit(ctx: Ctx, ...texts: (string | null | undefined)[]): string | null {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return ctx.settings.clinicalKeywords.find((k) => k.trim() && hay.includes(k.toLowerCase())) ?? null;
}

export function validateSubmit(ctx: Ctx, input: SubmitInput): string[] {
  const e: string[] = [];
  if (!input.title.trim()) e.push('Título: obligatorio.');
  if (!input.issuer.trim()) e.push('Emisor: obligatorio.');
  if (!ctx.db.categories.some((c) => c.id === input.categoryId && c.companyId === ctx.company.id && c.active)) e.push('Tipo de documento: obligatorio.');
  const issue = checkDate(e, input.issueDate, 'Fecha de emisión');
  if (issue && issue > ctx.today) e.push('La fecha de emisión no puede ser futura.');
  if (input.expiryMode === 'date') {
    const exp = checkDate(e, input.legalExpiryDate, 'Caducidad legal', { required: true });
    if (exp && issue && exp < issue) e.push('La caducidad no puede ser anterior a la emisión.');
  }
  checkDate(e, input.providerReviewDate, 'Fecha de revisión del proveedor');
  checkDate(e, input.internalFollowUpDate, 'Fecha de seguimiento interno');
  if (input.file && input.file.size > 10 * 1024 * 1024) e.push('Archivo demasiado grande para la demostración (máx. 10 MB de metadatos).');
  if (input.templateId) {
    const v = versionOn(ctx.db, input.templateId, ctx.today);
    if (!v) e.push('El requisito no tiene una versión vigente.');
    else if (v.evidenceMode === 'health') e.push('La vigilancia de la salud no admite documentos: se registran la oferta y la conclusión en el área restringida.');
    else if (v.evidenceMode === 'acknowledgement' || v.evidenceMode === 'ppe_issue') e.push('Este requisito se cumple con una confirmación o una entrega, no con un documento.');
  }
  return e;
}

export async function requestEvidence(input: { employeeId: ID; templateId: ID; worksiteId?: ID | null; followUpDate: ISODate | null; note: string }): Promise<EvidenceRequest> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'evidence.request');
  requireEmployeeVisible(ctx, input.employeeId);
  const t = ownCompany(ctx, ctx.db.templates.find((x) => x.id === input.templateId));
  const v = versionOn(ctx.db, t.id, ctx.today);
  if (!v) throw new BusinessRuleError('El requisito no tiene una versión vigente.');
  const errors: string[] = [];
  const f = checkDate(errors, input.followUpDate, 'Seguimiento interno');
  if (f && f < ctx.today) errors.push('El seguimiento interno no puede estar en el pasado.');
  if (ctx.db.requests.some((r) => r.status === 'open' && r.employeeId === input.employeeId && r.templateId === t.id && (r.worksiteId ?? null) === (input.worksiteId ?? null))) errors.push('Ya hay una solicitud abierta para este requisito.');
  if (errors.length) throw new BusinessRuleError('Revise la solicitud', errors);
  const row: EvidenceRequest = { id: newId('rq'), companyId: ctx.company.id, employeeId: input.employeeId, worksiteId: input.worksiteId ?? null, templateId: t.id, requestedBy: ctx.user.id, requestedAt: nowInstant(), followUpDate: f, note: input.note.trim(), status: 'open', documentId: null, closedAt: null };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('requests', row);
    tx.audit({ action: 'evidence.request', entityType: 'request', entityId: row.id, entityLabel: `${t.code} · ${v.name}`, summary: `Evidencia solicitada a ${employeeName(ctx.db, input.employeeId)}${f ? `; seguimiento interno ${f}` : ''}.`, employeeId: input.employeeId, restricted: v.category === 'health_surveillance' });
    tx.notify({ type: 'evidence.request', title: 'Nueva solicitud de evidencia', body: v.name, recipientUserIds: audience([employeeUser(ctx.db, input.employeeId)], ctx.user.id), link: '/mis-tareas', dedupeKey: `ev-req:${row.id}` });
    auditReadinessChanges(tx, ctx, [input.employeeId], 'evidencia solicitada');
    return row;
  });
}

export async function cancelRequest(requestId: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'evidence.request');
  const r = ownCompany(ctx, ctx.db.requests.find((x) => x.id === requestId));
  if (r.status !== 'open') throw new BusinessRuleError('La solicitud no está abierta.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('requests', r.id, { status: 'cancelled', closedAt: nowInstant() });
    tx.audit({ action: 'evidence.request_cancel', entityType: 'request', entityId: r.id, entityLabel: r.id, summary: 'Solicitud cancelada.', reason: reason.trim(), employeeId: r.employeeId });
    if (r.employeeId) auditReadinessChanges(tx, ctx, [r.employeeId], 'solicitud cancelada');
  });
}

/** Submits a new document or a new version of an existing one. Never approves anything. */
export async function submitDocument(input: SubmitInput): Promise<SubmitResult> {
  await latency(300);
  const ctx = getCtx();
  const existing = input.documentId ? ownCompany(ctx, ctx.db.documents.find((d) => d.id === input.documentId)) : null;
  const employeeId = existing ? existing.employeeId : input.employeeId ?? null;
  const own = !!employeeId && ctx.employee?.id === employeeId;
  // The owner of a preventive action may attach its evidence (uploading does not close the action).
  const ownedAction = !existing && input.actionId && input.categoryId === 'evidencia_accion' ? ctx.db.actions.find((a) => a.id === input.actionId && a.companyId === ctx.company.id && a.ownerUserId === ctx.user.id && a.status !== 'resolved') : undefined;
  if (!(own && can(ctx, 'own.submit')) && !can(ctx, 'evidence.upload') && !ownedAction) throw new PermissionError();
  if (employeeId && !own) requireEmployeeVisible(ctx, employeeId);
  if (existing && !canSeeDocument(ctx, existing)) throw new NotFoundError();
  const templateId = existing ? existing.templateId : input.templateId ?? null;
  const errors = validateSubmit(ctx, { ...input, templateId });
  if (errors.length) throw new BusinessRuleError('Revise el documento', errors);
  const hit = clinicalKeywordHit(ctx, input.title, input.file?.name, input.notes);
  const quarantined = input.containsClinical || !!hit;
  const category = ctx.db.categories.find((c) => c.id === input.categoryId && c.companyId === ctx.company.id)!;
  const reqVersion = templateId ? versionOn(ctx.db, templateId, ctx.today) : undefined;
  const now = nowInstant();
  const count = ctx.db.documents.filter((d) => d.companyId === ctx.company.id).length;

  const doc: EvidenceDocument = existing ?? {
    id: newId('doc'),
    companyId: ctx.company.id,
    code: `DOC-${String(count + 1).padStart(4, '0')}`,
    categoryId: category.id,
    title: input.title.trim(),
    employeeId,
    worksiteId: input.worksiteId ?? null,
    caseId: null,
    templateId,
    accessClass: quarantined ? 'quarantined' : category.accessClass,
    createdAt: now,
    createdBy: ctx.user.id,
  };
  const n = existing ? ctx.db.docVersions.filter((x) => x.documentId === existing.id).length + 1 : 1;
  const version: DocumentVersion = {
    id: newId('dv'),
    companyId: ctx.company.id,
    documentId: quarantined && existing ? newId('doc') : doc.id,
    version: quarantined && existing ? 1 : n,
    issuer: input.issuer.trim(),
    issueDate: input.issueDate,
    expiryMode: input.expiryMode,
    legalExpiryDate: input.expiryMode === 'date' ? input.legalExpiryDate : null,
    providerReviewDate: input.providerReviewDate,
    internalFollowUpDate: input.internalFollowUpDate,
    receivedAt: now,
    submittedBy: ctx.user.id,
    file: input.file && input.file.size > DEMO_FILE_MAX_BYTES ? { ...input.file, dataUrl: null } : input.file,
    status: 'received',
    requirementVersionId: reqVersion?.id ?? null,
    reviewerId: null,
    reviewStartedAt: null,
    reviewedAt: null,
    decisionNote: null,
    rejectionReason: null,
    supersededBy: null,
    sourceReference: input.sourceReference.trim(),
    notes: input.notes.trim(),
  };

  if (quarantined) {
    // A separate quarantined document: the ordinary record (if any) is not touched or exposed.
    const qDoc: EvidenceDocument = existing ? { ...doc, id: version.documentId, code: `DOC-${String(count + 1).padStart(4, '0')}`, title: input.title.trim(), accessClass: 'quarantined', createdAt: now, createdBy: ctx.user.id } : doc;
    return transact(ctx.actor, ctx.company.id, (tx) => {
      tx.insert('documents', qDoc);
      tx.insert('docVersions', version);
      tx.insert('quarantine', { id: newId('q'), companyId: ctx.company.id, documentId: qDoc.id, documentVersionId: version.id, detectedBy: input.containsClinical ? 'uploader_flag' : 'keyword', quarantinedAt: now, uploaderId: ctx.user.id, status: 'quarantined', handledBy: null, handledAt: null, note: null });
      tx.audit({ action: 'evidence.quarantine', entityType: 'document', entityId: qDoc.id, entityLabel: qDoc.code, summary: input.containsClinical ? 'Archivo enviado a cuarentena: la persona que lo subió indicó posible contenido clínico.' : 'Archivo enviado a cuarentena por coincidencia con un término configurado.', employeeId, restricted: true });
      tx.notify({ type: 'quarantine', title: 'Documento en cuarentena', body: 'Un archivo con posible contenido clínico requiere gestión.', recipientUserIds: audience(usersWithRole(ctx.db, ctx.company.id, ['provider_medical'], ctx.today)), link: '/salud?tab=cuarentena', dedupeKey: `q:${version.id}` });
      return { quarantined: true, document: qDoc, version };
    });
  }

  const authority = authorityOf(ctx, doc);
  const reviewers = authority === 'coordinator' ? usersWithRole(ctx.db, ctx.company.id, ['prl_coordinator'], ctx.today) : usersWithRole(ctx.db, ctx.company.id, [authority === 'provider_technical' ? 'provider_technical' : 'provider_medical'], ctx.today);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    if (!existing) tx.insert('documents', doc);
    tx.insert('docVersions', version);
    if (templateId && employeeId) {
      for (const r of ctx.db.requests) {
        if (r.status === 'open' && r.templateId === templateId && r.employeeId === employeeId) tx.update('requests', r.id, { status: 'fulfilled', documentId: doc.id, closedAt: now });
      }
    }
    if (input.trainingId) {
      const tr = ctx.db.trainings.find((x) => x.id === input.trainingId && x.companyId === ctx.company.id);
      if (tr) tx.update('trainings', tr.id, { documentId: doc.id });
    }
    if (input.actionId) {
      const a = ctx.db.actions.find((x) => x.id === input.actionId && x.companyId === ctx.company.id);
      if (a) tx.update('actions', a.id, { evidenceDocumentIds: [...a.evidenceDocumentIds, doc.id], notes: [...a.notes, { at: now, by: ctx.user.id, kind: 'progress', text: `Evidencia aportada: ${doc.code} (sin revisar; no cierra la acción).` }] });
    }
    tx.audit({ action: existing ? 'evidence.replace' : 'evidence.submit', entityType: 'document', entityId: doc.id, entityLabel: `${doc.code} · ${doc.title}`, summary: `Versión ${version.version} recibida (${version.file ? `archivo de demostración ${version.file.name}` : 'solo metadatos'}). Pendiente de revisión: la subida no implica aprobación.`, employeeId, version: `v${version.version}` });
    tx.notify({ type: 'evidence.submit', title: 'Documento presentado', body: doc.title, recipientUserIds: audience(reviewers, ctx.user.id), link: `/documentacion/${doc.id}`, dedupeKey: `ev-sub:${version.id}` });
    if (employeeId) auditReadinessChanges(tx, ctx, [employeeId], `documento ${doc.code} recibido`);
    return { quarantined: false, document: doc, version };
  });
}

function findVersion(ctx: Ctx, versionId: ID): { doc: EvidenceDocument; v: DocumentVersion } {
  const v = ownCompany(ctx, ctx.db.docVersions.find((x) => x.id === versionId));
  const doc = ownCompany(ctx, ctx.db.documents.find((d) => d.id === v.documentId));
  if (!canSeeDocument(ctx, doc)) throw new NotFoundError();
  return { doc, v };
}

export async function startReview(versionId: ID): Promise<DocumentVersion> {
  await latency();
  const ctx = getCtx();
  const { doc, v } = findVersion(ctx, versionId);
  if (!canDecide(ctx, doc, v)) throw new PermissionError('Solo la autoridad de revisión configurada puede revisar este documento (y nunca el suyo propio).');
  if (v.status !== 'received') throw new BusinessRuleError('El documento no está pendiente de revisión.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('docVersions', v.id, { status: 'in_review', reviewerId: ctx.user.id, reviewStartedAt: nowInstant() });
    tx.audit({ action: 'evidence.review_start', entityType: 'document', entityId: doc.id, entityLabel: `${doc.code} · ${doc.title}`, summary: `Revisión iniciada de la versión ${v.version}.`, employeeId: doc.employeeId, version: `v${v.version}` });
    if (doc.employeeId) auditReadinessChanges(tx, ctx, [doc.employeeId], `revisión de ${doc.code}`);
    return u;
  });
}

export interface DecisionInput {
  note: string;
  rejectionReason?: string;
  /** Reviewer-confirmed dates (never invented by the system). */
  expiryMode?: DocumentVersion['expiryMode'];
  legalExpiryDate?: ISODate | null;
  providerReviewDate?: ISODate | null;
}

export async function decideDocument(versionId: ID, decision: 'accept' | 'reject', input: DecisionInput): Promise<DocumentVersion> {
  await latency();
  const ctx = getCtx();
  const { doc, v } = findVersion(ctx, versionId);
  if (!canDecide(ctx, doc, v)) throw new PermissionError('Solo la autoridad de revisión configurada puede decidir (y nunca sobre su propio documento).');
  if (v.status !== 'received' && v.status !== 'in_review') throw new BusinessRuleError('Esta versión ya tiene una decisión.');
  const errors: string[] = [];
  if (decision === 'reject' && !input.rejectionReason?.trim()) errors.push('Indique el motivo del rechazo.');
  const expiryMode = input.expiryMode ?? v.expiryMode;
  const legalExpiryDate = expiryMode === 'date' ? checkDate(errors, input.legalExpiryDate ?? v.legalExpiryDate, 'Caducidad legal', { required: true }) : null;
  let providerReviewDate = checkDate(errors, input.providerReviewDate === undefined ? v.providerReviewDate : input.providerReviewDate, 'Revisión del proveedor');
  const reqVersion = doc.templateId ? versionOn(ctx.db, doc.templateId, ctx.today) : undefined;
  let computedNote = '';
  if (decision === 'accept' && reqVersion?.reviewRule.kind === 'interval' && !providerReviewDate && reqVersion.reviewRule.months) {
    if (v.issueDate) {
      providerReviewDate = addMonths(v.issueDate, reqVersion.reviewRule.months);
      computedNote = ` Revisión del proveedor calculada con la periodicidad fijada por ${reqVersion.reviewRule.setBy} (${reqVersion.reviewRule.months} meses desde la emisión).`;
    }
  }
  if (errors.length) throw new BusinessRuleError('Revise la decisión', errors);
  const now = nowInstant();
  // Previously accepted evidence for the same requirement becomes superseded (kept as history).
  const sameKey = ctx.db.documents.filter((d) => d.companyId === ctx.company.id && d.templateId && d.templateId === doc.templateId && d.employeeId === doc.employeeId && (d.worksiteId ?? null) === (doc.worksiteId ?? null)).map((d) => d.id);
  const toSupersede = decision === 'accept' ? ctx.db.docVersions.filter((x) => x.status === 'accepted' && x.id !== v.id && (x.documentId === doc.id || sameKey.includes(x.documentId))) : [];
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('docVersions', v.id, {
      status: decision === 'accept' ? 'accepted' : 'rejected',
      reviewerId: ctx.user.id,
      reviewStartedAt: v.reviewStartedAt ?? now,
      reviewedAt: now,
      decisionNote: (input.note.trim() + computedNote).trim() || null,
      rejectionReason: decision === 'reject' ? input.rejectionReason!.trim() : null,
      requirementVersionId: reqVersion?.id ?? v.requirementVersionId,
      expiryMode,
      legalExpiryDate,
      providerReviewDate,
    });
    for (const s of toSupersede) {
      tx.update('docVersions', s.id, { status: 'superseded', supersededBy: v.id });
      tx.audit({ action: 'evidence.supersede', entityType: 'document', entityId: s.documentId, entityLabel: doc.code, summary: `Versión ${s.version} sustituida por la versión ${v.version} aceptada (se conserva).`, employeeId: doc.employeeId, version: `v${s.version}` });
    }
    const changes = [
      { field: 'Estado', before: v.status === 'in_review' ? 'En revisión' : 'Recibido', after: decision === 'accept' ? 'Aceptado' : 'Rechazado' },
      ...(v.providerReviewDate !== providerReviewDate ? [{ field: 'Revisión del proveedor', before: v.providerReviewDate ?? '—', after: providerReviewDate ?? '—' }] : []),
      ...(v.legalExpiryDate !== legalExpiryDate || v.expiryMode !== expiryMode ? [{ field: 'Caducidad legal', before: v.legalExpiryDate ?? (v.expiryMode === 'none' ? 'Sin caducidad' : 'No indicada'), after: legalExpiryDate ?? (expiryMode === 'none' ? 'Sin caducidad' : 'No indicada') }] : []),
    ];
    tx.audit({ action: decision === 'accept' ? 'evidence.accept' : 'evidence.reject', entityType: 'document', entityId: doc.id, entityLabel: `${doc.code} · ${doc.title}`, summary: decision === 'accept' ? `Versión ${v.version} aceptada.${computedNote}` : `Versión ${v.version} rechazada; se conserva en el historial.`, reason: decision === 'reject' ? input.rejectionReason!.trim() : input.note.trim() || null, employeeId: doc.employeeId, version: `v${v.version}`, changes });
    tx.notify({ type: decision === 'accept' ? 'evidence.accept' : 'evidence.reject', title: decision === 'accept' ? 'Evidencia aceptada' : 'Evidencia rechazada', body: doc.title, recipientUserIds: audience([v.submittedBy, employeeUser(ctx.db, doc.employeeId), decision === 'reject' ? managerUser(ctx.db, doc.employeeId) : null], ctx.user.id), link: `/documentacion/${doc.id}`, dedupeKey: `ev-dec:${v.id}` });
    if (doc.employeeId) auditReadinessChanges(tx, ctx, [doc.employeeId], `${doc.code} ${decision === 'accept' ? 'aceptado' : 'rechazado'}`);
    else auditReadinessChanges(tx, ctx, ctx.db.employees.filter((e) => e.companyId === ctx.company.id).map((e) => e.id), `${doc.code} ${decision === 'accept' ? 'aceptado' : 'rechazado'}`);
    return u;
  });
}

/** Reviewer corrects or confirms the dates of an accepted version (audited with before/after). */
export async function updateDates(versionId: ID, input: { expiryMode: DocumentVersion['expiryMode']; legalExpiryDate: ISODate | null; providerReviewDate: ISODate | null; internalFollowUpDate: ISODate | null; reason: string }): Promise<DocumentVersion> {
  await latency();
  const ctx = getCtx();
  const { doc, v } = findVersion(ctx, versionId);
  const isFollowUpOnly = input.expiryMode === v.expiryMode && input.legalExpiryDate === v.legalExpiryDate && input.providerReviewDate === v.providerReviewDate;
  if (!canDecide(ctx, doc) && !(isFollowUpOnly && can(ctx, 'evidence.request'))) throw new PermissionError('Las fechas legales y de revisión las confirma la autoridad de revisión.');
  if (v.status === 'superseded' || v.status === 'rejected') throw new BusinessRuleError('No se modifican fechas de versiones sustituidas o rechazadas.');
  const errors: string[] = [];
  if (!input.reason.trim()) errors.push('Indique la fuente o el motivo del cambio de fechas.');
  const legal = input.expiryMode === 'date' ? checkDate(errors, input.legalExpiryDate, 'Caducidad legal', { required: true }) : null;
  const review = checkDate(errors, input.providerReviewDate, 'Revisión del proveedor');
  const follow = checkDate(errors, input.internalFollowUpDate, 'Seguimiento interno');
  if (errors.length) throw new BusinessRuleError('Revise las fechas', errors);
  const label = (mode: string, d: string | null) => d ?? (mode === 'none' ? 'Sin caducidad' : 'No indicada');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('docVersions', v.id, { expiryMode: input.expiryMode, legalExpiryDate: legal, providerReviewDate: review, internalFollowUpDate: follow });
    tx.audit({
      action: 'evidence.dates',
      entityType: 'document',
      entityId: doc.id,
      entityLabel: `${doc.code} · ${doc.title}`,
      summary: `Fechas revisadas en la versión ${v.version}.`,
      reason: input.reason.trim(),
      employeeId: doc.employeeId,
      version: `v${v.version}`,
      changes: [
        { field: 'Caducidad legal', before: label(v.expiryMode, v.legalExpiryDate), after: label(input.expiryMode, legal) },
        { field: 'Revisión del proveedor', before: v.providerReviewDate ?? '—', after: review ?? '—' },
        { field: 'Seguimiento interno', before: v.internalFollowUpDate ?? '—', after: follow ?? '—' },
      ].filter((c) => c.before !== c.after),
    });
    if (doc.employeeId) auditReadinessChanges(tx, ctx, [doc.employeeId], `fechas de ${doc.code}`);
    return u;
  });
}

/**
 * Demo download. Health/quarantined files are never downloadable from the ordinary portal; an
 * attempt is denied and audited. Metadata-only demo files have no content to download.
 */
export async function downloadDocument(versionId: ID): Promise<DemoFile> {
  await latency(150);
  const ctx = getCtx();
  const v = ctx.db.docVersions.find((x) => x.id === versionId);
  const doc = v ? ctx.db.documents.find((d) => d.id === v.documentId) : undefined;
  if (!v || !doc || doc.companyId !== ctx.company.id) throw new NotFoundError();
  if (doc.accessClass === 'health' || doc.accessClass === 'quarantined') {
    recordDeniedAccess(`Descarga de ${doc.code} (contenido restringido)`, doc.employeeId);
    throw new PermissionError('Archivo restringido: no se puede descargar desde el portal ordinario. El intento queda registrado.');
  }
  if (!canSeeDocument(ctx, doc)) throw new NotFoundError();
  if (!v.file) throw new BusinessRuleError('Esta versión no tiene archivo (solo metadatos).');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.audit({ action: 'evidence.download', entityType: 'document', entityId: doc.id, entityLabel: `${doc.code} · ${doc.title}`, summary: `Descarga de la versión ${v.version} (${v.file!.name}).`, employeeId: doc.employeeId, version: `v${v.version}` });
  });
  return v.file;
}

/** Acknowledgement of the CURRENT accepted version of an information/instruction document. */
export async function acknowledgeDocument(documentId: ID, onBehalfOf?: ID): Promise<Acknowledgement> {
  await latency();
  const ctx = getCtx();
  const doc = ownCompany(ctx, ctx.db.documents.find((d) => d.id === documentId));
  const employeeId = onBehalfOf ?? ctx.employee?.id;
  if (!employeeId) throw new PermissionError('Solo una persona trabajadora puede confirmar la recepción.');
  const self = employeeId === ctx.employee?.id;
  if (self ? !can(ctx, 'own.acknowledge') : !can(ctx, 'evidence.upload')) throw new PermissionError();
  if (!self) requireEmployeeVisible(ctx, employeeId);
  if (doc.employeeId) throw new BusinessRuleError('Solo se confirma información o instrucciones generales.');
  // Only information that applies to the person (or that they confirmed in an earlier version).
  const applies = matrixFor(ctx.db, ctx.company.id, employeeId, ctx.today, alertDays(ctx)).some((it) => it.version.instructionDocumentId === doc.id);
  const earlier = ctx.db.acknowledgements.some((a) => a.employeeId === employeeId && a.subject.kind === 'document' && a.subject.id === doc.id);
  if (!applies && !earlier) throw new BusinessRuleError('Esta información no está asignada a la persona trabajadora.');
  const current = [...ctx.db.docVersions.filter((x) => x.documentId === doc.id)].sort((a, b) => b.version - a.version).find((x) => x.status === 'accepted');
  if (!current) throw new BusinessRuleError('La información no tiene una versión aprobada.');
  if (ctx.db.acknowledgements.some((a) => a.employeeId === employeeId && a.subject.kind === 'document' && a.subject.id === doc.id && a.documentVersionId === current.id)) throw new BusinessRuleError('Ya consta la confirmación de esta versión.');
  const row: Acknowledgement = { id: newId('ack'), companyId: ctx.company.id, employeeId, subject: { kind: 'document', id: doc.id }, documentVersionId: current.id, acknowledgedAt: nowInstant(), method: self ? 'in_app' : 'paper_recorded', recordedBy: ctx.user.id, statement: self ? 'He recibido y leído la información. La confirmación no sustituye a la formación.' : 'Confirmación firmada en papel registrada por la empresa.' };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('acknowledgements', row);
    tx.audit({ action: 'acknowledgement.record', entityType: 'document', entityId: doc.id, entityLabel: `${doc.code} · ${doc.title}`, summary: `${employeeName(ctx.db, employeeId)} confirma la recepción de la versión ${current.version}${self ? '' : ' (registro en papel)'}. No acredita formación.`, employeeId, version: `v${current.version}` });
    auditReadinessChanges(tx, ctx, [employeeId], `confirmación de ${doc.code}`);
    return row;
  });
}

export async function acknowledgeIssue(issueId: ID, onBehalfOf?: ID): Promise<Acknowledgement> {
  await latency();
  const ctx = getCtx();
  const issue = ownCompany(ctx, ctx.db.issues.find((x) => x.id === issueId));
  const self = issue.employeeId === ctx.employee?.id && !onBehalfOf;
  if (self ? !can(ctx, 'own.acknowledge') : !(can(ctx, 'ppe.manage') && canSeeEmployee(ctx, issue.employeeId))) throw new PermissionError();
  if (issue.status !== 'issued') throw new BusinessRuleError('El equipo ya no está entregado.');
  if (ctx.db.acknowledgements.some((a) => a.subject.kind === 'ppe_issue' && a.subject.id === issue.id)) throw new BusinessRuleError('Ya consta la confirmación de esta entrega.');
  const item = ctx.db.equipment.find((x) => x.id === issue.itemId);
  const row: Acknowledgement = { id: newId('ack'), companyId: ctx.company.id, employeeId: issue.employeeId, subject: { kind: 'ppe_issue', id: issue.id }, documentVersionId: null, acknowledgedAt: nowInstant(), method: self ? 'in_app' : 'paper_recorded', recordedBy: ctx.user.id, statement: self ? 'He recibido el equipo y las instrucciones de uso y mantenimiento del fabricante.' : 'Recibí firmado en papel registrado por la empresa.' };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('acknowledgements', row);
    tx.audit({ action: 'acknowledgement.record', entityType: 'ppe', entityId: issue.id, entityLabel: item?.name ?? issue.itemId, summary: `${employeeName(ctx.db, issue.employeeId)} confirma la recepción del equipo${self ? '' : ' (registro en papel)'}.`, employeeId: issue.employeeId });
    auditReadinessChanges(tx, ctx, [issue.employeeId], 'confirmación de entrega de EPI');
    return row;
  });
}

/** Documents visible to the caller (health and quarantined never listed here). */
export function visibleDocuments(ctx: Ctx): EvidenceDocument[] {
  return ctx.db.documents.filter((d) => d.accessClass !== 'health' && d.accessClass !== 'quarantined' && canSeeDocument(ctx, d));
}

export function versionsOfDocument(ctx: Ctx, documentId: ID): DocumentVersion[] {
  return ctx.db.docVersions.filter((v) => v.documentId === documentId && v.companyId === ctx.company.id).sort((a, b) => b.version - a.version);
}

/** Current state of a document: latest accepted, pending and the full history. */
export function documentState(ctx: Ctx, documentId: ID) {
  const versions = versionsOfDocument(ctx, documentId);
  return { versions, accepted: versions.find((v) => v.status === 'accepted') ?? null, pending: versions.find((v) => v.status === 'received' || v.status === 'in_review') ?? null, latest: versions[0] ?? null };
}
