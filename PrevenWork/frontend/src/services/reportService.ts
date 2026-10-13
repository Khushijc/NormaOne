/**
 * Reports and Privacy Exports with Role-Based Field Redaction.
 */
import { formatDate, formatInstant } from '../domain/time';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  category: 'ropa' | 'rights' | 'incidents' | 'suppliers' | 'retention' | 'tasks';
}

export const REPORTS: ReportDefinition[] = [
  {
    id: 'ropa_inventory',
    title: 'Inventario de Actividades de Tratamiento (RAT)',
    description: 'Relación exhaustiva de tratamientos según Art. 30 RGPD con finalidades, bases jurídicas y plazos.',
    category: 'ropa',
  },
  {
    id: 'rights_register',
    title: 'Libro de Solicitudes de Derechos ARCO-POL',
    description: 'Registro cronológico de solicitudes de interesados, plazos calculados y justificación de respuestas.',
    category: 'rights',
  },
  {
    id: 'incidents_log',
    title: 'Registro de Brechas de Seguridad (Art. 33.5 RGPD)',
    description: 'Historial de incidentes, contención, dictamen de riesgo y estado de notificación a AEPD / afectados.',
    category: 'incidents',
  },
  {
    id: 'suppliers_register',
    title: 'Registro de Encargados y Proveedores (Art. 28 RGPD)',
    description: 'Catálogo de proveedores con evaluación de rol, estado de contratos DPA y transferencias internacionales.',
    category: 'suppliers',
  },
  {
    id: 'retention_inventory',
    title: 'Cuadro de Plazos de Conservación y Supresiones',
    description: 'Plazos de retención legal, bloqueos activos y constancias de borrado.',
    category: 'retention',
  },
];

export function generateReportCsv(reportId: string): { csv: string; filename: string } {
  const ctx = getServiceCtx();
  ctx.assert('reports.view', 'No tiene permisos para consultar informes.');

  const canExportUnredacted = ctx.can('reports.export_unredacted');
  let rows: Record<string, string | number>[] = [];
  let baseFilename = 'informe';

  if (reportId === 'ropa_inventory') {
    baseFilename = 'registro_tratamientos_rat';
    rows = ctx.db.ropaActivities
      .filter((r) => r.companyId === ctx.company.id)
      .map((r) => ({
        Codigo: r.code,
        Nombre: r.name,
        Finalidad: r.purpose,
        Rol_RGPD: r.role,
        Base_Juridica: r.legalBasis,
        Estado_Revision_Base: r.legalBasisReviewStatus,
        Datos_Especiales: r.specialCategories ? 'SI' : 'NO',
        Interesados: r.dataSubjects.join('; '),
        Sistemas: r.systems.join('; '),
        Destinatarios: r.recipients.join('; '),
        Plazo_Conservacion: r.retentionRule,
        Estado: r.status,
        Proxima_Revision: formatDate(r.nextReviewDate),
      }));
  } else if (reportId === 'rights_register') {
    baseFilename = 'libro_solicitudes_derechos';
    rows = ctx.db.rightsRequests
      .filter((r) => r.companyId === ctx.company.id)
      .map((r) => {
        // Redact contact details for ordinary roles if not unredacted
        const name = canExportUnredacted ? r.requesterName : `${r.requesterName.split(' ')[0]} ***`;
        const email = canExportUnredacted ? r.requesterEmail : '***@***.com';
        const doc = canExportUnredacted ? r.requesterDocNumber ?? '—' : '***REDACTADO***';

        return {
          Referencia: r.reference,
          Tipo_Derecho: r.rightType,
          Canal: r.intakeChannel,
          Fecha_Recepcion: formatInstant(r.receiptTimestamp),
          Solicitante: name,
          Email: email,
          DNI_NIE: doc,
          Plazo_Legal_Efectivo: formatDate(r.effectiveDeadline),
          Prorroga: r.extension ? `SI (+${r.extension.monthsGranted}m)` : 'NO',
          Conflicto_Retencion: r.retentionConflict.conflictDetected ? 'SI (Revisado)' : 'NO',
          Estado: r.status,
        };
      });
  } else if (reportId === 'incidents_log') {
    baseFilename = 'registro_incidentes_aepd';
    // If user lacks incidents.view_restricted, strictly redact description & special data
    rows = ctx.db.incidents
      .filter((i) => i.companyId === ctx.company.id)
      .map((i) => {
        const description = canExportUnredacted
          ? i.description
          : '[INFORMACIÓN CONFIDENCIAL RESTRINGIDA: Acceso limitado a Responsable de Privacidad y DPO]';

        return {
          Referencia: i.reference,
          Titulo: i.title,
          Categoria: i.category,
          Conocimiento_Organizativo: formatInstant(i.awarenessTimestamp),
          Nivel_Riesgo: i.riskLevel,
          AEPD_Estado: i.authorityStatus,
          AEPD_Num_Registro: canExportUnredacted ? (i.authoritySubmissionRef ?? '—') : '***',
          Afectados_Estado: i.subjectStatus,
          Aproximado_Personas: i.approximateSubjects,
          Estado: i.status,
          Descripcion_Sensible: description,
        };
      });
  } else if (reportId === 'suppliers_register') {
    baseFilename = 'registro_proveedores_encargados';
    rows = ctx.db.suppliers
      .filter((s) => s.companyId === ctx.company.id)
      .map((s) => ({
        Referencia: s.reference,
        Proveedor: s.name,
        Servicio: s.serviceDescription,
        Rol_Evaluado: s.assessedRole,
        Contrato_DPA: s.agreementStatus,
        Transferencia_Internacional: s.internationalTransfer ? 'SI' : 'NO',
        Pais_Destino: s.transferDestinationCountry ?? 'UE / EEE',
        Proxima_Revision: formatDate(s.nextReviewDate),
      }));
  } else if (reportId === 'retention_inventory') {
    baseFilename = 'cuadro_conservacion_supresion';
    rows = ctx.db.retentionPolicies
      .filter((p) => p.companyId === ctx.company.id)
      .map((p) => ({
        Codigo: p.code,
        Categoria: p.categoryName,
        Finalidad: p.purpose,
        Sistema: p.system,
        Plazo_Meses: p.periodMonths,
        Fundamentacion_Legal: p.legalJustification,
        Bloqueo_Legal_Activo: p.activeLegalHold ? 'SI' : 'NO',
        Motivo_Bloqueo: p.legalHoldReason ?? '—',
      }));
  }

  if (rows.length === 0) {
    return { csv: 'Sin registros disponibles', filename: `${baseFilename}_vacio.csv` };
  }

  // Convert to CSV with UTF-8 BOM for Spanish Excel compatibility
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(';'),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = String(row[h] ?? '').replace(/"/g, '""');
          return `"${val}"`;
        })
        .join(';')
    ),
  ];

  const csv = '\uFEFF' + csvLines.join('\r\n');
  const filename = `${baseFilename}_${ctx.company.tradeName.toLowerCase().replace(/\s+/g, '_')}_${ctx.today}.csv`;

  // Audit export execution
  transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.audit({
        action: 'report.exported_csv',
        entityType: 'Report',
        entityId: reportId,
        entityLabel: filename,
        summary: `Exportación de informe "${reportId}" generada en CSV (filas: ${rows.length}, desanonimizado: ${canExportUnredacted ? 'SI' : 'NO'}).`,
      });
    }
  );

  return { csv, filename };
}
