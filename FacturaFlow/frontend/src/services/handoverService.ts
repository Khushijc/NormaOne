/** Accountant / gestoría handover (FIN-08, BRD §07 step 6, WF-02). */
import { endOfMonth, inRange, nowISO } from '../domain/dates';
import { newId } from '../domain/ids';
import { BusinessRuleError } from '../domain/permissions';
import type { Database, HandoverChecklistItem, HandoverPackage, ID } from '../domain/types';
import { transact } from '../store/db';
import { collectibleCents, invoicePeriodDate, openDispute, paidCents } from '../store/selectors';
import { getCtx, latency, ownRecord, requirePerm } from './context';
import { expenseColumns, invoiceColumns, paymentColumns } from './exportColumns';
import { createExport, downloadFile, SCOPE_NOTE, toJSON } from './exportService';
import { demoHash } from '../domain/ids';

export interface PeriodSummary {
  invoices: { count: number; base: number; tax: number; withholding: number; total: number; rectifyingCount: number; rectifyingTotal: number };
  collected: number;
  expenses: { count: number; base: number; vat: number; total: number; pending: number };
  exceptions: { kind: string; label: string; link: string }[];
}

export function periodData(db: Database, companyId: ID, from: string, to: string) {
  const invoices = db.invoices.filter((i) => i.companyId === companyId && (i.documentStatus === 'issued' || i.documentStatus === 'rectified') && inRange(i.issueDate, from, to));
  const expenses = db.expenses.filter((e) => e.companyId === companyId && e.accountingPeriod >= from.slice(0, 7) && e.accountingPeriod <= to.slice(0, 7));
  const payments = db.payments.filter((p) => p.companyId === companyId && inRange(p.date, from, to));
  return { invoices, expenses, payments };
}

export function summarisePeriod(db: Database, companyId: ID, from: string, to: string): PeriodSummary {
  const { invoices, expenses, payments } = periodData(db, companyId, from, to);
  const ordinary = invoices.filter((i) => i.kind === 'ordinary');
  const rect = invoices.filter((i) => i.kind === 'rectifying');
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const approved = expenses.filter((e) => e.reviewStatus === 'approved');
  const exceptions: PeriodSummary['exceptions'] = [];
  for (const i of invoices) {
    if (i.fiscalStatus !== 'accepted') exceptions.push({ kind: 'fiscal', label: `${i.number}: estado fiscal "${i.fiscalStatus}"`, link: `/facturas/${i.id}?tab=fiscal` });
    if (openDispute(db, i.id)) exceptions.push({ kind: 'dispute', label: `${i.number}: disputa abierta`, link: `/facturas/${i.id}?tab=cobros` });
  }
  for (const i of db.invoices.filter((x) => x.companyId === companyId && x.pendingOperationId && inRange(invoicePeriodDate(x), from, to))) {
    exceptions.push({ kind: 'uncertain', label: `Emisión pendiente de conciliación (${i.id})`, link: `/integracion-fiscal` });
  }
  for (const e of expenses.filter((x) => x.reviewStatus === 'submitted' || x.reviewStatus === 'draft')) exceptions.push({ kind: 'expense', label: `Gasto sin revisar: ${e.documentNumber || e.description}`, link: `/gastos/${e.id}` });
  for (const e of approved.filter((x) => x.attachmentIds.length === 0)) exceptions.push({ kind: 'evidence', label: `Gasto aprobado sin justificante: ${e.documentNumber || e.description}`, link: `/gastos/${e.id}` });
  return {
    invoices: {
      count: ordinary.length,
      base: sum(ordinary.map((i) => i.totals.baseCents)),
      tax: sum(ordinary.map((i) => i.totals.taxCents)),
      withholding: sum(ordinary.map((i) => i.totals.withholdingCents)),
      total: sum(ordinary.map((i) => i.totals.totalCents)),
      rectifyingCount: rect.length,
      rectifyingTotal: sum(rect.map((i) => i.totals.totalCents)),
    },
    collected: sum(payments.map((p) => (p.kind === 'payment' ? p.amountCents : -p.amountCents))),
    expenses: {
      count: approved.length,
      base: sum(approved.map((e) => e.baseCents)),
      vat: sum(approved.map((e) => e.vatCents)),
      total: sum(approved.map((e) => e.totalCents)),
      pending: expenses.length - approved.length - expenses.filter((e) => e.reviewStatus === 'rejected').length,
    },
    exceptions,
  };
}

/** Automatic checklist items are recomputed from data; they cannot be ticked manually. */
export function autoChecks(db: Database, h: HandoverPackage): Record<string, boolean> {
  const s = summarisePeriod(db, h.companyId, h.periodFrom, h.periodTo);
  const { expenses } = periodData(db, h.companyId, h.periodFrom, h.periodTo);
  return {
    invoices_issued_reconciled: !s.exceptions.some((e) => e.kind === 'fiscal' || e.kind === 'uncertain'),
    fiscal_exceptions: !s.exceptions.some((e) => e.kind === 'fiscal' || e.kind === 'uncertain'),
    expenses_reviewed: !expenses.some((e) => e.reviewStatus === 'submitted' || e.reviewStatus === 'draft'),
    evidence_attached: expenses.filter((e) => e.reviewStatus === 'approved').every((e) => e.attachmentIds.length > 0),
    export_generated: h.exportIds.length > 0,
  };
}

export function effectiveChecklist(db: Database, h: HandoverPackage): HandoverChecklistItem[] {
  const auto = autoChecks(db, h);
  return h.checklist.map((c) => (c.auto ? { ...c, done: auto[c.key] ?? false } : c));
}

const DEFAULT_CHECKLIST: Omit<HandoverChecklistItem, 'done' | 'doneBy' | 'doneAt'>[] = [
  { key: 'invoices_issued_reconciled', label: 'Facturas emitidas con resultado fiscal conciliado', auto: true },
  { key: 'fiscal_exceptions', label: 'Sin excepciones fiscales abiertas (o explicadas)', auto: true },
  { key: 'expenses_reviewed', label: 'Gastos del periodo revisados (sin pendientes)', auto: true },
  { key: 'evidence_attached', label: 'Justificantes adjuntos en todos los gastos aprobados', auto: true },
  { key: 'payments_recorded', label: 'Cobros y pagos del periodo registrados', auto: false },
  { key: 'disputes_noted', label: 'Disputas abiertas documentadas', auto: false },
  { key: 'export_generated', label: 'Exportación del periodo generada', auto: true },
];

export async function createHandover(month: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'handover.manage');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BusinessRuleError('Periodo no válido.');
  if (ctx.db.handovers.some((h) => h.companyId === ctx.company.id && h.periodFrom === `${month}-01`)) throw new BusinessRuleError('Ya existe un traspaso para ese periodo.');
  if (`${month}-01` > ctx.today) throw new BusinessRuleError('No se puede preparar un traspaso de un periodo futuro.');
  const [y, m] = month.split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return transact(ctx.actor, (tx) => {
    const h: HandoverPackage = {
      id: newId('hnd'),
      companyId: ctx.company.id,
      periodFrom: `${month}-01`,
      periodTo: endOfMonth(`${month}-01`),
      label: label.charAt(0).toUpperCase() + label.slice(1),
      status: 'in_preparation',
      checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c, done: false, doneBy: null, doneAt: null })),
      exportIds: [],
      notes: '',
      createdBy: ctx.user.id,
      createdAt: nowISO(),
      deliveredAt: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
    };
    tx.insert('handovers', h);
    tx.audit({ action: 'handover.create', entityType: 'handover', entityId: h.id, entityLabel: h.label, summary: 'Traspaso contable creado.', reason: null, changes: [] });
    return h;
  });
}

export async function toggleManualCheck(id: ID, key: string, done: boolean) {
  await latency(50, 120);
  const ctx = getCtx();
  requirePerm(ctx, 'handover.manage');
  transact(ctx.actor, (tx) => {
    const h = ownRecord(ctx, tx.get('handovers', id));
    if (h.status !== 'in_preparation') throw new BusinessRuleError('El traspaso ya se entregó.');
    const item = h.checklist.find((c) => c.key === key);
    if (!item || item.auto) throw new BusinessRuleError('Este punto se calcula automáticamente a partir de los datos.');
    tx.update('handovers', id, { checklist: h.checklist.map((c) => (c.key === key ? { ...c, done, doneBy: done ? ctx.user.id : null, doneAt: done ? nowISO() : null } : c)) });
    tx.audit({ action: 'handover.check', entityType: 'handover', entityId: id, entityLabel: h.label, summary: `"${item.label}" ${done ? 'marcado' : 'desmarcado'}.`, reason: null, changes: [] });
  });
}

export async function updateHandoverNotes(id: ID, notes: string) {
  const ctx = getCtx();
  requirePerm(ctx, 'handover.manage');
  transact(ctx.actor, (tx) => {
    ownRecord(ctx, tx.get('handovers', id));
    tx.update('handovers', id, { notes });
  });
}

/** Exports the period package. JSON = single package with reconciliation totals; CSV = invoices + expenses + payments files. */
export async function exportHandover(id: ID, format: 'csv' | 'json') {
  const ctx = getCtx();
  requirePerm(ctx, 'exports.create');
  const h = ownRecord(ctx, ctx.db.handovers.find((x) => x.id === id));
  const { invoices, expenses, payments } = periodData(ctx.db, ctx.company.id, h.periodFrom, h.periodTo);
  const visibleExpenses = expenses.filter((e) => e.reviewStatus === 'approved');
  const summary = summarisePeriod(ctx.db, ctx.company.id, h.periodFrom, h.periodTo);
  const base = `${ctx.company.tradeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${h.periodFrom.slice(0, 7)}`;
  const ids: ID[] = [];
  if (format === 'csv') {
    ids.push(createExport({ kind: 'handover.invoices', baseName: `${base}_facturas`, format, rows: invoices, columns: invoiceColumns(ctx.db), periodFrom: h.periodFrom, periodTo: h.periodTo, filters: 'Facturas emitidas y rectificativas del periodo', totalCents: summary.invoices.total + summary.invoices.rectifyingTotal }).id);
    ids.push(createExport({ kind: 'handover.expenses', baseName: `${base}_gastos`, format, rows: visibleExpenses, columns: expenseColumns(ctx.db), periodFrom: h.periodFrom, periodTo: h.periodTo, filters: 'Gastos aprobados del periodo', totalCents: summary.expenses.total }).id);
    ids.push(createExport({ kind: 'handover.payments', baseName: `${base}_cobros`, format, rows: payments, columns: paymentColumns(ctx.db), periodFrom: h.periodFrom, periodTo: h.periodTo, filters: 'Cobros y anulaciones del periodo', totalCents: summary.collected }).id);
  } else {
    const pkg = {
      meta: { empresa: ctx.company.legalName, nif: ctx.company.nif, periodo: h.label, desde: h.periodFrom, hasta: h.periodTo, generado: nowISO(), alcance: SCOPE_NOTE },
      conciliacion: {
        facturas_emitidas: summary.invoices,
        cobrado_en_periodo_cents: summary.collected,
        gastos_aprobados: summary.expenses,
        recuentos: { facturas: invoices.length, gastos_aprobados: visibleExpenses.length, cobros: payments.length },
      },
      excepciones: summary.exceptions.map((e) => e.label),
      facturas: JSON.parse(toJSON(invoices, invoiceColumns(ctx.db), {})).records,
      gastos: JSON.parse(toJSON(visibleExpenses, expenseColumns(ctx.db), {})).records,
      cobros: JSON.parse(toJSON(payments, paymentColumns(ctx.db), {})).records,
      componente_fiscal: { version: ctx.provider?.componentVersion, declaracion_responsable: ctx.provider?.producerDeclaration },
    };
    const content = JSON.stringify(pkg, null, 2);
    const rec = createExport({ kind: 'handover.package', baseName: `${base}_traspaso`, format: 'json', rows: [pkg], columns: [{ key: 'paquete', label: 'paquete', value: () => demoHash(content) }], periodFrom: h.periodFrom, periodTo: h.periodTo, filters: 'Paquete completo de traspaso', totalCents: summary.invoices.total, download: false });
    downloadFile(rec.fileName, content, 'application/json');
    ids.push(rec.id);
  }
  transact(ctx.actor, (tx) => {
    const cur = tx.get('handovers', id)!;
    tx.update('handovers', id, { exportIds: [...cur.exportIds, ...ids] });
  });
  return ids.length;
}

export async function deliverHandover(id: ID) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'handover.manage');
  const h = ownRecord(ctx, ctx.db.handovers.find((x) => x.id === id));
  const list = effectiveChecklist(ctx.db, h);
  const pending = list.filter((c) => !c.done);
  if (pending.length && !h.notes.trim()) {
    throw new BusinessRuleError('Quedan puntos pendientes. Complételos o explique las excepciones en las notas del traspaso antes de entregarlo.', pending.map((p) => p.label));
  }
  transact(ctx.actor, (tx) => {
    tx.update('handovers', id, { status: 'delivered', deliveredAt: nowISO(), checklist: list });
    tx.audit({ action: 'handover.deliver', entityType: 'handover', entityId: id, entityLabel: h.label, summary: `Entregado a la gestoría${pending.length ? ` con ${pending.length} excepción(es) explicadas` : ''}.`, reason: pending.length ? h.notes : null, changes: [] });
  });
}

export async function acknowledgeHandover(id: ID) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'handover.acknowledge');
  const h = ownRecord(ctx, ctx.db.handovers.find((x) => x.id === id));
  if (h.status !== 'delivered') throw new BusinessRuleError('Solo se puede confirmar la recepción de un traspaso entregado.');
  transact(ctx.actor, (tx) => {
    tx.update('handovers', id, { status: 'acknowledged', acknowledgedBy: ctx.user.id, acknowledgedAt: nowISO() });
    tx.audit({ action: 'handover.acknowledge', entityType: 'handover', entityId: id, entityLabel: h.label, summary: 'Recepción confirmada por la gestoría.', reason: null, changes: [] });
  });
}

export { collectibleCents, paidCents };
