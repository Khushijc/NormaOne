/**
 * Coverage checks for the Spanish ⇄ English interface.
 * Run alone with: npx vitest run src/i18n
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EN, EN_PARTS } from './en';
import { hasEnglish, setLangForTests, t } from './index';
import { formatDuration } from '../domain/time';

const SRC = join(__dirname, '..');

function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'i18n' || name === 'seed') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

/** Literal keys passed to t('…') / t("…"). */
function literalKeys(code: string): string[] {
  const keys: string[] = [];
  const re = /\b(?:t|tKey)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")\s*[,)]/g;
  for (const m of code.matchAll(re)) keys.push(unescape(m[1] ?? m[2]));
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('i18n dictionary', () => {
  it('has an English entry for every literal t() key in the source', () => {
    const missing: string[] = [];
    for (const f of sourceFiles()) {
      for (const k of literalKeys(readFileSync(f, 'utf8'))) if (EN[k] === undefined) missing.push(`${relative(SRC, f)}: ${k}`);
    }
    expect(missing, `Missing English entries:\n${missing.join('\n')}`).toEqual([]);
  });

  it('never builds a t() key from a template literal (the key must be a fixed Spanish string)', () => {
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(/\b(?:t|tKey)\(\s*`[^`]*\$\{/g)) bad.push(`${relative(SRC, f)}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('keeps placeholders identical between Spanish keys and English values', () => {
    const bad = Object.entries(EN).filter(([es, en]) => placeholders(es) !== placeholders(en)).map(([es, en]) => `${es} → ${en}`);
    expect(bad).toEqual([]);
  });

  it('has no conflicting translations for the same key across dictionary parts', () => {
    const seen = new Map<string, { part: string; en: string }>();
    const conflicts: string[] = [];
    for (const [part, dict] of Object.entries(EN_PARTS)) {
      for (const [es, en] of Object.entries(dict)) {
        const prev = seen.get(es);
        if (prev && prev.en !== en) conflicts.push(`"${es}": ${prev.part}="${prev.en}" vs ${part}="${en}"`);
        else seen.set(es, { part, en });
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('leaves no untranslated literal text in JSX', () => {
    const TEXT_PROPS = 'title|placeholder|aria-label|label|hint|help|description|confirmLabel|cancelLabel|alt|subtitle|emptyText|caption';
    const attr = new RegExp(`\\s(?:${TEXT_PROPS})="([^"]*[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}[^"]*)"`, 'g');
    // Text between JSX tags that contains a word (ignores whitespace-only and {expressions}).
    const text = />\s*([^<>{}\n]*[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}[^<>{}\n]*?)\s*</g;
    const ALLOWED = new Set(['DatosPilot', 'CAE', 'EPI', 'PRL', 'CSV', 'JSON', 'PDF', 'NIF', 'ES', 'EN', 'BOE', 'INSST', 'AEPD', 'npm test']);
    const bad: string[] = [];
    for (const f of sourceFiles().filter((f) => f.endsWith('.tsx'))) {
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(attr)) if (!ALLOWED.has(m[1])) bad.push(`${relative(SRC, f)}: ${m[0].trim()}`);
      for (const m of code.matchAll(text)) {
        const s = m[1].trim();
        // Skip TypeScript generics / comparisons that the regex can mistake for JSX text.
        if (!s || ALLOWED.has(s) || /^[\w.]+(\[\])?(,\s*[\w.]+)*$/.test(s) && !/[ÁÉÍÓÚáéíóúñÑ]/.test(s) && !/\s/.test(s)) continue;
        if (/[=;&|]|=>|\)\s*$/.test(s)) continue;
        // `a.x < b.x` comparisons, ternary fragments and array literals between `>` and `<`.
        if (/^\(\w+\.\w+!?$/.test(s) || /^[:)\]]/.test(s)) continue;
        // Requirement identifiers (PRL-01, AC-PRL-03, REQ-005) are not translatable text.
        if (/^[A-Z]{2,5}(-[A-Z]{2,5})?-\d{2,3}$/.test(s)) continue;
        bad.push(`${relative(SRC, f)}: ${s}`);
      }
    }
    expect(bad, `Wrap these in t():\n${bad.join('\n')}`).toEqual([]);
  });
});

describe('i18n runtime', () => {
  beforeAll(() => setLangForTests('en'));
  afterAll(() => setLangForTests('es'));

  it('translates exact keys, interpolates and falls back to Spanish', () => {
    expect(t('Idioma de la interfaz')).toBe('Interface language');
    expect(t('Texto sin traducción de prueba')).toBe('Texto sin traducción de prueba');
    expect(t('Septiembre 2026')).toBe('September 2026');
    expect(hasEnglish('DatosPilot · Portal Pyme')).toBe(true);
  });

  it('resolves a context marker and keeps durations language-neutral', () => {
    expect(t('Pendiente')).toBe('Pending');
    expect(formatDuration(425)).toBe('7 h 05 min');
    setLangForTests('es');
    expect(t('Ausencia [contexto de prueba]')).toBe('Ausencia');
    setLangForTests('en');
  });
});
