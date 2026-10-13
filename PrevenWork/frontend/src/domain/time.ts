/**
 * Time, Calendar-Month and 72-Hour Clock Engine for PrevenWork.
 *
 * Implements:
 * 1. Calendar-month rule for GDPR rights requests (Art. 12.3 RGPD):
 *    - Received on day D of month M -> Due on day D of month M+1.
 *    - If month M+1 has fewer days than D (e.g. 31 Jan -> 28/29 Feb), the deadline is the last day of that month.
 *    - Leap years (2024, 2028, 2032) are properly calculated.
 *    - Reassigning or updating a case never resets this deadline.
 * 2. 72-hour clock for Personal Data Incidents (Art. 33 RGPD):
 *    - Calculated from ORGANISATIONAL AWARENESS (awarenessTimestamp), running continuously through weekends.
 */
import type { ISODate, ISOInstant } from './types';

export const DEFAULT_TZ = 'Europe/Madrid';

let clockOverride: Date | null = null;
export function setClock(date: Date | null) {
  clockOverride = date;
}
export function now(): Date {
  return clockOverride ? new Date(clockOverride) : new Date();
}
export function nowInstant(): ISOInstant {
  return now().toISOString();
}

/** Local calendar date YYYY-MM-DD from an instant */
export function localDate(instant: ISOInstant | number | Date = now()): ISODate {
  const d = instant instanceof Date ? instant : new Date(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): ISODate {
  return localDate(now());
}

export function isValidISODate(s: string | null | undefined): s is ISODate {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function formatDate(date: ISODate | null | undefined): string {
  if (!date || !isValidISODate(date)) return '—';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function formatInstant(instant: ISOInstant | null | undefined): string {
  if (!instant) return '—';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Legal Calendar-Month Rule (Art. 12.3 RGPD):
 * Given an intake date YYYY-MM-DD, adds `months` calendar months.
 * If the target month has fewer days than the start day (e.g. Jan 31 -> Feb),
 * it returns the last valid day of that month (Feb 28 in normal years, Feb 29 in leap years).
 */
export function addCalendarMonths(startDate: ISODate, months: number): ISODate {
  const [y, m, d] = startDate.split('-').map(Number);
  // Target year & month (1-indexed)
  const totalMonths = (y * 12) + (m - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;

  // Find the last day of targetMonth
  // Date(year, month, 0) gives the last day of month
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(d, daysInTargetMonth);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}`;
}

export type RightsDeadlineStatus =
  | 'on_track'
  | 'approaching'
  | 'overdue'
  | 'extended'
  | 'completed';

export function evaluateRightsDeadline(
  effectiveDeadline: ISODate,
  isClosed: boolean,
  currentDate: ISODate = today()
): { status: RightsDeadlineStatus; daysRemaining: number } {
  if (isClosed) return { status: 'completed', daysRemaining: 0 };

  const [cy, cm, cd] = currentDate.split('-').map(Number);
  const [dy, dm, dd] = effectiveDeadline.split('-').map(Number);
  const cTime = Date.UTC(cy, cm - 1, cd);
  const dTime = Date.UTC(dy, dm - 1, dd);
  const diffDays = Math.round((dTime - cTime) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { status: 'overdue', daysRemaining: diffDays };
  if (diffDays <= 7) return { status: 'approaching', daysRemaining: diffDays };
  return { status: 'on_track', daysRemaining: diffDays };
}

// ─────────────────────────────── 72-Hour Continuous Clock (Art. 33 RGPD) ───────────────────────────────

export interface IncidentClock72h {
  totalHoursElapsed: number;
  remainingHours: number;
  remainingMinutes: number;
  isOverdue: boolean;
  status: 'normal' | 'warning' | 'critical' | 'expired' | 'notified';
  formattedCountdown: string;
}

export function computeIncidentClock(
  awarenessTimestamp: ISOInstant,
  authorityNotified: boolean,
  currentInstant: ISOInstant = nowInstant()
): IncidentClock72h {
  if (authorityNotified) {
    return {
      totalHoursElapsed: 0,
      remainingHours: 0,
      remainingMinutes: 0,
      isOverdue: false,
      status: 'notified',
      formattedCountdown: 'Notificado a AEPD',
    };
  }

  const awarenessTime = new Date(awarenessTimestamp).getTime();
  const currentTime = new Date(currentInstant).getTime();
  const diffMs = currentTime - awarenessTime;
  const elapsedMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHoursElapsed = Math.floor(elapsedMinutes / 60);

  const limitMs = 72 * 60 * 60 * 1000;
  const remainingMs = (awarenessTime + limitMs) - currentTime;
  const isOverdue = remainingMs < 0;

  const absRemMinutes = Math.abs(Math.floor(remainingMs / (1000 * 60)));
  const remHours = Math.floor(absRemMinutes / 60);
  const remMins = absRemMinutes % 60;

  let status: IncidentClock72h['status'] = 'normal';
  if (isOverdue) {
    status = 'expired';
  } else if (remHours <= 8) {
    status = 'critical';
  } else if (remHours <= 24) {
    status = 'warning';
  }

  const formattedCountdown = isOverdue
    ? `Vencido (+${remHours}h ${remMins}m)`
    : `${remHours}h ${remMins}m restantes`;

  return {
    totalHoursElapsed,
    remainingHours: isOverdue ? -remHours : remHours,
    remainingMinutes: remMins,
    isOverdue,
    status,
    formattedCountdown,
  };
}
