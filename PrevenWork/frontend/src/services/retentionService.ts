/**
 * Data Retention & Deletion Queue Service.
 */
import { BusinessRuleError, NotFoundError } from '../domain/permissions';
import { newId } from '../domain/ids';
import { nowInstant } from '../domain/time';
import type { DeletionReviewItem, RetentionPolicy } from '../domain/types';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export function createRetentionPolicy(
  categoryName: string,
  purpose: string,
  system: string,
  triggerEvent: string,
  periodMonths: number,
  legalJustification: string,
  nextReviewDate: string
): RetentionPolicy {
  const ctx = getServiceCtx();
  ctx.assert('retention.manage', 'No tiene permisos para crear políticas de conservación.');

  const seq = ctx.db.retentionPolicies.filter((p) => p.companyId === ctx.company.id).length + 1;
  const code = `RET-${String(seq).padStart(3, '0')}`;

  const policy: RetentionPolicy = {
    id: newId('ret'),
    companyId: ctx.company.id,
    code,
    categoryName,
    purpose,
    system,
    triggerEvent,
    periodMonths,
    legalJustification,
    policyOwnerId: ctx.user.id,
    activeLegalHold: false,
    nextReviewDate,
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('retentionPolicies', policy);
      tx.audit({
        action: 'retention.policy_created',
        entityType: 'RetentionPolicy',
        entityId: policy.id,
        entityLabel: `${policy.code} · ${policy.categoryName}`,
        summary: `Creada política de conservación ${policy.code} (${policy.periodMonths} meses).`,
      });
      return policy;
    }
  );
}

export function setLegalHold(policyId: string, hold: boolean, reason?: string): RetentionPolicy {
  const ctx = getServiceCtx();
  ctx.assert('retention.manage', 'No tiene permisos para modificar bloqueos legales.');

  const policy = ctx.db.retentionPolicies.find((p) => p.id === policyId && p.companyId === ctx.company.id);
  if (!policy) throw new NotFoundError('Política de conservación no encontrada.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('retentionPolicies', policyId, {
        activeLegalHold: hold,
        legalHoldReason: hold ? reason : undefined,
      });
      tx.audit({
        action: hold ? 'retention.legal_hold_set' : 'retention.legal_hold_released',
        entityType: 'RetentionPolicy',
        entityId: policyId,
        entityLabel: policy.code,
        summary: hold
          ? `Bloqueo legal activado en ${policy.code}: ${reason}`
          : `Bloqueo legal retirado en ${policy.code}.`,
      });
      return updated;
    }
  );
}

export function processDeletionReview(
  itemId: string,
  action: 'erase' | 'block_retain',
  decisionNotes: string
): DeletionReviewItem {
  const ctx = getServiceCtx();
  ctx.assert('retention.erase', 'Solo el Responsable de Privacidad puede autorizar borrados o bloqueos.');

  const item = ctx.db.deletionReviews.find((i) => i.id === itemId && i.companyId === ctx.company.id);
  if (!item) throw new NotFoundError('Elemento en cola de borrado no encontrado.');

  const policy = ctx.db.retentionPolicies.find((p) => p.id === item.policyId);
  if (policy?.activeLegalHold && action === 'erase') {
    throw new BusinessRuleError('No se puede ejecutar la supresión: existe un bloqueo legal activo en esta categoría.');
  }

  const tombstoneRef = action === 'erase' ? `TMB-${newId('del').slice(4).toUpperCase()}` : undefined;

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('deletionReviews', itemId, {
        status: action === 'erase' ? 'approved_erased' : 'rejected_retained',
        decidedBy: ctx.user.id,
        decidedAt: nowInstant(),
        decisionNotes,
        tombstoneRef,
      });
      tx.audit({
        action: action === 'erase' ? 'retention.erased' : 'retention.retained',
        entityType: 'DeletionReviewItem',
        entityId: itemId,
        entityLabel: item.recordIdentifier,
        summary: action === 'erase'
          ? `Supresión ejecutada para ${item.recordIdentifier} (Tombstone: ${tombstoneRef}). Nota: ${decisionNotes}`
          : `Conservación motivada para ${item.recordIdentifier}. Nota: ${decisionNotes}`,
      });
      return updated;
    }
  );
}
