/**
 * Labels (Spanish source text, translated at render time with t()), tones and the explicit
 * status transitions of each workflow.
 */
import type { RecordStatus } from './records';
import type { AbsenceStatus, BreakKind, ClockSource, ContractType, CorrectionKind, CorrectionStatus, EventType, WorkdayType, WorkMode } from './types';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface StatusMeta {
  label: string;
  tone: Tone;
  help: string;
}

export const RECORD_STATUS: Record<RecordStatus, StatusMeta> = {
  working: { label: 'En curso', tone: 'info', help: 'Sesión abierta: hay entrada registrada y todavía no hay salida.' },
  on_break: { label: 'En pausa', tone: 'accent', help: 'Sesión abierta con una pausa iniciada y no finalizada.' },
  incomplete: { label: 'Incompleto', tone: 'danger', help: 'Falta la hora de salida. No se completa automáticamente: requiere una corrección revisada.' },
  complete: { label: 'Completo', tone: 'success', help: 'Entrada y salida registradas.' },
  corrected: { label: 'Corregido', tone: 'warning', help: 'Tiene una corrección aprobada. Los valores originales se conservan y se pueden consultar.' },
  correction_pending: { label: 'Corrección pendiente', tone: 'warning', help: 'Hay una solicitud de corrección en revisión. Se muestran los valores vigentes hasta la decisión.' },
};

export const CORRECTION_STATUS: Record<CorrectionStatus, StatusMeta> = {
  pending: { label: 'Pendiente', tone: 'warning', help: 'Esperando la revisión de una persona autorizada.' },
  pending_employee: { label: 'Pendiente de conformidad', tone: 'warning', help: 'Propuesta por la empresa; espera la conformidad o discrepancia del empleado.' },
  approved: { label: 'Aprobada', tone: 'success', help: 'Valores aprobados aplicados. El registro original se conserva.' },
  rejected: { label: 'Rechazada', tone: 'danger', help: 'No se aplica. Consta el motivo del revisor.' },
  applied_with_disagreement: { label: 'Aplicada con discrepancia', tone: 'warning', help: 'La empresa aplicó la corrección y el empleado dejó constancia de su discrepancia.' },
  withdrawn: { label: 'Retirada', tone: 'neutral', help: 'Retirada por quien la solicitó antes de la decisión.' },
};

/** Allowed correction transitions. */
export const CORRECTION_TRANSITIONS: Record<CorrectionStatus, CorrectionStatus[]> = {
  pending: ['approved', 'rejected', 'withdrawn'],
  pending_employee: ['approved', 'applied_with_disagreement', 'withdrawn'],
  approved: [],
  rejected: [],
  applied_with_disagreement: [],
  withdrawn: [],
};

export const ABSENCE_STATUS: Record<AbsenceStatus, StatusMeta> = {
  draft: { label: 'Borrador', tone: 'neutral', help: 'No enviada. Solo la ve quien la creó.' },
  pending: { label: 'Pendiente', tone: 'warning', help: 'Enviada; espera la decisión de una persona autorizada.' },
  approved: { label: 'Aprobada', tone: 'success', help: 'Aprobada. No genera registros de asistencia.' },
  rejected: { label: 'Rechazada', tone: 'danger', help: 'Rechazada con motivo.' },
  withdrawn: { label: 'Retirada', tone: 'neutral', help: 'Retirada por el empleado antes de la decisión.' },
  cancel_requested: { label: 'Cancelación solicitada', tone: 'warning', help: 'Estaba aprobada; el empleado ha pedido cancelarla y espera decisión.' },
  cancelled: { label: 'Cancelada', tone: 'neutral', help: 'Ausencia aprobada que se canceló de forma trazada; el historial se conserva.' },
};

/** Allowed absence transitions (approved records are never deleted: they are cancelled through a request). */
export const ABSENCE_TRANSITIONS: Record<AbsenceStatus, AbsenceStatus[]> = {
  draft: ['pending', 'withdrawn'],
  pending: ['approved', 'rejected', 'withdrawn'],
  approved: ['cancel_requested', 'cancelled'],
  cancel_requested: ['cancelled', 'approved'],
  rejected: [],
  withdrawn: [],
  cancelled: [],
};

export function canTransition<S extends string>(table: Record<S, S[]>, from: S, to: S): boolean {
  return table[from]?.includes(to) ?? false;
}

export const CORRECTION_KIND_LABEL: Record<CorrectionKind, string> = {
  missing_clock_out: 'Olvidé registrar la salida',
  wrong_start: 'Hora de entrada incorrecta',
  wrong_end: 'Hora de salida incorrecta',
  missing_break: 'Falta una pausa',
  wrong_worksite: 'Centro de trabajo incorrecto',
  duplicate_event: 'Evento duplicado o inesperado',
  connectivity: 'Fallo de conexión al fichar',
  missing_session: 'Jornada trabajada sin registrar',
  other: 'Otro motivo',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  clock_in: 'Entrada',
  clock_out: 'Salida',
  break_start: 'Inicio de pausa',
  break_end: 'Fin de pausa',
};

export const SOURCE_LABEL: Record<ClockSource, string> = {
  web: 'Web',
  mobile: 'App móvil (simulada)',
  kiosk_pin: 'Terminal con PIN (simulado)',
  correction: 'Corrección aprobada',
  import: 'Importación de terminal',
};

export const MODE_LABEL: Record<WorkMode, string> = {
  onsite: 'Presencial',
  remote: 'A distancia',
};

export const BREAK_KIND_LABEL: Record<BreakKind, string> = {
  rest: 'Descanso',
  meal: 'Comida',
  other: 'Otra pausa',
};

export const WORKDAY_LABEL: Record<WorkdayType, string> = {
  full_time: 'Tiempo completo',
  part_time: 'Tiempo parcial',
};

export const CONTRACT_LABEL: Record<ContractType, string> = {
  indefinido: 'Indefinido',
  temporal: 'Temporal',
  fijo_discontinuo: 'Fijo discontinuo',
  formativo: 'Formativo',
};

export const PERIOD_STATUS: Record<'open' | 'closed', StatusMeta> = {
  open: { label: 'Abierto', tone: 'info', help: 'Se pueden registrar y revisar datos del periodo.' },
  closed: { label: 'Cerrado', tone: 'success', help: 'Resumen entregado. Las incidencias abiertas al cierre constan en cada exportación.' },
};
