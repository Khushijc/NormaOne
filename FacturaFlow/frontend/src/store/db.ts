/**
 * In-memory database with localStorage persistence and a minimal transaction API.
 *
 * `transact()` is the only way to change data. It mirrors what a future backend
 * endpoint does: load → validate → mutate → append audit event → commit atomically.
 * If the callback throws, nothing is committed.
 */
import { chainAuditEvent, type AuditInput } from '../domain/audit';
import { nowISO, setClock } from '../domain/dates';
import { newId } from '../domain/ids';
import type { AppNotification, AuditEvent, CollectionKey, Database, ID, ISODate } from '../domain/types';
import { buildSeedDatabase } from '../data/seed';
import { KEYS, loadDatabase, readJSON, removeRaw, writeRaw, type LoadResult } from './storage';

type Listener = () => void;
type Row<K extends CollectionKey> = Database[K][number];

let db: Database;
let lastLoad: LoadResult;
let lastSaveError: string | null = null;
const listeners = new Set<Listener>();

export function initDatabase(): LoadResult {
  lastLoad = loadDatabase(buildSeedDatabase);
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
export function getSaveError(): string | null {
  return lastSaveError;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((l) => l());
}

function persist(next: Database) {
  lastSaveError = writeRaw(KEYS.db, JSON.stringify(next));
}

// ─────────────────────────────── Session (UI identity; demo only) ───────────────────────────────

export interface Session {
  userId: ID;
  companyId: ID;
  /** Demo clock: lets testers simulate future dates (e.g. a B2B deadline). null = real date. */
  demoDate: ISODate | null;
}

const DEFAULT_SESSION: Session = { userId: 'usr_laura', companyId: 'cmp_levante', demoDate: null };
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
  session = valid ? { userId: stored.userId!, companyId: stored.companyId!, demoDate: typeof stored.demoDate === 'string' ? stored.demoDate : null } : DEFAULT_SESSION;
  applyClock();
  return session;
}

function applyClock() {
  if (session.demoDate) {
    // Keep the current time of day but move the calendar date (Europe/Madrid noon is safe).
    setClock(new Date(`${session.demoDate}T10:00:00.000Z`));
  } else setClock(null);
}

export function getSession(): Session {
  return session;
}

export function setSession(patch: Partial<Session>) {
  session = { ...session, ...patch };
  writeRaw(KEYS.session, JSON.stringify(session));
  applyClock();
  db = { ...db }; // new identity so derived views (dates) recompute
  emit();
}

// ─────────────────────────────── Transactions ───────────────────────────────

export interface Tx {
  readonly db: Database;
  get<K extends CollectionKey>(key: K, id: ID): Row<K> | undefined;
  insert<K extends CollectionKey>(key: K, row: Row<K>): Row<K>;
  update<K extends CollectionKey>(key: K, id: ID, patch: Partial<Row<K>> | ((row: Row<K>) => Partial<Row<K>>)): Row<K>;
  remove<K extends CollectionKey>(key: K, id: ID): void;
  /** Replace a singleton-per-company row (configs) matched by companyId. */
  updateWhere<K extends CollectionKey>(key: K, match: (row: Row<K>) => boolean, patch: Partial<Row<K>>): void;
  audit(input: Omit<AuditInput, 'id' | 'at' | 'actorId' | 'actorName' | 'actorRoles' | 'companyId'> & { companyId?: ID }): AuditEvent;
  notify(n: Omit<AppNotification, 'id' | 'createdAt' | 'readBy' | 'companyId'> & { companyId?: ID }): void;
}

export interface Actor {
  id: ID;
  name: string;
  roles: AuditEvent['actorRoles'];
  companyId: ID;
}

const NOT_DELETABLE: CollectionKey[] = ['audit', 'payments', 'fiscalOperations', 'deliveries', 'reminders', 'exports'];

export function transact<T>(actor: Actor, fn: (tx: Tx) => T): T {
  const next: Database = { ...getDb() };
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
      const arr = touch(key) as unknown as { id: ID }[];
      const idx = arr.findIndex((r) => r.id === id);
      if (idx < 0) throw new Error(`Registro no encontrado: ${String(key)}/${id}`);
      const current = arr[idx] as unknown as Row<typeof key>;
      const p = typeof patch === 'function' ? patch(current) : patch;
      const updated = { ...current, ...p } as Row<typeof key>;
      arr[idx] = updated as unknown as { id: ID };
      return updated;
    },
    remove(key, id) {
      if (NOT_DELETABLE.includes(key)) throw new Error(`La colección ${String(key)} es de solo inserción.`);
      const arr = touch(key) as unknown as { id: ID }[];
      const idx = arr.findIndex((r) => r.id === id);
      if (idx >= 0) arr.splice(idx, 1);
    },
    updateWhere(key, match, patch) {
      const arr = touch(key) as unknown as Row<typeof key>[];
      const idx = arr.findIndex((r) => match(r));
      if (idx < 0) throw new Error(`Registro no encontrado en ${String(key)}`);
      arr[idx] = { ...arr[idx], ...patch };
    },
    audit(input) {
      const companyId = input.companyId ?? actor.companyId;
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
        at: nowISO(),
        actorId: actor.id,
        actorName: actor.name,
        actorRoles: actor.roles,
        ...input,
        companyId,
        reason: input.reason ?? null,
        changes: input.changes ?? [],
      });
      audit.push(e);
      return e;
    },
    notify(n) {
      const companyId = n.companyId ?? actor.companyId;
      const list = touch('notifications');
      if (list.some((x) => x.companyId === companyId && x.dedupeKey === n.dedupeKey)) return;
      list.push({ ...n, companyId, id: newId('ntf'), createdAt: nowISO(), readBy: {} });
    },
  };

  const result = fn(tx);
  db = next;
  persist(next);
  emit();
  return result;
}

/** Writes that are not business events (e.g. marking a notification read). No audit. */
export function patchUiOnly<K extends CollectionKey>(key: K, id: ID, patch: Partial<Row<K>>) {
  const next: Database = { ...getDb() };
  (next as unknown as Record<string, unknown>)[key] = (next[key] as unknown as { id: ID }[]).map((r) => (r.id === id ? { ...r, ...patch } : r));
  db = next;
  persist(next);
  emit();
}

export function resetDemoData(): void {
  removeRaw(KEYS.db);
  removeRaw(KEYS.provider);
  removeRaw(KEYS.session);
  initDatabase();
  session = DEFAULT_SESSION;
  applyClock();
  emit();
}
