/**
 * Reports & Exports translations.
 */
export const reports: Record<string, string> = {
  'Informes y Exportaciones de Privacidad': 'Privacy Reports & Exports',
  'Generación de libros oficiales para inspección de la AEPD y cuadros de mando. Las exportaciones aplican redacción y anonimización de campos sensibles según el rol activo.': 'Generation of statutory books for AEPD inspections and executive dashboards. Exports apply redaction and anonymization of sensitive fields based on active role.',

  // Redaction Banners
  'Modo Completo / Sin Redacción': 'Full Unredacted Mode',
  'Modo Redactado por Rol': 'Role-Redacted Mode',
  'Rol con acceso completo a datos confidenciales ({role})': 'Role with full access to confidential data ({role})',
  'Redacción de seguridad activa para el rol {role}': 'Security redaction active for role {role}',
  'Esta exportación contendrá todos los detalles de incidentes y datos de personas físicas autorizados para su perfil directivo/DPO.': 'This export will contain full incident details and natural person data authorized for your executive/DPO profile.',
  'Los campos de datos personales especialmente protegidos, títulos de incidentes restringidos y descripciones confidenciales se sustituirán por marcas de redacción [REDACTADO].': 'Special category personal data fields, restricted incident titles, and confidential descriptions will be replaced with [REDACTED] markers.',
  'Como Responsable de Privacidad o DPO, sus informes contienen los datos íntegros de interesados y descripciones sensibles de incidentes requeridos para trámites ante la AEPD.': 'As Privacy Lead or DPO, your reports contain full data subject details and sensitive incident descriptions required for AEPD procedures.',
  'Los datos identificativos de interesados (emails, DNI), las descripciones técnicas de brechas y datos de categoría especial se anonimizan automáticamente para preservar el secreto profesional.': 'Data subject identifiers (emails, IDs), technical breach descriptions, and special category data are automatically anonymized to preserve professional secrecy.',

  // Report Selector
  'Seleccione el informe o libro oficial': 'Select statutory report or book',
  'Libro oficial de RAT (Art. 30 RGPD)': 'Official RoPA Register (Art. 30 GDPR)',
  'Registro de ejercicio de derechos (Art. 12-22)': 'Rights Requests Register (Art. 12-22)',
  'Registro de brechas de seguridad (Art. 33.5)': 'Security Incidents & Breaches Register (Art. 33.5)',
  'Inventario de contratos y encargados (Art. 28)': 'Processors & Contracts Inventory (Art. 28)',
  'Trazabilidad y auditoría legal (Art. 5.2)': 'Traceability & Legal Audit Trail (Art. 5.2)',
  'Cuadro de conservación y bloqueos': 'Retention & Legal Holds Schedule',
  'Seleccionado': 'Selected',

  // Descriptions
  'Exporta el inventario completo de actividades de tratamiento con sus bases jurídicas, colectivos, categorías de datos, medidas de seguridad y plazos.': 'Exports the complete inventory of processing activities with their legal bases, data subjects, data categories, safeguards, and retention rules.',
  'Libro cronológico de solicitudes de derechos recibidas, plazos de mes natural, prórrogas de 2 meses, resoluciones y evidencias de respuesta.': 'Chronological register of rights requests received, calendar-month deadlines, 2-month extensions, resolutions, and delivery evidence.',
  'Registro preceptivo conforme al Art. 33.5 RGPD con efectos, medidas correctoras adoptadas y cómputo de 72 horas para AEPD.': 'Mandatory register under Art. 33.5 GDPR with breach effects, corrective actions taken, and 72-hour computation for AEPD.',
  'Relación de proveedores de servicios con acceso a datos, calificación de rol (Art. 28), estado de firma de DPA y garantías internacionales.': 'Register of service providers with data access, role classification (Art. 28), DPA execution status, and international transfer safeguards.',
  'Libro inmutable de pistas de auditoría encadenadas con resúmenes, actores, marcas temporales e identificadores de verificación.': 'Immutable ledger of cryptographically chained audit trails with summaries, actors, timestamps, and verification hashes.',
  'Cuadro de plazos mercantiles/fiscales, bloqueos cautelares aplicados y supresiones ejecutadas con tombstone.': 'Schedule of commercial/tax periods, applied precautionary holds, and erasures executed with tombstones.',

  // Table Preview
  'Vista previa de los datos exportables (primeras filas)': 'Export data preview (first rows)',
  'Vista previa de las primeras líneas del archivo generado:': 'Preview of the first lines of the generated file:',
  'Descargar informe CSV': 'Download CSV report',
  'No hay registros disponibles para este informe.': 'No records available for this report.',

  // Feedback
  'Exportación CSV generada (Versión íntegra autorizada).': 'CSV export generated (Full authorized unredacted version).',
  'Exportación CSV generada con campos confidenciales anonimizados según su rol.': 'CSV export generated with confidential fields anonymized based on your role.',
};
