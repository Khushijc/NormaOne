/**
 * Registros horarios (TIM-02, TIM-03, TIM-08): actual working-time records in the caller's
 * scope (own / team / company / representative). Built from `recordRows`, so the table, the
 * totals and the export always show exactly the same filtered rows. Planned shifts never
 * appear here.
 */
import { ClipboardList, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DurationText, EmployeeLink, IndicatorBadges, TimeText } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { FilterBar } from '../../components/FilterBar';
import { Callout, Card, DateText, DateTimeText, EmptyState, PageHeader, Pagination, SortHeader, sortRows, StatusBadge, usePaged, useSort } from '../../components/ui';
import { policyForSession, sessionIndicators } from '../../domain/records';
import { BREAK_KIND_LABEL, RECORD_STATUS } from '../../domain/status';
import { addDays, formatDate, formatDuration } from '../../domain/time';
import { t, tKey } from '../../i18n';
import { timeScope } from '../../services/context';
import { describeFilters, recordRows, RECORD_COLUMNS, type Filters, type RecordRow } from '../../services/reportService';
import { useCtx } from '../../store/hooks';

/** Query-string names (dashboard links use them). */
const Q = { from: 'desde', to: 'hasta', status: 'estado', employeeId: 'empleado', worksiteId: 'centro', departmentId: 'departamento', search: 'q' } as const;

const STATUS_OPTIONS = (Object.keys(RECORD_STATUS) as (keyof typeof RECORD_STATUS)[]).map((k) => ({ value: k, label: RECORD_STATUS[k].label }));

/** Export title: kept in Spanish, the language of the record (file metadata). */
const EXPORT_TITLE = 'Registros horarios';

const SCOPE_NOTE = {
  own: tKey('Solo ve sus propios registros de jornada.'),
  team: tKey('Ve los registros de su equipo directo y los suyos propios.'),
  all: tKey('Ve todos los registros de jornada de la empresa.'),
  representative: tKey('Acceso de la representación legal de los trabajadores a los registros de la empresa.'),
  none: tKey('Sin acceso a registros de jornada.'),
};

export function RecordsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = timeScope(ctx);
  const representative = scope === 'representative';

  // Dates: absent → default range (last 31 days); present but empty → explicitly cleared.
  const filters: Filters = useMemo(() => {
    const date = (k: string, def: string) => (params.has(k) ? params.get(k) || null : def);
    return {
      from: date(Q.from, addDays(ctx.today, -30)),
      to: date(Q.to, ctx.today),
      status: params.get(Q.status) || null,
      employeeId: params.get(Q.employeeId) || null,
      worksiteId: params.get(Q.worksiteId) || null,
      departmentId: params.get(Q.departmentId) || null,
      search: params.get(Q.search) ?? '',
    };
  }, [params, ctx.today]);

  const setFilters = (f: Filters) => {
    const next = new URLSearchParams();
    next.set(Q.from, f.from ?? '');
    next.set(Q.to, f.to ?? '');
    if (f.status) next.set(Q.status, f.status);
    if (f.employeeId) next.set(Q.employeeId, f.employeeId);
    if (f.worksiteId) next.set(Q.worksiteId, f.worksiteId);
    if (f.departmentId) next.set(Q.departmentId, f.departmentId);
    if (f.search) next.set(Q.search, f.search);
    setParams(next, { replace: true });
    paged.reset();
  };

  const rows = useMemo(() => recordRows(ctx, filters), [ctx, filters]);
  const { sort, onSort } = useSort('start', 'desc');
  const sorted = sortRows(rows, sort, (r, col) => {
    switch (col) {
      case 'employee': return r.employee;
      case 'date': return r.date;
      case 'worksite': return r.worksite;
      case 'start': return r.start;
      case 'end': return r.end;
      case 'breaks': return r.breakMinutes;
      case 'gross': return r.grossMinutes;
      case 'unpaid': return r.unpaidBreakMinutes;
      case 'net': return r.netMinutes;
      case 'status': return t(RECORD_STATUS[r.status].label);
      case 'updated': return r.updatedAt;
      default: return null;
    }
  });
  const paged = usePaged(sorted);

  const closed = rows.filter((r) => r.end && !r.provisional);
  const totalGross = closed.reduce((acc, r) => acc + (r.grossMinutes ?? 0), 0);
  const totalNet = closed.reduce((acc, r) => acc + (r.netMinutes ?? 0), 0);
  const totalUnpaid = closed.reduce((acc, r) => acc + r.unpaidBreakMinutes, 0);

  const canExport = ctx.can('reports.export') || representative || ctx.can('reports.own');
  const exportOwn = !ctx.can('reports.export') && !representative;
  const repUntil = ctx.membership?.roleValidUntil?.representative ?? ctx.membership?.validUntil ?? null;
  const title = scope === 'own' ? t('Mis registros') : t('Registros horarios');

  return (
    <>
      <PageHeader
        title={title}
        subtitle={t('Entradas, pausas y salidas realmente registradas. Los valores mostrados son los vigentes (con las correcciones aprobadas); los originales se conservan en el detalle.')}
        actions={
          canExport ? (
            <ExportButton kind="registros" title={EXPORT_TITLE} rows={sorted} columns={RECORD_COLUMNS} filters={describeFilters(ctx, filters)} own={exportOwn} />
          ) : undefined
        }
      />

      <div className="stack">
        {representative ? (
          <Callout tone="warning" icon={ShieldCheck} title={t('Acceso minimizado de la representación legal')}>
            {t('Consulta limitada a lo necesario para vigilar el cumplimiento del registro de jornada (ET art. 34.9): sin datos de contacto ni motivos de ausencia. El acceso es temporal y finaliza con el mandato: {date}.', { date: repUntil ? formatDate(repUntil) : t('sin fecha registrada') })}
          </Callout>
        ) : (
          <p className="small muted">{t(SCOPE_NOTE[scope])}</p>
        )}
        <Callout tone="info">
          {t('Aquí solo hay registros reales de jornada. Los turnos planificados nunca aparecen en esta tabla ni se convierten en tiempo trabajado; consúltelos en el calendario o en turnos y horarios.')}
        </Callout>

        <Card flush>
          <FilterBar value={filters} onChange={setFilters} show={['search', 'dates', 'department', 'worksite', 'employee', 'status']} statusOptions={STATUS_OPTIONS} />
          {sorted.length === 0 ? (
            <EmptyState icon={ClipboardList} title={t('No hay registros con estos filtros')}>
              {t('Amplíe el rango de fechas o limpie los filtros. Los días sin fichajes no generan registros.')}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table records-table">
                  <caption className="sr-only">{title}</caption>
                  <thead>
                    <tr>
                      <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Fecha')} col="date" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Centro')} col="worksite" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Entrada')} col="start" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Salida')} col="end" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Pausas registradas')} col="breaks" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Bruto')} col="gross" sort={sort} onSort={onSort} num />
                      <SortHeader label={t('Pausas no retribuidas')} col="unpaid" sort={sort} onSort={onSort} num />
                      <SortHeader label={t('Neto según política')} col="net" sort={sort} onSort={onSort} num />
                      <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                      <th>{t('Indicadores de revisión (configurables)')}</th>
                      <SortHeader label={t('Actualizado')} col="updated" sort={sort} onSort={onSort} />
                      <th><span className="sr-only">{t('Acciones')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((r) => (
                      <RecordTableRow key={r.session.id} r={r} onOpen={() => navigate(`/registros/${r.session.id}`)} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}>
                        {t('Total de {n} registros cerrados mostrados', { n: closed.length })}
                        {rows.length > closed.length && <div className="tiny muted">{t('{n} registros abiertos o incompletos no se suman.', { n: rows.length - closed.length })}</div>}
                      </td>
                      <td className="num"><DurationText minutes={totalGross} /></td>
                      <td className="num"><DurationText minutes={totalUnpaid} /></td>
                      <td className="num"><DurationText minutes={totalNet} /></td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pagination {...paged.props} />
            </>
          )}
        </Card>
        <p className="tiny muted">
          {t('Horas en la zona horaria del centro de trabajo; pase el cursor por una hora para ver el instante UTC y el desfase. «(+1)» indica que la salida es al día siguiente. Los indicadores son umbrales configurables que piden una revisión, no conclusiones.')}
        </p>
      </div>
    </>
  );
}

function RecordTableRow({ r, onOpen }: { r: RecordRow; onOpen: () => void }) {
  const ctx = useCtx();
  const s = r.session;
  const policy = policyForSession(ctx.db, s);
  const paidKinds = policy?.breaks.paidBreakKinds ?? [];
  const paidMinutes = r.breakMinutes - r.unpaidBreakMinutes;
  return (
    <tr className="clickable" onClick={onOpen}>
      <td>
        <EmployeeLink id={r.employeeId} />
        <div className="sub">{r.code}</div>
      </td>
      <td><DateText date={r.date} /></td>
      <td>{r.worksite}</td>
      <td><TimeText at={r.start} tz={s.timezone} /></td>
      <td><TimeText at={r.end} tz={s.timezone} baseDate={s.date} /></td>
      <td>
        <span className="nowrap">
          {r.breaksCount} · <DurationText minutes={r.breakMinutes} provisional={r.provisional} />
        </span>
        {r.breaksCount > 0 && (
          <div className="sub" title={paidKinds.length ? t('Retribuidas según la política: {kinds}', { kinds: paidKinds.map((k) => t(BREAK_KIND_LABEL[k])).join(', ') }) : t('Ninguna pausa es retribuida según la política')}>
            {t('Retribuidas {paid} · no retribuidas {unpaid}', { paid: formatDuration(paidMinutes), unpaid: formatDuration(r.unpaidBreakMinutes) })}
          </div>
        )}
      </td>
      <td className="num"><DurationText minutes={r.grossMinutes} provisional={r.provisional} /></td>
      <td className="num"><DurationText minutes={r.unpaidBreakMinutes} provisional={r.provisional} /></td>
      <td className="num">
        <span className="strong"><DurationText minutes={r.netMinutes} provisional={r.provisional} /></span>
        <div className="sub">{r.policyVersion !== null ? t('política v{v}', { v: r.policyVersion }) : t('sin política')}</div>
      </td>
      <td><StatusBadge meta={RECORD_STATUS[r.status]} /></td>
      <td><IndicatorBadges items={sessionIndicators(ctx.db, s)} /></td>
      <td className="tiny"><DateTimeText at={r.updatedAt} tz={s.timezone} /></td>
      <td>
        <Link to={`/registros/${s.id}`} onClick={(e) => e.stopPropagation()}>
          {t('Abrir')}
          <span className="sr-only"> {t('registro de {name} del {date}', { name: r.employee, date: formatDate(r.date) })}</span>
        </Link>
      </td>
    </tr>
  );
}

