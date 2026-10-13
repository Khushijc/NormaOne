/**
 * Navigation, sidebar, topbar, user switcher and shell chrome translations.
 */
export const shell: Record<string, string> = {
  // Brand & Module Headings
  'Portal de Cumplimiento Pyme': 'SME Compliance Portal',
  'Privacidad · RGPD / LOPDGDD': 'Privacy · GDPR / LOPDGDD',
  'Privacidad y Protección de Datos': 'Privacy & Data-Protection Operations',
  'Navegación de PrevenWork': 'PrevenWork navigation',

  // Sidebar Sections & Items
  'Panel y operaciones': 'Dashboard & Operations',
  'Políticas y cadena de custodia': 'Policies & Chain of Custody',
  'Control y auditoría': 'Control & Audit',
  'Visión general': 'Overview',
  'Registro de tratamientos (RAT)': 'Processing Activities (RoPA)',
  'Solicitudes de derechos': 'Data Subject Rights Requests',
  'Incidentes de datos': 'Personal-Data Incidents',
  'Documentos y políticas': 'Privacy Documents & Policies',
  'Proveedores y encargados': 'Suppliers & Processors',
  'Conservación y supresión': 'Data Retention & Erasure',
  'Revisiones y tareas': 'Reviews & Task Centre',
  'Informes y exportaciones': 'Reports & Exports',
  'Auditoría inmutable': 'Immutable Audit Trail',
  'Configuración': 'Settings',

  // Sidebar Footer & Disclaimer
  'Prototipo de operaciones de privacidad (RGPD / LOPDGDD).': 'Privacy operations prototype (GDPR / LOPDGDD).',
  'Este software coordina evidencias operativas para pymes españolas; no constituye asesoramiento jurídico ni garantiza el cumplimiento regulatorio.': 'This software coordinates operational evidence for Spanish SMEs; it does not constitute legal advice or guarantee regulatory compliance.',
  'Pendientes: {n}': 'Pending: {n}',
  'Acceso restringido a incidentes': 'Restricted incident access',

  // Demo Banner
  'Prototipo interactivo con datos ficticios.': 'Interactive prototype with fictitious data.',
  'Los cambios se persisten en el almacenamiento local de este navegador (localStorage). Sin conexión con la AEPD ni envío real de correos electrónicos.': 'Changes persist in this browser’s local storage (localStorage). No live connection to AEPD or actual email delivery.',

  // TopBar
  'Abrir menú': 'Open menu',
  'Módulos del portal': 'Portal modules',
  'Módulos': 'Modules',
  'Suite de Cumplimiento super_one': 'super_one Compliance Suite',
  'Activo': 'Active',
  'Empresa activa': 'Active company',
  'Seleccione la empresa para operar': 'Select company to operate',
  'Sin empresas accesibles': 'No accessible companies',
  'Sin acceso vigente': 'No active access',
  'Sin acceso': 'No access',
  'Cambiar a modo claro': 'Switch to light mode',
  'Cambiar a modo oscuro': 'Switch to dark mode',
  'Idioma de la interfaz': 'Interface language',
  'Cambiar a inglés': 'Switch to English',
  'Cambiar a español': 'Switch to Spanish',

  // Notifications
  'Notificaciones': 'Notifications',
  'Notificaciones del sistema': 'System notifications',
  'Marcar todas como leídas': 'Mark all as read',
  'No hay notificaciones pendientes.': 'No pending notifications.',
  'Notificación marcada como leída.': 'Notification marked as read.',
  'Avisos: {n} sin leer': 'Alerts: {n} unread',
  'Avisos': 'Alerts',
  'sin leer': 'unread',
  'Sin leer': 'Unread',
  'No hay avisos pendientes.': 'No pending alerts.',
  'Los avisos no incluyen datos sensibles de incidentes.': 'Alerts do not include sensitive incident details.',

  // User Switcher & Identity
  'Cambiar de usuario (Demo)': 'Switch user (Demo)',
  'Roles y permisos simulados en sesión local': 'Simulated roles and permissions in local session',
  'Usuario activo': 'Active user',
  'Cambio de rol de demostración': 'Demo role change',
  'Permite verificar cómo responde la interfaz a los diferentes permisos (Titular, Responsable de Privacidad, Tramitador, Empleado, DPO Asesor o Auditor).': 'Allows verifying how the UI responds to different roles (Owner, Privacy Lead, Case Handler, Employee, DPO Adviser, or Auditor).',
  'Acceso caducado': 'Access expired',
  'Controles de demostración': 'Demo controls',
  'Restablecer datos iniciales': 'Reset initial data',
  'Restablecer datos de demostración': 'Reset demo data',
  'Se restablecerá la base de datos de demostración de PrevenWork a su estado inicial. Se perderán las modificaciones locales guardadas en este navegador.': 'PrevenWork demonstration database will be reset to its initial state. Local modifications stored in this browser will be lost.',
  'Restablecer': 'Reset',
  'Datos restablecidos al estado inicial': 'Data reset to initial state',
  'Reiniciar datos de demo': 'Reset demo data',
  'Restablecer base de datos local': 'Reset local database',
  '¿Desea restablecer todos los registros a los valores iniciales de la demostración? Se perderán las modificaciones locales.': 'Do you want to reset all records to initial demonstration values? Local modifications will be lost.',
  'Datos restablecidos a la muestra inicial.': 'Data reset to initial sample.',
  'Restablecer demo': 'Reset demo',
  'Sin membresía activa': 'No active membership',
  'El usuario no dispone de un rol asignado en la empresa activa.': 'The user has no assigned role in the active company.',

  // Guards
  'Su rol actual ({role}) no dispone de los permisos necesarios para acceder a esta sección. Utilice el selector de usuario en la barra superior si desea probar la vista con otro perfil de demostración.': 'Your current role ({role}) does not have the necessary permissions to access this section. Use the user switcher in the topbar to test with another demo profile.',
  'Volver al registro general': 'Back to general register',
  'El contenido sensible y la descripción técnica de las brechas de seguridad están reservados estrictamente al Responsable de Privacidad y al DPO / Asesor de Protección de Datos (Art. 33.5 RGPD). Los intentos de inspección quedan registrados en la auditoría.': 'Sensitive content and technical descriptions of security breaches are strictly reserved for the Privacy Lead and DPO / Data Protection Adviser (Art. 33.5 GDPR). Inspection attempts are recorded in the audit trail.',
  'El usuario seleccionado no tiene una asignación vigente en esta empresa. Seleccione otra empresa o cambie de usuario en el menú superior.': 'The selected user has no active assignment in this company. Select another company or switch users in the top menu.',
};
