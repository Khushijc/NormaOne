/** Application shell: navigation, top bar, demo controls, notifications, guards. Keys are the Spanish source text. */
export const shell: Record<string, string> = {
  // App routes
  'Página no encontrada': 'Page not found',
  'La dirección no corresponde a ninguna pantalla de DatosPilot.': 'The address does not match any DatosPilot screen.',

  // Sidebar and navigation
  'Navegación de DatosPilot': 'DatosPilot navigation',
  'Portal de Cumplimiento Pyme': 'SME Compliance Portal',
  'PRL y Documentación': 'OHS and Documentation',
  'Visión general': 'Overview',
  'Mis tareas': 'My tasks',
  'Mi expediente': 'My record',
  'Requisitos y evidencias': 'Requirements and evidence',
  Prevención: 'Prevention',
  Control: 'Control',
  'Fuentes y pruebas': 'Sources and tests',
  'Área restringida': 'Restricted area',
  'Pendientes: {n}': 'Pending: {n}',
  'Prototipo de interfaz · datos de demostración.': 'Interface prototype · demo data.',
  'Coordina evidencias; no sustituye al servicio de prevención ni certifica el cumplimiento legal o la seguridad de los puestos.':
    'Coordinates evidence; it does not replace the prevention service or certify legal compliance or the safety of any job.',

  // Banners
  'Prototipo con datos ficticios.': 'Prototype with fictitious data.',
  'Los datos y archivos de demostración se guardan solo en este navegador (no es almacenamiento seguro). No se guardan informes clínicos.':
    'Demo data and files are stored only in this browser (not secure storage). No clinical reports are stored.',

  // Top bar, company and user switch
  'Abrir menú': 'Open menu',
  'Cambiar a modo claro': 'Switch to light mode',
  'Cambiar a modo oscuro': 'Switch to dark mode',
  'Empresa activa': 'Active company',
  'Seleccione deliberadamente la empresa': 'Select the company deliberately',
  'Sin empresas accesibles': 'No accessible companies',
  'Sin acceso vigente': 'No current access',
  'Sin acceso a esta empresa': 'No access to this company',
  'Cambio de usuario de demostración': 'Demo user switch',
  'Sustituye al inicio de sesión real (sin autenticación ni MFA en el prototipo). El cambio queda en la auditoría.':
    'Replaces a real sign-in (no authentication or MFA in the prototype). The switch is recorded in the audit log.',
  'Acceso caducado': 'Access expired',
  'Controles de demostración': 'Demo controls',
  'Restablecer datos de demostración': 'Reset demo data',
  'Se borrarán todos los cambios hechos en este navegador (documentos, decisiones, configuración) y se cargará de nuevo el conjunto de datos inicial. Esta acción no se puede deshacer.':
    'All changes made in this browser (documents, decisions, settings) will be deleted and the initial dataset will be loaded again. This cannot be undone.',
  Restablecer: 'Reset',
  'Datos de demostración restablecidos': 'Demo data reset',

  // Notifications panel
  Avisos: 'Notifications',
  'Avisos: {n} sin leer': 'Notifications: {n} unread',
  'Marcar todo leído': 'Mark all as read',
  'No hay avisos.': 'No notifications.',
  'Sin leer': 'Unread',
  'Los avisos no incluyen datos de salud ni documentos restringidos.': 'Notifications never include health data or restricted documents.',

  // Audit list
  'Sin eventos registrados': 'No events recorded',
  'Historial de auditoría': 'Audit trail',
  Destinatario: 'Recipient',

  // Export button
  'Exportación generada: {n} registros': 'Export generated: {n} records',
  'Exportar informe': 'Export report',
  'Generar y descargar': 'Generate and download',
  Formato: 'Format',
  'CSV (Excel, separador «;»)': 'CSV (Excel, “;” separator)',
  'Queda en los metadatos del archivo y en la auditoría.': 'Recorded in the file metadata and in the audit log.',
  'Uso interno': 'Internal use',
  'El archivo incluye solo lo que su rol puede ver, mantiene visibles los elementos pendientes y omite o enmascara los datos de salud y restringidos.':
    'The file includes only what your role can see, keeps pending items visible and omits or masks health and restricted data.',

  // File picker
  'Archivo demasiado grande para la demostración (máx. 10 MB).': 'File too large for the demo (max. 10 MB).',
  'No se pudo leer el archivo; se guardarán solo sus metadatos.': 'The file could not be read; only its metadata will be stored.',
  'Archivo (demostración)': 'File (demo)',
  'Archivo de demostración: se guarda solo en este navegador (no es almacenamiento seguro). Los mayores de 150 KB se guardan solo como metadatos.':
    'Demo file: stored only in this browser (not secure storage). Files over 150 KB are stored as metadata only.',
  'Cambiar archivo': 'Change file',
  'Seleccionar archivo': 'Select file',
  'solo metadatos': 'metadata only',
  'Quitar archivo': 'Remove file',

  // Bits: dates, readiness note, restricted tag
  'Sin caducidad': 'No expiry',
  'No establecida': 'Not set',
  'Revisión fijada por el evaluador': 'Review set by the assessor',
  'La disponibilidad indica que la evidencia configurada está aceptada. No es una aprobación profesional de seguridad ni certifica el cumplimiento legal.':
    'Readiness shows that the configured evidence has been accepted. It is not a professional safety approval and does not certify legal compliance.',
  'Detalle restringido': 'Restricted detail',

  // Charts
  'Sin asignaciones': 'No assignments',

  // Guards
  'Esta sección no está disponible para su rol': 'This section is not available for your role',
  'Su rol en {company} no incluye este permiso ({perms}). En producción, el servidor también rechazará cualquier acceso directo.':
    'Your role in {company} does not include this permission ({perms}). In production, the server will also reject any direct access.',
  'Sin acceso activo a esta empresa': 'No active access to this company',
  '{user} no tiene una autorización vigente en {company} (revocada, caducada o inexistente). Las lecturas, descargas y acciones están bloqueadas. Seleccione otra empresa o usuario de demostración.':
    '{user} has no current authorisation in {company} (revoked, expired or non-existent). Viewing, downloads and actions are blocked. Select another demo company or user.',
  'Registro no disponible': 'Record not available',
  'Volver a {label}': 'Back to {label}',
  'El registro no existe o no pertenece a la empresa activa. Por aislamiento entre empresas, ambos casos se muestran igual.':
    'The record does not exist or does not belong to the active company. For isolation between companies, both cases are shown the same way.',
  'Solo el personal sanitario autorizado y la coordinación de PRL pueden abrir esta área. El intento de acceso ha quedado registrado en la auditoría.':
    'Only authorised health staff and OHS coordination can open this area. The access attempt has been recorded in the audit log.',
};
