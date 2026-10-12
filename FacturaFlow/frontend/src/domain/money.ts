import { getLang, locale } from '../i18n';
import type { Cents } from './types';

const formatters = new Map<string, { eur: Intl.NumberFormat; num: Intl.NumberFormat; pct: Intl.NumberFormat }>();

/** Number formatters for the interface language (es-ES or en-GB), created once per locale. */
function fmt() {
  const loc = locale();
  let f = formatters.get(loc);
  if (!f) {
    f = {
      eur: new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }),
      num: new Intl.NumberFormat(loc, { maximumFractionDigits: 4 }),
      pct: new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }),
    };
    formatters.set(loc, f);
  }
  return f;
}

/** Formats integer cents as EUR: "1234,56 €" in Spanish (es-ES groups from 5 digits), "€1,234.56" in English. */
export function formatEUR(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  return fmt().eur.format(cents / 100);
}

const eurRecord = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/**
 * Amount as written into records (audit summaries, service messages): always Spanish,
 * whatever the interface language. The UI translates such text on display.
 */
export function formatEURRecord(cents: Cents): string {
  return eurRecord.format(cents / 100);
}

export function formatNumber(n: number): string {
  return fmt().num.format(n);
}

export function formatPct(n: number): string {
  return getLang() === 'en' ? `${fmt().pct.format(n)}%` : `${fmt().pct.format(n)} %`;
}

/** Half-up rounding (away from zero) to integer cents. */
export function roundCents(value: number): Cents {
  return Math.sign(value) * Math.round(Math.abs(value) + 1e-9);
}

/**
 * Parses an amount typed in either convention ("1.234,56", "1,234.56", "1234.56", "12,5") into cents.
 * When both separators appear, the last one is the decimal separator. A lone comma is decimal
 * ("12,5"), except grouped thousands such as "1,234" while the interface is in English.
 * Returns null if invalid.
 */
export function parseAmountToCents(input: string): Cents | null {
  const s = input.trim().replace(/\s|€/g, '');
  if (s === '') return null;
  let normalised = s;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot > lastComma) {
    // English format: commas group thousands, the dot is decimal.
    normalised = s.replace(/,/g, '');
  } else if (lastComma >= 0 && getLang() === 'en' && /^-?\d{1,3}(,\d{3})+$/.test(s)) {
    normalised = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Spanish format: dots are thousands separators, comma is the decimal separator.
    normalised = s.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalised)) return null;
  return roundCents(Number(normalised) * 100);
}

/** Cents → editable decimal string without currency symbol ("1234,56" in Spanish, "1234.56" in English). */
export function centsToInput(cents: Cents): string {
  const s = (cents / 100).toFixed(2);
  return getLang() === 'en' ? s : s.replace('.', ',');
}

/** Parses a decimal quantity or percentage accepting comma or dot. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
