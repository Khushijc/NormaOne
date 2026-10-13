/**
 * Data-Subject Rights Requests Service (Art. 12-22 RGPD).
 */
import { BusinessRuleError, NotFoundError } from '../domain/permissions';
import { newId } from '../domain/ids';
import { addCalendarMonths, localDate, nowInstant } from '../domain/time';
import type { IntakeChannel, RightsRequest, RightStatus, RightType } from '../domain/types';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export interface RightsRequestInput {
  rightType: RightType;
  intakeChannel: IntakeChannel;
  receiptTimestamp?: string;
  requesterName: string;
  requesterEmail: string;
  requesterDocNumber?: string;
  description: string;
  assignedOwnerId: string;
  affectedSystems: string[];
}

export function registerRightsRequest(input: RightsRequestInput): RightsRequest {
  const ctx = getServiceCtx();
  ctx.assert('rights.manage', 'No tiene permisos para registrar solicitudes de derechos.');

  const receiptTime = input.receiptTimestamp ?? nowInstant();
  const receiptCalDate = localDate(receiptTime);
  // Calculate standard 1-month calendar deadline
  const standardDeadline = addCalendarMonths(receiptCalDate, 1);

  const seq = ctx.db.rightsRequests.filter((r) => r.companyId === ctx.company.id).length + 1;
  const reference = `SOL-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`;

  // Check for potential retention conflict on erasure
  const isErasure = input.rightType === 'erasure';
  const touchesAccounting = input.affectedSystems.some((s) =>
    ['ERP Facturación', 'Contabilidad', 'Gestión Laboral', 'Bancos'].includes(s)
  );

  const req: RightsRequest = {
    id: newId('sol'),
    companyId: ctx.company.id,
    reference,
    rightType: input.rightType,
    intakeChannel: input.intakeChannel,
    receiptTimestamp: receiptTime,
    requesterName: input.requesterName,
    requesterEmail: input.requesterEmail,
    requesterDocNumber: input.requesterDocNumber,
    description: input.description,
    identityCheck: {
      required: true,
      verified: false,
      verifiedAt: null,
      method: null,
      rationale: null,
    },
    assignedOwnerId: input.assignedOwnerId,
    affectedSystems: input.affectedSystems,
    standardDeadline,
    extension: null,
    effectiveDeadline: standardDeadline,
    retentionConflict: {
      conflictDetected: isErasure && touchesAccounting,
      conflictingRules: isErasure && touchesAccounting ? ['Obligación fiscal (4 años - LGT)', 'Código de Comercio Art. 30 (6 años)'] : [],
      blockedDataOnly: false,
      reviewerDecision: 'pending',
      rationale: '',
      decidedBy: null,
      decidedAt: null,
    },
    status: 'received',
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('rightsRequests', req);
      tx.audit({
        action: 'rights.registered',
        entityType: 'RightsRequest',
        entityId: req.id,
        entityLabel: `${req.reference} · ${req.requesterName}`,
        summary: `Registrada solicitud de ${req.rightType} (${req.reference}). Plazo de respuesta: ${req.standardDeadline}.`,
      });
      tx.notify({
        recipientUserIds: [req.assignedOwnerId],
        type: 'deadline',
        title: `Nueva solicitud de derecho: ${req.reference}`,
        body: `Asignada solicitud de ${req.rightType} de ${req.requesterName}. Plazo: ${req.standardDeadline}.`,
        link: `/derechos/${req.id}`,
        dedupeKey: `rights_new_${req.id}`,
      });
      return req;
    }
  );
}

export function reassignRightsRequest(
  id: string,
  newOwnerId: string,
  reason?: string
): RightsRequest {
  const ctx = getServiceCtx();
  ctx.assert('rights.manage', 'No tiene permisos para reasignar solicitudes.');

  const req = ctx.db.rightsRequests.find((r) => r.id === id && r.companyId === ctx.company.id);
  if (!req) throw new NotFoundError('Solicitud de derechos no encontrada.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      // Note: Reassigning NEVER modifies receiptTimestamp, standardDeadline, or effectiveDeadline!
      const updated = tx.update('rightsRequests', id, {
        assignedOwnerId: newOwnerId,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'rights.reassigned',
        entityType: 'RightsRequest',
        entityId: id,
        entityLabel: req.reference,
        summary: `Reasignada solicitud ${req.reference} al usuario ${newOwnerId}.${reason ? ` Motivo: ${reason}.` : ''} El plazo legal (${req.effectiveDeadline}) se mantiene inalterado.`,
      });
      return updated;
    }
  );
}

export function verifyIdentity(
  id: string,
  arg2: boolean | string,
  arg3?: string,
  arg4?: string
): RightsRequest {
  const ctx = getServiceCtx();
  ctx.assert('rights.manage', 'No tiene permisos para validar la identidad.');

  const req = ctx.db.rightsRequests.find((r) => r.id === id && r.companyId === ctx.company.id);
  if (!req) throw new NotFoundError('Solicitud no encontrada.');

  const verified = typeof arg2 === 'boolean' ? arg2 : true;
  const rationale = typeof arg2 === 'string' ? arg2 : arg4 ?? 'Identidad verificada';
  const method = typeof arg2 === 'string' ? arg3 ?? 'Certificado digital / DNI' : arg3 ?? 'DNI cotejado';

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('rightsRequests', id, {
        identityCheck: {
          required: true,
          verified,
          verifiedAt: nowInstant(),
          method,
          rationale,
        },
        status: verified ? 'scope_review' : 'identity_check',
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'rights.identity_checked',
        entityType: 'RightsRequest',
        entityId: id,
        entityLabel: req.reference,
        summary: `Identidad del solicitante de ${req.reference}: ${verified ? 'Verificada' : 'No acreditada'} (${method}).`,
      });
      return updated;
    }
  );
}

export function grantRightsExtension(
  id: string,
  months: number, // 1 or 2
  grounds: string,
  communicationEvidence: string
): RightsRequest {
  const ctx = getServiceCtx();
  ctx.assert('rights.decide_extension', 'Solo el Responsable de Privacidad o el DPO pueden autorizar prórrogas.');

  const req = ctx.db.rightsRequests.find((r) => r.id === id && r.companyId === ctx.company.id);
  if (!req) throw new NotFoundError('Solicitud no encontrada.');

  if (!grounds.trim()) {
    throw new BusinessRuleError('La prórroga requiere motivos justificados (complejidad o volumen de solicitudes, Art. 12.3 RGPD).');
  }
  if (!communicationEvidence.trim()) {
    throw new BusinessRuleError('Debe aportarse constancia de la comunicación informativa enviada al interesado dentro del primer mes.');
  }
  if (months < 1 || months > 2) {
    throw new BusinessRuleError('El plazo máximo de prórroga legal es de dos meses adicionales.');
  }

  // Calculate new effective deadline based on original intake date + (1 + months)
  const intakeDate = localDate(req.receiptTimestamp);
  const newEffectiveDeadline = addCalendarMonths(intakeDate, 1 + months);

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('rightsRequests', id, {
        extension: {
          extended: true,
          monthsGranted: months,
          grounds,
          decidedBy: ctx.user.id,
          decidedAt: nowInstant(),
          communicationEvidence,
        },
        effectiveDeadline: newEffectiveDeadline,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'rights.extended',
        entityType: 'RightsRequest',
        entityId: id,
        entityLabel: req.reference,
        summary: `Prórroga de +${months} mes(es) concedida para ${req.reference}. Nuevo plazo: ${newEffectiveDeadline}. Motivo: ${grounds}.`,
      });
      return updated;
    }
  );
}

export function decideRetentionConflict(
  id: string,
  decision: 'erase' | 'restrict_block' | 'retain_and_refuse',
  rationale: string
): RightsRequest {
  const ctx = getServiceCtx();
  ctx.assert('rights.decide_retention', 'Solo el Responsable de Privacidad o el DPO pueden resolver conflictos de retención.');

  const req = ctx.db.rightsRequests.find((r) => r.id === id && r.companyId === ctx.company.id);
  if (!req) throw new NotFoundError('Solicitud no encontrada.');

  if (!rationale.trim()) {
    throw new BusinessRuleError('Debe aportarse la fundamentación jurídica de la decisión de retención o bloqueo.');
  }

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('rightsRequests', id, {
        retentionConflict: {
          ...req.retentionConflict,
          reviewerDecision: decision,
          blockedDataOnly: decision === 'restrict_block',
          rationale,
          decidedBy: ctx.user.id,
          decidedAt: nowInstant(),
        },
        status: 'response_drafted',
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'rights.retention_resolved',
        entityType: 'RightsRequest',
        entityId: id,
        entityLabel: req.reference,
        summary: `Conflicto de conservación resuelto para ${req.reference}: ${decision}. Razón: ${rationale}.`,
      });
      return updated;
    }
  );
}

export function advanceRightsStatus(
  id: string,
  nextStatus: RightStatus,
  evidence?: { responseDraft?: string; responseEvidence?: string; closureReason?: string }
): RightsRequest {
  const ctx = getServiceCtx();
  ctx.assert('rights.manage', 'No tiene permisos para cambiar el estado de la solicitud.');

  const req = ctx.db.rightsRequests.find((r) => r.id === id && r.companyId === ctx.company.id);
  if (!req) throw new NotFoundError('Solicitud no encontrada.');

  // Check erasure safeguard
  if (req.rightType === 'erasure' && req.retentionConflict.conflictDetected && req.retentionConflict.reviewerDecision === 'pending') {
    if (nextStatus === 'response_sent' || nextStatus === 'closed') {
      throw new BusinessRuleError('No puede cerrarse una supresión con conflicto de retención sin la decisión documentada del revisor.');
    }
  }

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('rightsRequests', id, {
        status: nextStatus,
        responseDraft: evidence?.responseDraft ?? req.responseDraft,
        responseSentAt: nextStatus === 'response_sent' ? nowInstant() : req.responseSentAt,
        responseEvidence: evidence?.responseEvidence ?? req.responseEvidence,
        closureReason: evidence?.closureReason ?? req.closureReason,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: `rights.status_${nextStatus}`,
        entityType: 'RightsRequest',
        entityId: id,
        entityLabel: req.reference,
        summary: `Solicitud ${req.reference} avanzada a estado: ${nextStatus}.`,
      });
      return updated;
    }
  );
}

export function approveExtension(
  id: string,
  arg2: number | string,
  arg3?: string,
  arg4?: string
): RightsRequest {
  if (typeof arg2 === 'number') {
    return grantRightsExtension(id, arg2, arg3 ?? '', arg4 ?? '');
  }
  return grantRightsExtension(id, 2, arg2 ?? '', arg3 ?? '');
}

export function closeRightsRequest(id: string, closureReason: string): RightsRequest {
  return advanceRightsStatus(id, 'closed', { closureReason });
}

export function recordResponseSent(id: string, responseEvidence: string): RightsRequest {
  return advanceRightsStatus(id, 'response_sent', { responseEvidence });
}

export function saveResponseDraft(id: string, responseDraft: string): RightsRequest {
  return advanceRightsStatus(id, 'response_drafted', { responseDraft });
}

