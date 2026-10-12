/**
 * Sales-invoice application service (future API: /companies/:id/invoices/...).
 * FIN-02 … FIN-05, AC-FIN-01 … AC-FIN-04.
 */
import { financeIssueGate, isIssueBlocked } from '../domain/applicability';
import { addDays, nowISO } from '../domain/dates';
import { buildFiscalPayload } from '../domain/fiscalPayload';
import { newId } from '../domain/ids';
import { computeTotals, lineAmounts } from '../domain/invoiceCalc';
import { formatEURRecord } from '../domain/money';
import { BusinessRuleError } from '../domain/permissions';
import type {
  FiscalOperation,
  ID,
  ISODate,
  Invoice,
  InvoiceLine,
  PartySnapshot,
  RectificationMethod,
  RectificationReasonCode,
} from '../domain/types';
import { validateInvoiceForApproval, ok } from '../domain/validation';
import { transact, type Tx } from '../store/db';
import { invoiceLabel } from '../store/selectors';
import { getCtx, latency, ownRecord, requirePerm, type Ctx } from './context';
import { ProviderTimeoutError, ProviderUnavailableError, queryOperation, submitRecord, type ProviderResult } from './mock/fiscalProvider';
import { sendEmail } from './mock/channels';

export interface DraftInput {
  customerId: ID;
  seriesId: ID;
  operationDate: ISODate | null;
  dueDate: ISODate | null;
  lines: InvoiceLine[];
  notes: string;
  paymentTerms: string;
  withholdingPct: number;
}

const EDITABLE: Invoice['documentStatus'][] = ['draft'];

function assertDraft(inv: Invoice) {
  if (!EDITABLE.includes(inv.documentStatus)) {
    throw new BusinessRuleError(
      inv.documentStatus === 'approved'
        ? 'La factura está aprobada. Revoque la aprobación para editarla.'
        : 'Las facturas emitidas no se pueden modificar ni eliminar. Use una factura rectificativa.',
    );
  }
}

function originalOf(ctx: Ctx, inv: Invoice): Invoice | undefined {
  return inv.rectification ? ctx.db.invoices.find((i) => i.id === inv.rectification!.originalInvoiceId) : undefined;
}

export function validateForApproval(ctx: Ctx, inv: Invoice) {
  const customer = ctx.db.customers.find((c) => c.id === inv.customerId && c.companyId === ctx.company.id);
  const original = originalOf(ctx, inv);
  return validateInvoiceForApproval(inv, customer, ctx.finance, ctx.db.taxCodes, ctx.today, original ? original.operationDate ?? original.issueDate : null);
}

function lineChanges(before: Invoice, after: Invoice) {
  const changes = [];
  if (before.customerId !== after.customerId) changes.push({ field: 'Cliente', before: before.customerId, after: after.customerId });
  if (before.totals.totalCents !== after.totals.totalCents) changes.push({ field: 'Total', before: formatEURRecord(before.totals.totalCents), after: formatEURRecord(after.totals.totalCents) });
  if (before.dueDate !== after.dueDate) changes.push({ field: 'Vencimiento', before: before.dueDate ?? '—', after: after.dueDate ?? '—' });
  if (before.lines.length !== after.lines.length) changes.push({ field: 'Nº de líneas', before: String(before.lines.length), after: String(after.lines.length) });
  return changes;
}

// ─────────────────────────────── Drafts ───────────────────────────────

export async function saveDraft(id: ID | null, input: DraftInput): Promise<Invoice> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.edit_draft');
  const series = ownRecord(ctx, ctx.db.series.find((s) => s.id === input.seriesId));
  if (!series.active) throw new BusinessRuleError('La serie seleccionada no está activa.');
  ownRecord(ctx, ctx.db.customers.find((c) => c.id === input.customerId));
  const withholdingPct = ctx.finance.irpfWithholding.applies ? input.withholdingPct : 0;
  const totals = computeTotals(input.lines, ctx.db.taxCodes, withholdingPct);

  return transact(ctx.actor, (tx) => {
    if (id) {
      const current = ownRecord(ctx, tx.get('invoices', id));
      assertDraft(current);
      if (current.kind === 'ordinary' && series.kind !== 'ordinary') throw new BusinessRuleError('Una factura ordinaria no puede usar una serie de rectificativas.');
      const updated = tx.update('invoices', id, {
        ...input,
        totals,
        review: current.review.state === 'requested' ? { state: 'none', by: null, at: null, comment: '' } : current.review,
        updatedAt: nowISO(),
        version: current.version + 1,
      });
      tx.audit({ action: 'invoice.update', entityType: 'invoice', entityId: id, entityLabel: invoiceLabel(updated), summary: 'Borrador modificado.', changes: lineChanges(current, updated), reason: null });
      return updated;
    }
    if (series.kind !== 'ordinary') throw new BusinessRuleError('Seleccione una serie ordinaria. Las rectificativas se crean desde la factura original.');
    const inv: Invoice = {
      id: newId('inv'),
      companyId: ctx.company.id,
      kind: 'ordinary',
      seriesId: input.seriesId,
      number: null,
      customerId: input.customerId,
      customerSnapshot: null,
      issuerSnapshot: null,
      issueDate: null,
      operationDate: input.operationDate,
      dueDate: input.dueDate,
      lines: input.lines,
      totals,
      notes: input.notes,
      paymentTerms: input.paymentTerms,
      documentStatus: 'draft',
      review: { state: 'none', by: null, at: null, comment: '' },
      approvedBy: null,
      approvedAt: null,
      issuedBy: null,
      issuedAt: null,
      fiscalStatus: 'not_submitted',
      providerInvoiceId: null,
      fiscalRecordId: null,
      fiscalHash: null,
      pendingOperationId: null,
      exchangeStatus: 'not_sent',
      rectification: null,
      rectifiedByIds: [],
      createdBy: ctx.user.id,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      version: 1,
    };
    tx.insert('invoices', inv);
    tx.audit({ action: 'invoice.create', entityType: 'invoice', entityId: inv.id, entityLabel: 'Borrador', summary: `Borrador creado · ${formatEURRecord(totals.totalCents)}`, changes: [], reason: null });
    return inv;
  });
}

/** Drafts have no number or fiscal effect, so they may be deleted (with audit). */
export async function deleteDraft(id: ID, reason: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.edit_draft');
  transact(ctx.actor, (tx) => {
    const inv = ownRecord(ctx, tx.get('invoices', id));
    assertDraft(inv);
    if (inv.pendingOperationId) throw new BusinessRuleError('Existe una operación fiscal pendiente de conciliación.');
    tx.remove('invoices', id);
    tx.audit({ action: 'invoice.delete_draft', entityType: 'invoice', entityId: id, entityLabel: 'Borrador', summary: `Borrador eliminado (${formatEURRecord(inv.totals.totalCents)}).`, reason, changes: [] });
  });
}

// ─────────────────────────────── Review & approval ───────────────────────────────

export async function requestApproval(id: ID, comment: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.edit_draft');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === id));
  assertDraft(inv);
  const v = validateForApproval(ctx, inv);
  if (!ok(v)) throw new BusinessRuleError('Corrija los errores antes de solicitar la aprobación.', Object.values(v.errors));
  transact(ctx.actor, (tx) => {
    tx.update('invoices', id, { review: { state: 'requested', by: ctx.user.id, at: nowISO(), comment }, updatedAt: nowISO() });
    tx.audit({ action: 'invoice.request_approval', entityType: 'invoice', entityId: id, entityLabel: invoiceLabel(inv), summary: 'Aprobación solicitada.', reason: comment || null, changes: [] });
    tx.notify({ type: 'approval_requested', title: 'Factura pendiente de aprobación', body: 'Un borrador espera su revisión.', recipientRoles: ['issuer', 'owner'], recipientUserIds: [], link: `/facturas/${id}`, dedupeKey: `approval:${id}:${Date.now()}` });
  });
}

export async function returnToAuthor(id: ID, comment: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.approve');
  if (!comment.trim()) throw new BusinessRuleError('Indique el motivo de la devolución.');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === id));
  assertDraft(inv);
  transact(ctx.actor, (tx) => {
    tx.update('invoices', id, { review: { state: 'returned', by: ctx.user.id, at: nowISO(), comment }, updatedAt: nowISO() });
    tx.audit({ action: 'invoice.return', entityType: 'invoice', entityId: id, entityLabel: invoiceLabel(inv), summary: 'Devuelta al autor para corrección.', reason: comment, changes: [] });
    tx.notify({ type: 'approval_returned', title: 'Borrador devuelto con comentarios', body: 'Revise los comentarios del aprobador.', recipientRoles: [], recipientUserIds: [inv.createdBy], link: `/facturas/${id}`, dedupeKey: `returned:${id}:${Date.now()}` });
  });
}

export async function approveInvoice(id: ID) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.approve');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === id));
  assertDraft(inv);
  if (ctx.finance.requireDifferentApprover && inv.createdBy === ctx.user.id) {
    throw new BusinessRuleError('Control interno: la aprobación debe realizarla una persona distinta del autor del borrador.');
  }
  const v = validateForApproval(ctx, inv);
  if (!ok(v)) throw new BusinessRuleError('La factura no supera la validación.', Object.values(v.errors));
  transact(ctx.actor, (tx) => {
    tx.update('invoices', id, { documentStatus: 'approved', approvedBy: ctx.user.id, approvedAt: nowISO(), review: { ...inv.review, state: 'none' }, updatedAt: nowISO(), version: inv.version + 1 });
    tx.audit({
      action: 'invoice.approve',
      entityType: 'invoice',
      entityId: id,
      entityLabel: invoiceLabel(inv),
      summary: `Aprobada · ${formatEURRecord(inv.totals.totalCents)}${v.warnings.length ? ` · ${v.warnings.length} aviso(s) aceptado(s)` : ''}`,
      reason: v.warnings.join(' | ') || null,
      changes: [{ field: 'Estado documento', before: 'Borrador', after: 'Aprobada' }],
    });
  });
}

export async function revokeApproval(id: ID, reason: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.approve');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === id));
  if (inv.documentStatus !== 'approved') throw new BusinessRuleError('Solo se puede revocar la aprobación de una factura aprobada y no emitida.');
  if (inv.pendingOperationId) throw new BusinessRuleError('Hay una operación de emisión pendiente de conciliación: concilie antes de revocar.');
  transact(ctx.actor, (tx) => {
    tx.update('invoices', id, { documentStatus: 'draft', approvedBy: null, approvedAt: null, updatedAt: nowISO(), version: inv.version + 1 });
    tx.audit({ action: 'invoice.revoke_approval', entityType: 'invoice', entityId: id, entityLabel: invoiceLabel(inv), summary: 'Aprobación revocada; vuelve a borrador.', reason, changes: [{ field: 'Estado documento', before: 'Aprobada', after: 'Borrador' }] });
  });
}

// ─────────────────────────────── Issue through the (simulated) provider ───────────────────────────────

export type IssueOutcome =
  | { kind: 'issued'; message: string; number: string }
  | { kind: 'needs_review'; message: string; number: string }
  | { kind: 'rejected'; message: string; number: string }
  | { kind: 'uncertain'; message: string }
  | { kind: 'not_processed'; message: string }
  | { kind: 'failed'; message: string };

export function issueOperationKey(invoiceId: ID) {
  return `inv:${invoiceId}:issue`;
}

function snapshot(p: { legalName: string; idType: PartySnapshot['idType']; idNumber: string; address: PartySnapshot['address'] }): PartySnapshot {
  return { legalName: p.legalName, idType: p.idType, idNumber: p.idNumber, address: { ...p.address } };
}

/** Applies a provider result to the invoice and operation (used by issue and reconciliation). */
function applyIssueResult(ctx: Ctx, tx: Tx, invId: ID, opId: ID, r: ProviderResult, reconciled: boolean): IssueOutcome {
  const inv = tx.get('invoices', invId)!;
  const op = tx.get('fiscalOperations', opId)!;
  const customer = tx.get('customers', inv.customerId)!;
  const number = r.number;
  const issueDate = r.processedAt ? new Date(r.processedAt).toISOString().slice(0, 10) : ctx.today;
  tx.update('fiscalOperations', opId, {
    state: r.state,
    completedAt: nowISO(),
    providerRequestId: r.requestId,
    providerInvoiceId: r.providerInvoiceId,
    fiscalRecordId: r.fiscalRecordId,
    responseCode: r.responseCode,
    responseMessage: r.responseMessage,
    errors: r.errors ?? [],
    reconciledBy: reconciled ? ctx.user.id : null,
    reconciledAt: reconciled ? nowISO() : null,
  });
  const fiscalStatus = r.state === 'accepted' ? 'accepted' : r.state === 'accepted_with_errors' ? 'needs_review' : 'rejected';
  tx.update('invoices', invId, {
    documentStatus: 'issued',
    number,
    issueDate: inv.issueDate ?? issueDate,
    issuedAt: inv.issuedAt ?? nowISO(),
    issuedBy: inv.issuedBy ?? op.requestedBy,
    customerSnapshot: inv.customerSnapshot ?? snapshot(customer),
    issuerSnapshot: inv.issuerSnapshot ?? { legalName: ctx.company.legalName, idType: 'NIF', idNumber: ctx.company.nif, address: { ...ctx.company.registeredAddress } },
    fiscalStatus,
    providerInvoiceId: r.providerInvoiceId,
    fiscalRecordId: r.fiscalRecordId,
    fiscalHash: r.fiscalRecordId ? `demo-${r.fiscalRecordId.toLowerCase()}` : null,
    pendingOperationId: null,
    updatedAt: nowISO(),
    version: inv.version + 1,
  });
  // Rectifying invoice issued → the original becomes "rectified" (its content is untouched).
  if (inv.kind === 'rectifying' && inv.rectification) {
    const orig = tx.get('invoices', inv.rectification.originalInvoiceId)!;
    if (!orig.rectifiedByIds.includes(invId)) {
      tx.update('invoices', orig.id, { documentStatus: 'rectified', rectifiedByIds: [...orig.rectifiedByIds, invId], updatedAt: nowISO() });
      tx.audit({
        action: 'invoice.rectified',
        entityType: 'invoice',
        entityId: orig.id,
        entityLabel: orig.number ?? orig.id,
        summary: `Rectificada por ${number}. Contenido original conservado sin cambios.`,
        reason: inv.rectification.reasonText,
        changes: [{ field: 'Estado documento', before: 'Emitida', after: 'Rectificada' }],
      });
    }
  }
  tx.audit({
    action: 'invoice.issue',
    entityType: 'invoice',
    entityId: invId,
    entityLabel: number,
    summary: `${reconciled ? 'Emisión confirmada por conciliación' : 'Emitida'}: número ${number}${r.providerInvoiceId ? ` · ID proveedor ${r.providerInvoiceId}` : ''}${r.duplicate ? ' · el proveedor reconoció la clave (sin duplicado)' : ''}.`,
    reason: null,
    changes: [{ field: 'Estado documento', before: 'Aprobada', after: 'Emitida' }],
  });
  tx.audit({
    action: `fiscal.${r.state}`,
    entityType: 'invoice',
    entityId: invId,
    entityLabel: number,
    summary: `${r.responseCode} — ${r.responseMessage}${r.errors?.length ? ` (${r.errors.map((e) => e.code).join(', ')})` : ''}`,
    reason: null,
    changes: [{ field: 'Estado fiscal', before: 'Pendiente', after: fiscalStatus }],
  });
  if (r.state === 'rejected' || r.state === 'accepted_with_errors') {
    tx.notify({
      type: 'fiscal_rejected',
      title: r.state === 'rejected' ? 'Registro fiscal rechazado' : 'Registro aceptado con errores',
      body: 'Hay una excepción fiscal asignada que requiere subsanación.',
      recipientRoles: ['issuer', 'owner', 'admin'],
      recipientUserIds: [],
      link: `/facturas/${invId}?tab=fiscal`,
      dedupeKey: `fiscal:${opId}`,
    });
  }
  const outcomeKind = r.state === 'accepted' ? 'issued' : r.state === 'accepted_with_errors' ? 'needs_review' : 'rejected';
  return { kind: outcomeKind, number, message: r.responseMessage } as IssueOutcome;
}

/**
 * Issues an approved invoice through the simulated provider.
 * Idempotent: the operation key is stable per invoice; an uncertain previous attempt
 * blocks new attempts until reconciled (FIN-03, AC-FIN-01).
 */
export async function issueInvoice(id: ID): Promise<IssueOutcome> {
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.issue');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === id));
  if (inv.pendingOperationId) {
    throw new BusinessRuleError('Ya existe un intento de emisión con resultado incierto o en curso. Concilie la operación antes de volver a emitir (no se crearán duplicados).');
  }
  if (inv.documentStatus !== 'approved') throw new BusinessRuleError('Solo se pueden emitir facturas aprobadas.');

  const gate = financeIssueGate(ctx.company, ctx.finance, ctx.provider, ctx.today);
  if (isIssueBlocked(gate)) {
    transact(ctx.actor, (tx) =>
      tx.audit({ action: 'invoice.issue_blocked', entityType: 'invoice', entityId: id, entityLabel: invoiceLabel(inv), summary: 'Emisión bloqueada por la configuración de aplicabilidad.', reason: gate.filter((g) => g.severity === 'block').map((g) => `${g.message} [${g.owner}]`).join(' | '), changes: [] }),
    );
    throw new BusinessRuleError('La emisión está bloqueada para esta empresa.', gate.filter((g) => g.severity === 'block').map((g) => `${g.message} — Responsable: ${g.owner}`));
  }
  const v = validateForApproval(ctx, inv);
  if (!ok(v)) throw new BusinessRuleError('La factura ya no supera la validación (la configuración o el cliente han cambiado).', Object.values(v.errors));

  const operationKey = issueOperationKey(id);
  const scenario = ctx.provider!.nextScenario;

  // Phase 1 — reserve number and record the in-flight operation (synchronous: blocks double clicks).
  const { op, number } = transact(ctx.actor, (tx) => {
    const previous = tx.db.fiscalOperations.filter((o) => o.operationKey === operationKey).sort((a, b) => b.attempt - a.attempt)[0];
    let reserved = previous?.reservedNumber ?? null;
    if (!reserved) {
      const series = tx.get('series', inv.seriesId)!;
      reserved = series.prefix + String(series.nextNumber).padStart(series.padding, '0');
      tx.update('series', series.id, { nextNumber: series.nextNumber + 1 });
    }
    const op: FiscalOperation = {
      id: newId('fop'),
      companyId: ctx.company.id,
      invoiceId: id,
      type: 'issue',
      operationKey,
      attempt: (previous?.attempt ?? 0) + 1,
      requestedBy: ctx.user.id,
      requestedAt: nowISO(),
      completedAt: null,
      state: 'in_flight',
      reservedNumber: reserved,
      providerRequestId: null,
      providerInvoiceId: null,
      fiscalRecordId: null,
      responseCode: null,
      responseMessage: null,
      errors: [],
      reconciledBy: null,
      reconciledAt: null,
      simulated: true,
    };
    tx.insert('fiscalOperations', op);
    tx.update('invoices', id, { pendingOperationId: op.id, fiscalStatus: 'pending', updatedAt: nowISO() });
    // The simulation scenario applies to one request only.
    tx.updateWhere('providerConfigs', (p) => p.companyId === ctx.company.id, { nextScenario: 'accept' });
    tx.audit({ action: 'invoice.issue_attempt', entityType: 'invoice', entityId: id, entityLabel: reserved, summary: `Intento ${op.attempt} · clave ${operationKey} · número reservado ${reserved} · escenario simulado "${scenario}".`, reason: null, changes: [] });
    return { op, number: reserved };
  });

  // Phase 2 — call the provider.
  const original = originalOf(ctx, inv);
  const payload = buildFiscalPayload({ ...inv, customerSnapshot: snapshot(ctx.db.customers.find((c) => c.id === inv.customerId)!) }, ctx.company, ctx.db.taxCodes, number, ctx.today, original);
  try {
    const r = await submitRecord({ operationKey, number, issuerNif: ctx.company.nif, payload, scenario });
    return transact(ctx.actor, (tx) => applyIssueResult(getCtx(), tx, id, op.id, r, false));
  } catch (e) {
    if (e instanceof ProviderTimeoutError) {
      transact(ctx.actor, (tx) => {
        tx.update('fiscalOperations', op.id, { state: 'uncertain', responseMessage: e.message });
        tx.update('invoices', id, { fiscalStatus: 'needs_review', updatedAt: nowISO() });
        tx.audit({ action: 'fiscal.uncertain', entityType: 'invoice', entityId: id, entityLabel: number, summary: e.message, reason: null, changes: [] });
        tx.notify({ type: 'fiscal_uncertain', title: 'Emisión con resultado incierto', body: 'Concilie la operación antes de reintentar.', recipientRoles: ['issuer', 'owner', 'admin'], recipientUserIds: [], link: `/integracion-fiscal?op=${op.id}`, dedupeKey: `uncertain:${op.id}` });
      });
      return { kind: 'uncertain', message: e.message };
    }
    if (e instanceof ProviderUnavailableError) {
      transact(ctx.actor, (tx) => {
        tx.update('fiscalOperations', op.id, { state: 'failed', completedAt: nowISO(), responseMessage: e.message });
        tx.update('invoices', id, { fiscalStatus: 'not_submitted', pendingOperationId: null, updatedAt: nowISO() });
        tx.audit({ action: 'fiscal.failed', entityType: 'invoice', entityId: id, entityLabel: number, summary: `${e.message} El número ${number} queda reservado para el reintento con la misma clave.`, reason: null, changes: [] });
      });
      return { kind: 'failed', message: e.message };
    }
    throw e;
  }
}

/** Reconciles an uncertain or failed operation by querying the provider with its key. */
export async function reconcileOperation(opId: ID): Promise<IssueOutcome> {
  const ctx = getCtx();
  requirePerm(ctx, 'fiscal.reconcile');
  const op = ownRecord(ctx, ctx.db.fiscalOperations.find((o) => o.id === opId));
  if (op.state !== 'uncertain' && op.state !== 'in_flight') throw new BusinessRuleError('Esta operación ya tiene un resultado definitivo.');
  const res = await queryOperation(op.operationKey);
  if (res.found && res.processed) {
    return transact(ctx.actor, (tx) => {
      tx.audit({ action: 'fiscal.reconcile', entityType: 'invoice', entityId: op.invoiceId, entityLabel: res.number, summary: `Conciliación: el proveedor SÍ procesó la clave ${op.operationKey}.`, reason: null, changes: [] });
      return applyIssueResult(getCtx(), tx, op.invoiceId, op.id, res, true);
    });
  }
  transact(ctx.actor, (tx) => {
    tx.update('fiscalOperations', op.id, { state: 'not_processed', completedAt: nowISO(), reconciledBy: ctx.user.id, reconciledAt: nowISO(), responseMessage: 'Conciliación: el proveedor no tiene registro de esta clave. Puede reintentarse con la misma clave y número.' });
    tx.update('invoices', op.invoiceId, { pendingOperationId: null, fiscalStatus: 'not_submitted', updatedAt: nowISO() });
    tx.audit({ action: 'fiscal.reconcile', entityType: 'invoice', entityId: op.invoiceId, entityLabel: op.reservedNumber ?? op.invoiceId, summary: `Conciliación: el proveedor NO procesó la clave ${op.operationKey}. Reintento habilitado.`, reason: null, changes: [] });
  });
  return { kind: 'not_processed', message: 'El proveedor no procesó la solicitud. Ya puede volver a emitir: se reutilizarán la misma clave y el mismo número.' };
}

/** Resubmits a corrected record (subsanación) for a rejected / accepted-with-errors invoice. */
export async function resubmitFiscal(invoiceId: ID, note: string): Promise<IssueOutcome> {
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.issue');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === invoiceId));
  if (inv.fiscalStatus !== 'rejected' && inv.fiscalStatus !== 'needs_review') throw new BusinessRuleError('Solo se reenvían registros rechazados o aceptados con errores.');
  if (inv.pendingOperationId) throw new BusinessRuleError('Hay una operación pendiente de conciliación.');
  if (!note.trim()) throw new BusinessRuleError('Describa la corrección realizada antes del reenvío.');
  const attempts = ctx.db.fiscalOperations.filter((o) => o.invoiceId === invoiceId).length;
  const operationKey = `inv:${invoiceId}:correction:${attempts + 1}`;
  const scenario = ctx.provider!.nextScenario;
  const op = transact(ctx.actor, (tx) => {
    const op: FiscalOperation = {
      id: newId('fop'), companyId: ctx.company.id, invoiceId, type: 'issue', operationKey, attempt: attempts + 1, requestedBy: ctx.user.id, requestedAt: nowISO(), completedAt: null,
      state: 'in_flight', reservedNumber: inv.number, providerRequestId: null, providerInvoiceId: null, fiscalRecordId: null, responseCode: null, responseMessage: null, errors: [],
      reconciledBy: null, reconciledAt: null, simulated: true,
    };
    tx.insert('fiscalOperations', op);
    tx.update('invoices', invoiceId, { pendingOperationId: op.id, fiscalStatus: 'pending' });
    tx.updateWhere('providerConfigs', (p) => p.companyId === ctx.company.id, { nextScenario: 'accept' });
    tx.audit({ action: 'fiscal.resubmit', entityType: 'invoice', entityId: invoiceId, entityLabel: inv.number ?? invoiceId, summary: `Reenvío de registro corregido (subsanación) · clave ${operationKey}.`, reason: note, changes: [] });
    return op;
  });
  try {
    const r = await submitRecord({ operationKey, number: inv.number!, issuerNif: ctx.company.nif, payload: { subsanacion: 'S', nota: note }, scenario });
    return transact(ctx.actor, (tx) => applyIssueResult(getCtx(), tx, invoiceId, op.id, r, false));
  } catch (e) {
    const uncertain = e instanceof ProviderTimeoutError;
    transact(ctx.actor, (tx) => {
      tx.update('fiscalOperations', op.id, { state: uncertain ? 'uncertain' : 'failed', responseMessage: (e as Error).message, completedAt: uncertain ? null : nowISO() });
      tx.update('invoices', invoiceId, { fiscalStatus: uncertain ? 'needs_review' : inv.fiscalStatus, pendingOperationId: uncertain ? op.id : null });
      tx.audit({ action: uncertain ? 'fiscal.uncertain' : 'fiscal.failed', entityType: 'invoice', entityId: invoiceId, entityLabel: inv.number ?? invoiceId, summary: (e as Error).message, reason: null, changes: [] });
    });
    return uncertain ? { kind: 'uncertain', message: (e as Error).message } : { kind: 'failed', message: (e as Error).message };
  }
}

/**
 * Records a request to annul the fiscal record (registro de anulación). This is NOT a
 * cancellation of the invoice and is not automated: it requires the adviser's decision (U10).
 */
export async function requestFiscalAnnulment(invoiceId: ID, reason: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.issue');
  if (!reason.trim()) throw new BusinessRuleError('Indique el motivo.');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === invoiceId));
  if (inv.documentStatus !== 'issued' && inv.documentStatus !== 'rectified') throw new BusinessRuleError('Solo aplica a facturas emitidas.');
  transact(ctx.actor, (tx) => {
    tx.audit({ action: 'invoice.annulment_request', entityType: 'invoice', entityId: invoiceId, entityLabel: inv.number ?? invoiceId, summary: `Solicitud de anulación del registro fiscal remitida para revisión profesional (${ctx.finance.responsibleAdviser}). No se ha enviado nada al proveedor.`, reason, changes: [] });
    tx.notify({ type: 'fiscal_rejected', title: 'Solicitud de anulación de registro pendiente de revisión', body: 'Requiere decisión del asesor fiscal.', recipientRoles: ['owner', 'gestoria'], recipientUserIds: [], link: `/facturas/${invoiceId}?tab=fiscal`, dedupeKey: `annul:${invoiceId}:${Date.now()}` });
  });
}

// ─────────────────────────────── Delivery ───────────────────────────────

export async function sendInvoice(invoiceId: ID, channel: 'email' | 'manual', recipient: string) {
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.deliver');
  const inv = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === invoiceId));
  if (inv.documentStatus !== 'issued' && inv.documentStatus !== 'rectified') throw new BusinessRuleError('Solo se pueden enviar facturas emitidas.');
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipient)) throw new BusinessRuleError('Correo del destinatario no válido.');
  transact(ctx.actor, (tx) => {
    tx.insert('deliveries', { id: newId('del'), companyId: ctx.company.id, invoiceId, channel, recipient, status: 'sent', detail: channel === 'email' ? 'Enviada por correo con PDF (simulado).' : 'Entrega manual registrada (papel o en mano).', at: nowISO(), by: ctx.user.id, simulated: channel === 'email' });
    tx.update('invoices', invoiceId, { exchangeStatus: channel === 'manual' ? 'delivered' : 'sent' });
    tx.audit({ action: 'delivery.send', entityType: 'invoice', entityId: invoiceId, entityLabel: inv.number ?? invoiceId, summary: `Envío por ${channel === 'email' ? 'correo' : 'entrega manual'} a ${recipient}.`, reason: null, changes: [] });
  });
  if (channel === 'manual') return { status: 'delivered' as const, detail: 'Entrega manual registrada.' };
  const r = await sendEmail(recipient, `Factura ${inv.number}`);
  transact(ctx.actor, (tx) => {
    tx.insert('deliveries', { id: newId('del'), companyId: ctx.company.id, invoiceId, channel, recipient, status: r.status, detail: r.detail, at: nowISO(), by: 'system', simulated: true });
    tx.update('invoices', invoiceId, { exchangeStatus: r.status === 'delivered' ? 'delivered' : 'delivery_failed' });
    tx.audit({ action: 'delivery.result', entityType: 'invoice', entityId: invoiceId, entityLabel: inv.number ?? invoiceId, summary: r.detail, reason: null, changes: [] });
    if (r.status === 'failed') tx.notify({ type: 'delivery_failed', title: 'Error al entregar una factura', body: 'Revise el correo del cliente y reintente.', recipientRoles: ['admin', 'owner'], recipientUserIds: [], link: `/facturas/${invoiceId}?tab=envios`, dedupeKey: `delivery:${invoiceId}:${Date.now()}` });
  });
  return r;
}

// ─────────────────────────────── Rectification (FIN-05) ───────────────────────────────

export interface RectificationInput {
  reasonCode: RectificationReasonCode;
  method: RectificationMethod;
  reasonText: string;
  /** Corrected lines (full corrected invoice content). */
  correctedLines: InvoiceLine[];
}

/** Builds the rectifying lines: full corrected content (substitution) or signed differences. */
export function buildRectifyingLines(original: InvoiceLine[], corrected: InvoiceLine[], method: RectificationMethod): InvoiceLine[] {
  if (method === 'substitution') return corrected.map((l) => ({ ...l, id: newId('lin') }));
  const out: InvoiceLine[] = [];
  const same = (a: InvoiceLine, b: InvoiceLine) => a.description === b.description && a.quantity === b.quantity && a.unitPriceCents === b.unitPriceCents && a.discountPct === b.discountPct && a.taxCode === b.taxCode;
  for (const o of original) {
    const c = corrected.find((x) => x.id === o.id);
    if (c && same(o, c)) continue;
    out.push({ ...o, id: newId('lin'), description: `Anula: ${o.description}`, quantity: -o.quantity });
    if (c) out.push({ ...c, id: newId('lin'), description: `Corrige: ${c.description}` });
  }
  for (const c of corrected) if (!original.some((o) => o.id === c.id)) out.push({ ...c, id: newId('lin'), description: `Añade: ${c.description}` });
  return out;
}

export async function createRectification(originalId: ID, input: RectificationInput): Promise<Invoice> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'invoices.rectify_request');
  const original = ownRecord(ctx, ctx.db.invoices.find((i) => i.id === originalId));
  if (original.kind !== 'ordinary') throw new BusinessRuleError('Para corregir una rectificativa, rectifique la factura original.');
  if (original.documentStatus !== 'issued' && original.documentStatus !== 'rectified') throw new BusinessRuleError('Solo se pueden rectificar facturas emitidas. Un borrador se edita directamente.');
  if (!input.reasonText.trim()) throw new BusinessRuleError('El motivo de la rectificación es obligatorio.');
  const pendingRect = ctx.db.invoices.find((i) => i.rectification?.originalInvoiceId === originalId && (i.documentStatus === 'draft' || i.documentStatus === 'approved'));
  if (pendingRect) throw new BusinessRuleError('Ya existe una rectificativa en preparación para esta factura. Complétela o elimínela antes de crear otra.');
  const series = ctx.db.series.find((s) => s.companyId === ctx.company.id && s.kind === 'rectifying' && s.active);
  if (!series) throw new BusinessRuleError('No hay una serie de rectificativas activa. Configúrela antes de rectificar (RD 1619/2012, art. 6.1.a).');
  const lines = buildRectifyingLines(original.lines, input.correctedLines, input.method);
  if (lines.length === 0) throw new BusinessRuleError('Las líneas corregidas son idénticas a las originales: no hay nada que rectificar.');
  const totals = computeTotals(lines, ctx.db.taxCodes, original.totals.withholdingPct);
  return transact(ctx.actor, (tx) => {
    const inv: Invoice = {
      ...original,
      id: newId('inv'),
      kind: 'rectifying',
      seriesId: series.id,
      number: null,
      customerSnapshot: null,
      issuerSnapshot: null,
      issueDate: null,
      operationDate: original.operationDate ?? original.issueDate,
      dueDate: totals.payableCents < 0 ? ctx.today : addDays(ctx.today, 30),
      lines,
      totals,
      notes: `Rectifica la factura ${original.number} de ${original.issueDate?.split('-').reverse().join('/')}.`,
      paymentTerms: totals.payableCents < 0 ? 'Abono / compensación sobre la factura original' : original.paymentTerms,
      documentStatus: 'draft',
      review: { state: 'none', by: null, at: null, comment: '' },
      approvedBy: null,
      approvedAt: null,
      issuedBy: null,
      issuedAt: null,
      fiscalStatus: 'not_submitted',
      providerInvoiceId: null,
      fiscalRecordId: null,
      fiscalHash: null,
      pendingOperationId: null,
      exchangeStatus: 'not_sent',
      rectification: { originalInvoiceId: originalId, reasonCode: input.reasonCode, method: input.method, reasonText: input.reasonText, requestedBy: ctx.user.id, requestedAt: nowISO() },
      rectifiedByIds: [],
      createdBy: ctx.user.id,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      version: 1,
    };
    tx.insert('invoices', inv);
    tx.audit({ action: 'invoice.rectify_request', entityType: 'invoice', entityId: inv.id, entityLabel: 'Rectificativa (borrador)', summary: `Rectificativa ${input.reasonCode} por ${input.method === 'substitution' ? 'sustitución' : 'diferencias'} de ${original.number}: ${formatEURRecord(totals.totalCents)}.`, reason: input.reasonText, changes: [] });
    tx.audit({ action: 'invoice.rectify_request', entityType: 'invoice', entityId: original.id, entityLabel: original.number ?? original.id, summary: 'Rectificativa en preparación. El original no se modifica.', reason: input.reasonText, changes: [] });
    return inv;
  });
}

/** Simple line factory for forms. */
export function newLine(taxCode: string): InvoiceLine {
  return { id: newId('lin'), description: '', quantity: 1, unitPriceCents: 0, discountPct: 0, taxCode };
}

export { lineAmounts };
