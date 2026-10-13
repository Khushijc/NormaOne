/**
 * Personal-Data Incidents & Security Breaches Service (Art. 33-34 RGPD).
 */
import { BusinessRuleError, NotFoundError, PermissionError } from '../domain/permissions';
import { newId } from '../domain/ids';
import { computeIncidentClock, nowInstant } from '../domain/time';
import type {
  AuthorityNotificationStatus,
  IncidentCategory,
  IncidentRiskLevel,
  PersonalDataIncident,
  SubjectNotificationStatus,
} from '../domain/types';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export interface IncidentInput {
  title: string;
  detectionTimestamp: string;
  awarenessTimestamp: string;
  reportedBy: string;
  category: IncidentCategory;
  description: string;
  affectedSystems: string[];
  affectedDataCategories: string[];
  specialCategoryInvolved: boolean;
  approximateVolume: number;
  approximateSubjects: number;
  containmentActions: string;
  incidentOwnerId: string;
  privacyReviewerId: string;
}

export function registerIncident(input: IncidentInput): PersonalDataIncident {
  const ctx = getServiceCtx();
  ctx.assert('incidents.manage', 'No tiene permisos para registrar incidentes.');

  const seq = ctx.db.incidents.filter((i) => i.companyId === ctx.company.id).length + 1;
  const reference = `INC-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`;

  const inc: PersonalDataIncident = {
    ...input,
    id: newId('inc'),
    companyId: ctx.company.id,
    reference,
    riskLevel: 'unlikely_risk',
    riskRationale: 'Pendiente de análisis formal de impacto.',
    authorityStatus: 'assessing',
    subjectStatus: 'evaluating',
    correctiveActions: 'En fase inicial de contención.',
    status: 'reported',
    restricted: true,
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('incidents', inc);
      tx.audit({
        action: 'incident.registered',
        entityType: 'PersonalDataIncident',
        entityId: inc.id,
        entityLabel: `${inc.reference} · ${inc.title}`,
        summary: `Registrado incidente de seguridad ${inc.reference}. Reloj 72h AEPD iniciado desde ${inc.awarenessTimestamp}.`,
        restricted: true,
      });
      return inc;
    }
  );
}

export function viewSensitiveIncident(id: string): PersonalDataIncident {
  const ctx = getServiceCtx();
  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  if (inc.restricted && !ctx.can('incidents.view_restricted')) {
    // Audit unauthorized inspection attempt
    transact(
      { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
      ctx.company.id,
      (tx) => {
        tx.audit({
          action: 'incident.access_denied',
          entityType: 'PersonalDataIncident',
          entityId: id,
          entityLabel: inc.reference,
          summary: `Acceso denegado a incidente sensible ${inc.reference} para el usuario ${ctx.user.name} (rol ${ctx.roles[0]}).`,
          restricted: true,
        });
      }
    );
    throw new PermissionError('El detalle de este incidente está restringido al Responsable de Privacidad y al DPO.');
  }

  // Audit access to sensitive records
  transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.audit({
        action: 'incident.viewed',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Consulta de detalle sensible de ${inc.reference} por ${ctx.user.name}.`,
        restricted: true,
      });
    }
  );

  return inc;
}

export function evaluateIncidentRisk(
  id: string,
  riskLevel: IncidentRiskLevel,
  riskRationale: string
): PersonalDataIncident {
  const ctx = getServiceCtx();
  ctx.assert('incidents.manage', 'No tiene permisos para evaluar el riesgo del incidente.');

  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  let authorityStatus: AuthorityNotificationStatus = inc.authorityStatus;
  let subjectStatus: SubjectNotificationStatus = inc.subjectStatus;

  if (riskLevel === 'unlikely_risk') {
    authorityStatus = 'not_applicable';
    subjectStatus = 'not_required';
  } else if (riskLevel === 'medium_risk') {
    authorityStatus = 'pending_submission';
    subjectStatus = 'not_required';
  } else if (riskLevel === 'high_risk') {
    authorityStatus = 'pending_submission';
    subjectStatus = 'pending_communication';
  }

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('incidents', id, {
        riskLevel,
        riskRationale,
        authorityStatus,
        subjectStatus,
        status: 'risk_evaluated',
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'incident.risk_evaluated',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Evaluado riesgo de ${inc.reference}: ${riskLevel}. AEPD: ${authorityStatus}, Afectados: ${subjectStatus}.`,
        restricted: true,
      });
      return updated;
    }
  );
}

export function recordAuthoritySubmission(
  id: string,
  submissionRef: string,
  submittedAt: string,
  lateJustification?: string
): PersonalDataIncident {
  const ctx = getServiceCtx();
  ctx.assert('incidents.decide_notification', 'Solo el Responsable de Privacidad o DPO pueden registrar la notificación a AEPD.');

  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  if (!submissionRef.trim()) {
    throw new BusinessRuleError('Debe aportar el número de registro oficial de la sede electrónica de la AEPD.');
  }

  const clock = computeIncidentClock(inc.awarenessTimestamp, false, submittedAt);
  const isLate = clock.isOverdue;
  if (isLate && !lateJustification?.trim()) {
    throw new BusinessRuleError('La notificación se presenta transcurridas 72 horas. Es preceptivo incorporar la justificación razonada del retraso (Art. 33.1 RGPD).');
  }

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('incidents', id, {
        authorityStatus: isLate ? 'justified_late' : 'submitted',
        authoritySubmissionRef: submissionRef,
        authoritySubmittedAt: submittedAt,
        lateJustification: isLate ? lateJustification : undefined,
        status: 'actions_in_progress',
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'incident.authority_submitted',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Notificación presentada a AEPD para ${inc.reference} (Registro: ${submissionRef}).`,
        restricted: true,
      });
      return updated;
    }
  );
}

export function recordSubjectCommunication(
  id: string,
  communicationEvidence: string
): PersonalDataIncident {
  const ctx = getServiceCtx();
  ctx.assert('incidents.decide_notification', 'No tiene permisos para registrar la comunicación a interesados.');

  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  if (!communicationEvidence.trim()) {
    throw new BusinessRuleError('Debe aportarse la constancia y modelo de comunicación individual remitido a los afectados.');
  }

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('incidents', id, {
        subjectStatus: 'communicated',
        subjectCommunicatedAt: nowInstant(),
        subjectCommunicationEvidence: communicationEvidence,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'incident.subjects_communicated',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Comunicación a afectados completada para ${inc.reference}.`,
        restricted: true,
      });
      return updated;
    }
  );
}

export function closeIncident(
  id: string,
  correctiveActions: string,
  lessonsLearned: string
): PersonalDataIncident {
  const ctx = getServiceCtx();
  ctx.assert('incidents.close', 'Solo el Responsable de Privacidad o DPO pueden autorizar el cierre de incidentes.');

  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  // Closure safeguard:
  // If incident was reportable, cannot close without submission ref or documented non-notification justification
  if (inc.riskLevel !== 'unlikely_risk') {
    if (inc.authorityStatus !== 'submitted' && inc.authorityStatus !== 'justified_late') {
      throw new BusinessRuleError('Un incidente con riesgo para derechos no puede cerrarse sin constancia de notificación a la AEPD o resolución motivada.');
    }
    if (inc.riskLevel === 'high_risk' && inc.subjectStatus !== 'communicated') {
      throw new BusinessRuleError('Un incidente de alto riesgo no puede cerrarse sin haber acreditado la comunicación a los afectados.');
    }
  }

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('incidents', id, {
        correctiveActions,
        lessonsLearned,
        status: 'closed',
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'incident.closed',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Incidente ${inc.reference} cerrado con aprobación formal de medidas correctoras.`,
        restricted: true,
      });
      return updated;
    }
  );
}

export function decideAuthorityNotification(
  id: string,
  status: AuthorityNotificationStatus,
  submissionRef?: string,
  lateJustification?: string
): PersonalDataIncident {
  if (status === 'submitted' || status === 'justified_late') {
    return recordAuthoritySubmission(id, submissionRef ?? 'AEPD-REG-2026', nowInstant(), lateJustification);
  }
  const ctx = getServiceCtx();
  ctx.assert('incidents.decide_notification', 'No tiene permisos para modificar la decisión de notificación.');
  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('incidents', id, {
        authorityStatus: status,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'incident.authority_status_changed',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Estado de notificación AEPD para ${inc.reference} cambiado a: ${status}.`,
        restricted: true,
      });
      return updated;
    }
  );
}

export function decideSubjectNotification(
  id: string,
  status: SubjectNotificationStatus,
  communicationEvidence?: string
): PersonalDataIncident {
  if (status === 'communicated') {
    return recordSubjectCommunication(id, communicationEvidence ?? 'Comunicado');
  }
  const ctx = getServiceCtx();
  ctx.assert('incidents.decide_notification', 'No tiene permisos para modificar la comunicación a afectados.');
  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('incidents', id, {
        subjectStatus: status,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'incident.subject_status_changed',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Estado de comunicación a afectados para ${inc.reference} cambiado a: ${status}.`,
        restricted: true,
      });
      return updated;
    }
  );
}

export function recordContainment(id: string, containmentActions: string): PersonalDataIncident {
  const ctx = getServiceCtx();
  ctx.assert('incidents.manage', 'No tiene permisos para actualizar las medidas de contención.');
  const inc = ctx.db.incidents.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inc) throw new NotFoundError('Incidente no encontrado.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('incidents', id, {
        containmentActions,
        status: inc.status === 'reported' ? 'containment' : inc.status,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'incident.contained',
        entityType: 'PersonalDataIncident',
        entityId: id,
        entityLabel: inc.reference,
        summary: `Medidas de contención actualizadas para ${inc.reference}.`,
        restricted: true,
      });
      return updated;
    }
  );
}
