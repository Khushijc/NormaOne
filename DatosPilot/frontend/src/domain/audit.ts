import { demoHash } from './ids';
import type { AuditEvent } from './types';

export type AuditInput = Omit<AuditEvent, 'seq' | 'prevHash' | 'hash'>;

/**
 * Builds the next event in the append-only chain (PLT-06, SEC-05).
 * Demo, non-cryptographic hash: browser storage cannot be tamper-proof. A production backend
 * must use SHA-256 with write-once storage.
 */
export function chainAuditEvent(prev: AuditEvent | undefined, input: AuditInput): AuditEvent {
  const prevHash = prev?.hash ?? '0000000000000000';
  const seq = (prev?.seq ?? 0) + 1;
  const body = JSON.stringify({ ...input, seq, prevHash });
  return { ...input, seq, prevHash, hash: demoHash(body) };
}

/** Recomputes the chain to detect edits to stored events (demo integrity check). */
export function verifyAuditChain(events: AuditEvent[]): { ok: boolean; brokenAt: number | null } {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let prev: AuditEvent | undefined;
  for (const e of sorted) {
    const { seq, prevHash, hash, ...input } = e;
    const expectedPrev = prev?.hash ?? '0000000000000000';
    const recomputed = demoHash(JSON.stringify({ ...input, seq, prevHash }));
    if (prevHash !== expectedPrev || recomputed !== hash) return { ok: false, brokenAt: seq };
    prev = e;
  }
  return { ok: true, brokenAt: null };
}

/** Spanish labels for audit actions (translated at render time with t()). */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'requirement.create': 'Requisito creado (borrador)',
  'requirement.version': 'Nueva versión de requisito',
  'requirement.submit': 'Requisito enviado a aprobación profesional',
  'requirement.approve': 'Requisito aprobado',
  'requirement.reject': 'Aprobación de requisito rechazada',
  'requirement.activate': 'Requisito activado',
  'requirement.retire': 'Requisito retirado',
  'requirement.assign': 'Requisito asignado',
  'requirement.unassign': 'Asignación de requisito finalizada',
  'requirement.not_applicable': 'Requisito marcado como no aplicable',
  'requirement.applicable_again': 'Decisión de no aplicabilidad revocada',
  'evidence.request': 'Evidencia solicitada',
  'evidence.request_cancel': 'Solicitud de evidencia cancelada',
  'evidence.submit': 'Documento presentado',
  'evidence.replace': 'Nueva versión de documento presentada',
  'evidence.review_start': 'Revisión de documento iniciada',
  'evidence.accept': 'Evidencia aceptada',
  'evidence.reject': 'Evidencia rechazada',
  'evidence.supersede': 'Versión sustituida',
  'evidence.dates': 'Fechas del documento revisadas',
  'evidence.download': 'Descarga de documento (demo)',
  'evidence.quarantine': 'Documento enviado a cuarentena',
  'acknowledgement.record': 'Confirmación de información registrada',
  'training.assign': 'Formación asignada',
  'training.schedule': 'Formación programada',
  'training.attendance': 'Asistencia a formación registrada',
  'training.completion': 'Finalización de formación registrada',
  'training.cancel': 'Formación cancelada',
  'course.save': 'Curso del catálogo guardado',
  'equipment.save': 'Equipo del catálogo guardado',
  'ppe.issue': 'Equipo entregado',
  'ppe.return': 'Equipo devuelto',
  'ppe.replace': 'Equipo sustituido',
  'ppe.lost': 'Equipo marcado como perdido',
  'assessment.register': 'Evaluación de riesgos registrada',
  'assessment.submit': 'Evaluación enviada a revisión',
  'assessment.review_start': 'Revisión de evaluación iniciada',
  'assessment.accept': 'Evaluación aceptada',
  'assessment.return': 'Evaluación devuelta',
  'assessment.review_required': 'Evaluación marcada para revisión',
  'assessment.supersede': 'Evaluación sustituida por nueva versión',
  'action.create': 'Acción preventiva creada',
  'action.assign': 'Acción preventiva asignada',
  'action.progress': 'Avance de acción registrado',
  'action.submit': 'Acción enviada a revisión',
  'action.accept': 'Resolución de acción aceptada',
  'action.reject': 'Resolución de acción rechazada',
  'action.reopen': 'Acción reabierta',
  'cae.create': 'Caso CAE creado',
  'cae.update': 'Caso CAE actualizado',
  'cae.participant': 'Participante CAE añadido',
  'cae.exchange': 'Intercambio CAE registrado',
  'cae.sent': 'Información CAE enviada',
  'cae.received': 'Recepción CAE confirmada',
  'cae.acknowledged': 'Acuse de comprensión CAE registrado',
  'cae.review': 'Información CAE revisada',
  'cae.link_create': 'Enlace de acceso CAE creado (simulado)',
  'cae.link_revoke': 'Enlace de acceso CAE revocado',
  'cae.link_access': 'Acceso por enlace CAE (simulado)',
  'cae.close': 'Caso CAE cerrado',
  'employee.update': 'Datos del empleado modificados',
  'employee.assignment': 'Puesto o centros del empleado modificados',
  'change.review': 'Revisión de cambios completada',
  'worksite.create': 'Centro de trabajo creado',
  'worksite.update': 'Centro de trabajo modificado',
  'worksite.deactivate': 'Centro de trabajo desactivado',
  'worksite.activate': 'Centro de trabajo reactivado',
  'readiness.change': 'Cambio de disponibilidad',
  'readiness.confirm': 'Asignación confirmada como lista',
  'readiness.exception': 'Excepción autorizada registrada',
  'readiness.exception_revoke': 'Excepción revocada',
  'health.offer': 'Oferta de vigilancia de la salud registrada',
  'health.response': 'Respuesta a la oferta registrada',
  'health.conclusion': 'Conclusión de aptitud registrada',
  'health.measures_confirmed': 'Medidas preventivas aplicadas',
  'health.access_denied': 'Acceso restringido denegado',
  'health.view': 'Consulta del área restringida',
  'quarantine.handle': 'Documento en cuarentena gestionado',
  'exception.update': 'Incidencia revisada',
  'export.create': 'Exportación generada',
  'settings.update': 'Configuración modificada',
  'session.switch': 'Cambio de usuario o empresa (demo)',
  'demo.seed': 'Datos de demostración cargados',
};
