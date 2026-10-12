/**
 * Runtime-generated text must have an English rendering. Records stay in Spanish; this checks
 * that t() can display each of them in English: labels, anomaly reasons, indicators, seeded and
 * newly generated audit summaries and notifications, reference data, and the error messages that
 * services raise in common workflows.
 * Run alone with: npx vitest run src/i18n
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasEnglish, setLangForTests } from './index';
import { ANOMALY_LABEL, ANOMALY_STATUS_LABEL, listAnomalies } from '../domain/anomalies';
import { AUDIT_ACTION_LABEL } from '../domain/audit';
import { ROLES } from '../domain/permissions';
import { sessionIndicators } from '../domain/records';
import * as STATUS from '../domain/status';
import { setClock } from '../domain/time';
import { getDb, initDatabase, initSession, resetDemoData, setDemoSwitches, setSession } from '../store/db';
import { conflictsFor, reviewAbsence, saveAbsence } from '../services/absenceService';
import { getCtx } from '../services/context';
import { requestCorrection, reviewCorrection } from '../services/correctionService';
import { ANOMALY_ACTION_LABEL, reviewAnomaly } from '../services/opsService';
import { checkShift, saveShift } from '../services/planningService';
import { clock, requestRecordDeletion } from '../services/timeService';
import { EXPORT_NOTICE } from '../services/reportService';
import { describeError } from '../components/ui';

const out = new Map<string, string>();
const add = (where: string, s: string | null | undefined) => {
  if (s && s.trim() && /\p{L}{2,}/u.test(s)) out.set(s, where);
};
const tryCall = async (where: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    const d = describeError(e);
    // describeError already translates; collect the raw Spanish message instead.
    const raw = e as { message?: string; details?: string[] };
    add(`${where} (error)`, raw.message);
    (raw.details ?? []).forEach((x) => add(`${where} (detail)`, x));
    void d;
  }
};

async function exercise() {
  // Failing and succeeding calls across the main workflows (messages are collected, not asserted).
  setSession({ userId: 'usr_lucia', companyId: 'cmp_levante' });
  setDemoSwitches({ simulateClockFailure: true });
  await tryCall('clock', () => clock({ action: 'clock_in', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: 'rt-1' }));
  setDemoSwitches({ simulateClockFailure: false });
  await tryCall('clock', () => clock({ action: 'clock_out', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: 'rt-2' }));
  await tryCall('clock', () => clock({ action: 'break_end', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: 'rt-3' }));
  await tryCall('clock', () => clock({ action: 'clock_in', worksiteId: 'ws_marblau', mode: 'onsite', idempotencyKey: 'rt-4' }));
  await tryCall('clock', () => clock({ action: 'clock_in', worksiteId: 'ws_cowork', mode: 'remote', idempotencyKey: 'rt-5' }));
  await tryCall('absence', () => saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-11-10', endDate: '2026-11-05', partial: null, note: '' }, true));
  await tryCall('absence', () => saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-11-02', endDate: '2026-11-02', partial: { startTime: '09:00', endTime: '08:00' }, note: '' }, true));
  await tryCall('absence', () => saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-01-02', endDate: '2026-01-02', partial: null, note: '' }, true));
  await tryCall('absence', () => saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_otra', startDate: '2026-11-20', endDate: '2026-11-20', partial: null, note: '' }, true));
  const ok = await saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-10-21', endDate: '2026-10-22', partial: null, note: 'x' }, true);
  conflictsFor(getCtx(), ok).forEach((c) => add('conflict', c.message.text));
  await tryCall('absence', () => saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-10-22', endDate: '2026-10-23', partial: null, note: '' }, true));
  setSession({ userId: 'usr_amparo', companyId: 'cmp_levante' });
  await tryCall('absence review', () => reviewAbsence(ok.id, 'approve', ''));
  await tryCall('absence review', () => reviewAbsence(ok.id, 'reject', ''));
  await reviewAbsence(ok.id, 'approve', '', ['planned_shifts']);
  setSession({ userId: 'usr_pablo', companyId: 'cmp_levante' });
  const pc = getDb().corrections.find((c) => c.employeeId === 'emp_pablo' && c.status === 'pending')!;
  await tryCall('correction review', () => reviewCorrection(pc.id, 'approve', ''));
  await tryCall('correction', () => requestCorrection({ employeeId: 'emp_pablo', sessionId: pc.sessionId, date: pc.date, kind: 'other', requested: pc.requested, explanation: 'corta' }));
  await tryCall('correction', () => requestCorrection({ employeeId: 'emp_pablo', sessionId: null, date: '2026-10-13', kind: 'missing_session', requested: { start: null, end: null, breaks: [], worksiteId: 'ws_oficina', mode: 'onsite' }, explanation: 'Explicación suficientemente larga.' }));
  setSession({ userId: 'usr_elena', companyId: 'cmp_levante' });
  await reviewCorrection(pc.id, 'approve', 'ok');
  await tryCall('shift', () => saveShift({ employeeId: 'emp_pablo', worksiteId: 'ws_torre', date: '2027-03-28', startTime: '02:30', endTime: '06:00', note: '' }, null));
  checkShift(getCtx(), { employeeId: 'emp_pablo', worksiteId: 'ws_torre', date: '2026-10-12', startTime: '22:00', endTime: '06:00', note: '' }, null).warnings.forEach((w) => add('shift warning', w));
  setSession({ userId: 'usr_javier', companyId: 'cmp_levante' });
  const old = getDb().sessions.find((s) => s.employeeId === 'emp_teresa')!;
  await requestRecordDeletion(old.id, 'Prueba de conservación');
  const a = listAnomalies(getDb(), 'cmp_levante').find((x) => x.type === 'duplicate_event')!;
  await tryCall('anomaly', () => reviewAnomaly(a.key, 'resolve', ''));
  await reviewAnomaly(a.key, 'acknowledge', 'visto');
}

function collectStatic() {
  for (const [name, table] of Object.entries(STATUS)) {
    if (typeof table !== 'object' || !table) continue;
    for (const v of Object.values(table as Record<string, unknown>)) {
      if (typeof v === 'string') add(name, v);
      else if (v && typeof v === 'object' && 'label' in v) {
        const meta = v as unknown as { label: string; help?: string };
        add(name, meta.label);
        add(name, meta.help);
      }
    }
  }
  for (const r of Object.values(ROLES)) [r.label, r.description, r.restriction].forEach((s) => add('ROLES', s));
  for (const [n, tbl] of Object.entries({ AUDIT_ACTION_LABEL, ANOMALY_LABEL, ANOMALY_STATUS_LABEL, ANOMALY_ACTION_LABEL })) for (const s of Object.values(tbl as Record<string, string>)) add(n, s);
  add('export', EXPORT_NOTICE);
  const db = getDb();
  for (const e of db.audit) {
    add('audit.summary', e.summary);
    e.changes.forEach((c) => add('audit.change', c.field));
  }
  for (const n of db.notifications) {
    add('notification', n.title);
    add('notification', n.body);
  }
  for (const t of db.absenceTypes) [t.name, t.legalReference, t.note, t.referenceDuration].forEach((s) => add('absenceType', s));
  for (const p of db.policies) [p.name, p.basis, p.changeReason].forEach((s) => add('policy', s));
  for (const a of db.agreements) [a.scope, a.note].forEach((s) => add('agreement', s));
  for (const c of db.calendars) {
    add('calendar', c.name);
    add('calendar', c.source);
    c.holidays.forEach((h) => add('holiday', h.name));
  }
  for (const p of db.protocols) [p.basisReference, p.correctionProcedure, p.connectivityFallback].forEach((s) => add('protocol', s));
  for (const f of db.failedAttempts) add('failedAttempt', f.reason);
  // Reference data translated for display by i18n/localizeDb (customer sites and people excluded).
  for (const c of db.companies) add('company.activity', c.activity);
  for (const d of db.departments) add('department', d.name);
  for (const w of db.worksites.filter((x) => x.kind === 'own')) add('worksite (own)', w.name);
  for (const u of db.users) add('user.title', u.title);
  for (const m of db.memberships) add('membership.reference', m.reference);
  for (const e of db.employees) add('employee.jobTitle', e.jobTitle);
  for (const r of db.relationships) {
    add('relationship.note', r.note);
    add('relationship.reducedHours', r.reducedHours?.basis);
  }
  for (const a of db.agreements) add('agreement.name', a.name);
  for (const a of listAnomalies(db, 'cmp_levante')) add('anomaly.reason', a.reason.text);
  for (const s of db.sessions.slice(-200)) sessionIndicators(db, s).forEach((i) => add('indicator', i.message.text));
}

describe('runtime text has English renderings', () => {
  beforeAll(async () => {
    setClock(new Date('2026-10-14T07:30:00.000Z'));
    resetDemoData();
    initDatabase();
    initSession();
    await exercise();
    collectStatic();
    setLangForTests('en');
  });
  afterAll(() => {
    setLangForTests('es');
    setClock(null);
  });

  it('every label, message, reason, summary and reference text', () => {
    const missing = [...out].filter(([s]) => !hasEnglish(s)).map(([s, where]) => `[${where}] ${s}`);
    expect(missing, `No English rendering for:\n${missing.join('\n')}`).toEqual([]);
  });
});
