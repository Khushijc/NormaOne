/**
 * "Turnos planificados": weekly planner. A planned shift is a forecast only; it never creates
 * worked time (TIM-03, research R11). Actual time is recorded by the employee in "Mi jornada".
 */
import { AlertTriangle, CalendarDays, CalendarOff, ChevronLeft, ChevronRight, Copy, Plane, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DurationText, EmployeeLink, msg, TimeText } from '../../components/bits';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, describeError, EmptyState, Modal, SelectField, TextAreaField, TextField, useAction, useToast } from '../../components/ui';
import { relationshipOn } from '../../domain/records';
import { addDays, eachDay, formatDate, formatDateLong, formatDayShort, localTime, minutesBetween, startOfWeek } from '../../domain/time';
import type { AbsenceRequest, Employee, Holiday, ID, ISODate, Msg, PlannedShift, Worksite } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { absenceTypeLabel, visibleAbsences } from '../../services/absenceService';
import { visibleEmployeeIds } from '../../services/context';
import { cancelShift, canManageShiftsFor, checkShift, saveShift, type ShiftInput } from '../../services/planningService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { byName, fullName, shortSiteName, worksiteById } from './shared';

const HHMM = /^\d{2}:\d{2}$/;

type HolidayLookup = (worksiteId: ID | null | undefined, date: ISODate) => Holiday | undefined;

function holidayLookup(ctx: UiCtx): HolidayLookup {
  const byCal = new Map(ctx.db.calendars.filter((c) => c.companyId === ctx.company.id).map((c) => [c.id, new Map(c.holidays.map((h) => [h.date, h]))]));
  return (worksiteId, date) => {
    const ws = worksiteById(ctx.db, worksiteId);
    return ws ? byCal.get(ws.calendarId)?.get(date) : undefined;
  };
}

/** Sensible defaults for a new shift: the employee's latest planned pattern, else the primary site 08:00–16:00. */
function defaultInput(ctx: UiCtx, e: Employee, date: ISODate): ShiftInput {
  const last = ctx.db.shifts
    .filter((s) => s.employeeId === e.id && s.status === 'planned' && s.date < date && e.worksiteIds.includes(s.worksiteId))
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  if (last) return { employeeId: e.id, worksiteId: last.worksiteId, date, startTime: localTime(last.start, last.timezone), endTime: localTime(last.end, last.timezone), note: '' };
  return { employeeId: e.id, worksiteId: e.primaryWorksiteId, date, startTime: '08:00', endTime: '16:00', note: '' };
}

function inputFromShift(s: PlannedShift): ShiftInput {
  return { employeeId: s.employeeId, worksiteId: s.worksiteId, date: s.date, startTime: localTime(s.start, s.timezone), endTime: localTime(s.end, s.timezone), note: s.note };
}

interface WeekData {
  shiftsByCell: Map<string, PlannedShift[]>;
  absencesByCell: Map<string, AbsenceRequest[]>;
  overlaps: Set<ID>;
  plannedMinutes: Map<ID, number>;
  headerHolidays: Map<ISODate, string[]>;
}

function buildWeek(ctx: UiCtx, rows: Employee[], days: ISODate[], showCancelled: boolean): WeekData {
  const ids = new Set(rows.map((e) => e.id));
  const first = days[0];
  const last = days[days.length - 1];
  // The day before the week is included so an overnight shift from Sunday is checked for overlaps.
  const shifts = ctx.db.shifts.filter((s) => s.companyId === ctx.company.id && ids.has(s.employeeId) && s.date >= addDays(first, -1) && s.date <= last);
  const planned = shifts.filter((s) => s.status === 'planned');
  const overlaps = new Set<ID>();
  const perEmployee = new Map<ID, PlannedShift[]>();
  for (const s of planned) perEmployee.set(s.employeeId, [...(perEmployee.get(s.employeeId) ?? []), s]);
  for (const list of perEmployee.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].start < list[j].end && list[j].start < list[i].end) {
          overlaps.add(list[i].id);
          overlaps.add(list[j].id);
        }
      }
    }
  }
  const shiftsByCell = new Map<string, PlannedShift[]>();
  const plannedMinutes = new Map<ID, number>();
  for (const s of shifts) {
    if (s.date < first) continue;
    if (s.status === 'planned') plannedMinutes.set(s.employeeId, (plannedMinutes.get(s.employeeId) ?? 0) + minutesBetween(s.start, s.end));
    if (s.status === 'cancelled' && !showCancelled) continue;
    const k = `${s.employeeId}|${s.date}`;
    shiftsByCell.set(k, [...(shiftsByCell.get(k) ?? []), s]);
  }
  for (const list of shiftsByCell.values()) list.sort((a, b) => a.start.localeCompare(b.start));

  const absencesByCell = new Map<string, AbsenceRequest[]>();
  for (const a of visibleAbsences(ctx)) {
    if (!ids.has(a.employeeId) || (a.status !== 'approved' && a.status !== 'cancel_requested')) continue;
    if (a.endDate < first || a.startDate > last) continue;
    for (const d of days) {
      if (d < a.startDate || d > a.endDate) continue;
      const k = `${a.employeeId}|${d}`;
      absencesByCell.set(k, [...(absencesByCell.get(k) ?? []), a]);
    }
  }

  const headerHolidays = new Map<ISODate, string[]>();
  for (const c of ctx.db.calendars.filter((x) => x.companyId === ctx.company.id)) {
    for (const h of c.holidays) {
      if (h.date < first || h.date > last) continue;
      const names = headerHolidays.get(h.date) ?? [];
      if (!names.includes(h.name)) names.push(h.name);
      headerHolidays.set(h.date, names);
    }
  }
  return { shiftsByCell, absencesByCell, overlaps, plannedMinutes, headerHolidays };
}

export function ShiftsTab() {
  const ctx = useCtx();
  const canPlan = ctx.can('shifts.manage_team') || ctx.can('shifts.manage_all');
  const canSeeTerms = ctx.can('employees.view_all') || ctx.can('employees.view_team');
  const canSeeCalendar = ctx.can('time.view_own') || ctx.can('time.view_team') || ctx.can('time.view_all');
  const [week, setWeek] = useState<ISODate>(() => startOfWeek(ctx.today));
  const [dept, setDept] = useState('');
  const [site, setSite] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [editor, setEditor] = useState<{ input: ShiftInput; shift: PlannedShift | null } | null>(null);
  const [copying, setCopying] = useState(false);

  const days = useMemo(() => eachDay(week, addDays(week, 6)), [week]);
  const people = useMemo(() => {
    const visible = visibleEmployeeIds(ctx);
    return ctx.db.employees
      .filter((e) => e.companyId === ctx.company.id && e.status === 'active' && (canPlan ? canManageShiftsFor(ctx, e.id) : visible.has(e.id)))
      .sort(byName);
  }, [ctx, canPlan]);
  const rows = useMemo(() => people.filter((e) => (!dept || e.departmentId === dept) && (!site || e.worksiteIds.includes(site))), [people, dept, site]);
  const data = useMemo(() => buildWeek(ctx, rows, days, showCancelled), [ctx, rows, days, showCancelled]);
  const holidayOf = useMemo(() => holidayLookup(ctx), [ctx]);
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);
  const worksites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id);
  const inWeek = ctx.today >= days[0] && ctx.today <= days[6];

  const openNew = (e: Employee | undefined, date: ISODate) => {
    if (!e) return;
    setEditor({ input: defaultInput(ctx, e, date), shift: null });
  };

  return (
    <div className="stack">
      <Callout tone="info" title={t('Un turno planificado nunca genera tiempo trabajado; el registro real lo hace la persona trabajadora.')}>
        {t('Las horas planificadas, las horas registradas, las ausencias, las incidencias revisadas y el tratamiento en nómina son conceptos separados. Aquí solo se planifica: no se crean fichajes, no se descuentan pausas y no se limitan horas.')}
      </Callout>
      {!canPlan && <Callout tone="neutral">{t('Consulta de solo lectura: la planificación la gestionan la supervisión (su equipo) y RR. HH. (toda la plantilla).')}</Callout>}

      <Card
        flush
        title={t('Planificación semanal')}
        actions={
          canPlan && (
            <>
              <Button size="sm" icon={Copy} onClick={() => setCopying(true)} disabled={rows.length === 0}>
                {t('Copiar semana anterior')}
              </Button>
              <Button size="sm" variant="primary" icon={Plus} onClick={() => openNew(rows[0], inWeek ? ctx.today : days[0])} disabled={rows.length === 0}>
                {t('Añadir turno')}
              </Button>
            </>
          )
        }
      >
        <div className="toolbar">
          <div className="row plan-weeknav" role="group" aria-label={t('Semana')}>
            <Button size="sm" iconOnly icon={ChevronLeft} aria-label={t('Semana anterior')} onClick={() => setWeek(addDays(week, -7))} />
            <Button size="sm" onClick={() => setWeek(startOfWeek(ctx.today))} disabled={inWeek}>
              {t('Hoy')}
            </Button>
            <Button size="sm" iconOnly icon={ChevronRight} aria-label={t('Semana siguiente')} onClick={() => setWeek(addDays(week, 7))} />
            <span className="strong small" aria-live="polite">
              {t('Semana del {from} al {to}', { from: formatDate(days[0]), to: formatDate(days[6]) })}
            </span>
          </div>
          <SelectField label={t('Departamento')} value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">{t('Todos')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </SelectField>
          <SelectField label={t('Centro de trabajo')} value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">{t('Todos')}</option>
            {worksites.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </SelectField>
          <Checkbox label={t('Mostrar turnos cancelados')} checked={showCancelled} onChange={setShowCancelled} />
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('No hay personas para planificar con estos filtros')}>
            {canPlan ? t('Solo aparecen las personas activas que usted puede planificar (su equipo y usted, o toda la plantilla para RR. HH.).') : t('Solo aparecen las personas activas de su ámbito de consulta.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table plan-grid">
              <caption className="sr-only">{t('Turnos planificados de la semana del {from} al {to}. Son previsiones, no tiempo trabajado.', { from: formatDate(days[0]), to: formatDate(days[6]) })}</caption>
              <thead>
                <tr>
                  <th scope="col" className="plan-person">{t('Persona')}</th>
                  {days.map((d) => {
                    const names = data.headerHolidays.get(d);
                    return (
                      <th key={d} scope="col" className={`plan-day ${d === ctx.today ? 'is-today' : ''}`} title={formatDateLong(d)}>
                        <span className="nowrap">{formatDayShort(d)}</span>
                        {d === ctx.today && <span className="plan-today-dot"><span className="sr-only">{t('(hoy)')}</span></span>}
                        {names && (
                          <span className="plan-head-holiday" title={names.join(' · ')}>
                            <CalendarOff size={11} aria-hidden /> {t('Festivo')}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const rel = relationshipOn(ctx.db, e.id, days[0]) ?? relationshipOn(ctx.db, e.id, ctx.today);
                  const editable = canPlan && canManageShiftsFor(ctx, e.id);
                  return (
                    <tr key={e.id}>
                      <th scope="row" className="plan-person">
                        <EmployeeLink id={e.id} />
                        <div className="tiny muted">{e.jobTitle}</div>
                        <div className="tiny">
                          <span className="muted">{t('Planificado en la semana')}: </span>
                          <DurationText minutes={data.plannedMinutes.get(e.id) ?? 0} />
                        </div>
                        {canSeeTerms && rel && <div className="tiny muted">{t('Contrato: {h} h/semana', { h: rel.weeklyHours })}</div>}
                      </th>
                      {days.map((d) => (
                        <PlannerCell
                          key={d}
                          employee={e}
                          date={d}
                          isToday={d === ctx.today}
                          shifts={data.shiftsByCell.get(`${e.id}|${d}`) ?? []}
                          absences={data.absencesByCell.get(`${e.id}|${d}`) ?? []}
                          holiday={holidayOf(e.primaryWorksiteId, d)}
                          holidayOf={holidayOf}
                          overlaps={data.overlaps}
                          editable={editable}
                          onAdd={() => openNew(e, d)}
                          onEdit={(s) => setEditor({ input: inputFromShift(s), shift: s })}
                        />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer stack-sm">
          <div className="legend" aria-label={t('Leyenda')}>
            <span><span className="plan-tag">{t('PLAN')}</span> {t('Turno planificado (previsión, no tiempo trabajado)')}</span>
            <span><CalendarOff size={12} aria-hidden /> {t('Festivo del calendario del centro')}</span>
            <span><Plane size={12} aria-hidden /> {t('Ausencia aprobada')}</span>
            <span><AlertTriangle size={12} aria-hidden /> {t('Aviso para revisar (solapamiento, festivo o ausencia)')}</span>
          </div>
          <div className="tiny muted">
            {t('Las horas se muestran en la hora local del centro; «+1» indica que el turno termina al día siguiente.')}{' '}
            {canSeeCalendar && <Link to={`/calendario?fecha=${days[0]}&vista=semana`}>{t('Comparar con lo registrado en el calendario')}</Link>}
          </div>
        </div>
      </Card>

      {editor && <ShiftModal initial={editor.input} shift={editor.shift} people={people} onClose={() => setEditor(null)} />}
      {copying && <CopyWeekModal rows={rows} week={week} onClose={() => setCopying(false)} />}
    </div>
  );
}

function PlannerCell({
  employee,
  date,
  isToday,
  shifts,
  absences,
  holiday,
  holidayOf,
  overlaps,
  editable,
  onAdd,
  onEdit,
}: {
  employee: Employee;
  date: ISODate;
  isToday: boolean;
  shifts: PlannedShift[];
  absences: AbsenceRequest[];
  holiday: Holiday | undefined;
  holidayOf: HolidayLookup;
  overlaps: Set<ID>;
  editable: boolean;
  onAdd: () => void;
  onEdit: (s: PlannedShift) => void;
}) {
  const ctx = useCtx();
  const name = fullName(employee);
  return (
    <td className={`plan-cell ${isToday ? 'is-today' : ''} ${holiday ? 'is-holiday' : ''}`}>
      <div className="plan-cell-body">
        {holiday && (
          <span className="plan-holiday" title={t('Festivo del calendario del centro')}>
            <CalendarOff size={12} aria-hidden /> {holiday.name}
          </span>
        )}
        {absences.map((a) => (
          <Link key={a.id} to={`/ausencias/${a.id}`} className="plan-absence" title={t('Ausencia aprobada. No crea asistencia ni tiempo trabajado.')}>
            <Plane size={12} aria-hidden /> {t(absenceTypeLabel(ctx, a))}
            {a.partial && <span className="num"> {a.partial.startTime}–{a.partial.endTime}</span>}
          </Link>
        ))}
        {shifts.map((s) => (
          <ShiftChip
            key={s.id}
            shift={s}
            name={name}
            overlap={overlaps.has(s.id)}
            onHoliday={!!holidayOf(s.worksiteId, s.date)}
            withAbsence={absences.some((a) => !a.partial)}
            onEdit={editable && s.status === 'planned' ? () => onEdit(s) : undefined}
          />
        ))}
        {editable && (
          <button type="button" className="plan-add" aria-label={t('Añadir turno: {name}, {date}', { name, date: formatDate(date) })} onClick={onAdd}>
            <Plus size={14} aria-hidden />
          </button>
        )}
      </div>
    </td>
  );
}

function ShiftChip({ shift, name, overlap, onHoliday, withAbsence, onEdit }: { shift: PlannedShift; name: string; overlap: boolean; onHoliday: boolean; withAbsence: boolean; onEdit?: () => void }) {
  const ctx = useCtx();
  const ws = worksiteById(ctx.db, shift.worksiteId);
  const cancelled = shift.status === 'cancelled';
  const warn = !cancelled && (overlap || onHoliday || withAbsence);
  const body = (
    <>
      <span className="row" style={{ gap: 4 }}>
        <span className="plan-tag">{t('PLAN')}</span>
        <span className="plan-time">
          <TimeText at={shift.start} tz={shift.timezone} baseDate={shift.date} />–<TimeText at={shift.end} tz={shift.timezone} baseDate={shift.date} />
        </span>
      </span>
      <span className="tiny muted plan-site" title={ws?.name}>{ws ? shortSiteName(ws.name) : '—'}</span>
      {cancelled && <span className="tiny">{t('Cancelado')}</span>}
      {warn && (
        <span className="plan-warn">
          <AlertTriangle size={11} aria-hidden /> {overlap ? t('Solapamiento') : onHoliday ? t('En festivo') : t('Con ausencia')}
        </span>
      )}
    </>
  );
  const cls = `plan-shift ${cancelled ? 'is-cancelled' : ''} ${warn ? 'is-warn' : ''}`;
  if (onEdit) {
    return (
      <button type="button" className={cls} onClick={onEdit} aria-label={t('Editar turno planificado: {name}, {date}', { name, date: formatDate(shift.date) })}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

// ─────────────────────────────── Add / edit / cancel ───────────────────────────────

function ShiftModal({ initial, shift, people, onClose }: { initial: ShiftInput; shift: PlannedShift | null; people: Employee[]; onClose: () => void }) {
  const ctx = useCtx();
  const { run, runOk, pending } = useAction();
  const [f, setF] = useState<ShiftInput>(initial);
  const [cancelOpen, setCancelOpen] = useState(false);
  const check = useMemo(() => checkShift(ctx, f, shift?.id ?? null), [ctx, f, shift]);
  const emp = ctx.db.employees.find((e) => e.id === f.employeeId);
  const options = emp && !people.some((p) => p.id === emp.id) ? [emp, ...people] : people;
  const sites = (emp?.worksiteIds ?? []).map((id) => worksiteById(ctx.db, id)).filter((w): w is Worksite => !!w);
  const overnight = HHMM.test(f.startTime) && HHMM.test(f.endTime) && f.endTime <= f.startTime;
  const minutes = check.start && check.end ? minutesBetween(check.start, check.end) : null;
  const set = (patch: Partial<ShiftInput>) => setF((x) => ({ ...x, ...patch }));

  const save = async () => {
    const r = await run(() => saveShift(f, shift?.id ?? null), shift ? t('Turno modificado. Sigue siendo una planificación: no genera tiempo trabajado.') : t('Turno planificado. No genera tiempo trabajado.'));
    if (r) onClose();
  };

  return (
    <>
      <Modal
        title={shift ? t('Editar turno planificado') : t('Añadir turno planificado')}
        description={t('Un turno planificado nunca genera tiempo trabajado; el registro real lo hace la persona trabajadora.')}
        onClose={onClose}
        footer={
          <>
            {shift && (
              <Button variant="danger-outline" onClick={() => setCancelOpen(true)} className="plan-footer-left">
                {t('Cancelar turno')}
              </Button>
            )}
            <Button onClick={onClose}>{t('Cerrar')}</Button>
            <Button variant="primary" onClick={save} loading={pending} disabled={check.errors.length > 0}>
              {shift ? t('Guardar cambios') : t('Planificar turno')}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <SelectField
            label={t('Persona')}
            required
            value={f.employeeId}
            disabled={!!shift}
            className="span-all"
            onChange={(e) => {
              const next = ctx.db.employees.find((x) => x.id === e.target.value);
              set({ employeeId: e.target.value, worksiteId: next?.primaryWorksiteId ?? '' });
            }}
          >
            {options.map((p) => (
              <option key={p.id} value={p.id}>{fullName(p)}</option>
            ))}
          </SelectField>
          <TextField label={t('Fecha')} required type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
          <SelectField label={t('Centro de trabajo')} required value={f.worksiteId} onChange={(e) => set({ worksiteId: e.target.value })} hint={t('Solo los centros asignados a la persona.')}>
            {sites.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </SelectField>
          <TextField label={t('Hora de inicio')} required type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />
          <TextField
            label={t('Hora de fin')}
            required
            type="time"
            value={f.endTime}
            onChange={(e) => set({ endTime: e.target.value })}
            hint={overnight ? t('Termina al día siguiente (+1).') : t('Si es igual o anterior a la de inicio, el turno termina al día siguiente.')}
          />
          <TextAreaField label={t('Nota')} className="span-all" rows={2} value={f.note} onChange={(e) => set({ note: e.target.value })} hint={t('Opcional. Visible para quien planifica y en la auditoría.')} />
        </div>

        <div className="stack-sm" style={{ marginTop: 12 }}>
          {minutes !== null && check.start && check.end && (
            <div className="small">
              {t('Duración planificada')}: <strong><DurationText minutes={minutes} /></strong>
              <span className="muted">
                {' · '}
                <TimeText at={check.start} tz={ctx.company.timezone} baseDate={f.date} />–<TimeText at={check.end} tz={ctx.company.timezone} baseDate={f.date} />
              </span>
            </div>
          )}
          {check.errors.length > 0 && (
            <Callout tone="danger" title={t('No se puede guardar')}>
              <ul>
                {check.errors.map((m) => (
                  <li key={m}>{t(m)}</li>
                ))}
              </ul>
            </Callout>
          )}
          {check.warnings.length > 0 && (
            <Callout tone="warning" title={t('Avisos para revisar (no bloquean)')}>
              <ul>
                {check.warnings.map((m) => (
                  <li key={m}>{t(m)}</li>
                ))}
              </ul>
            </Callout>
          )}
          <p className="tiny muted">{t('Planificar no crea fichajes ni horas trabajadas, no aprueba ausencias y no decide el tratamiento en nómina.')}</p>
        </div>
      </Modal>
      {cancelOpen && shift && (
        <ConfirmDialog
          title={t('Cancelar turno planificado')}
          message={t('El turno queda cancelado y consta en la auditoría. Los registros de trabajo de la persona no se modifican.')}
          confirmLabel={t('Cancelar turno')}
          danger
          requireReason
          reasonLabel={t('Motivo de la cancelación')}
          onClose={() => setCancelOpen(false)}
          onConfirm={async (reason) => {
            const ok = await runOk(() => cancelShift(shift.id, reason), t('Turno cancelado. Los registros de trabajo no se modifican.'));
            if (ok) onClose();
            return ok;
          }}
        />
      )}
    </>
  );
}

// ─────────────────────────────── Copy previous week ───────────────────────────────

interface CopyItem {
  input: ShiftInput;
  skip: Msg | null;
  notes: string[];
}

interface CopyResult {
  item: CopyItem;
  error: string | null;
}

/** Works out, before anything is written, which shifts of the previous week can be copied. */
function planCopy(ctx: UiCtx, rows: Employee[], week: ISODate): CopyItem[] {
  const ids = new Set(rows.map((e) => e.id));
  const from = addDays(week, -7);
  const to = addDays(week, -1);
  const holidayOf = holidayLookup(ctx);
  const source = ctx.db.shifts
    .filter((s) => s.companyId === ctx.company.id && s.status === 'planned' && ids.has(s.employeeId) && s.date >= from && s.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const accepted: { employeeId: ID; start: string; end: string }[] = [];
  return source.map((s) => {
    const input: ShiftInput = { ...inputFromShift(s), date: addDays(s.date, 7) };
    const item: CopyItem = { input, skip: null, notes: [] };
    if (!canManageShiftsFor(ctx, s.employeeId)) {
      item.skip = { text: tKey('Sin permiso para planificar a esta persona.') };
      return item;
    }
    const chk = checkShift(ctx, input, null);
    if (chk.errors.length || !chk.start || !chk.end) {
      item.skip = { text: chk.errors[0] ?? tKey('El turno no es válido') };
      return item;
    }
    const start = chk.start;
    const end = chk.end;
    const existing = ctx.db.shifts.filter((x) => x.employeeId === s.employeeId && x.status === 'planned');
    const holiday = holidayOf(input.worksiteId, input.date);
    const absent = ctx.db.absences.some((a) => a.companyId === ctx.company.id && a.employeeId === s.employeeId && (a.status === 'approved' || a.status === 'cancel_requested') && !a.partial && input.date >= a.startDate && input.date <= a.endDate);
    if (existing.some((x) => x.start === start && x.end === end)) item.skip = { text: tKey('Ya existe el mismo turno en la semana actual.') };
    else if (existing.some((x) => x.start < end && start < x.end) || accepted.some((x) => x.employeeId === s.employeeId && x.start < end && start < x.end)) item.skip = { text: tKey('Se solapa con un turno ya planificado.') };
    else if (holiday) item.skip = { text: tKey('Festivo en el calendario del centro: {name}.'), params: { name: holiday.name } };
    else if (absent) item.skip = { text: tKey('La persona tiene una ausencia aprobada ese día.') };
    else {
      accepted.push({ employeeId: s.employeeId, start, end });
      item.notes = chk.warnings;
    }
    return item;
  });
}

function CopyWeekModal({ rows, week, onClose }: { rows: Employee[]; week: ISODate; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const [items] = useState<CopyItem[]>(() => planCopy(ctx, rows, week));
  const [phase, setPhase] = useState<'preview' | 'running' | 'done'>('preview');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<CopyResult[]>([]);
  const todo = items.filter((i) => !i.skip);
  const skipped = items.filter((i) => i.skip);
  const created = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  const execute = async () => {
    setPhase('running');
    const out: CopyResult[] = [];
    for (let i = 0; i < todo.length; i += 8) {
      const chunk = todo.slice(i, i + 8);
      const res = await Promise.all(
        chunk.map(async (item): Promise<CopyResult> => {
          try {
            await saveShift(item.input, null);
            return { item, error: null };
          } catch (e) {
            const d = describeError(e);
            return { item, error: [d.title, ...d.details].join(' ') };
          }
        }),
      );
      out.push(...res);
      setProgress(out.length);
    }
    setResults(out);
    setPhase('done');
    const ok = out.filter((r) => !r.error).length;
    if (ok > 0) toast.success(t('Copia terminada: {n} turnos planificados creados.', { n: ok }));
    if (out.some((r) => r.error)) toast.warning(t('Algunos turnos no se han creado. Revise el detalle.'));
  };

  const nameOf = (id: ID) => {
    const e = ctx.db.employees.find((x) => x.id === id);
    return e ? fullName(e) : '—';
  };
  const siteOf = (id: ID) => worksiteById(ctx.db, id)?.name ?? '—';
  const hours = (i: CopyItem) => (
    <span className="num nowrap">
      {i.input.startTime}–{i.input.endTime}
      {i.input.endTime <= i.input.startTime && <span className="tiny muted"> (+1)</span>}
    </span>
  );

  return (
    <Modal
      wide
      title={t('Copiar semana anterior')}
      description={t('Crea en la semana del {from} los mismos turnos planificados de la semana del {prev}, para las personas que se muestran con los filtros actuales.', { from: formatDate(week), prev: formatDate(addDays(week, -7)) })}
      onClose={phase === 'running' ? () => undefined : onClose}
      footer={
        phase === 'done' ? (
          <Button variant="primary" onClick={onClose}>{t('Cerrar')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={phase === 'running'}>{t('Cancelar')}</Button>
            <Button variant="primary" icon={Copy} onClick={execute} loading={phase === 'running'} disabled={todo.length === 0}>
              {t('Crear {n} turnos', { n: todo.length })}
            </Button>
          </>
        )
      }
    >
      <div className="stack">
        <Callout tone="info">
          {t('Solo se crean turnos planificados. No se crea, modifica ni borra ningún registro de tiempo trabajado. Se omiten los turnos que ya existen, los que se solapan, los que caen en festivo o en una ausencia aprobada y los que no superan la validación.')}
        </Callout>
        {phase === 'running' && (
          <p className="small" role="status">{t('Creando turnos: {done} de {total}…', { done: progress, total: todo.length })}</p>
        )}
        {phase === 'done' ? (
          <>
            <div className="kpis plan-copy-kpis">
              <div className="kpi"><span className="label">{t('Creados')}</span><span className="value">{created.length}</span></div>
              <div className="kpi"><span className="label">{t('Omitidos')}</span><span className="value">{skipped.length + failed.length}</span></div>
            </div>
            {skipped.length + failed.length > 0 ? (
              <div className="table-wrap plan-copy-list">
                <table className="table">
                  <caption className="sr-only">{t('Turnos omitidos y motivo')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('Persona')}</th>
                      <th scope="col">{t('Fecha')}</th>
                      <th scope="col">{t('Horario planificado')}</th>
                      <th scope="col">{t('Motivo')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...skipped.map((i) => ({ i, reason: msg(i.skip!) })), ...failed.map((r) => ({ i: r.item, reason: r.error! }))].map(({ i, reason }, n) => (
                      <tr key={n}>
                        <td>{nameOf(i.input.employeeId)}</td>
                        <td><span className="nowrap">{formatDate(i.input.date)}</span></td>
                        <td>{hours(i)}</td>
                        <td>{reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small muted">{t('No se ha omitido ningún turno.')}</p>
            )}
          </>
        ) : items.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('La semana anterior no tiene turnos planificados')}>
            {t('No hay nada que copiar para las personas mostradas.')}
          </EmptyState>
        ) : (
          <div className="table-wrap plan-copy-list">
            <table className="table">
              <caption className="sr-only">{t('Vista previa de la copia')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('Persona')}</th>
                  <th scope="col">{t('Fecha')}</th>
                  <th scope="col">{t('Horario planificado')}</th>
                  <th scope="col">{t('Centro de trabajo')}</th>
                  <th scope="col">{t('Resultado')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n}>
                    <td>{nameOf(i.input.employeeId)}</td>
                    <td><span className="nowrap">{formatDate(i.input.date)}</span></td>
                    <td>{hours(i)}</td>
                    <td className="small">{siteOf(i.input.worksiteId)}</td>
                    <td>
                      {i.skip ? (
                        <span className="stack-sm" style={{ gap: 2 }}>
                          <Badge tone="neutral">{t('Se omite')}</Badge>
                          <span className="tiny">{msg(i.skip)}</span>
                        </span>
                      ) : (
                        <span className="stack-sm" style={{ gap: 2 }}>
                          <Badge tone="info">{t('Se creará')}</Badge>
                          {i.notes.map((m) => (
                            <span key={m} className="tiny muted">{t(m)}</span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
