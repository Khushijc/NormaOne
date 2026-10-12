/**
 * Read-only derivations for the team screens. Everything is computed from the shared services
 * and domain helpers; nothing here writes data.
 */
import { isOpenStatus } from '../../domain/anomalies';
import { index } from '../../domain/indexes';
import { relationshipOn, sessionState } from '../../domain/records';
import type { Tone } from '../../domain/status';
import { addDays } from '../../domain/time';
import type { Database, EmploymentRelationship, ID } from '../../domain/types';
import { tKey } from '../../i18n';
import type { Ctx } from '../../services/context';
import { visibleCorrections } from '../../services/correctionService';
import { visibleAnomalies } from '../../services/opsService';

export type TodayState = 'working' | 'on_break' | 'incomplete' | 'complete' | 'none';

export const TODAY_STATE: Record<TodayState, { label: string; tone: Tone; help: string; order: number }> = {
  working: { label: tKey('Trabajando'), tone: 'info', help: tKey('Hay una entrada registrada sin salida.'), order: 0 },
  on_break: { label: tKey('En pausa'), tone: 'accent', help: tKey('Sesión abierta con una pausa iniciada.'), order: 1 },
  incomplete: { label: tKey('Sin salida'), tone: 'danger', help: tKey('La sesión de hoy no tiene salida y supera el umbral de la política. No se completa automáticamente.'), order: 2 },
  complete: { label: tKey('Completado'), tone: 'success', help: tKey('Hoy consta al menos una sesión con entrada y salida.'), order: 3 },
  none: { label: tKey('Sin registro'), tone: 'neutral', help: tKey('Hoy no consta ningún registro. Un turno planificado o una ausencia no se muestran como tiempo trabajado.'), order: 4 },
};

/** Today's recording state from actual sessions only (never from planned shifts or absences). */
export function todayState(db: Database, employeeId: ID, today: string): TodayState {
  const yesterday = addDays(today, -1);
  let complete = false;
  let incomplete = false;
  for (const s of index(db).sessionsByEmployee.get(employeeId) ?? []) {
    if (s.date !== today && s.date !== yesterday) continue;
    const st = sessionState(db, s);
    // An overnight session started yesterday that is still open counts as live today.
    if (st === 'working' || st === 'on_break') return st;
    if (s.date !== today) continue;
    if (st === 'complete') complete = true;
    if (st === 'incomplete') incomplete = true;
  }
  return incomplete ? 'incomplete' : complete ? 'complete' : 'none';
}

/** Terms in force today, or the latest version when none is in force (e.g. after the end date). */
export function currentRelationship(db: Database, employeeId: ID, today: string): EmploymentRelationship | undefined {
  return relationshipOn(db, employeeId, today) ?? db.relationships.filter((r) => r.employeeId === employeeId).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export interface OpenItems {
  corrections: number;
  anomalies: number;
}

/** Pending corrections and open review indicators per employee, within the caller's scope. */
export function openItemsByEmployee(ctx: Ctx): Map<ID, OpenItems> {
  const out = new Map<ID, OpenItems>();
  const get = (id: ID) => {
    let x = out.get(id);
    if (!x) out.set(id, (x = { corrections: 0, anomalies: 0 }));
    return x;
  };
  for (const c of visibleCorrections(ctx)) if (c.status === 'pending' || c.status === 'pending_employee') get(c.employeeId).corrections++;
  for (const a of visibleAnomalies(ctx)) if (a.active && isOpenStatus(a.status)) get(a.employeeId).anomalies++;
  return out;
}
