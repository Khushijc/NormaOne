/**
 * Informes y exportaciones (spec §14, TIM-06, TIM-08, R03, R30).
 *
 * Every report is computed by the report service within the caller's scope and rendered from
 * the same column definitions the export uses, so the on-screen table is exactly what is
 * exported. Exports disclose unresolved exceptions in their metadata and are not payroll.
 */
import {
  BarChart3,
  CalendarCheck,
  ClipboardList,
  FileClock,
  FileSpreadsheet,
  Files,
  ListChecks,
  Lock,
  PlaneTakeoff,
  ShieldAlert,
  Timer,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DurationText } from '../components/bits';
import { GroupedBarChart } from '../components/charts';
import { ExportButton } from '../components/ExportButton';
import { FilterBar } from '../components/FilterBar';
import { Badge, Callout, Card, DateTimeText, EmptyState, KV, PageHeader, Pagination, usePaged } from '../components/ui';
import { CORRECTION_STATUS, RECORD_STATUS } from '../domain/status';
import { addMonths, formatMonth, nowInstant, startOfMonth, toHours } from '../domain/time';
import { t, tKey } from '../i18n';
import { employeeName, timeScope, userName } from '../services/context';
import {
  ABSENCE_COLUMNS,
  CORRECTION_COLUMNS,
  EMPTY_FILTERS,
  EXCEPTION_COLUMNS,
  PLAN_COLUMNS,
  RECORD_COLUMNS,
  SUMMARY_COLUMNS,
  absenceRows,
  correctionRows,
  describeFilters,
  exceptionRows,
  partTimeEmployees,
  partTimeSummary,
  periodRange,
  planVsActualRows,
  recordRows,
  summaryRows,
  type Column,
  type Filters,
  type PartTimeDay,
} from '../services/reportService';
import { useCtx, type UiCtx } from '../store/hooks';
import { PeriodCloseReport } from './control/PeriodClose';
import { ColumnTable, formatHours, useSortedRows } from './control/ReportTable';

type ReportId = 'registros' | 'resumen' | 'empleado' | 'parcial' | 'ausencias' | 'pendientes' | 'correcciones' | 'incidencias' | 'plan' | 'cierre';

interface ReportDef {
  id: ReportId;
  /** Spanish title: shown with t() and written untranslated into the export metadata. */
  title: string;
  description: string;
  icon: LucideIcon;
  available: (ctx: UiCtx, a: Access) => boolean;
}

interface Access {
  representative: boolean;
  employeeOnly: boolean;
  manager: boolean;
  ownPartTime: boolean;
}

const REPORTS: ReportDef[] = [
  { id: 'registros', title: tKey('Registros diarios'), description: tKey('Entradas, salidas, pausas y tiempo neto por día.'), icon: FileClock, available: (_c, a) => a.manager || a.representative || a.employeeOnly },
  { id: 'resumen', title: tKey('Resumen mensual por empleado'), description: tKey('Totales del mes, incompletos, correcciones e incidencias.'), icon: BarChart3, available: (_c, a) => a.manager || a.representative },
  { id: 'empleado', title: tKey('Registros de un empleado'), description: tKey('Todos los registros de una persona en un rango de fechas.'), icon: UserRound, available: (_c, a) => a.manager },
  { id: 'parcial', title: tKey('Resumen mensual tiempo parcial'), description: tKey('Día a día y total mensual (ET art. 12.4.c).'), icon: Timer, available: (_c, a) => a.manager || (a.employeeOnly && a.ownPartTime) },
  { id: 'ausencias', title: tKey('Ausencias aprobadas'), description: tKey('Ausencias aprobadas en el rango de fechas.'), icon: PlaneTakeoff, available: (c, a) => a.manager && !a.representative && (c.can('absences.view_all') || c.can('absences.review_team')) },
  { id: 'pendientes', title: tKey('Solicitudes de ausencia pendientes'), description: tKey('Pendientes de decisión o de cancelación.'), icon: ClipboardList, available: (c, a) => a.manager && !a.representative && (c.can('absences.view_all') || c.can('absences.review_team')) },
  { id: 'correcciones', title: tKey('Correcciones y decisiones'), description: tKey('Valores original, solicitado y aprobado, con revisor y motivo.'), icon: ListChecks, available: (_c, a) => a.manager },
  { id: 'incidencias', title: tKey('Incidencias sin resolver'), description: tKey('Solicitudes de revisión abiertas.'), icon: ShieldAlert, available: (c, a) => a.manager && (c.can('anomalies.view_all') || c.can('anomalies.manage_team')) },
  { id: 'plan', title: tKey('Planificado vs registrado'), description: tKey('Diferencias como indicadores de revisión.'), icon: CalendarCheck, available: (_c, a) => a.manager },
  { id: 'cierre', title: tKey('Estado de cierre de periodos'), description: tKey('Elementos abiertos, cierre y reapertura.'), icon: Lock, available: (c) => c.can('reports.all') },
];

const RECORD_STATUS_OPTIONS = Object.entries(RECORD_STATUS).map(([value, m]) => ({ value, label: m.label }));
const CORRECTION_STATUS_OPTIONS = Object.entries(CORRECTION_STATUS).map(([value, m]) => ({ value, label: m.label }));

const PART_COLUMNS: Column<PartTimeDay>[] = [
  { key: 'fecha', label: 'Fecha', value: (d) => d.date },
  { key: 'sesiones', label: 'Sesiones registradas', value: (d) => d.sessions },
  { key: 'neto_h', label: 'Registrado neto (h)', value: (d) => toHours(d.netMinutes), hours: true },
  { key: 'planificado_h', label: 'Planificado (h, referencia)', value: (d) => toHours(d.plannedMinutes), hours: true },
  { key: 'incompleto', label: 'Registro incompleto o abierto', value: (d) => (d.incomplete ? 'sí' : 'no') },
];

function access(ctx: UiCtx): Access {
  const representative = timeScope(ctx) === 'representative';
  const manager = ctx.can('reports.team') || ctx.can('reports.all');
  const employeeOnly = ctx.can('reports.own') && !manager && !representative;
  const period = ctx.today.slice(0, 7);
  const ownPartTime = !!ctx.employee && partTimeEmployees(ctx, period).includes(ctx.employee.id);
  return { representative, employeeOnly, manager, ownPartTime };
}

function lastMonths(today: string, n = 12): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(startOfMonth(today), -i).slice(0, 7));
}

export function ReportsPage() {
  const ctx = useCtx();
  const acc = useMemo(() => access(ctx), [ctx]);
  const available = REPORTS.filter((r) => r.available(ctx, acc));
  const [params, setParams] = useSearchParams();
  const requested = params.get('informe') as ReportId | null;
  const current = available.find((r) => r.id === requested) ?? available[0] ?? null;
  const select = (id: ReportId) => {
    const next = new URLSearchParams(params);
    next.set('informe', id);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('Informes y exportaciones')}
        subtitle={acc.employeeOnly ? t('Sus propios registros y resúmenes, para consultar y descargar.') : t('Informes dentro de su ámbito. Lo que ve en pantalla es exactamente lo que se exporta.')}
      />
      <div className="stack">
        {acc.representative && (
          <Callout tone="info" title={t('Acceso minimizado de la representación legal')}>
            {t('Solo registros horarios y resúmenes (ET art. 34.9), sin datos de contacto ni motivos de ausencia. Las exportaciones omiten las columnas personales y quedan marcadas como minimizadas.')}
          </Callout>
        )}
        {acc.employeeOnly && <Callout tone="info">{t('Solo se muestran sus propios datos y la exportación incluye únicamente sus registros.')}</Callout>}
        <Callout tone="neutral" icon={FileSpreadsheet} title={t('Exportar no es calcular la nómina')}>
          {t('Cada exportación declara en sus metadatos las incidencias sin resolver y las correcciones pendientes, y queda registrada en la auditoría. Las horas se exportan en decimal; su clasificación (ordinarias, extraordinarias, complementarias) corresponde a la asesoría laboral.')}
        </Callout>
        {available.length === 0 || !current ? (
          <Card>
            <EmptyState title={t('No hay informes disponibles para su rol')} />
          </Card>
        ) : (
          <>
            <nav aria-label={t('Seleccione un informe')} className="control-report-picker">
              {available.map((r) => {
                const Icon = r.icon;
                const active = r.id === current.id;
                return (
                  <button key={r.id} type="button" className="control-report-card" aria-pressed={active} onClick={() => select(r.id)}>
                    <span className="row strong"><Icon size={16} aria-hidden /> {t(r.title)}</span>
                    <span className="tiny muted">{t(r.description)}</span>
                  </button>
                );
              })}
            </nav>
            <ReportView key={current.id} def={current} acc={acc} />
          </>
        )}
        {ctx.can('reports.all') && !acc.representative && <RecentExports />}
      </div>
    </>
  );
}

function ReportView({ def, acc }: { def: ReportDef; acc: Access }) {
  switch (def.id) {
    case 'registros':
      return <RecordsReport def={def} acc={acc} />;
    case 'resumen':
      return <SummaryReport def={def} acc={acc} />;
    case 'empleado':
      return <EmployeeReport def={def} />;
    case 'parcial':
      return <PartTimeReport def={def} acc={acc} />;
    case 'ausencias':
      return <AbsenceReport def={def} pending={false} />;
    case 'pendientes':
      return <AbsenceReport def={def} pending />;
    case 'correcciones':
      return <CorrectionsReport def={def} />;
    case 'incidencias':
      return <ExceptionsReport def={def} />;
    case 'plan':
      return <PlanReport def={def} />;
    case 'cierre':
      return (
        <Card title={t(def.title)}>
          <PeriodCloseReport />
        </Card>
      );
  }
}

/** Card frame shared by the reports: filters, row count + export, then the table. */
function ReportFrame({ def, filters, count, exportButton, notes, children }: { def: ReportDef; filters?: ReactNode; count: number; exportButton: ReactNode; notes?: ReactNode; children: ReactNode }) {
  return (
    <Card
      flush
      title={
        <div>
          <h2>{t(def.title)}</h2>
          <div className="tiny muted">{t(def.description)}</div>
        </div>
      }
      actions={
        <>
          <span className="small muted">{t('{n} filas', { n: count })}</span>
          {exportButton}
        </>
      }
    >
      {filters}
      {notes && <div className="control-report-notes">{notes}</div>}
      {children}
    </Card>
  );
}

function PeriodSelect({ value, onChange, id }: { value: string; onChange: (p: string) => void; id: string }) {
  const ctx = useCtx();
  return (
    <div className="field">
      <label htmlFor={id}>{t('Periodo')}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {lastMonths(ctx.today).map((p) => <option key={p} value={p}>{formatMonth(p)}</option>)}
      </select>
    </div>
  );
}

// ─────────────────────────────── Reports ───────────────────────────────

function RecordsReport({ def, acc }: { def: ReportDef; acc: Access }) {
  const ctx = useCtx();
  const [f, setF] = useState<Filters>({ ...EMPTY_FILTERS, from: startOfMonth(ctx.today), to: ctx.today });
  const rows = useMemo(() => recordRows(ctx, f), [ctx, f]);
  const columns = useMemo(() => (acc.representative ? RECORD_COLUMNS.filter((c) => !c.personal) : RECORD_COLUMNS), [acc.representative]);
  const { sorted, sort, onSort } = useSortedRows(rows, columns);
  return (
    <ReportFrame
      def={def}
      count={rows.length}
      filters={<FilterBar value={f} onChange={setF} show={acc.employeeOnly ? ['dates', 'worksite', 'status'] : ['search', 'dates', 'department', 'worksite', 'employee', 'status']} statusOptions={RECORD_STATUS_OPTIONS} />}
      exportButton={<ExportButton kind="registros" title={def.title} rows={sorted} columns={columns} filters={describeFilters(ctx, f)} own={acc.employeeOnly} />}
      notes={<span className="tiny muted">{t('Horas locales del centro de trabajo; la zona horaria y los instantes UTC se incluyen en cada fila. «(+1)» indica una salida al día siguiente.')}</span>}
    >
      <ColumnTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.session.id}
        sort={sort}
        onSort={onSort}
        translate={['estado', 'provisional', 'corregido']}
        link={{ key: 'fecha', to: (r) => `/registros/${r.session.id}` }}
        caption={t(def.title)}
        emptyTitle={t('No hay registros con estos filtros')}
        emptyText={t('Amplíe el rango de fechas o limpie los filtros.')}
      />
    </ReportFrame>
  );
}

function SummaryReport({ def, acc }: { def: ReportDef; acc: Access }) {
  const ctx = useCtx();
  const [period, setPeriod] = useState(ctx.today.slice(0, 7));
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const rows = useMemo(() => summaryRows(ctx, period, f), [ctx, period, f]);
  const columns = useMemo(() => (acc.representative ? SUMMARY_COLUMNS.filter((c) => !c.personal) : SUMMARY_COLUMNS), [acc.representative]);
  const { sorted, sort, onSort } = useSortedRows(rows, columns);
  return (
    <ReportFrame
      def={def}
      count={rows.length}
      filters={
        <div className="control-filter-stack">
          <div className="toolbar">
            <PeriodSelect id="rp-sum-period" value={period} onChange={setPeriod} />
          </div>
          <FilterBar value={f} onChange={setF} show={['search', 'department', 'employee']} />
        </div>
      }
      exportButton={<ExportButton kind="resumen_mensual" title={def.title} rows={sorted} columns={columns} filters={describeFilters(ctx, f)} period={period} />}
      notes={<span className="tiny muted">{t('El tiempo planificado es solo una referencia: la diferencia es un indicador de revisión, no horas extraordinarias. Los totales solo suman sesiones cerradas.')}</span>}
    >
      <ColumnTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.employeeId}
        sort={sort}
        onSort={onSort}
        translate={['jornada']}
        caption={t(def.title)}
        emptyTitle={t('No hay empleados con estos filtros')}
      />
    </ReportFrame>
  );
}

function EmployeeReport({ def }: { def: ReportDef }) {
  const ctx = useCtx();
  const [f, setF] = useState<Filters>({ ...EMPTY_FILTERS, from: startOfMonth(addMonths(ctx.today, -1)), to: ctx.today });
  const rows = useMemo(() => (f.employeeId ? recordRows(ctx, f) : []), [ctx, f]);
  const { sorted, sort, onSort } = useSortedRows(rows, RECORD_COLUMNS);
  const title = f.employeeId ? `${def.title} · ${employeeName(ctx.db, f.employeeId)}` : def.title;
  return (
    <ReportFrame
      def={def}
      count={rows.length}
      filters={<FilterBar value={f} onChange={setF} show={['dates', 'employee', 'worksite', 'status']} statusOptions={RECORD_STATUS_OPTIONS} />}
      exportButton={<ExportButton kind="registros_empleado" title={title} rows={sorted} columns={RECORD_COLUMNS} filters={describeFilters(ctx, f)} disabled={!f.employeeId} />}
    >
      {!f.employeeId ? (
        <EmptyState icon={UserRound} title={t('Seleccione un empleado')}>{t('Elija la persona en el filtro «Empleado» para ver y exportar sus registros.')}</EmptyState>
      ) : (
        <ColumnTable
          rows={sorted}
          columns={RECORD_COLUMNS}
          rowKey={(r) => r.session.id}
          sort={sort}
          onSort={onSort}
          translate={['estado', 'provisional', 'corregido']}
          link={{ key: 'fecha', to: (r) => `/registros/${r.session.id}` }}
          caption={t(def.title)}
          emptyTitle={t('No hay registros con estos filtros')}
          emptyText={t('Amplíe el rango de fechas o limpie los filtros.')}
        />
      )}
    </ReportFrame>
  );
}

function PartTimeReport({ def, acc }: { def: ReportDef; acc: Access }) {
  const ctx = useCtx();
  const [period, setPeriod] = useState(ctx.today.slice(0, 7));
  const candidates = useMemo(() => {
    const ids = partTimeEmployees(ctx, period);
    return acc.employeeOnly ? ids.filter((id) => id === ctx.employee?.id) : ids;
  }, [ctx, period, acc.employeeOnly]);
  const [chosen, setChosen] = useState<string>('');
  const employeeId = candidates.includes(chosen) ? chosen : candidates[0] ?? '';
  const summary = useMemo(() => (employeeId ? partTimeSummary(ctx, employeeId, period, nowInstant()) : null), [ctx, employeeId, period]);
  const days = summary?.days ?? [];
  const { sorted, sort, onSort } = useSortedRows(days, PART_COLUMNS);
  const { from, to } = periodRange(period);
  const exportTitle = summary ? `${def.title} · ${summary.employee}` : def.title;
  const exportFilters = summary ? `empleado ${summary.employee} · versión ${summary.version} · total ${formatHours(toHours(summary.totalNetMinutes))} h` : 'Sin filtros';
  return (
    <ReportFrame
      def={def}
      count={days.length}
      filters={
        <div className="toolbar">
          <PeriodSelect id="rp-pt-period" value={period} onChange={setPeriod} />
          {!acc.employeeOnly && (
            <div className="field">
              <label htmlFor="rp-pt-emp">{t('Empleado a tiempo parcial')}</label>
              <select id="rp-pt-emp" className="select" value={employeeId} onChange={(e) => setChosen(e.target.value)}>
                {candidates.map((id) => <option key={id} value={id}>{employeeName(ctx.db, id)}</option>)}
              </select>
            </div>
          )}
        </div>
      }
      exportButton={<ExportButton kind="resumen_tiempo_parcial" title={exportTitle} rows={sorted} columns={PART_COLUMNS} filters={exportFilters} period={period} own={acc.employeeOnly} disabled={!summary} />}
    >
      {!summary ? (
        <EmptyState icon={Timer} title={t('No hay empleados a tiempo parcial en este periodo')} />
      ) : (
        <div className="stack control-pad">
          <div className="grid-2">
            <KV
              items={[
                [t('Empleado'), summary.employee],
                [t('Periodo'), formatMonth(summary.period)],
                [t('Jornada contratada'), summary.weeklyHours !== null ? t('{h} h semanales ({pct} %)', { h: summary.weeklyHours, pct: summary.partTimePct ?? '—' }) : '—'],
                [t('Total mensual registrado (neto)'), <span key="tot" className="strong"><DurationText minutes={summary.totalNetMinutes} /> · {formatHours(toHours(summary.totalNetMinutes))} h</span>],
              ]}
            />
            <KV
              items={[
                [t('Versión del resumen'), <code key="v">{summary.version}</code>],
                [t('Generado el'), <DateTimeText key="g" at={summary.generatedAt} tz={ctx.company.timezone} />],
                [
                  t('Incidencias abiertas del mes'),
                  summary.openExceptions > 0 ? (
                    <Badge key="ex" tone="warning">{acc.manager ? <Link to={`/incidencias?empleado=${summary.employeeId}&desde=${from}&hasta=${to}`}>{summary.openExceptions}</Link> : summary.openExceptions}</Badge>
                  ) : (
                    <Badge key="ex" tone="success">0</Badge>
                  ),
                ],
              ]}
            />
          </div>
          <Callout tone="info" title={t('Registro día a día con total mensual (ET art. 12.4.c)')}>
            <div className="stack-sm">
              <span>{t(summary.classificationNote)}</span>
              <span className="small">{t('La versión cambia si cambia cualquier registro del mes. Entregue una copia con la nómina y consérvela al menos cuatro años.')}</span>
              {summary.openExceptions > 0 && <span className="small strong">{t('Hay incidencias abiertas en el mes: el resumen las declara y puede cambiar cuando se resuelvan.')}</span>}
            </div>
          </Callout>
        </div>
      )}
      {summary && (
        <ColumnTable
          rows={sorted}
          columns={PART_COLUMNS}
          rowKey={(d) => d.date}
          sort={sort}
          onSort={onSort}
          translate={['incompleto']}
          pageSize={50}
          caption={t(def.title)}
          emptyTitle={t('Sin días en el periodo')}
          footer={
            <tr>
              <td>{t('Total mensual')}</td>
              <td className="num">{days.reduce((a, d) => a + d.sessions, 0)}</td>
              <td className="num">{formatHours(toHours(summary.totalNetMinutes))}</td>
              <td className="num">{formatHours(toHours(days.reduce((a, d) => a + d.plannedMinutes, 0)))}</td>
              <td>{days.filter((d) => d.incomplete).length}</td>
            </tr>
          }
        />
      )}
    </ReportFrame>
  );
}

function AbsenceReport({ def, pending }: { def: ReportDef; pending: boolean }) {
  const ctx = useCtx();
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const rows = useMemo(() => absenceRows(ctx, pending ? f : { ...f, status: 'approved' }, pending), [ctx, f, pending]);
  const { sorted, sort, onSort } = useSortedRows(rows, ABSENCE_COLUMNS);
  return (
    <ReportFrame
      def={def}
      count={rows.length}
      filters={<FilterBar value={f} onChange={setF} show={['search', 'dates', 'department', 'employee']} />}
      exportButton={<ExportButton kind={pending ? 'ausencias_pendientes' : 'ausencias_aprobadas'} title={def.title} rows={sorted} columns={ABSENCE_COLUMNS} filters={describeFilters(ctx, f)} />}
      notes={<span className="tiny muted">{t('Una ausencia aprobada nunca genera tiempo trabajado. Las categorías reservadas se muestran sin detalle a quien no puede verlo.')}</span>}
    >
      <ColumnTable
        rows={sorted}
        columns={ABSENCE_COLUMNS}
        rowKey={(r) => r.id}
        sort={sort}
        onSort={onSort}
        translate={['tipo', 'estado']}
        link={{ key: 'desde', to: (r) => `/ausencias/${r.id}` }}
        caption={t(def.title)}
        emptyTitle={pending ? t('No hay solicitudes pendientes') : t('No hay ausencias aprobadas con estos filtros')}
      />
    </ReportFrame>
  );
}

function CorrectionsReport({ def }: { def: ReportDef }) {
  const ctx = useCtx();
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const rows = useMemo(() => correctionRows(ctx, f), [ctx, f]);
  const { sorted, sort, onSort } = useSortedRows(rows, CORRECTION_COLUMNS);
  return (
    <ReportFrame
      def={def}
      count={rows.length}
      filters={<FilterBar value={f} onChange={setF} show={['search', 'dates', 'department', 'employee', 'status']} statusOptions={CORRECTION_STATUS_OPTIONS} />}
      exportButton={<ExportButton kind="correcciones" title={def.title} rows={sorted} columns={CORRECTION_COLUMNS} filters={describeFilters(ctx, f)} />}
      notes={<span className="tiny muted">{t('Los valores originales nunca se sobrescriben: la corrección aprobada se añade como una capa revisada.')}</span>}
    >
      <ColumnTable
        rows={sorted}
        columns={CORRECTION_COLUMNS}
        rowKey={(r) => r.c.id}
        sort={sort}
        onSort={onSort}
        translate={['tipo', 'iniciada_por', 'estado']}
        link={{ key: 'fecha', to: (r) => `/correcciones/${r.c.id}` }}
        caption={t(def.title)}
        emptyTitle={t('No hay correcciones con estos filtros')}
      />
    </ReportFrame>
  );
}

function ExceptionsReport({ def }: { def: ReportDef }) {
  const ctx = useCtx();
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const rows = useMemo(() => exceptionRows(ctx, f), [ctx, f]);
  const { sorted, sort, onSort } = useSortedRows(rows, EXCEPTION_COLUMNS);
  return (
    <ReportFrame
      def={def}
      count={rows.length}
      filters={<FilterBar value={f} onChange={setF} show={['search', 'dates', 'department', 'employee']} />}
      exportButton={<ExportButton kind="incidencias_abiertas" title={def.title} rows={sorted} columns={EXCEPTION_COLUMNS} filters={describeFilters(ctx, f)} />}
      notes={<span className="tiny muted">{t('Una incidencia es una solicitud de revisión, no una conclusión sobre el comportamiento de ninguna persona.')}</span>}
    >
      <ColumnTable
        rows={sorted}
        columns={EXCEPTION_COLUMNS}
        rowKey={(r) => r.key}
        sort={sort}
        onSort={onSort}
        translate={['tipo', 'estado', 'motivo']}
        link={{ key: 'tipo', to: (r) => `/incidencias?clave=${encodeURIComponent(r.key)}` }}
        caption={t(def.title)}
        emptyTitle={t('No hay incidencias abiertas con estos filtros')}
      />
    </ReportFrame>
  );
}

function PlanReport({ def }: { def: ReportDef }) {
  const ctx = useCtx();
  const [f, setF] = useState<Filters>({ ...EMPTY_FILTERS, from: startOfMonth(ctx.today), to: ctx.today });
  const rows = useMemo(() => planVsActualRows(ctx, f), [ctx, f]);
  const { sorted, sort, onSort } = useSortedRows(rows, PLAN_COLUMNS);
  const groups = useMemo(() => sorted.slice(0, 20).map((r) => ({ label: r.employee.split(' ')[0], values: [toHours(r.plannedMinutes), toHours(r.actualNetMinutes)] })), [sorted]);
  return (
    <ReportFrame
      def={def}
      count={rows.length}
      filters={<FilterBar value={f} onChange={setF} show={['search', 'dates', 'department', 'employee']} />}
      exportButton={<ExportButton kind="planificado_vs_registrado" title={def.title} rows={sorted} columns={PLAN_COLUMNS} filters={describeFilters(ctx, f)} />}
      notes={
        <Callout tone="info">
          {t('Las diferencias son indicadores de revisión configurables, no horas extraordinarias ni faltas. Un turno planificado nunca se convierte en tiempo trabajado; solo se comparan turnos ya finalizados.')}
        </Callout>
      }
    >
      {groups.length > 0 && (
        <div className="control-pad">
          <GroupedBarChart groups={groups} series={[t('Planificado'), t('Registrado neto')]} ariaLabel={t('Horas planificadas y registradas por empleado')} groupHeader={t('Empleado')} />
        </div>
      )}
      <ColumnTable
        rows={sorted}
        columns={PLAN_COLUMNS}
        rowKey={(r) => r.employeeId}
        sort={sort}
        onSort={onSort}
        caption={t(def.title)}
        emptyTitle={t('No hay turnos ni registros en el rango')}
      />
    </ReportFrame>
  );
}

// ─────────────────────────────── Recent exports ───────────────────────────────

function RecentExports() {
  const ctx = useCtx();
  const jobs = useMemo(() => ctx.db.exports.filter((e) => e.companyId === ctx.company.id).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)), [ctx]);
  const paged = usePaged(jobs, 10);
  return (
    <Card flush title={<h2 className="row"><Files size={16} aria-hidden /> {t('Exportaciones recientes')}</h2>}>
      {jobs.length === 0 ? (
        <EmptyState title={t('Todavía no se ha generado ninguna exportación')}>{t('Cada exportación queda registrada aquí y en la auditoría, con las incidencias abiertas que declara.')}</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Fichero')}</th>
                  <th className="num">{t('Registros')}</th>
                  <th className="num">{t('Incidencias abiertas declaradas')}</th>
                  <th>{t('Generado por')}</th>
                  <th>{t('Generado el')}</th>
                  <th>{t('Minimizado')}</th>
                  <th>{t('Huella (demo)')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((j) => (
                  <tr key={j.id}>
                    <td className="small control-file">
                      <span className="mono control-break">{j.fileName}</span>
                      <div className="sub">{j.filters}{j.period ? ` · ${formatMonth(j.period)}` : ''}</div>
                    </td>
                    <td className="num">{j.recordCount}</td>
                    <td className="num">{j.openExceptions}</td>
                    <td className="small">{userName(ctx.db, j.generatedBy)}</td>
                    <td className="small"><DateTimeText at={j.generatedAt} tz={ctx.company.timezone} /></td>
                    <td>{j.minimised ? <Badge tone="info">{t('Sí')}</Badge> : <span className="small muted">{t('No')}</span>}</td>
                    <td><code className="tiny">{j.fingerprint}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paged.props} />
        </>
      )}
    </Card>
  );
}

