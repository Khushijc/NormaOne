/**
 * Display layer for reference data in the interface language.
 *
 * Records are stored in Spanish (the language of the record). Screens read the database through
 * `useDb()` / `useCtx()`, which pass it through this function when the interface is in English:
 * product-defined and seeded reference texts (job roles, risk tags, document categories,
 * requirement names and notes, courses, equipment, worksite activities, hazards…) are translated
 * with t(); a text without a dictionary entry (anything users type) stays as it is. Services and
 * exports keep using the stored Spanish database, so nothing translated is ever written back.
 *
 * Names of people, companies and customer sites have no dictionary entry and stay unchanged.
 */
import type { Database } from '../domain/types';
import { getLang, t } from './index';

const cache = new WeakMap<Database, Database>();

const tr = (s: string | null | undefined) => (s ? t(s) : s ?? null);

export function localizeDb(db: Database): Database {
  if (getLang() !== 'en') return db;
  const hit = cache.get(db);
  if (hit) return hit;
  const out: Database = {
    ...db,
    companies: db.companies.map((c) => ({ ...c, activity: t(c.activity), preventionNote: t(c.preventionNote) })),
    departments: db.departments.map((d) => ({ ...d, name: t(d.name) })),
    users: db.users.map((u) => ({ ...u, title: t(u.title) })),
    memberships: db.memberships.map((m) => ({ ...m, reference: tr(m.reference) })),
    jobRoles: db.jobRoles.map((r) => ({ ...r, name: t(r.name), tasks: t(r.tasks) })),
    assignments: db.assignments.map((a) => ({ ...a, changeReason: t(a.changeReason) })),
    worksites: db.worksites.map((w) => ({ ...w, name: t(w.name), activities: t(w.activities) })),
    providers: db.providers.map((p) => ({ ...p, contractReference: t(p.contractReference) })),
    riskTags: db.riskTags.map((r) => ({ ...r, label: t(r.label) })),
    categories: db.categories.map((c) => ({ ...c, label: t(c.label) })),
    versions: db.versions.map((v) => ({
      ...v,
      name: t(v.name),
      description: t(v.description),
      purpose: t(v.purpose),
      applicabilityNote: t(v.applicabilityNote),
      evidenceRequired: t(v.evidenceRequired),
      responsibleReviewer: t(v.responsibleReviewer),
      changeReason: t(v.changeReason),
      approvalNote: tr(v.approvalNote),
      source: { ...v.source, label: t(v.source.label) },
      reviewRule: { ...v.reviewRule, setBy: tr(v.reviewRule.setBy) },
    })),
    documents: db.documents.map((d) => ({ ...d, title: t(d.title) })),
    docVersions: db.docVersions.map((v) => ({ ...v, issuer: t(v.issuer), decisionNote: tr(v.decisionNote), rejectionReason: tr(v.rejectionReason) })),
    acknowledgements: db.acknowledgements.map((a) => ({ ...a, statement: t(a.statement) })),
    courses: db.courses.map((c) => ({ ...c, title: t(c.title), contentSummary: t(c.contentSummary), refresher: { ...c.refresher, setBy: tr(c.refresher.setBy) } })),
    trainings: db.trainings.map((x) => ({ ...x, note: t(x.note) })),
    equipment: db.equipment.map((e) => ({ ...e, name: t(e.name), type: t(e.type), description: t(e.description), replacement: { ...e.replacement, setBy: tr(e.replacement.setBy) } })),
    assessments: db.assessments.map((a) => ({ ...a, title: t(a.title), activity: t(a.activity), assessorName: t(a.assessorName), preventiveMeasures: t(a.preventiveMeasures), reviewNote: tr(a.reviewNote), hazards: a.hazards.map((h) => ({ ...h, description: t(h.description), measures: t(h.measures) })) })),
    actions: db.actions.map((a) => ({ ...a, title: t(a.title), description: t(a.description), targetJustification: t(a.targetJustification), requiredEvidence: t(a.requiredEvidence), resolutionNote: tr(a.resolutionNote), source: { ...a.source, label: t(a.source.label) }, notes: a.notes.map((n) => ({ ...n, text: t(n.text) })) })),
    caeCases: db.caeCases.map((c) => ({ ...c, title: t(c.title), activities: t(c.activities), risksSummary: t(c.risksSummary), coordinationMeans: t(c.coordinationMeans), openQuestions: t(c.openQuestions) })),
    caeExchanges: db.caeExchanges.map((x) => ({ ...x, subject: t(x.subject), reviewNote: tr(x.reviewNote), followUp: t(x.followUp) })),
    healthConclusions: db.healthConclusions.map((c) => ({ ...c, scope: t(c.scope), measures: t(c.measures), clinicalRecordReference: t(c.clinicalRecordReference) })),
    changes: db.changes.map((c) => ({ ...c, reason: t(c.reason), reviewNote: tr(c.reviewNote) })),
    applicability: db.applicability.map((d) => ({ ...d, reason: t(d.reason) })),
    readinessDecisions: db.readinessDecisions.map((d) => ({ ...d, reason: t(d.reason) })),
    requests: db.requests.map((r) => ({ ...r, note: t(r.note) })),
  };
  cache.set(db, out);
  return out;
}
