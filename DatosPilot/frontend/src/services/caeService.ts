/**
 * Shared-worksite coordination (CAE; RD 171/2004, LPRL art. 24; PRL-06).
 *
 * CAE is a coordination record, not a folder of certificates: each exchange stores sending,
 * recipient receipt, recipient acknowledgement and the review decision as separate facts. Only
 * accepted, worksite-relevant, non-restricted evidence can be sent or shared. Share links are
 * SIMULATED: scoped to one case, one recipient and an expiry; every access is audited.
 * Construction-specific CAE (RD 1627/1997) is outside the initial scope.
 */
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { addDays, nowInstant } from '../domain/time';
import { demoHash } from '../domain/ids';
import { newId } from '../domain/ids';
import type { CaeCase, CaeExchange, CaeParticipant, DocumentVersion, EvidenceDocument, ID, ISODate, ShareLink } from '../domain/types';
import { transact } from '../store/db';
import { audience, checkDate } from './common';
import { can, getCtx, latency, ownCompany, requirePerm, visibleWorksiteIds, worksiteName, type Ctx } from './context';

export type CaseInput = Pick<CaeCase, 'worksiteId' | 'title' | 'activities' | 'risksSummary' | 'coordinationMeans' | 'followUpOwnerId' | 'nextFollowUp' | 'openQuestions'>;

export function validateCase(ctx: Ctx, input: CaseInput): string[] {
  const e: string[] = [];
  if (!ctx.db.worksites.some((w) => w.id === input.worksiteId && w.companyId === ctx.company.id)) e.push('Centro de trabajo: obligatorio.');
  if (!input.title.trim()) e.push('Título: obligatorio.');
  const f = checkDate(e, input.nextFollowUp, 'Próximo seguimiento');
  if (f && f < ctx.today) e.push('El próximo seguimiento no puede estar en el pasado.');
  if (f && !input.followUpOwnerId) e.push('Indique quién hace el seguimiento.');
  const site = ctx.db.worksites.find((w) => w.id === input.worksiteId);
  if (site && site.riskTags.some((t) => ctx.db.riskTags.some((r) => r.id === t && r.companyId === ctx.company.id && r.specialist))) e.push('El centro tiene riesgos de alcance especializado (p. ej. obras de construcción): la CAE específica queda fuera del alcance inicial.');
  return e;
}

function caseOf(ctx: Ctx, id: ID): CaeCase {
  const c = ownCompany(ctx, ctx.db.caeCases.find((x) => x.id === id));
  if (!visibleWorksiteIds(ctx).has(c.worksiteId) || !(can(ctx, 'cae.view') || can(ctx, 'representative.view'))) throw new NotFoundError();
  return c;
}

export async function createCase(input: CaseInput, participants: Omit<CaeParticipant, 'id'>[]): Promise<CaeCase> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const errors = validateCase(ctx, input);
  if (!participants.some((p) => !p.isOwnCompany)) errors.push('Añada al menos otra empresa participante.');
  participants.forEach((p, i) => {
    if (!p.organisation.trim() || !p.contactName.trim()) errors.push(`Participante ${i + 1}: organización y contacto obligatorios.`);
  });
  if (errors.length) throw new BusinessRuleError('Revise el caso', errors);
  const count = ctx.db.caeCases.filter((c) => c.companyId === ctx.company.id).length;
  const row: CaeCase = { id: newId('cae'), companyId: ctx.company.id, code: `CAE-${String(count + 1).padStart(3, '0')}`, status: 'open', participants: participants.map((p, i) => ({ ...p, id: `p${i + 1}` })), createdBy: ctx.user.id, createdAt: nowInstant(), closedAt: null, ...input };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('caeCases', row);
    tx.audit({ action: 'cae.create', entityType: 'cae', entityId: row.id, entityLabel: `${row.code} · ${row.title}`, summary: `Caso creado para ${worksiteName(ctx.db, row.worksiteId)} con ${row.participants.length} participantes.` });
    if (row.followUpOwnerId) tx.notify({ type: 'cae.create', title: 'Nueva coordinación CAE', body: `${row.code} ${row.title}`, recipientUserIds: audience([row.followUpOwnerId], ctx.user.id), link: `/cae/${row.id}`, dedupeKey: `cae:${row.id}` });
    return row;
  });
}

export async function updateCase(id: ID, input: CaseInput): Promise<CaeCase> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const c = caseOf(ctx, id);
  if (c.status === 'closed') throw new BusinessRuleError('El caso está cerrado.');
  const errors = validateCase(ctx, { ...input, worksiteId: c.worksiteId });
  if (errors.length) throw new BusinessRuleError('Revise el caso', errors);
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('caeCases', c.id, { ...input, worksiteId: c.worksiteId, status: c.status === 'open' ? 'active' : c.status });
    tx.audit({ action: 'cae.update', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · ${c.title}`, summary: 'Caso actualizado.', changes: [{ field: 'Próximo seguimiento', before: c.nextFollowUp ?? '—', after: input.nextFollowUp ?? '—' }].filter((x) => x.before !== x.after) });
    return u;
  });
}

export async function addParticipant(caseId: ID, p: Omit<CaeParticipant, 'id' | 'isOwnCompany'>): Promise<CaeCase> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const c = caseOf(ctx, caseId);
  if (!p.organisation.trim() || !p.contactName.trim()) throw new BusinessRuleError('Organización y contacto obligatorios.');
  const participant: CaeParticipant = { ...p, organisation: p.organisation.trim(), contactName: p.contactName.trim(), id: `p${c.participants.length + 1}`, isOwnCompany: false };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('caeCases', c.id, { participants: [...c.participants, participant] });
    tx.audit({ action: 'cae.participant', entityType: 'cae', entityId: c.id, entityLabel: c.code, summary: `Participante añadido: ${participant.organisation} (${participant.contactName}).` });
    return u;
  });
}

/** Approved, worksite-relevant, non-restricted document versions that may be sent or shared. */
export function shareableVersions(ctx: Ctx, c: CaeCase): { doc: EvidenceDocument; version: DocumentVersion }[] {
  const out: { doc: EvidenceDocument; version: DocumentVersion }[] = [];
  for (const d of ctx.db.documents) {
    if (d.companyId !== ctx.company.id || d.accessClass !== 'ordinary' || d.employeeId) continue;
    if (d.worksiteId && d.worksiteId !== c.worksiteId) continue;
    if (!['evaluacion_riesgos', 'info_riesgos', 'instruccion_centro', 'coordinacion', 'doc_spa'].includes(d.categoryId)) continue;
    const v = ctx.db.docVersions.filter((x) => x.documentId === d.id && x.status === 'accepted').sort((a, b) => b.version - a.version)[0];
    if (v) out.push({ doc: d, version: v });
  }
  return out;
}

export interface ExchangeInput {
  caseId: ID;
  direction: CaeExchange['direction'];
  subject: string;
  documentVersionId: ID | null;
  senderParticipantId: ID;
  recipientParticipantId: ID;
  sentAt: ISODate | null;
  followUp: string;
}

export async function recordExchange(input: ExchangeInput): Promise<CaeExchange> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const c = caseOf(ctx, input.caseId);
  if (c.status === 'closed') throw new BusinessRuleError('El caso está cerrado.');
  const errors: string[] = [];
  if (!input.subject.trim()) errors.push('Asunto: obligatorio.');
  const sender = c.participants.find((p) => p.id === input.senderParticipantId);
  const recipient = c.participants.find((p) => p.id === input.recipientParticipantId);
  if (!sender || !recipient || sender.id === recipient.id) errors.push('Indique remitente y destinatario distintos.');
  if (input.direction === 'sent' && sender && !sender.isOwnCompany) errors.push('En un envío, el remitente es la propia empresa.');
  if (input.direction === 'received' && recipient && !recipient.isOwnCompany) errors.push('En una recepción, el destinatario es la propia empresa.');
  const sent = checkDate(errors, input.sentAt, 'Fecha de envío');
  if (sent && sent > ctx.today) errors.push('La fecha de envío no puede ser futura.');
  let version: DocumentVersion | undefined;
  if (input.documentVersionId) {
    version = ctx.db.docVersions.find((v) => v.id === input.documentVersionId && v.companyId === ctx.company.id);
    if (input.direction === 'sent' && !shareableVersions(ctx, c).some((x) => x.version.id === input.documentVersionId)) errors.push('Solo se envía evidencia aceptada, no restringida y relevante para este centro.');
    if (input.direction === 'received') {
      const doc = version && ctx.db.documents.find((d) => d.id === version!.documentId);
      if (!doc || (doc.caseId !== c.id && doc.worksiteId !== c.worksiteId)) errors.push('La documentación recibida debe estar registrada en este caso o en su centro.');
    }
  }
  if (errors.length) throw new BusinessRuleError('Revise el intercambio', errors);
  const now = nowInstant();
  const row: CaeExchange = {
    id: newId('x'),
    companyId: ctx.company.id,
    caseId: c.id,
    direction: input.direction,
    subject: input.subject.trim(),
    documentId: version?.documentId ?? null,
    documentVersionId: version?.id ?? null,
    versionLabel: version ? `v${version.version}` : '—',
    senderParticipantId: input.senderParticipantId,
    recipientParticipantId: input.recipientParticipantId,
    sentAt: sent ? `${sent}T10:00:00.000Z` : null,
    // A received item is, by definition, received by us; acknowledgement and review stay separate.
    receivedAt: input.direction === 'received' ? now : null,
    receiptConfirmedBy: input.direction === 'received' ? ctx.user.name : null,
    acknowledgedAt: null,
    review: input.direction === 'received' ? 'pending' : 'not_required',
    reviewedBy: null,
    reviewNote: null,
    followUp: input.followUp.trim(),
    createdBy: ctx.user.id,
    createdAt: now,
  };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('caeExchanges', row);
    if (c.status === 'open') tx.update('caeCases', c.id, { status: 'active' });
    tx.audit({ action: input.direction === 'sent' ? 'cae.sent' : 'cae.exchange', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · ${row.subject}`, summary: input.direction === 'sent' ? `Envío registrado a ${recipient!.organisation}${sent ? ` (${sent})` : ' (pendiente de envío)'}. La recepción y el acuse se registran aparte.` : `Recepción de ${sender!.organisation} registrada; revisión pendiente.`, recipient: recipient!.organisation, version: row.versionLabel });
    return row;
  });
}

export type ExchangeStep = 'sent' | 'receipt' | 'acknowledged';

/** Records one fact about an exchange; each is separate (sending ≠ receipt ≠ understanding). */
export async function recordExchangeStep(id: ID, stepName: ExchangeStep, input: { date: ISODate; confirmedBy: string }): Promise<CaeExchange> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const x = ownCompany(ctx, ctx.db.caeExchanges.find((e) => e.id === id));
  const c = caseOf(ctx, x.caseId);
  const errors: string[] = [];
  const d = checkDate(errors, input.date, 'Fecha', { required: true });
  if (d && d > ctx.today) errors.push('La fecha no puede ser futura.');
  if (x.direction !== 'sent') errors.push('Solo los envíos tienen pasos de envío, recepción y acuse.');
  if (stepName === 'sent' && x.sentAt) errors.push('El envío ya está registrado.');
  if (stepName === 'receipt' && (!x.sentAt || x.receivedAt)) errors.push(x.receivedAt ? 'La recepción ya está registrada.' : 'Registre primero el envío.');
  if (stepName === 'receipt' && !input.confirmedBy.trim()) errors.push('Indique quién confirma la recepción en la empresa destinataria.');
  if (stepName === 'acknowledged' && (!x.receivedAt || x.acknowledgedAt)) errors.push(x.acknowledgedAt ? 'El acuse ya está registrado.' : 'Registre primero la recepción: el envío o la subida no implican recepción.');
  if (d && x.sentAt && d < x.sentAt.slice(0, 10)) errors.push('La fecha no puede ser anterior al envío.');
  if (errors.length) throw new BusinessRuleError('Revise el paso', errors);
  const at = `${d}T12:00:00.000Z`;
  const recipient = c.participants.find((p) => p.id === x.recipientParticipantId);
  const patch: Partial<CaeExchange> = stepName === 'sent' ? { sentAt: at } : stepName === 'receipt' ? { receivedAt: at, receiptConfirmedBy: input.confirmedBy.trim() } : { acknowledgedAt: at };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('caeExchanges', x.id, patch);
    tx.audit({ action: stepName === 'sent' ? 'cae.sent' : stepName === 'receipt' ? 'cae.received' : 'cae.acknowledged', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · ${x.subject}`, summary: stepName === 'sent' ? `Enviado el ${d}.` : stepName === 'receipt' ? `Recepción confirmada por ${input.confirmedBy.trim()} el ${d}.` : `Acuse de comprensión del destinatario el ${d}.`, recipient: recipient?.organisation ?? null, version: x.versionLabel });
    return u;
  });
}

export async function reviewExchange(id: ID, decision: 'accepted' | 'rejected', note: string): Promise<CaeExchange> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  if (!can(ctx, 'evidence.review')) throw new PermissionError('La revisión del contenido corresponde a la coordinación de PRL o al servicio de prevención.');
  const x = ownCompany(ctx, ctx.db.caeExchanges.find((e) => e.id === id));
  const c = caseOf(ctx, x.caseId);
  if (x.direction !== 'received' || x.review !== 'pending') throw new BusinessRuleError('Solo se revisa información recibida pendiente.');
  if (!note.trim()) throw new BusinessRuleError('Indique la nota de revisión.');
  return transact(ctx.actor, ctx.company.id, (tx) => {
    const u = tx.update('caeExchanges', x.id, { review: decision, reviewedBy: ctx.user.id, reviewNote: note.trim() });
    tx.audit({ action: 'cae.review', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · ${x.subject}`, summary: decision === 'accepted' ? 'Información recibida revisada y aceptada.' : 'Información recibida con objeciones.', reason: note.trim() });
    return u;
  });
}

export async function closeCase(id: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const c = caseOf(ctx, id);
  if (c.status === 'closed') throw new BusinessRuleError('El caso ya está cerrado.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo (fin de la concurrencia, fin del contrato…).');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('caeCases', c.id, { status: 'closed', closedAt: nowInstant() });
    for (const l of ctx.db.shareLinks) if (l.caseId === c.id && !l.revokedAt) tx.update('shareLinks', l.id, { revokedAt: nowInstant() });
    tx.audit({ action: 'cae.close', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · ${c.title}`, summary: 'Caso cerrado; enlaces revocados. El historial se conserva.', reason: reason.trim() });
  });
}

export async function createShareLink(caseId: ID, recipientParticipantId: ID, documentVersionIds: ID[], expiresOn: ISODate): Promise<ShareLink> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const c = caseOf(ctx, caseId);
  const errors: string[] = [];
  const recipient = c.participants.find((p) => p.id === recipientParticipantId);
  if (!recipient || recipient.isOwnCompany) errors.push('El destinatario debe ser otra empresa participante.');
  const exp = checkDate(errors, expiresOn, 'Caducidad del enlace', { required: true });
  if (exp && (exp <= ctx.today || exp > addDays(ctx.today, ctx.settings.shareLinkMaxDays))) errors.push(`La caducidad debe estar entre mañana y ${ctx.settings.shareLinkMaxDays} días.`);
  const allowed = new Set(shareableVersions(ctx, c).map((x) => x.version.id));
  if (!documentVersionIds.length) errors.push('Seleccione al menos un documento.');
  if (documentVersionIds.some((id) => !allowed.has(id))) errors.push('Solo se comparte evidencia aceptada, no restringida y relevante para este centro.');
  if (c.status === 'closed') errors.push('El caso está cerrado.');
  if (errors.length) throw new BusinessRuleError('Revise el enlace', errors);
  const now = nowInstant();
  const row: ShareLink = { id: newId('lnk'), companyId: ctx.company.id, caseId: c.id, recipientParticipantId, token: `demo-${demoHash(now + caseId).slice(0, 8)}`, documentVersionIds, createdBy: ctx.user.id, createdAt: now, expiresOn: exp!, revokedAt: null, accessLog: [] };
  return transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('shareLinks', row);
    tx.audit({ action: 'cae.link_create', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · enlace ${row.token}`, summary: `Enlace simulado para ${recipient!.organisation} con ${documentVersionIds.length} documentos, válido hasta ${exp}.`, recipient: recipient!.organisation });
    return row;
  });
}

export async function revokeShareLink(id: ID, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const l = ownCompany(ctx, ctx.db.shareLinks.find((x) => x.id === id));
  const c = caseOf(ctx, l.caseId);
  if (l.revokedAt) throw new BusinessRuleError('El enlace ya está revocado.');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('shareLinks', l.id, { revokedAt: nowInstant() });
    tx.audit({ action: 'cae.link_revoke', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · enlace ${l.token}`, summary: 'Enlace revocado: los accesos posteriores se rechazan.', reason: reason.trim(), recipient: c.participants.find((p) => p.id === l.recipientParticipantId)?.organisation ?? null });
  });
}

/** Simulates the recipient opening the link: refused (and audited) when revoked or expired. */
export async function simulateLinkAccess(id: ID): Promise<{ docs: { doc: EvidenceDocument; version: DocumentVersion }[] }> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'cae.manage');
  const l = ownCompany(ctx, ctx.db.shareLinks.find((x) => x.id === id));
  const c = caseOf(ctx, l.caseId);
  const recipient = c.participants.find((p) => p.id === l.recipientParticipantId)?.organisation ?? null;
  const valid = !l.revokedAt && l.expiresOn >= ctx.today;
  transact(ctx.actor, ctx.company.id, (tx) => {
    if (valid) tx.update('shareLinks', l.id, { accessLog: [...l.accessLog, nowInstant()] });
    tx.audit({ action: 'cae.link_access', entityType: 'cae', entityId: c.id, entityLabel: `${c.code} · enlace ${l.token}`, summary: valid ? `Acceso simulado del destinatario a ${l.documentVersionIds.length} documentos.` : 'Acceso rechazado: enlace revocado o caducado.', recipient });
  });
  if (!valid) throw new BusinessRuleError('Enlace revocado o caducado: acceso rechazado (queda registrado).');
  const docs = l.documentVersionIds
    .map((vid) => {
      const version = ctx.db.docVersions.find((v) => v.id === vid)!;
      return { version, doc: ctx.db.documents.find((d) => d.id === version?.documentId)! };
    })
    .filter((x) => x.doc && x.version);
  return { docs };
}

export function visibleCases(ctx: Ctx): CaeCase[] {
  if (!can(ctx, 'cae.view') && !can(ctx, 'representative.view')) return [];
  const sites = visibleWorksiteIds(ctx);
  return ctx.db.caeCases.filter((c) => c.companyId === ctx.company.id && sites.has(c.worksiteId));
}

/** Open coordination points of a case: unsent, unreceived, unacknowledged, unreviewed. */
export function casePending(ctx: Ctx, c: CaeCase) {
  // A closed case has no open points (its history stays visible).
  const xs = c.status === 'closed' ? [] : ctx.db.caeExchanges.filter((x) => x.caseId === c.id);
  return {
    notSent: xs.filter((x) => x.direction === 'sent' && !x.sentAt).length,
    noReceipt: xs.filter((x) => x.direction === 'sent' && x.sentAt && !x.receivedAt).length,
    noAck: xs.filter((x) => x.direction === 'sent' && x.receivedAt && !x.acknowledgedAt).length,
    toReview: xs.filter((x) => x.direction === 'received' && x.review === 'pending').length,
    followUpOverdue: !!c.nextFollowUp && c.nextFollowUp < ctx.today && c.status !== 'closed',
  };
}
