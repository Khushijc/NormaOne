/**
 * Anomaly detection (BRD §09 step 3, TIM-03). Anomalies are review requests, never findings
 * of misconduct. They are DERIVED from the data on every read; only the human review
 * (assignee, status, history) is stored, keyed by a deterministic key. Resolving an anomaly
 * never edits or deletes the original record.
 */
import { index } from './indexes';
import { effectiveValues, policyForSession, sessionDurations, sessionState } from './records';
import { addDays, localDate, minutesBetween, nowInstant } from './time';
import type { AnomalyReview, AnomalyStatus, AnomalyType, Database, DetectedAnomaly, ID } from './types';

export type { DetectedAnomaly };

export interface Anomaly extends DetectedAnomaly {
  status: AnomalyStatus;
  assigneeId: ID | null;
  review: AnomalyReview | null;
  /** Detected now (false = only the stored review remains because the data changed). */
  active: boolean;
}

export const ANOMALY_LABEL: Record<AnomalyType, string> = {
  missing_clock_out: 'Falta la salida',
  missing_clock_in: 'Turno planificado sin registro',
  overlapping_sessions: 'Sesiones solapadas',
  duplicate_event: 'Evento duplicado',
  long_session: 'Sesión inusualmente larga',
  short_session: 'Sesión inusualmente corta',
  off_schedule: 'Diferencia con el turno planificado',
  unplanned_session: 'Sesión sin turno planificado',
  short_rest: 'Descanso entre jornadas por debajo del umbral',
  pending_correction: 'Corrección sin revisar',
  shift_absence_conflict: 'Turno y ausencia coinciden',
  not_recorded: 'Fichaje no registrado',
};

export const ANOMALY_STATUS_LABEL: Record<AnomalyStatus, string> = {
  open: 'Abierta',
  acknowledged: 'Reconocida',
  investigating: 'En investigación',
  resolved: 'Resuelta',
  dismissed: 'Descartada',
};

const DAY = 86_400_000;

export function detectAnomalies(db: Database, companyId: ID, nowIso: string = nowInstant()): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = [];
  const sessions = db.sessions.filter((s) => s.companyId === companyId);

  const values = new Map(sessions.map((s) => [s.id, effectiveValues(db, s)]));

  for (const s of sessions) {
    const v = values.get(s.id)!;
    const policy = policyForSession(db, s);
    const th = policy?.indicators;
    const state = sessionState(db, s, nowIso);
    if (state === 'incomplete') {
      out.push({ key: `mco:${s.id}`, type: 'missing_clock_out', companyId, employeeId: s.employeeId, date: s.date, ref: { kind: 'session', id: s.id }, severity: 'high', reason: { text: 'La sesión no tiene hora de salida {h} h después de la entrada. Se muestra como incompleta; no se completa automáticamente.', params: { h: th?.missingClockOutAfterHours ?? 14 } } });
    }
    if (v.end && th) {
      const d = sessionDurations(db, s, nowIso);
      if ((d.grossMinutes ?? 0) > th.longSessionHours * 60) {
        out.push({ key: `long:${s.id}`, type: 'long_session', companyId, employeeId: s.employeeId, date: s.date, ref: { kind: 'session', id: s.id }, severity: 'medium', reason: { text: 'Duración bruta superior a {h} h (umbral configurable de la política v{v}).', params: { h: th.longSessionHours, v: policy!.version } } });
      }
      if ((d.grossMinutes ?? 0) < th.shortSessionMinutes) {
        out.push({ key: `short:${s.id}`, type: 'short_session', companyId, employeeId: s.employeeId, date: s.date, ref: { kind: 'session', id: s.id }, severity: 'low', reason: { text: 'Duración bruta inferior a {m} min (umbral configurable).', params: { m: th.shortSessionMinutes } } });
      }
    }
    // Duplicate events: same type within 2 minutes in the same session (e.g. imported kiosk double tap).
    const evs = [...(index(db).eventsBySession.get(s.id) ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 1; i < evs.length; i++) {
      if (evs[i].type === evs[i - 1].type && Math.abs(minutesBetween(evs[i - 1].at, evs[i].at)) <= 2) {
        out.push({ key: `dup:${evs[i].id}`, type: 'duplicate_event', companyId, employeeId: s.employeeId, date: s.date, ref: { kind: 'session', id: s.id }, severity: 'low', reason: { text: 'Dos eventos del mismo tipo con menos de 2 minutos de diferencia (recibo {r}).', params: { r: evs[i].receipt } } });
      }
    }
    // Planned vs actual.
    if (v.start) {
      const shifts = db.shifts.filter((sh) => sh.employeeId === s.employeeId && sh.status === 'planned' && sh.date === s.date);
      if (!shifts.length) {
        out.push({ key: `unpl:${s.id}`, type: 'unplanned_session', companyId, employeeId: s.employeeId, date: s.date, ref: { kind: 'session', id: s.id }, severity: 'low', reason: { text: 'Hay trabajo registrado en un día sin turno planificado. Puede ser correcto (cambio de turno, urgencia).' } });
      } else {
        const sh = shifts.reduce((best, x) => (Math.abs(minutesBetween(x.start, v.start!)) < Math.abs(minutesBetween(best.start, v.start!)) ? x : best));
        const diff = minutesBetween(sh.start, v.start);
        if (Math.abs(diff) > 60) {
          out.push({ key: `offs:${s.id}`, type: 'off_schedule', companyId, employeeId: s.employeeId, date: s.date, ref: { kind: 'session', id: s.id }, severity: 'low', reason: { text: 'La entrada difiere {m} min del turno planificado.', params: { m: diff } } });
        } else if (v.worksiteId && sh.worksiteId !== v.worksiteId) {
          out.push({ key: `offs:${s.id}`, type: 'off_schedule', companyId, employeeId: s.employeeId, date: s.date, ref: { kind: 'session', id: s.id }, severity: 'low', reason: { text: 'El centro registrado no coincide con el del turno planificado.' } });
        }
      }
    }
  }

  // Overlapping sessions (same employee).
  const byEmp = new Map<ID, typeof sessions>();
  sessions.forEach((s) => byEmp.set(s.employeeId, [...(byEmp.get(s.employeeId) ?? []), s]));
  for (const list of byEmp.values()) {
    const sorted = list.filter((s) => values.get(s.id)!.start).sort((a, b) => values.get(a.id)!.start!.localeCompare(values.get(b.id)!.start!));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = values.get(sorted[i].id)!;
        const b = values.get(sorted[j].id)!;
        const aEnd = a.end ?? nowIso;
        if (b.start! >= aEnd) break;
        out.push({ key: `ovl:${sorted[i].id}:${sorted[j].id}`, type: 'overlapping_sessions', companyId, employeeId: sorted[i].employeeId, date: sorted[j].date, ref: { kind: 'session', id: sorted[j].id }, severity: 'high', reason: { text: 'Dos sesiones del mismo empleado se solapan en el tiempo.' } });
      }
    }
  }

  // Planned shifts in the past without any recorded work (not on approved absence or holiday).
  for (const sh of db.shifts.filter((x) => x.companyId === companyId && x.status === 'planned' && new Date(x.end).getTime() < new Date(nowIso).getTime() - 2 * 3600_000)) {
    if (new Date(nowIso).getTime() - new Date(sh.end).getTime() > 45 * DAY) continue;
    const worked = sessions.some((s) => s.employeeId === sh.employeeId && (s.date === sh.date || s.date === addDays(sh.date, -1)) && values.get(s.id)!.start);
    const onLeave = db.absences.some((a) => a.employeeId === sh.employeeId && a.status === 'approved' && sh.date >= a.startDate && sh.date <= a.endDate);
    if (!worked && !onLeave) {
      out.push({ key: `mci:${sh.id}`, type: 'missing_clock_in', companyId, employeeId: sh.employeeId, date: sh.date, ref: { kind: 'shift', id: sh.id }, severity: 'medium', reason: { text: 'Había un turno planificado y no consta ningún registro de trabajo ni ausencia aprobada. El turno no se convierte en tiempo trabajado.' } });
    }
  }

  // Shift vs absence conflicts (approved or pending absences).
  for (const a of db.absences.filter((x) => x.companyId === companyId && (x.status === 'approved' || x.status === 'pending' || x.status === 'cancel_requested'))) {
    for (const sh of db.shifts.filter((x) => x.employeeId === a.employeeId && x.status === 'planned' && x.date >= a.startDate && x.date <= a.endDate)) {
      if (a.partial) continue;
      out.push({ key: `conf:${sh.id}:${a.id}`, type: 'shift_absence_conflict', companyId, employeeId: a.employeeId, date: sh.date, ref: { kind: 'absence', id: a.id }, severity: a.status === 'approved' ? 'medium' : 'low', reason: { text: 'Hay un turno planificado en un día con ausencia {status}. Revise la planificación.', params: { status: a.status === 'approved' ? 'aprobada' : 'pendiente' } } });
    }
  }

  // Corrections waiting for review for more than one day.
  for (const c of db.corrections.filter((x) => x.companyId === companyId && (x.status === 'pending' || x.status === 'pending_employee'))) {
    if (new Date(nowIso).getTime() - new Date(c.requestedAt).getTime() < DAY) continue;
    out.push({ key: `corr:${c.id}`, type: 'pending_correction', companyId, employeeId: c.employeeId, date: c.date, ref: { kind: 'correction', id: c.id }, severity: 'medium', reason: { text: c.status === 'pending' ? 'Solicitud de corrección pendiente de revisión desde hace más de 24 h.' : 'Corrección propuesta por la empresa pendiente de la conformidad del empleado.' } });
  }

  // Failed (not recorded) clocking attempts without a correction request.
  for (const f of db.failedAttempts.filter((x) => x.companyId === companyId && !x.correctionId)) {
    out.push({ key: `nrec:${f.id}`, type: 'not_recorded', companyId, employeeId: f.employeeId, date: localDate(f.attemptedAt), ref: { kind: 'failed_attempt', id: f.id }, severity: 'high', reason: { text: 'Un intento de fichaje no se pudo registrar (fallo de conexión simulado). Debe completarse mediante una solicitud de corrección.' } });
  }

  return out;
}

/** Detected anomalies merged with their stored review; reviewed-but-no-longer-detected ones are kept as history. */
export function listAnomalies(db: Database, companyId: ID, nowIso?: string): Anomaly[] {
  const detected = detectAnomalies(db, companyId, nowIso);
  const reviews = new Map(db.anomalyReviews.filter((r) => r.companyId === companyId).map((r) => [r.key, r]));
  const seen = new Set<string>();
  const out: Anomaly[] = [];
  for (const d of detected) {
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    const r = reviews.get(d.key) ?? null;
    out.push({ ...d, status: r?.status ?? 'open', assigneeId: r?.assigneeId ?? null, review: r, active: true });
  }
  // Keep history for anomalies whose condition disappeared (e.g. resolved by an approved correction).
  for (const r of reviews.values()) {
    if (seen.has(r.key) || !r.snapshot) continue;
    out.push({ ...r.snapshot, status: r.status === 'open' ? 'resolved' : r.status, assigneeId: r.assigneeId, review: r, active: false });
  }
  return out;
}

export function isOpenStatus(s: AnomalyStatus): boolean {
  return s === 'open' || s === 'acknowledged' || s === 'investigating';
}
