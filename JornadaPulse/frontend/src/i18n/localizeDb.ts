/**
 * Display layer for reference data in the interface language.
 *
 * Records are stored in Spanish (the language of the record). Screens read the database through
 * `useDb()` / `useCtx()`, which pass it through this function when the interface is in English:
 * the product-defined reference texts (absence types, policies, agreements, calendars and their
 * holidays, recording protocol, departments, job titles, mandate references…) are translated with
 * t(); everything else is shared by reference, unchanged. Services and exports keep using the
 * stored Spanish database, so nothing translated is ever written back.
 *
 * Names of customer sites and people have no dictionary entry and therefore stay as they are.
 */
import type { Database } from '../domain/types';
import { getLang, t } from './index';

const cache = new WeakMap<Database, Database>();

const tr = (s: string | null | undefined) => (s ? t(s) : s);

export function localizeDb(db: Database): Database {
  if (getLang() !== 'en') return db;
  const hit = cache.get(db);
  if (hit) return hit;
  const out: Database = {
    ...db,
    companies: db.companies.map((c) => ({ ...c, activity: t(c.activity) })),
    departments: db.departments.map((d) => ({ ...d, name: t(d.name) })),
    worksites: db.worksites.map((w) => ({ ...w, name: t(w.name) })),
    users: db.users.map((u) => ({ ...u, title: t(u.title) })),
    memberships: db.memberships.map((m) => ({ ...m, reference: tr(m.reference) ?? null })),
    employees: db.employees.map((e) => ({ ...e, jobTitle: t(e.jobTitle) })),
    relationships: db.relationships.map((r) => ({ ...r, note: t(r.note), reducedHours: r.reducedHours ? { ...r.reducedHours, basis: t(r.reducedHours.basis) } : null })),
    agreements: db.agreements.map((a) => ({ ...a, name: t(a.name), scope: t(a.scope), note: t(a.note) })),
    policies: db.policies.map((p) => ({ ...p, name: t(p.name), basis: t(p.basis), changeReason: t(p.changeReason) })),
    calendars: db.calendars.map((c) => ({ ...c, name: t(c.name), source: t(c.source), holidays: c.holidays.map((h) => ({ ...h, name: t(h.name) })) })),
    protocols: db.protocols.map((p) => ({ ...p, basisReference: t(p.basisReference), correctionProcedure: t(p.correctionProcedure), connectivityFallback: t(p.connectivityFallback) })),
    absenceTypes: db.absenceTypes.map((a) => ({ ...a, name: t(a.name), legalReference: t(a.legalReference), note: t(a.note), referenceDuration: tr(a.referenceDuration) ?? null })),
    failedAttempts: db.failedAttempts.map((f) => ({ ...f, reason: t(f.reason) })),
  };
  cache.set(db, out);
  return out;
}
