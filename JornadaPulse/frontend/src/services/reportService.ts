/**
 * Reports and exports (TIM-06, TIM-08). Future endpoints: GET /reports/{kind}?filters, POST /exports.
 *
 * Every dataset respects the caller's scope. Exports carry metadata (company, period, filters,
 * generation time) and DISCLOSE unresolved exceptions and pending corrections, so a payroll
 * adviser is never handed a misleadingly complete summary. Export is not payroll calculation.
 */
import { isOpenStatus, listAnomalies, ANOMALY_LABEL, ANOMALY_STATUS_LABEL } from '../domain/anomalies';
import { demoHash, newId } from '../domain/ids';
import { BusinessRuleError, PermissionError } from '../domain/permissions';
import { effectiveValues, recordStatus, relationshipOn, sessionDurations, sessionIndicators, appliedCorrections, policyForSession } from '../domain/records';
import { ABSENCE_STATUS, CORRECTION_KIND_LABEL, CORRECTION_STATUS, RECORD_STATUS, WORKDAY_LABEL } from '../domain/status';
import { eachDay, endOfMonth, formatOffset, inRange, localTime, minutesBetween, nowInstant, toHours } from '../domain/time';
import type { CorrectionRequest, Database, ExportJob, ID, ISODate, Period, WorkSession } from '../domain/types';
import { transact } from '../store/db';
import { absenceTypeLabel, countDays, visibleAbsences } from './absenceService';
import { can, employeeName, getCtx, latency, timeScope, userName, visibleEmployeeIds, type Ctx } from './context';
import { visibleCorrections } from './correctionService';

export interface Column<T> {
  key: string;
  /** Spanish header (CSV/JSON keep Spanish headers; the UI translates with t()). */
  label: string;
  value: (row: T) => string | number | null;
  /** Decimal hours: written with a decimal comma in CSV. */
  hours?: boolean;
  /** Column omitted from representative (minimised) exports. */
  personal?: boolean;
}

export interface Filters {
  from: ISODate | null;
  to: ISODate | null;
  departmentId: ID | null;
  worksiteId: ID | null;
  employeeId: ID | null;
  status: string | null;
  search: string;
}

export const EMPTY_FILTERS: Filters = { from: null, to: null, departmentId: null, worksiteId: null, employeeId: null, status: null, search: '' };

function employeeMatches(ctx: Ctx, employeeId: ID, f: Filters): boolean {
  const e = ctx.db.employees.find((x) => x.id === employeeId);
  if (!e) return false;
  if (f.employeeId && e.id !== f.employeeId) return false;
  if (f.departmentId && e.departmentId !== f.departmentId) return false;
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    if (!`${e.firstName} ${e.lastName} ${e.code}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

export function describeFilters(ctx: Ctx, f: Filters): string {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`fechas ${f.from ?? '…'} → ${f.to ?? '…'}`);
  if (f.departmentId) parts.push(`departamento ${ctx.db.departments.find((d) => d.id === f.departmentId)?.name ?? f.departmentId}`);
  if (f.worksiteId) parts.push(`centro ${ctx.db.worksites.find((w) => w.id === f.worksiteId)?.name ?? f.worksiteId}`);
  if (f.employeeId) parts.push(`empleado ${employeeName(ctx.db, f.employeeId)}`);
  if (f.status) parts.push(`estado ${f.status}`);
  if (f.search.trim()) parts.push(`búsqueda «${f.search.trim()}»`);
  return parts.length ? parts.join(' · ') : 'Sin filtros';
}

// ─────────────────────────────── Working-time records ───────────────────────────────

export interface RecordRow {
  session: WorkSession;
  employeeId: ID;
  employee: string;
  code: string;
  date: ISODate;
  worksite: string;
  start: string | null;
  end: string | null;
  startLocal: string;
  endLocal: string;
  offset: string;
  breaksCount: number;
  grossMinutes: number | null;
  breakMinutes: number;
  unpaidBreakMinutes: number;
  netMinutes: number | null;
  provisional: boolean;
  status: ReturnType<typeof recordStatus>;
  corrected: boolean;
  indicators: string[];
  policyVersion: number | null;
  updatedAt: string;
}

export function recordRows(ctx: Ctx, f: Filters, nowIso: string = nowInstant()): RecordRow[] {
  const visible = visibleEmployeeIds(ctx);
  const out: RecordRow[] = [];
  for (const s of ctx.db.sessions) {
    if (s.companyId !== ctx.company.id || !visible.has(s.employeeId)) continue;
    if (!inRange(s.date, f.from, f.to) && (f.from || f.to)) continue;
    if (!employeeMatches(ctx, s.employeeId, f)) continue;
    const v = effectiveValues(ctx.db, s);
    if (f.worksiteId && v.worksiteId !== f.worksiteId) continue;
    const status = recordStatus(ctx.db, s, nowIso);
    if (f.status && status !== f.status) continue;
    const d = sessionDurations(ctx.db, s, nowIso);
    const e = ctx.db.employees.find((x) => x.id === s.employeeId)!;
    out.push({
      session: s,
      employeeId: s.employeeId,
      employee: `${e.firstName} ${e.lastName}`,
      code: e.code,
      date: s.date,
      worksite: ctx.db.worksites.find((w) => w.id === v.worksiteId)?.name ?? '—',
      start: v.start,
      end: v.end,
      startLocal: v.start ? localTime(v.start, s.timezone) : '—',
      endLocal: v.end ? `${localTime(v.end, s.timezone)}${v.start && v.end.slice(0, 10) !== v.start.slice(0, 10) && localTime(v.end, s.timezone) < localTime(v.start, s.timezone) ? ' (+1)' : ''}` : '—',
      offset: v.start ? formatOffset(v.start, s.timezone) : '—',
      breaksCount: v.breaks.length,
      grossMinutes: d.grossMinutes,
      breakMinutes: d.breakMinutes,
      unpaidBreakMinutes: d.unpaidBreakMinutes,
      netMinutes: d.netMinutes,
      provisional: d.provisional,
      status,
      corrected: appliedCorrections(ctx.db, s).length > 0,
      indicators: sessionIndicators(ctx.db, s, nowIso).map((i) => i.code),
      policyVersion: policyForSession(ctx.db, s)?.version ?? null,
      updatedAt: s.updatedAt,
    });
  }
  return out.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
}

export const RECORD_COLUMNS: Column<RecordRow>[] = [
  { key: 'empleado', label: 'Empleado', value: (r) => r.employee },
  { key: 'codigo', label: 'Código', value: (r) => r.code },
  { key: 'fecha', label: 'Fecha', value: (r) => r.date },
  { key: 'centro', label: 'Centro', value: (r) => r.worksite },
  { key: 'entrada_local', label: 'Entrada (hora local)', value: (r) => r.startLocal },
  { key: 'salida_local', label: 'Salida (hora local)', value: (r) => r.endLocal },
  { key: 'zona', label: 'Zona horaria', value: (r) => `${r.session.timezone} ${r.offset}` },
  { key: 'entrada_utc', label: 'Entrada (UTC)', value: (r) => r.start },
  { key: 'salida_utc', label: 'Salida (UTC)', value: (r) => r.end },
  { key: 'bruto_h', label: 'Bruto (h)', value: (r) => (r.grossMinutes === null ? null : toHours(r.grossMinutes)), hours: true },
  { key: 'pausas_h', label: 'Pausas registradas (h)', value: (r) => toHours(r.breakMinutes), hours: true },
  { key: 'pausas_no_retribuidas_h', label: 'Pausas no retribuidas (h)', value: (r) => toHours(r.unpaidBreakMinutes), hours: true },
  { key: 'neto_h', label: 'Neto (h)', value: (r) => (r.netMinutes === null ? null : toHours(r.netMinutes)), hours: true },
  { key: 'provisional', label: 'Provisional (sesión abierta)', value: (r) => (r.provisional ? 'sí' : 'no') },
  { key: 'estado', label: 'Estado del registro', value: (r) => RECORD_STATUS[r.status].label },
  { key: 'corregido', label: 'Corregido', value: (r) => (r.corrected ? 'sí' : 'no') },
  { key: 'indicadores', label: 'Indicadores de revisión', value: (r) => r.indicators.join(', ') },
  { key: 'politica', label: 'Versión de política', value: (r) => r.policyVersion },
];

// ─────────────────────────────── Monthly summary ───────────────────────────────

export interface SummaryRow {
  employeeId: ID;
  employee: string;
  code: string;
  workday: string;
  weeklyHours: number | null;
  daysWorked: number;
  grossMinutes: number;
  netMinutes: number;
  plannedMinutes: number;
  incomplete: number;
  pendingCorrections: number;
  openExceptions: number;
  absenceDays: number;
}

export function periodRange(period: Period): { from: ISODate; to: ISODate } {
  return { from: `${period}-01`, to: endOfMonth(`${period}-01`) };
}

export function summaryRows(ctx: Ctx, period: Period, f: Filters = EMPTY_FILTERS, nowIso: string = nowInstant()): SummaryRow[] {
  const { from, to } = periodRange(period);
  const visible = visibleEmployeeIds(ctx);
  const anomalies = listAnomalies(ctx.db, ctx.company.id, nowIso).filter((a) => a.active && isOpenStatus(a.status) && inRange(a.date, from, to));
  const records = recordRows(ctx, { ...f, from, to, status: null }, nowIso);
  const absences = can(ctx, 'representative.view') && !can(ctx, 'absences.view_all') ? [] : visibleAbsences(ctx);
  return ctx.db.employees
    .filter((e) => e.companyId === ctx.company.id && visible.has(e.id) && employeeMatches(ctx, e.id, f))
    .filter((e) => e.hireDate <= to && (!e.endDate || e.endDate >= from))
    .map((e) => {
      const mine = records.filter((r) => r.employeeId === e.id);
      const rel = relationshipOn(ctx.db, e.id, to < ctx.today ? to : ctx.today);
      const planned = ctx.db.shifts.filter((s) => s.employeeId === e.id && s.status === 'planned' && s.date >= from && s.date <= to && s.date <= ctx.today).reduce((acc, s) => acc + minutesBetween(s.start, s.end), 0);
      return {
        employeeId: e.id,
        employee: `${e.firstName} ${e.lastName}`,
        code: e.code,
        workday: rel ? WORKDAY_LABEL[rel.workdayType] : '—',
        weeklyHours: rel?.weeklyHours ?? null,
        daysWorked: new Set(mine.map((r) => r.date)).size,
        grossMinutes: mine.reduce((acc, r) => acc + (r.end ? r.grossMinutes ?? 0 : 0), 0),
        netMinutes: mine.reduce((acc, r) => acc + (r.end ? r.netMinutes ?? 0 : 0), 0),
        plannedMinutes: planned,
        incomplete: mine.filter((r) => r.status === 'incomplete').length,
        pendingCorrections: ctx.db.corrections.filter((c) => c.employeeId === e.id && (c.status === 'pending' || c.status === 'pending_employee') && c.date >= from && c.date <= to).length,
        openExceptions: anomalies.filter((a) => a.employeeId === e.id).length,
        absenceDays: absences.filter((a) => a.employeeId === e.id && a.status === 'approved' && !a.partial && a.startDate <= to && a.endDate >= from).reduce((acc, a) => acc + countDays(ctx, e.id, a.startDate < from ? from : a.startDate, a.endDate > to ? to : a.endDate, 'working'), 0),
      };
    })
    .sort((a, b) => a.employee.localeCompare(b.employee));
}

export const SUMMARY_COLUMNS: Column<SummaryRow>[] = [
  { key: 'empleado', label: 'Empleado', value: (r) => r.employee },
  { key: 'codigo', label: 'Código', value: (r) => r.code },
  { key: 'jornada', label: 'Tipo de jornada', value: (r) => r.workday },
  { key: 'horas_semanales', label: 'Horas semanales contratadas', value: (r) => r.weeklyHours },
  { key: 'dias_trabajados', label: 'Días con registro', value: (r) => r.daysWorked },
  { key: 'bruto_h', label: 'Bruto (h)', value: (r) => toHours(r.grossMinutes), hours: true },
  { key: 'neto_h', label: 'Neto (h)', value: (r) => toHours(r.netMinutes), hours: true },
  { key: 'planificado_h', label: 'Planificado hasta hoy (h)', value: (r) => toHours(r.plannedMinutes), hours: true },
  { key: 'diferencia_h', label: 'Diferencia neto − planificado (h, indicador)', value: (r) => toHours(r.netMinutes - r.plannedMinutes), hours: true },
  { key: 'incompletos', label: 'Registros incompletos', value: (r) => r.incomplete },
  { key: 'correcciones_pendientes', label: 'Correcciones pendientes', value: (r) => r.pendingCorrections },
  { key: 'incidencias_abiertas', label: 'Incidencias abiertas', value: (r) => r.openExceptions },
  { key: 'dias_ausencia', label: 'Días laborables de ausencia aprobada', value: (r) => r.absenceDays, personal: true },
];

// ─────────────────────────────── Part-time monthly summary (ET art. 12.4.c, AC-TIM-03) ───────────────────────────────

export interface PartTimeDay {
  date: ISODate;
  sessions: number;
  netMinutes: number;
  plannedMinutes: number;
  incomplete: boolean;
}

export interface PartTimeSummary {
  employeeId: ID;
  employee: string;
  period: Period;
  weeklyHours: number | null;
  partTimePct: number | null;
  days: PartTimeDay[];
  totalNetMinutes: number;
  /** Ordinary vs complementary hours are not classified here (adviser decision; see research P4). */
  classificationNote: string;
  generatedAt: string;
  /** Content fingerprint: changes whenever any underlying record changes (demo hash). */
  version: string;
  openExceptions: number;
}

export function partTimeEmployees(ctx: Ctx, period: Period): ID[] {
  const { to } = periodRange(period);
  const visible = visibleEmployeeIds(ctx);
  return ctx.db.employees.filter((e) => e.companyId === ctx.company.id && visible.has(e.id) && relationshipOn(ctx.db, e.id, to < ctx.today ? to : ctx.today)?.workdayType === 'part_time').map((e) => e.id);
}

export function partTimeSummary(ctx: Ctx, employeeId: ID, period: Period, nowIso: string = nowInstant()): PartTimeSummary {
  if (!visibleEmployeeIds(ctx).has(employeeId)) throw new PermissionError();
  const { from, to } = periodRange(period);
  const records = recordRows(ctx, { ...EMPTY_FILTERS, from, to, employeeId }, nowIso);
  const days = eachDay(from, to).map((d) => {
    const rs = records.filter((r) => r.date === d);
    const planned = ctx.db.shifts.filter((s) => s.employeeId === employeeId && s.status === 'planned' && s.date === d).reduce((acc, s) => acc + minutesBetween(s.start, s.end), 0);
    return { date: d, sessions: rs.length, netMinutes: rs.reduce((acc, r) => acc + (r.end ? r.netMinutes ?? 0 : 0), 0), plannedMinutes: planned, incomplete: rs.some((r) => r.status === 'incomplete' || r.status === 'working' || r.status === 'on_break') };
  });
  const rel = relationshipOn(ctx.db, employeeId, to < ctx.today ? to : ctx.today);
  const openExceptions = listAnomalies(ctx.db, ctx.company.id, nowIso).filter((a) => a.active && isOpenStatus(a.status) && a.employeeId === employeeId && inRange(a.date, from, to)).length;
  const fingerprint = demoHash(JSON.stringify(records.map((r) => [r.session.id, r.start, r.end, r.netMinutes, r.status])));
  return {
    employeeId,
    employee: employeeName(ctx.db, employeeId),
    period,
    weeklyHours: rel?.weeklyHours ?? null,
    partTimePct: rel?.partTimePct ?? null,
    days,
    totalNetMinutes: days.reduce((acc, d) => acc + d.netMinutes, 0),
    classificationNote: 'Total de horas registradas día a día. La clasificación en ordinarias y complementarias depende del pacto de horas complementarias y la determina la asesoría laboral.',
    generatedAt: nowIso,
    version: fingerprint.slice(0, 8).toUpperCase(),
    openExceptions,
  };
}

// ─────────────────────────────── Absences, corrections, exceptions, planned vs actual ───────────────────────────────

export interface AbsenceRow {
  id: ID;
  employee: string;
  code: string;
  type: string;
  from: ISODate;
  to: ISODate;
  hours: string;
  status: string;
  reviewer: string;
  decision: string;
}

export function absenceRows(ctx: Ctx, f: Filters, onlyPending = false): AbsenceRow[] {
  if (!can(ctx, 'absences.view_all') && !can(ctx, 'absences.review_team') && !can(ctx, 'absences.request_own')) return [];
  return visibleAbsences(ctx)
    .filter((a) => a.status !== 'draft')
    .filter((a) => (onlyPending ? a.status === 'pending' || a.status === 'cancel_requested' : true))
    .filter((a) => employeeMatches(ctx, a.employeeId, f))
    .filter((a) => (!f.from || a.endDate >= f.from) && (!f.to || a.startDate <= f.to))
    .filter((a) => !f.status || a.status === f.status)
    .map((a) => {
      const e = ctx.db.employees.find((x) => x.id === a.employeeId)!;
      return { id: a.id, employee: `${e.firstName} ${e.lastName}`, code: e.code, type: absenceTypeLabel(ctx, a), from: a.startDate, to: a.endDate, hours: a.partial ? `${a.partial.startTime}–${a.partial.endTime}` : '', status: ABSENCE_STATUS[a.status].label, reviewer: userName(ctx.db, a.reviewerId), decision: a.decisionReason ?? '' };
    })
    .sort((a, b) => b.from.localeCompare(a.from));
}

export const ABSENCE_COLUMNS: Column<AbsenceRow>[] = [
  { key: 'empleado', label: 'Empleado', value: (r) => r.employee },
  { key: 'codigo', label: 'Código', value: (r) => r.code },
  { key: 'tipo', label: 'Tipo', value: (r) => r.type },
  { key: 'desde', label: 'Desde', value: (r) => r.from },
  { key: 'hasta', label: 'Hasta', value: (r) => r.to },
  { key: 'horas', label: 'Horario (si es por horas)', value: (r) => r.hours },
  { key: 'estado', label: 'Estado', value: (r) => r.status },
  { key: 'revisor', label: 'Revisor', value: (r) => r.reviewer },
  { key: 'decision', label: 'Motivo de la decisión', value: (r) => r.decision },
];

const span = (v: CorrectionRequest['original'], tz: string) => (v?.start ? `${localTime(v.start, tz)}–${v.end ? localTime(v.end, tz) : '…'}` : '—');

export interface CorrectionRow {
  c: CorrectionRequest;
  employee: string;
  original: string;
  requested: string;
  approved: string;
  reviewer: string;
}

export function correctionRows(ctx: Ctx, f: Filters): CorrectionRow[] {
  return visibleCorrections(ctx)
    .filter((c) => employeeMatches(ctx, c.employeeId, f) && (!f.from || c.date >= f.from) && (!f.to || c.date <= f.to) && (!f.status || c.status === f.status))
    .map((c) => ({ c, employee: employeeName(ctx.db, c.employeeId), original: span(c.original, ctx.company.timezone), requested: span(c.requested, ctx.company.timezone), approved: c.approved ? span(c.approved, ctx.company.timezone) : '—', reviewer: userName(ctx.db, c.reviewerId) }))
    .sort((a, b) => b.c.requestedAt.localeCompare(a.c.requestedAt));
}

export const CORRECTION_COLUMNS: Column<CorrectionRow>[] = [
  { key: 'empleado', label: 'Empleado', value: (r) => r.employee },
  { key: 'fecha', label: 'Fecha del registro', value: (r) => r.c.date },
  { key: 'tipo', label: 'Tipo', value: (r) => CORRECTION_KIND_LABEL[r.c.kind] },
  { key: 'iniciada_por', label: 'Iniciada por', value: (r) => (r.c.initiatedBy === 'company' ? 'empresa' : 'empleado') },
  { key: 'estado', label: 'Estado', value: (r) => CORRECTION_STATUS[r.c.status].label },
  { key: 'original', label: 'Valor original', value: (r) => r.original },
  { key: 'solicitado', label: 'Valor solicitado', value: (r) => r.requested },
  { key: 'aprobado', label: 'Valor aprobado', value: (r) => r.approved },
  { key: 'revisor', label: 'Revisor', value: (r) => r.reviewer },
  { key: 'motivo', label: 'Motivo de la decisión', value: (r) => r.c.decisionReason ?? '' },
];

export interface ExceptionRow {
  key: string;
  employee: string;
  date: ISODate;
  type: string;
  status: string;
  assignee: string;
  reason: string;
}

export function exceptionRows(ctx: Ctx, f: Filters, onlyOpen = true): ExceptionRow[] {
  const visible = visibleEmployeeIds(ctx);
  if (!can(ctx, 'anomalies.view_all') && !can(ctx, 'anomalies.manage_team')) return [];
  return listAnomalies(ctx.db, ctx.company.id)
    .filter((a) => visible.has(a.employeeId) && (!onlyOpen || (a.active && isOpenStatus(a.status))) && employeeMatches(ctx, a.employeeId, f) && (!f.from || a.date >= f.from) && (!f.to || a.date <= f.to))
    .map((a) => ({ key: a.key, employee: employeeName(ctx.db, a.employeeId), date: a.date, type: ANOMALY_LABEL[a.type], status: ANOMALY_STATUS_LABEL[a.status], assignee: userName(ctx.db, a.assigneeId), reason: interpolate(a.reason.text, a.reason.params) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}

export const EXCEPTION_COLUMNS: Column<ExceptionRow>[] = [
  { key: 'empleado', label: 'Empleado', value: (r) => r.employee },
  { key: 'fecha', label: 'Fecha', value: (r) => r.date },
  { key: 'tipo', label: 'Tipo', value: (r) => r.type },
  { key: 'estado', label: 'Estado', value: (r) => r.status },
  { key: 'asignada', label: 'Asignada a', value: (r) => r.assignee },
  { key: 'motivo', label: 'Motivo de la revisión', value: (r) => r.reason },
];

export interface PlanVsActualRow {
  employeeId: ID;
  employee: string;
  plannedMinutes: number;
  actualNetMinutes: number;
  shiftsWithoutRecord: number;
  sessionsWithoutShift: number;
}

export function planVsActualRows(ctx: Ctx, f: Filters, nowIso: string = nowInstant()): PlanVsActualRow[] {
  const from = f.from ?? '0000-01-01';
  const to = f.to ?? '9999-12-31';
  const records = recordRows(ctx, { ...f, status: null }, nowIso);
  const visible = visibleEmployeeIds(ctx);
  return ctx.db.employees
    .filter((e) => e.companyId === ctx.company.id && visible.has(e.id) && employeeMatches(ctx, e.id, f))
    .map((e) => {
      const shifts = ctx.db.shifts.filter((s) => s.employeeId === e.id && s.status === 'planned' && s.date >= from && s.date <= to && s.end <= nowIso);
      const mine = records.filter((r) => r.employeeId === e.id);
      const dates = new Set(mine.map((r) => r.date));
      const shiftDates = new Set(shifts.map((s) => s.date));
      return {
        employeeId: e.id,
        employee: `${e.firstName} ${e.lastName}`,
        plannedMinutes: shifts.reduce((acc, s) => acc + minutesBetween(s.start, s.end), 0),
        actualNetMinutes: mine.reduce((acc, r) => acc + (r.end ? r.netMinutes ?? 0 : 0), 0),
        shiftsWithoutRecord: shifts.filter((s) => !dates.has(s.date)).length,
        sessionsWithoutShift: mine.filter((r) => !shiftDates.has(r.date)).length,
      };
    })
    .filter((r) => r.plannedMinutes > 0 || r.actualNetMinutes > 0)
    .sort((a, b) => a.employee.localeCompare(b.employee));
}

export const PLAN_COLUMNS: Column<PlanVsActualRow>[] = [
  { key: 'empleado', label: 'Empleado', value: (r) => r.employee },
  { key: 'planificado_h', label: 'Planificado (h)', value: (r) => toHours(r.plannedMinutes), hours: true },
  { key: 'registrado_neto_h', label: 'Registrado neto (h)', value: (r) => toHours(r.actualNetMinutes), hours: true },
  { key: 'diferencia_h', label: 'Diferencia (h, indicador)', value: (r) => toHours(r.actualNetMinutes - r.plannedMinutes), hours: true },
  { key: 'turnos_sin_registro', label: 'Turnos sin registro', value: (r) => r.shiftsWithoutRecord },
  { key: 'sesiones_sin_turno', label: 'Sesiones sin turno', value: (r) => r.sessionsWithoutShift },
];

// ─────────────────────────────── Period close ───────────────────────────────

export interface PeriodStatusInfo {
  period: Period;
  status: 'open' | 'closed' | 'not_started';
  openExceptions: number;
  pendingCorrections: number;
  pendingAbsences: number;
  incompleteRecords: number;
  record: Database['periods'][number] | null;
}

export function periodStatus(ctx: Ctx, period: Period, nowIso: string = nowInstant()): PeriodStatusInfo {
  const { from, to } = periodRange(period);
  const record = ctx.db.periods.find((p) => p.companyId === ctx.company.id && p.period === period) ?? null;
  const anomalies = listAnomalies(ctx.db, ctx.company.id, nowIso).filter((a) => a.active && isOpenStatus(a.status) && inRange(a.date, from, to));
  const recs = recordRows({ ...ctx, perms: new Set([...ctx.perms, 'time.view_all']) }, { ...EMPTY_FILTERS, from, to }, nowIso);
  return {
    period,
    status: record?.status ?? 'not_started',
    openExceptions: anomalies.length,
    pendingCorrections: ctx.db.corrections.filter((c) => c.companyId === ctx.company.id && (c.status === 'pending' || c.status === 'pending_employee') && inRange(c.date, from, to)).length,
    pendingAbsences: ctx.db.absences.filter((a) => a.companyId === ctx.company.id && (a.status === 'pending' || a.status === 'cancel_requested') && a.startDate <= to && a.endDate >= from).length,
    incompleteRecords: recs.filter((r) => r.status === 'incomplete').length,
    record,
  };
}

/** Closing requires an active recording protocol and explicit acknowledgement of any open item. */
export async function closePeriod(period: Period, note: string, acknowledgeOpenItems: boolean): Promise<void> {
  await latency();
  const ctx = getCtx();
  if (!can(ctx, 'periods.close')) throw new PermissionError();
  const info = periodStatus(ctx, period);
  if (info.status === 'closed') throw new BusinessRuleError('El periodo ya está cerrado.');
  if (`${period}-01` > ctx.today) throw new BusinessRuleError('No se puede cerrar un periodo futuro.');
  if (!ctx.db.protocols.some((p) => p.companyId === ctx.company.id && p.status === 'active')) throw new BusinessRuleError('No hay un protocolo de registro aprobado (ET art. 34.9): configúrelo antes de cerrar.');
  const open = info.openExceptions + info.pendingCorrections + info.incompleteRecords;
  if (open > 0 && !acknowledgeOpenItems) throw new BusinessRuleError('Hay elementos abiertos: confirme que se declararán en el cierre y en cada exportación.');
  if (open > 0 && note.trim().length < 10) throw new BusinessRuleError('Explique las incidencias abiertas que se declaran al cerrar.');
  const at = nowInstant();
  transact(ctx.actor, ctx.company.id, (tx) => {
    const entry = { at, by: ctx.user.id, action: 'closed', note: note.trim() || null };
    if (info.record) tx.update('periods', info.record.id, (p): Partial<typeof p> => ({ status: 'closed', closedBy: ctx.user.id, closedAt: at, openExceptionsAtClose: open, closeNote: note.trim() || null, history: [...p.history, entry] }));
    else tx.insert('periods', { id: newId('per'), companyId: ctx.company.id, period, status: 'closed', closedBy: ctx.user.id, closedAt: at, openExceptionsAtClose: open, closeNote: note.trim() || null, reopenedBy: null, reopenedAt: null, reopenReason: null, history: [entry] });
    tx.audit({ action: 'period.close', entityType: 'period', entityId: period, entityLabel: period, summary: `Periodo ${period} cerrado con ${open} elementos abiertos declarados.`, reason: note.trim() || null });
  });
}

export async function reopenPeriod(period: Period, reason: string): Promise<void> {
  await latency();
  const ctx = getCtx();
  if (!can(ctx, 'periods.close')) throw new PermissionError();
  const p = ctx.db.periods.find((x) => x.companyId === ctx.company.id && x.period === period);
  if (!p || p.status !== 'closed') throw new BusinessRuleError('El periodo no está cerrado.');
  if (reason.trim().length < 10) throw new BusinessRuleError('Explique el motivo de la reapertura.');
  const at = nowInstant();
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.update('periods', p.id, (x): Partial<typeof x> => ({ status: 'open', reopenedBy: ctx.user.id, reopenedAt: at, reopenReason: reason.trim(), history: [...x.history, { at, by: ctx.user.id, action: 'reopened', note: reason.trim() }] }));
    tx.audit({ action: 'period.reopen', entityType: 'period', entityId: period, entityLabel: period, summary: `Periodo ${period} reabierto. Las exportaciones anteriores se conservan.`, reason: reason.trim() });
  });
}

// ─────────────────────────────── Export files ───────────────────────────────

export interface ExportMeta {
  empresa: string;
  nif: string;
  informe: string;
  periodo: string | null;
  filtros: string;
  generado: string;
  generado_por: string;
  zona_horaria: string;
  incidencias_abiertas: number;
  correcciones_pendientes: number;
  minimizado: boolean;
  aviso: string;
}

export const EXPORT_NOTICE = 'Datos de demostración. Exportación de registros revisados con incidencias declaradas; no es un cálculo de nómina. Las horas son decimales (separador coma en CSV).';

function csvCell(v: string | number | null, hours: boolean | undefined): string {
  let s = v === null || v === undefined ? '' : typeof v === 'number' && hours ? v.toFixed(2).replace('.', ',') : String(v);
  if (/[;"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Spanish CSV: ';' separator, decimal comma, UTF-8 BOM, metadata as leading "#" lines. */
export function toCSV<T>(rows: T[], columns: Column<T>[], meta: ExportMeta): string {
  const head = Object.entries(meta).map(([k, v]) => `# ${k}: ${String(v ?? '')}`);
  const lines = [columns.map((c) => csvCell(c.label, false)).join(';'), ...rows.map((r) => columns.map((c) => csvCell(c.value(r), c.hours)).join(';'))];
  return '﻿' + [...head, ...lines].join('\r\n');
}

export function toJSON<T>(rows: T[], columns: Column<T>[], meta: ExportMeta): string {
  return JSON.stringify({ meta, records: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.value(r)]))) }, null, 2);
}

export function downloadFile(fileName: string, content: string, mime: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportRequest<T> {
  kind: string;
  title: string;
  format: 'csv' | 'json';
  rows: T[];
  columns: Column<T>[];
  filters: string;
  period: string | null;
  /** Restrict to the caller's own records (employee self-service export). */
  own?: boolean;
  download?: boolean;
}

export interface ExportResult {
  job: ExportJob;
  content: string;
}

/** Generates the file, records an ExportJob and an audit event. Representatives receive minimised exports. */
export async function createExport<T>(req: ExportRequest<T>): Promise<ExportResult> {
  await latency(200);
  const ctx = getCtx();
  const representative = timeScope(ctx) === 'representative';
  if (req.own) {
    if (!can(ctx, 'reports.own')) throw new PermissionError();
  } else if (!can(ctx, 'reports.export') && !representative) throw new PermissionError();
  const columns = representative ? req.columns.filter((c) => !c.personal) : req.columns;
  const anomalies = listAnomalies(ctx.db, ctx.company.id).filter((a) => a.active && isOpenStatus(a.status));
  const scopeIds = visibleEmployeeIds(ctx);
  const at = nowInstant();
  const meta: ExportMeta = {
    empresa: ctx.company.legalName,
    nif: ctx.company.nif,
    informe: req.title,
    periodo: req.period,
    filtros: req.filters,
    generado: at,
    generado_por: ctx.user.name,
    zona_horaria: ctx.company.timezone,
    incidencias_abiertas: anomalies.filter((a) => scopeIds.has(a.employeeId) && (!req.own || a.employeeId === ctx.employee?.id)).length,
    correcciones_pendientes: ctx.db.corrections.filter((c) => c.companyId === ctx.company.id && scopeIds.has(c.employeeId) && (c.status === 'pending' || c.status === 'pending_employee') && (!req.own || c.employeeId === ctx.employee?.id)).length,
    minimizado: representative,
    aviso: EXPORT_NOTICE,
  };
  const content = req.format === 'csv' ? toCSV(req.rows, columns, meta) : toJSON(req.rows, columns, meta);
  const stamp = at.slice(0, 16).replace(/[-:T]/g, '');
  const fileName = `jornadapulse_${req.kind}_${req.period ?? 'filtrado'}_${stamp}.${req.format}`;
  const job: ExportJob = { id: newId('exp'), companyId: ctx.company.id, kind: req.kind, format: req.format, fileName, filters: req.filters, period: req.period, recordCount: req.rows.length, openExceptions: meta.incidencias_abiertas, generatedBy: ctx.user.id, generatedAt: at, fingerprint: demoHash(content), minimised: representative };
  transact(ctx.actor, ctx.company.id, (tx) => {
    tx.insert('exports', job);
    tx.audit({ action: 'export.create', entityType: 'export', entityId: job.id, entityLabel: fileName, summary: `${job.recordCount} registros · ${req.filters} · ${meta.incidencias_abiertas} incidencias abiertas declaradas · huella demo ${job.fingerprint}`, reason: null });
  });
  if (req.download !== false) downloadFile(fileName, content, req.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
  return { job, content };
}
