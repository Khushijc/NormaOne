/**
 * Solicitudes de corrección (TIM-04, AC-TIM-01, R25/R26).
 *
 * Tabs: own requests (company proposals awaiting my agreement first), requests awaiting my
 * review, and everything in my scope. Query params: `estado`, `vista`, and `nueva=1` with
 * optional `sesion`, `fallo`, `empleado` to open the new-correction form.
 */
import { ListChecks, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmployeeLink } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { FilterBar } from '../../components/FilterBar';
import { Badge, Button, Callout, Card, DateText, DateTimeText, EmptyState, PageHeader, Pagination, SortHeader, sortRows, StatusBadge, Tabs, usePaged, useSort } from '../../components/ui';
import { CORRECTION_KIND_LABEL, CORRECTION_STATUS } from '../../domain/status';
import type { CorrectionRequest, CorrectionStatus } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { userName } from '../../services/context';
import { correctionsAwaitingMe } from '../../services/correctionService';
import { correctionRows, CORRECTION_COLUMNS, describeFilters, EMPTY_FILTERS, type CorrectionRow, type Filters } from '../../services/reportService';
import { useCtx } from '../../store/hooks';
import { NewCorrectionDialog, type NewCorrectionInitial } from './CorrectionForm';
import { diffFields, InitiatedBadge, SpanSummary } from './correctionBits';

type TabId = 'mine' | 'review' | 'all';

const TAB_LABEL: Record<TabId, string> = {
  mine: tKey('Mis solicitudes'),
  review: tKey('Por revisar'),
  all: tKey('Todas'),
};

/** Export title stays in Spanish (file metadata); the screen shows t() of it. */
const EXPORT_TITLE = 'Solicitudes de corrección';

const STATUS_OPTIONS = (Object.keys(CORRECTION_STATUS) as CorrectionStatus[]).map((s) => ({ value: s, label: CORRECTION_STATUS[s].label }));

const isOnBehalf = (c: CorrectionRequest, employeeUserId: string | null | undefined) => c.initiatedBy === 'employee' && c.requestedBy !== employeeUserId;

export function CorrectionsPage() {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const me = ctx.employee;

  const isReviewer = ctx.can('corrections.review_team') || ctx.can('corrections.review_all') || ctx.can('corrections.propose');
  const canCreate = (ctx.can('corrections.request_own') && !!me) || ctx.can('corrections.propose');

  const shown: Record<TabId, boolean> = { mine: !!me, review: isReviewer, all: isReviewer || ctx.can('time.view_all') };
  const defaultTab: TabId = shown.review ? 'review' : shown.mine ? 'mine' : 'all';
  const tabParam = params.get('vista') as TabId | null;
  const tab: TabId = tabParam && (['mine', 'review', 'all'] as string[]).includes(tabParam) && shown[tabParam] ? tabParam : defaultTab;

  const estado = params.get('estado');
  const statusParam = estado && Object.keys(CORRECTION_STATUS).includes(estado) ? estado : null;
  const [baseFilters, setBaseFilters] = useState<Filters>(EMPTY_FILTERS);
  // The status filter lives in the URL (?estado=…) so links from other screens land filtered.
  const filters = useMemo<Filters>(() => ({ ...baseFilters, status: statusParam }), [baseFilters, statusParam]);
  const [formOpen, setFormOpen] = useState<NewCorrectionInitial | null>(null);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const changeFilters = (f: Filters) => {
    setBaseFilters({ ...f, status: null });
    paged.reset();
    if ((f.status ?? null) !== statusParam) setParam({ estado: f.status });
  };

  // Form opened by query params (cross-screen links) or by the button.
  const urlForm: NewCorrectionInitial | null =
    params.get('nueva') === '1'
      ? { sessionId: params.get('sesion'), failedId: params.get('fallo'), employeeId: params.get('empleado'), missing: !params.get('sesion') && !params.get('fallo') }
      : null;
  const form = formOpen ?? urlForm;
  const closeForm = () => {
    setFormOpen(null);
    if (urlForm) setParam({ nueva: null, sesion: null, fallo: null, empleado: null });
  };

  // ── Data ──
  const allRows = useMemo(() => correctionRows(ctx, filters), [ctx, filters]);
  const awaiting = useMemo(() => correctionsAwaitingMe(ctx), [ctx]);
  const awaitingIds = useMemo(() => new Set(awaiting.map((c) => c.id)), [awaiting]);
  const myAgreementIds = useMemo(() => new Set(awaiting.filter((c) => c.employeeId === me?.id && c.status === 'pending_employee').map((c) => c.id)), [awaiting, me?.id]);
  const reviewIds = useMemo(() => new Set(awaiting.filter((c) => c.employeeId !== me?.id).map((c) => c.id)), [awaiting, me?.id]);

  const counts = {
    mine: me ? allRows.filter((r) => r.c.employeeId === me.id).length : 0,
    review: allRows.filter((r) => reviewIds.has(r.c.id)).length,
    all: allRows.length,
  };

  const tabRows = allRows.filter((r) => (tab === 'mine' ? r.c.employeeId === me?.id : tab === 'review' ? reviewIds.has(r.c.id) : true));

  const { sort, onSort } = useSort('requestedAt');
  const getter = (r: CorrectionRow, col: string) => {
    switch (col) {
      case 'employee':
        return r.employee;
      case 'date':
        return r.c.date;
      case 'kind':
        return t(CORRECTION_KIND_LABEL[r.c.kind]);
      case 'initiated':
        return r.c.initiatedBy;
      case 'status':
        return t(CORRECTION_STATUS[r.c.status].label);
      case 'requestedAt':
        return r.c.requestedAt;
      case 'reviewer':
        return r.c.reviewerId ? r.reviewer : null;
      default:
        return null;
    }
  };
  const sorted = sortRows(tabRows, sort, getter);
  // Company proposals awaiting my agreement stay on top of "Mis solicitudes".
  const ordered = tab === 'mine' ? [...sorted.filter((r) => myAgreementIds.has(r.c.id)), ...sorted.filter((r) => !myAgreementIds.has(r.c.id))] : sorted;
  const paged = usePaged(ordered, 25);

  const tz = ctx.company.timezone;
  const myPending = me ? awaiting.filter((c) => myAgreementIds.has(c.id)).length : 0;

  const tabs = [
    { id: 'mine' as TabId, label: t(TAB_LABEL.mine), count: counts.mine, hidden: !shown.mine },
    { id: 'review' as TabId, label: t(TAB_LABEL.review), count: counts.review, hidden: !shown.review },
    { id: 'all' as TabId, label: t(TAB_LABEL.all), count: counts.all, hidden: !shown.all },
  ];

  const exportOwn = tab === 'mine' || !ctx.can('reports.export');
  const filterText = `${describeFilters(ctx, filters)} · ${TAB_LABEL[tab]}`;

  const actionLabel = (c: CorrectionRequest) => {
    if (myAgreementIds.has(c.id)) return t('Responder');
    if (awaitingIds.has(c.id)) return c.status === 'pending_employee' ? t('Decidir') : t('Revisar');
    return t('Ver');
  };

  const emptyTitle = tab === 'mine' ? t('No tiene solicitudes de corrección') : tab === 'review' ? t('No hay solicitudes pendientes de su revisión') : t('No hay solicitudes de corrección');

  return (
    <div className="stack-lg">
      <PageHeader
        title={t('Solicitudes de corrección')}
        subtitle={t('Los fichajes originales nunca se modifican: cada corrección conserva los valores original, solicitado y aprobado, quién la revisó, cuándo y por qué.')}
        actions={
          <>
            <ExportButton kind="correcciones" title={EXPORT_TITLE} rows={ordered} columns={CORRECTION_COLUMNS} filters={filterText} own={exportOwn} />
            {canCreate && (
              <Button variant="primary" icon={Plus} onClick={() => setFormOpen({ sessionId: null, failedId: null, employeeId: null, missing: false })}>
                {t('Nueva solicitud')}
              </Button>
            )}
          </>
        }
      />

      {myPending > 0 && (
        <Callout tone="warning" title={t('La empresa le propone {n} corrección(es) de su registro', { n: myPending })}>
          {t('Revise cada propuesta y dé su conformidad o deje constancia de su discrepancia. Mientras no responda, su registro no cambia.')}
        </Callout>
      )}

      <Tabs tabs={tabs} value={tab} onChange={(v) => { setParam({ vista: v }); paged.reset(); }} label={t('Vistas de solicitudes de corrección')} />

      <Card flush>
        <FilterBar value={filters} onChange={changeFilters} show={shown.all ? ['search', 'dates', 'employee', 'status'] : ['dates', 'status']} statusOptions={STATUS_OPTIONS} />
        {ordered.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={emptyTitle}
            action={
              canCreate && tab === 'mine' ? (
                <Button icon={Plus} onClick={() => setFormOpen({ sessionId: null, failedId: null, employeeId: null, missing: false })}>
                  {t('Nueva solicitud')}
                </Button>
              ) : undefined
            }
          >
            {filters.status || filters.from || filters.to || filters.search || filters.employeeId ? t('Ningún resultado con los filtros actuales.') : t('Cuando haya solicitudes aparecerán aquí con su estado y el historial de revisión.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table corr-table">
                <caption className="sr-only">{t('Solicitudes de corrección')}</caption>
                <thead>
                  <tr>
                    <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Fecha del registro')} col="date" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Tipo')} col="kind" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Iniciada por')} col="initiated" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <th>{t('Original → solicitado → aprobado')}</th>
                    <SortHeader label={t('Solicitada')} col="requestedAt" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Revisor')} col="reviewer" sort={sort} onSort={onSort} />
                    <th>
                      <span className="sr-only">{t('Acciones')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => {
                    const c = r.c;
                    const emp = db.employees.find((e) => e.id === c.employeeId);
                    const mineToAnswer = myAgreementIds.has(c.id);
                    const reqChanged = diffFields(c.original, c.requested).size > 0;
                    return (
                      <tr key={c.id} className={`clickable ${mineToAnswer ? 'corr-row-attention' : ''}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) navigate(`/correcciones/${c.id}`); }}>
                        <td>
                          <EmployeeLink id={c.employeeId} />
                          {emp && <div className="sub">{emp.code}</div>}
                        </td>
                        <td>
                          <DateText date={c.date} />
                        </td>
                        <td>{t(CORRECTION_KIND_LABEL[c.kind])}</td>
                        <td>
                          <InitiatedBadge c={c} onBehalf={isOnBehalf(c, emp?.userId)} compact />
                        </td>
                        <td>
                          <div className="status-stack">
                            <StatusBadge meta={CORRECTION_STATUS[c.status]} />
                            {mineToAnswer && <Badge tone="accent">{t('Espera su respuesta')}</Badge>}
                            {c.employeeResponse && !c.employeeResponse.agreed && c.status === 'pending_employee' && <Badge tone="danger">{t('Discrepancia')}</Badge>}
                          </div>
                        </td>
                        <td>
                          <div className="corr-spans">
                            <div>
                              <span className="corr-span-label">{t('Original')}</span> {c.original ? <SpanSummary values={c.original} tz={tz} /> : <span className="muted tiny">{t('sin registro')}</span>}
                            </div>
                            <div className={reqChanged ? 'corr-span-changed' : ''}>
                              <span className="corr-span-label">{t('Solicitado')}</span> <SpanSummary values={c.requested} tz={tz} />
                            </div>
                            <div>
                              <span className="corr-span-label">{t('Aprobado')}</span> {c.approved ? <SpanSummary values={c.approved} tz={tz} /> : <span className="muted tiny">—</span>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <DateTimeText at={c.requestedAt} tz={tz} />
                          <div className="sub">{userName(db, c.requestedBy)}</div>
                        </td>
                        <td>{c.reviewerId ? r.reviewer : <span className="muted">—</span>}</td>
                        <td>
                          <Link to={`/correcciones/${c.id}`} className={`btn sm ${awaitingIds.has(c.id) ? 'primary' : ''}`} aria-label={`${actionLabel(c)}: ${r.employee}, ${c.date}`}>
                            {actionLabel(c)}
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

      <Callout tone="neutral" title={t('Cómo funciona')}>
        <ul>
          <li>{t('El empleado solicita la corrección con una explicación; la revisa su supervisor o RR. HH. Nadie puede revisar sus propias solicitudes.')}</li>
          <li>{t('Si se aprueba, los valores aprobados se aplican como una capa sobre los fichajes originales, que se conservan. El resultado se notifica al empleado.')}</li>
          <li>{t('Las correcciones propuestas por la empresa requieren la conformidad del empleado o dejan constancia de su discrepancia (diseño preparado para el proyecto de reglamento, pendiente de aprobación).')}</li>
        </ul>
      </Callout>

      {form && (
        <NewCorrectionDialog
          key={`${form.sessionId}-${form.failedId}-${form.employeeId}-${form.missing}`}
          initial={form}
          onClose={closeForm}
          onCreated={(c) => {
            setFormOpen(null);
            navigate(`/correcciones/${c.id}`, { replace: !!urlForm });
          }}
        />
      )}
    </div>
  );
}
