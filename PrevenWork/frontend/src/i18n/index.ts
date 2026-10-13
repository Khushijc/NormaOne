/**
 * Internationalization (ES ⇄ EN) for PrevenWork.
 *
 * Spanish is the source language: every UI string is written in Spanish in the code and
 * wrapped in `t()`, and the Spanish text itself is the dictionary key. English comes from
 * `./en/*.ts`. A missing entry falls back to the Spanish text, so nothing ever renders blank.
 *
 * Audit summaries, notifications and service messages are translated with exact matching
 * or dynamic template interpolation.
 */
import { useEffect, useState } from 'react';
import { KEYS, readRaw, writeRaw } from '../store/storage';
import { EN, enDictionary } from './en';

export type Lang = 'es' | 'en';
export type Params = Record<string, string | number>;

export const LANG_LABEL: Record<Lang, string> = {
  es: 'Español',
  en: 'English',
};

function readStoredLang(): Lang {
  try {
    const stored = readRaw(KEYS.lang);
    return stored === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

let currentLang: Lang = readStoredLang();
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang {
  return currentLang;
}

export function locale(): string {
  return currentLang === 'en' ? 'en-GB' : 'es-ES';
}

export function initLang(): Lang {
  currentLang = readStoredLang();
  applyDocumentLang();
  return currentLang;
}

export function setLang(l: Lang) {
  if (l === currentLang) return;
  currentLang = l;
  writeRaw(KEYS.lang, l);
  applyDocumentLang();
  listeners.forEach((fn) => fn(l));
}

export function applyDocumentLang() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = currentLang;
  document.title = currentLang === 'en' ? 'PrevenWork · SME Compliance Portal' : 'PrevenWork · Portal de Cumplimiento Pyme';
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    if (weight < 3) continue;
    list.push({ re: new RegExp(`^${pattern}$`), names, en, weight });
  }
  return list.sort((a, b) => b.weight - a.weight);
}

const cache = new Map<string, string>();
const CONTEXT = / \[[^\]]+\]$/;

function toEnglish(es: string, depth = 0): string {
  const exact = EN[es];
  if (exact !== undefined) return exact;
  if (depth > 1 || es.length < 3) return es;
  const hit = cache.get(es);
  if (hit !== undefined) return hit;

  let out = es;
  templates ??= compileTemplates();
  for (const tpl of templates) {
    const m = tpl.re.exec(es);
    if (!m) continue;
    const values: Params = {};
    tpl.names.forEach((n, i) => (values[n] = toEnglish(m[i + 1], depth + 1)));
    out = interpolate(tpl.en, values);
    break;
  }
  cache.set(es, out);
  return out;
}

/**
 * Translates Spanish source text into the current interface language.
 * Supports exact keys, placeholder parameters, and dynamic templates.
 */
export function t(es: string, params?: Params): string {
  if (!es) return es;
  const text = (currentLang === 'en' ? toEnglish(es) : es).replace(CONTEXT, '');
  return params ? interpolate(text, params) : text;
}

export function tKey<S extends string>(es: S): S {
  return es;
}

export function hasEnglish(es: string): boolean {
  if (EN[es] !== undefined) return true;
  return toEnglish(es) !== es;
}

export function setLangForTests(next: Lang) {
  currentLang = next;
}

export function useLang(): Lang {
  const [lang, setLocalLang] = useState<Lang>(() => currentLang);
  useEffect(() => {
    const fn = (l: Lang) => setLocalLang(l);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return lang;
}

if (typeof window !== 'undefined') {
  initLang();
}
