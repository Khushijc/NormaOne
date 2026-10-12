/**
 * Small pure helpers and label tables for the "Turnos y horarios" screens.
 * Labels are Spanish source keys (tKey) translated at render time with t().
 */
import type { Tone } from '../../domain/status';
import type { CollectiveAgreementReference, Database, Employee, Holiday, ID, IndicatorThresholds, ISODate, Worksite, WorkingTimePolicy } from '../../domain/types';
import { tKey } from '../../i18n';

/** Compact worksite label for planner cells (full name goes in the tooltip). */
export function shortSiteName(name: string): string {
  const base = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (base.length <= 18) return base;
  // Keep the distinctive tail ("… Torre Turia"), but never start on a connector ("and warehouse").
  const words = base.split(/\s+/);
  let start = Math.max(0, words.length - 2);
  while (start > 0 && !/^[\p{Lu}\d]/u.test(words[start])) start--;
  return words.slice(start).join(' ');
}

export function fullName(e: Pick<Employee, 'firstName' | 'lastName'>): string {
  return `${e.firstName} ${e.lastName}`;
}

export function byName(a: Employee, b: Employee): number {
  return fullName(a).localeCompare(fullName(b), 'es');
}

export function worksiteById(db: Database, id: ID | null | undefined): Worksite | undefined {
  return id ? db.worksites.find((w) => w.id === id) : undefined;
}

export const HOLIDAY_SCOPE_LABEL: Record<Holiday['scope'], string> = {
  national: tKey('Nacional'),
  regional: tKey('Autonómico'),
  local: tKey('Local'),
  company: tKey('De empresa'),
};

export const HOLIDAY_SCOPE_TONE: Record<Holiday['scope'], Tone> = {
  national: 'info',
  regional: 'accent',
  local: 'success',
  company: 'neutral',
};

export const REVIEW_STATUS: Record<CollectiveAgreementReference['reviewStatus'], { label: string; tone: Tone; help: string }> = {
  reference_only: { label: tKey('Solo referencia'), tone: 'neutral', help: tKey('Se guarda como referencia; no hay reglas configuradas a partir de su contenido.') },
  pending_review: { label: tKey('Pendiente de revisión'), tone: 'warning', help: tKey('La asesoría laboral todavía no ha revisado el convenio.') },
  adviser_reviewed: { label: tKey('Revisado por la asesoría'), tone: 'success', help: tKey('Consta quién lo revisó y cuándo. No certifica el cumplimiento.') },
};

export const WORKSITE_KIND_LABEL: Record<Worksite['kind'], string> = {
  own: tKey('Propio'),
  customer: tKey('Cliente'),
};

export interface ThresholdDef {
  key: Exclude<keyof IndicatorThresholds, 'nightStart' | 'nightEnd'>;
  label: string;
  unit: 'h' | 'min';
  help: string;
}

/** Numeric review-indicator thresholds, in display order. The night band is shown separately. */
export const THRESHOLDS: ThresholdDef[] = [
  { key: 'dailyOrdinaryMaxHours', label: tKey('Jornada diaria de referencia'), unit: 'h', help: tKey('Indicador «Jornada larga» cuando el tiempo efectivo del día supera este valor (ET art. 34.3: 9 h salvo otra distribución pactada).') },
  { key: 'minRestBetweenDaysHours', label: tKey('Descanso entre jornadas'), unit: 'h', help: tKey('Indicador «Descanso corto» por debajo de este valor (ET art. 34.3: 12 h como mínimo general).') },
  { key: 'continuousWorkBreakAfterHours', label: tKey('Pausa esperada tras'), unit: 'h', help: tKey('Jornada continuada a partir de la cual se espera una pausa registrada (ET art. 34.4).') },
  { key: 'minBreakMinutes', label: tKey('Pausa mínima'), unit: 'min', help: tKey('Duración de pausa registrada por debajo de la cual se muestra «Sin pausa». Nunca se descuenta una pausa no registrada.') },
  { key: 'longSessionHours', label: tKey('Sesión larga'), unit: 'h', help: tKey('Incidencia para revisar cuando la duración bruta supera este valor.') },
  { key: 'shortSessionMinutes', label: tKey('Sesión corta'), unit: 'min', help: tKey('Incidencia para revisar cuando la duración bruta es inferior a este valor.') },
  { key: 'missingClockOutAfterHours', label: tKey('Sesión sin salida'), unit: 'h', help: tKey('Una sesión abierta más tiempo que este valor se muestra como incompleta. Nunca se completa automáticamente.') },
];

export type PolicyPhase = 'in_force' | 'scheduled' | 'ended' | 'draft';

export function policyPhase(p: WorkingTimePolicy, today: ISODate): PolicyPhase {
  if (p.status === 'draft') return 'draft';
  if (p.effectiveFrom > today) return 'scheduled';
  if (p.effectiveTo && p.effectiveTo < today) return 'ended';
  return 'in_force';
}

export const POLICY_PHASE: Record<PolicyPhase, { label: string; tone: Tone; help: string }> = {
  in_force: { label: tKey('Vigente hoy'), tone: 'success', help: tKey('Versión que se aplica a los registros de hoy.') },
  scheduled: { label: tKey('Programada'), tone: 'info', help: tKey('Se aplicará a partir de su fecha de efecto.') },
  ended: { label: tKey('Sustituida'), tone: 'neutral', help: tKey('Ya no se aplica a fechas nuevas; sigue aplicándose a los registros de su periodo.') },
  draft: { label: tKey('Borrador'), tone: 'neutral', help: tKey('Sin efecto.') },
};
