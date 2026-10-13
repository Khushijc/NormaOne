/**
 * Records of Processing Activities (RoPA / RAT) Service (Art. 30 RGPD).
 */
import { NotFoundError } from '../domain/permissions';
import { newId } from '../domain/ids';
import { nowInstant } from '../domain/time';
import type { GdprRole, LegalBasis, ProcessingActivity, RopaStatus } from '../domain/types';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export interface RopaInput {
  name: string;
  purpose: string;
  dataSubjects: string[];
  dataCategories: string[];
  specialCategories: boolean;
  specialCategoryNotes?: string;
  systems: string[];
  recipients: string[];
  internationalTransfers: boolean;
  transferSafeguards?: string;
  role: GdprRole;
  legalBasis: LegalBasis;
  legalBasisReviewStatus: 'confirmed' | 'pending_review' | 'expert_justification_needed';
  retentionRule: string;
  securityMeasures: string;
  businessOwner: string;
  privacyReviewerId: string;
  nextReviewDate: string;
  specialistReviewFlag: boolean;
  dpiaRequired: boolean;
  status?: RopaStatus;
}

export function detectMissingFields(input: RopaInput): string[] {
  const warnings: string[] = [];
  if (!input.purpose.trim()) warnings.push('Falta especificar la finalidad concreta del tratamiento.');
  if (!input.dataSubjects.length) warnings.push('No se han identificado las categorías de interesados.');
  if (!input.dataCategories.length) warnings.push('No se han detallado las categorías de datos personales tratados.');
  if (input.specialCategories && !input.specialCategoryNotes?.trim()) {
    warnings.push('Trata datos de categoría especial (Art. 9) pero no se indica la excepción legal aplicable.');
  }
  if (!input.retentionRule.trim()) warnings.push('No se ha definido el plazo o criterio de conservación.');
  if (!input.securityMeasures.trim()) warnings.push('Faltan medidas técnicas y organizativas de seguridad mínimas.');
  if (input.internationalTransfers && !input.transferSafeguards?.trim()) {
    warnings.push('Existen transferencias internacionales pero faltan las garantías adecuadas (Art. 46 RGPD).');
  }
  if (input.legalBasisReviewStatus !== 'confirmed') {
    warnings.push('La base jurídica está pendiente de confirmación formal por un asesor cualificado.');
  }
  return warnings;
}

export function createProcessingActivity(input: RopaInput): ProcessingActivity {
  const ctx = getServiceCtx();
  ctx.assert('ropa.manage', 'No tiene permisos para crear actividades de tratamiento.');

  const warnings = detectMissingFields(input);
  const codeSeq = ctx.db.ropaActivities.filter((r) => r.companyId === ctx.company.id).length + 1;
  const code = `RAT-${String(codeSeq).padStart(3, '0')}`;

  const activity: ProcessingActivity = {
    ...input,
    id: newId('rat'),
    companyId: ctx.company.id,
    code,
    status: input.status ?? (warnings.length > 0 ? 'draft' : 'in_review'),
    missingFieldsWarning: warnings.length > 0 ? warnings : undefined,
    lastReviewDate: null,
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('ropaActivities', activity);
      tx.audit({
        action: 'ropa.created',
        entityType: 'ProcessingActivity',
        entityId: activity.id,
        entityLabel: `${activity.code} · ${activity.name}`,
        summary: `Creada actividad de tratamiento ${activity.code} (${activity.name}).`,
      });
      return activity;
    }
  );
}

export function updateProcessingActivity(id: string, input: Partial<RopaInput>): ProcessingActivity {
  const ctx = getServiceCtx();
  ctx.assert('ropa.manage', 'No tiene permisos para modificar actividades de tratamiento.');

  const existing = ctx.db.ropaActivities.find((r) => r.id === id && r.companyId === ctx.company.id);
  if (!existing) throw new NotFoundError('Actividad de tratamiento no encontrada.');

  const mergedInput: RopaInput = {
    name: input.name ?? existing.name,
    purpose: input.purpose ?? existing.purpose,
    dataSubjects: input.dataSubjects ?? existing.dataSubjects,
    dataCategories: input.dataCategories ?? existing.dataCategories,
    specialCategories: input.specialCategories ?? existing.specialCategories,
    specialCategoryNotes: input.specialCategoryNotes ?? existing.specialCategoryNotes,
    systems: input.systems ?? existing.systems,
    recipients: input.recipients ?? existing.recipients,
    internationalTransfers: input.internationalTransfers ?? existing.internationalTransfers,
    transferSafeguards: input.transferSafeguards ?? existing.transferSafeguards,
    role: input.role ?? existing.role,
    legalBasis: input.legalBasis ?? existing.legalBasis,
    legalBasisReviewStatus: input.legalBasisReviewStatus ?? existing.legalBasisReviewStatus,
    retentionRule: input.retentionRule ?? existing.retentionRule,
    securityMeasures: input.securityMeasures ?? existing.securityMeasures,
    businessOwner: input.businessOwner ?? existing.businessOwner,
    privacyReviewerId: input.privacyReviewerId ?? existing.privacyReviewerId,
    nextReviewDate: input.nextReviewDate ?? existing.nextReviewDate,
    specialistReviewFlag: input.specialistReviewFlag ?? existing.specialistReviewFlag,
    dpiaRequired: input.dpiaRequired ?? existing.dpiaRequired,
    status: input.status ?? existing.status,
  };

  const warnings = detectMissingFields(mergedInput);

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('ropaActivities', id, {
        ...mergedInput,
        missingFieldsWarning: warnings.length > 0 ? warnings : undefined,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'ropa.updated',
        entityType: 'ProcessingActivity',
        entityId: id,
        entityLabel: `${existing.code} · ${updated.name}`,
        summary: `Actualizada actividad de tratamiento ${existing.code}.`,
      });
      return updated;
    }
  );
}

export function reviewProcessingActivity(
  id: string,
  decision: 'approve' | 'require_changes' | 'request_specialist',
  note: string
): ProcessingActivity {
  const ctx = getServiceCtx();
  ctx.assert('ropa.review', 'No tiene permisos para revisar o aprobar actividades de tratamiento.');

  const existing = ctx.db.ropaActivities.find((r) => r.id === id && r.companyId === ctx.company.id);
  if (!existing) throw new NotFoundError('Actividad de tratamiento no encontrada.');

  let nextStatus: RopaStatus = existing.status;
  let flagSpecialist = existing.specialistReviewFlag;

  if (decision === 'approve') {
    nextStatus = 'approved';
  } else if (decision === 'require_changes') {
    nextStatus = 'changes_required';
  } else if (decision === 'request_specialist') {
    flagSpecialist = true;
    nextStatus = 'in_review';
  }

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('ropaActivities', id, {
        status: nextStatus,
        specialistReviewFlag: flagSpecialist,
        lastReviewDate: ctx.today,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: `ropa.${decision}`,
        entityType: 'ProcessingActivity',
        entityId: id,
        entityLabel: `${existing.code} · ${existing.name}`,
        summary: `Revisión formal de ${existing.code}: ${decision}. Nota: ${note}`,
      });
      return updated;
    }
  );
}

export function updateRopaStatus(id: string, status: RopaStatus): ProcessingActivity {
  if (status === 'approved') {
    return reviewProcessingActivity(id, 'approve', 'Aprobado formalmente');
  } else if (status === 'changes_required') {
    return reviewProcessingActivity(id, 'require_changes', 'Subsanaciones requeridas');
  }
  return updateProcessingActivity(id, { status });
}

export function requestSpecialistReview(id: string, note: string): ProcessingActivity {
  return reviewProcessingActivity(id, 'request_specialist', note);
}

export const createRopaActivity = (input: any): ProcessingActivity => {
  return createProcessingActivity({
    name: input.name ?? '',
    purpose: input.purpose ?? '',
    dataSubjects: input.dataSubjects ?? input.dataSubjectCategories ?? [],
    dataCategories: input.dataCategories ?? [],
    specialCategories: input.specialCategories ?? input.specialCategoryInvolved ?? false,
    specialCategoryNotes: input.specialCategoryNotes,
    systems: input.systems ?? input.storageLocations ?? [],
    recipients: input.recipients ?? [],
    internationalTransfers: input.internationalTransfers ?? false,
    transferSafeguards: input.transferSafeguards,
    role: input.role ?? input.roleAssessment ?? 'controller',
    legalBasis: input.legalBasis ?? 'contract',
    legalBasisReviewStatus: input.legalBasisReviewStatus ?? 'pending_review',
    retentionRule: input.retentionRule ?? '',
    securityMeasures: input.securityMeasures ?? (Array.isArray(input.securitySafeguards) ? input.securitySafeguards.join(', ') : input.securitySafeguards ?? ''),
    businessOwner: input.businessOwner ?? input.businessOwnerId ?? '',
    privacyReviewerId: input.privacyReviewerId ?? '',
    nextReviewDate: input.nextReviewDate ?? '2027-01-01',
    specialistReviewFlag: input.specialistReviewFlag ?? false,
    dpiaRequired: input.dpiaRequired ?? false,
    status: input.status,
  });
};

export function checkRopaCompleteness(ropa: ProcessingActivity): { isComplete: boolean; missingFields: string[] } {
  const missing = ropa.missingFieldsWarning ?? [];
  return {
    isComplete: missing.length === 0,
    missingFields: missing,
  };
}

