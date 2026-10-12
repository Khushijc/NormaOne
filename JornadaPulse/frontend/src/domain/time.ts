/**
 * Time handling for working-time records (BRD §09 "Exceptions", AC-TIM-02).
 *
 * Every event is stored as an unambiguous UTC instant (ISO string ending in "Z") together with
 * the IANA zone of the workplace. Durations are always computed from instants, never from
 * local wall-clock strings, so an overnight shift across a daylight-saving change has the
 * correct elapsed time. Local dates and times are derived for display and grouping only.
 */
import { locale } from '../i18n';
import type { ISODate, ISOInstant } from './types';

export const DEFAULT_TZ = 'Europe/Madrid';

// ─────────────────────────────── Clock (tests can freeze it) ───────────────────────────────
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

// ─────────────────────────────── Zone arithmetic ───────────────────────────────
const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    partsFmt.set(tz, f);
  }
  return f;
}

export interface WallTime {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Wall-clock components of an instant in a zone. */
export function wallTime(instant: ISOInstant | number | Date, tz: string = DEFAULT_TZ): WallTime {
  const date = instant instanceof Date ? instant : new Date(instant);
  const p = fmtFor(tz).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** Offset of the zone from UTC at that instant, in minutes (Madrid: +60 winter, +120 summer). */
export function offsetMinutes(instant: ISOInstant | number | Date, tz: string = DEFAULT_TZ): number {
  const date = instant instanceof Date ? instant : new Date(instant);
  const w = wallTime(date, tz);
  const asUTC = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "UTC+02:00" */
export function formatOffset(instant: ISOInstant, tz: string = DEFAULT_TZ): string {
  const o = offsetMinutes(instant, tz);
  const sign = o >= 0 ? '+' : '-';
  const a = Math.abs(o);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Local calendar date (YYYY-MM-DD) of an instant in the workplace zone. */
export function localDate(instant: ISOInstant | number | Date, tz: string = DEFAULT_TZ): ISODate {
  const w = wallTime(instant, tz);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** Local "HH:mm" of an instant in the workplace zone. */
export function localTime(instant: ISOInstant | number | Date, tz: string = DEFAULT_TZ): string {
  const w = wallTime(instant, tz);
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}

export type LocalResolution =
  | { kind: 'ok'; instant: ISOInstant }
  /** The wall time does not exist (spring-forward gap, e.g. 02:30 on 29/03/2026 in Madrid). */
  | { kind: 'gap' }
  /** The wall time happens twice (fall-back, e.g. 02:30 on 25/10/2026): the caller must choose. */
  | { kind: 'ambiguous'; options: ISOInstant[] }
  | { kind: 'invalid' };

/** Converts a local date + "HH:mm" in a zone to a UTC instant, reporting DST gaps and overlaps. */
export function localToInstant(date: ISODate, time: string, tz: string = DEFAULT_TZ): LocalResolution {
  if (!isValidISODate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { kind: 'invalid' };
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wallAsUTC = Date.UTC(y, m - 1, d, h, mi);
  const offsets = new Set<number>([offsetMinutes(wallAsUTC - 86_400_000, tz), offsetMinutes(wallAsUTC, tz), offsetMinutes(wallAsUTC + 86_400_000, tz)]);
  const matches: number[] = [];
  for (const o of offsets) {
    const candidate = wallAsUTC - o * 60_000;
    const w = wallTime(candidate, tz);
    if (w.y === y && w.m === m && w.d === d && w.h === h && w.mi === mi && !matches.includes(candidate)) matches.push(candidate);
  }
  matches.sort((a, b) => a - b);
  if (matches.length === 0) return { kind: 'gap' };
  if (matches.length === 1) return { kind: 'ok', instant: new Date(matches[0]).toISOString() };
  return { kind: 'ambiguous', options: matches.map((x) => new Date(x).toISOString()) };
}

/** Same as localToInstant but throws on gaps/ambiguity (for seed data and tests). */
export function at(date: ISODate, time: string, tz: string = DEFAULT_TZ, pick: 'first' | 'second' = 'first'): ISOInstant {
  const r = localToInstant(date, time, tz);
  if (r.kind === 'ok') return r.instant;
  if (r.kind === 'ambiguous') return pick === 'first' ? r.options[0] : r.options[1];
  throw new Error(`Hora local no válida: ${date} ${time} (${tz}) → ${r.kind}`);
}

// ─────────────────────────────── Durations ───────────────────────────────
export function minutesBetween(a: ISOInstant, b: ISOInstant): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** "7 h 05 min", "45 min", "0 min" (language-neutral units). */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const sign = minutes < 0 ? '−' : '';
  const a = Math.abs(Math.round(minutes));
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (h === 0) return `${sign}${m} min`;
  return `${sign}${h} h ${String(m).padStart(2, '0')} min`;
}

/** Decimal hours for exports ("7,50" in Spanish CSV is produced by the export layer). */
export function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

// ─────────────────────────────── Calendar dates ───────────────────────────────
export function isValidISODate(s: string | null | undefined): s is ISODate {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUTC(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: ISODate, days: number): ISODate {
  return new Date(toUTC(date) + days * 86_400_000).toISOString().slice(0, 10);
}
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}
/** 0 = Monday … 6 = Sunday. */
export function weekday(date: ISODate): number {
  return (new Date(toUTC(date)).getUTCDay() + 6) % 7;
}
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekday(date));
}
export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}
export function endOfMonth(date: ISODate): ISODate {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function inRange(date: ISODate | null | undefined, from: ISODate | null, to: ISODate | null): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
/** True when [aFrom, aTo] and [bFrom, bTo] share at least one day. */
export function rangesOverlap(aFrom: ISODate, aTo: ISODate, bFrom: ISODate, bTo: ISODate): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}
/** Today's date in the workplace zone. */
export function today(tz: string = DEFAULT_TZ): ISODate {
  return localDate(now(), tz);
}
export function periodOf(date: ISODate): string {
  return date.slice(0, 7);
}

// ─────────────────────────────── Display ───────────────────────────────
export function formatDate(date: ISODate | null | undefined): string {
  if (!date || !isValidISODate(date)) return '—';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

const longDateFmt = new Map<string, Intl.DateTimeFormat>();
/** "lunes, 12 de octubre de 2026" / "Monday, 12 October 2026". */
export function formatDateLong(date: ISODate): string {
  const loc = locale();
  let f = longDateFmt.get(loc);
  if (!f) {
    f = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    longDateFmt.set(loc, f);
  }
  return f.format(new Date(toUTC(date)));
}

const shortDayFmt = new Map<string, Intl.DateTimeFormat>();
/** "lun 12" */
export function formatDayShort(date: ISODate): string {
  const loc = locale();
  let f = shortDayFmt.get(loc);
  if (!f) {
    f = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    shortDayFmt.set(loc, f);
  }
  return f.format(new Date(toUTC(date)));
}

export function formatMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  const name = new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

/** "12/10/2026 08:02" in the given zone. */
export function formatInstant(instant: ISOInstant | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!instant) return '—';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(localDate(d, tz))} ${localTime(d, tz)}`;
}

/** Spanish weekday initials Monday-first, translated at render time. */
export const WEEKDAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
