/**
 * Labels (Spanish source text, translated at render time with t()), tones, explanations and the
 * explicit status transitions of each workflow.
 */
import type {
  ActionStatus,
  AssessmentStatus,
  CaeExchange,
  DocStatus,
  EvidenceRequest,
  ExceptionStatus,
  FitnessConclusion,
  IssueStatus,
  Priority,
  ReadinessState,
  RequirementCategory,
  RequirementType,
  SourceKind,
  TrainingStatus,
  VersionStatus,
  EvidenceMode,
  ExpiryRule,
  ReviewRule,
  CaeRole,
  AccessClass,
  ProviderSpecialty,
  PreventionModality,
} from './types';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface StatusMeta {
  label: string;
  tone: Tone;
  help: string;
}

/** Status of one applicable requirement for one employee (or employee × worksite). */
export type ItemStatus =
  | 'missing'
  | 'requested'
  | 'received'
  | 'in_review'
  | 'pending_ack'
  | 'accepted'
  | 'declined'
  | 'rejected'
  | 'expired'
  | 'review_due'
  | 'review_required'
  | 'not_applicable';

export const ITEM_STATUS: Record<ItemStatus, StatusMeta> = {
  missing: { label: 'Falta evidencia', tone: 'danger', help: 'No hay evidencia ni solicitud abierta para este requisito.' },
  requested: { label: 'Solicitado', tone: 'warning', help: 'Se ha pedido la evidencia; todavía no se ha recibido.' },
  received: { label: 'Recibido', tone: 'info', help: 'Documento recibido; pendiente de que la autoridad de revisión lo examine.' },
  in_review: { label: 'En revisión', tone: 'info', help: 'La persona revisora está examinando la evidencia.' },
  pending_ack: { label: 'Pendiente de confirmación', tone: 'warning', help: 'Falta la confirmación de la persona trabajadora (recepción de la información o del equipo).' },
  accepted: { label: 'Aceptado', tone: 'success', help: 'Evidencia aceptada por la autoridad de revisión. No certifica el cumplimiento legal ni la seguridad del puesto.' },
  declined: { label: 'Oferta no aceptada', tone: 'neutral', help: 'La persona trabajadora no aceptó una oferta voluntaria de vigilancia de la salud. No es un incumplimiento.' },
  rejected: { label: 'Rechazado', tone: 'danger', help: 'La última evidencia fue rechazada con motivo. El documento rechazado se conserva en el historial.' },
  expired: { label: 'Caducado', tone: 'danger', help: 'Ha pasado la fecha de caducidad real indicada en el documento.' },
  review_due: { label: 'Revisión vencida', tone: 'warning', help: 'Ha llegado la fecha de revisión establecida por el proveedor o la programada para el equipo.' },
  review_required: { label: 'Revisión necesaria', tone: 'warning', help: 'Falta una fecha o una decisión profesional. No se inventa ningún plazo.' },
  not_applicable: { label: 'No aplicable', tone: 'neutral', help: 'Una persona revisora autorizada lo marcó como no aplicable, con motivo.' },
};

/** Statuses that satisfy a requirement. */
export const SATISFIED: ItemStatus[] = ['accepted', 'declined', 'not_applicable'];

export const READINESS: Record<ReadinessState, StatusMeta> = {
  pending_evaluation: { label: 'Pendiente de evaluación', tone: 'neutral', help: 'Falta una evaluación de riesgos aceptada que cubra el puesto o hay una revisión de cambios pendiente.' },
  incomplete: { label: 'Información incompleta', tone: 'warning', help: 'Faltan evidencias obligatorias según la política aprobada.' },
  in_review: { label: 'En revisión', tone: 'info', help: 'Las evidencias obligatorias se han recibido y están pendientes de revisión.' },
  ready: { label: 'Listo según los requisitos configurados', tone: 'success', help: 'Todas las evidencias obligatorias configuradas están aceptadas. No es una aprobación profesional de seguridad.' },
  blocked: { label: 'Bloqueado por requisito crítico', tone: 'danger', help: 'Un requisito crítico configurado no está resuelto. La asignación no puede marcarse como lista.' },
  professional_review: { label: 'Requiere revisión profesional', tone: 'warning', help: 'Hay fechas sin determinar, revisiones vencidas o decisiones que corresponden a un profesional.' },
};

export const READINESS_ORDER: ReadinessState[] = ['blocked', 'pending_evaluation', 'professional_review', 'incomplete', 'in_review', 'ready'];

export const DOC_STATUS: Record<DocStatus, StatusMeta> = {
  received: { label: 'Recibido', tone: 'info', help: 'Presentado; la subida no implica aprobación.' },
  in_review: { label: 'En revisión', tone: 'info', help: 'La autoridad de revisión lo está examinando.' },
  accepted: { label: 'Aceptado', tone: 'success', help: 'Aceptado por la autoridad de revisión indicada.' },
  rejected: { label: 'Rechazado', tone: 'danger', help: 'Rechazado con motivo. Se conserva como historial.' },
  superseded: { label: 'Sustituido', tone: 'neutral', help: 'Sustituido por una versión posterior aceptada. Se conserva.' },
};

export const REQUEST_STATUS: Record<EvidenceRequest['status'], StatusMeta> = {
  open: { label: 'Solicitado', tone: 'warning', help: 'Solicitud abierta.' },
  fulfilled: { label: 'Atendida', tone: 'success', help: 'Se presentó un documento para esta solicitud.' },
  cancelled: { label: 'Cancelada', tone: 'neutral', help: 'Cancelada con motivo.' },
};

export const VERSION_STATUS: Record<VersionStatus, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral', help: 'No produce efectos. Se puede editar.' },
  pending_approval: { label: 'Pendiente de aprobación', tone: 'warning', help: 'Espera la aprobación de la autoridad profesional indicada.' },
  scheduled: { label: 'Programada', tone: 'info', help: 'Aprobada; entra en vigor en su fecha de efecto.' },
  active: { label: 'Vigente', tone: 'success', help: 'Versión aplicada a las asignaciones.' },
  superseded: { label: 'Sustituida', tone: 'neutral', help: 'Sustituida por una versión posterior. Se conserva con las evidencias revisadas bajo ella.' },
  retired: { label: 'Retirada', tone: 'neutral', help: 'El requisito dejó de aplicarse en la fecha indicada. El historial se conserva.' },
  rejected: { label: 'Aprobación rechazada', tone: 'danger', help: 'La autoridad profesional no aprobó esta versión.' },
};

export const REQUIREMENT_TYPE: Record<RequirementType, StatusMeta> = {
  mandatory_policy: { label: 'Obligatorio según la política aprobada', tone: 'accent', help: 'Cuenta para la disponibilidad. Su base consta en la fuente y la aprobación profesional.' },
  optional: { label: 'Opcional', tone: 'neutral', help: 'Se ofrece o recomienda; no cuenta como evidencia obligatoria pendiente.' },
  not_applicable: { label: 'No aplicable', tone: 'neutral', help: 'Evaluado como no aplicable para este ámbito; queda documentado.' },
};

export const CATEGORY_LABEL: Record<RequirementCategory, string> = {
  training: 'Formación',
  information: 'Información de riesgos',
  site_instruction: 'Instrucciones del centro',
  ppe: 'Equipos de protección (EPI)',
  health_surveillance: 'Vigilancia de la salud',
  provider_document: 'Documentación del servicio de prevención',
  coordination: 'Coordinación (CAE)',
  employee_document: 'Documentación del empleado',
  authorisation: 'Autorización o habilitación',
};

export const EVIDENCE_MODE_LABEL: Record<EvidenceMode, string> = {
  document: 'Documento revisado',
  training: 'Formación con evidencia aceptada',
  acknowledgement: 'Confirmación de recepción de la información',
  ppe_issue: 'Entrega de equipo con confirmación',
  health: 'Oferta y conclusión (área restringida)',
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  law: 'Norma (fuente oficial)',
  risk_assessment: 'Evaluación de riesgos',
  provider_policy: 'Criterio del servicio de prevención',
  customer_requirement: 'Requisito del cliente / titular del centro',
  collective_agreement: 'Convenio colectivo',
  internal_policy: 'Política interna',
};

export const EXPIRY_RULE_LABEL: Record<ExpiryRule, string> = {
  none: 'Sin caducidad',
  per_document: 'La indica cada documento (si el emisor la establece)',
  not_determined: 'Pendiente de determinar por un profesional',
};

export const REVIEW_RULE_LABEL: Record<ReviewRule['kind'], string> = {
  none: 'Sin revisión programada',
  interval: 'Periodicidad fijada por el proveedor',
  per_document: 'Fecha de revisión indicada en cada documento',
  not_determined: 'Revisión necesaria: periodicidad no determinada',
};

export const ACTION_STATUS: Record<ActionStatus, StatusMeta> = {
  open: { label: 'Abierta', tone: 'warning', help: 'Creada, sin responsable asignado.' },
  assigned: { label: 'Asignada', tone: 'info', help: 'Tiene responsable y fecha objetivo justificada.' },
  in_progress: { label: 'En curso', tone: 'info', help: 'El responsable ha registrado avances.' },
  pending_review: { label: 'Pendiente de revisión', tone: 'accent', help: 'Enviada a la autoridad de revisión con su evidencia.' },
  resolved: { label: 'Resuelta', tone: 'success', help: 'La autoridad de revisión aceptó la resolución.' },
  reopened: { label: 'Reabierta', tone: 'danger', help: 'La resolución fue rechazada o el problema reapareció.' },
};

export const ACTION_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  open: ['assigned'],
  assigned: ['in_progress', 'pending_review', 'assigned'],
  in_progress: ['pending_review', 'in_progress', 'assigned'],
  pending_review: ['resolved', 'reopened'],
  resolved: ['reopened'],
  reopened: ['assigned', 'in_progress', 'pending_review'],
};

export const PRIORITY: Record<Priority, StatusMeta> = {
  high: { label: 'Alta', tone: 'danger', help: 'Prioridad alta asignada por quien creó la acción.' },
  medium: { label: 'Media', tone: 'warning', help: 'Prioridad media.' },
  low: { label: 'Baja', tone: 'neutral', help: 'Prioridad baja.' },
};

export const ASSESSMENT_STATUS: Record<AssessmentStatus, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral', help: 'Registrada, pendiente de enviar a revisión.' },
  submitted: { label: 'Enviada', tone: 'info', help: 'Enviada al servicio de prevención para revisión.' },
  under_review: { label: 'En revisión', tone: 'info', help: 'El servicio de prevención la está revisando.' },
  accepted: { label: 'Aceptada', tone: 'success', help: 'Aceptada como registro vigente. No es una declaración de que el centro sea seguro.' },
  superseded: { label: 'Sustituida', tone: 'neutral', help: 'Sustituida por una versión posterior; se conserva.' },
  review_required: { label: 'Revisión necesaria', tone: 'warning', help: 'Cambio en el centro, el puesto o un daño a la salud exige revisarla (RD 39/1997 arts. 4 y 6).' },
};

export const ASSESSMENT_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'accepted', 'draft'],
  under_review: ['accepted', 'draft'],
  accepted: ['review_required', 'superseded'],
  review_required: ['superseded', 'accepted'],
  superseded: [],
};

export const TRAINING_STATUS: Record<TrainingStatus, StatusMeta> = {
  assigned: { label: 'Asignada', tone: 'warning', help: 'Asignada; sin fecha programada.' },
  scheduled: { label: 'Programada', tone: 'info', help: 'Con fecha prevista.' },
  attended: { label: 'Asistencia registrada', tone: 'info', help: 'Consta la asistencia; la finalización y la evidencia se registran aparte.' },
  completed: { label: 'Finalizada', tone: 'accent', help: 'Consta la finalización. La evidencia se acepta por separado.' },
  cancelled: { label: 'Cancelada', tone: 'neutral', help: 'Cancelada con motivo.' },
};

export const ISSUE_STATUS: Record<IssueStatus, StatusMeta> = {
  issued: { label: 'Entregado', tone: 'success', help: 'Equipo entregado a la persona trabajadora.' },
  returned: { label: 'Devuelto', tone: 'neutral', help: 'Equipo devuelto.' },
  replaced: { label: 'Reemplazado', tone: 'neutral', help: 'Sustituido por una nueva entrega.' },
  lost: { label: 'Perdido o dañado', tone: 'danger', help: 'Requiere una nueva entrega.' },
};

export const EXCEPTION_STATUS: Record<ExceptionStatus, StatusMeta> = {
  open: { label: 'Abierta', tone: 'warning', help: 'Detectada; sin revisar.' },
  assigned: { label: 'Asignada', tone: 'info', help: 'Tiene responsable.' },
  acknowledged: { label: 'Vista', tone: 'neutral', help: 'Revisada sin cambios todavía.' },
  investigating: { label: 'En investigación', tone: 'info', help: 'Se está analizando.' },
  resolved: { label: 'Resuelta', tone: 'success', help: 'Marcada como resuelta con nota. Si la causa persiste, vuelve a aparecer.' },
  reopened: { label: 'Reabierta', tone: 'danger', help: 'Se reabrió con nota.' },
};

export const CAE_REVIEW: Record<CaeExchange['review'], StatusMeta> = {
  pending: { label: 'Revisión pendiente', tone: 'warning', help: 'Nadie ha revisado todavía el contenido.' },
  accepted: { label: 'Revisado y aceptado', tone: 'success', help: 'Contenido revisado y aceptado.' },
  rejected: { label: 'Revisado con objeciones', tone: 'danger', help: 'Contenido revisado; requiere corrección o aclaración.' },
  not_required: { label: 'Sin revisión necesaria', tone: 'neutral', help: 'Envío informativo sin decisión de revisión.' },
};

export const CAE_ROLE_LABEL: Record<CaeRole, string> = {
  titular: 'Titular del centro',
  principal: 'Empresa principal',
  contratista: 'Contratista',
  subcontratista: 'Subcontratista',
  autonomo: 'Trabajador/a autónomo/a',
  concurrente: 'Empresa concurrente',
};

/** Only shown inside the restricted health area. */
export const FITNESS_LABEL: Record<FitnessConclusion, StatusMeta> = {
  fit: { label: 'Apto/a', tone: 'success', help: 'Conclusión del servicio médico sin impacto en la asignación.' },
  fit_with_measures: { label: 'Apto/a con medidas preventivas', tone: 'warning', help: 'Requiere aplicar medidas preventivas comunicadas por el servicio médico.' },
  temporarily_unfit: { label: 'No apto/a temporalmente', tone: 'danger', help: 'No debe asignarse a la tarea evaluada hasta nueva conclusión.' },
  unfit: { label: 'No apto/a', tone: 'danger', help: 'No debe asignarse a la tarea evaluada.' },
};

export const ACCESS_CLASS: Record<AccessClass, StatusMeta> = {
  ordinary: { label: 'Ordinario', tone: 'neutral', help: 'Visible para los roles con acceso a documentación de la empresa.' },
  restricted: { label: 'Restringido', tone: 'accent', help: 'Solo coordinación de PRL, servicio de prevención y la persona afectada.' },
  health: { label: 'Salud (restringido)', tone: 'danger', help: 'Solo personal sanitario autorizado. No se almacenan informes clínicos.' },
  quarantined: { label: 'En cuarentena', tone: 'danger', help: 'Posible contenido clínico subido por error: bloqueado hasta su gestión por personal sanitario.' },
};

export const SPECIALTY_LABEL: Record<ProviderSpecialty, string> = {
  seguridad: 'Seguridad en el trabajo',
  higiene: 'Higiene industrial',
  ergonomia: 'Ergonomía y psicosociología aplicada',
  medicina: 'Medicina del trabajo',
};

export const MODALITY_LABEL: Record<PreventionModality, string> = {
  spa: 'Servicio de prevención ajeno',
  own_service: 'Servicio de prevención propio',
  designated_workers: 'Trabajadores designados',
  employer: 'Asunción personal por el empresario',
  joint_service: 'Servicio de prevención mancomunado',
};
