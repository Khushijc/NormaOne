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
  'time.clock_in': 'Entrada registrada',
  'time.clock_out': 'Salida registrada',
  'time.break_start': 'Inicio de pausa',
  'time.break_end': 'Fin de pausa',
  'time.not_recorded': 'Fichaje no registrado',
  'correction.request': 'Corrección solicitada',
  'correction.propose': 'Corrección propuesta por la empresa',
  'correction.approve': 'Corrección aprobada',
  'correction.reject': 'Corrección rechazada',
  'correction.withdraw': 'Corrección retirada',
  'correction.employee_response': 'Respuesta del empleado a la corrección',
  'absence.create': 'Ausencia creada',
  'absence.submit': 'Ausencia solicitada',
  'absence.approve': 'Ausencia aprobada',
  'absence.reject': 'Ausencia rechazada',
  'absence.withdraw': 'Ausencia retirada',
  'absence.cancel_request': 'Cancelación de ausencia solicitada',
  'absence.cancel': 'Ausencia cancelada',
  'absence.cancel_denied': 'Cancelación de ausencia denegada',
  'shift.create': 'Turno planificado',
  'shift.update': 'Turno modificado',
  'shift.cancel': 'Turno cancelado',
  'policy.version': 'Nueva versión de política',
  'policy.agreement': 'Convenio de referencia modificado',
  'calendar.update': 'Calendario laboral modificado',
  'absence_type.update': 'Tipo de ausencia modificado',
  'protocol.update': 'Protocolo de registro modificado',
  'employee.create': 'Empleado dado de alta',
  'employee.update': 'Empleado modificado',
  'employee.deactivate': 'Empleado desactivado',
  'employee.activate': 'Empleado reactivado',
  'relationship.version': 'Condiciones laborales actualizadas',
  'anomaly.update': 'Incidencia revisada',
  'period.close': 'Periodo cerrado',
  'period.reopen': 'Periodo reabierto',
  'export.create': 'Exportación generada',
  'retention.delete_blocked': 'Eliminación bloqueada por conservación',
  'membership.update': 'Acceso modificado',
  'membership.revoke': 'Acceso revocado',
  'session.switch': 'Cambio de usuario o empresa (demo)',
  'demo.seed': 'Datos de demostración cargados',
};
