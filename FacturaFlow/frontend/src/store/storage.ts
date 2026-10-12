/**
 * Browser persistence for the DEMO ONLY.
 *
 * localStorage is not secure storage for real financial or personal data: it is readable
 * by any script on the origin, unencrypted, per-device and limited to a few MB. The
 * production system stores records server-side (BRD §19, SEC-03).
 */
import type { CollectionKey, Database } from '../domain/types';

export const SCHEMA_VERSION = 1;
export const KEYS = {
  db: 'facturaflow.v1.db',
  session: 'facturaflow.v1.session',
  provider: 'facturaflow.v1.mockProvider',
  ui: 'facturaflow.v1.ui',
} as const;

export const COLLECTIONS: CollectionKey[] = [
  'companies',
  'financeConfigs',
  'providerConfigs',
  'series',
  'taxCodes',
  'rules',
  'collectionPolicies',
  'users',
  'memberships',
  'customers',
  'suppliers',
  'invoices',
  'payments',
  'disputes',
  'fiscalOperations',
  'deliveries',
  'reminders',
  'expenses',
  'attachments',
  'handovers',
  'exports',
  'notifications',
  'audit',
];

/** In-memory fallback when localStorage is unavailable (private mode, blocked storage). */
const memory = new Map<string, string>();
let storageAvailable: boolean | null = null;

function hasStorage(): boolean {
  if (storageAvailable !== null) return storageAvailable;
  try {
    const k = '__ff_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
}

export function isPersistent(): boolean {
  return hasStorage();
}

export function readRaw(key: string): string | null {
  try {
    return hasStorage() ? window.localStorage.getItem(key) : memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

/** Returns an error message if the write failed (e.g. quota exceeded). */
export function writeRaw(key: string, value: string): string | null {
  try {
    if (hasStorage()) window.localStorage.setItem(key, value);
    else memory.set(key, value);
    return null;
  } catch (e) {
    memory.set(key, value);
    return e instanceof DOMException && e.name === 'QuotaExceededError'
      ? 'Se ha superado el espacio de almacenamiento local. Elimine adjuntos de demostración o restablezca los datos.'
      : 'No se pudo guardar en el almacenamiento local; los cambios solo se mantendrán en esta pestaña.';
  }
}

export function removeRaw(key: string) {
  try {
    if (hasStorage()) window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  memory.delete(key);
}

export function readJSON<T>(key: string): T | null {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type LoadStatus = 'loaded' | 'seeded' | 'recovered';

export interface LoadResult {
  db: Database;
  status: LoadStatus;
  message: string | null;
}

/**
 * Loads the stored database. Seeds on first visit only. Never silently discards user data:
 * unreadable data is copied to a backup key before demo data is loaded in its place.
 */
export function loadDatabase(seed: () => Database): LoadResult {
  const raw = readRaw(KEYS.db);
  if (raw === null) {
    const db = seed();
    writeRaw(KEYS.db, JSON.stringify(db));
    return { db, status: 'seeded', message: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const backup = () => {
    const key = `${KEYS.db}.backup.${Date.now()}`;
    writeRaw(key, raw);
    return key;
  };

  if (!parsed || typeof parsed !== 'object') {
    const key = backup();
    const db = seed();
    writeRaw(KEYS.db, JSON.stringify(db));
    return { db, status: 'recovered', message: `Los datos locales no se podían leer. Se ha guardado una copia (${key}) y se han cargado datos de demostración.` };
  }

  const obj = parsed as Partial<Database>;
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    const key = backup();
    const db = seed();
    writeRaw(KEYS.db, JSON.stringify(db));
    return {
      db,
      status: 'recovered',
      message: `Los datos locales tienen una versión de esquema distinta (${String(obj.schemaVersion)}). Copia guardada en ${key}; se han cargado datos de demostración.`,
    };
  }

  const missing: CollectionKey[] = [];
  const db = { ...obj } as Database;
  for (const c of COLLECTIONS) {
    if (!Array.isArray(db[c])) {
      missing.push(c);
      (db as unknown as Record<string, unknown[]>)[c] = [];
    }
  }
  if (missing.length) {
    // Reference data that the app cannot work without is restored from the seed.
    const fresh = seed();
    for (const c of missing as CollectionKey[]) {
      if (['taxCodes', 'rules', 'users', 'companies', 'financeConfigs', 'providerConfigs', 'series', 'collectionPolicies', 'memberships'].includes(c)) {
        (db as unknown as Record<string, unknown[]>)[c] = fresh[c] as unknown[];
      }
    }
    backup();
    writeRaw(KEYS.db, JSON.stringify(db));
    return { db, status: 'recovered', message: `Faltaban colecciones en los datos locales (${missing.join(', ')}). Se han restaurado los datos de referencia; el resto se conserva.` };
  }
  return { db, status: 'loaded', message: null };
}
