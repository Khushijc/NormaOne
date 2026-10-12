import { locale } from '../i18n';
import type { ISODate, ISODateTime } from './types';

const TZ = 'Europe/Madrid';

/** Current instant. Centralised so tests can control the clock. */
let clockOverride: Date | null = null;
export function setClock(date: Date | null) {
  clockOverride = date;
}
export function now(): Date {
  return clockOverride ? new Date(clockOverride) : new Date();
}
export function nowISO(): ISODateTime {
  return now().toISOString();
}

/** Current calendar date in the given time zone (default Europe/Madrid). */
export function today(tz: string = TZ): ISODate {
  return toISODateInTz(now(), tz);
}

export function toISODateInTz(d: Date, tz: string = TZ): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUTC(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isValidISODate(s: string | null | undefined): s is ISODate {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Calendar-day arithmetic on ISO dates (no time-zone drift). */
export function addDays(date: ISODate, days: number): ISODate {
  return new Date(toUTC(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the last day of the target month. */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole calendar days from a to b (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

export function formatDate(date: ISODate | null | undefined): string {
  if (!date || !isValidISODate(date)) return '—';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

const dtFormatters = new Map<string, Intl.DateTimeFormat>();
function dtFmt(): Intl.DateTimeFormat {
  const loc = locale();
  let f = dtFormatters.get(loc);
  if (!f) {
    f = new Intl.DateTimeFormat(loc, { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    dtFormatters.set(loc, f);
  }
  return f;
}

/** Formats an instant in Europe/Madrid, e.g. "09/10/2026, 11:42". */
export function formatDateTime(iso: ISODateTime | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dtFmt().format(d);
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  const name = new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}
export function endOfMonth(date: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}
export function startOfQuarter(date: ISODate): ISODate {
  const [y, m] = date.split('-').map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, '0')}-01`;
}
export function endOfQuarter(date: ISODate): ISODate {
  return addDays(addMonths(startOfQuarter(date), 3), -1);
}

export function inRange(date: ISODate | null, from: ISODate | null, to: ISODate | null): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export type PeriodPreset = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'ytd' | 'last_12m' | 'all' | 'custom';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: 'Este mes',
  last_month: 'Mes anterior',
  this_quarter: 'Este trimestre',
  last_quarter: 'Trimestre anterior',
  ytd: 'Año en curso',
  last_12m: 'Últimos 12 meses',
  all: 'Todo el histórico',
  custom: 'Personalizado',
};

export function resolvePeriod(preset: PeriodPreset, ref: ISODate = today()): { from: ISODate | null; to: ISODate | null } {
  switch (preset) {
    case 'this_month':
      return { from: startOfMonth(ref), to: endOfMonth(ref) };
    case 'last_month': {
      const prev = addMonths(startOfMonth(ref), -1);
      return { from: prev, to: endOfMonth(prev) };
    }
    case 'this_quarter':
      return { from: startOfQuarter(ref), to: endOfQuarter(ref) };
    case 'last_quarter': {
      const prev = addMonths(startOfQuarter(ref), -3);
      return { from: prev, to: endOfQuarter(prev) };
    }
    case 'ytd':
      return { from: `${ref.slice(0, 4)}-01-01`, to: ref };
    case 'last_12m':
      return { from: addDays(addMonths(ref, -12), 1), to: ref };
    default:
      return { from: null, to: null };
  }
}
