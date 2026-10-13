/**
 * Suppliers & Data Processors Service (Art. 28 RGPD).
 */
import { NotFoundError } from '../domain/permissions';
import { newId } from '../domain/ids';
import { nowInstant } from '../domain/time';
import type { AgreementStatus, Supplier, SupplierAssessmentStatus } from '../domain/types';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export interface SupplierInput {
  name: string;
  serviceDescription: string;
  personalDataAccessed: string[];
  assessedRole: SupplierAssessmentStatus;
  assessmentRationale: string;
  linkedRopaIds: string[];
  agreementStatus: AgreementStatus;
  agreementVersionRef?: string;
  agreementSignedDate?: string;
  subprocessorsListed: boolean;
  subprocessorsList?: string;
  internationalTransfer: boolean;
  transferDestinationCountry?: string;
  transferSafeguard?: 'scc' | 'adequacy' | 'bcr' | 'none';
  securityReviewNotes: string;
  nextReviewDate: string;
}

export function createSupplier(input: SupplierInput): Supplier {
  const ctx = getServiceCtx();
  ctx.assert('suppliers.manage', 'No tiene permisos para dar de alta proveedores.');

  const seq = ctx.db.suppliers.filter((s) => s.companyId === ctx.company.id).length + 1;
  const reference = `PROV-${String(seq).padStart(3, '0')}`;

  const supplier: Supplier = {
    ...input,
    id: newId('prv'),
    companyId: ctx.company.id,
    reference,
    assessedBy: ctx.user.id,
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('suppliers', supplier);
      tx.audit({
        action: 'supplier.created',
        entityType: 'Supplier',
        entityId: supplier.id,
        entityLabel: `${supplier.reference} · ${supplier.name}`,
        summary: `Registrado proveedor ${supplier.name} (${supplier.reference}). Rol evaluado: ${supplier.assessedRole}.`,
      });
      return supplier;
    }
  );
}

export function updateSupplierAssessment(
  id: string,
  patch: Partial<SupplierInput>
): Supplier {
  const ctx = getServiceCtx();
  ctx.assert('suppliers.manage', 'No tiene permisos para modificar la evaluación del proveedor.');

  const existing = ctx.db.suppliers.find((s) => s.id === id && s.companyId === ctx.company.id);
  if (!existing) throw new NotFoundError('Proveedor no encontrado.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('suppliers', id, {
        ...patch,
        assessedBy: ctx.user.id,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'supplier.updated',
        entityType: 'Supplier',
        entityId: id,
        entityLabel: `${existing.reference} · ${existing.name}`,
        summary: `Actualizada evaluación de proveedor ${existing.reference}. Rol: ${updated.assessedRole}.`,
      });
      return updated;
    }
  );
}
