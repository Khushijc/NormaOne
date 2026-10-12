/**
 * In-memory database with localStorage persistence and a minimal transaction API.
 *
 * `transact()` is the only way to change business data. It mirrors what a future backend endpoint
 * does: load → check → mutate → append audit event → commit. If the callback throws, or if the
 * browser cannot persist the result, NOTHING is committed and the error propagates, so the UI can
 * never show a success message for an operation that was not stored.
 */
import { chainAuditEvent, type AuditInput } from '../domain/audit';
import { newId } from '../domain/ids';
import { nowInstant } from '../domain/time';
import type { Actor, AppNotification, AuditEvent, CollectionKey, Database, ID } from '../domain/types';
import { buildSeedDatabase } from '../data/seed';
import { KEYS, loadDatabase, readJSON, removeRaw, writeRaw, type LoadResult } from './storage';

type Listener = () => void;
export type Row<K extends CollectionKey> = Database[K][number];

let db: Database;
let lastLoad: LoadResult;
const listeners = new Set<Listener>();

export function initDatabase(): LoadResult {
  lastLoad = loadDatabase(() => buildSeedDatabase());
  db = lastLoad.db;
  return lastLoad;
}

export function getDb(): Database {
  if (!db) initDatabase();
  return db;
}
export function getLoadResult(): LoadResult {
  if (!lastLoad) initDatabase();
  return lastLoad;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((l) => l());
}

/** Raised when the browser refused to store the change; the change is rolled back. */
export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

// ─────────────────────────────── Session (UI identity; demo only) ───────────────────────────────

export interface Session {
  userId: ID;
  companyId: ID;
}

export const DEFAULT_SESSION: Session = { userId: 'usr_marina', companyId: 'cmp_levante' };
let session: Session = DEFAULT_SESSION;

export function initSession(): Session {
  const stored = readJSON<Partial<Session>>(KEYS.session);
  const d = getDb();
  const valid =
    stored &&
    typeof stored.userId === 'string' &&
    typeof stored.companyId === 'string' &&
    d.users.some((u) => u.id === stored.userId) &&
    d.companies.some((c) => c.id === stored.companyId);
  session = valid ? { userId: stored.userId!, companyId: stored.companyId! } : DEFAULT_SESSION;
  return session;
}

export function getSession(): Session {
  return session;
}

export function setSession(patch: Partial<Session>) {
  session = { ...session, ...patch };
  writeRaw(KEYS.session, JSON.stringify(session));
  db = { ...db }; // new identity so every derived view recomputes for the new identity
  emit();
}

// ─────────────────────────────── Transactions ───────────────────────────────

export type AuditArgs = Omit<AuditInput, 'id' | 'at' | 'actor' | 'companyId' | 'reason' | 'changes' | 'employeeId' | 'version' | 'recipient' | 'restricted'> &
  Partial<Pick<AuditInput, 'reason' | 'changes' | 'employeeId' | 'version' | 'recipient' | 'restricted'>>;

export interface Tx {
  readonly db: Database;
  get<K extends CollectionKey>(key: K, id: ID): Row<K> | undefined;
  insert<K extends CollectionKey>(key: K, row: Row<K>): Row<K>;
  update<K extends CollectionKey>(key: K, id: ID, patch: (row: Row<K>) => Partial<Row<K>>): Row<K>;
  update<K extends CollectionKey>(key: K, id: ID, patch: Partial<Row<K>>): Row<K>;
  audit(input: AuditArgs): AuditEvent;
  notify(n: Omit<AppNotification, 'id' | 'createdAt' | 'readBy' | 'companyId'>): void;
}

/** Collections whose rows are never modified once written. */
const IMMUTABLE: CollectionKey[] = ['audit', 'acknowledgements', 'exports'];

export function transact<T>(actor: Actor, companyId: ID, fn: (tx: Tx) => T): T {
  const base = getDb();
  const next: Database = { ...base };
  const touched = new Set<CollectionKey>();
  const touch = <K extends CollectionKey>(key: K): Database[K] => {
    if (!touched.has(key)) {
      (next as unknown as Record<string, unknown>)[key] = [...(next[key] as unknown[])];
      touched.add(key);
    }
    return next[key];
  };

  const tx: Tx = {
    get db() {
      return next;
    },
    get(key, id) {
      return (next[key] as { id?: ID }[]).find((r) => r.id === id) as never;
    },
    insert(key, row) {
      (touch(key) as unknown[]).push(row);
      return row;
    },
    update(key, id, patch) {
      if (IMMUTABLE.includes(key)) throw new Error(`La colección ${String(key)} es inmutable: los registros originales no se modifican.`);
      const arr = touch(key) as unknown as { id: ID }[];
      const idx = arr.findIndex((r) => r.id === id);
      if (idx < 0) throw new Error(`Registro no encontrado: ${String(key)}/${id}`);
      const current = arr[idx] as unknown as Row<typeof key>;
      const p = typeof patch === 'function' ? patch(current) : patch;
      const updated = { ...current, ...p } as Row<typeof key>;
      arr[idx] = updated as unknown as { id: ID };
      return updated;
    },
    audit(input) {
      const audit = touch('audit');
      let prev: AuditEvent | undefined;
      for (let i = audit.length - 1; i >= 0; i--) {
        if (audit[i].companyId === companyId) {
          prev = audit[i];
          break;
        }
      }
      const e = chainAuditEvent(prev, {
        id: newId('aud'),
        at: nowInstant(),
        actor,
        companyId,
        employeeId: input.employeeId ?? null,
        reason: input.reason ?? null,
        changes: input.changes ?? [],
        version: input.version ?? null,
        recipient: input.recipient ?? null,
        restricted: input.restricted ?? false,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityLabel: input.entityLabel,
        summary: input.summary,
      });
      audit.push(e);
      return e;
    },
    notify(n) {
      const list = touch('notifications');
      if (!n.recipientUserIds.length) return;
      if (list.some((x) => x.companyId === companyId && x.dedupeKey === n.dedupeKey)) return;
      list.push({ ...n, companyId, id: newId('ntf'), createdAt: nowInstant(), readBy: [] });
    },
  };

  const result = fn(tx);
  const error = writeRaw(KEYS.db, JSON.stringify(next));
  if (error) {
    // Roll back: the in-memory state stays as it was before the transaction.
    throw new PersistenceError(error);
  }
  db = next;
  emit();
  return result;
}

/** Writes that are not business events (marking a notification read). No audit. */
export function patchUiOnly<K extends CollectionKey>(key: K, id: ID, patch: Partial<Row<K>>) {
  const next: Database = { ...getDb() };
  (next as unknown as Record<string, unknown>)[key] = (next[key] as unknown as { id: ID }[]).map((r) => (r.id === id ? { ...r, ...patch } : r));
  if (writeRaw(KEYS.db, JSON.stringify(next))) return;
  db = next;
  emit();
}

/** Explicit demo reset: clears this browser's DatosPilot data and reloads the seed. */
export function resetDemoData(): void {
  removeRaw(KEYS.db);
  removeRaw(KEYS.session);
  initDatabase();
  session = DEFAULT_SESSION;
  emit();
}
