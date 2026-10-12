/**
 * Exceptions and change monitoring ("Incidencias y revisiones").
 *
 * Exceptions are DERIVED on every read from the requirement matrix, documents, actions, CAE
 * exchanges, change reviews and (restricted) health records. Only the human review of each one
 * (status, owner, history) is stored, keyed by a deterministic key. A resolved exception whose
 * cause persists stays visible as "resolved" with its cause still shown; when the cause goes
 * away the exception disappears from the active queue.
 */
import type { Database, ExceptionReview, ExceptionStatus, ID, ISODate, Msg, ReviewAuthority, RoleId } from './types';
import { addDays, formatDate } from './time';
import { AUTHORITY_ROLE, isMembershipActive } from './permissions';
import { ITEM_STATUS } from './status';
import { allReadiness, idx } from './requirements';

export type ExceptionType =
  | 'critical_gap'
  | 'missing_evidence'
  | 'rejected_document'
  | 'expiring_document'
  | 'expired_document'
  | 'provider_review'
  | 'missing_date'
  | 'superseded_evidence'
  | 'change_review'
  | 'action_open'
  | 'unacknowledged'
  | 'cae_pending'
  | 'assessment_review'
  | 'health_pending'
  | 'quarantine';

export const EXCEPTION_TYPE_LABEL: Record<ExceptionType, string> = {
  critical_gap: 'Requisito crítico sin resolver',
  missing_evidence: 'Falta evidencia obligatoria',
  rejected_document: 'Documento rechazado',
  expiring_document: 'Caducidad próxima',
  expired_document: 'Documento caducado',
  provider_review: 'Fecha de revisión del proveedor',
  missing_date: 'Fecha o decisión pendiente (revisión necesaria)',
  superseded_evidence: 'Evidencia de una versión anterior del requisito',
  change_review: 'Cambio de puesto o centro pendiente de revisar',
  action_open: 'Acción preventiva sin resolver',
  unacknowledged: 'Información o instrucción sin confirmar',
  cae_pending: 'Coordinación CAE pendiente',
  assessment_review: 'Evaluación de riesgos por revisar',
  health_pending: 'Área de salud: conclusión o medida pendiente',
  quarantine: 'Documento en cuarentena',
};

export interface DetectedException {
  key: string;
  type: ExceptionType;
  employeeId: ID | null;
  worksiteId: ID | null;
  templateId: ID | null;
  source: Msg;
  reason: Msg;
  /** Person responsible for the next step (derived from the configuration). */
  ownerUserId: ID | null;
  /** Only a date that legitimately exists (expiry, provider review, action target…). */
  targetDate: ISODate | null;
  nextAction: Msg;
  link: string;
  restricted: boolean;
  severity: 'high' | 'medium' | 'low';
}

export interface ExceptionView extends DetectedException {
  status: ExceptionStatus;
  review: ExceptionReview | null;
}

const m = (text: string, params?: Msg['params']): Msg => ({ text, params });

/** Fills a message's params into its Spanish text, so it can be nested as a param (t() still translates it via templates). */
export const fillMsg = (msg: Msg): string =>
  msg.text.replace(/\{(\w+)\}/g, (all, k: string) => {
    const v = msg.params?.[k];
    if (v === undefined) return all;
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : String(v);
  });

/** First active user holding a role in the company (the configured responsible person). */
export function userWithRole(db: Database, companyId: ID, role: RoleId, date: ISODate): ID | null {
  return db.memberships.find((x) => x.companyId === companyId && x.roles.includes(role) && isMembershipActive(x, date))?.userId ?? null;
}

export function authorityUser(db: Database, companyId: ID, authority: ReviewAuthority, date: ISODate): ID | null {
  return userWithRole(db, companyId, AUTHORITY_ROLE[authority], date);
}

export function detectExceptions(db: Database, companyId: ID, date: ISODate, alertDays: number): DetectedException[] {
  const out: DetectedException[] = [];
  const coordinator = userWithRole(db, companyId, 'prl_coordinator', date);
  const medical = userWithRole(db, companyId, 'provider_medical', date);
  const soon = addDays(date, alertDays);
  const seen = new Set<string>();
  const add = (e: DetectedException) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    out.push(e);
  };

  // Requirement items of every active employee.
  for (const r of allReadiness(db, companyId, date, alertDays)) {
    for (const it of r.items) {
      if (!it.counted || it.satisfied) continue;
      const base = { employeeId: it.employeeId, worksiteId: it.worksiteId, templateId: it.template.id, source: m('{code} · {name}', { code: it.template.code, name: it.version.name }), link: `/empleados/${it.employeeId}?tab=requisitos` };
      const reviewer = authorityUser(db, companyId, it.version.reviewAuthority, date);
      if (it.restricted) {
        add({ ...base, key: `health:${it.key}`, type: 'health_pending', reason: it.reason, ownerUserId: medical, targetDate: null, nextAction: m('Registrar la oferta, la respuesta o la conclusión en el área restringida.'), link: `/salud?empleado=${it.employeeId}`, restricted: true, severity: it.critical ? 'high' : 'medium' });
        continue;
      }
      if (it.critical && r.state === 'blocked') {
        add({ ...base, key: `critical:${it.key}`, type: 'critical_gap', reason: m('Bloquea la asignación: {status}. {detail}', { status: ITEM_STATUS[it.status].label, detail: fillMsg(it.reason) }), ownerUserId: coordinator, targetDate: null, nextAction: m('Resolver el requisito antes de asignar; solo una excepción validada puede cubrirlo.'), restricted: false, severity: 'high' });
      }
      switch (it.status) {
        case 'missing':
        case 'requested':
          if (!it.critical) add({ ...base, key: `missing:${it.key}`, type: 'missing_evidence', reason: it.reason, ownerUserId: coordinator, targetDate: it.evidence.internalFollowUpDate, nextAction: it.status === 'missing' ? m('Solicitar la evidencia a la persona responsable.') : m('Hacer seguimiento de la solicitud.'), restricted: false, severity: 'medium' });
          break;
        case 'expired':
          add({ ...base, key: `expired:${it.evidence.acceptedVersionId}`, type: 'expired_document', reason: it.reason, ownerUserId: coordinator, targetDate: it.evidence.legalExpiryDate, nextAction: m('Solicitar la renovación del documento.'), restricted: false, severity: 'high' });
          break;
        case 'review_due':
          add({ ...base, key: `review:${it.key}`, type: 'provider_review', reason: it.reason, ownerUserId: reviewer, targetDate: it.evidence.providerReviewDate, nextAction: m('Realizar la revisión programada y registrar el resultado.'), restricted: false, severity: 'medium' });
          break;
        case 'review_required':
          if (it.reason.text.startsWith('Aceptada con la versión')) add({ ...base, key: `superseded:${it.key}`, type: 'superseded_evidence', reason: it.reason, ownerUserId: reviewer, targetDate: null, nextAction: m('Revisar la evidencia con los criterios de la versión vigente.'), restricted: false, severity: 'medium' });
          else add({ ...base, key: `date:${it.key}`, type: 'missing_date', reason: it.reason, ownerUserId: reviewer, targetDate: null, nextAction: m('Obtener la fecha o la decisión del profesional responsable.'), restricted: false, severity: 'medium' });
          break;
        case 'pending_ack':
          add({ ...base, key: `ack:${it.key}`, type: 'unacknowledged', reason: it.reason, ownerUserId: coordinator, targetDate: null, nextAction: m('Recordar a la persona trabajadora que confirme la información.'), restricted: false, severity: 'low' });
          break;
        default:
          break;
      }
    }
    // Upcoming actual dates on satisfied items.
    for (const it of r.items) {
      if (it.restricted || !it.satisfied) continue;
      if (it.evidence.expiringSoon) add({ key: `expiring:${it.evidence.acceptedVersionId}`, type: 'expiring_document', employeeId: it.employeeId, worksiteId: it.worksiteId, templateId: it.template.id, source: m('{code} · {name}', { code: it.template.code, name: it.version.name }), reason: m('Caduca el {date} (fecha indicada en el documento).', { date: it.evidence.legalExpiryDate ?? '—' }), ownerUserId: coordinator, targetDate: it.evidence.legalExpiryDate, nextAction: m('Solicitar la renovación antes de la fecha.'), link: `/empleados/${it.employeeId}?tab=requisitos`, restricted: false, severity: 'medium' });
      if (it.evidence.reviewSoon) add({ key: `review:${it.key}`, type: 'provider_review', employeeId: it.employeeId, worksiteId: it.worksiteId, templateId: it.template.id, source: m('{code} · {name}', { code: it.template.code, name: it.version.name }), reason: m('Revisión programada el {date}.', { date: it.evidence.providerReviewDate ?? '—' }), ownerUserId: authorityUser(db, companyId, it.version.reviewAuthority, date), targetDate: it.evidence.providerReviewDate, nextAction: m('Preparar la revisión programada.'), link: `/empleados/${it.employeeId}?tab=requisitos`, restricted: false, severity: 'low' });
    }
  }

  // Rejected documents without a newer version (kept even when the item is not counted).
  const i = idx(db);
  for (const d of db.documents) {
    if (d.companyId !== companyId || d.accessClass === 'health' || d.accessClass === 'quarantined') continue;
    const versions = i.dvByDoc.get(d.id) ?? [];
    const last = versions[versions.length - 1];
    if (last?.status === 'rejected') add({ key: `rejected:${last.id}`, type: 'rejected_document', employeeId: d.employeeId, worksiteId: d.worksiteId, templateId: d.templateId, source: m('{code} · {title}', { code: d.code, title: d.title }), reason: m('Versión {n} rechazada: {reason}', { n: last.version, reason: last.rejectionReason ?? '—' }), ownerUserId: last.submittedBy, targetDate: null, nextAction: m('Presentar una versión corregida o aclarar el motivo.'), link: `/documentacion/${d.id}`, restricted: false, severity: 'medium' });
  }

  for (const c of db.changes) {
    if (c.companyId !== companyId || c.status !== 'pending_review') continue;
    add({ key: `change:${c.id}`, type: 'change_review', employeeId: c.employeeId, worksiteId: null, templateId: null, source: m('Cambio con efecto {date}', { date: c.effectiveFrom }), reason: m('{n} requisitos nuevos, {k} ya no aplicables, {c} críticos sin resolver.', { n: c.delta.newlyRequired.length, k: c.delta.noLongerApplicable.length, c: c.delta.newCriticalUnresolved.length }), ownerUserId: coordinator, targetDate: null, nextAction: m('Revisar el delta y solicitar la evidencia nueva.'), link: `/empleados/${c.employeeId}?tab=cambios`, restricted: false, severity: c.delta.newCriticalUnresolved.length ? 'high' : 'medium' });
  }

  for (const a of db.actions) {
    if (a.companyId !== companyId || a.status === 'resolved') continue;
    const overdue = !!a.targetDate && a.targetDate < date;
    add({ key: `action:${a.id}`, type: 'action_open', employeeId: a.employeeId, worksiteId: a.worksiteId, templateId: null, source: m('{code} · {title}', { code: a.code, title: a.title }), reason: overdue ? m('Vencida desde el {date}.', { date: a.targetDate! }) : a.targetDate ? m('Fecha objetivo {date}.', { date: a.targetDate }) : m('Sin fecha objetivo justificada.'), ownerUserId: a.ownerUserId, targetDate: a.targetDate, nextAction: a.status === 'pending_review' ? m('Revisar la resolución propuesta.') : m('Registrar avances y la evidencia requerida.'), link: `/acciones/${a.id}`, restricted: false, severity: overdue || a.priority === 'high' ? 'high' : 'medium' });
  }

  for (const x of db.caeExchanges) {
    if (x.companyId !== companyId) continue;
    const kase = db.caeCases.find((c) => c.id === x.caseId);
    if (!kase || kase.status === 'closed') continue;
    const issue = x.direction === 'sent' && x.sentAt && !x.receivedAt ? m('Enviado el {date}; el destinatario no ha confirmado la recepción.', { date: x.sentAt.slice(0, 10) }) : x.direction === 'sent' && x.receivedAt && !x.acknowledgedAt ? m('Recibido, sin acuse de comprensión del destinatario.') : x.direction === 'received' && x.review === 'pending' ? m('Información recibida pendiente de revisión.') : null;
    if (issue) add({ key: `cae:${x.id}`, type: 'cae_pending', employeeId: null, worksiteId: kase.worksiteId, templateId: null, source: m('{code} · {subject}', { code: kase.code, subject: x.subject }), reason: issue, ownerUserId: kase.followUpOwnerId, targetDate: kase.nextFollowUp, nextAction: m('Hacer seguimiento con la empresa concurrente.'), link: `/cae/${kase.id}`, restricted: false, severity: 'medium' });
  }

  for (const a of db.assessments) {
    if (a.companyId !== companyId || a.status === 'superseded' || a.status === 'draft') continue;
    if (a.status === 'review_required' || (a.reviewDate && a.reviewDate <= soon)) add({ key: `assessment:${a.id}`, type: 'assessment_review', employeeId: null, worksiteId: a.worksiteId, templateId: null, source: m('{code} · {title}', { code: a.code, title: a.title }), reason: a.status === 'review_required' ? m('Marcada para revisión: {note}', { note: a.reviewNote ?? '—' }) : m('Fecha de revisión establecida por el evaluador: {date}.', { date: a.reviewDate! }), ownerUserId: userWithRole(db, companyId, 'provider_technical', date), targetDate: a.reviewDate, nextAction: m('Revisar la evaluación y registrar la nueva versión.'), link: `/evaluaciones/${a.id}`, restricted: false, severity: a.status === 'review_required' ? 'high' : 'medium' });
  }

  for (const q of db.quarantine) {
    if (q.companyId !== companyId || q.status !== 'quarantined') continue;
    add({ key: `quarantine:${q.id}`, type: 'quarantine', employeeId: db.documents.find((d) => d.id === q.documentId)?.employeeId ?? null, worksiteId: null, templateId: null, source: m('Documento en cuarentena'), reason: m('Posible contenido clínico subido al área ordinaria el {date}.', { date: q.quarantinedAt.slice(0, 10) }), ownerUserId: medical, targetDate: null, nextAction: m('Devolver al servicio médico o retirar el archivo.'), link: '/salud?tab=cuarentena', restricted: true, severity: 'high' });
  }

  for (const c of db.healthConclusions) {
    if (c.companyId !== companyId || c.status !== 'current') continue;
    if (c.conclusion === 'fit_with_measures' && !c.measuresConfirmedAt) add({ key: `measures:${c.id}`, type: 'health_pending', employeeId: c.employeeId, worksiteId: null, templateId: null, source: m('Conclusión de aptitud'), reason: m('Medidas preventivas pendientes de aplicar.'), ownerUserId: coordinator, targetDate: null, nextAction: m('Aplicar las medidas y registrarlo.'), link: `/salud?empleado=${c.employeeId}`, restricted: true, severity: 'high' });
  }

  return out;
}

export function withReviews(db: Database, companyId: ID, list: DetectedException[]): ExceptionView[] {
  const reviews = new Map(db.exceptionReviews.filter((r) => r.companyId === companyId).map((r) => [r.key, r]));
  return list.map((e) => {
    const review = reviews.get(e.key) ?? null;
    return { ...e, status: review?.status ?? 'open', ownerUserId: review?.ownerUserId ?? e.ownerUserId, review };
  });
}

export const isOpenException = (s: ExceptionStatus) => s !== 'resolved';
