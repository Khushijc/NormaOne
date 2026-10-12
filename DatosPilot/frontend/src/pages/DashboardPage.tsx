/**
 * Inicio: overview of workplace-safety documentation, derived only from the records the caller may
 * see. It shows what has been checked, what is outstanding and who must act next — never a single
 * "compliant" indicator. The content adapts to the role:
 * - company scope (owner, admin, coordinator, technical provider within its concierto);
 * - supervisors: their team and the worksites they coordinate;
 * - employees: their own items and tasks;
 * - prevention delegates: aggregated readiness by worksite and counts, no names;
 * - the occupational doctor: a health-area summary (counts only) plus readiness counts.
 */
import {
  AlarmClock,
  AlertOctagon,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  FileQuestion,
  FileX2,
  Handshake,
  History,
  Inbox,
  Info,
  ListChecks,
  ShieldCheck,
  Stethoscope,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuditList } from '../components/AuditList';
import { DocStatusBadge, EmployeeLink, ItemStatusBadge, KindDate, msg, READINESS_SEGMENTS, ReadinessBadge, ReadinessDisclaimer, WorksiteLink } from '../components/bits';
import { StackedBars, type StackRow } from '../components/charts';
import { Badge, Button, Callout, Card, DateTimeText, EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { assignmentOn } from '../domain/requirements';
import { ACTION_STATUS, ASSESSMENT_STATUS, CATEGORY_LABEL, DOC_STATUS, ITEM_STATUS, READINESS, type ItemStatus } from '../domain/status';
import { formatDateLong } from '../domain/time';
import type { AssessmentStatus, ActionStatus, ID, RequirementCategory } from '../domain/types';
import { t, tKey } from '../i18n';
import { visibleCases } from '../services/caeService';
import { alertDays, itemsFor, readinessAggregate, roleName, userName, visibleReadiness, visibleWorksiteIds, worksiteName, worksiteScope } from '../services/context';
import { myTasks } from '../services/opsService';
import { visibleActions, visibleAssessments } from '../services/safetyService';
import { useCtx, type UiCtx } from '../store/hooks';
import { canOpen, computeOverview, groupReadiness, hasAnyFilter, hasItemFilters, NO_FILTERS, scopeEmployees, type DashFilters, type Overview } from './home/dashboardData';
import { HealthSummary, Kpi, QuickActions, TasksSummary } from './home/parts';

// ─────────────────────────────── Labels ───────────────────────────────

/** Display order of item statuses: outstanding first, then in review, then checked. */
const STATUS_ORDER: ItemStatus[] = ['missing', 'requested', 'rejected', 'expired', 'pending_ack', 'review_required', 'review_due', 'received', 'in_review', 'accepted', 'declined', 'not_applicable'];

/** Who must act next for an item in each status (configured roles, not a legal assessment). */
const NEXT_ACTOR: Record<ItemStatus, string> = {
  missing: tKey('Coordinación de PRL: solicitar la evidencia'),
  requested: tKey('Persona trabajadora o emisor: aportar la evidencia'),
  received: tKey('Autoridad de revisión configurada: examinarla'),
  in_review: tKey('Autoridad de revisión configurada: decidir'),
  pending_ack: tKey('Persona trabajadora: confirmar la recepción'),
  accepted: tKey('Sin acción pendiente; seguimiento de fechas'),
  declined: tKey('Sin acción: oferta voluntaria no aceptada'),
  rejected: tKey('Persona trabajadora o emisor: presentar una nueva versión'),
  expired: tKey('Coordinación de PRL: solicitar la renovación'),
  review_due: tKey('Servicio de prevención: revisar en la fecha fijada'),
  review_required: tKey('Profesional competente: fijar la fecha o la decisión'),
  not_applicable: tKey('Sin acción: decisión documentada'),
};

const STATUS_GROUP: Record<ItemStatus, 'checked' | 'review' | 'outstanding'> = {
  missing: 'outstanding',
  requested: 'outstanding',
  rejected: 'outstanding',
  expired: 'outstanding',
  pending_ack: 'outstanding',
  review_required: 'outstanding',
  review_due: 'outstanding',
  received: 'review',
  in_review: 'review',
  accepted: 'checked',
  declined: 'checked',
  not_applicable: 'checked',
};

/** Where each item status can be followed up (exceptions queue or documents). */
function statusLink(ctx: UiCtx, s: ItemStatus): string | null {
  const exc = canOpen(ctx, 'exceptions');
  const docs = canOpen(ctx, 'documents');
  switch (s) {
    case 'missing':
    case 'requested':
      return exc ? '/incidencias?tipo=missing_evidence' : null;
    case 'rejected':
      return exc ? '/incidencias?tipo=rejected_document' : docs ? '/documentacion?estado=rejected' : null;
    case 'expired':
      return exc ? '/incidencias?tipo=expired_document' : null;
    case 'pending_ack':
      return exc ? '/incidencias?tipo=unacknowledged' : null;
    case 'review_required':
      return exc ? '/incidencias?tipo=missing_date' : null;
    case 'review_due':
      return exc ? '/incidencias?tipo=provider_review' : null;
    case 'received':
    case 'in_review':
      return docs ? '/documentacion?revision=1' : null;
    case 'accepted':
      return docs ? '/documentacion?estado=accepted' : null;
    default:
      return null;
  }
}

// ─────────────────────────────── Role selection ───────────────────────────────

type ViewKind = 'company' | 'team' | 'employee' | 'representative' | 'medical' | 'other';

function viewKind(ctx: UiCtx): ViewKind {
  const broad = ctx.roles.some((r) => r === 'owner' || r === 'company_admin' || r === 'prl_coordinator' || r === 'provider_technical');
  if (ctx.roles.includes('provider_medical') && !broad) return 'medical';
  if (ctx.can('employees.view_all')) return 'company';
  if (ctx.can('team.view')) return 'team';
  if (ctx.can('representative.view')) return 'representative';
  if (ctx.employee && ctx.can('own.view')) return 'employee';
  return 'other';
}

export function DashboardPage() {
  const ctx = useCtx();
  const kind = viewKind(ctx);
  const firstName = ctx.employee?.firstName ?? ctx.user.name.split(' ')[0];
  const scope = worksiteScope(ctx);
  return (
    <>
      <PageHeader
        title={t('Inicio')}
        subtitle={
          <>
            {t('Hola, {name}.', { name: firstName })} {ctx.company.tradeName} · {formatDateLong(ctx.today)}
            {scope && <span className="home-block tiny muted">{t('Ámbito limitado a {n} centros asignados en su concierto.', { n: scope.size })}</span>}
          </>
        }
      />
      {(kind === 'company' || kind === 'team') && <OverviewHome ctx={ctx} team={kind === 'team'} />}
      {kind === 'employee' && <EmployeeHome ctx={ctx} />}
      {kind === 'representative' && <RepresentativeHome ctx={ctx} />}
      {kind === 'medical' && <MedicalHome ctx={ctx} />}
      {kind === 'other' && (
        <Card>
          <EmptyState icon={Inbox} title={t('No hay paneles disponibles para su rol')} action={<Link to="/fuentes" className="btn">{t('Ver fuentes y pruebas')}</Link>}>
            {t('Use el menú lateral para acceder a las secciones permitidas.')}
          </EmptyState>
        </Card>
      )}
    </>
  );
}

// ─────────────────────────────── Filters ───────────────────────────────

function useFilters(): [DashFilters, (key: string, value: string | null) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const f: DashFilters = {
    ws: params.get('centro') ?? '',
    dep: params.get('departamento') ?? '',
    emp: params.get('empleado') ?? '',
    cat: ((params.get('categoria') ?? '') in CATEGORY_LABEL ? params.get('categoria') : '') as RequirementCategory | '',
    status: ((params.get('estado') ?? '') in ITEM_STATUS ? params.get('estado') : '') as ItemStatus | '',
  };
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  return [f, set, clear];
}

function FilterBar({ ctx, f, set, clear }: { ctx: UiCtx; f: DashFilters; set: (k: string, v: string | null) => void; clear: () => void }) {
  const employees = scopeEmployees(ctx);
  const depIds = new Set(employees.map((e) => assignmentOn(ctx.db, e.id, ctx.today)?.departmentId).filter(Boolean) as ID[]);
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id && depIds.has(d.id));
  const siteIds = visibleWorksiteIds(ctx);
  const worksites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && w.active && siteIds.has(w.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return (
    <Card flush>
      <div className="toolbar home-toolbar" role="search" aria-label={t('Filtros')}>
        <div className="field">
          <label htmlFor="home-ws">{t('Centro')}</label>
          <select id="home-ws" className="select" value={f.ws} onChange={(e) => set('centro', e.target.value || null)}>
            <option value="">{t('Todos')}</option>
            {worksites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        {departments.length > 1 && (
          <div className="field">
            <label htmlFor="home-dep">{t('Departamento')}</label>
            <select id="home-dep" className="select" value={f.dep} onChange={(e) => set('departamento', e.target.value || null)}>
              <option value="">{t('Todos')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="home-emp">{t('Empleado')}</label>
          <select id="home-emp" className="select" value={f.emp} onChange={(e) => set('empleado', e.target.value || null)}>
            <option value="">{t('Todos')}</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="home-cat">{t('Categoría de requisito')}</label>
          <select id="home-cat" className="select" value={f.cat} onChange={(e) => set('categoria', e.target.value || null)}>
            <option value="">{t('Todas')}</option>
            {(Object.keys(CATEGORY_LABEL) as RequirementCategory[]).map((c) => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="home-status">{t('Estado del elemento')}</label>
          <select id="home-status" className="select" value={f.status} onChange={(e) => set('estado', e.target.value || null)}>
            <option value="">{t('Todos')}</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{t(ITEM_STATUS[s].label)}</option>)}
          </select>
        </div>
        {hasAnyFilter(f) && (
          <Button size="sm" variant="ghost" onClick={clear}>{t('Limpiar filtros')}</Button>
        )}
      </div>
      <p className="tiny muted home-filter-note">
        {t('La categoría y el estado filtran los elementos de requisitos, la documentación, la disponibilidad y las fechas de la documentación. Las acciones, la CAE y la actividad reciente se filtran por centro, departamento y empleado.')}
      </p>
    </Card>
  );
}

// ─────────────────────────────── Company / team overview ───────────────────────────────

function OverviewHome({ ctx, team }: { ctx: UiCtx; team: boolean }) {
  const navigate = useNavigate();
  const [f, set, clear] = useFilters();
  const d = useMemo(() => computeOverview(ctx, f), [ctx, f.ws, f.dep, f.emp, f.cat, f.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const empLinks = canOpen(ctx, 'employees');
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ centro: f.ws || undefined, departamento: f.dep || undefined, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const docQs = f.emp ? `&empleado=${f.emp}` : '';
  const reviewable = d.reviewQueue.filter((x) => x.canDecide).length;

  return (
    <div className="stack-lg">
      {team && (
        <Callout tone="neutral" title={t('Vista de equipo')}>
          {t('Incluye a las personas que dependen de usted y a quienes trabajan en los centros que coordina. Solo se muestra la información mínima necesaria.')}
        </Callout>
      )}
      <QuickActions ctx={ctx} reviewable={reviewable} />
      <FilterBar ctx={ctx} f={f} set={set} clear={clear} />

      <section aria-labelledby="home-kpis" className="stack-sm">
        <h2 id="home-kpis" className="home-h2">{t('Resumen')}</h2>
        <div className="kpis home-kpis">
          <Kpi icon={Users} label={t('Empleados activos')} value={d.employees.length} meta={team ? t('En su equipo y centros coordinados') : t('En su ámbito')} to={empLinks ? `/empleados${qs({})}` : null} />
          <Kpi icon={Building2} label={t('Centros activos')} value={d.worksiteIds.length} to={canOpen(ctx, 'worksites') ? '/centros' : null} />
          <Kpi icon={ClipboardCheck} label={t('Requisitos aplicables')} value={d.counted.length} meta={d.optional ? t('Elementos que cuentan; además, {n} opcionales', { n: d.optional }) : t('Elementos que cuentan para la disponibilidad')} to={ctx.can('requirements.view') ? '/requisitos' : null} />
          <Kpi icon={CheckCircle2} label={t('Evidencias aceptadas')} value={d.accepted} meta={d.otherSatisfied ? t('Y {n} no aplicables u ofertas no aceptadas', { n: d.otherSatisfied }) : t('Aceptadas por la autoridad de revisión')} to={canOpen(ctx, 'documents') ? `/documentacion?estado=accepted${docQs}` : null} />
          <Kpi icon={FileClock} label={t('Documentos pendientes de revisión')} value={d.reviewQueue.length} meta={reviewable ? t('{n} esperan su decisión', { n: reviewable }) : t('Recibidos o en revisión')} to={canOpen(ctx, 'documents') ? `/documentacion?revision=1${docQs}` : null} />
          <Kpi icon={FileQuestion} label={t('Falta evidencia obligatoria')} value={d.missing} meta={d.requested ? t('{n} con solicitud abierta', { n: d.requested }) : t('Sin solicitud abierta')} tone={d.missing ? 'warning' : undefined} to={canOpen(ctx, 'exceptions') ? '/incidencias?tipo=missing_evidence' : null} />
          <Kpi icon={FileX2} label={t('Documentos caducados')} value={d.expired} meta={t('Solo con una caducidad real indicada en el documento')} tone={d.expired ? 'danger' : undefined} to={canOpen(ctx, 'exceptions') ? '/incidencias?tipo=expired_document' : null} />
          <Kpi icon={Stethoscope} label={t('Requieren revisión profesional')} value={d.professional} meta={t('Fecha o decisión pendiente, o revisión vencida')} tone={d.professional ? 'warning' : undefined} to={canOpen(ctx, 'exceptions') ? '/incidencias?tipo=missing_date' : null} />
          <Kpi icon={ClipboardList} label={t('Acciones preventivas abiertas')} value={d.openActions.length} meta={d.overdueActions.length ? t('{n} con la fecha objetivo superada', { n: d.overdueActions.length }) : t('Ninguna con la fecha objetivo superada')} tone={d.overdueActions.length ? 'warning' : undefined} to={canOpen(ctx, 'actions') ? '/acciones' : null} />
          <Kpi icon={CalendarClock} label={t('Próximas revisiones aprobadas')} value={d.upcomingReviews} meta={t('Proveedor o evaluación, próximos {n} días', { n: alertDays(ctx) })} to={null} />
          <Kpi icon={AlertOctagon} label={t('Asignaciones bloqueadas')} value={d.blocked} meta={t('Por un requisito crítico configurado')} tone={d.blocked ? 'danger' : undefined} to={empLinks ? `/empleados${qs({ estado: 'blocked' })}` : null} />
        </div>
      </section>

      <div className="grid-main-side">
        <div className="stack-lg">
          <DocumentationStatus ctx={ctx} d={d} />
          <ReadinessCharts ctx={ctx} d={d} f={f} onActivate={empLinks ? (to) => navigate(to) : undefined} />
          <ReviewQueue ctx={ctx} d={d} />
          <CaeActivity ctx={ctx} d={d} />
        </div>
        <div className="stack-lg">
          <TasksSummary ctx={ctx} />
          <HealthSummary ctx={ctx} />
          <UpcomingDates ctx={ctx} d={d} />
          <OverdueActions ctx={ctx} d={d} />
          <RecentActivity ctx={ctx} f={f} d={d} />
        </div>
      </div>
    </div>
  );
}

function DocumentationStatus({ ctx, d }: { ctx: UiCtx; d: Overview }) {
  const sum = (g: 'checked' | 'review' | 'outstanding') => STATUS_ORDER.filter((s) => STATUS_GROUP[s] === g).reduce((a, s) => a + (d.byStatus.get(s) ?? 0), 0);
  const rows = STATUS_ORDER.filter((s) => (d.byStatus.get(s) ?? 0) > 0);
  return (
    <Card title={t('Estado de la documentación')} flush footer={<ReadinessDisclaimer />}>
      <div className="home-split" role="group" aria-label={t('Resumen por situación')}>
        <div>
          <span className="home-split-value">{sum('checked')}</span>
          <span className="small">{t('Comprobados')}</span>
          <span className="tiny muted">{t('Aceptados, no aplicables u ofertas no aceptadas')}</span>
        </div>
        <div>
          <span className="home-split-value">{sum('review')}</span>
          <span className="small">{t(ITEM_STATUS.in_review.label)}</span>
          <span className="tiny muted">{t('Recibidos; falta la decisión de la autoridad de revisión')}</span>
        </div>
        <div>
          <span className="home-split-value home-warn">{sum('outstanding')}</span>
          <span className="small">{t('Pendientes de acción')}</span>
          <span className="tiny muted">{t('Falta evidencia, confirmación, renovación o decisión profesional')}</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t('No hay elementos de requisitos con estos filtros')}>
          {t('Cambie o limpie los filtros para ver los elementos de su ámbito.')}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table home-status-table">
            <caption className="sr-only">{t('Elementos de requisitos que cuentan para la disponibilidad, por estado, y quién debe actuar')}</caption>
            <thead>
              <tr>
                <th>{t('Estado')}</th>
                <th className="num">{t('Elementos')}</th>
                <th>{t('Quién debe actuar')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const to = statusLink(ctx, s);
                return (
                  <tr key={s}>
                    <td><ItemStatusBadge status={s} /></td>
                    <td className="num strong">{to ? <Link to={to}>{d.byStatus.get(s)}</Link> : d.byStatus.get(s)}</td>
                    <td className="small">{t(NEXT_ACTOR[s])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {d.optional > 0 && <p className="tiny muted home-pad">{t('Los {n} elementos opcionales no cuentan como evidencia obligatoria pendiente.', { n: d.optional })}</p>}
    </Card>
  );
}

function ReadinessCharts({ ctx, d, f, onActivate }: { ctx: UiCtx; d: Overview; f: DashFilters; onActivate?: (to: string) => void }) {
  const segments = READINESS_SEGMENTS.map((s) => ({ ...s, label: t(s.label) }));
  const bySite = groupReadiness(d.readiness, (r) => r.worksiteId);
  const siteRows: StackRow[] = [...bySite.entries()].map(([id, values]) => ({ id, label: worksiteName(ctx.db, id), values })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const byRole = groupReadiness(d.readiness, (r) => assignmentOn(ctx.db, r.employeeId, ctx.today)?.jobRoleId ?? null);
  const roleRows: StackRow[] = [...byRole.entries()].map(([id, values]) => ({ id, label: roleName(ctx.db, id), values })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const link = (base: Record<string, string>, state: string | null) => {
    const p = new URLSearchParams();
    if (state) p.set('estado', state);
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/empleados?${p.toString()}`;
  };
  return (
    <Card title={t('Disponibilidad por asignación')}>
      <div className="stack">
        {hasItemFilters(f) && (
          <p className="tiny muted">{t('Con filtros de categoría o estado se cuentan las asignaciones que tienen al menos un elemento coincidente.')}</p>
        )}
        {d.readiness.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={t('No hay asignaciones en su ámbito con estos filtros')} />
        ) : (
          <>
            <section className="stack-sm" aria-labelledby="home-ready-ws">
              <h3 id="home-ready-ws" className="home-h3">{t('Por centro de trabajo')}</h3>
              <StackedBars
                rows={siteRows}
                segments={segments}
                rowHeader={t('Centro')}
                ariaLabel={t('Disponibilidad por centro de trabajo (asignaciones empleado × centro)')}
                onActivate={onActivate ? (row, seg) => onActivate(link({ centro: row, departamento: f.dep }, seg)) : undefined}
              />
            </section>
            <section className="stack-sm" aria-labelledby="home-ready-role">
              <h3 id="home-ready-role" className="home-h3">{t('Por puesto')}</h3>
              <StackedBars
                rows={roleRows}
                segments={segments}
                rowHeader={t('Puesto')}
                ariaLabel={t('Disponibilidad por puesto (asignaciones empleado × centro)')}
                onActivate={onActivate ? (row, seg) => onActivate(link({ puesto: row, centro: f.ws, departamento: f.dep }, seg)) : undefined}
              />
            </section>
          </>
        )}
        <p className="tiny muted">
          {t('Cada barra cuenta asignaciones empleado × centro. «{ready}» significa que la evidencia configurada está aceptada.', { ready: t(READINESS.ready.label) })}
        </p>
        <ReadinessDisclaimer />
      </div>
    </Card>
  );
}

function ReviewQueue({ ctx, d }: { ctx: UiCtx; d: Overview }) {
  const top = d.reviewQueue.slice(0, 6);
  const docs = canOpen(ctx, 'documents');
  return (
    <Card
      title={t('Cola de revisión de evidencias')}
      actions={docs && d.reviewQueue.length > 0 ? <Link to="/documentacion?revision=1" className="btn ghost sm">{t('Ver la cola completa ({n})', { n: d.reviewQueue.length })}</Link> : undefined}
      flush
    >
      {top.length === 0 ? (
        <EmptyState icon={FileClock} title={t('No hay documentos pendientes de revisión')}>
          {t('Los documentos recibidos aparecerán aquí hasta que la autoridad de revisión decida.')}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table home-stack-table">
            <thead>
              <tr>
                <th>{t('Documento')}</th>
                <th>{t('Empleado o centro')}</th>
                <th>{t(DOC_STATUS.received.label)}</th>
                <th>{t('Estado')}</th>
              </tr>
            </thead>
            <tbody>
              {top.map(({ doc, version, canDecide }) => (
                <tr key={version.id}>
                  <td>
                    <Link to={`/documentacion/${doc.id}`} className="strong">{doc.title}</Link>
                    <div className="tiny muted">{doc.code} · v{version.version}</div>
                  </td>
                  <td className="small">{doc.employeeId ? <EmployeeLink id={doc.employeeId} /> : doc.worksiteId ? <WorksiteLink id={doc.worksiteId} /> : <span className="muted">{t('General')}</span>}</td>
                  <td className="small"><DateTimeText at={version.receivedAt} tz={ctx.company.timezone} /></td>
                  <td>
                    <span className="status-stack">
                      <DocStatusBadge status={version.status} />
                      {canDecide && <Badge tone="accent" icon={ListChecks}>{t('Le corresponde decidir')}</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const KIND_LABEL: Record<'provider' | 'assessment' | 'legal', string> = {
  provider: tKey('Revisión del proveedor'),
  assessment: tKey('Revisión fijada por el evaluador'),
  legal: tKey('Caducidad legal'),
};

function UpcomingDates({ ctx, d }: { ctx: UiCtx; d: Overview }) {
  const top = d.upcoming.slice(0, 8);
  return (
    <Card title={t('Próximas fechas')} flush footer={<span className="tiny muted">{t('Solo fechas reales registradas en la evidencia aceptada o fijadas por el evaluador, hasta el {date} (ventana de aviso de la empresa). Nunca se calcula una fecha.', { date: formatDateLong(d.windowEnd) })}</span>}>
      {top.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t('No hay fechas en la ventana de aviso')} />
      ) : (
        <ul className="home-list">
          {top.map((u) => (
            <li key={u.key}>
              <CalendarClock size={15} aria-hidden className="home-list-icon" />
              <div className="grow home-min0">
                {u.link ? <Link to={u.link} className="strong">{u.label}</Link> : <span className="strong">{u.label}</span>}
                <div className="tiny muted">
                  {t(KIND_LABEL[u.kind])}
                  {u.employeeId && <> · <EmployeeLink id={u.employeeId} /></>}
                  {!u.employeeId && u.worksiteId && <> · {worksiteName(ctx.db, u.worksiteId)}</>}
                </div>
              </div>
              <KindDate kind={u.kind} date={u.date} today={ctx.today} />
            </li>
          ))}
        </ul>
      )}
      {d.upcoming.length > top.length && <div className="home-more tiny muted">{t('Y {n} más.', { n: d.upcoming.length - top.length })}</div>}
    </Card>
  );
}

function OverdueActions({ ctx, d }: { ctx: UiCtx; d: Overview }) {
  const top = d.overdueActions.slice(0, 6);
  return (
    <Card title={t('Acciones con la fecha objetivo superada')} flush actions={canOpen(ctx, 'actions') && d.overdueActions.length > 0 ? <Link to="/acciones?vencidas=1" className="btn ghost sm">{t('Ver todas')}</Link> : undefined}>
      {top.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('Ninguna acción con la fecha objetivo superada')} />
      ) : (
        <ul className="home-list">
          {top.map((a) => (
            <li key={a.id}>
              <AlarmClock size={15} aria-hidden className="home-list-icon home-danger" />
              <div className="grow home-min0">
                <Link to={`/acciones/${a.id}`} className="strong">{a.code} · {a.title}</Link>
                <div className="tiny muted">{t('Responsable')}: {a.ownerUserId ? userName(ctx.db, a.ownerUserId) : t('Sin asignar')}</div>
                <StatusBadge meta={ACTION_STATUS[a.status]} />
              </div>
              <KindDate kind="target" date={a.targetDate} today={ctx.today} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CaeActivity({ ctx, d }: { ctx: UiCtx; d: Overview }) {
  if (!ctx.can('cae.view')) return null;
  return (
    <Card title={<h2 className="row"><Handshake size={16} aria-hidden /> {t('Coordinación CAE con puntos abiertos')}</h2>} flush actions={<Link to="/cae" className="btn ghost sm">{t('Ver la coordinación CAE')}</Link>}>
      {d.cae.length === 0 ? (
        <EmptyState icon={Handshake} title={t('Sin puntos abiertos de coordinación')}>
          {t('Envíos, acuses de recibo, confirmaciones y revisiones al día en los expedientes de su ámbito.')}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table home-stack-table">
            <thead>
              <tr>
                <th>{t('Expediente')}</th>
                <th>{t('Puntos abiertos')}</th>
                <th>{t('Próximo seguimiento')}</th>
              </tr>
            </thead>
            <tbody>
              {d.cae.slice(0, 6).map(({ c, pending }) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cae/${c.id}`} className="strong">{c.code} · {c.title}</Link>
                    <div className="tiny muted">{worksiteName(ctx.db, c.worksiteId)}</div>
                  </td>
                  <td>
                    <span className="status-stack">
                      {pending.notSent > 0 && <Badge tone="warning">{t('Sin enviar: {n}', { n: pending.notSent })}</Badge>}
                      {pending.noReceipt > 0 && <Badge tone="warning">{t('Sin acuse de recibo: {n}', { n: pending.noReceipt })}</Badge>}
                      {pending.noAck > 0 && <Badge tone="info">{t('Sin confirmación: {n}', { n: pending.noAck })}</Badge>}
                      {pending.toReview > 0 && <Badge tone="accent">{t('Por revisar: {n}', { n: pending.toReview })}</Badge>}
                      {pending.followUpOverdue && <Badge tone="danger">{t('Seguimiento vencido')}</Badge>}
                    </span>
                  </td>
                  <td><KindDate kind="internal" date={c.nextFollowUp} today={ctx.today} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny muted home-pad">{t('Enviado, recibido, confirmado y revisado se registran por separado: una subida no implica recepción.')}</p>
    </Card>
  );
}

function RecentActivity({ ctx, f, d }: { ctx: UiCtx; f: DashFilters; d: Overview }) {
  const people = new Set(d.employees.map((e) => e.id));
  const filtered = !!(f.emp || f.dep || f.ws);
  return (
    <Card title={<h2 className="row"><History size={16} aria-hidden /> {t('Actividad reciente')}</h2>} actions={ctx.can('audit.view') ? <Link to="/auditoria" className="btn ghost sm">{t('Auditoría')}</Link> : undefined}>
      {!ctx.can('audit.view') && <p className="tiny muted" style={{ marginTop: 0 }}>{t('Se muestran los eventos sobre sus propios registros.')}</p>}
      <AuditList limit={8} filter={(e) => !filtered || (!!e.employeeId && people.has(e.employeeId))} />
    </Card>
  );
}

// ─────────────────────────────── Employee ───────────────────────────────

function EmployeeHome({ ctx }: { ctx: UiCtx }) {
  const me = ctx.employee!;
  const items = itemsFor(ctx, me.id);
  const counted = items.filter((i) => i.counted);
  const count = (...s: ItemStatus[]) => counted.filter((i) => s.includes(i.status)).length;
  const tasks = myTasks(ctx);
  const readiness = visibleReadiness(ctx).filter((r) => r.employeeId === me.id);
  const pendingItems = [...counted.filter((i) => STATUS_GROUP[i.status] !== 'checked')].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const own = useMemo(() => computeOverview(ctx, { ...NO_FILTERS, emp: me.id }), [ctx, me.id]);
  const reqLink = `/empleados/${me.id}?tab=requisitos`;
  return (
    <div className="stack-lg">
      <QuickActions ctx={ctx} reviewable={0} />
      <section aria-labelledby="home-mine" className="stack-sm">
        <h2 id="home-mine" className="home-h2">{t('Mis requisitos')}</h2>
        <div className="kpis home-kpis">
          <Kpi icon={Inbox} label={t('Tareas pendientes')} value={tasks.length} meta={t('Confirmaciones, evidencias y formación')} tone={tasks.length ? 'warning' : undefined} to="/mis-tareas" />
          <Kpi icon={ClipboardCheck} label={t('Requisitos aplicables')} value={counted.length} to={reqLink} />
          <Kpi icon={CheckCircle2} label={t('Evidencias aceptadas')} value={count('accepted')} to={reqLink} />
          <Kpi icon={FileClock} label={t(ITEM_STATUS.in_review.label)} value={count('received', 'in_review')} meta={t('Pendientes de la autoridad de revisión')} to={reqLink} />
          <Kpi icon={FileQuestion} label={t('Pendientes de acción')} value={count('missing', 'requested', 'rejected', 'expired', 'pending_ack')} tone={count('missing', 'requested', 'rejected', 'expired', 'pending_ack') ? 'warning' : undefined} to={reqLink} />
          <Kpi icon={Stethoscope} label={t('Requieren revisión profesional')} value={count('review_required', 'review_due')} to={reqLink} />
        </div>
      </section>
      <div className="grid-main-side">
        <div className="stack-lg">
          <Card title={t('Mi disponibilidad por centro')} footer={<ReadinessDisclaimer />} flush>
            {readiness.length === 0 ? (
              <EmptyState icon={ShieldCheck} title={t('No tiene centros asignados hoy')} />
            ) : (
              <ul className="home-list">
                {readiness.map((r) => (
                  <li key={r.worksiteId}>
                    <Building2 size={15} aria-hidden className="home-list-icon" />
                    <div className="grow home-min0">
                      <WorksiteLink id={r.worksiteId} />
                      {r.reasons.slice(0, 2).map((x, i) => <div key={i} className="tiny muted">{msg(x.msg)}</div>)}
                    </div>
                    <ReadinessBadge state={r.state} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('Lo que falta y quién debe actuar')} flush actions={<Link to={reqLink} className="btn ghost sm">{t('Ver todos mis requisitos')}</Link>}>
            {pendingItems.length === 0 ? (
              <EmptyState icon={CheckCircle2} title={t('No hay elementos pendientes')}>
                {t('La evidencia configurada para sus asignaciones consta como aceptada. No es una aprobación profesional de seguridad.')}
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table home-stack-table">
                  <thead>
                    <tr>
                      <th>{t('Requisito')}</th>
                      <th>{t('Estado')}</th>
                      <th>{t('Quién debe actuar')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingItems.slice(0, 10).map((it) => (
                      <tr key={it.key}>
                        <td>
                          <span className="strong">{it.version.name}</span>
                          {it.worksiteId && <div className="tiny muted">{worksiteName(ctx.db, it.worksiteId)}</div>}
                          <div className="tiny muted">{msg(it.reason)}</div>
                        </td>
                        <td><ItemStatusBadge status={it.status} /></td>
                        <td className="small">{it.restricted ? t('Servicio médico y persona trabajadora (área restringida)') : t(NEXT_ACTOR[it.status])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="stack-lg">
          <TasksSummary ctx={ctx} />
          <UpcomingDates ctx={ctx} d={own} />
          <OverdueActions ctx={ctx} d={own} />
          <Card title={<h2 className="row"><History size={16} aria-hidden /> {t('Actividad reciente')}</h2>}>
            <p className="tiny muted" style={{ marginTop: 0 }}>{t('Se muestran los eventos sobre sus propios registros.')}</p>
            <AuditList limit={8} filter={(e) => e.employeeId === me.id} />
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Representative ───────────────────────────────

const REP_ASSESSMENT: AssessmentStatus[] = ['accepted', 'review_required', 'superseded'];
const REP_ACTION: ActionStatus[] = ['open', 'assigned', 'in_progress', 'pending_review', 'reopened', 'resolved'];

function RepresentativeHome({ ctx }: { ctx: UiCtx }) {
  const agg = readinessAggregate(ctx);
  const segments = READINESS_SEGMENTS.map((s) => ({ ...s, label: t(s.label) }));
  const rows: StackRow[] = agg.map((a) => ({ id: a.worksiteId, label: worksiteName(ctx.db, a.worksiteId), values: a.counts })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const assessments = visibleAssessments(ctx);
  const actions = visibleActions(ctx);
  const overdue = actions.filter((a) => a.status !== 'resolved' && !!a.targetDate && a.targetDate < ctx.today).length;
  const cases = visibleCases(ctx).filter((c) => c.status !== 'closed').length;
  const until = ctx.membership?.roleValidUntil?.representative ?? null;
  return (
    <div className="stack-lg">
      <Callout tone="info" title={t('Acceso de la representación (delegado/a de prevención)')}>
        {t('Información agregada y minimizada (LPRL arts. 22.4 y 36): sin nombres, sin documentos individuales y sin datos de salud.')}{' '}
        {until && t('Acceso vigente hasta el {date}.', { date: formatDateLong(until) })}
      </Callout>
      <div className="kpis home-kpis">
        <Kpi icon={TriangleAlert} label={t('Evaluaciones de riesgos aceptadas')} value={assessments.filter((a) => a.status === 'accepted').length} meta={t('Registros vigentes; no declaran que un centro sea seguro')} to={canOpen(ctx, 'risk') ? '/evaluaciones' : null} />
        <Kpi icon={Stethoscope} label={t('Evaluaciones con revisión necesaria')} value={assessments.filter((a) => a.status === 'review_required').length} tone={assessments.some((a) => a.status === 'review_required') ? 'warning' : undefined} to={canOpen(ctx, 'risk') ? '/evaluaciones' : null} />
        <Kpi icon={ClipboardList} label={t('Acciones preventivas abiertas')} value={actions.filter((a) => a.status !== 'resolved').length} meta={overdue ? t('{n} con la fecha objetivo superada', { n: overdue }) : t('Ninguna con la fecha objetivo superada')} tone={overdue ? 'warning' : undefined} to={canOpen(ctx, 'actions') ? '/acciones' : null} />
        <Kpi icon={Handshake} label={t('Expedientes CAE activos')} value={cases} to={canOpen(ctx, 'cae') ? '/cae' : null} />
      </div>
      <div className="grid-2">
        <Card title={t('Disponibilidad agregada por centro')}>
          <div className="stack">
            {rows.length === 0 ? (
              <EmptyState icon={ShieldCheck} title={t('No hay asignaciones en los centros de su ámbito')} />
            ) : (
              <StackedBars rows={rows} segments={segments} rowHeader={t('Centro')} ariaLabel={t('Disponibilidad agregada por centro de trabajo')} />
            )}
            <p className="tiny muted">{t('Recuentos de asignaciones empleado × centro, sin identificar a ninguna persona.')}</p>
            <ReadinessDisclaimer />
          </div>
        </Card>
        <Card title={t('Evaluaciones y acciones por estado')} flush>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Recuentos de evaluaciones de riesgos y acciones preventivas por estado')}</caption>
              <thead>
                <tr>
                  <th>{t('Estado')}</th>
                  <th className="num">{t('Número')}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="home-subhead"><th colSpan={2} scope="colgroup">{t('Evaluaciones de riesgos')}</th></tr>
                {REP_ASSESSMENT.map((s) => (
                  <tr key={s}>
                    <td><StatusBadge meta={ASSESSMENT_STATUS[s]} /></td>
                    <td className="num">{assessments.filter((a) => a.status === s).length}</td>
                  </tr>
                ))}
                <tr className="home-subhead"><th colSpan={2} scope="colgroup">{t('Acciones preventivas')}</th></tr>
                {REP_ACTION.map((s) => (
                  <tr key={s}>
                    <td><StatusBadge meta={ACTION_STATUS[s]} /></td>
                    <td className="num">{actions.filter((a) => a.status === s).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {ctx.employee && ctx.can('own.view') && (
        <section aria-labelledby="home-rep-own" className="stack-sm">
          <h2 id="home-rep-own" className="home-h2">{t('Como persona trabajadora')}</h2>
          <EmployeeHome ctx={ctx} />
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────── Occupational doctor ───────────────────────────────

function MedicalHome({ ctx }: { ctx: UiCtx }) {
  const rows = visibleReadiness(ctx);
  const segments = READINESS_SEGMENTS.map((s) => ({ ...s, label: t(s.label) }));
  const bySite = groupReadiness(rows, (r) => r.worksiteId);
  const siteRows: StackRow[] = [...bySite.entries()].map(([id, values]) => ({ id, label: worksiteName(ctx.db, id), values })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  return (
    <div className="stack-lg">
      <Callout tone="neutral" icon={Info}>
        {t('Como servicio médico, gestiona las ofertas, respuestas y conclusiones de aptitud en el área restringida. El panel muestra solo recuentos.')}
      </Callout>
      <div className="grid-main-side">
        <div className="stack-lg">
          <HealthSummary ctx={ctx} />
          <Card title={t('Disponibilidad por centro de trabajo')}>
            <div className="stack">
              {siteRows.length === 0 ? (
                <EmptyState icon={ShieldCheck} title={t('No hay asignaciones en su ámbito')} />
              ) : (
                <StackedBars rows={siteRows} segments={segments} rowHeader={t('Centro')} ariaLabel={t('Disponibilidad por centro de trabajo (asignaciones empleado × centro)')} />
              )}
              <ReadinessDisclaimer />
            </div>
          </Card>
        </div>
        <div className="stack-lg">
          <TasksSummary ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
