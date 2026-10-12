export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'compliance_portal_theme';

function getSystemTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function readStoredTheme(): Theme {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore storage access errors
  }
  return getSystemTheme();
}

let currentTheme: Theme = readStoredTheme();
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return currentTheme;
}

export function applyThemeToDom(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function setTheme(next: Theme) {
  if (next === currentTheme) return;
  currentTheme = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore storage quota/permission errors
  }
  applyThemeToDom(next);
  listeners.forEach((cb) => cb());
}

export function toggleTheme() {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Apply theme immediately upon script evaluation to prevent flashes
applyThemeToDom(currentTheme);

// Listen for system changes if the user hasn't explicitly set a preference
if (typeof window !== 'undefined' && window.matchMedia) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => {
    try {
      const explicit = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!explicit) {
        currentTheme = e.matches ? 'dark' : 'light';
        applyThemeToDom(currentTheme);
        listeners.forEach((cb) => cb());
      }
    } catch {
      currentTheme = e.matches ? 'dark' : 'light';
      applyThemeToDom(currentTheme);
      listeners.forEach((cb) => cb());
    }
  };
  mql.addEventListener?.('change', handler);
}
