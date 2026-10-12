/**
 * Requirement applicability, evidence status and assignment readiness (PRL-01, -02, -05, -07).
 *
 * Everything here is DERIVED from the configured, versioned rules and the stored evidence on each
 * read, so a readiness state can always be explained item by item. Nothing here decides that a
 * workplace is safe: "ready" only means that the evidence the approved policy asks for has been
 * accepted by the configured review authority.
 */
import type {
  Acknowledgement,
  ApplicabilityDecision,
  Database,
  DocumentVersion,
  EmployeeAssignment,
  EvidenceDocument,
  EvidenceRequest,
  ID,
  ISODate,
  JobRole,
  Msg,
  ReadinessDecision,
  ReadinessState,
  RequirementAssignment,
  RequirementDelta,
  RequirementTemplate,
  RequirementVersion,
  DeltaItem,
  Worksite,
} from './types';
import { addDays } from './time';
import { ITEM_STATUS, READINESS_ORDER, SATISFIED, type ItemStatus } from './status';

// ─────────────────────────────── Indexes (cached per database object) ───────────────────────────────

interface Idx {
  versionsByTemplate: Map<ID, RequirementVersion[]>;
  assignmentsByTemplate: Map<ID, RequirementAssignment[]>;
  docsByTemplateEmployee: Map<string, EvidenceDocument[]>;
  docById: Map<ID, EvidenceDocument>;
  dvByDoc: Map<ID, DocumentVersion[]>;
  requestsByKey: Map<string, EvidenceRequest[]>;
  acksByEmployee: Map<ID, Acknowledgement[]>;
  decisionsByKey: Map<string, ApplicabilityDecision[]>;
  roles: Map<ID, JobRole>;
  worksites: Map<ID, Worksite>;
}

const idxCache = new WeakMap<Database, Idx>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function idx(db: Database): Idx {
  let i = idxCache.get(db);
  if (i) return i;
  i = {
    versionsByTemplate: new Map(),
    assignmentsByTemplate: new Map(),
    docsByTemplateEmployee: new Map(),
    docById: new Map(),
    dvByDoc: new Map(),
    requestsByKey: new Map(),
    acksByEmployee: new Map(),
    decisionsByKey: new Map(),
    roles: new Map(db.jobRoles.map((r) => [r.id, r])),
    worksites: new Map(db.worksites.map((w) => [w.id, w])),
  };
  for (const v of db.versions) push(i.versionsByTemplate, v.templateId, v);
  for (const list of i.versionsByTemplate.values()) list.sort((a, b) => a.version - b.version);
  for (const a of db.requirementAssignments) push(i.assignmentsByTemplate, a.templateId, a);
  for (const d of db.documents) {
    i.docById.set(d.id, d);
    if (d.templateId && d.employeeId) push(i.docsByTemplateEmployee, `${d.templateId}|${d.employeeId}`, d);
  }
  for (const v of db.docVersions) push(i.dvByDoc, v.documentId, v);
  for (const list of i.dvByDoc.values()) list.sort((a, b) => a.version - b.version);
  for (const r of db.requests) if (r.employeeId) push(i.requestsByKey, `${r.templateId}|${r.employeeId}`, r);
  for (const a of db.acknowledgements) push(i.acksByEmployee, a.employeeId, a);
  for (const d of db.applicability) push(i.decisionsByKey, `${d.templateId}|${d.employeeId}`, d);
  idxCache.set(db, i);
  return i;
}

// ─────────────────────────────── Versions and assignments ───────────────────────────────

export const isApproved = (v: RequirementVersion) => v.status !== 'draft' && v.status !== 'pending_approval' && v.status !== 'rejected';

/** Approved version in force on a date (effective-dated; never retroactive). */
export function versionOn(db: Database, templateId: ID, date: ISODate): RequirementVersion | undefined {
  const list = idx(db).versionsByTemplate.get(templateId) ?? [];
  for (let k = list.length - 1; k >= 0; k--) {
    const v = list[k];
    if (isApproved(v) && v.effectiveFrom <= date && (!v.effectiveTo || v.effectiveTo >= date)) return v;
  }
  return undefined;
}

export function versionsOf(db: Database, templateId: ID): RequirementVersion[] {
  return idx(db).versionsByTemplate.get(templateId) ?? [];
}

export function latestVersion(db: Database, templateId: ID): RequirementVersion | undefined {
  const list = versionsOf(db, templateId);
  return list[list.length - 1];
}

/** Status for display: an approved version whose effective date is still ahead is "scheduled". */
export function versionStatusOn(v: RequirementVersion, date: ISODate): RequirementVersion['status'] {
  if (v.status === 'active' && v.effectiveFrom > date) return 'scheduled';
  if (v.status === 'active' && v.effectiveTo && v.effectiveTo < date) return 'superseded';
  return v.status;
}

export function assignmentOn(db: Database, employeeId: ID, date: ISODate): EmployeeAssignment | undefined {
  let best: EmployeeAssignment | undefined;
  for (const a of db.assignments) {
    if (a.employeeId !== employeeId || a.effectiveFrom > date || (a.effectiveTo && a.effectiveTo < date)) continue;
    if (!best || a.effectiveFrom > best.effectiveFrom) best = a;
  }
  return best;
}

export interface AssignmentShape {
  jobRoleId: ID;
  departmentId: ID;
  worksiteIds: ID[];
}

const activeOn = (a: RequirementAssignment, date: ISODate) => a.effectiveFrom <= date && (!a.effectiveTo || a.effectiveTo >= date);

/** Why a requirement applies: version scope (role/worksite/risk), explicit assignment or employee. */
export type AppliesVia = 'scope' | 'assignment';

function scopeMatch(v: RequirementVersion, employeeId: ID, role: JobRole | undefined, w: Worksite | undefined): boolean {
  const s = v.scope;
  if (s.employeeIds.includes(employeeId)) return true;
  if (s.appliesToAll) return true;
  if (!s.jobRoleIds.length && !s.worksiteIds.length && !s.riskTags.length) return false;
  if (s.jobRoleIds.length && !(role && s.jobRoleIds.includes(role.id))) return false;
  if (s.worksiteIds.length && !(w && s.worksiteIds.includes(w.id))) return false;
  if (s.riskTags.length) {
    const tags = new Set([...(role?.riskTags ?? []), ...(w?.riskTags ?? [])]);
    if (!s.riskTags.some((t) => tags.has(t))) return false;
  }
  return true;
}

function assignmentMatch(list: RequirementAssignment[], date: ISODate, employeeId: ID, role: JobRole | undefined, w: Worksite | undefined): boolean {
  return list.some((a) => activeOn(a, date) && ((a.target.kind === 'employee' && a.target.id === employeeId) || (a.target.kind === 'role' && a.target.id === role?.id) || (a.target.kind === 'worksite' && a.target.id === w?.id)));
}

// ─────────────────────────────── Matrix items ───────────────────────────────

export interface ItemEvidence {
  documentId: ID | null;
  acceptedVersionId: ID | null;
  pendingVersionId: ID | null;
  rejectedVersionId: ID | null;
  requestId: ID | null;
  acknowledgementId: ID | null;
  issueId: ID | null;
  legalExpiryDate: ISODate | null;
  providerReviewDate: ISODate | null;
  internalFollowUpDate: ISODate | null;
  expiringSoon: boolean;
  reviewSoon: boolean;
}

export interface MatrixItem {
  key: string;
  employeeId: ID;
  template: RequirementTemplate;
  version: RequirementVersion;
  /** Set for per-worksite requirements (one item per worksite). */
  worksiteId: ID | null;
  /** Worksites of the employee for which this item counts towards readiness. */
  worksiteIds: ID[];
  via: AppliesVia[];
  status: ItemStatus;
  reason: Msg;
  /** Counts towards readiness (mandatory under the approved policy and not marked N/A). */
  counted: boolean;
  critical: boolean;
  satisfied: boolean;
  /** Health-related: details only for health-authorised viewers. */
  restricted: boolean;
  decision: ApplicabilityDecision | null;
  evidence: ItemEvidence;
}

const EMPTY_EVIDENCE: ItemEvidence = {
  documentId: null,
  acceptedVersionId: null,
  pendingVersionId: null,
  rejectedVersionId: null,
  requestId: null,
  acknowledgementId: null,
  issueId: null,
  legalExpiryDate: null,
  providerReviewDate: null,
  internalFollowUpDate: null,
  expiringSoon: false,
  reviewSoon: false,
};

export const itemKey = (employeeId: ID, templateId: ID, worksiteId: ID | null) => `${employeeId}|${templateId}|${worksiteId ?? '*'}`;

interface EvalOpts {
  date: ISODate;
  alertDays: number;
}

const m = (text: string, params?: Msg['params']): Msg => ({ text, params });

/** Builds the requirement items for an employee under a given role/worksite shape. */
export function buildItems(db: Database, companyId: ID, employeeId: ID, shape: AssignmentShape, opts: EvalOpts): MatrixItem[] {
  const i = idx(db);
  const role = i.roles.get(shape.jobRoleId);
  const sites = shape.worksiteIds.map((id) => i.worksites.get(id)).filter((w): w is Worksite => !!w && w.active && w.companyId === companyId);
  const out: MatrixItem[] = [];
  for (const t of db.templates) {
    if (t.companyId !== companyId) continue;
    const v = versionOn(db, t.id, opts.date);
    if (!v) continue;
    const asg = i.assignmentsByTemplate.get(t.id) ?? [];
    const via = (w: Worksite | undefined): AppliesVia[] => {
      const r: AppliesVia[] = [];
      if (scopeMatch(v, employeeId, role, w)) r.push('scope');
      if (assignmentMatch(asg, opts.date, employeeId, role, w)) r.push('assignment');
      return r;
    };
    if (v.perWorksite) {
      for (const w of sites) {
        const why = via(w);
        if (why.length) out.push(evaluate(db, { employeeId, template: t, version: v, worksiteId: w.id, worksiteIds: [w.id], via: why }, opts));
      }
    } else {
      const relevant = sites.filter((w) => via(w).length > 0);
      const general = via(undefined);
      if (!relevant.length && !general.length) continue;
      const why = [...new Set([...general, ...relevant.flatMap((w) => via(w))])];
      out.push(evaluate(db, { employeeId, template: t, version: v, worksiteId: null, worksiteIds: (general.length ? sites : relevant).map((w) => w.id), via: why }, opts));
    }
  }
  return out;
}

interface ItemSeed {
  employeeId: ID;
  template: RequirementTemplate;
  version: RequirementVersion;
  worksiteId: ID | null;
  worksiteIds: ID[];
  via: AppliesVia[];
}

function finish(seed: ItemSeed, status: ItemStatus, reason: Msg, evidence: Partial<ItemEvidence>, decision: ApplicabilityDecision | null = null): MatrixItem {
  const v = seed.version;
  const counted = v.requirementType === 'mandatory_policy' && status !== 'not_applicable';
  const satisfied = SATISFIED.includes(status);
  return {
    key: itemKey(seed.employeeId, seed.template.id, seed.worksiteId),
    ...seed,
    status,
    reason,
    counted,
    critical: counted && v.critical,
    satisfied,
    restricted: v.category === 'health_surveillance',
    decision,
    evidence: { ...EMPTY_EVIDENCE, ...evidence },
  };
}

const within = (date: ISODate | null, today: ISODate, days: number) => !!date && date > today && date <= addDays(today, days);

/** Evidence status of one item, from the stored documents / acknowledgements / issues / offers. */
export function evaluate(db: Database, seed: ItemSeed, opts: EvalOpts): MatrixItem {
  const i = idx(db);
  const v = seed.version;
  const { date } = opts;

  if (v.requirementType === 'not_applicable') return finish(seed, 'not_applicable', m('Evaluado como no aplicable en la política aprobada: {note}', { note: v.applicabilityNote }), {});
  const decision = (i.decisionsByKey.get(`${seed.template.id}|${seed.employeeId}`) ?? []).find((d) => !d.revokedAt && (d.worksiteId ?? null) === seed.worksiteId) ?? null;
  if (decision) return finish(seed, 'not_applicable', m('Marcado como no aplicable: {reason}', { reason: decision.reason }), {}, decision);

  const requests = (i.requestsByKey.get(`${seed.template.id}|${seed.employeeId}`) ?? []).filter((r) => r.status === 'open' && (r.worksiteId ?? null) === (seed.worksiteId ?? null));
  const openRequest = requests[requests.length - 1] ?? null;

  switch (v.evidenceMode) {
    case 'document':
    case 'training':
      return documentStatus(db, seed, opts, openRequest);
    case 'acknowledgement': {
      if (!v.instructionDocumentId) return finish(seed, 'review_required', m('La versión vigente no tiene vinculada la instrucción o información que debe confirmarse.'), {});
      const versions = i.dvByDoc.get(v.instructionDocumentId) ?? [];
      const current = [...versions].reverse().find((x) => x.status === 'accepted');
      if (!current) return finish(seed, 'missing', m('La información o instrucción todavía no tiene una versión aprobada para entregar.'), { documentId: v.instructionDocumentId });
      const acks = (i.acksByEmployee.get(seed.employeeId) ?? []).filter((a) => a.subject.kind === 'document' && a.subject.id === v.instructionDocumentId);
      const ack = acks.find((a) => a.documentVersionId === current.id);
      if (ack) return finish(seed, 'accepted', m('Recepción confirmada de la versión {n} el {date}.', { n: current.version, date: ack.acknowledgedAt.slice(0, 10) }), { documentId: v.instructionDocumentId, acceptedVersionId: current.id, acknowledgementId: ack.id });
      if (acks.length) return finish(seed, 'pending_ack', m('Confirmó una versión anterior; falta confirmar la versión {n}.', { n: current.version }), { documentId: v.instructionDocumentId, acceptedVersionId: current.id });
      return finish(seed, 'pending_ack', m('Pendiente de que la persona trabajadora confirme la recepción de la versión {n}.', { n: current.version }), { documentId: v.instructionDocumentId, acceptedVersionId: current.id });
    }
    case 'ppe_issue': {
      const issues = db.issues.filter((x) => x.employeeId === seed.employeeId && x.itemId === v.equipmentItemId && x.status === 'issued');
      const issue = issues.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
      if (!issue) return openRequest ? finish(seed, 'requested', m('Entrega solicitada; todavía no consta la entrega del equipo.'), { requestId: openRequest.id }) : finish(seed, 'missing', m('No consta la entrega del equipo.'), {});
      const ack = (i.acksByEmployee.get(seed.employeeId) ?? []).find((a) => a.subject.kind === 'ppe_issue' && a.subject.id === issue.id);
      const ev = { issueId: issue.id, acknowledgementId: ack?.id ?? null, providerReviewDate: issue.replacementDue, reviewSoon: within(issue.replacementDue, date, opts.alertDays) };
      if (!ack) return finish(seed, 'pending_ack', m('Equipo entregado el {date}; falta la confirmación de recepción.', { date: issue.issuedAt }), ev);
      if (issue.replacementDue && issue.replacementDue <= date) return finish(seed, 'review_due', m('Revisión o sustitución programada para el {date} (según la configuración del equipo).', { date: issue.replacementDue }), ev);
      return finish(seed, 'accepted', m('Entregado el {date} y recepción confirmada.', { date: issue.issuedAt }), ev);
    }
    case 'health':
      return healthStatus(db, seed, opts);
  }
}

function documentStatus(db: Database, seed: ItemSeed, opts: EvalOpts, openRequest: EvidenceRequest | null): MatrixItem {
  const i = idx(db);
  const v = seed.version;
  const { date, alertDays } = opts;
  const docs = (i.docsByTemplateEmployee.get(`${seed.template.id}|${seed.employeeId}`) ?? []).filter((d) => !v.perWorksite || d.worksiteId === seed.worksiteId);
  const all = docs.flatMap((d) => i.dvByDoc.get(d.id) ?? []).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const accepted = [...all].reverse().find((x) => x.status === 'accepted');
  const pending = [...all].reverse().find((x) => x.status === 'received' || x.status === 'in_review');
  const last = all[all.length - 1];
  const base: Partial<ItemEvidence> = { requestId: openRequest?.id ?? null, pendingVersionId: pending?.id ?? null, documentId: (accepted ?? pending ?? last)?.documentId ?? null };
  const training = v.evidenceMode === 'training' ? db.trainings.find((x) => x.employeeId === seed.employeeId && x.templateId === seed.template.id && x.status !== 'cancelled') : undefined;

  if (accepted) {
    const ev: Partial<ItemEvidence> = {
      ...base,
      acceptedVersionId: accepted.id,
      legalExpiryDate: accepted.legalExpiryDate,
      providerReviewDate: accepted.providerReviewDate,
      internalFollowUpDate: accepted.internalFollowUpDate,
      expiringSoon: within(accepted.legalExpiryDate, date, alertDays),
      reviewSoon: within(accepted.providerReviewDate, date, alertDays),
    };
    if (accepted.expiryMode === 'date' && accepted.legalExpiryDate && accepted.legalExpiryDate < date) {
      return finish(seed, 'expired', pending ? m('Caducó el {date}; hay una renovación en revisión.', { date: accepted.legalExpiryDate }) : m('Caducó el {date} (fecha indicada en el documento).', { date: accepted.legalExpiryDate }), ev);
    }
    const reviewedUnder = accepted.requirementVersionId ? db.versions.find((x) => x.id === accepted.requirementVersionId) : undefined;
    if (reviewedUnder && reviewedUnder.version < v.version) {
      const invalidating = versionsOf(db, seed.template.id).find((x) => x.version > reviewedUnder.version && x.version <= v.version && isApproved(x) && x.invalidatesPriorEvidence);
      if (invalidating) return finish(seed, 'review_required', m('Aceptada con la versión {old}; la versión {new} exige una nueva revisión de la evidencia.', { old: reviewedUnder.version, new: invalidating.version }), ev);
    }
    if (accepted.providerReviewDate && accepted.providerReviewDate <= date) return finish(seed, 'review_due', m('Fecha de revisión del proveedor: {date}.', { date: accepted.providerReviewDate }), ev);
    if ((v.reviewRule.kind === 'interval' || v.reviewRule.kind === 'per_document') && !accepted.providerReviewDate) return finish(seed, 'review_required', m('Falta la fecha de revisión que debe fijar el proveedor.'), ev);
    if (v.reviewRule.kind === 'not_determined') return finish(seed, 'review_required', m('La periodicidad de revisión está pendiente de determinar por un profesional.'), ev);
    if (v.expiryRule === 'per_document' && accepted.expiryMode === 'unknown') return finish(seed, 'review_required', m('El documento no indica caducidad: confirme con el emisor si no la tiene. No se inventa una fecha.'), ev);
    if (v.expiryRule === 'not_determined') return finish(seed, 'review_required', m('La caducidad de este tipo de evidencia está pendiente de determinar por un profesional.'), ev);
    const tail = accepted.expiryMode === 'none' ? m('Aceptada el {date}; sin caducidad según el emisor.', { date: (accepted.reviewedAt ?? accepted.receivedAt).slice(0, 10) }) : m('Aceptada el {date}.', { date: (accepted.reviewedAt ?? accepted.receivedAt).slice(0, 10) });
    return finish(seed, 'accepted', tail, ev);
  }
  if (pending) return finish(seed, pending.status === 'in_review' ? 'in_review' : 'received', pending.status === 'in_review' ? m('Versión {n} en revisión.', { n: pending.version }) : m('Versión {n} recibida; pendiente de revisión.', { n: pending.version }), base);
  if (last?.status === 'rejected') return finish(seed, 'rejected', m('Rechazada: {reason}', { reason: last.rejectionReason ?? '—' }), { ...base, rejectedVersionId: last.id });
  if (openRequest) return finish(seed, 'requested', training?.status === 'completed' ? m('Formación finalizada; falta aportar y aceptar la evidencia.') : m('Solicitada el {date}.', { date: openRequest.requestedAt.slice(0, 10) }), { ...base, internalFollowUpDate: openRequest.followUpDate });
  if (training?.status === 'completed') return finish(seed, 'missing', m('Formación finalizada; falta aportar y aceptar la evidencia.'), base);
  if (training?.status === 'attended') return finish(seed, 'missing', m('Consta la asistencia, no la finalización ni la evidencia.'), base);
  return finish(seed, 'missing', m('No hay evidencia ni solicitud abierta.'), base);
}

function healthStatus(db: Database, seed: ItemSeed, opts: EvalOpts): MatrixItem {
  const offers = db.healthOffers.filter((o) => o.employeeId === seed.employeeId && (o.templateId === seed.template.id || o.templateId === null)).sort((a, b) => a.offeredAt.localeCompare(b.offeredAt));
  const offer = offers[offers.length - 1];
  if (!offer) return finish(seed, 'missing', m('No consta la oferta de vigilancia de la salud.'), {});
  if (offer.response === 'pending') {
    // A voluntary offer has been made: the pending answer does not condition the assignment.
    if (offer.basis === 'voluntary') return { ...finish(seed, 'requested', m('Oferta voluntaria realizada el {date}; respuesta pendiente. No condiciona la asignación.', { date: offer.offeredAt }), {}), satisfied: true };
    return finish(seed, 'requested', m('Oferta registrada el {date}; pendiente de respuesta.', { date: offer.offeredAt }), {});
  }
  if (offer.response === 'declined') {
    return offer.basis === 'voluntary'
      ? finish(seed, 'declined', m('La persona trabajadora no aceptó la oferta voluntaria ({date}). No es un incumplimiento.', { date: offer.respondedAt ?? offer.offeredAt }), {})
      : finish(seed, 'review_required', m('Reconocimiento obligatorio por excepción profesional sin realizar: requiere decisión del servicio médico.'), {});
  }
  const c = db.healthConclusions.filter((x) => x.employeeId === seed.employeeId && x.status === 'current').sort((a, b) => a.conclusionDate.localeCompare(b.conclusionDate)).pop();
  if (!c) return finish(seed, 'in_review', m('Pendiente de la conclusión del servicio médico.'), {});
  const ev = { providerReviewDate: c.nextReviewDate };
  if (c.nextReviewDate && c.nextReviewDate <= opts.date) return finish(seed, 'review_due', m('Revisión indicada por el servicio médico: {date}.', { date: c.nextReviewDate }), ev);
  if (c.conclusion === 'fit') return finish(seed, 'accepted', m('Conclusión registrada el {date} sin impacto en la asignación.', { date: c.conclusionDate }), ev);
  if (c.conclusion === 'fit_with_measures') return c.measuresConfirmedAt ? finish(seed, 'accepted', m('Medidas preventivas aplicadas el {date}.', { date: c.measuresConfirmedAt.slice(0, 10) }), ev) : finish(seed, 'review_required', m('Medidas preventivas comunicadas por el servicio médico pendientes de aplicar.'), ev);
  return finish(seed, 'review_required', m('Conclusión del servicio médico con impacto en la asignación: requiere decisión profesional.'), ev);
}

/** For non-authorised viewers, health items show only whether the assignment is affected. */
export function maskItem(item: MatrixItem, canSeeHealth: boolean): MatrixItem {
  if (!item.restricted || canSeeHealth) return item;
  return {
    ...item,
    status: item.satisfied ? 'accepted' : 'review_required',
    reason: item.satisfied ? m('Sin impedimento registrado para la asignación (detalle restringido).') : m('Pendiente: consulte con la coordinación de PRL (detalle restringido).'),
    evidence: { ...EMPTY_EVIDENCE },
  };
}

// ─────────────────────────────── Employee matrix and readiness ───────────────────────────────

const matrixCache = new WeakMap<Database, Map<string, MatrixItem[]>>();

export function matrixFor(db: Database, companyId: ID, employeeId: ID, date: ISODate, alertDays: number): MatrixItem[] {
  let c = matrixCache.get(db);
  if (!c) matrixCache.set(db, (c = new Map()));
  const k = `${employeeId}|${date}|${alertDays}`;
  const hit = c.get(k);
  if (hit) return hit;
  const a = assignmentOn(db, employeeId, date);
  const items = a ? buildItems(db, companyId, employeeId, a, { date, alertDays }) : [];
  c.set(k, items);
  return items;
}

export interface Readiness {
  employeeId: ID;
  worksiteId: ID;
  state: ReadinessState;
  reasons: { state: ReadinessState; msg: Msg; templateId: ID | null }[];
  items: MatrixItem[];
  counts: { counted: number; satisfied: number; critical: number; criticalOpen: number; optional: number };
  confirmation: ReadinessDecision | null;
  /** A confirmation exists but the state has changed since (no longer valid). */
  confirmationStale: boolean;
  exceptions: ReadinessDecision[];
}

export function validExceptions(db: Database, employeeId: ID, worksiteId: ID, date: ISODate): ReadinessDecision[] {
  return db.readinessDecisions.filter((d) => d.kind === 'exception' && d.employeeId === employeeId && d.worksiteId === worksiteId && !d.revokedAt && (!d.validUntil || d.validUntil >= date));
}

export function readinessFor(db: Database, companyId: ID, employeeId: ID, worksiteId: ID, date: ISODate, alertDays: number): Readiness {
  const all = matrixFor(db, companyId, employeeId, date, alertDays);
  const items = all.filter((it) => it.worksiteIds.includes(worksiteId));
  const reasons: Readiness['reasons'] = [];
  const add = (state: ReadinessState, msg: Msg, templateId: ID | null = null) => reasons.push({ state, msg, templateId });
  const a = assignmentOn(db, employeeId, date);
  const w = idx(db).worksites.get(worksiteId);
  const role = a ? idx(db).roles.get(a.jobRoleId) : undefined;

  // Pending evaluation: no accepted risk assessment covers the role here, or a change review is open.
  const covering = db.assessments.filter((x) => x.companyId === companyId && x.status === 'accepted' && (x.worksiteId === worksiteId || (x.worksiteId === null && !!a && x.jobRoleIds.includes(a.jobRoleId))));
  if (!covering.length) add('pending_evaluation', m('Ninguna evaluación de riesgos aceptada cubre el puesto «{role}» en {site}.', { role: role?.name ?? '—', site: w?.name ?? '—' }));
  const change = db.changes.find((c) => c.companyId === companyId && c.employeeId === employeeId && c.status === 'pending_review' && c.focusWorksiteIds.includes(worksiteId));
  if (change) add('pending_evaluation', m('Revisión de cambios pendiente desde el {date}.', { date: change.createdAt.slice(0, 10) }));

  const exceptions = validExceptions(db, employeeId, worksiteId, date);
  const excepted = new Set(exceptions.flatMap((e) => e.templateIds));
  for (const it of items) {
    if (!it.counted || it.satisfied) continue;
    const name = it.version.name;
    if (it.critical && !(excepted.has(it.template.id) && it.version.exceptionAllowed)) {
      add('blocked', it.restricted ? m('Requisito crítico restringido sin resolver (consulte con la coordinación de PRL).') : m('Requisito crítico «{name}»: {status}.', { name, status: ITEM_STATUS[it.status].label }), it.template.id);
      continue;
    }
    if (it.status === 'review_required' || it.status === 'review_due') add('professional_review', it.restricted ? m('Requisito restringido pendiente de decisión profesional.') : m('«{name}»: revisión profesional necesaria.', { name }), it.template.id);
    else if (it.status === 'received' || it.status === 'in_review') add('in_review', m('«{name}»: evidencia en revisión.', { name }), it.template.id);
    else add('incomplete', m('«{name}»: {status}.', { name, status: ITEM_STATUS[it.status].label }), it.template.id);
  }
  for (const act of db.actions) {
    if (act.companyId !== companyId || !act.affectsReadiness || act.status === 'resolved') continue;
    if (act.worksiteId === worksiteId || act.employeeId === employeeId) add('blocked', m('Acción preventiva {code} abierta que, según la política aprobada, condiciona la asignación.', { code: act.code }));
  }
  for (const e of exceptions) add('ready', m('Excepción autorizada hasta {date}: {reason}', { date: e.validUntil ?? '—', reason: e.reason }));

  const state = READINESS_ORDER.find((s) => s !== 'ready' && reasons.some((r) => r.state === s)) ?? 'ready';
  const confirmations = db.readinessDecisions.filter((d) => d.kind === 'confirmed_ready' && d.employeeId === employeeId && d.worksiteId === worksiteId && !d.revokedAt).sort((x, y) => x.decidedAt.localeCompare(y.decidedAt));
  const last = confirmations[confirmations.length - 1] ?? null;
  const counted = items.filter((x) => x.counted);
  return {
    employeeId,
    worksiteId,
    state,
    reasons,
    items,
    counts: {
      counted: counted.length,
      satisfied: counted.filter((x) => x.satisfied).length,
      critical: counted.filter((x) => x.critical).length,
      criticalOpen: counted.filter((x) => x.critical && !x.satisfied).length,
      optional: items.filter((x) => x.version.requirementType === 'optional').length,
    },
    confirmation: last && state === 'ready' ? last : null,
    confirmationStale: !!last && state !== 'ready',
    exceptions,
  };
}

const readinessCache = new WeakMap<Database, Map<string, Readiness[]>>();

/** Readiness of every active employee × current worksite in a company. */
export function allReadiness(db: Database, companyId: ID, date: ISODate, alertDays: number): Readiness[] {
  let c = readinessCache.get(db);
  if (!c) readinessCache.set(db, (c = new Map()));
  const k = `${companyId}|${date}|${alertDays}`;
  const hit = c.get(k);
  if (hit) return hit;
  const out: Readiness[] = [];
  for (const e of db.employees) {
    if (e.companyId !== companyId || e.status !== 'active') continue;
    const a = assignmentOn(db, e.id, date);
    if (!a) continue;
    for (const w of a.worksiteIds) {
      const site = idx(db).worksites.get(w);
      if (site?.active) out.push(readinessFor(db, companyId, e.id, w, date, alertDays));
    }
  }
  c.set(k, out);
  return out;
}

// ─────────────────────────────── Delta review (PRL-02, AC-PRL-01) ───────────────────────────────

function deltaItem(it: MatrixItem): DeltaItem {
  return { templateId: it.template.id, versionId: it.version.id, worksiteId: it.worksiteId, name: it.version.name, critical: it.critical, evidence: it.status };
}

/**
 * Compares the requirements before and after a role/worksite change. Existing evidence is never
 * invalidated by the change itself: unrelated accepted evidence stays valid.
 */
export function diffItems(b: MatrixItem[], a: MatrixItem[]): RequirementDelta {
  const bKeys = new Set(b.map((x) => x.key));
  const aKeys = new Set(a.map((x) => x.key));
  const newly = a.filter((x) => !bKeys.has(x.key));
  return {
    newlyRequired: newly.map(deltaItem),
    unchanged: a.filter((x) => bKeys.has(x.key)).map(deltaItem),
    noLongerApplicable: b.filter((x) => !aKeys.has(x.key)).map(deltaItem),
    evidenceStillValid: a.filter((x) => x.status === 'accepted' || x.status === 'declined').map(deltaItem),
    evidenceNeedsReview: a.filter((x) => x.status === 'review_required' || x.status === 'review_due' || x.status === 'expired').map(deltaItem),
    newCriticalUnresolved: newly.filter((x) => x.critical && !x.satisfied).map(deltaItem),
  };
}

/**
 * Compares the requirements before and after a role/worksite change. Existing evidence is never
 * invalidated by the change itself: unrelated accepted evidence stays valid.
 */
export function computeDelta(db: Database, companyId: ID, employeeId: ID, before: AssignmentShape, after: AssignmentShape, date: ISODate, alertDays: number): RequirementDelta {
  return diffItems(buildItems(db, companyId, employeeId, before, { date, alertDays }), buildItems(db, companyId, employeeId, after, { date, alertDays }));
}

// ─────────────────────────────── Template impact ───────────────────────────────

/** Employees and items affected by a template on a date (who must act, which evidence exists). */
export function affectedBy(db: Database, companyId: ID, templateId: ID, date: ISODate, alertDays: number): MatrixItem[] {
  const out: MatrixItem[] = [];
  for (const e of db.employees) {
    if (e.companyId !== companyId || e.status !== 'active') continue;
    for (const it of matrixFor(db, companyId, e.id, date, alertDays)) if (it.template.id === templateId) out.push(it);
  }
  return out;
}
