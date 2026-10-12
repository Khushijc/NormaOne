import { demoHash } from './ids';
import type { AuditEvent } from './types';

export type AuditInput = Omit<AuditEvent, 'seq' | 'prevHash' | 'hash'>;

/** Builds the next event in a company's append-only chain (demo, non-cryptographic hash). */
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

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'customer.create': 'Cliente creado',
  'customer.update': 'Cliente modificado',
  'customer.archive': 'Cliente archivado',
  'customer.restore': 'Cliente reactivado',
  'supplier.create': 'Proveedor creado',
  'supplier.update': 'Proveedor modificado',
  'supplier.archive': 'Proveedor archivado',
  'supplier.restore': 'Proveedor reactivado',
  'invoice.create': 'Borrador creado',
  'invoice.update': 'Borrador modificado',
  'invoice.delete_draft': 'Borrador eliminado',
  'invoice.request_approval': 'Aprobación solicitada',
  'invoice.return': 'Devuelta al autor',
  'invoice.approve': 'Factura aprobada',
  'invoice.revoke_approval': 'Aprobación revocada',
  'invoice.issue_attempt': 'Intento de emisión',
  'invoice.issue': 'Factura emitida',
  'invoice.issue_blocked': 'Emisión bloqueada',
  'invoice.rectify_request': 'Rectificativa creada',
  'invoice.rectified': 'Original marcada como rectificada',
  'invoice.annulment_request': 'Anulación de registro solicitada',
  'fiscal.accepted': 'Registro fiscal aceptado',
  'fiscal.accepted_with_errors': 'Registro aceptado con errores',
  'fiscal.rejected': 'Registro fiscal rechazado',
  'fiscal.uncertain': 'Resultado incierto',
  'fiscal.failed': 'Fallo del proveedor',
  'fiscal.reconcile': 'Operación conciliada',
  'fiscal.resubmit': 'Reenvío (subsanación)',
  'fiscal.config': 'Simulación del proveedor cambiada',
  'delivery.send': 'Factura enviada',
  'delivery.result': 'Resultado de entrega',
  'payment.record': 'Cobro registrado',
  'payment.reverse': 'Cobro anulado',
  'dispute.open': 'Disputa abierta',
  'dispute.resolve': 'Disputa resuelta',
  'reminder.send': 'Recordatorio de cobro',
  'reminder.suppress': 'Recordatorio suprimido',
  'expense.create': 'Gasto creado',
  'expense.update': 'Gasto modificado',
  'expense.submit': 'Gasto enviado a revisión',
  'expense.approve': 'Gasto aprobado',
  'expense.reject': 'Gasto rechazado',
  'expense.pay': 'Pago de gasto registrado',
  'expense.delete_draft': 'Borrador de gasto eliminado',
  'attachment.add': 'Justificante adjuntado',
  'attachment.replace': 'Justificante sustituido (nueva versión)',
  'export.create': 'Exportación generada',
  'handover.create': 'Traspaso creado',
  'handover.check': 'Checklist de traspaso actualizado',
  'handover.deliver': 'Traspaso entregado',
  'handover.acknowledge': 'Traspaso recibido por la gestoría',
  'membership.grant': 'Acceso concedido',
  'membership.update': 'Roles modificados',
  'membership.revoke': 'Acceso revocado',
  'config.update': 'Configuración modificada',
  'series.update': 'Serie modificada',
  'session.switch_company': 'Cambio de empresa activa',
  'demo.reset': 'Datos de demostración restablecidos',
  'access.denied': 'Acceso denegado',
};
