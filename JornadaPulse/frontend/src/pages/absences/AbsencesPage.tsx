/**
 * Ausencias (TIM-05): own requests, requests awaiting the viewer's review and the company/team
 * list. Balances only where an adviser-approved allowance exists. Approving leave never creates
 * clock-in/out records.
 */
import { CalendarOff, Info, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExportButton } from '../../components/ExportButton';
import { Button, Callout, Card, DateText, EmptyState, PageHeader, Pagination, SortHeader, StatusBadge, Tabs, sortRows, usePaged, useSort } from '../../components/ui';
import { ABSENCE_STATUS } from '../../domain/status';
import { isValidISODate } from '../../domain/time';
import type { AbsenceRequest, AbsenceStatus, ID } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { absenceTypeLabel, absenceTypesFor, absencesAwaitingMe, balanceFor, countDays, visibleAbsences } from '../../services/absenceService';
import { employeeName, userName, visibleAbsenceEmployeeIds } from '../../services/context';
import { ABSENCE_COLUMNS, EMPTY_FILTERS, absenceRows, describeFilters, type Filters } from '../../services/reportService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { AbsenceForm } from './AbsenceForm';
import { seesDetail } from './absenceUi';

type TabId = 'mine' | 'review' | 'all';
const TAB_PARAM: Record<string, TabId> = { mias: 'mine', revisar: 'review', todas: 'all' };
const RESERVED = '__reserved';
const EXPORT_TITLE = 'Ausencias';
const EXPORT_PENDING_TITLE = 'Ausencias pendientes de decisión';
const STATUS_KEYS = Object.keys(ABSENCE_STATUS) as AbsenceStatus[];
const TAB_LABEL: Record<TabId, string> = { mine: tKey('Mis solicitudes'), review: tKey('Por revisar'), all: tKey('Todas') };

interface UiFilters {
  status: string;
  employeeId: string;
  typeId: string;
  from: string;
  to: string;
}

function workingDays(ctx: UiCtx, a: AbsenceRequest): number {
  return countDays(ctx, a.employeeId, a.startDate, a.endDate, 'working');
}

export function AbsencesPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const canOwn = ctx.can('absences.request_own') && !!ctx.employee;
  const isReviewer = ctx.can('absences.review_all') || ctx.can('absences.review_team');
  const canAll = ctx.can('absences.view_all') || ctx.can('absences.review_team');
  const canCreate = canOwn || ctx.can('absences.review_all');
  const canSensitive = ctx.can('absences.view_sensitive');

  const statusParam = params.get('estado');
  const initialTab: TabId = (() => {
    const v = TAB_PARAM[params.get('vista') ?? ''];
    if (v === 'mine' && canOwn) return v;
    if (v === 'review' && isReviewer) return v;
    if (v === 'all' && canAll) return v;
    if (statusParam && canAll) return 'all';
    if (isReviewer && absencesAwaitingMe(ctx).length > 0) return 'review';
    if (canOwn) return 'mine';
    if (isReviewer) return 'review';
    return 'all';
  })();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [filters, setFilters] = useState<UiFilters>({ status: statusParam && statusParam in ABSENCE_STATUS ? statusParam : '', employeeId: params.get('empleado') ?? '', typeId: '', from: '', to: '' });
  const setF = (patch: Partial<UiFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtersActive = Object.values(filters).some(Boolean);

  const formOpen = params.get('nueva') === '1' && canCreate;
  const desde = params.get('desde');
  const closeForm = () => {
    const next = new URLSearchParams(params);
    next.delete('nueva');
    next.delete('desde');
    setParams(next, { replace: true });
  };
  const openForm = () => {
    const next = new URLSearchParams(params);
    next.set('nueva', '1');
    setParams(next, { replace: true });
  };

  const visible = useMemo(() => visibleAbsences(ctx), [ctx]);
  const awaiting = useMemo(() => absencesAwaitingMe(ctx), [ctx]);
  const mine = useMemo(() => visible.filter((a) => a.employeeId === ctx.employee?.id), [visible, ctx.employee]);
  const source = tab === 'mine' ? mine : tab === 'review' ? awaiting : visible;

  const types = absenceTypesFor(ctx, true);
  const typeOptions = types.filter((x) => !x.sensitive || canSensitive);
  const scopeIds = visibleAbsenceEmployeeIds(ctx);
  const employees = ctx.db.employees
    .filter((e) => e.companyId === ctx.company.id && scopeIds.has(e.id))
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'es'));

  const matchesCategory = (a: AbsenceRequest) => {
    if (!filters.typeId) return true;
    if (filters.typeId === RESERVED) return !seesDetail(ctx, a);
    return seesDetail(ctx, a) && a.typeId === filters.typeId;
  };
  const matchesDates = (a: AbsenceRequest) => (!filters.from || a.endDate >= filters.from) && (!filters.to || a.startDate <= filters.to);
  const filtered = source.filter(
    (a) => (!filters.status || a.status === filters.status) && (!filters.employeeId || a.employeeId === filters.employeeId) && matchesCategory(a) && matchesDates(a),
  );

  const { sort, onSort } = useSort('start', 'desc');
  const sorted = sortRows(filtered, sort, (a, col) => {
    switch (col) {
      case 'employee': return employeeName(ctx.db, a.employeeId);
      case 'type': return t(absenceTypeLabel(ctx, a));
      case 'start': return a.startDate;
      case 'days': return a.partial ? 0 : workingDays(ctx, a);
      case 'status': return t(ABSENCE_STATUS[a.status].label);
      case 'submitted': return a.submittedAt;
      case 'reviewer': return a.reviewerId ? userName(ctx.db, a.reviewerId) : null;
      default: return null;
    }
  });
  const paged = usePaged(sorted, 25);

  // Export exactly the rows on screen (drafts are never exported by the report service).
  const reportFilters: Filters = { ...EMPTY_FILTERS, from: isValidISODate(filters.from) ? filters.from : null, to: isValidISODate(filters.to) ? filters.to : null, employeeId: filters.employeeId || null, status: filters.status || null };
  const shownIds = new Set(filtered.map((a) => a.id));
  const exportRows = absenceRows(ctx, reportFilters).filter((r) => shownIds.has(r.id));
  const byId = new Map(visible.map((a) => [a.id, a]));
  const pendingRows = absenceRows(ctx, { ...reportFilters, status: null }, true).filter((r) => {
    const a = byId.get(r.id);
    return !!a && matchesCategory(a) && (tab !== 'mine' || a.employeeId === ctx.employee?.id);
  });
  const categoryText = filters.typeId ? (filters.typeId === RESERVED ? 'categoría reservada' : types.find((x) => x.id === filters.typeId)?.name ?? '') : '';
  const exportFilters = [`vista ${TAB_LABEL[tab]}`, describeFilters(ctx, reportFilters), categoryText && `categoría ${categoryText}`].filter(Boolean).join(' · ');
  const ownExport = !ctx.can('reports.export');

  const year = Number(ctx.today.slice(0, 4));
  const balanceSubject: ID | null = filters.employeeId && scopeIds.has(filters.employeeId) ? filters.employeeId : ctx.employee?.id ?? null;

  const emptyTitle = tab === 'review' ? t('No hay solicitudes pendientes de su revisión') : tab === 'mine' ? t('No tiene solicitudes de ausencia') : t('No hay ausencias registradas');

  return (
    <div className="stack-lg">
      <PageHeader
        title={t('Ausencias')}
        subtitle={t('Vacaciones, permisos y bajas. Las ausencias se gestionan aparte del registro de jornada.')}
        actions={
          canCreate ? (
            <Button variant="primary" icon={Plus} onClick={openForm}>
              {t('Nueva solicitud')}
            </Button>
          ) : undefined
        }
      />

      <Callout tone="info" icon={Info}>
        {t('Aprobar una ausencia nunca crea fichajes de entrada o salida ni modifica los registros de jornada. Los turnos planificados en esas fechas se avisan, pero no se cancelan automáticamente.')}
      </Callout>

      {balanceSubject && <BalanceCards ctx={ctx} employeeId={balanceSubject} year={year} />}

      <Tabs<TabId>
        label={t('Vistas de ausencias')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'mine', label: t(TAB_LABEL.mine), count: mine.length, hidden: !canOwn },
          { id: 'review', label: t(TAB_LABEL.review), count: awaiting.length, hidden: !isReviewer },
          { id: 'all', label: t(TAB_LABEL.all), count: visible.length, hidden: !canAll },
        ]}
      />

      <Card
        flush
        title={t(TAB_LABEL[tab])}
        actions={
          <>
            <ExportButton kind="absences" title={EXPORT_TITLE} rows={exportRows} columns={ABSENCE_COLUMNS} filters={exportFilters} own={ownExport} />
            {(isReviewer || canAll) && (
              <ExportButton kind="absences_pending" title={EXPORT_PENDING_TITLE} rows={pendingRows} columns={ABSENCE_COLUMNS} filters={exportFilters} own={ownExport} label={t('Exportar pendientes')} />
            )}
          </>
        }
      >
        <div className="toolbar" role="search" aria-label={t('Filtros')}>
          <div className="field">
            <label htmlFor="abs-st">{t('Estado')}</label>
            <select id="abs-st" className="select" value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
              <option value="">{t('Todos')}</option>
              {STATUS_KEYS.map((s) => (
                <option key={s} value={s}>
                  {t(ABSENCE_STATUS[s].label)}
                </option>
              ))}
            </select>
          </div>
          {employees.length > 1 && tab !== 'mine' && (
            <div className="field">
              <label htmlFor="abs-emp">{t('Empleado')}</label>
              <select id="abs-emp" className="select" value={filters.employeeId} onChange={(e) => setF({ employeeId: e.target.value })}>
                <option value="">{t('Todos')}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName} · {e.code}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="abs-type">{t('Categoría')}</label>
            <select id="abs-type" className="select" value={filters.typeId} onChange={(e) => setF({ typeId: e.target.value })}>
              <option value="">{t('Todas')}</option>
              {typeOptions.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.name)}
                </option>
              ))}
              {!canSensitive && <option value={RESERVED}>{t('Ausencia justificada (categoría reservada)')}</option>}
            </select>
          </div>
          <div className="field">
            <label htmlFor="abs-from">{t('Desde')}</label>
            <input id="abs-from" type="date" className="input" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="abs-to">{t('Hasta')}</label>
            <input id="abs-to" type="date" className="input" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
          </div>
          {filtersActive && (
            <Button variant="ghost" icon={X} onClick={() => setFilters({ status: '', employeeId: '', typeId: '', from: '', to: '' })}>
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            icon={CalendarOff}
            title={filtersActive ? t('Ninguna ausencia coincide con los filtros') : emptyTitle}
            action={
              filtersActive ? (
                <Button variant="ghost" onClick={() => setFilters({ status: '', employeeId: '', typeId: '', from: '', to: '' })}>{t('Limpiar filtros')}</Button>
              ) : canCreate && tab === 'mine' ? (
                <Button variant="primary" icon={Plus} onClick={openForm}>{t('Nueva solicitud')}</Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">{t(TAB_LABEL[tab])}</caption>
                <thead>
                  <tr>
                    <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Categoría')} col="type" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Fechas')} col="start" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Días laborables')} col="days" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Enviada')} col="submitted" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Revisor')} col="reviewer" sort={sort} onSort={onSort} />
                    <th>{t('Acciones')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((a) => {
                    const emp = ctx.db.employees.find((e) => e.id === a.employeeId);
                    const reviewable = awaiting.some((x) => x.id === a.id);
                    const masked = !seesDetail(ctx, a);
                    return (
                      <tr key={a.id} className="clickable" onClick={() => navigate(`/ausencias/${a.id}`)}>
                        <td>
                          <div className="strong">{employeeName(ctx.db, a.employeeId)}</div>
                          <div className="sub">{emp?.code}</div>
                        </td>
                        <td>
                          <span className={masked ? 'muted' : undefined}>{t(absenceTypeLabel(ctx, a))}</span>
                          {a.createdBy !== emp?.userId && <div className="sub">{t('Registrada por RR. HH.')}</div>}
                        </td>
                        <td className="nowrap">
                          <DateText date={a.startDate} />
                          {a.endDate !== a.startDate && (
                            <>
                              {' → '}
                              <DateText date={a.endDate} />
                            </>
                          )}
                          {a.partial && <div className="sub">{t('Por horas: {from}–{to}', { from: a.partial.startTime, to: a.partial.endTime })}</div>}
                        </td>
                        <td className="num">{a.partial ? <span className="muted small">{t('Parcial')}</span> : workingDays(ctx, a)}</td>
                        <td>
                          <StatusBadge meta={ABSENCE_STATUS[a.status]} prefix="Estado" />
                        </td>
                        <td>{a.submittedAt ? <DateText date={a.submittedAt.slice(0, 10)} /> : <span className="muted">—</span>}</td>
                        <td>{a.reviewerId ? userName(ctx.db, a.reviewerId) : <span className="muted">—</span>}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <Link to={`/ausencias/${a.id}`} className={`btn sm ${reviewable ? 'primary' : ''}`}>
                            {reviewable ? (a.status === 'cancel_requested' ? t('Decidir cancelación') : t('Revisar')) : t('Ver')}
                          </Link>
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

      {formOpen && <AbsenceForm initialDate={desde && isValidISODate(desde) ? desde : null} onClose={closeForm} />}
    </div>
  );
}

function BalanceCards({ ctx, employeeId, year }: { ctx: UiCtx; employeeId: ID; year: number }) {
  const own = employeeId === ctx.employee?.id;
  const types = absenceTypesFor(ctx).filter((x) => !x.sensitive || own || ctx.can('absences.view_sensitive'));
  const balances = types.map((type) => ({ type, b: balanceFor(ctx, employeeId, type.id, year) })).filter((x) => x.b !== null);
  const title = own ? t('Mis saldos {year}', { year }) : t('Saldos {year} · {name}', { year, name: employeeName(ctx.db, employeeId) });
  if (!balances.length) {
    return (
      <Card title={title}>
        <Callout tone="neutral" title={t('Saldos no configurados')}>
          {t('Ninguna categoría tiene una asignación anual validada por la asesoría laboral para {year}. No se calcula ningún saldo hasta que exista esa política.', { year })}
        </Callout>
      </Card>
    );
  }
  return (
    <Card title={title}>
      <div className="stack">
        <div className="abs-balances">
          {balances.map(({ type, b }) => (
            <div key={type.id} className="abs-balance">
              <div className="strong">{t(type.name)}</div>
              <div className="tiny muted">{b!.unit === 'natural' ? t('Días naturales') : t('Días laborables')}</div>
              <dl>
                <div>
                  <dt>{t('Asignados')}</dt>
                  <dd>{b!.allowance}</dd>
                </div>
                <div>
                  <dt>{t('Disfrutados o aprobados')}</dt>
                  <dd>{b!.used}</dd>
                </div>
                <div>
                  <dt>{t('Pendientes de decisión')}</dt>
                  <dd>{b!.pending}</dd>
                </div>
                <div className="abs-available">
                  <dt>{t('Disponibles')}</dt>
                  <dd className={b!.available < 0 ? 'abs-negative' : undefined}>{b!.available}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          {t('Saldo según política validada por la asesoría (datos de demostración).')} {t('Las categorías sin asignación aprobada no muestran saldo.')}
        </p>
      </div>
    </Card>
  );
}
