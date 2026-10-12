/**
 * Calendario: day / week / month views of planned shifts, recorded work sessions, absences,
 * holidays and exceptions, as distinct layers.
 *
 * - A planned shift is never shown as worked time; recorded sessions come from clock events only.
 * - Approved leave is an absence band and never produces clock events.
 * - Overnight shifts and sessions appear once, on their start day, with "(+1)" on the end time.
 * - Sensitive absence categories are masked with absenceTypeLabel().
 * - Scope: company (HR, owner, payroll), team + self (supervisors), otherwise own records only.
 */
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DurationText, EmployeeLink, msg, RecordStatusBadge, TimeText } from '../components/bits';
import { Badge, Button, Callout, Card, ConfirmDialog, EmptyState, KV, Modal, PageHeader, SelectField, StatusBadge, TextAreaField, TextField, useAction } from '../components/ui';
import { ANOMALY_LABEL, ANOMALY_STATUS_LABEL, isOpenStatus, type Anomaly } from '../domain/anomalies';
import { effectiveValues, sessionDurations, sessionState, type SessionState } from '../domain/records';
import { ABSENCE_STATUS, MODE_LABEL } from '../domain/status';
import { addDays, addMonths, eachDay, endOfMonth, formatDate, formatDateLong, formatDayShort, formatMonth, isValidISODate, localDate, localTime, nowInstant, startOfMonth, startOfWeek, wallTime } from '../domain/time';
import type { AbsenceRequest, Employee, Holiday, ID, ISODate, PlannedShift, SessionValues, WorkSession } from '../domain/types';
import { locale, t, tKey } from '../i18n';
import { absenceTypeLabel, visibleAbsences } from '../services/absenceService';
import { canReview, employeeName, timeScope, visibleEmployeeIds } from '../services/context';
import { visibleAnomalies } from '../services/opsService';
import { cancelShift, canManageShiftsFor, checkShift, saveShift, type ShiftInput } from '../services/planningService';
import { useCtx, type UiCtx } from '../store/hooks';

// ─────────────────────────────── View model ───────────────────────────────

type View = 'dia' | 'semana' | 'mes';
const VIEWS: View[] = ['dia', 'semana', 'mes'];
const VIEW_LABEL: Record<View, string> = { dia: tKey('Día'), semana: tKey('Semana'), mes: tKey('Mes') };

const SESSION_OPEN_LABEL: Partial<Record<SessionState, string>> = { working: tKey('en curso'), on_break: tKey('en pausa'), incomplete: tKey('incompleto') };

type Selection = { kind: 'shift'; id: ID } | { kind: 'session'; id: ID } | { kind: 'absence'; id: ID } | { kind: 'anomalies'; employeeId: ID; date: ISODate };

interface SessionItem {
  s: WorkSession;
  v: SessionValues;
  state: SessionState;
}

interface CalData {
  from: ISODate;
  to: ISODate;
  employees: Employee[];
  shifts: Map<string, PlannedShift[]>;
  sessions: Map<string, SessionItem[]>;
  absences: Map<string, AbsenceRequest[]>;
  pending: Map<string, AbsenceRequest[]>;
  anomalies: Map<string, Anomaly[]>;
  overlaps: Set<ID>;
  conflicts: Set<ID>;
  /** Holidays of the calendars in view (header), and per employee (their primary worksite calendar). */
  holidays: Map<ISODate, Holiday[]>;
  empHoliday: (employeeId: ID, date: ISODate) => Holiday | undefined;
}

const key = (employeeId: ID, date: ISODate) => `${employeeId}|${date}`;

function push<T>(
  map: Map<string, T[]>,
  k: string,
  v: T,
) {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
}

function rangeFor(view: View, fecha: ISODate): { from: ISODate; to: ISODate } {
  if (view === 'dia') return { from: fecha, to: fecha };
  if (view === 'semana') {
    const f = startOfWeek(fecha);
    return { from: f, to: addDays(f, 6) };
  }
  return { from: startOfWeek(startOfMonth(fecha)), to: addDays(startOfWeek(endOfMonth(fecha)), 6) };
}

/** Employees whose calendar the caller may see (representatives and employees: only themselves). */
function calendarScope(ctx: UiCtx): Set<ID> {
  const scope = timeScope(ctx);
  if (scope === 'all' || scope === 'team') return visibleEmployeeIds(ctx);
  return new Set(ctx.employee ? [ctx.employee.id] : []);
}

function canSeePending(ctx: UiCtx, employeeId: ID): boolean {
  return ctx.employee?.id === employeeId || ctx.can('absences.view_all') || canReview(ctx, employeeId, 'absences');
}

interface CalFilters {
  dep: ID | null;
  ws: ID | null;
  emp: ID | null;
}

function buildData(ctx: UiCtx, from: ISODate, to: ISODate, f: CalFilters, nowIso: string): CalData {
  const db = ctx.db;
  const cid = ctx.company.id;
  const scope = calendarScope(ctx);
  const siteOk = (ws: ID | null) => !f.ws || ws === f.ws;
  const candidates = db.employees.filter((e) => e.companyId === cid && scope.has(e.id) && (!f.emp || e.id === f.emp) && (!f.dep || e.departmentId === f.dep) && (!f.ws || e.worksiteIds.includes(f.ws)));
  const ids = new Set(candidates.map((e) => e.id));

  const shifts = new Map<string, PlannedShift[]>();
  const allPlanned = db.shifts.filter((s) => s.companyId === cid && s.status === 'planned' && ids.has(s.employeeId) && s.date >= addDays(from, -1) && s.date <= addDays(to, 1));
  for (const s of allPlanned) if (s.date >= from && s.date <= to && siteOk(s.worksiteId)) push(shifts, key(s.employeeId, s.date), s);

  // Overlapping planned shifts of the same employee (review warning, never blocking).
  const overlaps = new Set<ID>();
  const byEmp = new Map<ID, PlannedShift[]>();
  allPlanned.forEach((s) => push(byEmp, s.employeeId, s));
  for (const list of byEmp.values()) {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
        overlaps.add(sorted[i].id);
        overlaps.add(sorted[j].id);
      }
    }
  }

  const sessions = new Map<string, SessionItem[]>();
  for (const s of db.sessions) {
    if (s.companyId !== cid || !ids.has(s.employeeId) || s.date < from || s.date > to) continue;
    const v = effectiveValues(db, s);
    if (!v.start || !siteOk(v.worksiteId ?? s.worksiteId)) continue;
    push(sessions, key(s.employeeId, s.date), { s, v, state: sessionState(db, s, nowIso) });
  }

  const absences = new Map<string, AbsenceRequest[]>();
  const pending = new Map<string, AbsenceRequest[]>();
  const conflicts = new Set<ID>();
  for (const a of visibleAbsences(ctx)) {
    if (!ids.has(a.employeeId) || a.endDate < from || a.startDate > to) continue;
    const approved = a.status === 'approved' || a.status === 'cancel_requested';
    const isPending = a.status === 'pending' && canSeePending(ctx, a.employeeId);
    if (!approved && !isPending) continue;
    for (const d of eachDay(a.startDate < from ? from : a.startDate, a.endDate > to ? to : a.endDate)) {
      push(approved ? absences : pending, key(a.employeeId, d), a);
      if (approved && !a.partial) (shifts.get(key(a.employeeId, d)) ?? []).forEach((s) => conflicts.add(s.id));
    }
  }

  const anomalies = new Map<string, Anomaly[]>();
  for (const a of visibleAnomalies(ctx, nowIso)) {
    if (!a.active || !isOpenStatus(a.status) || !ids.has(a.employeeId) || a.date < from || a.date > to) continue;
    push(anomalies, key(a.employeeId, a.date), a);
  }

  // Holidays and company non-working days from the worksite calendars.
  const calById = new Map(db.calendars.filter((c) => c.companyId === cid).map((c) => [c.id, c]));
  const wsById = new Map(db.worksites.filter((w) => w.companyId === cid).map((w) => [w.id, w]));
  const headerCalendars = new Set<ID>();
  for (const wsId of f.ws ? [f.ws] : candidates.map((e) => e.primaryWorksiteId)) {
    const cal = wsById.get(wsId)?.calendarId;
    if (cal) headerCalendars.add(cal);
  }
  if (!headerCalendars.size) db.worksites.filter((w) => w.companyId === cid).forEach((w) => headerCalendars.add(w.calendarId));
  const holidays = new Map<ISODate, Holiday[]>();
  for (const calId of headerCalendars) {
    for (const h of calById.get(calId)?.holidays ?? []) {
      if (h.date < from || h.date > to) continue;
      const list = holidays.get(h.date) ?? [];
      if (!list.some((x) => x.name === h.name)) list.push(h);
      holidays.set(h.date, list);
    }
  }
  const empHoliday = (employeeId: ID, date: ISODate) => {
    const e = candidates.find((x) => x.id === employeeId);
    const cal = e ? calById.get(wsById.get(e.primaryWorksiteId)?.calendarId ?? '') : undefined;
    return cal?.holidays.find((h) => h.date === date);
  };

  const hasItems = (id: ID) => [shifts, sessions, absences, pending, anomalies].some((m) => [...m.keys()].some((k) => k.startsWith(`${id}|`)));
  const employees = candidates.filter((e) => e.status === 'active' || hasItems(e.id)).sort((a, b) => a.firstName.localeCompare(b.firstName, 'es') || a.lastName.localeCompare(b.lastName, 'es'));

  return { from, to, employees, shifts, sessions, absences, pending, anomalies, overlaps, conflicts, holidays, empHoliday };
}

function cellHasItems(d: CalData, employeeId: ID, date: ISODate): boolean {
  const k = key(employeeId, date);
  return !!(d.shifts.get(k)?.length || d.sessions.get(k)?.length || d.absences.get(k)?.length || d.pending.get(k)?.length || d.anomalies.get(k)?.length);
}

function holidayLabel(h: Holiday): string {
  return h.scope === 'company' ? t('No laborable de empresa: {name}', { name: t(h.name) }) : t('Festivo: {name}', { name: t(h.name) });
}

function weekdayHeader(date: ISODate): string {
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function useNow(ctx: UiCtx): string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => nowInstant(), [ctx, tick]);
}

function Interval({ start, end, tz, baseDate }: { start: string | null; end: string | null; tz: string; baseDate: ISODate }) {
  return (
    <span className="nowrap">
      <TimeText at={start} tz={tz} baseDate={baseDate} />–{end ? <TimeText at={end} tz={tz} baseDate={baseDate} /> : <span>…</span>}
    </span>
  );
}

// ─────────────────────────────── Page ───────────────────────────────

export function CalendarPage() {
  const ctx = useCtx();
  const now = useNow(ctx);
  const [params, setParams] = useSearchParams();
  const rawView = params.get('vista') as View | null;
  const view: View = rawView && VIEWS.includes(rawView) ? rawView : 'semana';
  const rawDate = params.get('fecha');
  const fecha: ISODate = isValidISODate(rawDate) ? rawDate : ctx.today;

  const scope = calendarScope(ctx);
  const ownOnly = scope.size <= 1;
  const scopeEmployees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && scope.has(e.id)).sort((a, b) => a.firstName.localeCompare(b.firstName, 'es'));
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id && scopeEmployees.some((e) => e.departmentId === d.id));
  const worksites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && scopeEmployees.some((e) => e.worksiteIds.includes(w.id)));
  const pick = (k: string, list: { id: ID }[]) => {
    const v = params.get(k);
    return v && list.some((x) => x.id === v) ? v : null;
  };
  const filters: CalFilters = { dep: pick('departamento', departments), ws: pick('centro', worksites), emp: pick('empleado', scopeEmployees) };

  const setMany = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const go = (date: ISODate, v: View = view) => setMany({ fecha: date, vista: v });
  const step = (dir: 1 | -1) => go(view === 'dia' ? addDays(fecha, dir) : view === 'semana' ? addDays(fecha, 7 * dir) : addMonths(fecha, dir));

  const { from, to } = rangeFor(view, fecha);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => buildData(ctx, from, to, filters, now), [ctx, from, to, filters.dep, filters.ws, filters.emp, now]);

  const manageable = scopeEmployees.filter((e) => e.status === 'active' && canManageShiftsFor(ctx, e.id));
  const [selected, setSelected] = useState<Selection | null>(null);
  const [creating, setCreating] = useState<{ employeeId: ID; date: ISODate } | null>(null);
  const [editing, setEditing] = useState<PlannedShift | null>(null);
  const startCreate = (employeeId?: ID, date?: ISODate) => {
    const emp = employeeId ?? (filters.emp && manageable.some((e) => e.id === filters.emp) ? filters.emp : manageable[0]?.id);
    if (!emp) return;
    setCreating({ employeeId: emp, date: date ?? (fecha < ctx.today ? ctx.today : fecha) });
  };

  const rangeLabel =
    view === 'dia' ? formatDateLong(fecha) : view === 'semana' ? t('Semana del {from} al {to}', { from: formatDate(from), to: formatDate(to) }) : formatMonth(fecha.slice(0, 7));
  const showPendingLegend = ctx.can('absences.view_all') || ctx.can('absences.review_team') || ctx.can('absences.request_own');

  return (
    <>
      <PageHeader
        title={t('Calendario')}
        subtitle={ownOnly ? t('Sus turnos planificados, sus registros de trabajo, sus ausencias y los festivos de su centro.') : t('Turnos planificados, registros de trabajo, ausencias, festivos e incidencias de las personas de su ámbito.')}
        actions={
          manageable.length > 0 ? (
            <Button variant="primary" icon={CalendarPlus} onClick={() => startCreate()}>
              {t('Nuevo turno')}
            </Button>
          ) : undefined
        }
      />
      <div className="stack-lg">
        <Card flush>
          <div className="toolbar cal-toolbar">
            <div className="row-wrap cal-nav">
              <Button iconOnly icon={ChevronLeft} aria-label={t('Periodo anterior')} onClick={() => step(-1)} />
              <Button onClick={() => go(ctx.today)}>{t('Hoy')}</Button>
              <Button iconOnly icon={ChevronRight} aria-label={t('Periodo siguiente')} onClick={() => step(1)} />
              <h2 className="cal-range" aria-live="polite">
                {rangeLabel}
              </h2>
            </div>
            <div className="segmented" role="group" aria-label={t('Vista del calendario')}>
              {VIEWS.map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => go(fecha, v)}>
                  {t(VIEW_LABEL[v])}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="cal-date">{t('Ir a la fecha')}</label>
              <input id="cal-date" type="date" className="input" value={fecha} onChange={(e) => isValidISODate(e.target.value) && go(e.target.value)} />
            </div>
            {!ownOnly && departments.length > 1 && (
              <div className="field">
                <label htmlFor="cal-dep">{t('Equipo o departamento')}</label>
                <select id="cal-dep" className="select" value={filters.dep ?? ''} onChange={(e) => setMany({ departamento: e.target.value || null })}>
                  <option value="">{t('Todos')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {worksites.length > 1 && (
              <div className="field">
                <label htmlFor="cal-ws">{t('Centro')}</label>
                <select id="cal-ws" className="select" value={filters.ws ?? ''} onChange={(e) => setMany({ centro: e.target.value || null })}>
                  <option value="">{t('Todos')}</option>
                  {worksites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!ownOnly && (
              <div className="field">
                <label htmlFor="cal-emp">{t('Empleado')}</label>
                <select id="cal-emp" className="select" value={filters.emp ?? ''} onChange={(e) => setMany({ empleado: e.target.value || null })}>
                  <option value="">{t('Todos')}</option>
                  {scopeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.firstName} {e.lastName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="cal-legend-wrap">
            <Legend showPending={showPendingLegend} />
          </div>
        </Card>

        {data.employees.length === 0 ? (
          <Card>
            <EmptyState title={t('No hay personas que mostrar')}>{t('Ninguna persona de su ámbito coincide con los filtros seleccionados.')}</EmptyState>
          </Card>
        ) : view === 'dia' ? (
          <DayView ctx={ctx} data={data} date={fecha} now={now} onSelect={setSelected} onAdd={(id) => startCreate(id, fecha)} />
        ) : view === 'semana' ? (
          <WeekView ctx={ctx} data={data} onSelect={setSelected} onAdd={(id, d) => startCreate(id, d)} />
        ) : (
          <MonthView ctx={ctx} data={data} month={fecha.slice(0, 7)} single={data.employees.length === 1} onSelect={setSelected} onOpenDay={(d) => go(d, 'dia')} />
        )}

        <Callout tone="neutral">
          {t('Un turno planificado no es tiempo trabajado y una ausencia aprobada no genera fichajes. Los solapamientos y conflictos se señalan para su revisión; no son conclusiones sobre ninguna persona.')}
        </Callout>
      </div>

      {selected?.kind === 'shift' && <ShiftDetail ctx={ctx} data={data} id={selected.id} onClose={() => setSelected(null)} onEdit={(s) => { setSelected(null); setEditing(s); }} />}
      {selected?.kind === 'session' && <SessionDetail ctx={ctx} id={selected.id} now={now} onClose={() => setSelected(null)} />}
      {selected?.kind === 'absence' && <AbsenceDetail ctx={ctx} id={selected.id} onClose={() => setSelected(null)} />}
      {selected?.kind === 'anomalies' && <AnomaliesDetail ctx={ctx} list={data.anomalies.get(key(selected.employeeId, selected.date)) ?? []} employeeId={selected.employeeId} date={selected.date} onClose={() => setSelected(null)} />}
      {creating && (
        <ShiftForm
          ctx={ctx}
          title={t('Nuevo turno planificado')}
          employees={manageable}
          existingId={null}
          initial={{ employeeId: creating.employeeId, date: creating.date, startTime: '08:00', endTime: '16:00', worksiteId: ctx.db.employees.find((e) => e.id === creating.employeeId)?.primaryWorksiteId ?? '', note: '' }}
          onClose={() => setCreating(null)}
        />
      )}
      {editing && (
        <ShiftForm
          ctx={ctx}
          title={t('Modificar turno planificado')}
          employees={manageable.filter((e) => e.id === editing.employeeId)}
          existingId={editing.id}
          initial={{ employeeId: editing.employeeId, date: editing.date, startTime: localTime(editing.start, editing.timezone), endTime: localTime(editing.end, editing.timezone), worksiteId: editing.worksiteId, note: editing.note }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function Legend({ showPending }: { showPending: boolean }) {
  return (
    <div className="stack-sm">
      <ul className="cal-legend" aria-label={t('Leyenda del calendario')}>
        <li>
          <span className="cal-sw planned" aria-hidden />
          <span className="cal-tag">{t('Plan.')}</span> {t('Turno planificado (no es tiempo trabajado)')}
        </li>
        <li>
          <span className="cal-sw recorded" aria-hidden />
          <span className="cal-tag">{t('Reg.')}</span> {t('Sesión de trabajo registrada')}
        </li>
        <li>
          <span className="cal-sw absence" aria-hidden />
          {t('Ausencia aprobada (no genera fichajes)')}
        </li>
        {showPending && (
          <li>
            <span className="cal-sw pending" aria-hidden />
            {t('Solicitud de ausencia pendiente')}
          </li>
        )}
        <li>
          <span className="cal-sw holiday" aria-hidden />
          {t('Festivo o día no laborable')}
        </li>
        <li>
          <AlertTriangle size={13} className="cal-warn-icon" aria-hidden />
          {t('Incidencia o solapamiento por revisar')}
        </li>
      </ul>
      <p className="tiny muted">{t('Los turnos y sesiones nocturnos aparecen en su día de inicio, con «(+1)» en la hora de fin.')}</p>
    </div>
  );
}

// ─────────────────────────────── Cell items (shared by week, month and agenda) ───────────────────────────────

function CellItems({ ctx, data, employeeId, date, onSelect }: { ctx: UiCtx; data: CalData; employeeId: ID; date: ISODate; onSelect: (s: Selection) => void }) {
  const k = key(employeeId, date);
  const abs = data.absences.get(k) ?? [];
  const pend = data.pending.get(k) ?? [];
  const shifts = (data.shifts.get(k) ?? []).slice().sort((a, b) => a.start.localeCompare(b.start));
  const sessions = (data.sessions.get(k) ?? []).slice().sort((a, b) => (a.v.start ?? '').localeCompare(b.v.start ?? ''));
  const anomalies = data.anomalies.get(k) ?? [];
  return (
    <>
      {abs.map((a) => (
        <button key={`a-${a.id}`} type="button" className="cal-item absence" onClick={() => onSelect({ kind: 'absence', id: a.id })}>
          <span className="cal-tag">{t('Ausencia')}</span> {t(absenceTypeLabel(ctx, a))}
          {a.partial ? ` ${a.partial.startTime}–${a.partial.endTime}` : ''}
        </button>
      ))}
      {pend.map((a) => (
        <button key={`p-${a.id}`} type="button" className="cal-item pending" onClick={() => onSelect({ kind: 'absence', id: a.id })}>
          <span className="cal-tag">{t('Pendiente')}</span> {t(absenceTypeLabel(ctx, a))}
        </button>
      ))}
      {shifts.map((s) => (
        <button key={`s-${s.id}`} type="button" className="cal-item planned" onClick={() => onSelect({ kind: 'shift', id: s.id })}>
          <span className="sr-only">{t('Turno planificado')}: </span>
          <span className="cal-tag" aria-hidden>
            {t('Plan.')}
          </span>{' '}
          <Interval start={s.start} end={s.end} tz={s.timezone} baseDate={s.date} />
          {(data.overlaps.has(s.id) || data.conflicts.has(s.id)) && (
            <span className="cal-flag" title={data.overlaps.has(s.id) ? t('Se solapa con otro turno planificado (revisar)') : t('Turno en un día con ausencia aprobada (revisar)')}>
              <AlertTriangle size={12} aria-hidden />
              <span className="sr-only">{data.overlaps.has(s.id) ? t('Se solapa con otro turno planificado (revisar)') : t('Turno en un día con ausencia aprobada (revisar)')}</span>
            </span>
          )}
        </button>
      ))}
      {sessions.map((x) => (
        <button key={`r-${x.s.id}`} type="button" className={`cal-item recorded ${x.state === 'incomplete' ? 'incomplete' : ''}`} onClick={() => onSelect({ kind: 'session', id: x.s.id })}>
          <span className="sr-only">{t('Sesión de trabajo registrada')}: </span>
          <span className="cal-tag" aria-hidden>
            {t('Reg.')}
          </span>{' '}
          <Interval start={x.v.start} end={x.v.end} tz={x.s.timezone} baseDate={x.s.date} />
          {SESSION_OPEN_LABEL[x.state] && <span className="tiny"> · {t(SESSION_OPEN_LABEL[x.state]!)}</span>}
        </button>
      ))}
      {anomalies.length > 0 && (
        <button type="button" className="cal-item anomaly" onClick={() => onSelect({ kind: 'anomalies', employeeId, date })}>
          <AlertTriangle size={12} aria-hidden /> {t('Incidencias por revisar: {n}', { n: anomalies.length })}
        </button>
      )}
    </>
  );
}

// ─────────────────────────────── Week view ───────────────────────────────

function WeekView({ ctx, data, onSelect, onAdd }: { ctx: UiCtx; data: CalData; onSelect: (s: Selection) => void; onAdd: (employeeId: ID, date: ISODate) => void }) {
  const days = eachDay(data.from, data.to);
  return (
    <>
      <Card flush className="cal-grid-only">
        <div className="table-wrap">
          <table className="table cal-week">
            <caption className="sr-only">{t('Calendario semanal: una fila por persona y una columna por día')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Empleado')}</th>
                {days.map((d) => {
                  const hol = data.holidays.get(d);
                  return (
                    <th key={d} scope="col" className={`${d === ctx.today ? 'today' : ''} ${hol ? 'holiday' : ''}`}>
                      <Link to={`/calendario?fecha=${d}&vista=dia`} className="cal-dayhead" aria-label={formatDateLong(d)}>
                        {formatDayShort(d)}
                      </Link>
                      {hol?.map((h) => (
                        <div key={h.name} className="cal-hol">
                          {holidayLabel(h)}
                        </div>
                      ))}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => {
                const canAdd = canManageShiftsFor(ctx, e.id) && e.status === 'active';
                return (
                  <tr key={e.id}>
                    <th scope="row" className="cal-who">
                      <EmployeeLink id={e.id} />
                      <div className="tiny muted">{ctx.db.departments.find((x) => x.id === e.departmentId)?.name}</div>
                    </th>
                    {days.map((d) => {
                      const hol = data.empHoliday(e.id, d);
                      return (
                        <td key={d} className={`cal-cell ${d === ctx.today ? 'today' : ''} ${hol ? 'holiday' : ''}`}>
                          <CellItems ctx={ctx} data={data} employeeId={e.id} date={d} onSelect={onSelect} />
                          {canAdd && d >= ctx.today && (
                            <button type="button" className="cal-add" aria-label={t('Nuevo turno para {name} el {date}', { name: `${e.firstName} ${e.lastName}`, date: formatDate(d) })} onClick={() => onAdd(e.id, d)}>
                              <Plus size={12} aria-hidden />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Agenda ctx={ctx} data={data} days={days} onSelect={onSelect} />
    </>
  );
}

/** Small-screen fallback for the week and month grids: a list per day. */
function Agenda({ ctx, data, days, onSelect }: { ctx: UiCtx; data: CalData; days: ISODate[]; onSelect: (s: Selection) => void }) {
  const sections = days
    .map((d) => ({ d, people: data.employees.filter((e) => cellHasItems(data, e.id, d)), hol: data.holidays.get(d) }))
    .filter((x) => x.people.length || x.hol);
  return (
    <div className="cal-agenda" aria-label={t('Agenda')}>
      {sections.length === 0 ? (
        <Card>
          <EmptyState title={t('Sin elementos en este periodo')} />
        </Card>
      ) : (
        <div className="stack">
          {sections.map(({ d, people, hol }) => (
            <Card key={d} className={d === ctx.today ? 'cal-agenda-today' : ''}>
              <div className="stack-sm">
                <div className="row between">
                  <Link to={`/calendario?fecha=${d}&vista=dia`} className="strong">
                    {formatDateLong(d)}
                  </Link>
                  {d === ctx.today && <Badge tone="info">{t('Hoy')}</Badge>}
                </div>
                {hol?.map((h) => (
                  <div key={h.name} className="cal-hol">
                    {holidayLabel(h)}
                  </div>
                ))}
                {people.map((e) => (
                  <div key={e.id} className="cal-agenda-person">
                    {data.employees.length > 1 && <div className="small strong">{e.firstName} {e.lastName}</div>}
                    <CellItems ctx={ctx} data={data} employeeId={e.id} date={d} onSelect={onSelect} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── Day view ───────────────────────────────

/** Minutes since local midnight of `date` (0–1440) for an instant, clipped to the day. */
function dayMinutes(instant: string, tz: string, date: ISODate): number {
  const d = localDate(instant, tz);
  if (d < date) return 0;
  if (d > date) return 1440;
  const w = wallTime(instant, tz);
  return w.h * 60 + w.mi;
}

function blockStyle(startMin: number, endMin: number) {
  const left = (startMin / 1440) * 100;
  const width = Math.max(1.5, ((Math.max(endMin, startMin) - startMin) / 1440) * 100);
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
}

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

function DayView({ ctx, data, date, now, onSelect, onAdd }: { ctx: UiCtx; data: CalData; date: ISODate; now: string; onSelect: (s: Selection) => void; onAdd: (employeeId: ID) => void }) {
  const rows = data.employees.filter((e) => cellHasItems(data, e.id, date));
  const idle = data.employees.length - rows.length;
  const hol = data.holidays.get(date);
  return (
    <Card title={formatDateLong(date)} actions={date === ctx.today ? <Badge tone="info">{t('Hoy')}</Badge> : undefined}>
      <div className="stack">
        {hol?.map((h) => (
          <div key={h.name} className="cal-hol">
            {holidayLabel(h)}
          </div>
        ))}
        {rows.length === 0 ? (
          <EmptyState title={t('Sin turnos, registros ni ausencias este día')} />
        ) : (
          <div className="cal-day">
            <div className="cal-day-row cal-day-scale-row" aria-hidden>
              <div className="cal-day-who" />
              <div className="cal-scale">
                {HOURS.map((h) => (
                  <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
                    {String(h).padStart(2, '0')}
                  </span>
                ))}
              </div>
            </div>
            {rows.map((e) => {
              const k = key(e.id, date);
              const shifts = data.shifts.get(k) ?? [];
              const sessions = data.sessions.get(k) ?? [];
              const bands = [...(data.absences.get(k) ?? []), ...(data.pending.get(k) ?? [])];
              const anomalies = data.anomalies.get(k) ?? [];
              const canAdd = canManageShiftsFor(ctx, e.id) && e.status === 'active';
              return (
                <div key={e.id} className="cal-day-row">
                  <div className="cal-day-who">
                    <EmployeeLink id={e.id} />
                    <div className="tiny muted">{ctx.db.departments.find((x) => x.id === e.departmentId)?.name}</div>
                    {canAdd && (
                      <button type="button" className="btn ghost sm" onClick={() => onAdd(e.id)}>
                        <Plus size={13} aria-hidden />
                        {t('Turno')}
                      </button>
                    )}
                  </div>
                  <div className="cal-day-lanes">
                    {bands.map((a) => {
                      const approved = a.status === 'approved' || a.status === 'cancel_requested';
                      return (
                        <button key={a.id} type="button" className={`cal-item ${approved ? 'absence' : 'pending'}`} onClick={() => onSelect({ kind: 'absence', id: a.id })}>
                          <span className="cal-tag">{approved ? t('Ausencia') : t('Pendiente')}</span> {t(absenceTypeLabel(ctx, a))}
                          {a.partial ? ` ${a.partial.startTime}–${a.partial.endTime}` : ` · ${t('Todo el día')}`}
                        </button>
                      );
                    })}
                    <div className="cal-lane" role="group" aria-label={t('Planificado')}>
                      <span className="cal-lane-label" aria-hidden>
                        {t('Plan.')}
                      </span>
                      {shifts.length === 0 && <span className="cal-lane-empty">{t('Sin turno planificado')}</span>}
                      {shifts.map((s) => (
                        <button key={s.id} type="button" className="cal-item planned cal-block" style={blockStyle(dayMinutes(s.start, s.timezone, date), dayMinutes(s.end, s.timezone, date))} onClick={() => onSelect({ kind: 'shift', id: s.id })}>
                          <span className="sr-only">{t('Turno planificado')}: </span>
                          <Interval start={s.start} end={s.end} tz={s.timezone} baseDate={s.date} />
                          {(data.overlaps.has(s.id) || data.conflicts.has(s.id)) && (
                            <span className="cal-flag">
                              <AlertTriangle size={12} aria-hidden />
                              <span className="sr-only">{data.overlaps.has(s.id) ? t('Se solapa con otro turno planificado (revisar)') : t('Turno en un día con ausencia aprobada (revisar)')}</span>
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="cal-lane" role="group" aria-label={t('Registrado')}>
                      <span className="cal-lane-label" aria-hidden>
                        {t('Reg.')}
                      </span>
                      {sessions.length === 0 && <span className="cal-lane-empty">{t('Sin registro')}</span>}
                      {sessions.map((x) => {
                        const endMin = x.v.end ? dayMinutes(x.v.end, x.s.timezone, date) : dayMinutes(now, x.s.timezone, date);
                        return (
                          <button key={x.s.id} type="button" className={`cal-item recorded cal-block ${x.state === 'incomplete' ? 'incomplete' : ''}`} style={blockStyle(dayMinutes(x.v.start!, x.s.timezone, date), endMin)} onClick={() => onSelect({ kind: 'session', id: x.s.id })}>
                            <span className="sr-only">{t('Sesión de trabajo registrada')}: </span>
                            <Interval start={x.v.start} end={x.v.end} tz={x.s.timezone} baseDate={x.s.date} />
                            {SESSION_OPEN_LABEL[x.state] && <span className="tiny"> · {t(SESSION_OPEN_LABEL[x.state]!)}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {anomalies.length > 0 && (
                      <button type="button" className="cal-item anomaly" onClick={() => onSelect({ kind: 'anomalies', employeeId: e.id, date })}>
                        <AlertTriangle size={12} aria-hidden /> {anomalies.map((a) => t(ANOMALY_LABEL[a.type])).join(' · ')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {idle > 0 && <p className="tiny muted">{t('{n} persona(s) de su selección sin turnos, registros ni ausencias este día.', { n: idle })}</p>}
      </div>
    </Card>
  );
}

// ─────────────────────────────── Month view ───────────────────────────────

function MonthView({ ctx, data, month, single, onSelect, onOpenDay }: { ctx: UiCtx; data: CalData; month: string; single: boolean; onSelect: (s: Selection) => void; onOpenDay: (d: ISODate) => void }) {
  const days = eachDay(data.from, data.to);
  const counts = (d: ISODate) => {
    let shifts = 0, sessions = 0, absent = 0, pending = 0, anomalies = 0;
    for (const e of data.employees) {
      const k = key(e.id, d);
      shifts += data.shifts.get(k)?.length ?? 0;
      sessions += data.sessions.get(k)?.length ?? 0;
      if (data.absences.get(k)?.length) absent++;
      if (data.pending.get(k)?.length) pending++;
      anomalies += data.anomalies.get(k)?.length ?? 0;
    }
    return { shifts, sessions, absent, pending, anomalies };
  };
  const monthDays = days.filter((d) => d.startsWith(month));
  return (
    <>
      <Card flush className="cal-grid-only">
        <div className="cal-month" role="table" aria-label={formatMonth(month)}>
          <div className="cal-month-row" role="row">
            {days.slice(0, 7).map((d) => (
              <div key={d} className="cal-month-head" role="columnheader">
                {weekdayHeader(d)}
              </div>
            ))}
          </div>
          {Array.from({ length: days.length / 7 }, (_, w) => (
            <div key={w} className="cal-month-row" role="row">
              {days.slice(w * 7, w * 7 + 7).map((d) => {
                const hol = data.holidays.get(d);
                const c = single ? null : counts(d);
                return (
                  <div key={d} role="cell" className={`cal-mcell ${d.startsWith(month) ? '' : 'out'} ${d === ctx.today ? 'today' : ''} ${hol ? 'holiday' : ''}`}>
                    <button type="button" className="cal-mday" onClick={() => onOpenDay(d)} aria-label={t('Ver el día {date}', { date: formatDateLong(d) })}>
                      {Number(d.slice(8, 10))}
                    </button>
                    {hol?.map((h) => (
                      <div key={h.name} className="cal-hol">
                        {holidayLabel(h)}
                      </div>
                    ))}
                    {single ? (
                      <CellItems ctx={ctx} data={data} employeeId={data.employees[0].id} date={d} onSelect={onSelect} />
                    ) : (
                      c && <MonthCounts c={c} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
      {single ? (
        <Agenda ctx={ctx} data={data} days={monthDays} onSelect={onSelect} />
      ) : (
        <div className="cal-agenda">
          <Card flush>
            <ul className="cal-month-agenda">
              {monthDays.map((d) => {
                const c = counts(d);
                const hol = data.holidays.get(d);
                if (!hol && !c.shifts && !c.sessions && !c.absent && !c.pending && !c.anomalies) return null;
                return (
                  <li key={d}>
                    <button type="button" className="list-btn" onClick={() => onOpenDay(d)}>
                      <span className="stack-sm grow" style={{ gap: 2 }}>
                        <span className="strong">{formatDateLong(d)}</span>
                        {hol?.map((h) => (
                          <span key={h.name} className="cal-hol">
                            {holidayLabel(h)}
                          </span>
                        ))}
                        <MonthCounts c={c} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

function MonthCounts({ c }: { c: { shifts: number; sessions: number; absent: number; pending: number; anomalies: number } }) {
  const parts: ReactNode[] = [];
  if (c.shifts) parts.push(<span key="p" className="cal-count planned" title={t('Turnos planificados')}>{t('Plan. {n}', { n: c.shifts })}</span>);
  if (c.sessions) parts.push(<span key="r" className="cal-count recorded" title={t('Sesiones registradas')}>{t('Reg. {n}', { n: c.sessions })}</span>);
  if (c.absent) parts.push(<span key="a" className="cal-count absence" title={t('Personas con ausencia aprobada')}>{t('Aus. {n}', { n: c.absent })}</span>);
  if (c.pending) parts.push(<span key="s" className="cal-count pending" title={t('Solicitudes de ausencia pendientes')}>{t('Pend. {n}', { n: c.pending })}</span>);
  if (c.anomalies)
    parts.push(
      <span key="i" className="cal-count anomaly" title={t('Incidencias por revisar')}>
        <AlertTriangle size={11} aria-hidden /> {c.anomalies}
        <span className="sr-only"> {t('Incidencias por revisar')}</span>
      </span>,
    );
  return <div className="cal-counts">{parts}</div>;
}

// ─────────────────────────────── Detail panels ───────────────────────────────

function ShiftDetail({ ctx, data, id, onClose, onEdit }: { ctx: UiCtx; data: CalData; id: ID; onClose: () => void; onEdit: (s: PlannedShift) => void }) {
  const { runOk } = useAction();
  const [confirm, setConfirm] = useState(false);
  const s = ctx.db.shifts.find((x) => x.id === id && x.companyId === ctx.company.id && calendarScope(ctx).has(x.employeeId));
  if (!s) return null;
  const canManage = canManageShiftsFor(ctx, s.employeeId) && s.status === 'planned';
  const site = ctx.db.worksites.find((w) => w.id === s.worksiteId)?.name ?? '—';
  if (confirm) {
    return (
      <ConfirmDialog
        title={t('Cancelar turno planificado')}
        message={t('El turno quedará cancelado con el motivo indicado. Los registros de trabajo no se modifican.')}
        confirmLabel={t('Cancelar turno')}
        danger
        requireReason
        reasonLabel={t('Motivo de la cancelación (queda registrado en la auditoría)')}
        onClose={() => setConfirm(false)}
        onConfirm={async (reason) => {
          const ok = await runOk(() => cancelShift(s.id, reason), t('Turno cancelado. Los registros de trabajo no se modifican.'));
          if (ok) onClose();
          return ok ? undefined : false;
        }}
      />
    );
  }
  return (
    <Modal
      title={t('Turno planificado')}
      description={t('Un turno planificado no es tiempo trabajado.')}
      onClose={onClose}
      footer={
        <>
          {canManage && (
            <Button variant="danger-outline" onClick={() => setConfirm(true)}>
              {t('Cancelar turno')}
            </Button>
          )}
          {canManage && (
            <Button variant="primary" onClick={() => onEdit(s)}>
              {t('Modificar horario')}
            </Button>
          )}
          <Button onClick={onClose}>{t('Cerrar')}</Button>
        </>
      }
    >
      <div className="stack">
        <KV
          items={[
            [t('Empleado'), <EmployeeLink id={s.employeeId} />],
            [t('Fecha'), formatDateLong(s.date)],
            [t('Horario'), <Interval start={s.start} end={s.end} tz={s.timezone} baseDate={s.date} />],
            [t('Centro'), site],
            [t('Estado'), s.status === 'planned' ? <Badge tone="info">{t('Planificado')}</Badge> : <Badge tone="neutral">{t('Cancelado')}</Badge>],
            [t('Nota'), s.note || '—'],
          ]}
        />
        {data.overlaps.has(s.id) && <Callout tone="warning">{t('Se solapa con otro turno planificado del mismo empleado. Es un aviso de revisión de la planificación.')}</Callout>}
        {data.conflicts.has(s.id) && <Callout tone="warning">{t('Hay una ausencia aprobada este día. Revise la planificación: la ausencia no cancela el turno automáticamente y no genera fichajes.')}</Callout>}
        {!canManage && s.status === 'planned' && <p className="tiny muted">{t('Solo la persona supervisora del equipo o RR. HH. pueden modificar este turno.')}</p>}
      </div>
    </Modal>
  );
}

function SessionDetail({ ctx, id, now, onClose }: { ctx: UiCtx; id: ID; now: string; onClose: () => void }) {
  const s = ctx.db.sessions.find((x) => x.id === id && x.companyId === ctx.company.id && calendarScope(ctx).has(x.employeeId));
  if (!s) return null;
  const v = effectiveValues(ctx.db, s);
  const d = sessionDurations(ctx.db, s, now);
  const site = ctx.db.worksites.find((w) => w.id === v.worksiteId)?.name ?? '—';
  return (
    <Modal
      title={t('Sesión de trabajo registrada')}
      description={t('Valores vigentes del registro (originales o con corrección aprobada).')}
      onClose={onClose}
      footer={
        <>
          <Link to={`/registros/${s.id}`} className="btn primary">
            {t('Abrir el registro')}
          </Link>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
        </>
      }
    >
      <KV
        items={[
          [t('Empleado'), <EmployeeLink id={s.employeeId} />],
          [t('Jornada'), formatDateLong(s.date)],
          [t('Entrada'), <TimeText at={v.start} tz={s.timezone} baseDate={s.date} />],
          [t('Salida'), v.end ? <TimeText at={v.end} tz={s.timezone} baseDate={s.date} /> : <span className="muted">{t('Sin salida registrada')}</span>],
          [t('Pausas'), v.breaks.length ? t('{n} registrada(s)', { n: v.breaks.length }) : t('Sin pausas registradas')],
          [t('Centro'), `${site} · ${t(MODE_LABEL[v.mode])}`],
          [t('Tiempo neto'), <DurationText minutes={d.netMinutes} provisional={d.provisional} />],
          [t('Estado'), <RecordStatusBadge db={ctx.db} session={s} />],
        ]}
      />
    </Modal>
  );
}

function AbsenceDetail({ ctx, id, onClose }: { ctx: UiCtx; id: ID; onClose: () => void }) {
  const a = visibleAbsences(ctx).find((x) => x.id === id);
  if (!a) return null;
  return (
    <Modal
      title={t('Ausencia')}
      description={t('Una ausencia no genera fichajes ni tiempo trabajado.')}
      onClose={onClose}
      footer={
        <>
          <Link to={`/ausencias/${a.id}`} className="btn primary">
            {t('Abrir la ausencia')}
          </Link>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
        </>
      }
    >
      <KV
        items={[
          [t('Empleado'), <EmployeeLink id={a.employeeId} />],
          [t('Categoría'), t(absenceTypeLabel(ctx, a))],
          [t('Fechas'), a.startDate === a.endDate ? formatDate(a.startDate) : t('Del {from} al {to}', { from: formatDate(a.startDate), to: formatDate(a.endDate) })],
          [t('Horario'), a.partial ? `${a.partial.startTime}–${a.partial.endTime}` : t('Todo el día')],
          [t('Estado'), <StatusBadge meta={ABSENCE_STATUS[a.status]} />],
        ]}
      />
    </Modal>
  );
}

function AnomaliesDetail({ ctx, list, employeeId, date, onClose }: { ctx: UiCtx; list: Anomaly[]; employeeId: ID; date: ISODate; onClose: () => void }) {
  return (
    <Modal title={t('Incidencias por revisar')} description={`${employeeName(ctx.db, employeeId)} · ${formatDateLong(date)}`} onClose={onClose} footer={<Button onClick={onClose}>{t('Cerrar')}</Button>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('Son solicitudes de revisión detectadas en los datos, no conclusiones sobre la persona.')}
        </p>
        <ul className="home-list">
          {list.map((a) => (
            <li key={a.key}>
              <div className="stack-sm grow" style={{ gap: 2 }}>
                <Link to={`/incidencias?clave=${encodeURIComponent(a.key)}`} className="strong">
                  {t(ANOMALY_LABEL[a.type])}
                </Link>
                <span className="tiny">{msg(a.reason)}</span>
              </div>
              <Badge tone="warning">{t(ANOMALY_STATUS_LABEL[a.status])}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ─────────────────────────────── Shift form (create / change time) ───────────────────────────────

function ShiftForm({ ctx, title, employees, existingId, initial, onClose }: { ctx: UiCtx; title: string; employees: Employee[]; existingId: ID | null; initial: ShiftInput; onClose: () => void }) {
  const { run, pending } = useAction();
  const [input, setInput] = useState<ShiftInput>(initial);
  const [submitted, setSubmitted] = useState(false);
  const chk = useMemo(() => checkShift(ctx, input, existingId), [ctx, input, existingId]);
  const emp = ctx.db.employees.find((e) => e.id === input.employeeId);
  const sites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && emp?.worksiteIds.includes(w.id));
  const set = (patch: Partial<ShiftInput>) => setInput((x) => ({ ...x, ...patch }));
  const timeError = submitted && (!input.startTime || !input.endTime) ? t('Indique las horas de inicio y fin.') : undefined;

  const save = async () => {
    setSubmitted(true);
    if (chk.errors.length || !input.startTime || !input.endTime) return;
    const r = await run(() => saveShift(input, existingId), existingId ? t('Turno modificado. No genera tiempo trabajado.') : t('Turno planificado guardado. No genera tiempo trabajado.'));
    if (r) onClose();
  };

  return (
    <Modal
      title={title}
      description={t('Si la hora de fin es anterior a la de inicio, el turno termina al día siguiente.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={save}>
            {t('Guardar turno')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          {existingId ? (
            <div className="field">
              <span className="label">{t('Empleado')}</span>
              <span>{employeeName(ctx.db, input.employeeId)}</span>
            </div>
          ) : (
            <SelectField
              label={t('Empleado')}
              required
              value={input.employeeId}
              onChange={(e) => {
                const next = ctx.db.employees.find((x) => x.id === e.target.value);
                set({ employeeId: e.target.value, worksiteId: next?.primaryWorksiteId ?? '' });
              }}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </SelectField>
          )}
          <TextField label={t('Fecha')} type="date" required value={input.date} onChange={(e) => set({ date: e.target.value })} error={submitted && !isValidISODate(input.date) ? t('Indique una fecha válida.') : undefined} />
          <TextField label={t('Hora de inicio')} type="time" required value={input.startTime} onChange={(e) => set({ startTime: e.target.value })} error={timeError} />
          <TextField label={t('Hora de fin')} type="time" required value={input.endTime} onChange={(e) => set({ endTime: e.target.value })} error={timeError} />
          <SelectField label={t('Centro')} required value={input.worksiteId} onChange={(e) => set({ worksiteId: e.target.value })}>
            {sites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectField>
          <TextAreaField label={t('Nota')} className="span-2" rows={2} value={input.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
        {chk.errors.length > 0 && (submitted || input !== initial) && (
          <Callout tone="danger" title={t('Revise el turno antes de guardarlo')}>
            <ul>
              {chk.errors.map((e) => (
                <li key={e}>{t(e)}</li>
              ))}
            </ul>
          </Callout>
        )}
        {chk.warnings.length > 0 && (
          <Callout tone="warning" title={t('Avisos de planificación')}>
            <ul>
              {chk.warnings.map((w) => (
                <li key={w}>{t(w)}</li>
              ))}
            </ul>
            <div className="tiny">{t('Los avisos no impiden guardar; quedan para su revisión.')}</div>
          </Callout>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          {t('Un turno planificado no genera tiempo trabajado. El cambio queda registrado en la auditoría.')}
        </p>
      </div>
    </Modal>
  );
}
