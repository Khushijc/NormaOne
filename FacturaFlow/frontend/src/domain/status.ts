import type {
  CollectionStatus,
  DocumentStatus,
  ExchangeStatus,
  ExpenseReviewStatus,
  FiscalOperationState,
  FiscalStatus,
} from './types';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** Plain-language explanation shown in tooltips and the status legend. */
  help: string;
}

/**
 * The four invoice status tracks are independent (BRD §07, FIN-04). They must never be
 * collapsed into a single "compliant" status.
 */
export const DOCUMENT_STATUS: Record<DocumentStatus, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral', help: 'Editable. Aún no tiene número ni efectos fiscales.' },
  approved: { label: 'Aprobada', tone: 'info', help: 'Revisada por una persona autorizada; lista para emitir. Todavía no es una factura expedida.' },
  issued: { label: 'Emitida', tone: 'success', help: 'Expedida con número definitivo. No se puede modificar ni eliminar; solo rectificar.' },
  rectified: { label: 'Rectificada', tone: 'warning', help: 'Factura emitida que tiene una o más facturas rectificativas vinculadas. El original se conserva sin cambios.' },
};

export const FISCAL_STATUS: Record<FiscalStatus, StatusMeta> = {
  not_submitted: { label: 'Sin registro', tone: 'neutral', help: 'No se ha generado ni enviado registro de facturación.' },
  pending: { label: 'Pendiente', tone: 'info', help: 'Enviado al proveedor fiscal (simulado); a la espera de respuesta.' },
  accepted: { label: 'Aceptado', tone: 'success', help: 'El proveedor simulado devolvió el registro como correcto. No es una respuesta real de la AEAT.' },
  rejected: { label: 'Rechazado', tone: 'danger', help: 'El registro fue rechazado. Requiere corrección y nuevo envío; existe una excepción asignada.' },
  needs_review: {
    label: 'Requiere revisión',
    tone: 'warning',
    help: 'Aceptado con errores o resultado incierto (p. ej. tiempo de espera agotado). Debe conciliarse antes de cualquier nuevo intento.',
  },
};

export const EXCHANGE_STATUS: Record<ExchangeStatus, StatusMeta> = {
  not_sent: { label: 'No enviada', tone: 'neutral', help: 'La factura no se ha enviado al cliente.' },
  sent: { label: 'Enviada', tone: 'info', help: 'Enviada por el canal configurado; sin confirmación de entrega.' },
  delivered: { label: 'Entregada', tone: 'success', help: 'El canal confirmó la entrega. Entregada no significa aceptada ni cobrada.' },
  delivery_failed: { label: 'Error de entrega', tone: 'danger', help: 'El envío falló. Reintente o use otro canal.' },
  accepted: { label: 'Aceptada por cliente', tone: 'success', help: 'Aceptación comercial comunicada por un canal que lo admite (factura electrónica B2B, condicional).' },
  rejected: { label: 'Rechazada por cliente', tone: 'danger', help: 'Rechazo comercial comunicado por un canal que lo admite (factura electrónica B2B, condicional).' },
};

export const COLLECTION_STATUS: Record<CollectionStatus, StatusMeta> = {
  unpaid: { label: 'Pendiente de cobro', tone: 'neutral', help: 'No se ha registrado ningún cobro.' },
  partial: { label: 'Cobro parcial', tone: 'warning', help: 'Se han registrado cobros por un importe inferior al total a cobrar.' },
  paid: { label: 'Cobrada', tone: 'success', help: 'Los cobros registrados cubren el importe total a cobrar.' },
  disputed: { label: 'En disputa', tone: 'danger', help: 'Existe una disputa abierta; los recordatorios pueden estar suspendidos.' },
};

export const FISCAL_OPERATION_STATE: Record<FiscalOperationState, StatusMeta> = {
  in_flight: { label: 'En curso', tone: 'info', help: 'Solicitud enviada al proveedor simulado.' },
  accepted: { label: 'Correcto', tone: 'success', help: 'Respuesta simulada: registro correcto.' },
  accepted_with_errors: { label: 'Aceptado con errores', tone: 'warning', help: 'Respuesta simulada: registrado con errores que deben subsanarse.' },
  rejected: { label: 'Incorrecto', tone: 'danger', help: 'Respuesta simulada: registro no aceptado.' },
  uncertain: { label: 'Resultado incierto', tone: 'warning', help: 'Sin respuesta (tiempo de espera). Concilie consultando la clave de operación antes de reintentar.' },
  not_processed: { label: 'No procesado', tone: 'neutral', help: 'La conciliación confirmó que el proveedor no procesó la solicitud. Puede reintentarse con la misma clave.' },
  failed: { label: 'Fallo técnico', tone: 'danger', help: 'El proveedor no estaba disponible. No se generó ningún registro.' },
};

export const EXPENSE_REVIEW_STATUS: Record<ExpenseReviewStatus, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral', help: 'Pendiente de enviar a revisión.' },
  submitted: { label: 'En revisión', tone: 'info', help: 'Enviado; a la espera de aprobación por una persona autorizada.' },
  approved: { label: 'Aprobado', tone: 'success', help: 'Aprobado. La aprobación no determina el tratamiento fiscal: lo valida la gestoría.' },
  rejected: { label: 'Rechazado', tone: 'danger', help: 'Rechazado con motivo. Puede corregirse y reenviarse.' },
};

export const EXPENSE_PAYMENT_STATUS: Record<'unpaid' | 'paid' | 'reimbursed', StatusMeta> = {
  unpaid: { label: 'Pendiente de pago', tone: 'neutral', help: 'No se ha registrado el pago o reembolso.' },
  paid: { label: 'Pagado', tone: 'success', help: 'Pago al proveedor registrado.' },
  reimbursed: { label: 'Reembolsado', tone: 'success', help: 'Reembolso al empleado registrado.' },
};
