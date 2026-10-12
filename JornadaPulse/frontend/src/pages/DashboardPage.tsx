/**
 * Inicio (home). The content adapts to the caller's role and scope:
 * - managers (supervisor / HR / owner): operational overview of today, planned vs recorded time,
 *   pending reviews, exceptions and recent activity, all derived from the records in scope;
 * - employees: their own day, week, requests and «No registrado» attempts;
 * - workers' representatives: aggregate-only figures (minimised, time-bound access);
 * - payroll advisers: period status and open exceptions.
 * Indicators are counts of records; they are not a legal-compliance assessment.
 */
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coffee,
  FileClock,
  History,
  Inbox,
  ListChecks,
  LogIn,
  PlaneTakeoff,
  ShieldAlert,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DurationText, EmployeeLink, msg, TimeText } from '../components/bits';
import { GroupedBarChart } from '../components/charts';
import { Badge, Callout, Card, DateText, EmptyState, KV, PageHeader, Pagination, StatusBadge, usePaged } from '../components/ui';
import { ANOMALY_LABEL, ANOMALY_STATUS_LABEL, isOpenStatus, type Anomaly } from '../domain/anomalies';
import { AUDIT_ACTION_LABEL } from '../domain/audit';
import type { Permission } from '../domain/permissions';
import { effectiveValues, sessionDurations, sessionState, type SessionState } from '../domain/records';
import { ABSENCE_STATUS, CORRECTION_KIND_LABEL, CORRECTION_STATUS, EVENT_TYPE_LABEL, PERIOD_STATUS, type Tone } from '../domain/status';
import { addDays, addMonths, eachDay, endOfMonth, formatDate, formatDateLong, formatDayShort, formatDuration, formatInstant, formatMonth, localDate, minutesBetween, nowInstant, startOfMonth, startOfWeek, toHours } from '../domain/time';
import type { AbsenceRequest, CorrectionRequest, ID, ISODate, PlannedShift, SessionValues, WorkSession } from '../domain/types';
import { t, tKey } from '../i18n';
import { SECTION_PERMS } from '../layout/AppShell';
import { absencesAwaitingMe, absenceTypeLabel, visibleAbsences } from '../services/absenceService';
import { employeeName, timeScope, visibleEmployeeIds } from '../services/context';
import { correctionsAwaitingMe, visibleCorrections } from '../services/correctionService';
import { pendingActions, visibleAnomalies } from '../services/opsService';
import { EMPTY_FILTERS, periodRange, periodStatus, recordRows } from '../services/reportService';
import { failedAttemptsFor, myStatus } from '../services/timeService';
import { useCtx, type UiCtx } from '../store/hooks';

// ─────────────────────────────── Small helpers ───────────────────────────────

/** Current instant, refreshed every minute and whenever the data changes. */
function useNow(ctx: UiCtx): string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => nowInstant(), [ctx, tick]);
}

const canOpen = (ctx: UiCtx, perms: Permission[]) => perms.some((p) => ctx.can(p));

const SEVERITY_ORDER: Record<Anomaly['severity'], number> = { high: 0, medium: 1, low: 2 };

function sortAnomalies(list: Anomaly[]): Anomaly[] {
  return [...list].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.date.localeCompare(a.date));
}

const ANOMALY_STATUS_TONE: Record<Anomaly['status'], Tone> = { open: 'warning', acknowledged: 'info', investigating: 'accent', resolved: 'success', dismissed: 'neutral' };

function shiftMinutes(s: PlannedShift): number {
  return minutesBetween(s.start, s.end);
}

/** Live state of a person's day, in neutral wording (no conclusion about anybody). */
type DayStatus = 'not_yet' | 'working' | 'on_break' | 'complete' | 'leave' | 'incomplete';

const DAY_STATUS: Record<DayStatus, { label: string; tone: Tone; help: string }> = {
  not_yet: { label: tKey('Sin registro aún'), tone: 'neutral', help: tKey('Todavía no consta ninguna entrada hoy. No es una conclusión: puede tener el turno más tarde o fichar en otro momento.') },
  working: { label: tKey('Trabajando'), tone: 'info', help: tKey('Sesión abierta: hay entrada registrada y todavía no hay salida.') },
  on_break: { label: tKey('En pausa'), tone: 'accent', help: tKey('Sesión abierta con una pausa iniciada y no finalizada.') },
  complete: { label: tKey('Completado'), tone: 'success', help: tKey('Entrada y salida registradas hoy.') },
  leave: { label: tKey('En ausencia aprobada'), tone: 'neutral', help: tKey('Ausencia aprobada hoy. Una ausencia no genera fichajes.') },
  incomplete: { label: tKey('Incompleto'), tone: 'warning', help: tKey('Falta la hora de salida. No se completa automáticamente: requiere una corrección revisada.') },
};

function DayStatusBadge({ status }: { status: DayStatus }) {
  const m = DAY_STATUS[status];
  return (
    <Badge tone={m.tone} title={t(m.help)}>
      {t(m.label)}
    </Badge>
  );
}

function Kpi({ label, value, meta, to, tone, icon: Icon }: { label: string; value: ReactNode; meta?: ReactNode; to: string | null; tone?: 'danger' | 'warning'; icon?: LucideIcon }) {
  const cls = `kpi ${tone ? `tone-${tone}` : ''}`;
  const body = (
    <>
      <span className="label">
        {Icon && <Icon size={14} aria-hidden />}
        {label}
      </span>
      <span className="value">{value}</span>
      {meta && <span className="meta">{meta}</span>}
    </>
  );
  return to ? (
    <Link className={cls} to={to}>
      {body}
    </Link>
  ) : (
    <div className={`${cls} static`}>{body}</div>
  );
}

/** "07:30–15:30 (+1)" for an interval, in the workplace zone. */
function Interval({ start, end, tz, baseDate }: { start: string | null; end: string | null; tz: string; baseDate: ISODate }) {
  return (
    <span className="nowrap">
      <TimeText at={start} tz={tz} baseDate={baseDate} />–{end ? <TimeText at={end} tz={tz} baseDate={baseDate} /> : <span className="muted">…</span>}
    </span>
  );
}

// ─────────────────────────────── Weekly / period buckets ───────────────────────────────

type Preset = 'semana' | '4semanas' | 'mes';
const PRESETS: Preset[] = ['semana', '4semanas', 'mes'];
const PRESET_LABEL: Record<Preset, string> = { semana: tKey('Esta semana'), '4semanas': tKey('Últimas 4 semanas'), mes: tKey('Este mes') };

interface Bucket {
  label: string;
  from: ISODate;
  to: ISODate;
}

function bucketsFor(preset: Preset, today: ISODate): { from: ISODate; to: ISODate; buckets: Bucket[]; byDay: boolean } {
  const week = startOfWeek(today);
  if (preset === 'semana') {
    const days = eachDay(week, addDays(week, 6));
    return { from: week, to: addDays(week, 6), byDay: true, buckets: days.map((d) => ({ label: formatDayShort(d), from: d, to: d })) };
  }
  if (preset === '4semanas') {
    const from = addDays(week, -21);
    const buckets = [0, 1, 2, 3].map((k) => {
      const s = addDays(from, k * 7);
      return { label: formatDate(s), from: s, to: addDays(s, 6) };
    });
    return { from, to: addDays(week, 6), byDay: false, buckets };
  }
  const from = startOfMonth(today);
  const to = endOfMonth(today);
  const buckets: Bucket[] = [];
  for (let s = startOfWeek(from); s <= to; s = addDays(s, 7)) {
    const bFrom = s < from ? from : s;
    const bTo = addDays(s, 6) > to ? to : addDays(s, 6);
    buckets.push({ label: formatDate(bFrom), from: bFrom, to: bTo });
  }
  return { from, to, byDay: false, buckets };
}

/** Planned minutes and recorded net minutes (closed sessions only) per bucket. Never mixes the two. */
function plannedVsRecorded(ctx: UiCtx, buckets: Bucket[], shifts: PlannedShift[], sessions: { s: WorkSession; v: SessionValues }[], nowIso: string) {
  return buckets.map((b) => {
    const planned = shifts.filter((s) => s.date >= b.from && s.date <= b.to).reduce((acc, s) => acc + shiftMinutes(s), 0);
    const recorded = sessions.filter((x) => x.s.date >= b.from && x.s.date <= b.to && x.v.start && x.v.end).reduce((acc, x) => acc + (sessionDurations(ctx.db, x.s, nowIso).netMinutes ?? 0), 0);
    return { label: b.label, planned, recorded };
  });
}

function WeekChart({ rows, byDay, ariaLabel }: { rows: { label: string; planned: number; recorded: number }[]; byDay: boolean; ariaLabel: string }) {
  const totalPlanned = rows.reduce((a, r) => a + r.planned, 0);
  const totalRecorded = rows.reduce((a, r) => a + r.recorded, 0);
  return (
    <div className="stack">
      <GroupedBarChart
        ariaLabel={ariaLabel}
        series={[t('Planificado (h)'), t('Registrado neto (h)')]}
        groupHeader={byDay ? t('Día') : t('Semana desde')}
        groups={rows.map((r) => ({ label: r.label, values: [toHours(r.planned), toHours(r.recorded)] }))}
      />
      <div className="row-wrap small">
        <span>
          {t('Planificado')}: <strong className="num">{formatDuration(totalPlanned)}</strong>
        </span>
        <span>
          {t('Registrado neto')}: <strong className="num">{formatDuration(totalRecorded)}</strong>
        </span>
      </div>
      <p className="tiny muted">
        {t('Planificado y registrado son datos distintos: un turno planificado nunca se convierte en tiempo trabajado. «Registrado neto» suma solo las sesiones con salida registrada y descuenta únicamente las pausas no retribuidas que constan en el registro.')}{' '}
        {t('Los días futuros solo tienen tiempo planificado.')}
      </p>
    </div>
  );
}

// ─────────────────────────────── Role selection ───────────────────────────────

type ViewKind = 'manager' | 'employee' | 'representative' | 'payroll' | 'other';

function viewKind(ctx: UiCtx): ViewKind {
  const manages = ctx.roles.some((r) => r === 'owner' || r === 'hr_admin' || r === 'supervisor');
  if (ctx.roles.includes('payroll') && !manages) return 'payroll';
  if (timeScope(ctx) === 'representative') return 'representative';
  if (ctx.can('time.view_team') || ctx.can('time.view_all') || ctx.can('anomalies.view_all')) return 'manager';
  if (ctx.employee && ctx.can('time.view_own')) return 'employee';
  return 'other';
}

export function DashboardPage() {
  const ctx = useCtx();
  const now = useNow(ctx);
  const kind = viewKind(ctx);
  const firstName = ctx.employee?.firstName ?? ctx.user.name.split(' ')[0];
  return (
    <>
      <PageHeader
        title={t('Inicio')}
        subtitle={
          <>
            {t('Hola, {name}.', { name: firstName })} {ctx.company.tradeName} · {formatDateLong(ctx.today)}
          </>
        }
      />
      {kind === 'manager' && <ManagerHome ctx={ctx} now={now} />}
      {kind === 'employee' && <EmployeeHome ctx={ctx} now={now} />}
      {kind === 'representative' && <RepresentativeHome ctx={ctx} now={now} />}
      {kind === 'payroll' && <PayrollHome ctx={ctx} now={now} />}
      {kind === 'other' && (
        <Card>
          <EmptyState icon={Inbox} title={t('No hay paneles disponibles para su rol')} action={<Link to="/requisitos" className="btn">{t('Ver la guía de la demostración')}</Link>}>
            {t('Use el menú lateral para acceder a las secciones permitidas.')}
          </EmptyState>
        </Card>
      )}
    </>
  );
}

function IndicatorsNote() {
  return (
    <Callout tone="neutral">
      {t('Los indicadores se calculan a partir de los registros; no constituyen una evaluación de cumplimiento legal ni conclusiones sobre ninguna persona.')}
    </Callout>
  );
}

function QuickActions({ ctx }: { ctx: UiCtx }) {
  const reviewer = ctx.can('corrections.review_team') || ctx.can('corrections.review_all') || ctx.can('corrections.propose');
  const items: ReactNode[] = [];
  if (ctx.can('time.clock_own'))
    items.push(
      <Link key="clock" to="/mi-jornada" className="btn primary">
        <LogIn size={15} aria-hidden />
        {t('Registrar entrada/salida')}
      </Link>,
    );
  if (ctx.can('absences.request_own'))
    items.push(
      <Link key="abs" to="/ausencias?nueva=1" className="btn">
        <PlaneTakeoff size={15} aria-hidden />
        {t('Solicitar ausencia')}
      </Link>,
    );
  if (reviewer)
    items.push(
      <Link key="corr" to="/correcciones" className="btn">
        <ListChecks size={15} aria-hidden />
        {t('Revisar correcciones')}
      </Link>,
    );
  if (!items.length) return null;
  return (
    <nav className="row-wrap" aria-label={t('Acciones rápidas')}>
      {items}
    </nav>
  );
}

// ─────────────────────────────── Manager view ───────────────────────────────

interface ManagerFilters {
  dep: ID | null;
  ws: ID | null;
  emp: ID | null;
}

interface TodayRow {
  employeeId: ID;
  name: string;
  shifts: PlannedShift[];
  sessions: { s: WorkSession; v: SessionValues; state: SessionState }[];
  absence: AbsenceRequest | null;
  status: DayStatus;
}

function computeManager(ctx: UiCtx, nowIso: string, f: ManagerFilters, preset: Preset) {
  const db = ctx.db;
  const cid = ctx.company.id;
  const today = ctx.today;
  const scope = visibleEmployeeIds(ctx);
  const empById = new Map(db.employees.filter((e) => e.companyId === cid).map((e) => [e.id, e]));
  const empOk = (id: ID) => {
    if (!scope.has(id)) return false;
    const e = empById.get(id);
    if (!e) return false;
    if (f.emp && id !== f.emp) return false;
    if (f.dep && e.departmentId !== f.dep) return false;
    if (f.ws && !e.worksiteIds.includes(f.ws)) return false;
    return true;
  };
  const siteOk = (ws: ID | null) => !f.ws || ws === f.ws;

  const shifts = db.shifts.filter((s) => s.companyId === cid && s.status === 'planned' && empOk(s.employeeId) && siteOk(s.worksiteId));
  const sessions = db.sessions
    .filter((s) => s.companyId === cid && empOk(s.employeeId))
    .map((s) => ({ s, v: effectiveValues(db, s) }))
    .filter((x) => siteOk(x.v.worksiteId ?? x.s.worksiteId));
  // Only sessions that are open or from today need a live state.
  const live = sessions.filter((x) => !x.v.end || x.s.date === today).map((x) => ({ ...x, state: sessionState(db, x.s, nowIso) }));

  const todaysShifts = shifts.filter((s) => s.date === today);
  const scheduled = new Set(todaysShifts.map((s) => s.employeeId));
  const working = live.filter((x) => x.state === 'working');
  const onBreak = live.filter((x) => x.state === 'on_break');
  const completedToday = live.filter((x) => x.s.date === today && x.state === 'complete');
  const incomplete = live.filter((x) => x.state === 'incomplete');

  const absences = visibleAbsences(ctx).filter((a) => empOk(a.employeeId));
  const approvedLike = (a: AbsenceRequest) => a.status === 'approved' || a.status === 'cancel_requested';
  const leaveToday = absences.filter((a) => approvedLike(a) && a.startDate <= today && a.endDate >= today);
  const onLeave = new Set(leaveToday.map((a) => a.employeeId));
  const pendingAbs = absences.filter((a) => a.status === 'pending');
  const cancelReq = absences.filter((a) => a.status === 'cancel_requested');
  const pendingCorr = visibleCorrections(ctx).filter((c) => (c.status === 'pending' || c.status === 'pending_employee') && empOk(c.employeeId));
  const openAnomalies = sortAnomalies(visibleAnomalies(ctx, nowIso).filter((a) => a.active && isOpenStatus(a.status) && empOk(a.employeeId)));

  // Today's overview: scheduled, working or on leave today.
  const ids = new Set<ID>([...scheduled, ...onLeave, ...live.filter((x) => x.s.date === today || x.state === 'working' || x.state === 'on_break').map((x) => x.s.employeeId)]);
  const todayRows: TodayRow[] = [...ids].map((id) => {
    const mine = live.filter((x) => x.s.employeeId === id && (x.s.date === today || x.state === 'working' || x.state === 'on_break'));
    const absence = leaveToday.find((a) => a.employeeId === id) ?? null;
    let status: DayStatus = 'not_yet';
    if (mine.some((x) => x.state === 'working')) status = 'working';
    else if (mine.some((x) => x.state === 'on_break')) status = 'on_break';
    else if (mine.some((x) => x.state === 'incomplete')) status = 'incomplete';
    else if (mine.some((x) => x.state === 'complete')) status = 'complete';
    else if (absence) status = 'leave';
    return { employeeId: id, name: employeeName(db, id), shifts: todaysShifts.filter((s) => s.employeeId === id).sort((a, b) => a.start.localeCompare(b.start)), sessions: mine, absence, status };
  });
  todayRows.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  // Chart.
  const range = bucketsFor(preset, today);
  const chart = plannedVsRecorded(ctx, range.buckets, shifts, sessions, nowIso);

  // Upcoming approved absences (next 30 days, ongoing included).
  const horizon = addDays(today, 30);
  const upcoming = absences.filter((a) => approvedLike(a) && a.endDate >= today && a.startDate <= horizon).sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Recent activity in the date range.
  const anyEmpFilter = !!(f.emp || f.dep || f.ws);
  const activity = db.audit
    .filter((e) => {
      if (e.companyId !== cid || e.action.startsWith('session.')) return false;
      const d = localDate(e.at, ctx.company.timezone);
      if (d < range.from || d > range.to) return false;
      if (e.employeeId) return empOk(e.employeeId);
      return ctx.can('audit.view') && !anyEmpFilter;
    })
    .filter((e) => ctx.can('audit.view') || (e.employeeId && scope.has(e.employeeId)))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 10);

  return { scheduled, working, onBreak, completedToday, incomplete, onLeave, pendingAbs, cancelReq, pendingCorr, openAnomalies, todayRows, range, chart, upcoming, activity };
}

function ManagerHome({ ctx, now }: { ctx: UiCtx; now: string }) {
  const [params, setParams] = useSearchParams();
  const rawPreset = params.get('rango') as Preset | null;
  const preset: Preset = rawPreset && PRESETS.includes(rawPreset) ? rawPreset : 'semana';
  const scope = visibleEmployeeIds(ctx);
  const scopeEmployees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && scope.has(e.id)).sort((a, b) => a.firstName.localeCompare(b.firstName, 'es'));
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id && scopeEmployees.some((e) => e.departmentId === d.id));
  const worksites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && scopeEmployees.some((e) => e.worksiteIds.includes(w.id)));
  const pick = (k: string, list: { id: ID }[]) => {
    const v = params.get(k);
    return v && list.some((x) => x.id === v) ? v : null;
  };
  const filters: ManagerFilters = { dep: pick('departamento', departments), ws: pick('centro', worksites), emp: pick('empleado', scopeEmployees) };
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => computeManager(ctx, now, filters, preset), [ctx, now, filters.dep, filters.ws, filters.emp, preset]);
  const paged = usePaged(d.todayRows, 10);
  const today = ctx.today;
  const tz = ctx.company.timezone;

  const calQS = `fecha=${today}&vista=dia${filters.dep ? `&departamento=${filters.dep}` : ''}${filters.ws ? `&centro=${filters.ws}` : ''}${filters.emp ? `&empleado=${filters.emp}` : ''}`;
  const empQS = filters.emp ? `&empleado=${filters.emp}` : '';
  const calLink = canOpen(ctx, SECTION_PERMS.calendar) ? `/calendario?${calQS}` : null;
  const recLink = (qs: string) => (canOpen(ctx, SECTION_PERMS.records) ? `/registros?${qs}${empQS}` : null);
  const incompleteFrom: ISODate = d.incomplete.map((x) => x.s.date).sort()[0] ?? addDays(today, -30);

  const pa = pendingActions(ctx);
  const corrAwaiting = correctionsAwaitingMe(ctx).filter((c) => c.employeeId !== ctx.employee?.id);
  const absAwaiting = absencesAwaitingMe(ctx);

  return (
    <div className="stack-lg">
      <QuickActions ctx={ctx} />

      <Card flush>
        <div className="toolbar" role="search" aria-label={t('Filtros')}>
          <div className="field">
            <label htmlFor="home-range">{t('Periodo del gráfico y la actividad')}</label>
            <select id="home-range" className="select" value={preset} onChange={(e) => setParam('rango', e.target.value === 'semana' ? null : e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(PRESET_LABEL[p])}
                </option>
              ))}
            </select>
          </div>
          {departments.length > 1 && (
            <div className="field">
              <label htmlFor="home-dep">{t('Departamento')}</label>
              <select id="home-dep" className="select" value={filters.dep ?? ''} onChange={(e) => setParam('departamento', e.target.value || null)}>
                <option value="">{t('Todos')}</option>
                {departments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="home-ws">{t('Centro')}</label>
            <select id="home-ws" className="select" value={filters.ws ?? ''} onChange={(e) => setParam('centro', e.target.value || null)}>
              <option value="">{t('Todos')}</option>
              {worksites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="home-emp">{t('Empleado')}</label>
            <select id="home-emp" className="select" value={filters.emp ?? ''} onChange={(e) => setParam('empleado', e.target.value || null)}>
              <option value="">{t('Todos')}</option>
              {scopeEmployees.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.firstName} {x.lastName}
                </option>
              ))}
            </select>
          </div>
          <p className="tiny muted home-filter-note">
            {t('Las cifras de hoy se refieren siempre a hoy ({date}); el periodo solo afecta al gráfico y a la actividad.', { date: formatDate(today) })}
          </p>
        </div>
      </Card>

      <section aria-labelledby="home-today">
        <h2 id="home-today" style={{ marginBottom: 8 }}>
          {t('Hoy')}
        </h2>
        <div className="kpis">
          <Kpi icon={CalendarDays} label={t('Con turno planificado hoy')} value={d.scheduled.size} meta={t('Personas con turno; no es tiempo trabajado')} to={calLink} />
          <Kpi icon={Clock3} label={t('Con sesión abierta')} value={d.working.length + d.onBreak.length} meta={t('De ellas, en pausa: {n}', { n: d.onBreak.length })} to={recLink('estado=working')} />
          <Kpi icon={Coffee} label={t('En pausa registrada')} value={d.onBreak.length} to={recLink('estado=on_break')} />
          <Kpi icon={CheckCircle2} label={t('Sesiones completadas hoy')} value={d.completedToday.length} to={recLink(`estado=complete&desde=${today}&hasta=${today}`)} />
          <Kpi icon={AlertTriangle} label={t('Salidas sin registrar')} value={d.incomplete.length} meta={t('Sesiones incompletas: requieren una corrección revisada')} tone={d.incomplete.length ? 'warning' : undefined} to={ctx.can('anomalies.view_all') || ctx.can('anomalies.manage_team') ? '/incidencias?tipo=missing_clock_out' : recLink(`estado=incomplete&desde=${incompleteFrom}`)} />
          <Kpi icon={ListChecks} label={t('Correcciones pendientes')} value={d.pendingCorr.length} meta={t('En su ámbito')} to={canOpen(ctx, SECTION_PERMS.corrections) ? '/correcciones?estado=pending' : null} />
          <Kpi icon={PlaneTakeoff} label={t('Ausencias pendientes')} value={d.pendingAbs.length} meta={d.cancelReq.length ? t('Y {n} cancelación(es) solicitada(s)', { n: d.cancelReq.length }) : t('En su ámbito')} to={canOpen(ctx, SECTION_PERMS.absences) ? '/ausencias?estado=pending' : null} />
          <Kpi icon={ShieldAlert} label={t('Incidencias abiertas')} value={d.openAnomalies.length} meta={t('Solicitudes de revisión, no conclusiones')} tone={d.openAnomalies.length ? 'warning' : undefined} to={canOpen(ctx, SECTION_PERMS.exceptions) ? '/incidencias' : null} />
          <Kpi icon={Users} label={t('En ausencia aprobada hoy')} value={d.onLeave.size} to={calLink} />
        </div>
      </section>

      <div className="grid-main-side">
        <div className="stack-lg">
          <Card title={t('Asistencia de hoy')} actions={calLink ? <Link to={calLink} className="btn sm ghost">{t('Ver en el calendario')}</Link> : undefined} flush>
            {d.todayRows.length === 0 ? (
              <EmptyState icon={CalendarDays} title={t('Nadie tiene turno, sesión ni ausencia hoy')}>
                {t('Hoy no hay turnos planificados ni registros en su ámbito con los filtros actuales.')}
              </EmptyState>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('Empleado')}</th>
                        <th>{t('Turno planificado')}</th>
                        <th>{t('Registro')}</th>
                        <th>{t('Estado')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.rows.map((r) => (
                        <tr key={r.employeeId}>
                          <td>
                            <EmployeeLink id={r.employeeId} />
                          </td>
                          <td>
                            {r.shifts.length === 0 ? (
                              <span className="muted small">{t('Sin turno planificado')}</span>
                            ) : (
                              <div className="stack-sm" style={{ gap: 2 }}>
                                {r.shifts.map((s) => (
                                  <span key={s.id} className="small">
                                    <Interval start={s.start} end={s.end} tz={s.timezone} baseDate={s.date} /> <span className="muted">· {ctx.db.worksites.find((w) => w.id === s.worksiteId)?.name ?? '—'}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            {r.sessions.length === 0 ? (
                              r.absence ? (
                                <span className="small">{t(absenceTypeLabel(ctx, r.absence))}</span>
                              ) : (
                                <span className="muted small">{t('Sin registro aún')}</span>
                              )
                            ) : (
                              <div className="stack-sm" style={{ gap: 2 }}>
                                {r.sessions.map((x) => (
                                  <Link key={x.s.id} to={`/registros/${x.s.id}`} className="small">
                                    <Interval start={x.v.start} end={x.v.end} tz={x.s.timezone} baseDate={x.s.date} />
                                    {x.s.date !== today && <span className="tiny muted"> ({t('desde el {date}', { date: formatDate(x.s.date) })})</span>}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="row-wrap" style={{ gap: 4 }}>
                              <DayStatusBadge status={r.status} />
                              {r.absence && r.status !== 'leave' && <DayStatusBadge status="leave" />}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.todayRows.length > 10 && <Pagination {...paged.props} />}
                <p className="tiny muted" style={{ padding: '8px 16px' }}>
                  {t('«Sin registro aún» solo indica que todavía no consta una entrada; no implica una ausencia injustificada.')}
                </p>
              </>
            )}
          </Card>

          <Card title={t('Tiempo planificado y registrado')} actions={<span className="small muted">{t(PRESET_LABEL[preset])}</span>}>
            <WeekChart rows={d.chart} byDay={d.range.byDay} ariaLabel={t('Horas planificadas y horas netas registradas por periodo')} />
          </Card>

          <Card
            title={t('Actividad reciente')}
            actions={ctx.can('audit.view') ? <Link to="/auditoria" className="btn sm ghost">{t('Ver auditoría')}</Link> : undefined}
          >
            <p className="tiny muted" style={{ marginTop: 0 }}>
              {ctx.can('audit.view') ? t('Últimos eventos de la empresa en el periodo seleccionado.') : t('Últimos eventos sobre las personas de su ámbito en el periodo seleccionado.')}
            </p>
            {d.activity.length === 0 ? (
              <EmptyState icon={History} title={t('Sin actividad en el periodo')} />
            ) : (
              <ol className="timeline" aria-label={t('Actividad reciente')}>
                {d.activity.map((e) => (
                  <li key={e.id}>
                    <div className="row between" style={{ gap: 8 }}>
                      <span className="strong">{t(AUDIT_ACTION_LABEL[e.action] ?? e.action)}</span>
                      <span className="tiny muted nowrap">{formatInstant(e.at, tz)}</span>
                    </div>
                    <div className="tiny">
                      {e.employeeId ? `${employeeName(ctx.db, e.employeeId)} · ` : ''}
                      {t(e.summary)}
                    </div>
                    <div className="tiny muted">{e.actor.name}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="stack-lg">
          <Card title={t('Pendiente de su acción')}>
            <div className="stack">
              <div className="row-wrap">
                <Badge tone={pa.corrections ? 'warning' : 'neutral'}>{t('Correcciones: {n}', { n: pa.corrections })}</Badge>
                <Badge tone={pa.absences ? 'warning' : 'neutral'}>{t('Ausencias: {n}', { n: pa.absences })}</Badge>
                <Badge tone={pa.anomalies ? 'warning' : 'neutral'}>{t('Incidencias: {n}', { n: pa.anomalies })}</Badge>
              </div>
              {corrAwaiting.length === 0 && absAwaiting.length === 0 ? (
                <EmptyState icon={CheckCircle2} title={t('No hay solicitudes esperando su revisión')} />
              ) : (
                <ul className="home-list">
                  {corrAwaiting.slice(0, 5).map((c) => (
                    <CorrectionItem key={c.id} c={c} ctx={ctx} showEmployee />
                  ))}
                  {absAwaiting.slice(0, 5).map((a) => (
                    <AbsenceItem key={a.id} a={a} ctx={ctx} showEmployee />
                  ))}
                </ul>
              )}
              {pa.myProposals > 0 && (
                <Callout tone="info">
                  <Link to="/correcciones?estado=pending_employee">{t('Tiene {n} propuesta(s) de la empresa sobre sus propios registros pendiente(s) de su conformidad.', { n: pa.myProposals })}</Link>
                </Callout>
              )}
            </div>
          </Card>

          <Card title={t('Incidencias por revisar')} actions={canOpen(ctx, SECTION_PERMS.exceptions) ? <Link to="/incidencias" className="btn sm ghost">{t('Ver todas')}</Link> : undefined}>
            <AnomalyList ctx={ctx} list={d.openAnomalies.slice(0, 5)} />
          </Card>

          <Card title={t('Próximas ausencias aprobadas')} actions={<span className="small muted">{t('30 días')}</span>}>
            {d.upcoming.length === 0 ? (
              <EmptyState icon={PlaneTakeoff} title={t('No hay ausencias aprobadas en los próximos 30 días')} />
            ) : (
              <ul className="home-list">
                {d.upcoming.slice(0, 8).map((a) => (
                  <AbsenceItem key={a.id} a={a} ctx={ctx} showEmployee />
                ))}
              </ul>
            )}
            {d.upcoming.length > 8 && (
              <p className="tiny muted">
                <Link to="/ausencias">{t('Y {n} más en Ausencias', { n: d.upcoming.length - 8 })}</Link>
              </p>
            )}
          </Card>
        </div>
      </div>

      <IndicatorsNote />
    </div>
  );
}

function CorrectionItem({ c, ctx, showEmployee }: { c: CorrectionRequest; ctx: UiCtx; showEmployee?: boolean }) {
  return (
    <li>
      <div className="stack-sm grow" style={{ gap: 2 }}>
        <Link to={`/correcciones/${c.id}`} className="strong">
          {t(CORRECTION_KIND_LABEL[c.kind])}
        </Link>
        <span className="tiny muted">
          {showEmployee ? `${employeeName(ctx.db, c.employeeId)} · ` : ''}
          {t('Jornada del {date}', { date: formatDate(c.date) })}
        </span>
      </div>
      <StatusBadge meta={CORRECTION_STATUS[c.status]} />
    </li>
  );
}

function AbsenceItem({ a, ctx, showEmployee }: { a: AbsenceRequest; ctx: UiCtx; showEmployee?: boolean }) {
  return (
    <li>
      <div className="stack-sm grow" style={{ gap: 2 }}>
        <Link to={`/ausencias/${a.id}`} className="strong">
          {showEmployee ? employeeName(ctx.db, a.employeeId) : t(absenceTypeLabel(ctx, a))}
        </Link>
        <span className="tiny muted">
          {showEmployee ? `${t(absenceTypeLabel(ctx, a))} · ` : ''}
          {a.startDate === a.endDate ? formatDate(a.startDate) : t('Del {from} al {to}', { from: formatDate(a.startDate), to: formatDate(a.endDate) })}
          {a.partial ? ` · ${a.partial.startTime}–${a.partial.endTime}` : ''}
        </span>
      </div>
      <StatusBadge meta={ABSENCE_STATUS[a.status]} />
    </li>
  );
}

function AnomalyList({ ctx, list }: { ctx: UiCtx; list: Anomaly[] }) {
  if (!list.length) return <EmptyState icon={ShieldAlert} title={t('No hay incidencias abiertas')} />;
  const linkable = canOpen(ctx, SECTION_PERMS.exceptions);
  return (
    <ul className="home-list">
      {list.map((a) => (
        <li key={a.key}>
          <div className="stack-sm grow" style={{ gap: 2 }}>
            {linkable ? (
              <Link to={`/incidencias?clave=${encodeURIComponent(a.key)}`} className="strong">
                {t(ANOMALY_LABEL[a.type])}
              </Link>
            ) : (
              <span className="strong">{t(ANOMALY_LABEL[a.type])}</span>
            )}
            <span className="tiny muted">
              {employeeName(ctx.db, a.employeeId)} · {formatDate(a.date)}
            </span>
            <span className="tiny">{msg(a.reason)}</span>
          </div>
          <Badge tone={ANOMALY_STATUS_TONE[a.status]}>{t(ANOMALY_STATUS_LABEL[a.status])}</Badge>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────── Employee view ───────────────────────────────

function EmployeeHome({ ctx, now, embedded }: { ctx: UiCtx; now: string; embedded?: boolean }) {
  const me = ctx.employee!;
  const db = ctx.db;
  const today = ctx.today;
  const st = useMemo(() => myStatus(ctx), [ctx]);
  const data = useMemo(() => {
    const shifts = db.shifts.filter((s) => s.companyId === ctx.company.id && s.employeeId === me.id && s.status === 'planned');
    const sessions = db.sessions.filter((s) => s.companyId === ctx.company.id && s.employeeId === me.id).map((s) => ({ s, v: effectiveValues(db, s) }));
    const week = bucketsFor('semana', today);
    const chart = plannedVsRecorded(ctx, week.buckets, shifts, sessions, now);
    const absences = visibleAbsences(ctx).filter((a) => a.employeeId === me.id);
    const pendingAbs = absences.filter((a) => a.status === 'pending' || a.status === 'draft' || a.status === 'cancel_requested').sort((a, b) => a.startDate.localeCompare(b.startDate));
    const upcoming = absences.filter((a) => (a.status === 'approved' || a.status === 'cancel_requested') && a.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const myCorr = visibleCorrections(ctx).filter((c) => c.employeeId === me.id);
    const pendingCorr = myCorr.filter((c) => c.status === 'pending');
    const proposals = correctionsAwaitingMe(ctx).filter((c) => c.status === 'pending_employee' && c.employeeId === me.id);
    const otherProposals = myCorr.filter((c) => c.status === 'pending_employee' && !proposals.includes(c));
    const failed = failedAttemptsFor(ctx, me.id);
    const todayShifts = shifts.filter((s) => s.date === today).sort((a, b) => a.start.localeCompare(b.start));
    const leaveToday = upcoming.find((a) => a.startDate <= today && a.endDate >= today) ?? null;
    return { chart, pendingAbs, upcoming, pendingCorr, proposals, otherProposals, failed, todayShifts, leaveToday };
  }, [ctx, db, me.id, today, now]);

  const dayStatus: DayStatus = st.state === 'not_started' ? (data.leaveToday ? 'leave' : 'not_yet') : st.state;
  const stale = st.staleSession;
  const staleCorrection = stale ? db.corrections.find((c) => c.sessionId === stale.id && (c.status === 'pending' || c.status === 'pending_employee')) : undefined;
  const tz = ctx.company.timezone;
  const current = st.session ? effectiveValues(db, st.session) : null;
  const currentDur = st.session ? sessionDurations(db, st.session, now) : null;

  return (
    <div className="stack-lg">
      {!embedded && <QuickActions ctx={ctx} />}

      {data.proposals.length > 0 && (
        <Callout tone="warning" title={t('Propuestas de la empresa pendientes de su conformidad')}>
          <ul className="home-list">
            {data.proposals.map((c) => (
              <CorrectionItem key={c.id} c={c} ctx={ctx} />
            ))}
          </ul>
          <p className="tiny" style={{ margin: '4px 0 0' }}>
            {t('Puede mostrar su conformidad o dejar constancia de su discrepancia. El registro original se conserva en cualquier caso.')}
          </p>
        </Callout>
      )}

      <div className="grid-2">
        <Card title={t('Mi jornada de hoy')} actions={ctx.can('time.clock_own') ? <Link to="/mi-jornada" className="btn sm primary">{t('Ir a Mi jornada')}</Link> : undefined}>
          <div className="stack">
            <div className="row-wrap">
              <DayStatusBadge status={dayStatus} />
              {data.leaveToday && dayStatus !== 'leave' && <DayStatusBadge status="leave" />}
            </div>
            <KV
              items={[
                [
                  t('Turno planificado'),
                  data.todayShifts.length ? (
                    <span className="stack-sm" style={{ gap: 2 }}>
                      {data.todayShifts.map((s) => (
                        <span key={s.id}>
                          <Interval start={s.start} end={s.end} tz={s.timezone} baseDate={s.date} /> <span className="muted small">· {db.worksites.find((w) => w.id === s.worksiteId)?.name ?? '—'}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="muted">{t('Sin turno planificado')}</span>
                  ),
                ],
                [
                  t('Registro'),
                  st.session && current ? (
                    <Link to={`/registros/${st.session.id}`}>
                      <Interval start={current.start} end={current.end} tz={st.session.timezone} baseDate={st.session.date} />
                    </Link>
                  ) : (
                    <span className="muted">{t('Sin registro aún')}</span>
                  ),
                ],
                [t('Tiempo neto'), currentDur ? <DurationText minutes={currentDur.netMinutes} provisional={currentDur.provisional} /> : '—'],
              ]}
            />
            {stale && (
              <Callout tone="warning" title={t('Jornada anterior sin salida registrada')}>
                {t('La sesión del {date} no tiene salida. No se completa automáticamente: debe corregirse mediante una solicitud revisada.', { date: formatDate(stale.date) })}{' '}
                {staleCorrection ? (
                  <Link to={`/correcciones/${staleCorrection.id}`}>{t('Ver la corrección en curso')}</Link>
                ) : (
                  ctx.can('corrections.request_own') && <Link to={`/correcciones?nueva=1&sesion=${stale.id}`}>{t('Solicitar corrección')}</Link>
                )}
              </Callout>
            )}
          </div>
        </Card>

        <Card title={t('Esta semana')}>
          <WeekChart rows={data.chart} byDay ariaLabel={t('Mis horas planificadas y netas registradas por día de esta semana')} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title={t('Mis solicitudes pendientes')}>
          {data.pendingCorr.length + data.otherProposals.length + data.pendingAbs.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t('No tiene solicitudes pendientes')} />
          ) : (
            <ul className="home-list">
              {[...data.pendingCorr, ...data.otherProposals].map((c) => (
                <CorrectionItem key={c.id} c={c} ctx={ctx} />
              ))}
              {data.pendingAbs.map((a) => (
                <AbsenceItem key={a.id} a={a} ctx={ctx} />
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('Mis próximas ausencias aprobadas')}>
          {data.upcoming.length === 0 ? (
            <EmptyState icon={PlaneTakeoff} title={t('No tiene ausencias aprobadas próximas')} action={ctx.can('absences.request_own') ? <Link to="/ausencias?nueva=1" className="btn sm">{t('Solicitar ausencia')}</Link> : undefined} />
          ) : (
            <ul className="home-list">
              {data.upcoming.slice(0, 6).map((a) => (
                <AbsenceItem key={a.id} a={a} ctx={ctx} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('Fichajes «No registrado»')}>
        {data.failed.length === 0 ? (
          <EmptyState icon={WifiOff} title={t('No consta ningún intento de fichaje fallido')} />
        ) : (
          <ul className="home-list">
            {data.failed.map((f) => (
              <li key={f.id}>
                <div className="stack-sm grow" style={{ gap: 2 }}>
                  <span className="strong">
                    {t(EVENT_TYPE_LABEL[f.action])} · <span className="num">{formatInstant(f.attemptedAt, tz)}</span>
                  </span>
                  <span className="tiny muted">{t('No se guardó ningún evento. Se completa mediante una solicitud de corrección.')}</span>
                </div>
                {f.correctionId ? (
                  <Link to={`/correcciones/${f.correctionId}`} className="btn sm">
                    {t('Ver corrección')}
                  </Link>
                ) : ctx.can('corrections.request_own') ? (
                  <Link to={`/correcciones?nueva=1&fallo=${f.id}`} className="btn sm primary">
                    {t('Solicitar corrección')}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!embedded && <IndicatorsNote />}
    </div>
  );
}

// ─────────────────────────────── Representative view ───────────────────────────────

function RepresentativeHome({ ctx, now }: { ctx: UiCtx; now: string }) {
  const period = ctx.today.slice(0, 7);
  const data = useMemo(() => {
    const { from, to } = periodRange(period);
    const rows = recordRows(ctx, { ...EMPTY_FILTERS, from, to }, now);
    const ps = periodStatus(ctx, period, now);
    const depts = ctx.db.departments
      .filter((d) => d.companyId === ctx.company.id)
      .map((d) => {
        const people = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.departmentId === d.id && e.status === 'active');
        const ids = new Set(people.map((e) => e.id));
        const mine = rows.filter((r) => ids.has(r.employeeId));
        return {
          id: d.id,
          name: d.name,
          people: people.length,
          sessions: mine.length,
          net: mine.reduce((acc, r) => acc + (r.end ? r.netMinutes ?? 0 : 0), 0),
          open: mine.filter((r) => !r.end).length,
        };
      });
    return { ps, depts };
  }, [ctx, period, now]);
  const until = ctx.membership?.roleValidUntil?.representative ?? ctx.membership?.validUntil ?? null;

  return (
    <div className="stack-lg">
      <Callout tone="info" title={t('Acceso de representación: minimizado y temporal')}>
        {t('Como representación legal de los trabajadores consulta los registros horarios con datos minimizados: sin datos de contacto ni motivos de ausencia (ET art. 34.9). Cada consulta y exportación queda registrada en la auditoría.')}{' '}
        {until ? t('Acceso vigente hasta el {date}.', { date: formatDate(until) }) : null}
      </Callout>

      <section aria-labelledby="rep-period">
        <h2 id="rep-period" style={{ marginBottom: 8 }}>
          {formatMonth(period)}
        </h2>
        <div className="kpis">
          <Kpi icon={ShieldAlert} label={t('Incidencias abiertas')} value={data.ps.openExceptions} meta={t('Toda la empresa, en el periodo')} to={null} />
          <Kpi icon={AlertTriangle} label={t('Registros incompletos')} value={data.ps.incompleteRecords} to={null} />
          <Kpi icon={ListChecks} label={t('Correcciones pendientes')} value={data.ps.pendingCorrections} to={null} />
        </div>
      </section>

      <Card title={t('Resumen agregado por departamento')} flush>
        {data.depts.length === 0 ? (
          <EmptyState icon={Users} title={t('Sin departamentos')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Departamento')}</th>
                  <th className="num">{t('Personas')}</th>
                  <th className="num">{t('Sesiones registradas')}</th>
                  <th className="num">{t('Horas netas registradas')}</th>
                  <th className="num">{t('Sesiones sin salida')}</th>
                </tr>
              </thead>
              <tbody>
                {data.depts.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td className="num">{d.people}</td>
                    <td className="num">{d.sessions}</td>
                    <td className="num">{formatDuration(d.net)}</td>
                    <td className="num">{d.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tiny muted" style={{ padding: '8px 16px' }}>
          {t('Cifras agregadas del mes en curso; las sesiones sin salida no se suman a las horas.')}
        </p>
      </Card>

      <div className="row-wrap">
        {canOpen(ctx, SECTION_PERMS.records) && (
          <Link to="/registros" className="btn">
            <FileClock size={15} aria-hidden />
            {t('Consultar registros horarios')}
          </Link>
        )}
        {canOpen(ctx, SECTION_PERMS.reports) && (
          <Link to="/informes" className="btn">
            <BarChart3 size={15} aria-hidden />
            {t('Informes y exportaciones')}
          </Link>
        )}
      </div>

      {ctx.employee && ctx.can('time.view_own') && (
        <section aria-labelledby="rep-personal" className="stack">
          <h2 id="rep-personal">{t('Mi espacio personal')}</h2>
          <QuickActions ctx={ctx} />
          <EmployeeHome ctx={ctx} now={now} embedded />
        </section>
      )}

      <IndicatorsNote />
    </div>
  );
}

// ─────────────────────────────── Payroll adviser view ───────────────────────────────

function PayrollHome({ ctx, now }: { ctx: UiCtx; now: string }) {
  const current = ctx.today.slice(0, 7);
  const previous = addMonths(`${current}-01`, -1).slice(0, 7);
  const data = useMemo(
    () => ({
      periods: [periodStatus(ctx, current, now), periodStatus(ctx, previous, now)],
      anomalies: sortAnomalies(visibleAnomalies(ctx, now).filter((a) => a.active && isOpenStatus(a.status))),
    }),
    [ctx, current, previous, now],
  );
  const until = ctx.membership?.validUntil ?? null;

  return (
    <div className="stack-lg">
      <Callout tone="info" title={t('Acceso de asesoría laboral')}>
        {t('Consulta de resúmenes de periodo, ausencias e incidencias abiertas para la preparación de la nómina. Sin administración de empleados.')}{' '}
        {until ? t('Mandato vigente hasta el {date}.', { date: formatDate(until) }) : null}
      </Callout>

      <div className="grid-2">
        {data.periods.map((p, i) => {
          const range = periodRange(p.period);
          const meta = PERIOD_STATUS[p.status === 'closed' ? 'closed' : 'open'];
          return (
            <Card
              key={p.period}
              title={
                <div className="row-wrap">
                  <h2>{formatMonth(p.period)}</h2>
                  <span className="tiny muted">{i === 0 ? t('Periodo en curso') : t('Periodo anterior')}</span>
                </div>
              }
              actions={<StatusBadge meta={meta} />}
              footer={
                <div className="row-wrap">
                  {canOpen(ctx, SECTION_PERMS.records) && (
                    <Link to={`/registros?desde=${range.from}&hasta=${range.to}`} className="btn sm">
                      {t('Registros del periodo')}
                    </Link>
                  )}
                  {canOpen(ctx, SECTION_PERMS.reports) && (
                    <Link to="/informes" className="btn sm">
                      {t('Informes y exportaciones')}
                    </Link>
                  )}
                </div>
              }
            >
              <KV
                items={[
                  [t('Incidencias abiertas'), <span className="num">{p.openExceptions}</span>],
                  [t('Correcciones pendientes'), <span className="num">{p.pendingCorrections}</span>],
                  [t('Ausencias pendientes'), <span className="num">{p.pendingAbsences}</span>],
                  [t('Registros incompletos'), <span className="num">{p.incompleteRecords}</span>],
                  ...(p.record?.status === 'closed' && p.record.closedAt ? ([[t('Cerrado el'), <DateText date={localDate(p.record.closedAt, ctx.company.timezone)} />]] as [ReactNode, ReactNode][]) : []),
                ]}
              />
            </Card>
          );
        })}
      </div>

      <Card title={t('Incidencias abiertas')} actions={canOpen(ctx, SECTION_PERMS.exceptions) ? <Link to="/incidencias" className="btn sm ghost">{t('Ver todas')}</Link> : undefined}>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          {t('Las incidencias abiertas se declaran en cada exportación. Son solicitudes de revisión, no conclusiones.')}
        </p>
        <AnomalyList ctx={ctx} list={data.anomalies.slice(0, 5)} />
        {data.anomalies.length > 5 && <p className="tiny muted">{t('Y {n} más.', { n: data.anomalies.length - 5 })}</p>}
      </Card>

      <IndicatorsNote />
    </div>
  );
}
