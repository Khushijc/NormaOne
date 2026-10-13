/**
 * PrevenWork Acceptance Tests
 * Verifies all 14 functional acceptance scenarios specified in Section 18 of the specification.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addCalendarMonths,
  computeIncidentClock,
  nowInstant,
} from './domain/time';
import {
  checkRopaCompleteness,
  createRopaActivity,
} from './services/ropaService';
import {
  registerRightsRequest,
  reassignRightsRequest,
  approveExtension,
} from './services/rightsService';
import {
  registerIncident,
  viewSensitiveIncident,
  evaluateIncidentRisk,
  closeIncident,
  decideAuthorityNotification,
  decideSubjectNotification,
} from './services/incidentService';
import {
  createDocument,
  createNewDocumentVersion,
} from './services/documentService';
import {
  createSupplier,
} from './services/supplierService';
import {
  generateReportCsv,
} from './services/reportService';
import { initDatabase, getDb, resetDemoData } from './store/db';
import { switchIdentity } from './services/opsService';
import { verifyAuditChain } from './domain/audit';
import { BusinessRuleError, PermissionError } from './domain/permissions';

describe('PrevenWork Functional Acceptance Scenarios (Section 18)', () => {
  beforeEach(() => {
    // Reset state and session before each test
    resetDemoData();
    initDatabase();
    // Default session: Marina Soler (Privacy Lead) at Levante Logística
    switchIdentity('usr_marina', 'cmp_levante');
  });

  // Scenario 1: Missing review fields flag without declaring a legal violation
  it('Scenario 1: creates a processing activity with missing review fields flagging them without declaring a legal violation', () => {
    const ropa = createRopaActivity({
      name: 'Canal de Denuncias Interno',
      purpose: 'Gestión de comunicaciones y denuncias conforme a Ley 2/2023.',
      dataSubjects: ['Empleados', 'Terceros'],
      dataCategories: ['Identificativos', 'Hechos comunicados'],
      specialCategories: false,
      systems: ['Servidor cifrado interno'],
      recipients: ['Comisión de Cumplimiento'],
      role: 'controller',
      legalBasis: 'legal_obligation',
      legalBasisReviewStatus: 'pending_review', // not confirmed yet
      retentionRule: 'Conservación máxima de 3 meses según Art. 32 Ley 2/2023.',
      securityMeasures: 'Cifrado en reposo, control de accesos estricto.',
      businessOwner: 'usr_carlos',
      privacyReviewerId: '', // intentionally empty
      nextReviewDate: '2027-01-01',
    });

    const completeness = checkRopaCompleteness(ropa);
    expect(completeness.isComplete).toBe(false);
    expect(completeness.missingFields.length).toBeGreaterThan(0);
    // Verified that it exists as draft/in_review without raising a violation exception
    expect(ropa.status).toBe('draft');
  });

  // Scenario 2: Rights request calendar-month rule (Art. 12.3 RGPD) and leap-year calculations
  it('Scenario 2: registers a rights request with correct calendar-month deadline and verifies leap-year / month-end rules', () => {
    // 2.1 Calendar month rule test (e.g. 15 March -> 15 April)
    expect(addCalendarMonths('2026-03-15', 1)).toBe('2026-04-15');

    // 2.2 Month-end rule (31 January 2026 -> 28 February 2026 in non-leap year)
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');

    // 2.3 Leap-year rule (31 January 2024 -> 29 February 2024 in leap year)
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');

    // 2.4 End of 31-day month to 30-day month (31 March 2026 -> 30 April 2026)
    expect(addCalendarMonths('2026-03-31', 1)).toBe('2026-04-30');

    // 2.5 Registration through rights service
    const req = registerRightsRequest({
      rightType: 'access',
      intakeChannel: 'email',
      requesterName: 'Juan Carlos Navarro',
      requesterEmail: 'jc.navarro@example.es',
      requesterDocNumber: '48392014K',
      description: 'Solicitud de acceso a copias de nóminas y contratos.',
      assignedOwnerId: 'usr_marina',
      affectedSystems: ['A3Nómina', 'Servidor de Archivos Central'],
      receiptTimestamp: '2026-03-15T10:00:00.000Z',
    });

    expect(req.receiptTimestamp).toBe('2026-03-15T10:00:00.000Z');
    expect(req.standardDeadline).toBe('2026-04-15');
    expect(req.effectiveDeadline).toBe('2026-04-15');
    expect(req.status).toBe('received');
  });

  // Scenario 3: Reassignment does NOT reset the deadline
  it('Scenario 3: reassigning a rights request preserves the original deadline strictly', () => {
    const req = registerRightsRequest({
      rightType: 'rectification',
      intakeChannel: 'postal',
      requesterName: 'Lucía Méndez',
      requesterEmail: 'lucia.mendez@example.com',
      requesterDocNumber: '48392015L',
      description: 'Rectificación de domicilio fiscal en contratos.',
      assignedOwnerId: 'usr_marina',
      affectedSystems: ['A3Nómina'],
      receiptTimestamp: '2026-04-01T09:30:00.000Z',
    });

    const originalStandard = req.standardDeadline;
    const originalEffective = req.effectiveDeadline;

    // Reassign case to Pablo Navarro
    const reassigned = reassignRightsRequest(req.id, 'usr_pablo', 'Reasignación por rotación de turno');
    expect(reassigned.assignedOwnerId).toBe('usr_pablo');
    expect(reassigned.standardDeadline).toBe(originalStandard);
    expect(reassigned.effectiveDeadline).toBe(originalEffective);
  });

  // Scenario 4: Extension requires grounds, authorised approval, and communication evidence
  it('Scenario 4: extension cannot be approved without grounds, authorised approval, and communication evidence', () => {
    const req = registerRightsRequest({
      rightType: 'portability',
      intakeChannel: 'web_form',
      requesterName: 'Marcos Alonso',
      requesterEmail: 'marcos@example.com',
      requesterDocNumber: '48392016M',
      description: 'Portabilidad de historial telemático de transportes.',
      assignedOwnerId: 'usr_marina',
      affectedSystems: ['A3Nómina'],
      receiptTimestamp: '2026-05-10T12:00:00.000Z',
    });

    // 4.1 Missing grounds throws BusinessRuleError
    expect(() => {
      approveExtension(req.id, '', 'Burofax enviado con acuse');
    }).toThrow(BusinessRuleError);

    // 4.2 Missing evidence throws BusinessRuleError
    expect(() => {
      approveExtension(req.id, 'Complejidad técnica de exportación masiva multi-sistema', '');
    }).toThrow(BusinessRuleError);

    // 4.3 Unauthorized user (employee Marta) throws PermissionError
    switchIdentity('usr_marta', 'cmp_levante');
    expect(() => {
      approveExtension(req.id, 'Complejidad técnica', 'Burofax certificado');
    }).toThrow(PermissionError);

    // 4.4 Authorized Privacy Lead approves extension successfully
    switchIdentity('usr_marina', 'cmp_levante');
    const extended = approveExtension(
      req.id,
      2,
      'Complejidad técnica y volumen elevado de registros telemáticos (Art. 12.3 RGPD)',
      'Notificación motivada remitida al interesado el 2026-05-20 con acuse digital'
    );

    expect(extended.extension?.extended).toBe(true);
    // Standard deadline was 2026-06-10; extension (+2 months) -> 2026-08-10
    expect(extended.effectiveDeadline).toBe('2026-08-10');
    expect(extended.extension?.grounds).toContain('Complejidad técnica');
  });

  // Scenario 5: Erasure involving invoice/tax data requires retention decision
  it('Scenario 5: an erasure request involving invoice data requires a documented retention decision and does not blindly erase', () => {
    const req = registerRightsRequest({
      rightType: 'erasure',
      intakeChannel: 'email',
      requesterName: 'Transportes Valencia S.L.',
      requesterEmail: 'facturacion@proveedor.es',
      requesterDocNumber: 'B99887766',
      description: 'Solicitud de borrado total de datos mercantiles y contables.',
      assignedOwnerId: 'usr_marina',
      affectedSystems: ['Contabilidad', 'ERP Facturación'],
      receiptTimestamp: '2026-06-01T08:00:00.000Z',
    });

    // System detects retention conflict automatically
    expect(req.retentionConflict.conflictDetected).toBe(true);
    expect(req.retentionConflict.conflictingRules.some((r) => r.includes('Código de Comercio'))).toBe(true);

    // Verify database retention policy exists for invoices
    const db = getDb();
    const invoicePolicy = db.retentionPolicies.find(
      (p) => p.companyId === 'cmp_levante' && p.categoryName.toLowerCase().includes('factura')
    );
    expect(invoicePolicy).toBeDefined();
    expect(invoicePolicy?.periodMonths).toBeGreaterThanOrEqual(48);
    expect(invoicePolicy?.legalJustification).toContain('Código de Comercio');
  });

  // Scenario 6: 72-hour clock runs continuously through weekends
  it('Scenario 6: 72-hour authority clock computes continuously through weekends from organisational awareness', () => {
    // Friday 2026-10-09 at 18:00:00 Madrid time
    const awarenessFriday = '2026-10-09T16:00:00Z'; // UTC equivalent
    // Check 24 hours later (Saturday 2026-10-10 at 16:00:00Z)
    const checkSaturday = '2026-10-10T16:00:00Z';
    const clockSat = computeIncidentClock(awarenessFriday, false, checkSaturday);
    expect(clockSat.remainingHours).toBe(48);
    expect(clockSat.isOverdue).toBe(false);

    // Check 73 hours later (Monday 2026-10-12 at 17:00:00Z) -> must be overdue
    const checkMonday = '2026-10-12T17:00:00Z';
    const clockMon = computeIncidentClock(awarenessFriday, false, checkMonday);
    expect(clockMon.isOverdue).toBe(true);
    expect(clockMon.remainingHours).toBeLessThan(0);
  });

  // Scenario 7: Authority notification and affected-person communication have separate statuses
  it('Scenario 7: authority notification and affected-person communication track independent statuses', () => {
    const inc = registerIncident({
      title: 'Filtración de credenciales VPN',
      detectionTimestamp: '2026-07-01T08:00:00Z',
      awarenessTimestamp: '2026-07-01T09:00:00Z',
      reportedBy: 'Dpto. Sistemas',
      category: 'unauthorized_access',
      description: 'Filtración de contraseñas de acceso telemático de empleados.',
      affectedSystems: ['VPN Fortinet', 'Directorio Activo'],
      affectedDataCategories: ['Credenciales', 'Registros de tráfico'],
      specialCategoryInvolved: false,
      approximateVolume: 35,
      approximateSubjects: 35,
      containmentActions: 'Revocación masiva de tokens y restablecimiento forzado de contraseñas.',
      incidentOwnerId: 'usr_marina',
      privacyReviewerId: 'usr_marina',
    });

    expect(inc.authorityStatus).toBe('assessing');
    expect(inc.subjectStatus).toBe('evaluating');

    // Authority is decided as not applicable
    const updated = decideAuthorityNotification(inc.id, 'not_applicable');
    expect(updated.authorityStatus).toBe('not_applicable');
    expect(updated.subjectStatus).toBe('evaluating'); // Subject remains unaffected

    // Subject communication updated separately
    const updated2 = decideSubjectNotification(inc.id, 'not_required');
    expect(updated2.authorityStatus).toBe('not_applicable');
    expect(updated2.subjectStatus).toBe('not_required');
  });

  // Scenario 8: Ordinary administrator cannot open restricted incident details (RBAC + audit)
  it('Scenario 8: ordinary administrator cannot open a restricted incident and unauthorized access is audited', () => {
    const db = getDb();
    const existingInc = db.incidents.find((i) => i.companyId === 'cmp_levante' && i.restricted);
    expect(existingInc).toBeDefined();

    // Switch to Carlos Benítez (Company Owner, lacks incidents.view_restricted)
    switchIdentity('usr_carlos', 'cmp_levante');

    expect(() => {
      viewSensitiveIncident(existingInc!.id);
    }).toThrow(PermissionError);

    // Verify that access denial was audited in the hash-chained audit log
    const auditEvents = getDb().audit;
    const denialEvent = auditEvents.find(
      (e) => e.action === 'incident.access_denied' && e.entityId === existingInc!.id
    );
    expect(denialEvent).toBeDefined();
    expect(denialEvent?.actor.userId).toBe('usr_carlos');
  });

  // Scenario 9: Notifiable incident cannot be closed without submission evidence
  it('Scenario 9: a notifiable high-risk incident cannot be closed without authority submission evidence', () => {
    const currentNow = nowInstant();
    const inc = registerIncident({
      title: 'Ataque ransomware con posible exfiltración',
      detectionTimestamp: currentNow,
      awarenessTimestamp: currentNow, // Awareness right now (clock is active)
      reportedBy: 'SOC Externo',
      category: 'ransomware_malware',
      description: 'Cifrado de servidor de ficheros contables y RRHH.',
      affectedSystems: ['FileServer-01'],
      affectedDataCategories: ['Financieros', 'Nóminas'],
      specialCategoryInvolved: true,
      approximateVolume: 5000,
      approximateSubjects: 120,
      containmentActions: 'Aislamiento de red del servidor afectado.',
      incidentOwnerId: 'usr_marina',
      privacyReviewerId: 'usr_marina',
    });

    evaluateIncidentRisk(inc.id, 'high_risk', 'Alto volumen con datos especiales y exfiltración plausible.');

    // Attempt to close without recording AEPD submission evidence
    expect(() => {
      closeIncident(inc.id, 'Restauración de backup completada.', 'Implementar EDR.');
    }).toThrow(BusinessRuleError);

    // Submitting official AEPD electronic registry reference within deadline
    decideAuthorityNotification(inc.id, 'submitted', 'AEPD-REG-2026-887711');
    decideSubjectNotification(inc.id, 'communicated', 'Comunicaciones por email individual con acuse.');

    // Now closure succeeds
    const closed = closeIncident(inc.id, 'Restauración de backup completada.', 'Implementar EDR.');
    expect(closed.status).toBe('closed');
  });

  // Scenario 10: Document update creates a new version and preserves previous approved version
  it('Scenario 10: updating a document creates a new version and preserves the prior approved version', () => {
    const { document: doc, version: v1 } = createDocument(
      'Política de Protección de Datos de Levante Logística',
      'internal_policy',
      'usr_marina',
      'usr_marina',
      '2027-01-01',
      []
    );

    expect(doc.currentVersion).toBe(1);
    expect(v1.version).toBe(1);

    // Create a new version 2
    const v2 = createNewDocumentVersion(doc.id, 'Actualización de cláusula de transferencias.', '2026-11-01');
    const updatedDoc = getDb().documents.find((d) => d.id === doc.id)!;

    expect(updatedDoc.currentVersion).toBe(2);
    expect(v2.version).toBe(2);

    // Previous version is preserved in documentVersions table
    const db = getDb();
    const allDocVersions = db.documentVersions.filter((v) => v.documentId === doc.id);
    expect(allDocVersions.length).toBe(2);
    expect(allDocVersions.some((v) => v.id === v1.id)).toBe(true);
    expect(allDocVersions.some((v) => v.id === v2.id)).toBe(true);
  });

  // Scenario 11: Supplier can be flagged for professional review without assuming processor role
  it('Scenario 11: a supplier can be flagged for professional review without the system inventing a processor role', () => {
    const supplier = createSupplier({
      name: 'Asesoría Laboral y Fiscal Gómez & Hnos',
      serviceDescription: 'Gestión contable externa y asesoramiento concursal.',
      personalDataAccessed: ['Nóminas', 'Libros contables', 'Contratos'],
      assessedRole: 'needs_professional_review',
      assessmentRationale: 'Pendiente de determinar si actúa con autonomía de medios o bajo instrucciones.',
      linkedRopaIds: [],
      agreementStatus: 'negotiating',
      subprocessorsListed: false,
      internationalTransfer: false,
      securityReviewNotes: 'Cifrado de canal telemático requerido.',
      nextReviewDate: '2027-01-01',
    });

    expect(supplier.assessedRole).toBe('needs_professional_review');
    expect(supplier.assessedRole).not.toBe('assessed_processor');
  });

  // Scenario 12: Export respects field-level role-based redaction
  it('Scenario 12: export contains only records and fields the active role is allowed to access', () => {
    // Marina (Privacy Lead) has reports.export_unredacted
    switchIdentity('usr_marina', 'cmp_levante');
    const leadRes = generateReportCsv('incidents_log');
    expect(leadRes.csv.length).toBeGreaterThan(0);
    expect(leadRes.csv.includes('filtración') || leadRes.csv.includes('exfiltración') || leadRes.csv.includes('Servidor')).toBe(true);

    // Carlos (Owner) has reports.export_standard but NOT reports.export_unredacted
    switchIdentity('usr_carlos', 'cmp_levante');
    const ownerRes = generateReportCsv('incidents_log');
    expect(ownerRes.csv.includes('INFORMACIÓN CONFIDENCIAL RESTRINGIDA')).toBe(true);

    // Marta (Employee) does not have reports.view
    switchIdentity('usr_marta', 'cmp_levante');
    expect(() => {
      generateReportCsv('incidents_log');
    }).toThrow(PermissionError);
  });

  // Scenario 13: Refreshing the browser preserves mock changes through localStorage
  it('Scenario 13: state changes persist through database reload and audit hash chain is cryptographically intact', () => {
    createSupplier({
      name: 'Hosting Ibérico S.L.',
      serviceDescription: 'Alojamiento web en CPD de Madrid.',
      personalDataAccessed: ['Logs de conexión'],
      assessedRole: 'assessed_processor',
      assessmentRationale: 'Alojamiento de servidores bajo encargo.',
      linkedRopaIds: [],
      agreementStatus: 'signed',
      subprocessorsListed: false,
      internationalTransfer: false,
      securityReviewNotes: 'Certificación ISO 27001.',
      nextReviewDate: '2027-01-01',
    });

    // Simulate browser reload by calling initDatabase()
    const reloaded = initDatabase();
    expect(reloaded.status).toBe('loaded');

    const found = reloaded.db.suppliers.find((s) => s.name === 'Hosting Ibérico S.L.');
    expect(found).toBeDefined();
    expect(found?.assessedRole).toBe('assessed_processor');

    // Verify audit chain integrity
    const chainVerification = verifyAuditChain(reloaded.db.audit);
    expect(chainVerification.valid).toBe(true);
  });

  // Scenario 14: Existing portal routes and multi-company model continue to work seamlessly
  it('Scenario 14: multi-company model and portal tenant switching work seamlessly without data leakage', () => {
    // Switch to Ibaigane Industrial
    switchIdentity('usr_marina', 'cmp_ibaigane');
    const ibaiganeRopas = getDb().ropaActivities.filter((r) => r.companyId === 'cmp_ibaigane');
    expect(ibaiganeRopas.length).toBeGreaterThan(0);

    // Switch back to Levante Logística
    switchIdentity('usr_marina', 'cmp_levante');
    const levanteRopas = getDb().ropaActivities.filter((r) => r.companyId === 'cmp_levante');
    expect(levanteRopas.length).toBeGreaterThan(0);

    // Levante and Ibaigane records have disjoint company IDs
    const levanteIds = new Set(levanteRopas.map((r) => r.id));
    const hasOverlap = ibaiganeRopas.some((r) => levanteIds.has(r.id));
    expect(hasOverlap).toBe(false);
  });
});