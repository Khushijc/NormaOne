/**
 * Browser persistence for the DEMO ONLY.
 *
 * localStorage is not secure storage for real working-time or personal data: it is readable by
 * any script on the origin, unencrypted, per-device and limited to a few MB. The production
 * system stores records server-side with the four-year retention control (BRD TIM-07, SEC-03).
 */
import type { CollectionKey, Database } from '../domain/types';

export const SCHEMA_VERSION = 1;
export const KEYS = {
  db: 'jornadapulse.v1.db',
  session: 'jornadapulse.v1.session',
  ui: 'jornadapulse.v1.ui',
} as const;

export const COLLECTIONS: CollectionKey[] = [
  'companies',
  'departments',
  'worksites',
  'users',
  'memberships',
  'employees',
  'relationships',
  'agreements',
  'policies',
  'calendars',
  'protocols',
  'shifts',
  'events',
  'sessions',
  'failedAttempts',
  'corrections',
  'absenceTypes',
  'absences',
  'attachments',
  'anomalyReviews',
  'periods',
  'exports',
  'notifications',
  'retentionDecisions',
  'audit',
];

/** Reference data restored from the seed if it goes missing; user-generated collections never are. */
const REFERENCE: CollectionKey[] = ['companies', 'departments', 'worksites', 'users', 'memberships', 'agreements', 'policies', 'calendars', 'protocols', 'absenceTypes'];

/** In-memory fallback when localStorage is unavailable (private mode, blocked storage). */
const memory = new Map<string, string>();
let storageAvailable: boolean | null = null;

function hasStorage(): boolean {
  if (storageAvailable !== null) return storageAvailable;
  try {
    const k = '__jp_probe__';
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

/** Returns an error message if the write failed (e.g. quota exceeded); null on success. */
export function writeRaw(key: string, value: string): string | null {
  try {
    if (hasStorage()) window.localStorage.setItem(key, value);
    else memory.set(key, value);
    return null;
  } catch (e) {
    return e instanceof DOMException && e.name === 'QuotaExceededError'
      ? 'Se ha superado el espacio de almacenamiento local. Elimine adjuntos de demostración o restablezca los datos.'
      : 'No se pudo guardar en el almacenamiento local.';
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
  /** Spanish message key plus parameters; the UI translates it with t(text, params). */
  message: { text: string; params: Record<string, string> } | null;
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
    return { db, status: 'recovered', message: { text: 'Los datos locales no se podían leer. Se ha guardado una copia ({key}) y se han cargado datos de demostración.', params: { key } } };
  }

  const obj = parsed as Partial<Database>;
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    const key = backup();
    const db = seed();
    writeRaw(KEYS.db, JSON.stringify(db));
    return { db, status: 'recovered', message: { text: 'Los datos locales tienen otra versión de esquema. Se ha guardado una copia ({key}) y se han cargado datos de demostración.', params: { key } } };
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
    const fresh = seed();
    for (const c of missing) if (REFERENCE.includes(c)) (db as unknown as Record<string, unknown[]>)[c] = fresh[c] as unknown[];
    backup();
    writeRaw(KEYS.db, JSON.stringify(db));
    return { db, status: 'recovered', message: { text: 'Faltaban colecciones en los datos locales ({list}). Se han restaurado los datos de referencia; el resto se conserva.', params: { list: missing.join(', ') } } };
  }
  return { db, status: 'loaded', message: null };
}
