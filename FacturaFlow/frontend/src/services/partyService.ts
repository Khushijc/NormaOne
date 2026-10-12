/** Customers and suppliers (future API: /companies/:id/customers, /suppliers). FIN-02, PLT-02. */
import { nowISO } from '../domain/dates';
import { newId } from '../domain/ids';
import { normaliseNif } from '../domain/nif';
import { BusinessRuleError } from '../domain/permissions';
import type { AuditChange, Customer, ID, Supplier } from '../domain/types';
import { ok, validateCustomer, validateSupplier } from '../domain/validation';
import { transact } from '../store/db';
import { getCtx, latency, ownRecord, requirePerm } from './context';

export type CustomerInput = Omit<Customer, 'id' | 'companyId' | 'archived' | 'archivedAt' | 'archivedReason' | 'createdBy' | 'createdAt' | 'updatedAt'>;
export type SupplierInput = Omit<Supplier, 'id' | 'companyId' | 'archived' | 'archivedAt' | 'archivedReason' | 'createdBy' | 'createdAt' | 'updatedAt'>;

const TRACKED: Record<string, string> = {
  legalName: 'Razón social',
  tradeName: 'Nombre comercial',
  kind: 'Tipo',
  idType: 'Tipo de identificación',
  idNumber: 'Identificación',
  email: 'Correo',
  phone: 'Teléfono',
  paymentTermsDays: 'Plazo de pago',
  deliveryChannel: 'Canal de envío',
  defaultTaxCode: 'Tratamiento por defecto',
  defaultCategory: 'Categoría por defecto',
  ibanMasked: 'IBAN',
  contactName: 'Contacto',
  notes: 'Notas',
};

function diff(before: Record<string, unknown>, after: Record<string, unknown>): AuditChange[] {
  const out: AuditChange[] = [];
  for (const [k, label] of Object.entries(TRACKED)) {
    if (k in after && JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push({ field: label, before: String(before[k] ?? ''), after: String(after[k] ?? '') });
  }
  const ba = JSON.stringify(before.address), aa = JSON.stringify(after.address);
  if (aa && ba !== aa) out.push({ field: 'Domicilio', before: Object.values((before.address as object) ?? {}).join(', '), after: Object.values((after.address as object) ?? {}).join(', ') });
  return out;
}

function normalise<T extends { idType: string; idNumber: string; legalName: string; email: string }>(input: T): T {
  return { ...input, idNumber: input.idType === 'NONE' ? '' : normaliseNif(input.idNumber), legalName: input.legalName.trim(), email: input.email.trim().toLowerCase() };
}

export async function saveCustomer(id: ID | null, raw: CustomerInput, acknowledgeWarnings: boolean): Promise<Customer> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'customers.manage');
  const input = normalise(raw);
  const existing = ctx.db.customers.filter((c) => c.companyId === ctx.company.id);
  const v = validateCustomer(input, existing, id ?? undefined);
  if (!ok(v)) throw new BusinessRuleError('Revise los campos marcados.', Object.values(v.errors));
  if (v.warnings.length && !acknowledgeWarnings) throw new BusinessRuleError('Confirme los avisos antes de guardar.', v.warnings);
  return transact(ctx.actor, (tx) => {
    if (id) {
      const before = ownRecord(ctx, tx.get('customers', id));
      const changes = diff(before as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>);
      const updated = tx.update('customers', id, { ...input, updatedAt: nowISO() });
      if (changes.length) tx.audit({ action: 'customer.update', entityType: 'customer', entityId: id, entityLabel: updated.legalName, summary: `${changes.length} campo(s) modificado(s). Las facturas emitidas conservan los datos del momento de emisión.`, changes, reason: v.warnings.join(' | ') || null });
      return updated;
    }
    const c: Customer = { ...input, id: newId('cus'), companyId: ctx.company.id, archived: false, archivedAt: null, archivedReason: null, createdBy: ctx.user.id, createdAt: nowISO(), updatedAt: nowISO() };
    tx.insert('customers', c);
    tx.audit({ action: 'customer.create', entityType: 'customer', entityId: c.id, entityLabel: c.legalName, summary: `Alta de cliente (${c.idNumber || 'sin identificación'}).`, changes: [], reason: v.warnings.join(' | ') || null });
    return c;
  });
}

export async function saveSupplier(id: ID | null, raw: SupplierInput, acknowledgeWarnings: boolean): Promise<Supplier> {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, 'suppliers.manage');
  const input = normalise(raw);
  const existing = ctx.db.suppliers.filter((c) => c.companyId === ctx.company.id);
  const v = validateSupplier(input, existing, id ?? undefined);
  if (!ok(v)) throw new BusinessRuleError('Revise los campos marcados.', Object.values(v.errors));
  if (v.warnings.length && !acknowledgeWarnings) throw new BusinessRuleError('Confirme los avisos antes de guardar.', v.warnings);
  return transact(ctx.actor, (tx) => {
    if (id) {
      const before = ownRecord(ctx, tx.get('suppliers', id));
      const changes = diff(before as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>);
      const updated = tx.update('suppliers', id, { ...input, updatedAt: nowISO() });
      if (changes.length) tx.audit({ action: 'supplier.update', entityType: 'supplier', entityId: id, entityLabel: updated.legalName, summary: `${changes.length} campo(s) modificado(s).`, changes, reason: null });
      return updated;
    }
    const s: Supplier = { ...input, id: newId('sup'), companyId: ctx.company.id, archived: false, archivedAt: null, archivedReason: null, createdBy: ctx.user.id, createdAt: nowISO(), updatedAt: nowISO() };
    tx.insert('suppliers', s);
    tx.audit({ action: 'supplier.create', entityType: 'supplier', entityId: s.id, entityLabel: s.legalName, summary: `Alta de proveedor (${s.idNumber || 'sin identificación'}).`, changes: [], reason: v.warnings.join(' | ') || null });
    return s;
  });
}

/** Archive instead of delete: parties referenced by financial records must be preserved (PLT-10). */
export async function setPartyArchived(kind: 'customer' | 'supplier', id: ID, archived: boolean, reason: string) {
  await latency();
  const ctx = getCtx();
  requirePerm(ctx, kind === 'customer' ? 'customers.manage' : 'suppliers.manage');
  if (archived && !reason.trim()) throw new BusinessRuleError('Indique el motivo del archivo.');
  const key = kind === 'customer' ? 'customers' : 'suppliers';
  transact(ctx.actor, (tx) => {
    const p = ownRecord(ctx, tx.get(key, id));
    if (archived && kind === 'customer') {
      const open = tx.db.invoices.filter((i) => i.customerId === id && (i.documentStatus === 'draft' || i.documentStatus === 'approved'));
      if (open.length) throw new BusinessRuleError(`El cliente tiene ${open.length} factura(s) en borrador o aprobadas. Emítalas o elimínelas antes de archivar.`);
    }
    tx.update(key, id, { archived, archivedAt: archived ? nowISO() : null, archivedReason: archived ? reason : null, updatedAt: nowISO() });
    tx.audit({
      action: `${kind}.${archived ? 'archive' : 'restore'}`,
      entityType: kind,
      entityId: id,
      entityLabel: p.legalName,
      summary: archived ? 'Archivado. Sus documentos se conservan y siguen siendo consultables.' : 'Reactivado.',
      reason: reason || null,
      changes: [{ field: 'Archivado', before: archived ? 'No' : 'Sí', after: archived ? 'Sí' : 'No' }],
    });
  });
}
