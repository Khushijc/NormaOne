/**
 * Acceptance tests mapped to the BRD (AC-TIM-01…04, AC-PLT-01/03) and to the validation
 * scenarios of the JornadaPulse brief (§19). They exercise the service layer = the future API.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { listAnomalies } from './domain/anomalies';
import { verifyAuditChain } from './domain/audit';
import { BusinessRuleError, NotFoundError, PermissionError } from './domain/permissions';
import { effectiveValues, originalValues, sessionDurations } from './domain/records';
import { at, setClock } from './domain/time';
import type { SessionValues } from './domain/types';
import { getDb, initDatabase, initSession, resetDemoData, setDemoSwitches, setSession } from './store/db';
import { KEYS, readRaw } from './store/storage';
import { decideCancellation, requestCancellation, reviewAbsence, saveAbsence, withdrawAbsence, balanceFor, conflictsFor } from './services/absenceService';
import { getCtx, visibleEmployeeIds } from './services/context';
import { applyWithDisagreement, proposeCorrection, requestCorrection, respondToProposal, reviewCorrection, withdrawCorrection } from './services/correctionService';
import { reviewAnomaly } from './services/opsService';
import { newPolicyVersion, saveShift } from './services/planningService';
import { closePeriod, createExport, recordRows, RECORD_COLUMNS, SUMMARY_COLUMNS, summaryRows, EMPTY_FILTERS, partTimeSummary } from './services/reportService';
import { clock, myStatus, NotRecordedError, requestRecordDeletion } from './services/timeService';

// Wednesday 14/10/2026 at 09:30 in Madrid (UTC+02:00).
const NOW = new Date('2026-10-14T07:30:00.000Z');
const TODAY = '2026-10-14';
const as = (userId: string, companyId = 'cmp_levante') => setSession({ userId, companyId });
let key = 0;
const k = () => `test-key-${++key}`;

beforeEach(() => {
  setClock(NOW);
  resetDemoData();
  initDatabase();
  initSession();
  setDemoSwitches({ simulateClockFailure: false });
});

const expectRule = async (p: Promise<unknown>, cls: new (...args: never[]) => Error = BusinessRuleError) => {
  await expect(p).rejects.toBeInstanceOf(cls);
};

describe('Clocking (TIM-02, §19 attendance)', () => {
  it('records clock-in, breaks and clock-out as persisted events with receipts', async () => {
    as('usr_javier');
    // Javier's seeded day may already be open at 09:30; close it first if so.
    if (myStatus().state === 'working') await clock({ action: 'clock_out', worksiteId: 'ws_oficina', mode: 'onsite', idempotencyKey: k() });
    setClock(new Date('2026-10-14T08:00:00.000Z'));
    const r1 = await clock({ action: 'clock_in', worksiteId: 'ws_oficina', mode: 'onsite', idempotencyKey: k() });
    expect(r1.receipt).toMatch(/^JP-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(myStatus().state).toBe('working');
    setClock(new Date('2026-10-14T10:00:00.000Z'));
    await clock({ action: 'break_start', worksiteId: 'ws_oficina', mode: 'onsite', breakKind: 'meal', idempotencyKey: k() });
    expect(myStatus().state).toBe('on_break');
    await expectRule(clock({ action: 'clock_out', worksiteId: 'ws_oficina', mode: 'onsite', idempotencyKey: k() }));
    setClock(new Date('2026-10-14T10:30:00.000Z'));
    await clock({ action: 'break_end', worksiteId: 'ws_oficina', mode: 'onsite', breakKind: 'meal', idempotencyKey: k() });
    setClock(new Date('2026-10-14T13:00:00.000Z'));
    const out = await clock({ action: 'clock_out', worksiteId: 'ws_oficina', mode: 'onsite', idempotencyKey: k() });
    const s = getDb().sessions.find((x) => x.id === out.session.id)!;
    const d = sessionDurations(getDb(), s);
    expect(d.grossMinutes).toBe(300);
    expect(d.unpaidBreakMinutes).toBe(30);
    expect(d.netMinutes).toBe(270);
    // Persisted to (demo) storage, not only in memory.
    expect(readRaw(KEYS.db)).toContain(out.event.id);
  });

  it('never duplicates an event for a repeated click and rejects impossible transitions', async () => {
    as('usr_lucia');
    setClock(new Date('2026-10-14T16:00:00.000Z'));
    const key1 = k();
    const a = await clock({ action: 'clock_in', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: key1 });
    const b = await clock({ action: 'clock_in', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: key1 });
    expect(b.duplicate).toBe(true);
    expect(b.event.id).toBe(a.event.id);
    await expectRule(clock({ action: 'clock_in', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: k() }));
    await expectRule(clock({ action: 'break_end', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: k() }));
    await expectRule(clock({ action: 'clock_in', worksiteId: 'ws_marblau', mode: 'onsite', idempotencyKey: k() }));
  });

  it('rejects clock-out without an open session', async () => {
    as('usr_sergio');
    setClock(new Date('2026-10-14T04:00:00.000Z')); // 06:00, before his shift
    if (myStatus().state === 'not_started' || myStatus().state === 'complete') {
      await expectRule(clock({ action: 'clock_out', worksiteId: 'ws_marblau', mode: 'onsite', idempotencyKey: k() }));
    }
  });

  it('shows "No registrado" on a simulated failure: no event, a failed attempt and a correction route', async () => {
    as('usr_lucia');
    setClock(new Date('2026-10-14T16:00:00.000Z'));
    const before = getDb().events.length;
    setDemoSwitches({ simulateClockFailure: true });
    await expect(clock({ action: 'clock_in', worksiteId: 'ws_cowork', mode: 'onsite', idempotencyKey: k() })).rejects.toBeInstanceOf(NotRecordedError);
    expect(getDb().events.length).toBe(before);
    const failed = getDb().failedAttempts.filter((f) => f.employeeId === 'emp_lucia' && !f.correctionId);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(listAnomalies(getDb(), 'cmp_levante').some((a) => a.type === 'not_recorded' && a.employeeId === 'emp_lucia')).toBe(true);
    setDemoSwitches({ simulateClockFailure: false });
    const f = failed[failed.length - 1];
    const c = await requestCorrection({ employeeId: 'emp_lucia', sessionId: null, failedAttemptId: f.id, date: TODAY, kind: 'connectivity', requested: { start: at(TODAY, '18:00'), end: at(TODAY, '18:00') === '' ? null : '2026-10-14T16:00:00.000Z', breaks: [], worksiteId: 'ws_cowork', mode: 'onsite' }, explanation: 'Fallo de conexión al fichar en el coworking; empecé a las 18:00.' }).catch((e) => e);
    // End before start (18:00 local is 16:00 UTC; same instant) → invalid values.
    expect(c).toBeInstanceOf(BusinessRuleError);
  });

  it('blocks deleting a three-year-old record of a former employee and records the decision (AC-TIM-04)', async () => {
    as('usr_javier');
    const old = getDb().sessions.find((s) => s.employeeId === 'emp_teresa' && s.date === '2023-10-05')!;
    const d = await requestRecordDeletion(old.id, 'Limpieza de datos de antiguos empleados');
    expect(d.outcome).toBe('blocked');
    expect(d.retentionUntil).toBe('2027-10-05');
    expect(getDb().sessions.some((s) => s.id === old.id)).toBe(true);
    expect(getDb().audit.some((e) => e.action === 'retention.delete_blocked' && e.entityId === old.id)).toBe(true);
  });
});

describe('Corrections (TIM-04, AC-TIM-01)', () => {
  const pablo = () => getDb().corrections.find((c) => c.employeeId === 'emp_pablo' && c.status === 'pending')!;

  it('keeps the original, requested and approved values and notifies the employee', async () => {
    const c = pablo();
    const s = getDb().sessions.find((x) => x.id === c.sessionId)!;
    expect(effectiveValues(getDb(), s).end).toBeNull();
    as('usr_elena');
    const approved: SessionValues = { ...c.requested, end: at(s.date, '15:30') };
    const r = await reviewCorrection(c.id, 'approve', 'Confirmado con el parte de trabajo; 15:30.', approved);
    expect(r.status).toBe('approved');
    const s2 = getDb().sessions.find((x) => x.id === c.sessionId)!;
    expect(effectiveValues(getDb(), s2).end).toBe(approved.end);
    expect(originalValues(getDb(), s2).end).toBeNull();
    expect(r.original!.end).toBeNull();
    expect(r.requested.end).not.toBe(r.approved!.end);
    expect(getDb().notifications.some((n) => n.recipientUserIds.includes('usr_pablo') && n.type === 'correction_decided')).toBe(true);
    // Repeated approval is refused.
    await expectRule(reviewCorrection(c.id, 'approve', 'otra vez'));
    // The missing clock-out anomaly is resolved through the correction, with history kept.
    const a = listAnomalies(getDb(), 'cmp_levante').find((x) => x.key === `mco:${c.sessionId}`)!;
    expect(a.active).toBe(false);
    expect(a.status).toBe('resolved');
  });

  it('refuses unauthorised and self approval', async () => {
    as('usr_lucia');
    await expectRule(reviewCorrection(pablo().id, 'approve', ''), PermissionError);
    as('usr_amparo'); // supervisor, but not of Pablo's team
    await expectRule(reviewCorrection(pablo().id, 'approve', ''), PermissionError);
    as('usr_pablo');
    await expectRule(reviewCorrection(pablo().id, 'approve', ''), PermissionError);
  });

  it('requires a rejection reason and an explanation, validates values and prevents parallel requests', async () => {
    as('usr_elena');
    await expectRule(reviewCorrection(pablo().id, 'reject', ''));
    const r = await reviewCorrection(pablo().id, 'reject', 'El parte indica 14:00; solicite de nuevo con la hora correcta.');
    expect(r.status).toBe('rejected');
    as('usr_pablo');
    const s = getDb().sessions.find((x) => x.id === r.sessionId)!;
    const base = effectiveValues(getDb(), s);
    await expectRule(requestCorrection({ employeeId: 'emp_pablo', sessionId: s.id, date: s.date, kind: 'missing_clock_out', requested: { ...base, end: at(s.date, '14:00') }, explanation: 'corta' }));
    await expectRule(requestCorrection({ employeeId: 'emp_pablo', sessionId: s.id, date: s.date, kind: 'missing_clock_out', requested: { ...base, end: at(s.date, '06:00') }, explanation: 'Salida anterior a la entrada para probar.' }));
    const ok = await requestCorrection({ employeeId: 'emp_pablo', sessionId: s.id, date: s.date, kind: 'missing_clock_out', requested: { ...base, end: at(s.date, '14:00') }, explanation: 'Salí a las 14:00 según el parte de trabajo.' });
    expect(ok.status).toBe('pending');
    await expectRule(requestCorrection({ employeeId: 'emp_pablo', sessionId: s.id, date: s.date, kind: 'missing_clock_out', requested: { ...base, end: at(s.date, '14:10') }, explanation: 'Segunda solicitud sobre el mismo registro.' }));
    await withdrawCorrection(ok.id, 'Me equivoqué');
    expect(getDb().corrections.find((c) => c.id === ok.id)!.status).toBe('withdrawn');
  });

  it('cannot correct another employee as an employee', async () => {
    as('usr_lucia');
    const c = pablo();
    await expectRule(requestCorrection({ employeeId: 'emp_pablo', sessionId: c.sessionId, date: c.date, kind: 'other', requested: c.requested, explanation: 'Intento sobre un registro ajeno.' }), PermissionError);
  });

  it('company proposals need the employee agreement or a recorded disagreement', async () => {
    as('usr_andres');
    const p = getDb().corrections.find((c) => c.employeeId === 'emp_andres' && c.status === 'pending_employee')!;
    const r = await respondToProposal(p.id, false, 'Ese día no paré: terminé antes la revisión.');
    expect(r.status).toBe('pending_employee');
    expect(r.employeeResponse!.agreed).toBe(false);
    as('usr_javier');
    await expectRule(applyWithDisagreement(p.id, 'corto'));
    const applied = await applyWithDisagreement(p.id, 'Se aplica según el parte; se informa al delegado de personal.');
    expect(applied.status).toBe('applied_with_disagreement');
    expect(applied.employeeResponse!.comment).toContain('no paré');
  });

  it('blocks corrections inside a closed period until it is reopened', async () => {
    as('usr_javier');
    const prevPeriodSession = getDb().sessions.find((s) => s.employeeId === 'emp_lucia' && s.date.startsWith('2026-09') && s.endEventId)!;
    const v = effectiveValues(getDb(), prevPeriodSession);
    await expectRule(proposeCorrection({ employeeId: 'emp_lucia', sessionId: prevPeriodSession.id, date: prevPeriodSession.date, kind: 'wrong_end', requested: { ...v, end: new Date(new Date(v.end!).getTime() - 10 * 60000).toISOString() }, explanation: 'Ajuste de prueba en periodo cerrado.' }, false));
  });
});

describe('Absences (TIM-05, §19 absences)', () => {
  it('validates dates, overlaps and partial days', async () => {
    as('usr_lucia');
    await expectRule(saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-11-10', endDate: '2026-11-05', partial: null, note: '' }, true));
    await expectRule(saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-11-02', endDate: '2026-11-02', partial: { startTime: '09:00', endTime: '10:00' }, note: '' }, true));
    const ok = await saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-11-02', endDate: '2026-11-06', partial: null, note: 'Vacaciones' }, true);
    expect(ok.status).toBe('pending');
    await expectRule(saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-11-04', endDate: '2026-11-09', partial: null, note: 'Duplicada' }, true));
    const partial = await saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_deber', startDate: '2026-11-12', endDate: '2026-11-12', partial: { startTime: '07:00', endTime: '08:00' }, note: 'Citación' }, true);
    expect(partial.partial).toEqual({ startTime: '07:00', endTime: '08:00' });
  });

  it('approval requires authority, acknowledges conflicts and never creates attendance', async () => {
    as('usr_lucia');
    const req = await saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_vac', startDate: '2026-10-21', endDate: '2026-10-22', partial: null, note: 'Puente' }, true);
    expect(conflictsFor(getCtx(), req).some((c) => c.code === 'planned_shifts')).toBe(true);
    as('usr_pablo');
    await expectRule(reviewAbsence(req.id, 'approve', ''), PermissionError);
    as('usr_amparo');
    await expectRule(reviewAbsence(req.id, 'approve', ''));
    const events = getDb().events.length;
    const sessions = getDb().sessions.length;
    const ok = await reviewAbsence(req.id, 'approve', '', ['planned_shifts']);
    expect(ok.status).toBe('approved');
    expect(getDb().events.length).toBe(events);
    expect(getDb().sessions.length).toBe(sessions);
    await expectRule(reviewAbsence(req.id, 'approve', '', ['planned_shifts']));
  });

  it('rejection requires a reason; withdraw and traceable cancellation keep history', async () => {
    as('usr_lucia');
    const a = await saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_pnr', startDate: '2026-11-16', endDate: '2026-11-16', partial: null, note: '' }, true);
    as('usr_amparo');
    await expectRule(reviewAbsence(a.id, 'reject', ''));
    await reviewAbsence(a.id, 'approve', '', []);
    as('usr_lucia');
    await expectRule(requestCancellation(a.id, ''));
    const cr = await requestCancellation(a.id, 'Ya no necesito el día');
    expect(cr.status).toBe('cancel_requested');
    as('usr_amparo');
    const done = await decideCancellation(a.id, true, 'Cancelación aceptada');
    expect(done.status).toBe('cancelled');
    expect(getDb().absences.find((x) => x.id === a.id)!.history.map((h) => h.action)).toEqual(['submitted', 'approved', 'cancel_requested', 'cancelled']);
    as('usr_lucia');
    const w = await saveAbsence({ employeeId: 'emp_lucia', typeId: 'abt_pnr', startDate: '2026-11-23', endDate: '2026-11-23', partial: null, note: '' }, true);
    expect((await withdrawAbsence(w.id, '')).status).toBe('withdrawn');
  });

  it('registers sick leave without approval or medical data and masks it for supervisors', async () => {
    as('usr_pablo');
    const it_ = await saveAbsence({ employeeId: 'emp_pablo', typeId: 'abt_it', startDate: '2026-10-15', endDate: '2026-10-16', partial: null, note: '' }, true);
    expect(it_.status).toBe('approved');
    as('usr_elena');
    const { absenceTypeLabel } = await import('./services/absenceService');
    expect(absenceTypeLabel(getCtx(), it_)).toContain('reservada');
    as('usr_javier');
    expect(absenceTypeLabel(getCtx(), it_)).toContain('Baja médica');
  });

  it('shows a balance only for adviser-approved allowances', () => {
    as('usr_pablo');
    const ctx = getCtx();
    expect(balanceFor(ctx, 'emp_pablo', 'abt_vac', 2026)).not.toBeNull();
    expect(balanceFor(ctx, 'emp_pablo', 'abt_ap', 2026)).toBeNull();
  });
});

describe('Permissions and isolation (PLT-03, AC-PLT-01)', () => {
  it('scopes records by role', () => {
    as('usr_pablo');
    expect([...visibleEmployeeIds(getCtx())]).toEqual(['emp_pablo']);
    as('usr_elena');
    const team = visibleEmployeeIds(getCtx());
    expect(team.has('emp_pablo')).toBe(true);
    expect(team.has('emp_lucia')).toBe(false);
    as('usr_rosa');
    const payroll = getCtx();
    expect(visibleEmployeeIds(payroll).size).toBeGreaterThan(10);
    expect(payroll.perms.has('employees.manage')).toBe(false);
    as('usr_nuria'); // expired mandate
    expect(getCtx().perms.size).toBe(0);
  });

  it('refuses another company record as "not found"', async () => {
    as('usr_iker', 'cmp_ibaigane');
    const levanteSession = getDb().sessions.find((s) => s.companyId === 'cmp_levante')!;
    await expectRule(requestRecordDeletion(levanteSession.id, 'Prueba de aislamiento entre empresas'), NotFoundError);
    expect(recordRows(getCtx(), EMPTY_FILTERS).every((r) => r.session.companyId === 'cmp_ibaigane')).toBe(true);
  });

  it('gives representatives minimised exports', async () => {
    as('usr_andres');
    const ctx = getCtx();
    const rows = summaryRows(ctx, '2026-09');
    const { content, job } = await createExport({ kind: 'resumen_mensual', title: 'Resumen mensual', format: 'csv', rows, columns: SUMMARY_COLUMNS, filters: 'Sin filtros', period: '2026-09', download: false });
    expect(job.minimised).toBe(true);
    expect(content).not.toContain('Días laborables de ausencia aprobada');
    expect(content).toContain('# minimizado: true');
  });
});

describe('Reports, exports and periods (TIM-06, TIM-08)', () => {
  it('exports exactly the filtered rows and discloses open exceptions', async () => {
    as('usr_javier');
    const ctx = getCtx();
    const f = { ...EMPTY_FILTERS, departmentId: 'dep_limp', from: '2026-10-01', to: TODAY };
    const rows = recordRows(ctx, f);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => getDb().employees.find((e) => e.id === r.employeeId)!.departmentId === 'dep_limp')).toBe(true);
    const { content, job } = await createExport({ kind: 'registros', title: 'Registros horarios', format: 'json', rows, columns: RECORD_COLUMNS, filters: 'Limpieza', period: null, download: false });
    const parsed = JSON.parse(content);
    expect(parsed.records).toHaveLength(rows.length);
    expect(parsed.meta.incidencias_abiertas).toBeGreaterThan(0);
    expect(job.recordCount).toBe(rows.length);
    expect(getDb().audit.some((e) => e.action === 'export.create' && e.entityId === job.id)).toBe(true);
  });

  it('closing a period requires acknowledging open items (AC-PLT-04 spirit)', async () => {
    as('usr_javier');
    await expectRule(closePeriod('2026-10', '', false));
    await closePeriod('2026-10', 'Se declaran las incidencias abiertas a la asesoría.', true);
    const p = getDb().periods.find((x) => x.companyId === 'cmp_levante' && x.period === '2026-10')!;
    expect(p.status).toBe('closed');
    expect(p.openExceptionsAtClose).toBeGreaterThan(0);
    as('usr_rosa');
    await expectRule(closePeriod('2026-11', 'x', true), PermissionError);
  });

  it('produces the part-time monthly summary with version and date (AC-TIM-03)', () => {
    as('usr_lucia');
    const s = partTimeSummary(getCtx(), 'emp_lucia', '2026-09');
    expect(s.days).toHaveLength(30);
    expect(s.totalNetMinutes).toBeGreaterThan(0);
    expect(s.version).toMatch(/^[0-9A-F]{8}$/);
    expect(s.generatedAt).toBe(NOW.toISOString());
  });
});

describe('Planning and policies (TIM-01, PLT-07, AC-PLT-03)', () => {
  it('a planned shift never becomes actual time and DST gaps are rejected', async () => {
    as('usr_elena');
    const sessions = getDb().sessions.length;
    await saveShift({ employeeId: 'emp_pablo', worksiteId: 'ws_torre', date: '2026-10-28', startTime: '07:30', endTime: '15:30', note: '' }, null);
    expect(getDb().sessions.length).toBe(sessions);
    await expectRule(saveShift({ employeeId: 'emp_pablo', worksiteId: 'ws_torre', date: '2027-03-28', startTime: '02:30', endTime: '06:00', note: '' }, null));
    as('usr_elena');
    await expectRule(saveShift({ employeeId: 'emp_lucia', worksiteId: 'ws_dental', date: '2026-10-28', startTime: '07:00', endTime: '09:00', note: '' }, null), PermissionError);
  });

  it('a new policy version is never retroactive', async () => {
    as('usr_javier');
    const p = getDb().policies.find((x) => x.id === 'pol_mant_v1')!;
    const patch = { breaks: { paidBreakKinds: [] as never[], paidBreakMinutes: 0 }, indicators: p.indicators, basis: 'Prueba' };
    await expectRule(newPolicyVersion('mantenimiento', patch, '2026-10-01', 'Cambio retroactivo de prueba'));
    const s = getDb().sessions.find((x) => x.employeeId === 'emp_elena' && x.endEventId && x.breaks.length && x.date < TODAY)!;
    const before = sessionDurations(getDb(), s).netMinutes;
    await newPolicyVersion('mantenimiento', patch, '2026-10-15', 'La pausa deja de ser retribuida (prueba).');
    expect(sessionDurations(getDb(), s).netMinutes).toBe(before);
  });
});

describe('Audit and persistence (PLT-06)', () => {
  it('chains audit events and survives a reload; reset restores the seed', async () => {
    as('usr_javier');
    await reviewAnomaly(listAnomalies(getDb(), 'cmp_levante').find((a) => a.type === 'duplicate_event')!.key, 'acknowledge', 'Visto');
    expect(verifyAuditChain(getDb().audit.filter((e) => e.companyId === 'cmp_levante')).ok).toBe(true);
    const count = getDb().anomalyReviews.length;
    initDatabase(); // simulates a page refresh
    expect(getDb().anomalyReviews.length).toBe(count);
    resetDemoData();
    expect(getDb().anomalyReviews.length).toBeLessThan(count);
  });
});
