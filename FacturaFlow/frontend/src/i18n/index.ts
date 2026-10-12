/**
 * Interface language (Spanish ⇄ English).
 *
 * Spanish is the source language: every UI string is written in Spanish in the code and
 * wrapped in `t()`, and the Spanish text itself is the dictionary key. English comes from
 * `./en/*.ts`. A missing entry falls back to the Spanish text, so nothing ever renders blank.
 *
 * Records stay in Spanish. Audit summaries, notifications and service/validation messages
 * are stored or produced in Spanish (the language of the record) and translated only when
 * displayed: `t(storedText)` first tries an exact entry, then the `{placeholder}` entries as
 * templates. Business data typed by users (names, descriptions) is never translated.
 *
 * This module is framework-free so domain code (formatters) can read the locale; the React
 * hook lives in `store/hooks.ts`.
 */
import { EN } from './en';

export type Lang = 'es' | 'en';
export type Params = Record<string, string | number>;

const STORAGE_KEY = 'facturaflow.v1.lang';
export const LANG_LABEL: Record<Lang, string> = { es: 'Español', en: 'English' };

function readStoredLang(): Lang {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return v === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

let lang: Lang = readStoredLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

/** BCP 47 locale for dates and numbers in the current language. */
export function locale(): string {
  return lang === 'en' ? 'en-GB' : 'es-ES';
}

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode / blocked storage: the choice simply lasts for this page view.
  }
  applyDocumentLang();
  listeners.forEach((l) => l());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Keeps <html lang> and the tab title in step with the interface language. */
export function applyDocumentLang() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.title = t('Facturas y Gastos · Portal Pyme');
}

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(text: string, params: Params): string {
  return text.replace(PLACEHOLDER, (m, k: string) => (k in params ? String(params[k]) : m));
}

interface Template {
  re: RegExp;
  names: string[];
  en: string;
  weight: number;
}

let templates: Template[] | null = null;

function compileTemplates(): Template[] {
  const list: Template[] = [];
  for (const [es, en] of Object.entries(EN)) {
    if (!es.includes('{')) continue;
    const names: string[] = [];
    let pattern = '';
    let last = 0;
    for (const m of es.matchAll(PLACEHOLDER)) {
      pattern += escapeRe(es.slice(last, m.index)) + '([\\s\\S]+?)';
      names.push(m[1]);
      last = m.index! + m[0].length;
    }
    pattern += escapeRe(es.slice(last));
    const weight = es.replace(PLACEHOLDER, '').length;
    if (weight < 3) continue; // a bare "{x}" would match anything
    list.push({ re: new RegExp(`^${pattern}$`), names, en, weight });
  }
  // Most specific (longest literal text) first.
  return list.sort((a, b) => b.weight - a.weight);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cache = new Map<string, string>();
const CONTEXT = / \[[^\]]+\]$/;

const enEUR = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const ES_AMOUNT = /(-?\d{1,3}(?:\.\d{3})+|-?\d+),(\d{2})\s?€/g;

/** Stored Spanish text embeds amounts as "1.234,56 €"; show them as "€1,234.56" in English. */
function englishAmounts(s: string): string {
  return s.replace(ES_AMOUNT, (_, int: string, dec: string) => enEUR.format(Number(`${int.replace(/\./g, '')}.${dec}`)));
}

function toEnglish(es: string, depth = 0): string {
  const exact = EN[es];
  if (exact !== undefined) return exact;
  if (depth > 1 || es.length < 3) return es;
  const hit = cache.get(es);
  if (hit !== undefined) return hit;
  let out = es;
  const monthYear = /^(\p{L}+) (\d{4})$/u.exec(es);
  if (monthYear && EN[monthYear[1]] !== undefined) {
    out = `${EN[monthYear[1]]} ${monthYear[2]}`;
    cache.set(es, out);
    return out;
  }
  templates ??= compileTemplates();
  for (const tpl of templates) {
    const m = tpl.re.exec(es);
    if (!m) continue;
    const values: Params = {};
    tpl.names.forEach((n, i) => (values[n] = toEnglish(m[i + 1], depth + 1)));
    out = englishAmounts(interpolate(tpl.en, values));
    break;
  }
  cache.set(es, out);
  return out;
}

/**
 * Translates Spanish source text into the current interface language.
 * `t('Factura {n} emitida', { n })` interpolates; `t(storedSpanishText)` also matches templates.
 * A trailing ` [context]` disambiguates one Spanish word with two English meanings, e.g.
 * `t('Pendiente [importe]')` → "Pendiente" in Spanish, "Outstanding" in English.
 */
export function t(es: string, params?: Params): string {
  if (!es) return es;
  const text = (lang === 'en' ? toEnglish(es) : es).replace(CONTEXT, '');
  return params ? interpolate(text, params) : text;
}

/**
 * Marks a Spanish string as a translation key without translating it yet, for module-level
 * constants that are translated at render time with t(value). The coverage test checks that
 * every tKey('…') literal has an English entry.
 */
export function tKey<S extends string>(es: S): S {
  return es;
}

/** True when an English entry exists for the text (exact or via a template). Used by tests. */
export function hasEnglish(es: string): boolean {
  if (EN[es] !== undefined) return true;
  return toEnglish(es) !== es;
}

/** Test helper: switch language without touching storage or the document. */
export function setLangForTests(next: Lang) {
  lang = next;
}
