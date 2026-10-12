/** Column definitions shared by list exports, reports and the accountant handover. */
import { DOCUMENT_STATUS, EXCHANGE_STATUS, FISCAL_STATUS, COLLECTION_STATUS, EXPENSE_REVIEW_STATUS, EXPENSE_PAYMENT_STATUS } from '../domain/status';
import type { Database, ExpenseRecord, Invoice, PaymentEvent } from '../domain/types';
import { collectibleCents, collectionStatus, outstandingCents, paidCents, userName } from '../store/selectors';
import { DOCUMENT_TYPE_LABEL, EXPENSE_CATEGORIES } from './expenseService';
import { PAYMENT_METHOD_LABEL } from './collectionService';
import type { Column } from './exportService';

export function invoiceColumns(db: Database): Column<Invoice>[] {
  const cust = (i: Invoice) => db.customers.find((c) => c.id === i.customerId);
  return [
    { key: 'id', label: 'ID interno', value: (i) => i.id },
    { key: 'numero', label: 'Número', value: (i) => i.number ?? '' },
    { key: 'tipo', label: 'Tipo', value: (i) => (i.kind === 'rectifying' ? `Rectificativa ${i.rectification?.reasonCode} (${i.rectification?.method === 'substitution' ? 'sustitución' : 'diferencias'})` : 'Ordinaria') },
    { key: 'factura_rectificada', label: 'Factura rectificada', value: (i) => (i.rectification ? db.invoices.find((o) => o.id === i.rectification!.originalInvoiceId)?.number ?? '' : '') },
    { key: 'fecha_expedicion', label: 'Fecha expedición', value: (i) => i.issueDate ?? '' },
    { key: 'fecha_operacion', label: 'Fecha operación', value: (i) => i.operationDate ?? '' },
    { key: 'cliente', label: 'Cliente', value: (i) => i.customerSnapshot?.legalName ?? cust(i)?.legalName ?? '' },
    { key: 'nif_cliente', label: 'NIF cliente', value: (i) => i.customerSnapshot?.idNumber ?? cust(i)?.idNumber ?? '' },
    { key: 'base', label: 'Base imponible', value: (i) => i.totals.baseCents, money: true },
    { key: 'cuota', label: 'Cuota IVA', value: (i) => i.totals.taxCents, money: true },
    { key: 'desglose', label: 'Desglose', value: (i) => i.totals.breakdown.map((b) => `${b.taxCode}:${(b.baseCents / 100).toFixed(2)}/${(b.taxCents / 100).toFixed(2)}`).join(' | ') },
    { key: 'retencion', label: 'Retención IRPF', value: (i) => i.totals.withholdingCents, money: true },
    { key: 'total', label: 'Total factura', value: (i) => i.totals.totalCents, money: true },
    { key: 'a_cobrar', label: 'A cobrar (neto de rectificativas)', value: (i) => collectibleCents(db, i), money: true },
    { key: 'cobrado', label: 'Cobrado', value: (i) => paidCents(db, i.id), money: true },
    { key: 'pendiente', label: 'Pendiente', value: (i) => outstandingCents(db, i), money: true },
    { key: 'vencimiento', label: 'Vencimiento', value: (i) => i.dueDate ?? '' },
    { key: 'estado_documento', label: 'Estado documento', value: (i) => DOCUMENT_STATUS[i.documentStatus].label },
    { key: 'estado_fiscal', label: 'Estado fiscal (simulado)', value: (i) => FISCAL_STATUS[i.fiscalStatus].label },
    { key: 'estado_envio', label: 'Estado envío', value: (i) => EXCHANGE_STATUS[i.exchangeStatus].label },
    { key: 'estado_cobro', label: 'Estado cobro', value: (i) => { const s = collectionStatus(db, i); return s ? COLLECTION_STATUS[s].label : ''; } },
    { key: 'id_proveedor', label: 'ID proveedor fiscal (simulado)', value: (i) => i.providerInvoiceId ?? '' },
    { key: 'registro_fiscal', label: 'ID registro (simulado)', value: (i) => i.fiscalRecordId ?? '' },
  ];
}

export function expenseColumns(db: Database): Column<ExpenseRecord>[] {
  return [
    { key: 'id', label: 'ID interno', value: (e) => e.id },
    { key: 'tipo', label: 'Tipo', value: (e) => (e.kind === 'supplier_invoice' ? 'Factura recibida' : 'Gasto de empleado') },
    { key: 'documento', label: 'Tipo de documento', value: (e) => DOCUMENT_TYPE_LABEL[e.documentType] },
    { key: 'numero', label: 'Número', value: (e) => e.documentNumber },
    { key: 'fecha', label: 'Fecha', value: (e) => e.documentDate },
    { key: 'periodo', label: 'Periodo contable', value: (e) => e.accountingPeriod },
    { key: 'proveedor', label: 'Proveedor / establecimiento', value: (e) => db.suppliers.find((s) => s.id === e.supplierId)?.legalName ?? e.merchantName },
    { key: 'nif_proveedor', label: 'NIF proveedor', value: (e) => db.suppliers.find((s) => s.id === e.supplierId)?.idNumber ?? '' },
    { key: 'categoria', label: 'Categoría', value: (e) => EXPENSE_CATEGORIES[e.category] ?? e.category },
    { key: 'descripcion', label: 'Descripción', value: (e) => e.description },
    { key: 'base', label: 'Base', value: (e) => e.baseCents, money: true },
    { key: 'tipo_iva', label: 'Tipo IVA %', value: (e) => e.vatRatePct },
    { key: 'cuota', label: 'Cuota IVA', value: (e) => e.vatCents, money: true },
    { key: 'retencion', label: 'Retención', value: (e) => e.withholdingCents, money: true },
    { key: 'total', label: 'Total', value: (e) => e.totalCents, money: true },
    { key: 'nif_destinatario_en_ticket', label: 'NIF empresa en ticket', value: (e) => (e.documentType === 'simplified_invoice' ? (e.recipientNifShown ? 'Sí' : 'No') : '') },
    { key: 'revision', label: 'Revisión', value: (e) => EXPENSE_REVIEW_STATUS[e.reviewStatus].label },
    { key: 'revisado_por', label: 'Revisado por', value: (e) => userName(db, e.reviewedBy) },
    { key: 'pago', label: 'Pago', value: (e) => EXPENSE_PAYMENT_STATUS[e.paymentStatus].label },
    { key: 'presentado_por', label: 'Presentado por', value: (e) => userName(db, e.submittedBy) },
    { key: 'justificantes', label: 'Justificantes', value: (e) => db.attachments.filter((a) => e.attachmentIds.includes(a.id)).map((a) => a.fileName).join(' | ') },
  ];
}

export function paymentColumns(db: Database): Column<PaymentEvent>[] {
  return [
    { key: 'id', label: 'ID', value: (p) => p.id },
    { key: 'factura', label: 'Factura', value: (p) => db.invoices.find((i) => i.id === p.invoiceId)?.number ?? '' },
    { key: 'cliente', label: 'Cliente', value: (p) => { const i = db.invoices.find((x) => x.id === p.invoiceId); return db.customers.find((c) => c.id === i?.customerId)?.legalName ?? ''; } },
    { key: 'tipo', label: 'Tipo', value: (p) => (p.kind === 'payment' ? 'Cobro' : 'Anulación de cobro') },
    { key: 'fecha', label: 'Fecha', value: (p) => p.date },
    { key: 'importe', label: 'Importe', value: (p) => (p.kind === 'payment' ? p.amountCents : -p.amountCents), money: true },
    { key: 'metodo', label: 'Método', value: (p) => PAYMENT_METHOD_LABEL[p.method] },
    { key: 'referencia', label: 'Referencia', value: (p) => p.reference },
    { key: 'registrado_por', label: 'Registrado por', value: (p) => userName(db, p.recordedBy) },
  ];
}
