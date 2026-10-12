/**
 * Request context for application services — the client-side stand-in for what an
 * authenticated API request carries (user, active company, permissions).
 *
 * Every service call resolves the context and re-checks permissions and tenant ownership,
 * exactly as the backend will have to. The UI hiding a button is a convenience only.
 */
import { today } from '../domain/dates';
import { isMembershipActive, permissionsFor, PermissionError, type Permission } from '../domain/permissions';
import type { Company, Database, FinanceConfig, ID, Membership, ProviderConfig, User } from '../domain/types';
import { getDb, getSession, type Actor } from '../store/db';

export interface Ctx {
  db: Database;
  user: User;
  company: Company;
  membership: Membership | null;
  perms: Set<Permission>;
  today: string;
  actor: Actor;
  finance: FinanceConfig;
  provider: ProviderConfig | undefined;
}

export class NotFoundError extends Error {
  constructor(message = 'El registro no existe o no pertenece a la empresa activa.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export function getCtx(): Ctx {
  const db = getDb();
  const s = getSession();
  const user = db.users.find((u) => u.id === s.userId) ?? db.users[0];
  const company = db.companies.find((c) => c.id === s.companyId) ?? db.companies[0];
  const t = today();
  const membership = db.memberships.find((m) => m.userId === user.id && m.companyId === company.id && isMembershipActive(m, t)) ?? null;
  const perms = permissionsFor(membership, t);
  const finance = db.financeConfigs.find((f) => f.companyId === company.id)!;
  const provider = db.providerConfigs.find((p) => p.companyId === company.id);
  return {
    db,
    user,
    company,
    membership,
    perms,
    today: t,
    finance,
    provider,
    actor: { id: user.id, name: user.name, roles: membership?.roles ?? [], companyId: company.id },
  };
}

export function requirePerm(ctx: Ctx, ...anyOf: Permission[]) {
  if (!anyOf.some((p) => ctx.perms.has(p))) throw new PermissionError(anyOf.join(' | '));
}

/** Tenant isolation (SEC-01 / AC-PLT-01): a record from another company behaves as not found. */
export function ownRecord<T extends { companyId: ID }>(ctx: Ctx, row: T | undefined): T {
  if (!row || row.companyId !== ctx.company.id) throw new NotFoundError();
  return row;
}

/** Companies the user can deliberately switch to (BRD §05: explicit active-company selection). */
export function accessibleCompanies(db: Database, userId: ID): { company: Company; membership: Membership }[] {
  const t = today();
  return db.memberships
    .filter((m) => m.userId === userId && isMembershipActive(m, t))
    .map((m) => ({ company: db.companies.find((c) => c.id === m.companyId)!, membership: m }))
    .filter((x) => x.company);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Simulated network latency so the UI exercises loading states like a real API. */
export function latency(min = 120, max = 380): Promise<void> {
  if (import.meta.env?.MODE === 'test') return Promise.resolve();
  return sleep(min + Math.random() * (max - min));
}
