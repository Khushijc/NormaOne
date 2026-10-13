/**
 * Status and Categorical Metadata for PrevenWork.
 */
import type {
  AuthorityNotificationStatus,
  DocumentVersionStatus,
  GdprRole,
  IncidentCategory,
  IncidentRiskLevel,
  IncidentStatus,
  LegalBasis,
  RightStatus,
  RightType,
  RopaStatus,
  SubjectNotificationStatus,
  SupplierAssessmentStatus,
  TaskPriority,
} from './types';

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface StatusMeta {
  label: string;
  tone: Tone;
  help?: string;
}

export const ROPA_STATUS: Record<RopaStatus, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral', help: 'Registro en elaboración. Sin efectos formales.' },
  in_review: { label: 'En revisión', tone: 'info', help: 'Pendiente de validación por el responsable o asesor.' },
  approved: { label: 'Aprobado', tone: 'success', help: 'Tratamiento revisado y validado formalmente.' },
  changes_required: { label: 'Requiere cambios', tone: 'warning', help: 'Se han solicitado subsanaciones al titular del área.' },
  archived: { label: 'Archivado', tone: 'neutral', help: 'Tratamiento cesado o sustituido. Conservado para trazabilidad.' },
};

export const GDPR_ROLE: Record<GdprRole, StatusMeta> = {
  controller: { label: 'Responsable', tone: 'info', help: 'Determina fines y medios del tratamiento (Art. 4.7 RGPD).' },
  processor: { label: 'Encargado', tone: 'success', help: 'Trata datos por cuenta de un tercero (Art. 4.8 RGPD).' },
  joint_controller: { label: 'Corresponsable', tone: 'warning', help: 'Determina fines y medios conjuntamente con otra entidad (Art. 26 RGPD).' },
};

export const LEGAL_BASIS: Record<LegalBasis, { label: string; article: string }> = {
  consent: { label: 'Consentimiento del interesado', article: 'Art. 6.1.a RGPD' },
  contract: { label: 'Ejecución de contrato / precontractual', article: 'Art. 6.1.b RGPD' },
  legal_obligation: { label: 'Cumplimiento de obligación legal', article: 'Art. 6.1.c RGPD' },
  vital_interests: { label: 'Protección de intereses vitales', article: 'Art. 6.1.d RGPD' },
  public_interest: { label: 'Misión de interés público', article: 'Art. 6.1.e RGPD' },
  legitimate_interest: { label: 'Interés legítimo acreditado', article: 'Art. 6.1.f RGPD' },
};

export const RIGHT_TYPE: Record<RightType, { label: string; article: string }> = {
  access: { label: 'Acceso', article: 'Art. 15 RGPD' },
  rectification: { label: 'Rectificación', article: 'Art. 16 RGPD' },
  erasure: { label: 'Supresión («Derecho al olvido»)', article: 'Art. 17 RGPD' },
  restriction: { label: 'Limitación del tratamiento', article: 'Art. 18 RGPD' },
  portability: { label: 'Portabilidad de los datos', article: 'Art. 20 RGPD' },
  objection: { label: 'Oposición', article: 'Art. 21 RGPD' },
  clarification: { label: 'Aclaración de solicitud', article: 'Art. 12 RGPD' },
};

export const RIGHT_STATUS: Record<RightStatus, StatusMeta> = {
  received: { label: 'Recibida', tone: 'neutral', help: 'Solicitud registrada. Pendiente de verificación inicial.' },
  identity_check: { label: 'Cotejo de identidad', tone: 'warning', help: 'Verificando acreditación del interesado o representante.' },
  scope_review: { label: 'Análisis de alcance', tone: 'info', help: 'Identificando sistemas, áreas y encargados afectados.' },
  actions_pending: { label: 'Medidas en ejecución', tone: 'info', help: 'Extrayendo, rectificando o revisando datos.' },
  retention_check: { label: 'Revisión de plazos legales', tone: 'warning', help: 'Comprobando obligaciones fiscales, laborales o mercantiles.' },
  response_drafted: { label: 'Respuesta redactada', tone: 'info', help: 'Pendiente de firma o aprobación por responsable.' },
  response_sent: { label: 'Respuesta enviada', tone: 'success', help: 'Comunicación remitida con constancia de envío.' },
  closed: { label: 'Cerrada', tone: 'success', help: 'Caso concluido satisfactoriamente.' },
  rejected: { label: 'Denegada motivadamente', tone: 'danger', help: 'Denegada total o parcialmente con fundamentación legal.' },
  withdrawn: { label: 'Desistida', tone: 'neutral', help: 'El interesado no aportó subsanación o retiró la petición.' },
};

export const INCIDENT_CATEGORY: Record<IncidentCategory, StatusMeta> = {
  ransomware_malware: { label: 'Ransomware / Malware', tone: 'danger', help: 'Infección por código malicioso o cifrado de archivos.' },
  unauthorized_access: { label: 'Acceso no autorizado', tone: 'danger', help: 'Compromiso de credenciales o intrusión externa.' },
  accidental_disclosure: { label: 'Divulgación accidental', tone: 'warning', help: 'Envío de correos o ficheros a destinatario erróneo.' },
  theft_loss_device: { label: 'Pérdida/robo de dispositivo', tone: 'warning', help: 'Extravío de portátil, móvil o soporte extraíble.' },
  service_outage_loss: { label: 'Pérdida de disponibilidad', tone: 'info', help: 'Caída de servicio o pérdida de copias sin recuperación.' },
  physical_security: { label: 'Brecha de seguridad física', tone: 'warning', help: 'Acceso no permitido a archivos papel o dependencias.' },
};

export const INCIDENT_RISK: Record<IncidentRiskLevel, StatusMeta> = {
  unlikely_risk: { label: 'Riesgo improbable', tone: 'success', help: 'Sin impacto relevante en derechos y libertades.' },
  medium_risk: { label: 'Riesgo para derechos', tone: 'warning', help: 'Notificable a la AEPD en 72 horas (Art. 33 RGPD).' },
  high_risk: { label: 'Alto riesgo', tone: 'danger', help: 'Requiere notificación a la AEPD y a los afectados (Art. 34 RGPD).' },
};

export const AUTHORITY_STATUS: Record<AuthorityNotificationStatus, StatusMeta> = {
  not_applicable: { label: 'No procede (sin riesgo)', tone: 'neutral', help: 'Evaluación motivada: no reportable a la AEPD.' },
  assessing: { label: 'En evaluación (72h)', tone: 'warning', help: 'Analizando riesgo dentro del plazo de 72 horas.' },
  pending_submission: { label: 'Pendiente de tramitación', tone: 'danger', help: 'Decidida notificación: pendiente de presentar en AEPD.' },
  submitted: { label: 'Notificada a la AEPD', tone: 'success', help: 'Presentada en sede electrónica con nº de registro.' },
  justified_late: { label: 'Notificada con retraso', tone: 'warning', help: 'Presentada transcurridas 72h con justificación razonada.' },
};

export const SUBJECT_STATUS: Record<SubjectNotificationStatus, StatusMeta> = {
  not_required: { label: 'No requerida', tone: 'neutral', help: 'No concurre alto riesgo para los afectados.' },
  evaluating: { label: 'Evaluando comunicación', tone: 'warning', help: 'Analizando gravedad del impacto personal.' },
  pending_communication: { label: 'Pendiente de avisar', tone: 'danger', help: 'Notificación directa a los afectados requerida.' },
  communicated: { label: 'Afectados informados', tone: 'success', help: 'Comunicación individual remitida con recomendaciones.' },
};

export const INCIDENT_STATUS: Record<IncidentStatus, StatusMeta> = {
  reported: { label: 'Notificado', tone: 'neutral' },
  initial_assessment: { label: 'Evaluación inicial', tone: 'info' },
  containment: { label: 'Contención aplicada', tone: 'warning' },
  risk_evaluated: { label: 'Riesgo evaluado', tone: 'info' },
  decision_recorded: { label: 'Decisión formalizada', tone: 'info' },
  actions_in_progress: { label: 'Medidas correctoras', tone: 'warning' },
  closed: { label: 'Cerrado', tone: 'success' },
};

export const DOC_STATUS: Record<DocumentVersionStatus, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  in_review: { label: 'En revisión', tone: 'info' },
  approved: { label: 'Aprobado', tone: 'success' },
  published: { label: 'Publicado', tone: 'success' },
  superseded: { label: 'Sustituido', tone: 'neutral' },
  archived: { label: 'Archivado', tone: 'neutral' },
};

export const SUPPLIER_ROLE: Record<SupplierAssessmentStatus, StatusMeta> = {
  not_assessed: { label: 'Sin evaluar', tone: 'neutral' },
  in_progress: { label: 'En evaluación', tone: 'info' },
  assessed_processor: { label: 'Encargado de tratamiento', tone: 'success' },
  assessed_independent_controller: { label: 'Responsable independiente', tone: 'info' },
  assessed_joint_controller: { label: 'Corresponsable', tone: 'warning' },
  needs_professional_review: { label: 'Revisión técnica requerida', tone: 'danger' },
};

export const TASK_PRIORITY: Record<TaskPriority, StatusMeta> = {
  low: { label: 'Baja', tone: 'neutral' },
  medium: { label: 'Media', tone: 'info' },
  high: { label: 'Alta', tone: 'warning' },
  urgent: { label: 'Urgente', tone: 'danger' },
};
