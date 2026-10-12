/**
 * Pure derivations over working-time records: effective values (original events + approved
 * corrections), durations, policy selection by date and review indicators.
 *
 * Nothing here mutates data. Original events are the evidence; corrections are a reviewed
 * layer on top (TIM-04). Durations use instants, never local wall-clock strings (AC-TIM-02).
 */
import { index } from './indexes';
import { minutesBetween, nowInstant, wallTime } from './time';
import type {
  AttendanceEvent,
  BreakKind,
  CorrectionRequest,
  Database,
  EmploymentRelationship,
  ID,
  ISODate,
  Msg,
  SessionValues,
  WorkingTimePolicy,
  WorkSession,
} from './types';

export const APPLIED_CORRECTION: CorrectionRequest['status'][] = ['approved', 'applied_with_disagreement'];

export function eventById(db: Database, id: ID | null | undefined): AttendanceEvent | undefined {
  return id ? index(db).eventById.get(id) : undefined;
}

/** Values as originally recorded by the events (the evidence). */
export function originalValues(db: Database, s: WorkSession): SessionValues {
  const start = eventById(db, s.startEventId);
  const end = eventById(db, s.endEventId);
  return {
    start: start?.at ?? null,
    end: end?.at ?? null,
    breaks: s.breaks.map((b) => ({ start: eventById(db, b.startEventId)!.at, end: eventById(db, b.endEventId)?.at ?? null, kind: b.kind })),
    worksiteId: s.worksiteId,
    mode: s.mode,
  };
}

/** Approved/applied corrections for a session, oldest first. */
export function appliedCorrections(db: Database, s: WorkSession): CorrectionRequest[] {
  return s.correctionIds
    .map((id) => index(db).correctionById.get(id))
    .filter((c): c is CorrectionRequest => !!c && APPLIED_CORRECTION.includes(c.status) && !!c.approved);
}

/** Effective values: the latest applied correction replaces the original values; otherwise original. */
export function effectiveValues(db: Database, s: WorkSession): SessionValues {
  const applied = appliedCorrections(db, s);
  return applied.length ? applied[applied.length - 1].approved! : originalValues(db, s);
}

export function relationshipOn(db: Database, employeeId: ID, date: ISODate): EmploymentRelationship | undefined {
  return db.relationships
    .filter((r) => r.employeeId === employeeId && r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

/** Policy version in force on a date (PLT-07: later versions never apply to earlier dates). */
export function policyOn(db: Database, companyId: ID, key: string, date: ISODate): WorkingTimePolicy | undefined {
  return db.policies
    .filter((p) => p.companyId === companyId && p.key === key && p.status !== 'draft' && p.effectiveFrom <= date && (!p.effectiveTo || p.effectiveTo >= date))
    .sort((a, b) => b.version - a.version)[0];
}

export function policyForSession(db: Database, s: WorkSession): WorkingTimePolicy | undefined {
  const rel = relationshipOn(db, s.employeeId, s.date);
  return rel ? policyOn(db, s.companyId, rel.policyKey, s.date) : undefined;
}

export interface Durations {
  /** Elapsed time start → end (or → now while open). */
  grossMinutes: number | null;
  /** All recorded break time (closed breaks). */
  breakMinutes: number;
  /** Break time treated as unpaid by the policy version in force on the work date. */
  unpaidBreakMinutes: number;
  /** gross − recorded unpaid breaks. Never an automatic lunch deduction, never capped. */
  netMinutes: number | null;
  /** True while the session has no end (values computed to "now"). */
  provisional: boolean;
}

export function computeDurations(values: SessionValues, paidBreakKinds: BreakKind[], nowIso: string = nowInstant()): Durations {
  if (!values.start) return { grossMinutes: null, breakMinutes: 0, unpaidBreakMinutes: 0, netMinutes: null, provisional: false };
  const provisional = !values.end;
  const end = values.end ?? nowIso;
  const gross = Math.max(0, minutesBetween(values.start, end));
  let breakMinutes = 0;
  let unpaid = 0;
  for (const b of values.breaks) {
    const bEnd = b.end ?? (provisional ? nowIso : null);
    if (!bEnd) continue;
    const m = Math.max(0, minutesBetween(b.start, bEnd));
    breakMinutes += m;
    if (!paidBreakKinds.includes(b.kind)) unpaid += m;
  }
  return { grossMinutes: gross, breakMinutes, unpaidBreakMinutes: unpaid, netMinutes: gross - unpaid, provisional };
}

export function sessionDurations(db: Database, s: WorkSession, nowIso?: string): Durations {
  const policy = policyForSession(db, s);
  return computeDurations(effectiveValues(db, s), policy?.breaks.paidBreakKinds ?? [], nowIso);
}

export type SessionState = 'working' | 'on_break' | 'incomplete' | 'complete';

/** Live state of a session. An open session older than the policy threshold is "incomplete" (AC-TIM-01). */
export function sessionState(db: Database, s: WorkSession, nowIso: string = nowInstant()): SessionState {
  const v = effectiveValues(db, s);
  if (v.end) return 'complete';
  const policy = policyForSession(db, s);
  const limit = (policy?.indicators.missingClockOutAfterHours ?? 14) * 60;
  if (v.start && minutesBetween(v.start, nowIso) > limit) return 'incomplete';
  return v.breaks.some((b) => !b.end) ? 'on_break' : 'working';
}

export function hasPendingCorrection(db: Database, sessionId: ID): boolean {
  return db.corrections.some((c) => c.sessionId === sessionId && (c.status === 'pending' || c.status === 'pending_employee'));
}

/** Record status shown in tables (state + review layer). */
export type RecordStatus = 'working' | 'on_break' | 'incomplete' | 'complete' | 'corrected' | 'correction_pending';

export function recordStatus(db: Database, s: WorkSession, nowIso?: string): RecordStatus {
  if (hasPendingCorrection(db, s.id)) return 'correction_pending';
  const st = sessionState(db, s, nowIso);
  if (st !== 'complete') return st;
  return appliedCorrections(db, s).length ? 'corrected' : 'complete';
}

// ─────────────────────────────── Review indicators (configurable, never conclusions) ───────────────────────────────

export interface Indicator {
  code: 'long_day' | 'night' | 'no_break' | 'short_rest';
  message: Msg;
}

function minutesInNight(startIso: string, endIso: string, tz: string, nightStart: string, nightEnd: string): number {
  // Walk the interval in 15-minute steps (sessions are short; accuracy to the quarter hour is enough for an indicator).
  const [ns] = nightStart.split(':').map(Number);
  const [ne] = nightEnd.split(':').map(Number);
  let count = 0;
  for (let t = new Date(startIso).getTime(); t < new Date(endIso).getTime(); t += 15 * 60000) {
    const h = wallTime(t, tz).h;
    const night = ns > ne ? h >= ns || h < ne : h >= ns && h < ne;
    if (night) count += 15;
  }
  return count;
}

/** Indicators computed with the policy version in force on the work date. */
export function sessionIndicators(db: Database, s: WorkSession, nowIso?: string): Indicator[] {
  const policy = policyForSession(db, s);
  if (!policy) return [];
  const v = effectiveValues(db, s);
  if (!v.start || !v.end) return [];
  const d = computeDurations(v, policy.breaks.paidBreakKinds, nowIso);
  const out: Indicator[] = [];
  const th = policy.indicators;
  if ((d.netMinutes ?? 0) > th.dailyOrdinaryMaxHours * 60) {
    out.push({ code: 'long_day', message: { text: 'Más de {h} h de trabajo efectivo en la jornada (umbral de la política v{v})', params: { h: th.dailyOrdinaryMaxHours, v: policy.version } } });
  }
  const night = minutesInNight(v.start, v.end, s.timezone, th.nightStart, th.nightEnd);
  if (night >= 180) out.push({ code: 'night', message: { text: 'Al menos 3 h en franja nocturna ({from}–{to})', params: { from: th.nightStart, to: th.nightEnd } } });
  if ((d.grossMinutes ?? 0) > th.continuousWorkBreakAfterHours * 60 && d.breakMinutes < th.minBreakMinutes) {
    out.push({ code: 'no_break', message: { text: 'Jornada de más de {h} h sin pausa registrada de {m} min', params: { h: th.continuousWorkBreakAfterHours, m: th.minBreakMinutes } } });
  }
  const prev = (index(db).sessionsByEmployee.get(s.employeeId) ?? [])
    .filter((x) => x.id !== s.id)
    .map((x) => ({ x, v: effectiveValues(db, x) }))
    .filter((p) => p.v.end && p.v.end <= v.start!)
    .sort((a, b) => b.v.end!.localeCompare(a.v.end!))[0];
  if (prev && prev.x.date !== s.date) {
    const rest = minutesBetween(prev.v.end!, v.start);
    if (rest < th.minRestBetweenDaysHours * 60) out.push({ code: 'short_rest', message: { text: 'Descanso entre jornadas de {h} (umbral {min} h)', params: { h: `${Math.floor(rest / 60)} h ${String(rest % 60).padStart(2, '0')} min`, min: th.minRestBetweenDaysHours } } });
  }
  return out;
}
