/**
 * Derived, read-only views over the database. Nothing here is persisted: collection
 * status, outstanding balances and ageing are always computed from payment events,
 * disputes and rectifications, so they can never drift from the underlying records.
 */
import { diffDays } from '../domain/dates';
import type { CollectionStatus, Database, Dispute, ID, ISODate, Invoice, PaymentEvent } from '../domain/types';

export function paymentsFor(db: Database, invoiceId: ID): PaymentEvent[] {
  return db.payments.filter((p) => p.invoiceId === invoiceId).sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
}

export function paidCents(db: Database, invoiceId: ID): number {
  return db.payments.filter((p) => p.invoiceId === invoiceId).reduce((s, p) => s + (p.kind === 'payment' ? p.amountCents : -p.amountCents), 0);
}

export function reversedPaymentIds(db: Database, invoiceId: ID): Set<ID> {
  return new Set(db.payments.filter((p) => p.invoiceId === invoiceId && p.kind === 'reversal' && p.reversesPaymentId).map((p) => p.reversesPaymentId!));
}

export function issuedRectifications(db: Database, original: Invoice): Invoice[] {
  return db.invoices.filter((i) => i.kind === 'rectifying' && i.rectification?.originalInvoiceId === original.id && (i.documentStatus === 'issued' || i.documentStatus === 'rectified'));
}

/**
 * Amount to collect for an invoice. Collections are tracked on the ORIGINAL invoice:
 * - rectification by differences adds its (usually negative) payable amount;
 * - rectification by substitution replaces the amount with the corrected invoice's payable.
 * A rectifying invoice itself has no separate collection.
 */
export function collectibleCents(db: Database, inv: Invoice): number {
  if (inv.kind === 'rectifying') return 0;
  let amount = inv.totals.payableCents;
  for (const r of issuedRectifications(db, inv).sort((a, b) => ((a.issuedAt ?? '') < (b.issuedAt ?? '') ? -1 : 1))) {
    if (r.rectification?.method === 'substitution') amount = r.totals.payableCents;
    else amount += r.totals.payableCents;
  }
  return amount;
}

export function outstandingCents(db: Database, inv: Invoice): number {
  return Math.max(0, collectibleCents(db, inv) - paidCents(db, inv.id));
}

export function openDispute(db: Database, invoiceId: ID): Dispute | undefined {
  return db.disputes.find((d) => d.invoiceId === invoiceId && d.status === 'open');
}

export function isCollectible(inv: Invoice): boolean {
  return inv.kind === 'ordinary' && (inv.documentStatus === 'issued' || inv.documentStatus === 'rectified');
}

/** Derived collection status; null when the invoice is not (yet) collectible. */
export function collectionStatus(db: Database, inv: Invoice): CollectionStatus | null {
  if (!isCollectible(inv)) return null;
  if (openDispute(db, inv.id)) return 'disputed';
  const paid = paidCents(db, inv.id);
  const due = collectibleCents(db, inv);
  if (due <= 0 || paid >= due) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

export function daysOverdue(db: Database, inv: Invoice, today: ISODate): number {
  if (!isCollectible(inv) || !inv.dueDate || outstandingCents(db, inv) === 0) return 0;
  return Math.max(0, diffDays(inv.dueDate, today));
}

export function isOverdue(db: Database, inv: Invoice, today: ISODate): boolean {
  return daysOverdue(db, inv, today) > 0;
}

export type AgeingBucket = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
export const AGEING_LABEL: Record<AgeingBucket, string> = {
  not_due: 'No vencido',
  d1_30: '1–30 días',
  d31_60: '31–60 días',
  d61_90: '61–90 días',
  d90_plus: 'Más de 90 días',
};

export function ageingBucket(db: Database, inv: Invoice, today: ISODate): AgeingBucket {
  const d = daysOverdue(db, inv, today);
  if (d <= 0) return 'not_due';
  if (d <= 30) return 'd1_30';
  if (d <= 60) return 'd31_60';
  if (d <= 90) return 'd61_90';
  return 'd90_plus';
}

export function invoiceLabel(inv: Invoice): string {
  return inv.number ?? (inv.kind === 'rectifying' ? 'Rectificativa (borrador)' : 'Borrador');
}

/** Date used for period filters: issue date when issued, otherwise creation date. */
export function invoicePeriodDate(inv: Invoice): ISODate {
  return inv.issueDate ?? inv.createdAt.slice(0, 10);
}

export function partyName(db: Database, customerId: ID): string {
  return db.customers.find((c) => c.id === customerId)?.legalName ?? '—';
}

export function userName(db: Database, userId: ID | null | undefined): string {
  if (!userId) return '—';
  if (userId === 'system') return 'Sistema';
  return db.users.find((u) => u.id === userId)?.name ?? '—';
}

/** Cumulative cash collected for an invoice (Ley 7/2012 aggregation). */
export function cashCollectedCents(db: Database, invoiceId: ID): number {
  return db.payments
    .filter((p) => p.invoiceId === invoiceId && p.method === 'cash')
    .reduce((s, p) => s + (p.kind === 'payment' ? p.amountCents : -p.amountCents), 0);
}

export function lastFiscalOperation(db: Database, invoiceId: ID) {
  return db.fiscalOperations.filter((o) => o.invoiceId === invoiceId).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))[0];
}
