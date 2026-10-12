/**
 * Mi jornada (TIM-02): the employee's clocking workspace.
 *
 * Every action goes through `clock()` with ONE idempotency key per user intent, so a double
 * click never produces a second event. Success (with the durable receipt) is shown only after
 * the service has persisted the event; a simulated connectivity failure shows «No registrado»
 * and the documented fallback instead. Planned shifts are shown apart and never count as work.
 */
import { AlertTriangle, CalendarClock, Clock3, Coffee, History, LogIn, LogOut, Play, UserX, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DurationText, RecordStatusBadge, TimeText } from '../components/bits';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, useAction } from '../components/ui';
import { index } from '../domain/indexes';
import { effectiveValues, hasPendingCorrection, relationshipOn, sessionDurations } from '../domain/records';
import { BREAK_KIND_LABEL, EVENT_TYPE_LABEL, MODE_LABEL, SOURCE_LABEL, type Tone } from '../domain/status';
import { addDays, formatDate, formatDateLong, formatOffset, localDate, nowInstant, wallTime } from '../domain/time';
import type { AttendanceEvent, BreakKind, EventType, ID, WorkMode, WorkSession } from '../domain/types';
import { t, tKey } from '../i18n';
import { failedAttemptsFor, myStatus, NotRecordedError, type ClockResult, type MyStatus } from '../services/timeService';
import { clock } from '../services/timeService';
import { useCtx } from '../store/hooks';

const STATE_META: Record<MyStatus['state'], { label: string; tone: Tone; help: string }> = {
  not_started: { label: tKey('Sin iniciar'), tone: 'neutral', help: tKey('No hay ninguna jornada abierta. Registre la entrada al empezar a trabajar.') },
  working: { label: tKey('Trabajando'), tone: 'info', help: tKey('Jornada abierta. Puede iniciar una pausa o registrar la salida.') },
  on_break: { label: tKey('En pausa'), tone: 'accent', help: tKey('Pausa en curso. Finalice la pausa antes de registrar la salida.') },
  complete: { label: tKey('Jornada completada'), tone: 'success', help: tKey('Hoy ya hay una jornada con entrada y salida. Si vuelve a trabajar (jornada partida), registre una nueva entrada.') },
  incomplete: { label: tKey('Incompleto'), tone: 'danger', help: tKey('Falta la hora de salida. No se completa automáticamente: requiere una corrección revisada.') },
};

const ACTION_LABEL: Record<EventType, string> = {
  clock_in: tKey('Registrar entrada'),
  break_start: tKey('Iniciar pausa'),
  break_end: tKey('Finalizar pausa'),
  clock_out: tKey('Registrar salida'),
};

/** One fresh key per user intent (the backend would receive it as the Idempotency-Key header). */
function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `idk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Current instant, refreshed every `ms` milliseconds. */
function useNow(ms: number): string {
  const [now, setNow] = useState(() => nowInstant());
  useEffect(() => {
    const id = setInterval(() => setNow(nowInstant()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Live wall clock of the workplace zone (seconds precision, so it is composed from the zone's wall time). */
function LiveClock({ tz }: { tz: string }) {
  const now = useNow(1000);
  const w = wallTime(now, tz);
  const hms = [w.h, w.mi, w.s].map((x) => String(x).padStart(2, '0')).join(':');
  return (
    <div className="myday-clock" role="timer" aria-label={t('Hora actual del centro de trabajo')}>
      <time dateTime={now} className="myday-clock-time num">
        {hms}
      </time>
      <div className="myday-clock-date">{formatDateLong(localDate(now, tz))}</div>
      <div className="tiny muted">
        {tz} · {formatOffset(now, tz)}
      </div>
    </div>
  );
}

function eventLabel(e: AttendanceEvent): string {
  const base = t(EVENT_TYPE_LABEL[e.type]);
  return e.breakKind ? `${base} · ${t(BREAK_KIND_LABEL[e.breakKind])}` : base;
}

export function MyDayPage() {
  const ctx = useCtx();
  const emp = ctx.employee;
  const tz = ctx.company.timezone;
  const tick = useNow(30_000);
  const { run, pending } = useAction();

  const keyRef = useRef<string>(newIdempotencyKey());
  const inFlight = useRef(false);
  const [lastResult, setLastResult] = useState<ClockResult | null>(null);
  const [failure, setFailure] = useState<{ id: ID; action: EventType; at: string } | null>(null);
  const [worksiteChoice, setWorksiteChoice] = useState<ID | null>(null);
  const [modeChoice, setModeChoice] = useState<WorkMode>('onsite');
  const [breakKind, setBreakKind] = useState<BreakKind>('rest');

  const status = useMemo(() => myStatus(ctx), [ctx, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!emp) {
    return (
      <>
        <PageHeader title={t('Mi jornada')} />
        <Card>
          <EmptyState icon={UserX} title={t('Fichar requiere una ficha de empleado')}>
            {t('Su usuario no tiene una ficha de empleado en {company}. Solo las personas con ficha de empleado activa pueden registrar su jornada; RR. HH. puede vincular su usuario a una ficha.', { company: ctx.company.tradeName })}
          </EmptyState>
        </Card>
      </>
    );
  }

  const db = ctx.db;
  const worksiteName = (id: ID | null | undefined) => db.worksites.find((w) => w.id === id)?.name ?? '—';
  const rel = relationshipOn(db, emp.id, ctx.today);
  const remoteAllowed = !!rel?.remoteAllowed;
  const open = status.state === 'working' || status.state === 'on_break' ? status.session : null;
  const worksiteId = open ? open.worksiteId : worksiteChoice && emp.worksiteIds.includes(worksiteChoice) ? worksiteChoice : emp.worksiteIds.includes(emp.primaryWorksiteId) ? emp.primaryWorksiteId : emp.worksiteIds[0];
  const mode: WorkMode = open ? open.mode : modeChoice === 'remote' && remoteAllowed ? 'remote' : 'onsite';
  const active = emp.status === 'active';
  // The break being ended keeps its own kind (the service would otherwise default it to «descanso»).
  const openBreakKind = open ? effectiveValues(db, open).breaks.find((b) => !b.end)?.kind : undefined;
  const protocol = db.protocols.filter((p) => p.companyId === ctx.company.id && p.status === 'active').sort((a, b) => b.version - a.version)[0];

  const enabled: Record<EventType, boolean> = {
    clock_in: status.state === 'not_started' || status.state === 'complete',
    break_start: status.state === 'working',
    break_end: status.state === 'on_break',
    clock_out: status.state === 'working',
  };

  const doClock = async (action: EventType) => {
    if (inFlight.current || !worksiteId) return;
    inFlight.current = true;
    setLastResult(null);
    setFailure(null);
    const idempotencyKey = keyRef.current;
    try {
      const r = await run(
        async () => {
          try {
            return await clock({ action, worksiteId, mode, breakKind: action === 'break_start' ? breakKind : action === 'break_end' ? openBreakKind : undefined, idempotencyKey });
          } catch (e) {
            if (e instanceof NotRecordedError) {
              setFailure({ id: e.failedAttemptId, action, at: nowInstant() });
              return null;
            }
            throw e;
          }
        },
        (res) => (res ? t('Fichaje registrado · recibo {receipt}', { receipt: res.receipt }) : null),
      );
      if (r) setLastResult(r);
    } finally {
      // The intent is complete (recorded, refused or not recorded): the next click is a new intent.
      keyRef.current = newIdempotencyKey();
      inFlight.current = false;
    }
  };

  // ─── Today ───
  const mine = index(db).sessionsByEmployee.get(emp.id) ?? [];
  const todaySessions = mine.filter((s) => s.date === ctx.today || (open && s.id === open.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const todayEvents = todaySessions.flatMap((s) => (index(db).eventsBySession.get(s.id) ?? []).map((e) => ({ e, s }))).sort((a, b) => a.e.at.localeCompare(b.e.at));
  const todayDur = todaySessions.map((s) => sessionDurations(db, s, tick));
  const sum = (f: (d: (typeof todayDur)[number]) => number | null) => todayDur.reduce((acc, d) => acc + (f(d) ?? 0), 0);
  const provisional = todayDur.some((d) => d.provisional);
  const planned = db.shifts.filter((s) => s.companyId === ctx.company.id && s.employeeId === emp.id && s.date === ctx.today && s.status === 'planned').sort((a, b) => a.start.localeCompare(b.start));

  // ─── History & follow-up ───
  const historyFrom = addDays(ctx.today, -14);
  const history = mine.filter((s) => s.date >= historyFrom && s.date < ctx.today).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const historyDays = Array.from(new Set(history.map((s) => s.date)));
  const failed = failedAttemptsFor(ctx, emp.id).filter((f) => !f.correctionId);
  const myPending = db.corrections.filter((c) => c.companyId === ctx.company.id && c.employeeId === emp.id && (c.status === 'pending' || c.status === 'pending_employee'));
  const stale = status.staleSession;
  const stalePending = stale ? hasPendingCorrection(db, stale.id) : false;
  const meta = STATE_META[status.state];

  const actionButton = (action: EventType, icon: typeof LogIn, variant: 'primary' | 'secondary' | 'accent' | 'danger', extra?: ReactNode) => (
    <div className="myday-action">
      <Button variant={variant} icon={icon} className="myday-btn" disabled={!enabled[action] || pending || !active} loading={pending && enabled[action]} onClick={() => doClock(action)} aria-describedby="myday-state-help">
        {action === 'clock_in' && status.state === 'complete' ? t('Registrar nueva entrada') : t(ACTION_LABEL[action])}
      </Button>
      {extra}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('Mi jornada')}
        subtitle={t('Registre su entrada, pausas y salida. Cada fichaje se guarda con un recibo; si no se puede guardar, se lo indicamos como «No registrado».')}
        actions={
          <>
            <Link to="/registros" className="btn">
              <History size={15} aria-hidden /> {t('Todos mis registros')}
            </Link>
            <Link to="/correcciones" className="btn">
              {t('Mis correcciones')}
              {myPending.length > 0 && <span className="badge tone-warning">{myPending.length}</span>}
            </Link>
          </>
        }
      />

      <div className="stack-lg">
        {stale && (
          <Callout tone="danger" title={t('Jornada anterior incompleta')}>
            <div className="stack-sm">
              <span>{t('La jornada del {date} tiene entrada pero no tiene salida. No se completa automáticamente: indique la hora real de salida mediante una solicitud de corrección.', { date: formatDate(stale.date) })}</span>
              <span className="row-wrap">
                <Badge tone="danger">{t('Incompleto')}</Badge>
                <span className="tiny muted">
                  {t('Entrada')}: <TimeText at={effectiveValues(db, stale).start} tz={stale.timezone} />
                </span>
                <Link to={`/registros/${stale.id}`}>{t('Ver el registro')}</Link>
                {stalePending ? (
                  <Link to="/correcciones" className="btn sm">{t('Corrección pendiente de revisión')}</Link>
                ) : (
                  <Link to={`/correcciones?nueva=1&sesion=${stale.id}`} className="btn sm primary">{t('Solicitar corrección')}</Link>
                )}
              </span>
            </div>
          </Callout>
        )}

        <div className="grid-main-side">
          <Card title={t('Fichar')} actions={<Badge tone={meta.tone} title={t(meta.help)}>{t(meta.label)}</Badge>}>
            <div className="stack">
              <div className="myday-head">
                <LiveClock tz={tz} />
                <div className="myday-state" aria-live="polite">
                  <div className="tiny muted">{t('Estado actual')}</div>
                  <div className={`myday-state-label tone-text-${meta.tone}`}>{t(meta.label)}</div>
                  <div id="myday-state-help" className="small muted">{t(meta.help)}</div>
                  {open && (
                    <div className="small">
                      {t('Entrada')} <TimeText at={effectiveValues(db, open).start} tz={open.timezone} /> · {worksiteName(open.worksiteId)} · {t(MODE_LABEL[open.mode])}
                    </div>
                  )}
                </div>
              </div>

              {!active && (
                <Callout tone="warning" title={t('Ficha de empleado inactiva')}>
                  {t('Su ficha no está activa en esta empresa, por lo que no puede fichar. Consulte con RR. HH.')}
                </Callout>
              )}

              <div className="myday-options">
                <div className="field">
                  <label htmlFor="myday-ws">{t('Centro de trabajo')}</label>
                  <select id="myday-ws" className="select" value={worksiteId ?? ''} disabled={!!open || pending} onChange={(e) => setWorksiteChoice(e.target.value)}>
                    {emp.worksiteIds.map((id) => (
                      <option key={id} value={id}>
                        {worksiteName(id)}
                        {id === emp.primaryWorksiteId ? ` (${t('habitual')})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="hint">{open ? t('Las pausas y la salida se registran en el centro de la jornada abierta.') : t('Solo los centros asignados a su ficha.')}</span>
                </div>
                <fieldset className="myday-mode">
                  <legend>{t('Modalidad')}</legend>
                  <div className="segmented" role="group" aria-label={t('Modalidad')}>
                    {(['onsite', 'remote'] as WorkMode[]).map((m) => (
                      <button key={m} type="button" aria-pressed={mode === m} disabled={!!open || pending || (m === 'remote' && !remoteAllowed)} onClick={() => setModeChoice(m)}>
                        {t(MODE_LABEL[m])}
                      </button>
                    ))}
                  </div>
                  <span className="hint small muted">{remoteAllowed ? t('Su relación laboral permite el trabajo a distancia.') : t('Trabajo a distancia no autorizado en su relación laboral vigente.')}</span>
                </fieldset>
              </div>

              <div className="myday-actions">
                {actionButton('clock_in', LogIn, 'primary')}
                {actionButton(
                  'break_start',
                  Coffee,
                  'secondary',
                  <div className="field">
                    <label htmlFor="myday-break">{t('Tipo de pausa')}</label>
                    <select id="myday-break" className="select" value={breakKind} disabled={!enabled.break_start || pending} onChange={(e) => setBreakKind(e.target.value as BreakKind)}>
                      {(Object.keys(BREAK_KIND_LABEL) as BreakKind[]).map((k) => (
                        <option key={k} value={k}>{t(BREAK_KIND_LABEL[k])}</option>
                      ))}
                    </select>
                  </div>,
                )}
                {actionButton('break_end', Play, 'accent')}
                {actionButton('clock_out', LogOut, 'danger')}
              </div>
              <p className="tiny muted">{t('Cada pulsación lleva una clave única: si pulsa dos veces, el fichaje no se duplica. Los botones se bloquean mientras se guarda.')}</p>

              {lastResult && (
                <Callout tone="success" title={t('Registrado')}>
                  <div className="stack-sm">
                    <span>
                      {eventLabel(lastResult.event)} · {t('Recibo')} <code className="strong">{lastResult.receipt}</code> · <TimeText at={lastResult.event.at} tz={lastResult.event.timezone} /> · {formatOffset(lastResult.event.at, lastResult.event.timezone)}
                    </span>
                    <span className="tiny muted">
                      {worksiteName(lastResult.event.worksiteId)} · {t(MODE_LABEL[lastResult.event.mode])} · {t('Guardado en el servidor (simulado) antes de mostrar este recibo.')}
                    </span>
                    {lastResult.duplicate && <span className="tiny">{t('Esta acción ya se había registrado con la misma clave: no se ha creado un evento duplicado.')}</span>}
                    <Link to={`/registros/${lastResult.session.id}`} className="small">{t('Ver el registro')}</Link>
                  </div>
                </Callout>
              )}

              {failure && (
                <div className="myday-failure" role="alert">
                  <div className="row" style={{ gap: 10 }}>
                    <WifiOff size={22} aria-hidden />
                    <div className="grow">
                      <div className="myday-failure-title">{t('No registrado')}</div>
                      <div className="small">
                        {t('{action}: no se ha guardado nada. El fichaje no consta en su registro de jornada.', { action: t(EVENT_TYPE_LABEL[failure.action]) })}{' '}
                        {t('Hora del intento')}: <TimeText at={failure.at} tz={tz} /> ({formatOffset(failure.at, tz)}).
                      </div>
                    </div>
                  </div>
                  {protocol && (
                    <div className="small">
                      <span className="strong">{t('Procedimiento de la empresa (protocolo de registro v{v})', { v: protocol.version })}:</span> {t(protocol.connectivityFallback)}
                    </div>
                  )}
                  <div className="row-wrap">
                    <Link to={`/correcciones?nueva=1&fallo=${failure.id}`} className="btn danger">{t('Solicitar corrección')}</Link>
                    <span className="tiny">{t('Anote la hora real y solicite la corrección en cuanto pueda; la revisará una persona autorizada.')}</span>
                  </div>
                </div>
              )}

              <Callout tone="neutral" icon={AlertTriangle}>
                <span className="small">{t('Demostración: el fallo de conexión se activa en el menú de usuario, en «Controles de demostración» → «Simular fallo de conexión al fichar».')}</span>
              </Callout>
            </div>
          </Card>

          <div className="stack">
            <Card title={t('Planificado hoy')} actions={<Badge tone="neutral" icon={CalendarClock}>{t('Plan')}</Badge>}>
              {planned.length === 0 ? (
                <p className="small muted">{t('No tiene turnos planificados para hoy.')}</p>
              ) : (
                <ul className="myday-list">
                  {planned.map((p) => (
                    <li key={p.id}>
                      <span className="strong">
                        <TimeText at={p.start} tz={p.timezone} /> – <TimeText at={p.end} tz={p.timezone} baseDate={p.date} />
                      </span>{' '}
                      · {worksiteName(p.worksiteId)}
                      {p.note && <div className="tiny muted">{p.note}</div>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="tiny muted" style={{ marginTop: 8 }}>{t('Es la planificación, no tiempo trabajado: solo cuentan los fichajes registrados.')}</p>
            </Card>

            <Card title={t('Registrado hoy')}>
              <dl className="kv">
                <dt>{t('Tiempo bruto')}</dt>
                <dd><DurationText minutes={todaySessions.length ? sum((d) => d.grossMinutes) : null} provisional={provisional} /></dd>
                <dt>{t('Pausas registradas')}</dt>
                <dd><DurationText minutes={todaySessions.length ? sum((d) => d.breakMinutes) : null} provisional={provisional} /></dd>
                <dt>{t('Pausas no retribuidas')}</dt>
                <dd><DurationText minutes={todaySessions.length ? sum((d) => d.unpaidBreakMinutes) : null} provisional={provisional} /></dd>
                <dt>{t('Neto hasta ahora')}</dt>
                <dd className="strong"><DurationText minutes={todaySessions.length ? sum((d) => d.netMinutes) : null} provisional={provisional} /></dd>
              </dl>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                {provisional && <>{t('Provisional: la jornada sigue abierta.')} </>}
                {t('No se descuenta ninguna comida de forma automática: solo se restan las pausas registradas que la política trata como no retribuidas.')}
              </p>
            </Card>
          </div>
        </div>

        <Card title={t('Fichajes de hoy')} flush>
          {todayEvents.length === 0 ? (
            <EmptyState icon={Clock3} title={t('Hoy todavía no hay fichajes')}>
              {t('Cuando registre la entrada, aparecerá aquí con su recibo.')}
            </EmptyState>
          ) : (
            <ol className="timeline myday-timeline" aria-label={t('Fichajes de hoy')}>
              {todayEvents.map(({ e, s }) => (
                <li key={e.id} className={`ev-${e.type}`}>
                  <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="what">{eventLabel(e)}</span>
                    <span className="strong">
                      <TimeText at={e.at} tz={e.timezone} baseDate={s.date} />
                    </span>
                  </div>
                  <div className="tiny muted">
                    {t(SOURCE_LABEL[e.source])} · {worksiteName(e.worksiteId)} · {t('Recibo')} <code>{e.receipt}</code>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="grid-main-side">
          <Card title={t('Mi historial reciente (14 días)')} actions={<Link to="/registros" className="small">{t('Ver todos mis registros')}</Link>} flush>
            {historyDays.length === 0 ? (
              <EmptyState icon={History} title={t('Sin registros en los últimos 14 días')} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('Fecha')}</th>
                      <th>{t('Entrada')}</th>
                      <th>{t('Salida')}</th>
                      <th className="num">{t('Neto')}</th>
                      <th>{t('Estado')}</th>
                      <th><span className="sr-only">{t('Acciones')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s, i) => (
                      <HistoryRow key={s.id} s={s} firstOfDay={i === 0 || history[i - 1].date !== s.date} tick={tick} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="stack">
            <Card title={t('Fichajes «No registrado»')}>
              {failed.length === 0 ? (
                <p className="small muted">{t('No tiene intentos de fichaje sin registrar pendientes de corrección.')}</p>
              ) : (
                <ul className="myday-list">
                  {failed.map((f) => (
                    <li key={f.id} className="stack-sm">
                      <span>
                        <Badge tone="danger">{t('No registrado')}</Badge> <span className="strong">{t(EVENT_TYPE_LABEL[f.action])}</span> · {formatDate(localDate(f.attemptedAt, tz))} <TimeText at={f.attemptedAt} tz={tz} />
                      </span>
                      <span className="tiny muted">
                        {worksiteName(f.worksiteId)} · {t(f.reason)}
                      </span>
                      <Link to={`/correcciones?nueva=1&fallo=${f.id}`} className="btn sm primary" style={{ alignSelf: 'flex-start' }}>
                        {t('Solicitar corrección')}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={t('Mis correcciones pendientes')}>
              {myPending.length === 0 ? (
                <p className="small muted">{t('No tiene correcciones pendientes.')}</p>
              ) : (
                <ul className="myday-list">
                  {myPending.map((c) => (
                    <li key={c.id}>
                      <Link to={`/correcciones/${c.id}`}>{formatDate(c.date)}</Link> ·{' '}
                      {c.status === 'pending_employee' ? <Badge tone="warning">{t('Espera su conformidad')}</Badge> : <Badge tone="warning">{t('En revisión')}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function HistoryRow({ s, firstOfDay, tick }: { s: WorkSession; firstOfDay: boolean; tick: string }) {
  const ctx = useCtx();
  const v = effectiveValues(ctx.db, s);
  const d = sessionDurations(ctx.db, s, tick);
  return (
    <tr className={firstOfDay ? '' : 'myday-same-day'}>
      <td className="nowrap">{firstOfDay ? formatDate(s.date) : <span className="sr-only">{formatDate(s.date)}</span>}</td>
      <td><TimeText at={v.start} tz={s.timezone} /></td>
      <td><TimeText at={v.end} tz={s.timezone} baseDate={s.date} /></td>
      <td className="num"><DurationText minutes={v.end ? d.netMinutes : null} /></td>
      <td><RecordStatusBadge db={ctx.db} session={s} /></td>
      <td><Link to={`/registros/${s.id}`}>{t('Detalle')}</Link></td>
    </tr>
  );
}
