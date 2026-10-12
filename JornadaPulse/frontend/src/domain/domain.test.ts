/**
 * Domain rules over the seeded dataset (pure functions, no UI).
 */
import { describe, expect, it } from 'vitest';
import { buildSeedDatabase } from '../data/seed';
import { listAnomalies } from './anomalies';
import { effectiveValues, originalValues, policyForSession, recordStatus, sessionDurations } from './records';
import { at, formatOffset, localToInstant, minutesBetween } from './time';

const ANCHOR = new Date('2026-10-14T13:30:00.000Z'); // Wednesday 14/10/2026, 15:30 in Madrid
const db = buildSeedDatabase(ANCHOR);
const NOW = ANCHOR.toISOString();

describe('time handling (AC-TIM-02)', () => {
  it('reports DST gaps and ambiguous hours in Europe/Madrid', () => {
    expect(localToInstant('2026-03-29', '02:30').kind).toBe('gap');
    const amb = localToInstant('2026-10-25', '02:30');
    expect(amb.kind).toBe('ambiguous');
    if (amb.kind === 'ambiguous') expect(minutesBetween(amb.options[0], amb.options[1])).toBe(60);
    expect(localToInstant('2026-10-14', '08:00')).toEqual({ kind: 'ok', instant: '2026-10-14T06:00:00.000Z' });
  });

  it('computes the real elapsed time of an overnight shift across the spring DST change', () => {
    const s = db.sessions.find((x) => x.employeeId === 'emp_sergio' && x.date === '2026-03-28')!;
    const v = effectiveValues(db, s);
    expect(minutesBetween(v.start!, v.end!)).toBe(7 * 60);
    expect(formatOffset(v.start!)).toBe('UTC+01:00');
    expect(formatOffset(v.end!)).toBe('UTC+02:00');
    expect(sessionDurations(db, s, NOW).grossMinutes).toBe(420);
  });
});

describe('seeded records', () => {
  it('keeps planned shifts and actual sessions separate', () => {
    expect(db.shifts.length).toBeGreaterThan(300);
    expect(db.sessions.length).toBeGreaterThan(250);
    // No session is created for a future date.
    expect(db.sessions.every((s) => effectiveValues(db, s).start! <= NOW)).toBe(true);
  });

  it('shows a forgotten clock-out as incomplete, not completed (AC-TIM-01)', () => {
    const c = db.corrections.find((x) => x.employeeId === 'emp_pablo' && x.kind === 'missing_clock_out')!;
    const s = db.sessions.find((x) => x.id === c.sessionId)!;
    expect(effectiveValues(db, s).end).toBeNull();
    expect(recordStatus(db, s, NOW)).toBe('correction_pending');
  });

  it('applies an approved correction without touching the original events', () => {
    const c = db.corrections.find((x) => x.status === 'approved')!;
    const s = db.sessions.find((x) => x.id === c.sessionId)!;
    expect(effectiveValues(db, s).end).toBe(c.approved!.end);
    expect(originalValues(db, s).end).toBe(c.original!.end);
    expect(originalValues(db, s).end).not.toBe(effectiveValues(db, s).end);
  });

  it('selects the policy version in force on the work date (no retroactive change)', () => {
    const lim = db.sessions.filter((s) => db.employees.find((e) => e.id === s.employeeId)!.departmentId === 'dep_limp');
    const versions = new Set(lim.map((s) => policyForSession(db, s)?.version));
    expect(versions.has(1)).toBe(true);
    expect(versions.has(2)).toBe(true);
  });

  it('detects the seeded anomalies from data', () => {
    const types = new Set(listAnomalies(db, 'cmp_levante', NOW).map((a) => a.type));
    for (const t of ['missing_clock_out', 'overlapping_sessions', 'duplicate_event', 'long_session', 'short_session', 'shift_absence_conflict', 'not_recorded', 'pending_correction']) {
      expect(types, t).toContain(t);
    }
  });

  it('never seeds attendance on approved full-day absences', () => {
    for (const a of db.absences.filter((x) => x.status === 'approved' && !x.partial)) {
      const worked = db.sessions.filter((s) => s.employeeId === a.employeeId && s.date >= a.startDate && s.date <= a.endDate);
      expect(worked, a.id).toHaveLength(0);
    }
  });

  it('is deterministic for the same anchor', () => {
    const again = buildSeedDatabase(ANCHOR);
    expect(again.events.length).toBe(db.events.length);
    expect(again.events[10]).toEqual(db.events[10]);
    expect(at('2026-10-14', '07:30')).toBe('2026-10-14T05:30:00.000Z');
  });
});
