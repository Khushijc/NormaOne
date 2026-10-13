/**
 * PrevenWork domain model (= future backend schema / DTOs).
 * Mini-app 04 of Spain SME Compliance Portal (RGPD / GDPR & LOPDGDD).
 */

export type ID = string;
export type ISODate = string;     // YYYY-MM-DD (calendar date)
export type ISOInstant = string;  // ISO-8601 UTC instant (YYYY-MM-DDTHH:mm:ss.sssZ)

export type RoleId =
  | 'owner'               // Company Owner: aggregate overview, approved exports, no raw confidential incidents
  | 'privacy_lead'        // Privacy Lead: full operational privacy management, incidents, rights, retention
  | 'case_handler'        // Authorised Case Handler: assigned rights cases & tasks
  | 'employee'            // General employee: permitted self-service
  | 'dpo_adviser'         // External Privacy Adviser (DPO): expert reviews, opinions, audit access
  | 'auditor';            // Read-only Reviewer: compliance verification

export interface Company {
  id: ID;
  legalName: string;
  tradeName: string;
  nif: string;
  activity: string;
  hasDpo: boolean;
  dpoContact?: string;
  registeredAddress: string;
}

export interface User {
  id: ID;
  email: string;
  name: string;
  organisation: string;
}

export interface Membership {
  id: ID;
  userId: ID;
  companyId: ID;
  roles: RoleId[];
  validFrom: ISODate;
  validUntil: ISODate | null;
  status: 'active' | 'suspended';
}

// ─────────────────────────────── RoPA / RAT (Art. 30 RGPD) ───────────────────────────────

export type RopaStatus = 'draft' | 'in_review' | 'approved' | 'changes_required' | 'archived';
export type GdprRole = 'controller' | 'processor' | 'joint_controller';
export type LegalBasis =
  | 'consent'             // Art. 6.1.a: Consentimiento
  | 'contract'            // Art. 6.1.b: Ejecución de contrato
  | 'legal_obligation'    // Art. 6.1.c: Obligación legal
  | 'vital_interests'     // Art. 6.1.d: Intereses vitales
  | 'public_interest'     // Art. 6.1.e: Misión de interés público
  | 'legitimate_interest';// Art. 6.1.f: Interés legítimo (con ponderación)

export interface ProcessingActivity {
  id: ID;
  companyId: ID;
  code: string;               // e.g. RAT-001
  name: string;
  purpose: string;
  dataSubjects: string[];     // Clientes, Empleados, Proveedores, Contactos web
  dataCategories: string[];   // Identificativos, Económicos, Profesionales, Conexión
  specialCategories: boolean; // Art. 9: salud, biometría, afiliación sindical
  specialCategoryNotes?: string;
  systems: string[];          // ERP, CRM, Servidor correo, Archivo papel
  recipients: string[];       // Asesoría laboral, AEAT, Bancos, Proveedor cloud
  internationalTransfers: boolean;
  transferSafeguards?: string;
  role: GdprRole;
  legalBasis: LegalBasis;
  legalBasisReviewStatus: 'confirmed' | 'pending_review' | 'expert_justification_needed';
  retentionRule: string;      // e.g. 5 años desde fin de contrato (Art. 1964 CC)
  securityMeasures: string;   // Cifrado, control accesos, copias seguridad
  businessOwner: string;      // Responsable del departamento
  privacyReviewerId: ID;
  lastReviewDate: ISODate | null;
  nextReviewDate: ISODate;
  specialistReviewFlag: boolean; // Requiere análisis por asesor externo/EIPD
  dpiaRequired: boolean;      // EIPD / DPIA obligatoria
  status: RopaStatus;
  missingFieldsWarning?: string[];
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

// ─────────────────────────────── Rights Requests (Art. 15-22 RGPD) ───────────────────────────────

export type RightType =
  | 'access'          // Acceso (Art. 15)
  | 'rectification'   // Rectificación (Art. 16)
  | 'erasure'         // Supresión / Olvido (Art. 17)
  | 'restriction'     // Limitación del tratamiento (Art. 18)
  | 'portability'     // Portabilidad (Art. 20)
  | 'objection'       // Oposición (Art. 21)
  | 'clarification';  // Aclaración / Solicitud ambigua

export type IntakeChannel = 'email' | 'web_form' | 'postal' | 'in_person';

export type RightStatus =
  | 'received'             // Recibida
  | 'identity_check'       // Verificación de identidad
  | 'scope_review'         // Análisis de alcance y sistemas
  | 'actions_pending'      // Medidas en ejecución
  | 'retention_check'      // Comprobación de plazos y bloqueo
  | 'response_drafted'     // Respuesta redactada
  | 'response_sent'        // Respuesta enviada
  | 'closed'               // Cerrada con éxito
  | 'rejected'             // Denegada motivadamente
  | 'withdrawn';           // Desistida por el interesado

export interface IdentityCheck {
  required: boolean;
  verified: boolean;
  verifiedAt: ISOInstant | null;
  method: string | null;   // DNI/NIE cotejado, certificado digital, llamada verificada
  rationale: string | null;
}

export interface ExtensionDecision {
  extended: boolean;
  monthsGranted: number;   // Max 2 months (Art. 12.3 RGPD)
  grounds: string;         // Complejidad o número elevado de solicitudes
  decidedBy: ID;
  decidedAt: ISOInstant;
  communicationEvidence: string; // Ref/email avisando al interesado en el primer mes
}

export interface RetentionConflictCheck {
  conflictDetected: boolean;
  conflictingRules: string[];    // e.g. Facturación: 4 años fiscal LGT / 6 años CCom Art. 30
  blockedDataOnly: boolean;      // Bloqueo de datos en lugar de borrado físico
  reviewerDecision: 'erase' | 'restrict_block' | 'retain_and_refuse' | 'pending';
  rationale: string;
  decidedBy: ID | null;
  decidedAt: ISOInstant | null;
}

export interface RightsRequest {
  id: ID;
  companyId: ID;
  reference: string;            // e.g. SOL-2026-001
  rightType: RightType;
  intakeChannel: IntakeChannel;
  receiptTimestamp: ISOInstant; // Original intake timestamp (NEVER resets)
  requesterName: string;
  requesterEmail: string;
  requesterDocNumber?: string;  // DNI/NIE (restricted visibility)
  description: string;
  identityCheck: IdentityCheck;
  assignedOwnerId: ID;
  affectedSystems: string[];
  standardDeadline: ISODate;    // Computed by Calendar-Month Rule
  extension: ExtensionDecision | null;
  effectiveDeadline: ISODate;   // Either standard or standard + extension
  retentionConflict: RetentionConflictCheck;
  status: RightStatus;
  responseDraft?: string;
  responseSentAt?: ISOInstant;
  responseEvidence?: string;    // Registro de salida / acuse de recibo
  closureReason?: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

// ─────────────────────────────── Data Incidents & Breaches (Art. 33-34 RGPD) ───────────────────────────────

export type IncidentCategory =
  | 'ransomware_malware'       // Ataque de cifrado / malware
  | 'unauthorized_access'     // Acceso no autorizado / credenciales filtradas
  | 'accidental_disclosure'   // Envío erróneo / divulgación accidental
  | 'theft_loss_device'       // Pérdida o robo de soporte o dispositivo
  | 'service_outage_loss'     // Pérdida irreversible de disponibilidad o integridad
  | 'physical_security';      // Brecha de seguridad física en instalaciones

export type IncidentRiskLevel = 'unlikely_risk' | 'medium_risk' | 'high_risk';

export type AuthorityNotificationStatus =
  | 'not_applicable'          // No procede notificación por carecer de riesgo
  | 'assessing'               // En evaluación dentro del plazo
  | 'pending_submission'      // Decidida: pendiente de tramitación
  | 'submitted'               // Notificada a la AEPD (con número de registro)
  | 'justified_late';         // Notificada pasada las 72h con justificación motivada

export type SubjectNotificationStatus =
  | 'not_required'            // No supone alto riesgo para derechos y libertades
  | 'evaluating'              // En evaluación
  | 'pending_communication'   // Pendiente de comunicar a afectados
  | 'communicated';           // Comunicada a los afectados

export type IncidentStatus =
  | 'reported'                // Notificado internamente
  | 'initial_assessment'      // Evaluación inicial
  | 'containment'             // Medidas de contención aplicadas
  | 'risk_evaluated'          // Riesgo evaluado
  | 'decision_recorded'       // Decisión de notificación formalizada
  | 'actions_in_progress'     // Medidas correctoras en curso
  | 'closed';                 // Cerrado con aprobación

export interface PersonalDataIncident {
  id: ID;
  companyId: ID;
  reference: string;                 // e.g. INC-2026-003
  title: string;
  detectionTimestamp: ISOInstant;    // Momento en que se descubrió el fallo técnico
  awarenessTimestamp: ISOInstant;    // CONOCIMIENTO ORGANIZATIVO: dispara reloj 72h
  reportedBy: string;
  category: IncidentCategory;
  description: string;               // DETALLE SENSIBLE (acceso restringido)
  affectedSystems: string[];
  affectedDataCategories: string[];
  specialCategoryInvolved: boolean;
  approximateVolume: number;         // Número de registros
  approximateSubjects: number;       // Número de personas
  containmentActions: string;
  incidentOwnerId: ID;
  privacyReviewerId: ID;
  riskLevel: IncidentRiskLevel;
  riskRationale: string;
  authorityStatus: AuthorityNotificationStatus;
  authoritySubmissionRef?: string;   // Número registro AEPD (OBLIGATORIO para 'submitted')
  authoritySubmittedAt?: ISOInstant;
  lateJustification?: string;
  subjectStatus: SubjectNotificationStatus;
  subjectCommunicatedAt?: ISOInstant;
  subjectCommunicationEvidence?: string;
  correctiveActions: string;
  lessonsLearned?: string;
  status: IncidentStatus;
  restricted: boolean;               // Always true for incidents with sensitive details
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

// ─────────────────────────────── Privacy Documents & Policies ───────────────────────────────

export type DocumentType =
  | 'privacy_notice'          // Política de privacidad web / cláusula informativa
  | 'internal_policy'         // Política interna de protección de datos
  | 'dpa_processor_contract'  // Contrato de encargo de tratamiento (Art. 28)
  | 'procedure'               // Procedimiento de gestión de brechas / derechos
  | 'retention_schedule'      // Cuadro de conservación y plazos
  | 'security_instruction'    // Normativa de uso de dispositivos y contraseñas
  | 'other_evidence';

export type DocumentVersionStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'superseded' | 'archived';

export interface DocumentVersion {
  id: ID;
  documentId: ID;
  version: number;
  status: DocumentVersionStatus;
  summaryOfChanges: string;
  effectiveDate: ISODate;
  approvedBy: ID | null;
  approvedAt: ISOInstant | null;
  fileMetadata: {
    fileName: string;
    sizeBytes: number;
    mimeType: string;
  };
}

export interface PrivacyDocument {
  id: ID;
  companyId: ID;
  reference: string;          // e.g. DOC-PRI-01
  title: string;
  type: DocumentType;
  ownerId: ID;
  reviewerId: ID;
  lastReviewDate: ISODate | null;
  nextReviewDate: ISODate;
  linkedRopaIds: ID[];
  currentVersion: number;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

// ─────────────────────────────── Suppliers & Processors (Art. 28) ───────────────────────────────

export type SupplierAssessmentStatus =
  | 'not_assessed'
  | 'in_progress'
  | 'assessed_processor'           // Encargado de tratamiento
  | 'assessed_independent_controller' // Responsable independiente
  | 'assessed_joint_controller'    // Corresponsable
  | 'needs_professional_review';   // Requiere revisión por asesor

export type AgreementStatus = 'signed' | 'pending_signature' | 'negotiating' | 'missing';

export interface Supplier {
  id: ID;
  companyId: ID;
  reference: string;               // e.g. PROV-001
  name: string;
  serviceDescription: string;
  personalDataAccessed: string[];
  assessedRole: SupplierAssessmentStatus;
  assessmentRationale: string;
  assessedBy: ID | null;
  linkedRopaIds: ID[];
  agreementStatus: AgreementStatus;
  agreementVersionRef?: string;
  agreementSignedDate?: ISODate;
  subprocessorsListed: boolean;
  subprocessorsList?: string;
  internationalTransfer: boolean;
  transferDestinationCountry?: string;
  transferSafeguard?: 'scc' | 'adequacy' | 'bcr' | 'none'; // Cláusulas tipo, adecuación, etc.
  securityReviewNotes: string;
  nextReviewDate: ISODate;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

// ─────────────────────────────── Retention & Deletion Queue ───────────────────────────────

export interface RetentionPolicy {
  id: ID;
  companyId: ID;
  code: string;               // e.g. RET-001
  categoryName: string;       // Nóminas y PRL, Facturas y Contabilidad, CVs de candidatos
  purpose: string;
  system: string;
  triggerEvent: string;       // Extinción laboral, emisión de factura, fin de proceso selección
  periodMonths: number;       // e.g. 60 meses (5 años), 72 meses (6 años), 12 meses
  legalJustification: string; // Art. 30 CCom, Art. 66 LGT, Art. 4 LISOS
  policyOwnerId: ID;
  activeLegalHold: boolean;
  legalHoldReason?: string;
  nextReviewDate: ISODate;
}

export interface DeletionReviewItem {
  id: ID;
  companyId: ID;
  policyId: ID;
  recordIdentifier: string;   // e.g. Candidato CV #4012, Facturas 2018
  system: string;
  eligibleDate: ISODate;      // Fecha en que venció el plazo de retención
  status: 'pending_review' | 'blocked_legal_hold' | 'approved_erased' | 'rejected_retained';
  conflictWarning: boolean;
  decidedBy: ID | null;
  decidedAt: ISOInstant | null;
  decisionNotes?: string;
  tombstoneRef?: string;      // Identificador de registro destruido (auditoría)
}

// ─────────────────────────────── Privacy Tasks ───────────────────────────────

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskCategory =
  | 'rights_request'
  | 'incident_response'
  | 'ropa_review'
  | 'policy_review'
  | 'supplier_assessment'
  | 'retention_review'
  | 'corrective_action'
  | 'professional_review';

export interface PrivacyTask {
  id: ID;
  companyId: ID;
  title: string;
  category: TaskCategory;
  linkedEntityId?: ID;
  linkedEntityType?: string;
  assignedUserId: ID;
  dueDate: ISODate;
  priority: TaskPriority;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  notes: string;
  createdAt: ISOInstant;
  completedAt?: ISOInstant;
}

// ─────────────────────────────── Audit & Platform ───────────────────────────────

export interface AuditEvent {
  id: ID;
  seq: number;
  prevHash: string;
  hash: string;
  at: ISOInstant;
  actor: {
    userId: ID;
    name: string;
    role: RoleId;
  };
  companyId: ID;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  summary: string;
  changes?: { field: string; before: string; after: string }[];
  restricted: boolean;
}

export interface AppNotification {
  id: ID;
  companyId: ID;
  recipientUserIds: ID[];
  type: 'deadline' | 'incident' | 'task' | 'review' | 'system';
  title: string;
  body: string;
  link: string;
  createdAt: ISOInstant;
  readBy: ID[];
  dedupeKey: string;
}

// ─────────────────────────────── Complete Database ───────────────────────────────

export interface Database {
  companies: Company[];
  users: User[];
  memberships: Membership[];
  ropaActivities: ProcessingActivity[];
  rightsRequests: RightsRequest[];
  incidents: PersonalDataIncident[];
  documents: PrivacyDocument[];
  documentVersions: DocumentVersion[];
  suppliers: Supplier[];
  retentionPolicies: RetentionPolicy[];
  deletionReviews: DeletionReviewItem[];
  tasks: PrivacyTask[];
  notifications: AppNotification[];
  audit: AuditEvent[];
}

export type CollectionKey = keyof Database;
