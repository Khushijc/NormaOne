/**
 * Informes y exportaciones (PRL-08, PLT-06, NFR-10).
 *
 * The report list comes from `availableReports(ctx)` and every preview is built by
 * `runReport(ctx, id, filters)` from the caller's permitted scope: the screen never decides what a
 * role may see. Exports are rebuilt by the service (never taken from this table), carry metadata
 * and the declared open items, and are recorded in the audit log.
 */
import { AlertTriangle, EyeOff, FileBarChart, Lock, Printer, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ReadinessDisclaimer, scopeLabel } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, Pagination, SelectField, SortHeader, describeError, sortRows, usePaged, useSort } from '../../components/ui';
import { CATEGORY_LABEL, ITEM_STATUS, READINESS, READINESS_ORDER } from '../../domain/status';
import { formatDate } from '../../domain/time';
import type { RequirementCategory } from '../../domain/types';
import { t } from '../../i18n';
import { visibleCases } from '../../services/caeService';
import { employeeName, visibleEmployeeIds, visibleWorksiteIds } from '../../services/context';
import { availableReports, EMPTY_FILTERS, runReport, type Filters, type ReportDef, type ReportResult, type Row } from '../../services/reportService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { ExportHistory } from './ExportHistory';

type FilterKey = 'worksite' | 'department' | 'employee' | 'category' | 'itemStatus' | 'readinessStatus' | 'case';

/** Filters each report's builder actually applies (others would be silently ignored). */
const REPORT_FILTERS: Record<string, FilterKey[]> = {
  employee_evidence: ['worksite', 'department', 'employee', 'category', 'itemStatus'],
  missing: ['worksite', 'department', 'employee', 'category', 'itemStatus'],
  worksite_summary: ['worksite'],
  role_matrix: [],
  awaiting_review: ['worksite', 'employee'],
  dates: ['employee'],
  training: ['worksite', 'department', 'employee'],
  ppe: ['worksite', 'department', 'employee'],
  actions: ['worksite'],
  assessments: ['worksite'],
  cae_package: ['case'],
  readiness: ['worksite', 'department', 'employee', 'readinessStatus'],
  audit: ['employee'],
  health: ['worksite', 'department', 'employee'],
};

/** Mirrors the export rule of `createExport` so the button is only offered when it can work. */
function exportMode(ctx: UiCtx, def: ReportDef): 'full' | 'own' | 'none' {
  if (ctx.can('reports.export')) return 'full';
  if (ctx.can('representative.view') && ['worksite_summary', 'actions', 'assessments'].includes(def.id)) return 'full';
  if (def.restricted && ctx.can('health.manage')) return 'full';
  if (def.id === 'employee_evidence' && ctx.can('own.view') && ctx.employee) return 'own';
  return 'none';
}

const cellText = (v: string | number | undefined) => (v === undefined || v === '' ? '—' : typeof v === 'number' ? String(v) : t(v));

export function ReportsPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const reports = useMemo(() => availableReports(ctx), [ctx]);
  const requested = params.get('informe');
  const def = reports.find((r) => r.id === requested) ?? reports[0];
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [printing, setPrinting] = useState(false);

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('informe', id);
    setParams(next, { replace: true });
    setFilters(EMPTY_FILTERS);
  };

  const outcome = useMemo((): { result: ReportResult | null; error: { title: string; details: string[] } | null } => {
    if (!def) return { result: null, error: null };
    try {
      return { result: runReport(ctx, def.id, filters), error: null };
    } catch (e) {
      return { result: null, error: describeError(e) };
    }
  }, [ctx, def, filters]);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const timer = window.setTimeout(() => {
      window.print();
      // Some browsers do not fire afterprint for a cancelled dialog.
      window.setTimeout(done, 500);
    }, 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  if (!def) {
    return (
      <>
        <PageHeader title={t('Informes y exportaciones')} />
        <Card>
          <EmptyState icon={FileBarChart} title={t('No hay informes disponibles para su rol')}>
            {t('Los informes se ofrecen según los permisos de su rol en la empresa activa.')}
          </EmptyState>
        </Card>
      </>
    );
  }

  const mode = exportMode(ctx, def);

  return (
    <>
      <PageHeader
        title={t('Informes y exportaciones')}
        subtitle={t('Vistas operativas de la evidencia registrada en {company}, limitadas a lo que su rol puede ver. No certifican el cumplimiento legal ni la seguridad de ningún puesto o centro.', { company: ctx.company.tradeName })}
      />
      <div className="stack">
        <div className="control-reports">
          <nav className="control-report-picker no-print" aria-label={t('Seleccione un informe')}>
            {reports.map((r) => {
              const active = r.id === def.id;
              return (
                <button key={r.id} type="button" className="control-report-card" aria-pressed={active} onClick={() => select(r.id)}>
                  <span className="control-report-title">
                    {r.restricted ? <Lock size={14} aria-hidden /> : <FileBarChart size={14} aria-hidden />}
                    <span>{t(r.title)}</span>
                  </span>
                  <span className="tiny muted">{t(r.description)}</span>
                  {r.restricted && (
                    <span>
                      <Badge tone="danger" icon={Lock}>{t('Informe restringido')}</Badge>
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="stack control-report-main">
            <ReportPreview
              key={def.id}
              def={def}
              filters={filters}
              setFilters={setFilters}
              result={outcome.result}
              error={outcome.error}
              mode={mode}
              printing={printing}
              onPrint={() => setPrinting(true)}
            />
            <PrivacyNotes />
          </div>
        </div>
        <div className="no-print">
          <ExportHistory />
        </div>
      </div>
    </>
  );
}

function ReportPreview({
  def,
  filters,
  setFilters,
  result,
  error,
  mode,
  printing,
  onPrint,
}: {
  def: ReportDef;
  filters: Filters;
  setFilters: (f: Filters) => void;
  result: ReportResult | null;
  error: { title: string; details: string[] } | null;
  mode: 'full' | 'own' | 'none';
  printing: boolean;
  onPrint: () => void;
}) {
  const ctx = useCtx();
  const keys = REPORT_FILTERS[def.id] ?? ['worksite', 'department', 'employee'];
  const { sort, onSort } = useSort('', 'asc');
  const rows = useMemo(() => (result ? sortRows(result.rows, sort, (r: Row, c: string) => r[c]) : []), [result, sort]);
  const paged = usePaged(rows, 25);
  const shown = printing ? rows : paged.rows;
  const needsCase = !!def.needsCase && !filters.caseId;
  const set = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    paged.reset();
  };
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <Card
      flush
      className="control-report-card-main"
      title={
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 className="row-wrap">
            {t(def.title)}
            {def.restricted && <Badge tone="danger" icon={Lock}>{t('Informe restringido')}</Badge>}
          </h2>
          <span className="tiny muted">{t(def.description)}</span>
        </div>
      }
      actions={
        <span className="row-wrap no-print">
          <Button icon={Printer} onClick={onPrint} disabled={!result || result.rows.length === 0}>
            {t('Imprimir')}
          </Button>
          {mode !== 'none' && <ExportButton reportId={def.id} filters={filters} disabled={!result || needsCase} />}
        </span>
      }
    >
      {keys.length > 0 && <ReportFilters keys={keys} filters={filters} set={set} clear={anyFilter ? () => { setFilters(EMPTY_FILTERS); paged.reset(); } : undefined} />}

      {mode === 'own' && (
        <div className="control-pad no-print">
          <Callout tone="info">{t('Su rol solo permite exportar su propio resumen de evidencias: el archivo incluirá únicamente sus registros, aunque la vista previa muestre más.')}</Callout>
        </div>
      )}
      {mode === 'none' && (
        <div className="control-pad no-print">
          <p className="tiny muted">{t('Su rol puede consultar este informe, pero no exportarlo.')}</p>
        </div>
      )}

      {error ? (
        <div className="control-pad">
          <Callout tone="danger" title={error.title}>
            {error.details.join(' ')}
          </Callout>
        </div>
      ) : needsCase ? (
        <EmptyState icon={FileBarChart} title={t('Seleccione un caso CAE')}>
          {t('El paquete de coordinación se prepara para un caso concreto y solo incluye la evidencia aceptada y relevante para su centro.')}
        </EmptyState>
      ) : result ? (
        <>
          <div className="control-report-meta">
            <span className="small">
              <span className="strong">{t('Ámbito [informe]')}:</span> {scopeLabel(result.scope) || t('Sin filtros (todo el ámbito permitido)')}
            </span>
            <span className="row-wrap">
              <Badge tone="neutral" icon={false}>{t('{n} registros', { n: result.rows.length })}</Badge>
              {result.unresolved > 0 ? (
                <Badge tone="warning" icon={AlertTriangle}>{t('{n} elementos pendientes declarados', { n: result.unresolved })}</Badge>
              ) : (
                <Badge tone="success" icon={ShieldCheck}>{t('Sin elementos pendientes declarados')}</Badge>
              )}
              {result.redacted && (
                <Badge tone="accent" icon={EyeOff} title={t('Se han omitido o enmascarado datos que su rol o el destinatario no pueden recibir.')}>
                  {t('Redactado')}
                </Badge>
              )}
            </span>
          </div>
          {(def.id === 'readiness' || def.id === 'worksite_summary') && (
            <div className="control-pad">
              <ReadinessDisclaimer />
            </div>
          )}
          {result.rows.length === 0 ? (
            <EmptyState icon={FileBarChart} title={anyFilter ? t('Ningún registro coincide con los filtros') : t('El informe no tiene registros en su ámbito')}>
              {t('Un informe vacío no significa que no haya obligaciones: solo refleja los datos registrados y su ámbito de acceso.')}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap control-report-table">
                <table className="table">
                  <caption className="sr-only">{t(def.title)}</caption>
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <SortHeader key={c.key} label={t(c.label)} col={c.key} sort={sort} onSort={onSort} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i}>
                        {result.columns.map((c) => (
                          <td key={c.key} className={typeof r[c.key] === 'number' ? 'num small' : 'small'}>
                            {cellText(r[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="no-print">
                <Pagination {...paged.props} />
              </div>
            </>
          )}
          <p className="tiny muted control-pad control-print-only">
            {t('Generado por {user} · {company} · {date}. Vista impresa: no se registra como exportación.', { user: ctx.user.name, company: ctx.company.legalName, date: formatDate(ctx.today) })}
          </p>
        </>
      ) : null}
    </Card>
  );
}

function ReportFilters({ keys, filters, set, clear }: { keys: FilterKey[]; filters: Filters; set: (p: Partial<Filters>) => void; clear?: () => void }) {
  const ctx = useCtx();
  const worksites = useMemo(() => {
    const ids = visibleWorksiteIds(ctx);
    return ctx.db.worksites.filter((w) => ids.has(w.id)).sort((a, b) => a.code.localeCompare(b.code));
  }, [ctx]);
  const employees = useMemo(
    () =>
      [...visibleEmployeeIds(ctx)]
        .filter((id) => ctx.db.employees.find((e) => e.id === id)?.status === 'active')
        .map((id) => ({ id, name: employeeName(ctx.db, id) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [ctx],
  );
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);
  const cases = useMemo(() => visibleCases(ctx), [ctx]);
  const show = (k: FilterKey) => keys.includes(k);

  return (
    <div className="toolbar no-print" role="search" aria-label={t('Filtros del informe')}>
      {show('case') && (
        <SelectField label={t('Caso CAE')} value={filters.caseId} onChange={(e) => set({ caseId: e.target.value })}>
          <option value="">{t('Seleccione… [opción]')}</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.title}
            </option>
          ))}
        </SelectField>
      )}
      {show('worksite') && worksites.length > 1 && (
        <SelectField label={t('Centro')} value={filters.worksiteId} onChange={(e) => set({ worksiteId: e.target.value })}>
          <option value="">{t('Todos')}</option>
          {worksites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {w.name}
            </option>
          ))}
        </SelectField>
      )}
      {show('department') && departments.length > 1 && employees.length > 1 && (
        <SelectField label={t('Departamento')} value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
          <option value="">{t('Todos')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
      )}
      {show('employee') && employees.length > 1 && (
        <SelectField label={t('Empleado')} value={filters.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
          <option value="">{t('Todos')}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </SelectField>
      )}
      {show('category') && (
        <SelectField label={t('Categoría del requisito')} value={filters.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">{t('Todas')}</option>
          {(Object.keys(CATEGORY_LABEL) as RequirementCategory[]).map((k) => (
            <option key={k} value={k}>
              {t(CATEGORY_LABEL[k])}
            </option>
          ))}
        </SelectField>
      )}
      {show('itemStatus') && (
        <SelectField label={t('Estado del requisito')} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">{t('Todos')}</option>
          {(Object.keys(ITEM_STATUS) as (keyof typeof ITEM_STATUS)[]).map((k) => (
            <option key={k} value={k}>
              {t(ITEM_STATUS[k].label)}
            </option>
          ))}
        </SelectField>
      )}
      {show('readinessStatus') && (
        <SelectField label={t('Disponibilidad')} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">{t('Todas')}</option>
          {READINESS_ORDER.map((k) => (
            <option key={k} value={k}>
              {t(READINESS[k].label)}
            </option>
          ))}
        </SelectField>
      )}
      {clear && (
        <Button variant="ghost" onClick={clear}>
          {t('Limpiar filtros')}
        </Button>
      )}
    </div>
  );
}

function PrivacyNotes() {
  return (
    <Card title={t('Privacidad de los informes y exportaciones')} className="no-print">
      <ul className="control-list small">
        <li>{t('Cada informe se calcula con el ámbito de su rol: no incluye empleados, centros ni documentos que usted no pueda ver.')}</li>
        <li>{t('Los datos de salud y los documentos restringidos se excluyen o se enmascaran en los informes generales. Nunca se incluyen informes ni historias clínicas.')}</li>
        <li>{t('El informe de conclusiones de aptitud solo está disponible para personal autorizado y contiene la conclusión mínima, sin datos clínicos.')}</li>
        <li>{t('El paquete CAE incluye solo evidencia aceptada y relevante para el centro del caso; se excluyen documentos personales, restringidos, de salud y no aceptados.')}</li>
        <li>{t('Las personas empleadas solo pueden exportar su propio resumen de evidencias; la representación de los trabajadores, solo informes agregados.')}</li>
        <li>{t('Los elementos pendientes se mantienen visibles y se declaran en los metadatos del archivo, junto con el destinatario, el ámbito y la fecha de generación. Cada exportación queda en la auditoría.')}</li>
      </ul>
    </Card>
  );
}
