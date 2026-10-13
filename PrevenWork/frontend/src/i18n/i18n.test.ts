/**
 * Internationalization coverage and runtime tests for PrevenWork.
 * Run alone with: npm test
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EN, EN_PARTS } from './en';
import { hasEnglish, setLangForTests, t } from './index';

const SRC = join(__dirname, '..');

function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'i18n' || name === 'data' || name === 'dist' || name === 'node_modules') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

/** Literal keys passed to t('…') / t("…"). */
function literalKeys(code: string): string[] {
  const keys: string[] = [];
  const re = /\b(?:t|tKey)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")\s*[,)]/g;
  for (const m of code.matchAll(re)) {
    keys.push(unescape(m[1] ?? m[2]));
  }
  return keys;
}

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('PrevenWork i18n dictionary coverage', () => {
  it('has an English entry for every literal t() key in the source', () => {
    const missing: string[] = [];
    for (const f of sourceFiles()) {
      for (const k of literalKeys(readFileSync(f, 'utf8'))) {
        if (!hasEnglish(k)) {
          missing.push(`${relative(SRC, f)}: ${k}`);
        }
      }
    }
    if (missing.length > 0) {
      writeFileSync(join(SRC, 'i18n', 'missing.json'), JSON.stringify(missing, null, 2), 'utf8');
    }
    expect(missing, `Missing English entries:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps placeholders identical between Spanish keys and English values', () => {
    const bad = Object.entries(EN)
      .filter(([es, en]) => placeholders(es) !== placeholders(en))
      .map(([es, en]) => `${es} → ${en}`);
    expect(bad).toEqual([]);
  });

  it('has no conflicting translations for the same key across dictionary parts', () => {
    const seen = new Map<string, { part: string; en: string }>();
    const conflicts: string[] = [];
    for (const [part, dict] of Object.entries(EN_PARTS)) {
      for (const [es, en] of Object.entries(dict)) {
        const prev = seen.get(es);
        if (prev && prev.en !== en) {
          conflicts.push(`"${es}": ${prev.part}="${prev.en}" vs ${part}="${en}"`);
        } else {
          seen.set(es, { part, en });
        }
      }
    }
    expect(conflicts).toEqual([]);
  });
});

describe('PrevenWork i18n runtime behavior', () => {
  beforeAll(() => setLangForTests('en'));
  afterAll(() => setLangForTests('es'));

  it('translates exact keys, interpolates and falls back to Spanish', () => {
    expect(t('Operaciones de Privacidad · {name}', { name: 'Acme' })).toBe('Privacy Operations · Acme');
    expect(t('Texto sin traducción de prueba')).toBe('Texto sin traducción de prueba');
    expect(hasEnglish('Portal de Cumplimiento Pyme')).toBe(true);
  });

  it('translates status badges and categories', () => {
    expect(t('Borrador')).toBe('Draft');
    expect(t('En revisión')).toBe('In review');
    expect(t('Aprobado')).toBe('Approved');
    expect(t('Riesgo improbable')).toBe('Unlikely risk');
  });

  it('matches dynamic template strings', () => {
    expect(t('4 tratamientos registrados')).toBe('4 registered activities');
    expect(t('2 casos en tramitación')).toBe('2 cases in progress');
  });
});
