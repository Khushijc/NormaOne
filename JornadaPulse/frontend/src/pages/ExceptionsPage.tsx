/**
 * Incidencias (spec §13, TIM-03, R10): review requests derived from the data on every read.
 * An exception is never a finding about a person. Review steps go through `reviewAnomaly`;
 * resolving or dismissing never edits or deletes the underlying record — data problems are
 * fixed through a correction request, which then makes the exception disappear from detection.
 */
import { ExternalLink, History, Info, MessageSquare, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmployeeLink, msg } from '../components/bits';
import { ExportButton } from '../components/ExportButton';
import {
  Badge,
  Button,
  Callout,
  Card,
  DateText,
  DateTimeText,
  EmptyState,
  KV,
  Modal,
  PageHeader,
  Pagination,
  SelectField,
  SortHeader,
  Tabs,
  TextAreaField,
  sortRows,
  useAction,
  usePaged,
  useSort,
} from '../components/ui';
import { ANOMALY_LABEL, ANOMALY_STATUS_LABEL, isOpenStatus, type Anomaly } from '../domain/anomalies';
import { activeRoles, isMembershipActive } from '../domain/permissions';
import type { Tone } from '../domain/status';
import { formatDate } from '../domain/time';
import type { AnomalyStatus, AnomalyType, ID } from '../domain/types';
import { t, tKey } from '../i18n';
import { employeeName, userName } from '../services/context';
import { canManageAnomaly, reviewAnomaly, visibleAnomalies, type AnomalyAction } from '../services/opsService';
import { EMPTY_FILTERS, EXCEPTION_COLUMNS, exceptionRows, type ExceptionRow } from '../services/reportService';
import { useCtx, type UiCtx } from '../store/hooks';

type TabId = 'open' | 'closed' | 'all';

/** Export metadata stays in Spanish (the language of the record). */
const EXPORT_TITLE = 'Incidencias';
type Severity = Anomaly['severity'];

const SEVERITY_LABEL: Record<Severity, string> = {
  high: tKey('Alta [prioridad]'),
  medium: tKey('Media [prioridad]'),
  low: tKey('Baja [prioridad]'),
};
/** Review priority, not a judgement: no red "danger" tone for people. */
const SEVERITY_TONE: Record<Severity, Tone> = { high: 'warning', medium: 'info', low: 'neutral' };
const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

const STATUS_TONE: Record<AnomalyStatus, Tone> = { open: 'warning', acknowledged: 'info', investigating: 'accent', resolved: 'success', dismissed: 'neutral' };

/** Labels for review-history entries (seeded entries use past-tense action names). */
const HISTORY_LABEL: Record<string, string> = {
  assign: tKey('Asignada'),
  assigned: tKey('Asignada'),
  acknowledge: tKey('Reconocida'),
  acknowledged: tKey('Reconocida'),
  investigate: tKey('En investigación'),
  investigating: tKey('En investigación'),
  resolve: tKey('Resuelta'),
  resolved: tKey('Resuelta'),
  dismiss: tKey('Descartada'),
  dismissed: tKey('Descartada'),
  reopen: tKey('Reabierta'),
  reopened: tKey('Reabierta'),
  comment: tKey('Comentario'),
};

interface ActionDef {
  id: AnomalyAction;
  label: string;
  success: string;
  available: (a: Anomaly) => boolean;
}

const ACTIONS: ActionDef[] = [
  { id: 'assign', label: tKey('Asignar'), success: tKey('Incidencia asignada'), available: (a) => a.active && isOpenStatus(a.status) },
  { id: 'acknowledge', label: tKey('Reconocer'), success: tKey('Incidencia reconocida'), available: (a) => a.active && a.status === 'open' },
  { id: 'investigate', label: tKey('Investigar'), success: tKey('Incidencia en investigación'), available: (a) => a.active && (a.status === 'open' || a.status === 'acknowledged') },
  { id: 'resolve', label: tKey('Resolver'), success: tKey('Incidencia resuelta'), available: (a) => a.active && isOpenStatus(a.status) },
  { id: 'dismiss', label: tKey('Descartar'), success: tKey('Incidencia descartada'), available: (a) => a.active && isOpenStatus(a.status) },
  { id: 'reopen', label: tKey('Reabrir'), success: tKey('Incidencia reabierta'), available: (a) => a.active && !isOpenStatus(a.status) },
  { id: 'comment', label: tKey('Comentar'), success: tKey('Comentario añadido'), available: () => true },
];

/** Data problems: the fix is a correction of the record (never an edit by resolving the exception). */
const DATA_TYPES: AnomalyType[] = ['missing_clock_out', 'missing_clock_in', 'overlapping_sessions', 'duplicate_event', 'long_session', 'short_session', 'off_schedule', 'unplanned_session', 'short_rest', 'not_recorded'];

interface LocalFilters {
  type: AnomalyType | '';
  status: AnomalyStatus | '';
  employeeId: ID | '';
  from: string;
  to: string;
  assignee: string; // '' all · '__none' unassigned · '__me' mine · user id
  severity: Severity | '';
}

const NO_FILTERS: LocalFilters = { type: '', status: '', employeeId: '', from: '', to: '', assignee: '', severity: '' };

function inTab(a: Anomaly, tab: TabId): boolean {
  const open = a.active && isOpenStatus(a.status);
  return tab === 'all' || (tab === 'open' ? open : !open);
}

/** Link to the record the exception refers to. */
function relatedLink(ctx: UiCtx, a: Anomaly): { to: string; label: string } | null {
  switch (a.ref.kind) {
    case 'session':
      return { to: `/registros/${a.ref.id}`, label: tKey('Registro de jornada') };
    case 'correction':
      return { to: `/correcciones/${a.ref.id}`, label: tKey('Solicitud de corrección') };
    case 'absence':
      return { to: `/ausencias/${a.ref.id}`, label: tKey('Ausencia') };
    case 'shift':
      return { to: `/calendario?fecha=${a.date}&vista=dia`, label: tKey('Turno planificado') };
    case 'failed_attempt': {
      if (ctx.employee?.id === a.employeeId) return { to: `/correcciones?nueva=1&fallo=${encodeURIComponent(a.ref.id)}`, label: tKey('Solicitar corrección') };
      if (ctx.can('employees.view_all') || ctx.can('employees.view_team')) return { to: `/equipo/${a.employeeId}`, label: tKey('Ficha del empleado') };
      return { to: `/correcciones?nueva=1&fallo=${encodeURIComponent(a.ref.id)}&empleado=${a.employeeId}`, label: tKey('Intento no registrado') };
    }
    default:
      return null;
  }
}

/** The correct path to fix the data behind an exception (correction request or proposal). */
function correctionPath(ctx: UiCtx, a: Anomaly): { to: string; label: string } | null {
  const own = ctx.employee?.id === a.employeeId;
  const q = (extra: string) => `/correcciones?nueva=1${extra}${own ? '' : `&empleado=${a.employeeId}`}`;
  if (!own && !ctx.can('corrections.propose')) return null;
  const label = own ? tKey('Solicitar corrección') : tKey('Proponer corrección');
  if (a.ref.kind === 'session') return { to: q(`&sesion=${encodeURIComponent(a.ref.id)}`), label };
  if (a.ref.kind === 'failed_attempt') return { to: q(`&fallo=${encodeURIComponent(a.ref.id)}`), label };
  if (a.ref.kind === 'shift') return { to: q(''), label };
  return null;
}

function eligibleAssignees(ctx: UiCtx): { id: ID; name: string; roles: string }[] {
  return ctx.db.memberships
    .filter((m) => m.companyId === ctx.company.id && m.status === 'active' && isMembershipActive(m, ctx.today))
    .filter((m) => {
      const roles = activeRoles(m, ctx.today);
      return roles.includes('hr_admin') || roles.includes('supervisor');
    })
    .map((m) => ({ id: m.userId, name: userName(ctx.db, m.userId), roles: m.roles.includes('hr_admin') ? tKey('RR. HH.') : tKey('Supervisión') }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function lastUpdate(a: Anomaly): string | null {
  return a.review?.updatedAt ?? null;
}

export function ExceptionsPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const all = useMemo(() => visibleAnomalies(ctx), [ctx]);
  const [tab, setTab] = useState<TabId>('open');
  const tipo = params.get('tipo');
  const [f, setF] = useState<LocalFilters>(() => ({
    ...NO_FILTERS,
    type: tipo && tipo in ANOMALY_LABEL ? (tipo as AnomalyType) : '',
    from: params.get('desde') ?? '',
    to: params.get('hasta') ?? '',
    employeeId: params.get('empleado') ?? '',
  }));
  useEffect(() => {
    if (tipo && tipo in ANOMALY_LABEL) setF((x) => ({ ...x, type: tipo as AnomalyType }));
  }, [tipo]);
  const openKey = params.get('clave');
  const selected = openKey ? all.find((a) => a.key === openKey) ?? null : null;
  const closeDetail = () => {
    const next = new URLSearchParams(params);
    next.delete('clave');
    setParams(next, { replace: true });
  };
  const openDetail = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('clave', key);
    setParams(next);
  };

  const set = (patch: Partial<LocalFilters>) => setF((x) => ({ ...x, ...patch }));
  const filtered = useMemo(
    () =>
      all.filter(
        (a) =>
          (!f.type || a.type === f.type) &&
          (!f.status || a.status === f.status) &&
          (!f.employeeId || a.employeeId === f.employeeId) &&
          (!f.from || a.date >= f.from) &&
          (!f.to || a.date <= f.to) &&
          (!f.severity || a.severity === f.severity) &&
          (!f.assignee || (f.assignee === '__none' ? !a.assigneeId : f.assignee === '__me' ? a.assigneeId === ctx.user.id : a.assigneeId === f.assignee)),
      ),
    [all, f, ctx.user.id],
  );
  const counts = useMemo(() => ({ open: filtered.filter((a) => inTab(a, 'open')).length, closed: filtered.filter((a) => inTab(a, 'closed')).length, all: filtered.length }), [filtered]);
  const { sort, onSort } = useSort('date', 'desc');
  const rows = useMemo(
    () =>
      sortRows(
        filtered.filter((a) => inTab(a, tab)),
        sort,
        (a, col) =>
          col === 'date' ? a.date
          : col === 'employee' ? employeeName(ctx.db, a.employeeId)
          : col === 'type' ? t(ANOMALY_LABEL[a.type])
          : col === 'severity' ? SEVERITY_RANK[a.severity]
          : col === 'status' ? t(ANOMALY_STATUS_LABEL[a.status])
          : col === 'assignee' ? (a.assigneeId ? userName(ctx.db, a.assigneeId) : null)
          : col === 'updated' ? lastUpdate(a)
          : null,
      ),
    [filtered, tab, sort, ctx.db],
  );
  const paged = usePaged(rows, 25);

  // Export exactly the rows on screen (same order), using the shared export columns.
  const exportRows = useMemo(() => {
    const byKey = new Map(exceptionRows(ctx, EMPTY_FILTERS, false).map((r) => [r.key, r]));
    return rows.map((a) => byKey.get(a.key)).filter((r): r is ExceptionRow => !!r);
  }, [ctx, rows]);
  const filterText = describeLocal(ctx, f, tab);

  const employees = useMemo(() => {
    const ids = new Set(all.map((a) => a.employeeId));
    return [...ids].map((id) => ({ id, name: employeeName(ctx.db, id) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [all, ctx.db]);
  const assignees = useMemo(() => eligibleAssignees(ctx), [ctx]);
  const types = useMemo(() => [...new Set(all.map((a) => a.type))].sort((a, b) => t(ANOMALY_LABEL[a]).localeCompare(t(ANOMALY_LABEL[b]))), [all]);
  const anyFilter = Object.values(f).some(Boolean);
  const scopeTeam = !ctx.can('anomalies.view_all');
  const readOnly = !ctx.can('anomalies.manage_all') && !ctx.can('anomalies.manage_team');

  return (
    <>
      <PageHeader
        title={t('Incidencias')}
        subtitle={scopeTeam ? t('Solicitudes de revisión detectadas en los registros de su equipo directo.') : t('Solicitudes de revisión detectadas automáticamente en los registros de la empresa.')}
        actions={ctx.can('reports.export') ? <ExportButton kind="incidencias" title={EXPORT_TITLE} rows={exportRows} columns={EXCEPTION_COLUMNS} filters={filterText} /> : undefined}
      />
      <div className="stack">
        <Callout tone="info" icon={Info} title={t('Una incidencia es una solicitud de revisión, no una conclusión sobre el comportamiento de ninguna persona.')}>
          {t('Se detectan a partir de los datos en cada lectura. Resolver o descartar una incidencia nunca modifica ni elimina el registro original: los datos solo cambian mediante una corrección revisada.')}
          {readOnly && <div className="small" style={{ marginTop: 4 }}>{t('Su rol permite consultar las incidencias, no gestionarlas.')}</div>}
        </Callout>
        {openKey && !selected && (
          <Callout tone="warning" title={t('Incidencia no disponible')}>
            {t('La incidencia indicada no existe o está fuera de su ámbito.')}{' '}
            <button type="button" className="btn ghost sm" onClick={closeDetail}>{t('Cerrar aviso')}</button>
          </Callout>
        )}
        <Card flush>
          <div className="control-tabs">
            <Tabs<TabId>
              label={t('Estado de las incidencias')}
              value={tab}
              onChange={(v) => {
                setTab(v);
                paged.reset();
              }}
              tabs={[
                { id: 'open', label: t('Abiertas'), count: counts.open },
                { id: 'closed', label: t('Resueltas y descartadas'), count: counts.closed },
                { id: 'all', label: t('Todas'), count: counts.all },
              ]}
            />
          </div>
          <div className="toolbar control-filters" role="search" aria-label={t('Filtros')}>
            <div className="field">
              <label htmlFor="ex-type">{t('Tipo')}</label>
              <select id="ex-type" className="select" value={f.type} onChange={(e) => set({ type: e.target.value as AnomalyType | '' })}>
                <option value="">{t('Todos')}</option>
                {types.map((ty) => <option key={ty} value={ty}>{t(ANOMALY_LABEL[ty])}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-status">{t('Estado')}</label>
              <select id="ex-status" className="select" value={f.status} onChange={(e) => set({ status: e.target.value as AnomalyStatus | '' })}>
                <option value="">{t('Todos')}</option>
                {(Object.keys(ANOMALY_STATUS_LABEL) as AnomalyStatus[]).map((s) => <option key={s} value={s}>{t(ANOMALY_STATUS_LABEL[s])}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-emp">{t('Empleado')}</label>
              <select id="ex-emp" className="select" value={f.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
                <option value="">{t('Todos')}</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-from">{t('Desde')}</label>
              <input id="ex-from" type="date" className="input" value={f.from} onChange={(e) => set({ from: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ex-to">{t('Hasta')}</label>
              <input id="ex-to" type="date" className="input" value={f.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ex-asg">{t('Asignada a')}</label>
              <select id="ex-asg" className="select" value={f.assignee} onChange={(e) => set({ assignee: e.target.value })}>
                <option value="">{t('Todas')}</option>
                <option value="__none">{t('Sin asignar')}</option>
                <option value="__me">{t('Asignadas a mí')}</option>
                {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ex-sev">{t('Prioridad de revisión')}</label>
              <select id="ex-sev" className="select" value={f.severity} onChange={(e) => set({ severity: e.target.value as Severity | '' })}>
                <option value="">{t('Todas')}</option>
                {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => <option key={s} value={s}>{t(SEVERITY_LABEL[s])}</option>)}
              </select>
            </div>
            {anyFilter && (
              <Button variant="ghost" onClick={() => setF(NO_FILTERS)}>{t('Limpiar filtros')}</Button>
            )}
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={ShieldAlert} title={all.length === 0 ? t('No hay incidencias en su ámbito') : t('Ninguna incidencia coincide con los filtros')}>
              {all.length === 0 ? t('Cuando los datos presenten algo que revisar (por ejemplo, una salida sin registrar), aparecerá aquí.') : t('Cambie de pestaña o limpie los filtros.')}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Fecha')} col="date" sort={sort} onSort={onSort} />
                      <th>{t('Registro relacionado')}</th>
                      <SortHeader label={t('Tipo')} col="type" sort={sort} onSort={onSort} />
                      <th>{t('Motivo de la revisión')}</th>
                      <SortHeader label={t('Prioridad')} col="severity" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Asignada a')} col="assignee" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Última actualización')} col="updated" sort={sort} onSort={onSort} />
                      <th>{t('Acciones')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((a) => {
                      const link = relatedLink(ctx, a);
                      const manage = canManageAnomaly(ctx, a);
                      return (
                        <tr key={a.key}>
                          <td><EmployeeLink id={a.employeeId} /></td>
                          <td><DateText date={a.date} /></td>
                          <td className="small">{link ? <Link to={link.to}>{t(link.label)}</Link> : '—'}</td>
                          <td className="small strong">{t(ANOMALY_LABEL[a.type])}</td>
                          <td className="small control-reason">{msg(a.reason)}</td>
                          <td><SeverityBadge s={a.severity} /></td>
                          <td><AnomalyStatusBadge a={a} /></td>
                          <td className="small">{a.assigneeId ? userName(ctx.db, a.assigneeId) : <span className="muted">{t('Sin asignar')}</span>}</td>
                          <td className="small">{lastUpdate(a) ? <DateTimeText at={lastUpdate(a)} tz={ctx.company.timezone} /> : <span className="muted">{t('Detectada, sin revisar')}</span>}</td>
                          <td>
                            <Button size="sm" variant={manage && a.active && isOpenStatus(a.status) ? 'primary' : 'secondary'} onClick={() => openDetail(a.key)} aria-label={t('Abrir la incidencia de {name} del {date}', { name: employeeName(ctx.db, a.employeeId), date: a.date })}>
                              {manage ? t('Revisar') : t('Ver')}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination {...paged.props} />
            </>
          )}
        </Card>
      </div>
      {selected && <AnomalyDetail a={selected} onClose={closeDetail} />}
    </>
  );
}

/** Spanish description of the active filters for the export metadata. */
function describeLocal(ctx: UiCtx, f: LocalFilters, tab: TabId): string {
  const parts: string[] = [tab === 'open' ? 'abiertas' : tab === 'closed' ? 'resueltas y descartadas' : 'todas'];
  if (f.type) parts.push(`tipo ${ANOMALY_LABEL[f.type]}`);
  if (f.status) parts.push(`estado ${ANOMALY_STATUS_LABEL[f.status]}`);
  if (f.employeeId) parts.push(`empleado ${employeeName(ctx.db, f.employeeId)}`);
  if (f.from || f.to) parts.push(`fechas ${f.from || '…'} → ${f.to || '…'}`);
  if (f.assignee) parts.push(`asignada a ${f.assignee === '__none' ? 'nadie' : f.assignee === '__me' ? ctx.user.name : userName(ctx.db, f.assignee)}`);
  if (f.severity) parts.push(`prioridad ${SEVERITY_LABEL[f.severity].replace(/ \[.*\]$/, '').toLowerCase()}`);
  return parts.join(' · ');
}

function SeverityBadge({ s }: { s: Severity }) {
  return (
    <Badge tone={SEVERITY_TONE[s]} icon={false} title={t('Prioridad de revisión: orienta el orden de trabajo, no valora a la persona.')}>
      {t(SEVERITY_LABEL[s])}
    </Badge>
  );
}

function AnomalyStatusBadge({ a }: { a: Anomaly }) {
  return (
    <span className="status-stack">
      <Badge tone={STATUS_TONE[a.status]}>{t(ANOMALY_STATUS_LABEL[a.status])}</Badge>
      {!a.active && (
        <Badge tone="success" icon={false} title={t('La condición ya no se detecta en los datos (por ejemplo, tras una corrección aprobada). Se conserva el historial de revisión.')}>
          {t('Resuelta por cambio en los datos')}
        </Badge>
      )}
    </span>
  );
}

function AnomalyDetail({ a, onClose }: { a: Anomaly; onClose: () => void }) {
  const ctx = useCtx();
  const manage = canManageAnomaly(ctx, a);
  const own = ctx.employee?.id === a.employeeId;
  const link = relatedLink(ctx, a);
  const fix = DATA_TYPES.includes(a.type) ? correctionPath(ctx, a) : null;
  const available = ACTIONS.filter((x) => x.available(a));
  const [action, setAction] = useState<AnomalyAction | null>(null);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState<ID>(a.assigneeId ?? '');
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();
  const assignees = useMemo(() => eligibleAssignees(ctx), [ctx]);
  const history = [...(a.review?.history ?? [])].sort((x, y) => y.at.localeCompare(x.at));
  const def = ACTIONS.find((x) => x.id === action) ?? null;

  const noteError =
    action === 'resolve' || action === 'dismiss'
      ? note.trim().length < 5 ? t('Explique la resolución o el motivo del descarte (mínimo 5 caracteres).') : undefined
      : action === 'comment' && !note.trim() ? t('Escriba un comentario.') : undefined;
  const assigneeError = action === 'assign' && !assignee ? t('Seleccione a quién asignarla.') : undefined;

  const submit = async () => {
    if (!action || !def) return;
    setTouched(true);
    if (noteError || assigneeError) return;
    const r = await run(() => reviewAnomaly(a.key, action, note, action === 'assign' ? assignee : undefined), t(def.success));
    if (r) {
      setAction(null);
      setNote('');
      setTouched(false);
    }
  };

  return (
    <Modal
      wide
      title={t(ANOMALY_LABEL[a.type])}
      description={`${employeeName(ctx.db, a.employeeId)} · ${formatDate(a.date)}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('Cerrar')}</Button>}
    >
      <Callout tone="neutral" icon={Info}>
        {t('Una incidencia es una solicitud de revisión, no una conclusión sobre el comportamiento de ninguna persona.')}
      </Callout>
      <KV
        items={[
          [t('Empleado'), <EmployeeLink key="e" id={a.employeeId} />],
          [t('Fecha'), <DateText key="d" date={a.date} />],
          [t('Motivo de la revisión'), msg(a.reason)],
          [t('Prioridad de revisión'), <SeverityBadge key="s" s={a.severity} />],
          [t('Estado'), <AnomalyStatusBadge key="st" a={a} />],
          [t('Asignada a'), a.assigneeId ? userName(ctx.db, a.assigneeId) : t('Sin asignar')],
          [t('Registro relacionado'), link ? <Link key="l" to={link.to}>{t(link.label)} <ExternalLink size={12} aria-hidden /></Link> : '—'],
          ...(a.review?.resolution ? ([[t('Resolución'), a.review.resolution]] as [string, string][]) : []),
        ]}
      />
      {!a.active && (
        <Callout tone="success" title={t('Resuelta por cambio en los datos')}>
          {t('La condición ya no se detecta en los datos (por ejemplo, tras una corrección aprobada). Se conserva el historial de revisión.')}
        </Callout>
      )}

      {DATA_TYPES.includes(a.type) && a.active && (
        <Callout tone="info" title={t('Cómo se corrige un problema de datos')}>
          <div className="stack-sm">
            <span>{t('Resolver o descartar una incidencia nunca modifica ni elimina el registro original. Si los datos son incorrectos, la vía es una solicitud de corrección revisada, que conserva los valores originales.')}</span>
            {fix ? (
              <span>
                <Link className="btn sm" to={fix.to}>{t(fix.label)}</Link>
                {!own && <span className="small muted"> {t('La propuesta de la empresa requiere la conformidad del empleado.')}</span>}
              </span>
            ) : (
              <span className="small">{t('Solo la persona empleada o RR. HH. (mediante una propuesta) pueden iniciar la corrección. Pídale que la solicite desde «Registros horarios».')}</span>
            )}
          </div>
        </Callout>
      )}
      {a.type === 'pending_correction' && a.active && (
        <Callout tone="info" title={t('Corrección sin revisar')}>
          <Link to={`/correcciones/${a.ref.id}`}>{t('Abrir la solicitud de corrección')}</Link>
        </Callout>
      )}
      {a.type === 'shift_absence_conflict' && a.active && (
        <Callout tone="info" title={t('Revise la planificación')}>
          <span className="row-wrap">
            <Link to={`/calendario?fecha=${a.date}&vista=dia`}>{t('Ver el día en el calendario')}</Link>
            <Link to={`/ausencias/${a.ref.id}`}>{t('Ver la ausencia')}</Link>
          </span>
        </Callout>
      )}

      <section aria-labelledby="ex-hist" className="stack-sm">
        <h3 id="ex-hist" className="control-h3"><History size={15} aria-hidden /> {t('Historial de revisión')}</h3>
        {history.length === 0 ? (
          <p className="small muted">{t('Detectada automáticamente; todavía no tiene pasos de revisión.')}</p>
        ) : (
          <ol className="timeline">
            {history.map((h, i) => (
              <li key={i}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="strong">{HISTORY_LABEL[h.action] ? t(HISTORY_LABEL[h.action]) : h.action}</span>
                  <span className="tiny muted nowrap"><DateTimeText at={h.at} tz={ctx.company.timezone} /></span>
                </div>
                <div className="tiny muted">{userName(ctx.db, h.by)}</div>
                {h.note && <div className="small">{h.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {manage ? (
        <section aria-labelledby="ex-act" className="stack-sm">
          <h3 id="ex-act" className="control-h3"><MessageSquare size={15} aria-hidden /> {t('Registrar un paso de revisión')}</h3>
          <div className="row-wrap" role="group" aria-label={t('Acciones de revisión')}>
            {available.map((x) => (
              <Button key={x.id} size="sm" variant={action === x.id ? 'primary' : 'secondary'} aria-pressed={action === x.id} onClick={() => { setAction(x.id); setTouched(false); }}>
                {t(x.label)}
              </Button>
            ))}
          </div>
          {def && (
            <div className="stack-sm control-action-form">
              {action === 'assign' && (
                <SelectField label={t('Asignar a')} required value={assignee} onChange={(e) => setAssignee(e.target.value)} error={touched ? assigneeError : undefined} hint={t('Solo RR. HH. o personas supervisoras de la empresa.')}>
                  <option value="">{t('Seleccione…')}</option>
                  {assignees.map((u) => <option key={u.id} value={u.id}>{u.name} · {t(u.roles)}</option>)}
                </SelectField>
              )}
              <TextAreaField
                label={action === 'resolve' ? t('Resolución') : action === 'dismiss' ? t('Motivo del descarte') : action === 'comment' ? t('Comentario') : t('Nota (opcional)')}
                required={action === 'resolve' || action === 'dismiss' || action === 'comment'}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                error={touched ? noteError : undefined}
                hint={action === 'resolve' || action === 'dismiss' ? t('Queda en el historial y en la auditoría. No modifica el registro original.') : undefined}
              />
              <div className="row-wrap">
                <Button variant="primary" loading={pending} onClick={submit}>{t(def.label)}</Button>
                <Button variant="ghost" onClick={() => { setAction(null); setNote(''); setTouched(false); }}>{t('Cancelar')}</Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <p className="small muted">
          {own ? t('No puede revisar incidencias de sus propios registros.') : t('Su rol permite consultar esta incidencia, no gestionarla.')}
        </p>
      )}
    </Modal>
  );
}
