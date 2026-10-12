/** Payments, disputes and reminders (future API: /invoices/:id/payments ...). FIN-07. */
import { addDays, isValidISODate, nowISO } from '../domain/dates';
import { newId } from '../domain/ids';
import { formatEURRecord } from '../domain/money';
import { BusinessRuleError } from '../domain/permissions';
import type { ID, ISODate, PaymentEvent } from '../domain/types';
import { transact } from '../store/db';
import { cashCollectedCents, collectionStatus, isCollectible, openDispute, outstandingCents, paidCents, reversedPaymentIds } from '../store/selectors';
import { getCtx, latency, ownRecord, requirePerm } from './context';
import { sendEmail } from './mock/channels';

export const PAYMENT_METHOD_LABEL: Record<PaymentEvent['method'], string> = {
  transfer: 'Transferencia',
  direct_debit: 'Domiciliación',
  card: 'Tarjeta',
  cash: 'Efectivo',
  bizum: 'Bizum',
  other: 'Otro',
};

/** Ley 7/2012 art. 7: cash payments of €1,000 or more are prohibited when a party acts as a business. */
export const CASH_LIMIT_CENTS = 100_000;

export interface PaymentInput {
  date: ISODate;
  amountCents: number;
  method: PaymentEvent['method'];
  reference: string;
  note: string;
}

export function checkPayment(invoiceId: ID, input: PaymentInput): string[] {
  const ctx = getCtx();
  const inv = ctx.db.invoices.find((i) => i.id === invoiceId);
  const errors: string[] = [];
  if (!inv) return ['Factura no encontrada.'];
  if (!isCollectible(inv)) errors.push('Solo se registran cobros sobre facturas ordinarias emitidas (las rectificativas se compensan en la original).');
  if (!isValidISODate(input.date)) errors.push('Fecha de cobro no válida.');
  else if (input.date > ctx.today) errors.push('La fecha de cobro no puede ser futura.');
  else if (inv.issueDate && input.date < inv.issueDate) errors.push('La fecha de cobro es anterior a la emisión (registre los anticipos como tales con su factura).');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) errors.push('El importe debe ser mayor que cero.');
  const outstanding = outstandingCents(ctx.db, inv);
  if (input.amountCents > outstanding) errors.push(`El importe supera el pendiente de cobro (${formatEURRecord(outstanding)}).`);
  if (input.method === 'cash' && cashCollectedCents(ctx.db, invoiceId) + input.amountCents >= CASH_LIMIT_CENTS) {
    errors.push('Límite de pagos en efectivo: no se admiten pagos en efectivo de 1.000 € o más en operaciones con empresarios o profesionales, sumando los pagos fraccionados (Ley 7/2012, art. 7).');
  }
  if (input.method !== 'cash' && !input.reference.trim()) errors.push('Indique la referencia del movimiento (justificante del pago no en efectivo).');
  return errors;
}

export async function recordPayment(invoiceId: ID, input: PaymentInput) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'payments.record');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === invoiceId));
  const errors = checkPayment(invoiceId, input);
  if (errors.length) throw new BusinessRuleError('No se puede registrar el cobro.', errors);
  const before = collectionStatus(ctx.db, inv);
  transact(ctx.actor, (tx) => {
    tx.insert('payments', { id: newId('pay'), companyId: ctx.company.id, invoiceId, kind: 'payment', ...input, reversesPaymentId: null, recordedBy: ctx.user.id, recordedAt: nowISO() });
    const after = collectionStatus(tx.db, inv);
    tx.audit({
      action: 'payment.record',
      entityType: 'invoice',
      entityId: invoiceId,
      entityLabel: inv.number ?? invoiceId,
      summary: `Cobro de ${formatEURRecord(input.amountCents)} (${PAYMENT_METHOD_LABEL[input.method]}) con fecha ${input.date}. Pendiente: ${formatEURRecord(outstandingCents(tx.db, inv))}.`,
      reason: input.note || null,
      changes: [{ field: 'Estado de cobro', before: before ?? '—', after: after ?? '—' }],
    });
  });
}

/** Payments are never deleted: a reversal is a new, linked event. */
export async function reversePayment(paymentId: ID, reason: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'payments.reverse');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo de la anulación del cobro.');
  const p = ownRecord(ctx, ctx.db.payments.find((x) => x.id === paymentId));
  if (p.kind !== 'payment') throw new BusinessRuleError('Solo se pueden anular cobros.');
  if (reversedPaymentIds(ctx.db, p.invoiceId).has(paymentId)) throw new BusinessRuleError('Este cobro ya fue anulado.');
  const inv = ctx.db.invoices.find((i) => i.id === p.invoiceId)!;
  transact(ctx.actor, (tx) => {
    tx.insert('payments', { id: newId('pay'), companyId: ctx.company.id, invoiceId: p.invoiceId, kind: 'reversal', date: ctx.today, amountCents: p.amountCents, method: p.method, reference: `ANUL ${p.reference}`, note: reason, reversesPaymentId: p.id, recordedBy: ctx.user.id, recordedAt: nowISO() });
    tx.audit({ action: 'payment.reverse', entityType: 'invoice', entityId: p.invoiceId, entityLabel: inv.number ?? p.invoiceId, summary: `Anulado cobro de ${formatEURRecord(p.amountCents)} del ${p.date} (evento de reversión; el original se conserva).`, reason, changes: [] });
  });
}

export async function openDisputeOn(invoiceId: ID, reason: string, holdReminders: boolean) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'disputes.manage');
  if (!reason.trim()) throw new BusinessRuleError('Describa el motivo de la disputa.');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === invoiceId));
  if (!isCollectible(inv)) throw new BusinessRuleError('Solo sobre facturas emitidas.');
  if (openDispute(ctx.db, invoiceId)) throw new BusinessRuleError('Ya hay una disputa abierta.');
  transact(ctx.actor, (tx) => {
    tx.insert('disputes', { id: newId('dsp'), companyId: ctx.company.id, invoiceId, status: 'open', reason, holdReminders, openedBy: ctx.user.id, openedAt: nowISO(), resolvedBy: null, resolvedAt: null, resolution: null });
    tx.audit({ action: 'dispute.open', entityType: 'invoice', entityId: invoiceId, entityLabel: inv.number ?? invoiceId, summary: `Disputa abierta${holdReminders ? ' con retención de recordatorios' : ''}.`, reason, changes: [] });
  });
}

export async function resolveDispute(disputeId: ID, resolution: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'disputes.manage');
  if (!resolution.trim()) throw new BusinessRuleError('Indique cómo se ha resuelto (p. ej. rectificativa emitida, cliente acepta, abono parcial).');
  const d = ownRecord(ctx, ctx.db.disputes.find((x) => x.id === disputeId));
  const inv = ctx.db.invoices.find((i) => i.id === d.invoiceId)!;
  transact(ctx.actor, (tx) => {
    tx.update('disputes', disputeId, { status: 'resolved', resolvedBy: ctx.user.id, resolvedAt: nowISO(), resolution });
    tx.audit({ action: 'dispute.resolve', entityType: 'invoice', entityId: d.invoiceId, entityLabel: inv.number ?? d.invoiceId, summary: 'Disputa resuelta. Los recordatorios se reanudan si queda importe pendiente.', reason: resolution, changes: [] });
  });
}

export interface ReminderPlanItem {
  invoiceId: ID;
  offsetDays: number;
  action: 'send' | 'suppress';
  reason: string;
}

/** Computes reminders that are due under the company policy (dry run). */
export function planReminders(): ReminderPlanItem[] {
  const ctx = getCtx();
  const policy = ctx.db.collectionPolicies.find((p) => p.companyId === ctx.company.id);
  if (!policy) return [];
  const plan: ReminderPlanItem[] = [];
  for (const inv of ctx.db.invoices.filter((i) => i.companyId === ctx.company.id && isCollectible(i) && i.dueDate)) {
    const status = collectionStatus(ctx.db, inv);
    for (const off of policy.reminderOffsetsDays) {
      if (addDays(inv.dueDate!, off) > ctx.today) continue;
      const already = ctx.db.reminders.some((r) => r.invoiceId === inv.id && r.offsetDays === off);
      if (already) continue;
      if (status === 'paid') continue; // nothing to remind; no record needed
      const dispute = openDispute(ctx.db, inv.id);
      if (dispute && dispute.holdReminders && policy.suppressWhenDisputed) plan.push({ invoiceId: inv.id, offsetDays: off, action: 'suppress', reason: 'Suprimido: disputa abierta con retención de recordatorios.' });
      else plan.push({ invoiceId: inv.id, offsetDays: off, action: 'send', reason: `Recordatorio +${off} días tras vencimiento.` });
    }
  }
  return plan;
}

export async function runReminders(): Promise<{ sent: number; suppressed: number; failed: number }> {
  const ctx = getCtx();
  requirePerm(ctx, 'reminders.send');
  const plan = planReminders();
  let sent = 0, suppressed = 0, failed = 0;
  for (const item of plan) {
    const inv = ctx.db.invoices.find((i) => i.id === item.invoiceId)!;
    const customer = ctx.db.customers.find((c) => c.id === inv.customerId)!;
    if (item.action === 'suppress') {
      suppressed++;
      transact(ctx.actor, (tx) => {
        tx.insert('reminders', { id: newId('rem'), companyId: ctx.company.id, invoiceId: inv.id, offsetDays: item.offsetDays, status: 'suppressed', reason: item.reason, channel: 'email', at: nowISO(), by: ctx.user.id, simulated: true });
        tx.audit({ action: 'reminder.suppress', entityType: 'invoice', entityId: inv.id, entityLabel: inv.number ?? inv.id, summary: item.reason, reason: null, changes: [] });
      });
      continue;
    }
    const r = await sendEmail(customer.email, `Recordatorio factura ${inv.number}`);
    if (r.status === 'failed') failed++;
    else sent++;
    transact(ctx.actor, (tx) => {
      tx.insert('reminders', { id: newId('rem'), companyId: ctx.company.id, invoiceId: inv.id, offsetDays: item.offsetDays, status: r.status === 'delivered' ? 'delivered' : 'failed', reason: `${item.reason} ${r.detail}`, channel: 'email', at: nowISO(), by: ctx.user.id, simulated: true });
      tx.audit({ action: 'reminder.send', entityType: 'invoice', entityId: inv.id, entityLabel: inv.number ?? inv.id, summary: `${item.reason} → ${r.status === 'delivered' ? 'entregado' : 'fallido'} (simulado).`, reason: null, changes: [] });
    });
  }
  return { sent, suppressed, failed };
}

/** A manual reminder respects the same suppression rules. */
export async function sendManualReminder(invoiceId: ID) {
  const ctx = getCtx();
  requirePerm(ctx, 'reminders.send');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === invoiceId));
  const status = collectionStatus(ctx.db, inv);
  if (status === 'paid') throw new BusinessRuleError('La factura está cobrada: no procede enviar recordatorio.');
  const d = openDispute(ctx.db, invoiceId);
  if (d?.holdReminders) throw new BusinessRuleError('Hay una disputa abierta con retención de recordatorios.');
  if (paidCents(ctx.db, invoiceId) === 0 && inv.dueDate && inv.dueDate >= ctx.today) throw new BusinessRuleError('La factura aún no ha vencido.');
  const customer = ctx.db.customers.find((c) => c.id === inv.customerId)!;
  const r = await sendEmail(customer.email, `Recordatorio factura ${inv.number}`);
  transact(ctx.actor, (tx) => {
    tx.insert('reminders', { id: newId('rem'), companyId: ctx.company.id, invoiceId, offsetDays: null, status: r.status === 'delivered' ? 'delivered' : 'failed', reason: `Recordatorio manual. ${r.detail}`, channel: 'email', at: nowISO(), by: ctx.user.id, simulated: true });
    tx.audit({ action: 'reminder.send', entityType: 'invoice', entityId: invoiceId, entityLabel: inv.number ?? invoiceId, summary: `Recordatorio manual → ${r.status === 'delivered' ? 'entregado' : 'fallido'} (simulado).`, reason: null, changes: [] });
  });
  return r;
}
