/** Supplier invoices and employee expenses (future API: /companies/:id/expenses). FIN-06, PLT-05. */
import { isValidISODate, nowISO } from '../domain/dates';
import { demoHash, newId } from '../domain/ids';
import { formatEURRecord } from '../domain/money';
import { BusinessRuleError, PermissionError } from '../domain/permissions';
import type { Attachment, ExpenseRecord, ID } from '../domain/types';
import { findExpenseDuplicates, ok, validateExpense } from '../domain/validation';
import { transact } from '../store/db';
import { getCtx, latency, ownRecord, requirePerm, type Ctx } from './context';
import { extractFromDocument, type ExtractionSuggestion } from './mock/channels';

export const EXPENSE_CATEGORIES: Record<string, string> = {
  materiales: 'Materiales y repuestos',
  combustible: 'Combustible',
  vehiculos: 'Vehículos y renting',
  telefonia: 'Telefonía e internet',
  seguros: 'Seguros',
  servicios_profesionales: 'Servicios profesionales',
  software: 'Software y licencias',
  dietas: 'Dietas y comidas',
  desplazamientos: 'Desplazamientos (taxi, tren)',
  aparcamiento: 'Aparcamiento',
  peajes: 'Peajes',
  otros: 'Otros',
};

export const DOCUMENT_TYPE_LABEL: Record<ExpenseRecord['documentType'], string> = {
  complete_invoice: 'Factura completa',
  simplified_invoice: 'Factura simplificada (ticket)',
  receipt_no_vat: 'Recibo sin IVA',
};

export type ExpenseInput = Pick<
  ExpenseRecord,
  | 'kind'
  | 'supplierId'
  | 'merchantName'
  | 'documentType'
  | 'documentNumber'
  | 'documentDate'
  | 'accountingPeriod'
  | 'category'
  | 'description'
  | 'baseCents'
  | 'vatRatePct'
  | 'vatCents'
  | 'withholdingCents'
  | 'totalCents'
  | 'recipientNifShown'
  | 'dueDate'
>;

/** Visibility: employees see their own; supervisors their team; finance roles all. */
export function canViewExpense(ctx: Ctx, e: ExpenseRecord): boolean {
  if (e.companyId !== ctx.company.id) return false;
  if (ctx.perms.has('expenses.view_all') || ctx.perms.has('expenses.review_all')) {
    // Gestoría sees only reviewed (approved) documents and supplier invoices submitted to finance.
    if (ctx.membership?.roles.length === 1 && ctx.membership.roles[0] === 'gestoria') return e.reviewStatus === 'approved';
    return true;
  }
  if (e.submittedBy === ctx.user.id) return true;
  if (ctx.perms.has('expenses.review_team') && ctx.membership?.teamUserIds.includes(e.submittedBy)) return e.reviewStatus !== 'draft';
  return false;
}

export function canReviewExpense(ctx: Ctx, e: ExpenseRecord): { ok: boolean; reason: string } {
  if (e.reviewStatus !== 'submitted') return { ok: false, reason: 'Solo se revisan gastos enviados.' };
  if (e.submittedBy === ctx.user.id) return { ok: false, reason: 'No puede aprobar sus propios gastos.' };
  if (ctx.perms.has('expenses.review_all')) return { ok: true, reason: '' };
  if (ctx.perms.has('expenses.review_team') && ctx.membership?.teamUserIds.includes(e.submittedBy)) {
    const limit = ctx.membership.approvalLimitCents ?? 0;
    if (e.totalCents > limit) return { ok: false, reason: `Supera su límite de aprobación (${formatEURRecord(limit)}). Debe aprobarlo la propiedad o la responsable financiera.` };
    return { ok: true, reason: '' };
  }
  return { ok: false, reason: 'No tiene autoridad de revisión sobre este gasto.' };
}

function canEdit(ctx: Ctx, e: ExpenseRecord) {
  if (e.reviewStatus !== 'draft' && e.reviewStatus !== 'rejected') throw new BusinessRuleError('Solo se editan borradores o gastos rechazados. Un gasto enviado o aprobado no se modifica.');
  if (e.submittedBy !== ctx.user.id && !ctx.perms.has('expenses.manage_supplier')) throw new PermissionError('expenses.edit');
}

export async function saveExpense(id: ID | null, input: ExpenseInput): Promise<ExpenseRecord> {
  await latency();
  const ctx = getCtx();
  if (input.kind === 'supplier_invoice') requirePerm(ctx, 'expenses.manage_supplier');
  else requirePerm(ctx, 'expenses.submit_own');
  if (input.supplierId) ownRecord(ctx, ctx.db.suppliers.find((s) => s.id === input.supplierId));
  const v = validateExpense({ ...input, companyId: ctx.company.id, attachmentIds: [] }, ctx.today, false);
  if (!ok(v)) throw new BusinessRuleError('Revise los campos marcados.', Object.values(v.errors));
  return transact(ctx.actor, (tx) => {
    if (id) {
      const current = ownRecord(ctx, tx.get('expenses', id));
      canEdit(ctx, current);
      const updated = tx.update('expenses', id, { ...input, reviewStatus: 'draft', updatedAt: nowISO(), version: current.version + 1 });
      tx.audit({ action: 'expense.update', entityType: 'expense', entityId: id, entityLabel: updated.documentNumber || updated.description, summary: `Modificado · total ${formatEURRecord(updated.totalCents)}${current.reviewStatus === 'rejected' ? ' (corrección tras rechazo)' : ''}.`, reason: null, changes: current.totalCents !== updated.totalCents ? [{ field: 'Total', before: formatEURRecord(current.totalCents), after: formatEURRecord(updated.totalCents) }] : [] });
      return updated;
    }
    const e: ExpenseRecord = {
      ...input,
      id: newId('exp'),
      companyId: ctx.company.id,
      submittedBy: ctx.user.id,
      submittedAt: null,
      reviewStatus: 'draft',
      reviewedBy: null,
      reviewedAt: null,
      reviewComment: '',
      paymentStatus: 'unpaid',
      paidAt: null,
      paymentReference: '',
      attachmentIds: [],
      duplicateAcknowledged: [],
      extraction: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      version: 1,
    };
    tx.insert('expenses', e);
    tx.audit({ action: 'expense.create', entityType: 'expense', entityId: e.id, entityLabel: e.documentNumber || e.description, summary: `${e.kind === 'supplier_invoice' ? 'Factura recibida' : 'Gasto de empleado'} creado · ${formatEURRecord(e.totalCents)}.`, reason: null, changes: [] });
    return e;
  });
}

export async function deleteExpenseDraft(id: ID) {
  await latency();
  const ctx = getCtx();
  transact(ctx.actor, (tx) => {
    const e = ownRecord(ctx, tx.get('expenses', id));
    if (e.reviewStatus !== 'draft') throw new BusinessRuleError('Solo se pueden eliminar borradores. Los gastos enviados se conservan como evidencia.');
    if (e.submittedBy !== ctx.user.id && !ctx.perms.has('expenses.manage_supplier')) throw new PermissionError('expenses.delete');
    tx.remove('expenses', id);
    tx.audit({ action: 'expense.delete_draft', entityType: 'expense', entityId: id, entityLabel: e.documentNumber || e.description, summary: 'Borrador eliminado (nunca fue enviado a revisión).', reason: null, changes: [] });
  });
}

const MAX_INLINE_BYTES = 350_000;

/** Reads a local file for the demo. Small files are kept as data URLs; nothing is uploaded. */
export function readLocalFile(file: File): Promise<{ fileName: string; mimeType: string; sizeBytes: number; dataUrl: string | null; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) return reject(new BusinessRuleError('Tipo de archivo no admitido. Use PDF, JPG, PNG o WEBP.'));
    if (file.size > 10 * 1024 * 1024) return reject(new BusinessRuleError('El archivo supera 10 MB.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new BusinessRuleError('No se pudo leer el archivo.'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl: file.size <= MAX_INLINE_BYTES ? dataUrl : null,
        fingerprint: demoHash(`${file.size}:${dataUrl.slice(-4096)}`),
      });
    };
    reader.readAsDataURL(file);
  });
}

export async function addAttachment(expenseId: ID, file: Awaited<ReturnType<typeof readLocalFile>>, replacesId: ID | null = null): Promise<Attachment> {
  await latency();
  const ctx = getCtx();
  return transact(ctx.actor, (tx) => {
    const e = ownRecord(ctx, tx.get('expenses', expenseId));
    canEdit(ctx, e);
    const prev = replacesId ? ownRecord(ctx, tx.get('attachments', replacesId)) : null;
    const att: Attachment = {
      id: newId('att'),
      companyId: ctx.company.id,
      ownerType: 'expense',
      ownerId: expenseId,
      ...file,
      accessClass: 'finance',
      uploadedBy: ctx.user.id,
      uploadedAt: nowISO(),
      version: prev ? prev.version + 1 : 1,
      supersedesId: prev?.id ?? null,
      demo: false,
    };
    tx.insert('attachments', att);
    tx.update('expenses', expenseId, { attachmentIds: [...e.attachmentIds.filter((x) => x !== replacesId), att.id], updatedAt: nowISO() });
    tx.audit({
      action: prev ? 'attachment.replace' : 'attachment.add',
      entityType: 'expense',
      entityId: expenseId,
      entityLabel: e.documentNumber || e.description,
      summary: prev ? `${file.fileName} sustituye a ${prev.fileName} (v${att.version}); la versión anterior se conserva.` : `Justificante ${file.fileName} adjuntado (${Math.round(file.sizeBytes / 1024)} KB). Adjuntar no implica aprobación.`,
      reason: null,
      changes: [],
    });
    return att;
  });
}

export function duplicatesFor(e: ExpenseRecord) {
  const ctx = getCtx();
  return findExpenseDuplicates(e, ctx.db.expenses.filter((x) => x.companyId === ctx.company.id), ctx.db.attachments.filter((a) => a.companyId === ctx.company.id));
}

export async function submitExpense(id: ID, acknowledgeDuplicates: boolean) {
  await latency();
  const ctx = getCtx();
  const e = ownRecord(ctx, ctx.db.expenses.find((x) => x.id === id));
  canEdit(ctx, e);
  const v = validateExpense(e, ctx.today, true);
  if (!ok(v)) throw new BusinessRuleError('El gasto no puede enviarse todavía.', Object.values(v.errors));
  const dups = duplicatesFor(e);
  if (dups.length && !acknowledgeDuplicates) throw new BusinessRuleError('Posible duplicado detectado. Confirme que no es un duplicado para continuar.', dups.map((d) => d.reason));
  transact(ctx.actor, (tx) => {
    tx.update('expenses', id, { reviewStatus: 'submitted', submittedAt: nowISO(), duplicateAcknowledged: dups.map((d) => d.id), updatedAt: nowISO(), version: e.version + 1 });
    tx.audit({ action: 'expense.submit', entityType: 'expense', entityId: id, entityLabel: e.documentNumber || e.description, summary: `Enviado a revisión · ${formatEURRecord(e.totalCents)}.`, reason: dups.length ? `Posible duplicado confirmado por el remitente: ${dups.map((d) => d.reason).join(' ')}` : v.warnings.join(' | ') || null, changes: [] });
    tx.notify({ type: 'expense_review', title: 'Gasto pendiente de revisión', body: 'Hay un gasto nuevo para revisar.', recipientRoles: e.kind === 'employee_expense' ? ['supervisor', 'owner'] : ['owner'], recipientUserIds: [], link: `/gastos/${id}`, dedupeKey: `expense:${id}:${e.version}` });
  });
}

export async function reviewExpense(id: ID, decision: 'approve' | 'reject', comment: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'expenses.review_all', 'expenses.review_team');
  const e = ownRecord(ctx, ctx.db.expenses.find((x) => x.id === id));
  const can = canReviewExpense(ctx, e);
  if (!can.ok) throw new BusinessRuleError(can.reason);
  if (decision === 'reject' && !comment.trim()) throw new BusinessRuleError('El rechazo requiere un motivo.');
  if (decision === 'approve' && e.attachmentIds.length === 0) throw new BusinessRuleError('No se puede aprobar sin justificante.');
  transact(ctx.actor, (tx) => {
    tx.update('expenses', id, { reviewStatus: decision === 'approve' ? 'approved' : 'rejected', reviewedBy: ctx.user.id, reviewedAt: nowISO(), reviewComment: comment, updatedAt: nowISO(), version: e.version + 1 });
    tx.audit({ action: decision === 'approve' ? 'expense.approve' : 'expense.reject', entityType: 'expense', entityId: id, entityLabel: e.documentNumber || e.description, summary: decision === 'approve' ? 'Aprobado. El tratamiento fiscal lo valida la gestoría.' : 'Rechazado con motivo.', reason: comment || null, changes: [{ field: 'Revisión', before: 'En revisión', after: decision === 'approve' ? 'Aprobado' : 'Rechazado' }] });
    tx.notify({ type: 'expense_decided', title: decision === 'approve' ? 'Gasto aprobado' : 'Gasto rechazado', body: decision === 'approve' ? 'Su gasto ha sido aprobado.' : 'Revise el motivo del rechazo.', recipientRoles: [], recipientUserIds: [e.submittedBy], link: `/gastos/${id}`, dedupeKey: `expense-decided:${id}:${e.version}` });
  });
}

export async function markExpensePaid(id: ID, date: string, reference: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'expenses.record_payment');
  const e = ownRecord(ctx, ctx.db.expenses.find((x) => x.id === id));
  if (e.reviewStatus !== 'approved') throw new BusinessRuleError('Solo se pagan gastos aprobados.');
  if (e.paymentStatus !== 'unpaid') throw new BusinessRuleError('El pago ya está registrado.');
  if (!isValidISODate(date) || date > ctx.today) throw new BusinessRuleError('Fecha de pago no válida.');
  if (!reference.trim()) throw new BusinessRuleError('Indique la referencia del pago.');
  const status = e.kind === 'employee_expense' ? 'reimbursed' : 'paid';
  transact(ctx.actor, (tx) => {
    tx.update('expenses', id, { paymentStatus: status, paidAt: date, paymentReference: reference, updatedAt: nowISO() });
    tx.audit({ action: 'expense.pay', entityType: 'expense', entityId: id, entityLabel: e.documentNumber || e.description, summary: `${status === 'reimbursed' ? 'Reembolso' : 'Pago'} de ${formatEURRecord(e.totalCents)} el ${date} (ref. ${reference}). Registro operativo: no inicia pagos bancarios.`, reason: null, changes: [] });
  });
}

/** Simulated extraction: stores which fields were suggested; the user must review them. */
export async function suggestFromAttachment(expenseId: ID): Promise<ExtractionSuggestion> {
  const ctx = getCtx();
  const e = ownRecord(ctx, ctx.db.expenses.find((x) => x.id === expenseId));
  const att = ctx.db.attachments.find((a) => a.id === e.attachmentIds[e.attachmentIds.length - 1]);
  if (!att) throw new BusinessRuleError('Adjunte primero un justificante.');
  const s = await extractFromDocument(att.fileName, att.sizeBytes);
  transact(ctx.actor, (tx) => {
    tx.update('expenses', expenseId, { extraction: { suggestedAt: nowISO(), fields: Object.keys(s).filter((k) => k !== 'confidence'), simulated: true } });
  });
  return s;
}
