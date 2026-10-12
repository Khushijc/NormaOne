/**
 * Acciones preventivas: register of actions with owner, justified target date, review authority
 * and status. An action is closed only when its review authority accepts the resolution.
 * Representatives see the list with personal data masked (done by the service).
 */
import { ClipboardList, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmployeeLink, KindDate } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { Badge, Button, Callout, Card, Checkbox, EmptyState, PageHeader, Pagination, SelectField, SortHeader, StatusBadge, TextField, sortRows, usePaged, useSort } from '../../components/ui';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { ACTION_STATUS, PRIORITY } from '../../domain/status';
import type { ActionStatus, PreventiveAction, Priority } from '../../domain/types';
import { t } from '../../i18n';
import { roleName, userName, visibleWorksiteIds, worksiteName } from '../../services/context';
import { EMPTY_FILTERS } from '../../services/reportService';
import { visibleActions } from '../../services/safetyService';
import { useCtx } from '../../store/hooks';
import { ActionFormDialog } from './ActionForm';
import { ACTION_SOURCE_KINDS, ACTION_SOURCE_LABEL, KpiButton, isOverdue, type ActionSourceKind } from './shared';

type StatusFilter = '' | ActionStatus | 'pendientes';
const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const OPEN_STATUSES: ActionStatus[] = ['assigned', 'in_progress', 'reopened'];

export function ActionsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canManage = ctx.can('actions.manage');
  const masked = !ctx.can('actions.view_all') && ctx.can('representative.view');
  const all = useMemo(() => visibleActions(ctx), [ctx]);

  const status = (params.get('estado') ?? '') as StatusFilter;
  const overdueOnly = params.get('vencidas') === '1';
  const ws = params.get('centro') ?? '';
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState<'' | Priority>('');
  const [source, setSource] = useState<'' | ActionSourceKind>('');
  const [mine, setMine] = useState(false);
  const [readinessOnly, setReadinessOnly] = useState(false);
  const { sort, onSort } = useSort('target', 'asc');
  const creating = params.get('nueva') === '1' && canManage;

  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    setParams(p, { replace: true });
  };

  const matchStatus = (a: PreventiveAction, s: StatusFilter) => (!s ? true : s === 'pendientes' ? a.status !== 'resolved' : a.status === s);
  const counts = {
    open: all.filter((a) => a.status === 'open').length,
    active: all.filter((a) => OPEN_STATUSES.includes(a.status)).length,
    review: all.filter((a) => a.status === 'pending_review').length,
    overdue: all.filter((a) => isOverdue(a, ctx.today)).length,
    readiness: all.filter((a) => a.affectsReadiness && a.status !== 'resolved').length,
  };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = all.filter(
      (a) =>
        matchStatus(a, status) &&
        (!overdueOnly || isOverdue(a, ctx.today)) &&
        (!ws || a.worksiteId === ws) &&
        (!priority || a.priority === priority) &&
        (!source || a.source.kind === source) &&
        (!mine || a.ownerUserId === ctx.user.id) &&
        (!readinessOnly || (a.affectsReadiness && a.status !== 'resolved')) &&
        (!s || `${a.code} ${a.title} ${a.description} ${a.source.label}`.toLowerCase().includes(s)),
    );
    return sortRows(list, sort, (a, col) => {
      if (col === 'code') return a.code;
      if (col === 'title') return a.title;
      if (col === 'priority') return PRIORITY_RANK[a.priority];
      if (col === 'owner') return a.ownerUserId ? userName(ctx.db, a.ownerUserId) : null;
      if (col === 'status') return a.status;
      return a.targetDate;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, status, overdueOnly, ws, priority, source, mine, readinessOnly, sort, ctx.today]);
  const paged = usePaged(rows);
  const filtered = !!(q || status || overdueOnly || ws || priority || source || mine || readinessOnly);
  const canExport = ctx.can('reports.export') || ctx.can('representative.view');

  const clear = () => {
    setQ('');
    setPriority('');
    setSource('');
    setMine(false);
    setReadinessOnly(false);
    const p = new URLSearchParams(params);
    ['estado', 'vencidas', 'centro'].forEach((k) => p.delete(k));
    setParams(p, { replace: true });
  };
  const closeCreate = () => {
    const p = new URLSearchParams(params);
    ['nueva', 'origen', 'ref', 'empleado', 'puesto', 'titulo'].forEach((k) => p.delete(k));
    setParams(p, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('Acciones preventivas')}
        subtitle={t('Seguimiento de acciones con responsable, fecha objetivo justificada y revisión por la autoridad configurada. Subir evidencia no cierra una acción.')}
        actions={
          canManage && (
            <Button variant="primary" icon={Plus} onClick={() => setParam('nueva', '1')}>
              {t('Nueva acción')}
            </Button>
          )
        }
      />
      <div className="stack">
        {masked && <Callout tone="neutral">{t('Vista de la representación de los trabajadores: las acciones se muestran sin los datos personales de las personas afectadas.')}</Callout>}
        <div className="kpis">
          <KpiButton label={t('Sin responsable')} value={counts.open} tone={counts.open ? 'warning' : undefined} pressed={status === 'open'} onClick={() => setParam('estado', status === 'open' ? null : 'open')} />
          <KpiButton label={t('En curso')} value={counts.active} meta={t('Asignadas, en curso o reabiertas')} pressed={status === 'pendientes'} onClick={() => setParam('estado', status === 'pendientes' ? null : 'pendientes')} />
          <KpiButton label={t('Pendientes de revisión')} value={counts.review} pressed={status === 'pending_review'} onClick={() => setParam('estado', status === 'pending_review' ? null : 'pending_review')} />
          <KpiButton label={t('Con fecha objetivo vencida')} value={counts.overdue} meta={t('Solo acciones con fecha objetivo fijada')} tone={counts.overdue ? 'danger' : undefined} pressed={overdueOnly} onClick={() => setParam('vencidas', overdueOnly ? null : '1')} />
          <KpiButton label={t('Condicionan la disponibilidad')} value={counts.readiness} pressed={readinessOnly} onClick={() => setReadinessOnly((v) => !v)} />
        </div>
        <Card flush>
          <div className="toolbar sf-toolbar">
            <TextField className="search" label={t('Buscar')} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Código, título u origen')} />
            <SelectField label={t('Estado')} value={status} onChange={(e) => setParam('estado', e.target.value || null)}>
              <option value="">{t('Todos')}</option>
              <option value="pendientes">{t('Sin resolver')}</option>
              {(Object.keys(ACTION_STATUS) as ActionStatus[]).map((s) => (
                <option key={s} value={s}>
                  {t(ACTION_STATUS[s].label)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('Centro')} value={ws} onChange={(e) => setParam('centro', e.target.value || null)}>
              <option value="">{t('Todos')}</option>
              {[...visibleWorksiteIds(ctx)].map((id) => (
                <option key={id} value={id}>
                  {worksiteName(ctx.db, id)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('Prioridad')} value={priority} onChange={(e) => setPriority(e.target.value as '' | Priority)}>
              <option value="">{t('Todas')}</option>
              {(Object.keys(PRIORITY) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {t(PRIORITY[p].label)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('Tipo de origen')} value={source} onChange={(e) => setSource(e.target.value as '' | ActionSourceKind)}>
              <option value="">{t('Todos')}</option>
              {ACTION_SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(ACTION_SOURCE_LABEL[k])}
                </option>
              ))}
            </SelectField>
            <div className="sf-toolbar-check stack-sm">
              <Checkbox label={t('Solo vencidas')} checked={overdueOnly} onChange={(v) => setParam('vencidas', v ? '1' : null)} />
              <Checkbox label={t('Asignadas a mí')} checked={mine} onChange={setMine} />
            </div>
            {filtered && (
              <Button variant="ghost" onClick={clear}>
                {t('Limpiar filtros')}
              </Button>
            )}
            <div className="grow" />
            {canExport && <ExportButton reportId="actions" filters={{ ...EMPTY_FILTERS, worksiteId: ws }} />}
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={all.length ? Search : ClipboardList} title={all.length ? t('Ninguna acción coincide con los filtros') : t('Sin acciones preventivas')}>
              {all.length ? t('Cambie o limpie los filtros.') : canManage ? t('Cree una acción desde un requisito sin evidencia, una revisión, una evaluación o la coordinación CAE.') : t('No hay acciones en su ámbito.')}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader label={t('Código')} col="code" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Título')} col="title" sort={sort} onSort={onSort} />
                      <th>{t('Origen [acción]')}</th>
                      <th>{t('Ámbito')}</th>
                      <SortHeader label={t('Prioridad')} col="priority" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Responsable')} col="owner" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Fecha objetivo')} col="target" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                      <th>{t('Autoridad de revisión')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((a) => {
                      const overdue = isOverdue(a, ctx.today);
                      return (
                        <tr key={a.id} className="clickable" onClick={() => navigate(`/acciones/${a.id}`)}>
                          <td className="nowrap">
                            <Link to={`/acciones/${a.id}`} onClick={(e) => e.stopPropagation()}>
                              {a.code}
                            </Link>
                          </td>
                          <td style={{ minWidth: 240 }}>
                            {a.title}
                            {a.affectsReadiness && a.status !== 'resolved' && (
                              <div>
                                <Badge tone="accent">{t('Condiciona la disponibilidad')}</Badge>
                              </div>
                            )}
                          </td>
                          <td className="small" style={{ minWidth: 160 }}>
                            {t(ACTION_SOURCE_LABEL[a.source.kind])}
                            {a.source.label && <div className="sub">{a.source.label}</div>}
                          </td>
                          <td className="small" style={{ minWidth: 150 }} onClick={(e) => e.stopPropagation()}>
                            {a.employeeId && <div><EmployeeLink id={a.employeeId} /></div>}
                            {a.jobRoleId && <div>{roleName(ctx.db, a.jobRoleId)}</div>}
                            {a.worksiteId && <div>{worksiteName(ctx.db, a.worksiteId)}</div>}
                            {!a.employeeId && !a.jobRoleId && !a.worksiteId && <span className="muted">{t('General')}</span>}
                          </td>
                          <td>
                            <StatusBadge meta={PRIORITY[a.priority]} />
                          </td>
                          <td className="small">{a.ownerUserId ? userName(ctx.db, a.ownerUserId) : <span className="muted">{t('Sin asignar')}</span>}</td>
                          <td className="small">
                            <KindDate kind="target" date={a.targetDate} today={a.status !== 'resolved' ? ctx.today : undefined} />
                            {overdue && (
                              <div>
                                <Badge tone="danger">{t('Vencida [fecha objetivo]')}</Badge>
                              </div>
                            )}
                          </td>
                          <td>
                            <StatusBadge meta={ACTION_STATUS[a.status]} />
                          </td>
                          <td className="small" style={{ minWidth: 140 }}>
                            {t(AUTHORITY_LABEL[a.reviewAuthority])}
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
        <p className="tiny muted">{t('«Vencida» solo se indica frente a una fecha objetivo real asignada con justificación. Una acción sin fecha no se considera vencida.')}</p>
      </div>
      {creating && (
        <ActionFormDialog
          prefill={{ kind: params.get('origen'), refId: params.get('ref'), employeeId: params.get('empleado'), worksiteId: params.get('centro'), jobRoleId: params.get('puesto'), title: params.get('titulo') }}
          onClose={closeCreate}
          onCreated={(a) => navigate(`/acciones/${a.id}`)}
        />
      )}
    </>
  );
}
