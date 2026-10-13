/**
 * Overview dashboard translations.
 */
export const overview: Record<string, string> = {
  // Page Title & Subtitle
  'Operaciones de Privacidad · {name}': 'Privacy Operations · {name}',
  'Cuadro de mando general de cumplimiento RGPD / LOPDGDD para {nif}. Registro de tratamientos, plazos de respuesta, reloj 72h de brechas y custodia documental.': 'General GDPR / LOPDGDD compliance dashboard for {nif}. RoPA processing activities, response deadlines, 72h breach clock and document custody.',

  // KPI Card Titles & Subtitles
  'Tratamientos activos (RAT)': 'Active processing activities (RoPA)',
  '{n} tratamientos registrados': '{n} registered activities',
  'Solicitudes de derechos abiertas': 'Open rights requests',
  '{n} casos en tramitación': '{n} cases in progress',
  'Derechos próximos a vencer o vencidos': 'Rights requests approaching deadline or overdue',
  '{n} requieren atención urgente': '{n} require urgent attention',
  '{n} próximas a vencer o vencidas': '{n} approaching deadline or overdue',
  'Todas dentro del plazo mensual': 'All within calendar-month deadline',
  'Incidentes de datos activos': 'Active personal-data incidents',
  '{n} brechas en investigación': '{n} breaches under investigation',
  '{n} en curso': '{n} in progress',
  'Sin brechas abiertas': 'No open breaches',
  'Sin incidencias críticas': 'No critical incidents',
  'Decisión AEPD / Afectados pendiente': 'AEPD / Data subjects decision pending',
  'Evaluación 72h requerida': '72h assessment required',
  '{n} pendientes de decisión AEPD': '{n} pending AEPD decision',
  'Todas las decisiones adoptadas': 'All decisions adopted',
  'Políticas y documentos por revisar': 'Policies & documents awaiting review',
  '{n} políticas y contratos vigentes': '{n} active policies & contracts',
  '{n} políticas por revisar': '{n} policies to review',
  'Tareas de privacidad vencidas': 'Overdue privacy tasks',
  '{n} tareas fuera de plazo': '{n} overdue tasks',
  '{n} tareas vencidas': '{n} overdue tasks',
  '{n} tareas pendientes al día': '{n} pending tasks up to date',
  '{n} tareas pendientes totales': '{n} total pending tasks',
  'Tareas y revisiones pendientes': 'Pending tasks & reviews',

  // Incident Monitoring Card & Table
  'Vigilancia de incidentes de seguridad y reloj AEPD': 'Security incident watch & AEPD 72h clock',
  'El plazo de 72 horas para notificar a la autoridad (Art. 33 RGPD) computa desde el conocimiento organizativo de forma ininterrumpida.': 'The 72-hour deadline to notify the supervisory authority (Art. 33 GDPR) runs continuously from organisational awareness, including weekends.',
  'Incidente': 'Incident',
  'Conocimiento organizativo': 'Organisational awareness',
  'Reloj 72h': '72h Clock',
  'Estado AEPD': 'AEPD Status',
  '[Detalle restringido a Responsable/DPO]': '[Restricted detail — Privacy Lead / DPO only]',
  'Notificada a la AEPD': 'Notified to AEPD',
  'Pendiente de tramitación': 'Pending AEPD filing',
  'En evaluación (72h)': 'Under assessment (72h)',
  'En evaluación 72h': 'Under assessment (72h)',
  'No procede (sin riesgo)': 'Not applicable (No risk)',
  'No procede': 'Not applicable',

  // Rights Deadlines Card
  'Próximos vencimientos de derechos (Regla del mes natural)': 'Upcoming rights deadlines (Calendar-month rule)',
  'Plazos legales calculados conforme al Art. 12.3 RGPD': 'Statutory deadlines calculated according to Art. 12.3 GDPR',
  'No hay solicitudes de derechos pendientes en tramitación.': 'No pending rights requests currently in progress.',
  'Conflicto retención/fiscal': 'Retention/tax conflict',
  'Solicitante:': 'Requester:',
  'Recepción:': 'Receipt:',

  // Processing Attention Card
  'Tratamientos (RAT) que requieren atención': 'Processing activities (RoPA) requiring attention',
  'Campos obligatorios pendientes o validación técnica requerida': 'Mandatory fields missing or technical review needed',
  'Todas las actividades de tratamiento están debidamente validadas.': 'All processing activities are formally validated.',
  'Marcado para dictamen de asesor especializado / EIPD': 'Flagged for specialized adviser / DPIA opinion',
  'En borrador': 'In draft',

  // Document Review Card
  'Políticas y documentos que requieren revisión': 'Policies and documents requiring review',
  'Control de vigencia anual y actualización de cláusulas (Art. 24 RGPD)': 'Annual validity control and clause updates (Art. 24 GDPR)',
  'Todos los documentos y políticas están al día de revisión.': 'All documents and policies are up to date.',
  'Revisión vencida el {date}': 'Review overdue since {date}',
  'Próxima revisión: {date}': 'Next review: {date}',

  // Tasks Card
  'Tareas pendientes y revisiones prioritarias': 'Pending tasks & priority reviews',
  'Acciones operativas asignadas y seguimiento de plazos': 'Assigned operational actions and deadline monitoring',
  'No hay tareas pendientes en este momento.': 'No pending tasks at this time.',
  'Límite: {date}': 'Due: {date}',

  // Specialist Opinions Card
  'Dictámenes y revisiones profesionales pendientes': 'Outstanding professional opinions & specialist reviews',
  'Tratamientos de alto riesgo y proveedores sin evaluar como encargados': 'High-risk processing and unassessed processor relationships',
  'No hay consultas técnicas o EIPD pendientes de dictamen.': 'No technical consultations or DPIA reviews pending.',
  'Revisión legal RAT': 'RoPA legal review',
  'Posible necesidad de Evaluación de Impacto (EIPD / DPIA). Requiere informe previo del DPO.': 'Possible need for Data Protection Impact Assessment (DPIA). Requires prior DPO report.',
  'Base jurídica requiere ponderación de interés legítimo o confirmación por el asesor.': 'Legal basis requires legitimate interest assessment (LIA) or adviser confirmation.',
  'Rol Art. 28 por definir': 'Art. 28 role undefined',
  'Proveedor con acceso a datos. No se asume automáticamente encargo; requiere revisión de contrato y funciones.': 'Supplier with data access. Processing relationship is not assumed; contract and functions must be reviewed.',

  // Audit Timeline Card
  'Registro de trazabilidad y auditoría': 'Traceability and audit log (Accountability)',
  'Evidencias inmutables encadenadas criptográficamente (Art. 5.2 RGPD)': 'Immutable cryptographically chained evidence (Art. 5.2 GDPR)',
  '[Acceso auditado a registro sensible]': '[Audited access to sensitive record]',
  'Por:': 'By:',
};
