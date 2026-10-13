/**
 * LocalStorage adapter for PrevenWork.
 * Handles schema versioning, quota limits, and corrupted storage fallbacks.
 */
import type { Database } from '../domain/types';

export const SCHEMA_VERSION = 'prevenwork_v1';
export const KEYS = {
  db: 'super_one_prevenwork_db_v1',
  session: 'super_one_prevenwork_session_v1',
  theme: 'super_one_prevenwork_theme_v1',
  lang: 'super_one_prevenwork_lang_v1',
};

export const COLLECTIONS: (keyof Database)[] = [
  'companies',
  'users',
  'memberships',
  'ropaActivities',
  'rightsRequests',
  'incidents',
  'documents',
  'documentVersions',
  'suppliers',
  'retentionPolicies',
  'deletionReviews',
  'tasks',
  'notifications',
  'audit',
];

export interface LoadResult {
  db: Database;
  status: 'fresh' | 'loaded' | 'corrupt_repaired' | 'version_migrated';
  message?: string;
}

const memoryStorage = new Map<string, string>();

function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
    try {
      globalThis.localStorage.getItem('__test__');
      return globalThis.localStorage;
    } catch {
      // ignore
    }
  }
  return {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, val: string) => { memoryStorage.set(key, val); },
    removeItem: (key: string) => { memoryStorage.delete(key); },
    clear: () => { memoryStorage.clear(); },
  };
}

export function readRaw(key: string): string | null {
  try {
    return getStorage().getItem(key);
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string): string | null {
  try {
    getStorage().setItem(key, value);
    return null;
  } catch (e) {
    if (typeof DOMException !== 'undefined' && e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
      return 'Se ha superado el espacio de almacenamiento local. Elimine datos o restablezca la demo.';
    }
    return 'No se pudo guardar en el almacenamiento local.';
  }
}

export function removeRaw(key: string): void {
  try {
    getStorage().removeItem(key);
  } catch {
    // Ignore
  }
}

export function loadDatabase(seedBuilder: () => Database): LoadResult {
  const raw = readRaw(KEYS.db);
  if (!raw) {
    const seed = seedBuilder();
    writeRaw(KEYS.db, JSON.stringify(seed));
    return { db: seed, status: 'fresh' };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('Data is not an object');

    // Check collections presence
    const missing = COLLECTIONS.filter((c) => !Array.isArray(parsed[c]));
    if (missing.length > 0) {
      const seed = seedBuilder();
      missing.forEach((c) => {
        parsed[c] = seed[c];
      });
      writeRaw(KEYS.db, JSON.stringify(parsed));
      return {
        db: parsed as Database,
        status: 'corrupt_repaired',
        message: `Faltaban colecciones (${missing.join(', ')}). Restauradas con datos de muestra.`,
      };
    }

    return { db: parsed as Database, status: 'loaded' };
  } catch {
    const seed = seedBuilder();
    writeRaw(KEYS.db, JSON.stringify(seed));
    return {
      db: seed,
      status: 'corrupt_repaired',
      message: 'Los datos locales no se podían leer. Se han restablecido los datos de demostración.',
    };
  }
}
