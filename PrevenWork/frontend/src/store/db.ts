/**
 * In-memory database with localStorage persistence and transactional safety.
 */
import { chainAuditEvent } from '../domain/audit';
import { newId } from '../domain/ids';
import { nowInstant } from '../domain/time';
import type { AppNotification, AuditEvent, CollectionKey, Database, ID, RoleId } from '../domain/types';
import { buildSeedDatabase } from '../data/seed';
import { KEYS, loadDatabase, readRaw, removeRaw, writeRaw, type LoadResult } from './storage';

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

export interface Session {
  userId: ID;
  companyId: ID;
}

export const DEFAULT_SESSION: Session = {
  userId: 'usr_marina',       // Marina Soler (Privacy Lead)
  companyId: 'cmp_levante',   // Levante Logística, S.L.
};

let db: Database;
let lastLoad: LoadResult;
let session: Session = DEFAULT_SESSION;
const listeners = new Set<() => void>();

export function initDatabase(): LoadResult {
  lastLoad = loadDatabase(() => buildSeedDatabase());
  db = lastLoad.db;
  initSession();
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

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((l) => l());
}

// ─────────────────────────────── Session ───────────────────────────────

export function initSession(): Session {
  const raw = readRaw(KEYS.session);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.userId === 'string' &&
        typeof parsed.companyId === 'string' &&
        db.users.some((u) => u.id === parsed.userId) &&
        db.companies.some((c) => c.id === parsed.companyId)
      ) {
        session = { userId: parsed.userId, companyId: parsed.companyId };
        return session;
      }
    } catch {
      // Fallback
    }
  }
  session = DEFAULT_SESSION;
  return session;
}

export function getSession(): Session {
  return session;
}

export function setSession(patch: Partial<Session>) {
  session = { ...session, ...patch };
  writeRaw(KEYS.session, JSON.stringify(session));
  db = { ...db }; // Trigger re-render
  emit();
}

// ─────────────────────────────── Transactions ───────────────────────────────

export type Row<K extends CollectionKey> = Database[K][number];

export interface AuditInputArgs {
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  summary: string;
  changes?: { field: string; before: string; after: string }[];
  restricted?: boolean;
}

export interface Tx {
  readonly db: Database;
  get<K extends CollectionKey>(key: K, id: ID): Row<K> | undefined;
  insert<K extends CollectionKey>(key: K, row: Row<K>): Row<K>;
  update<K extends CollectionKey>(key: K, id: ID, patch: Partial<Row<K>>): Row<K>;
  delete<K extends CollectionKey>(key: K, id: ID): void;
  audit(input: AuditInputArgs): AuditEvent;
  notify(input: Omit<AppNotification, 'id' | 'companyId' | 'createdAt' | 'readBy'>): void;
}

export function transact<T>(
  actorInfo: { userId: ID; name: string; role: RoleId },
  companyId: ID,
  fn: (tx: Tx) => T
): T {
  const current = getDb();
  // Deep clone collections
  const next: Database = {
    companies: [...current.companies],
    users: [...current.users],
    memberships: [...current.memberships],
    ropaActivities: [...current.ropaActivities],
    rightsRequests: [...current.rightsRequests],
    incidents: [...current.incidents],
    documents: [...current.documents],
    documentVersions: [...current.documentVersions],
    suppliers: [...current.suppliers],
    retentionPolicies: [...current.retentionPolicies],
    deletionReviews: [...current.deletionReviews],
    tasks: [...current.tasks],
    notifications: [...current.notifications],
    audit: [...current.audit],
  };

  const tx: Tx = {
    get db() {
      return next;
    },
    get(key, id) {
      return (next[key] as { id: ID }[]).find((r) => r.id === id) as Row<typeof key> | undefined;
    },
    insert(key, row) {
      (next[key] as unknown[]).push(row);
      return row;
    },
    update(key, id, patch) {
      const idx = (next[key] as { id: ID }[]).findIndex((r) => r.id === id);
      if (idx === -1) throw new Error(`Row ${id} not found in ${key}`);
      const updated = { ...next[key][idx], ...patch };
      (next[key] as unknown[])[idx] = updated;
      return updated as Row<typeof key>;
    },
    delete(key, id) {
      const filtered = (next[key] as { id: ID }[]).filter((r) => r.id !== id);
      (next as unknown as Record<string, unknown>)[key] = filtered;
    },
    audit(input) {
      const prev = next.audit[next.audit.length - 1] ?? null;
      const event = chainAuditEvent(prev, {
        id: newId('aud'),
        at: nowInstant(),
        actor: actorInfo,
        companyId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityLabel: input.entityLabel,
        summary: input.summary,
        changes: input.changes ?? [],
        restricted: input.restricted ?? false,
      });
      next.audit.push(event);
      return event;
    },
    notify(input) {
      if (!input.recipientUserIds.length) return;
      if (next.notifications.some((n) => n.companyId === companyId && n.dedupeKey === input.dedupeKey)) return;
      next.notifications.push({
        ...input,
        id: newId('ntf'),
        companyId,
        createdAt: nowInstant(),
        readBy: [],
      });
    },
  };

  const result = fn(tx);
  const error = writeRaw(KEYS.db, JSON.stringify(next));
  if (error) {
    throw new PersistenceError(error);
  }
  db = next;
  emit();
  return result;
}

export function patchUiOnly<K extends CollectionKey>(key: K, id: ID, patch: Partial<Row<K>>) {
  const current = getDb();
  const next: Database = { ...current };
  (next as unknown as Record<string, unknown>)[key] = (next[key] as unknown as { id: ID }[]).map((r) =>
    r.id === id ? { ...r, ...patch } : r
  );
  writeRaw(KEYS.db, JSON.stringify(next));
  db = next;
  emit();
}

export function resetDemoData(): void {
  removeRaw(KEYS.db);
  removeRaw(KEYS.session);
  initDatabase();
  session = DEFAULT_SESSION;
  emit();
}
