/**
 * Materialises the mock JSON seed into a Database on first visit.
 * Derived values (invoice totals, the seed audit trail) are computed here with the same
 * domain functions the app uses, so seed data obeys the same rules as user-created data.
 */
import { chainAuditEvent, type AuditInput } from '../domain/audit';
import { computeTotals } from '../domain/invoiceCalc';
import { formatEURRecord } from '../domain/money';
import { nowISO } from '../domain/dates';
import type { AuditEvent, Database, Invoice, RoleId } from '../domain/types';
import { SCHEMA_VERSION } from '../store/storage';

import attachments from './seed/attachments.json';
import collectionPolicies from './seed/collectionPolicies.json';
import companies from './seed/companies.json';
import customers from './seed/customers.json';
import deliveries from './seed/deliveries.json';
import disputes from './seed/disputes.json';
import expenses from './seed/expenses.json';
import exportsSeed from './seed/exports.json';
import financeConfigs from './seed/financeConfigs.json';
import fiscalOperations from './seed/fiscalOperations.json';
import handovers from './seed/handovers.json';
import invoices from './seed/invoices.json';
import memberships from './seed/memberships.json';
import payments from './seed/payments.json';
import providerConfigs from './seed/providerConfigs.json';
import providerRemote from './seed/providerRemote.json';
import reminders from './seed/reminders.json';
import rules from './seed/rules.json';
import series from './seed/series.json';
import suppliers from './seed/suppliers.json';
import taxCodes from './seed/taxCodes.json';
import users from './seed/users.json';

export const SEED_PROVIDER_REMOTE = providerRemote as { records: Record<string, unknown> };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function buildSeedDatabase(): Database {
  const db: Database = {
    schemaVersion: SCHEMA_VERSION,
    seededAt: nowISO(),
    companies: clone(companies) as Database['companies'],
    financeConfigs: clone(financeConfigs) as Database['financeConfigs'],
    providerConfigs: clone(providerConfigs) as Database['providerConfigs'],
    series: clone(series) as Database['series'],
    taxCodes: clone(taxCodes) as Database['taxCodes'],
    rules: clone(rules) as Database['rules'],
    collectionPolicies: clone(collectionPolicies) as Database['collectionPolicies'],
    users: clone(users) as Database['users'],
    memberships: clone(memberships) as Database['memberships'],
    customers: clone(customers) as Database['customers'],
    suppliers: clone(suppliers) as Database['suppliers'],
    invoices: [],
    payments: clone(payments) as Database['payments'],
    disputes: clone(disputes) as Database['disputes'],
    fiscalOperations: clone(fiscalOperations) as Database['fiscalOperations'],
    deliveries: clone(deliveries) as Database['deliveries'],
    reminders: clone(reminders) as Database['reminders'],
    expenses: clone(expenses) as Database['expenses'],
    attachments: clone(attachments) as Database['attachments'],
    handovers: clone(handovers) as Database['handovers'],
    exports: clone(exportsSeed) as Database['exports'],
    notifications: [],
    audit: [],
  };

  db.invoices = (clone(invoices) as unknown as (Omit<Invoice, 'totals'> & { totals: { withholdingPct: number } })[]).map((raw) => ({
    ...raw,
    totals: computeTotals(raw.lines, db.taxCodes, raw.totals?.withholdingPct ?? 0),
  })) as Invoice[];

  db.audit = buildSeedAudit(db);
  return db;
}

/** Reconstructs a plausible audit trail for the seed history, in time order, chained per company. */
function buildSeedAudit(db: Database): AuditEvent[] {
  const inputs: AuditInput[] = [];
  const userName = (id: string | null) => (id === 'system' ? 'Sistema' : db.users.find((u) => u.id === id)?.name ?? 'Sistema');
  const rolesOf = (userId: string | null, companyId: string): RoleId[] =>
    db.memberships.find((m) => m.userId === userId && m.companyId === companyId)?.roles ?? [];
  const ev = (companyId: string, at: string, actorId: string | null, action: string, entityType: string, entityId: string, entityLabel: string, summary: string, reason: string | null = null) =>
    inputs.push({
      id: `aud_seed_${inputs.length + 1}`,
      companyId,
      at,
      actorId: actorId ?? 'system',
      actorName: userName(actorId),
      actorRoles: rolesOf(actorId, companyId),
      action,
      entityType,
      entityId,
      entityLabel,
      summary,
      reason,
      changes: [],
    });

  for (const m of db.memberships) {
    ev(m.companyId, m.grantedAt, m.grantedBy, 'membership.grant', 'membership', m.id, userName(m.userId), `Roles: ${m.roles.join(', ')}${m.mandateRef ? ` · ${m.mandateRef}` : ''}`);
    if (m.revokedAt) ev(m.companyId, m.revokedAt, m.revokedBy, 'membership.revoke', 'membership', m.id, userName(m.userId), 'Mandato finalizado. Acceso revocado de inmediato.', 'Cambio de gestoría');
  }
  for (const c of db.customers) {
    ev(c.companyId, c.createdAt, c.createdBy, 'customer.create', 'customer', c.id, c.legalName, `Alta de cliente (${c.idNumber}).`);
    if (c.archivedAt) ev(c.companyId, c.archivedAt, 'usr_javier', 'customer.archive', 'customer', c.id, c.legalName, 'Cliente archivado.', c.archivedReason);
  }
  for (const s of db.suppliers) ev(s.companyId, s.createdAt, s.createdBy, 'supplier.create', 'supplier', s.id, s.legalName, `Alta de proveedor (${s.idNumber}).`);
  for (const i of db.invoices) {
    const label = i.number ?? `Borrador ${i.id}`;
    ev(i.companyId, i.createdAt, i.createdBy, i.kind === 'rectifying' ? 'invoice.rectify_request' : 'invoice.create', 'invoice', i.id, label, i.kind === 'rectifying' ? `Rectificativa de ${db.invoices.find((o) => o.id === i.rectification?.originalInvoiceId)?.number}` : 'Borrador creado.', i.rectification?.reasonText ?? null);
    if (i.review.state === 'requested' && i.review.at) ev(i.companyId, i.review.at, i.review.by, 'invoice.request_approval', 'invoice', i.id, label, 'Solicitud de aprobación.', i.review.comment);
    if (i.approvedAt) ev(i.companyId, i.approvedAt, i.approvedBy, 'invoice.approve', 'invoice', i.id, label, `Aprobada. Total ${formatEURRecord(i.totals.totalCents)}.`);
  }
  for (const op of db.fiscalOperations) {
    const inv = db.invoices.find((i) => i.id === op.invoiceId)!;
    const label = inv.number ?? op.reservedNumber ?? inv.id;
    ev(op.companyId, op.requestedAt, op.requestedBy, 'invoice.issue_attempt', 'invoice', inv.id, label, `Envío al proveedor simulado · clave ${op.operationKey}`);
    if (op.state === 'uncertain') {
      ev(op.companyId, op.requestedAt.replace(/:00\.000Z$/, ':30.000Z'), 'system', 'fiscal.uncertain', 'invoice', inv.id, label, op.responseMessage ?? 'Sin respuesta.');
      continue;
    }
    if (op.completedAt) {
      if (op.state === 'rejected') ev(op.companyId, op.completedAt, 'system', 'fiscal.rejected', 'invoice', inv.id, label, op.errors.map((e) => `${e.code}: ${e.message}`).join(' '));
      else {
        ev(op.companyId, op.completedAt, op.requestedBy, 'invoice.issue', 'invoice', inv.id, label, `Número ${op.reservedNumber} asignado. ID proveedor ${op.providerInvoiceId}.`);
        ev(op.companyId, op.completedAt, 'system', op.state === 'accepted' ? 'fiscal.accepted' : 'fiscal.accepted_with_errors', 'invoice', inv.id, label, op.responseMessage ?? '');
      }
    }
  }
  for (const d of db.deliveries) {
    const inv = db.invoices.find((i) => i.id === d.invoiceId)!;
    ev(d.companyId, d.at, d.by === 'system' ? null : d.by, d.status === 'sent' ? 'delivery.send' : 'delivery.result', 'invoice', inv.id, inv.number ?? inv.id, `${d.channel} → ${d.status}: ${d.detail}`);
  }
  for (const p of db.payments) {
    const inv = db.invoices.find((i) => i.id === p.invoiceId)!;
    ev(p.companyId, p.recordedAt, p.recordedBy, 'payment.record', 'invoice', inv.id, inv.number ?? inv.id, `Cobro de ${formatEURRecord(p.amountCents)} (${p.method}) con fecha ${p.date}.`);
  }
  for (const d of db.disputes) {
    const inv = db.invoices.find((i) => i.id === d.invoiceId)!;
    ev(d.companyId, d.openedAt, d.openedBy, 'dispute.open', 'invoice', inv.id, inv.number ?? inv.id, 'Disputa abierta con retención de recordatorios.', d.reason);
  }
  for (const r of db.reminders) {
    const inv = db.invoices.find((i) => i.id === r.invoiceId)!;
    ev(r.companyId, r.at, null, r.status === 'suppressed' ? 'reminder.suppress' : 'reminder.send', 'invoice', inv.id, inv.number ?? inv.id, r.reason);
  }
  for (const e of db.expenses) {
    const label = e.documentNumber || e.description;
    ev(e.companyId, e.createdAt, e.submittedBy, 'expense.create', 'expense', e.id, label, `${e.kind === 'supplier_invoice' ? 'Factura recibida' : 'Gasto de empleado'} · ${formatEURRecord(e.totalCents)}`);
    if (e.submittedAt) ev(e.companyId, e.submittedAt, e.submittedBy, 'expense.submit', 'expense', e.id, label, 'Enviado a revisión con justificante.');
    if (e.reviewedAt) ev(e.companyId, e.reviewedAt, e.reviewedBy, e.reviewStatus === 'rejected' ? 'expense.reject' : 'expense.approve', 'expense', e.id, label, e.reviewStatus === 'rejected' ? 'Rechazado.' : 'Aprobado.', e.reviewComment || null);
  }
  for (const x of db.exports) ev(x.companyId, x.createdAt, x.createdBy, 'export.create', 'export', x.id, x.fileName, `${x.recordCount} registros · huella ${x.fingerprint}`);
  for (const h of db.handovers) {
    ev(h.companyId, h.createdAt, h.createdBy, 'handover.create', 'handover', h.id, h.label, 'Traspaso contable creado.');
    if (h.deliveredAt) ev(h.companyId, h.deliveredAt, h.createdBy, 'handover.deliver', 'handover', h.id, h.label, 'Entregado a la gestoría.');
    if (h.acknowledgedAt) ev(h.companyId, h.acknowledgedAt, h.acknowledgedBy, 'handover.acknowledge', 'handover', h.id, h.label, 'Recepción confirmada.');
  }

  inputs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out: AuditEvent[] = [];
  const last = new Map<string, AuditEvent>();
  for (const input of inputs) {
    const e = chainAuditEvent(last.get(input.companyId), input);
    last.set(input.companyId, e);
    out.push(e);
  }
  return out;
}
