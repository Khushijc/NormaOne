/**
 * Theme management (dark / light / system preference).
 */
import { useEffect, useState } from 'react';
import { KEYS, readRaw, writeRaw } from './storage';

export type Theme = 'light' | 'dark' | 'system';

let currentTheme: Theme = 'system';
const listeners = new Set<(t: Theme) => void>();

function getEffectiveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemeToDom(theme: Theme) {
  const effective = getEffectiveTheme(theme);
  document.documentElement.setAttribute('data-theme', effective);
  document.documentElement.style.colorScheme = effective;
}

export function initTheme(): Theme {
  const stored = readRaw(KEYS.theme) as Theme | null;
  currentTheme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  applyThemeToDom(currentTheme);
  return currentTheme;
}

export function setTheme(next: Theme) {
  currentTheme = next;
  writeRaw(KEYS.theme, next);
  applyThemeToDom(next);
  listeners.forEach((l) => l(next));
}

export function useTheme() {
  const [theme, setLocalTheme] = useState<Theme>(() => currentTheme);

  useEffect(() => {
    const fn = (t: Theme) => setLocalTheme(t);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const toggleTheme = () => {
    const next = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  return {
    theme,
    isDark: getEffectiveTheme(theme) === 'dark',
    setTheme,
    toggleTheme,
  };
}

// Initial application
if (typeof window !== 'undefined') {
  initTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme === 'system') applyThemeToDom('system');
  });
}
