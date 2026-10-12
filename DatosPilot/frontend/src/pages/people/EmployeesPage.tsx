/**
 * Empleados — directory (/empleados). Shows only the employees in the caller's scope
 * (visibleEmployeeIds: company, team / coordinated worksites, provider scope). Counters come from
 * the health-masked requirement matrix (itemsFor) and readiness from visibleReadiness. Readiness
 * only means "evidence configured as mandatory has been accepted", never a safety approval.
 */
import { Search, Users } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { READINESS, READINESS_ORDER } from '../../domain/status';
import { formatDate } from '../../domain/time';
import type { Employee, EmployeeAssignment, ReadinessState } from '../../domain/types';
import type { Readiness } from '../../domain/requirements';
import { t } from '../../i18n';
import { employeeName, itemsFor, roleName, visibleEmployeeIds, visibleReadiness, visibleWorksiteIds, worksiteName } from '../../services/context';
import { useCtx } from '../../store/hooks';
import { msg, ReadinessBadge, ReadinessDisclaimer } from '../../components/bits';
import { Badge, Button, Card, EmptyState, PageHeader, Pagination, SelectField, SortHeader, TextField, sortRows, usePaged, useSort } from '../../components/ui';
import { byWorst, departmentName, displayAssignment, itemCounts, nextAction, norm, readinessRank, worksiteCode, type ItemCounts, type NextAction } from './peopleData';

interface Row {
  emp: Employee;
  name: string;
  assignment: EmployeeAssignment | undefined;
  department: string;
  role: string;
  manager: string;
  readiness: Readiness[];
  counts: ItemCounts;
  worst: ReadinessState | null;
  next: NextAction | null;
}

type Situation = 'activos' | 'inactivos' | 'todos';

export function EmployeesPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const estado = (params.get('estado') ?? '') as ReadinessState | '';
  const centro = params.get('centro') ?? '';
  const departamento = params.get('departamento') ?? '';
  const puesto = params.get('puesto') ?? '';
  const situacion = (['activos', 'inactivos', 'todos'].includes(params.get('situacion') ?? '') ? params.get('situacion') : 'activos') as Situation;

  const all = useMemo<Row[]>(() => {
    const ids = visibleEmployeeIds(ctx);
    const readiness = visibleReadiness(ctx);
    return ctx.db.employees
      .filter((e) => e.companyId === ctx.company.id && ids.has(e.id))
      .map((emp) => {
        const assignment = displayAssignment(ctx.db, emp.id, ctx.today);
        const items = emp.status === 'active' ? itemsFor(ctx, emp.id) : [];
        const rs = byWorst(readiness.filter((r) => r.employeeId === emp.id));
        return {
          emp,
          name: `${emp.firstName} ${emp.lastName}`,
          assignment,
          department: departmentName(ctx.db, assignment?.departmentId),
          role: roleName(ctx.db, assignment?.jobRoleId),
          manager: employeeName(ctx.db, emp.managerEmployeeId),
          readiness: rs,
          counts: itemCounts(items),
          worst: rs[0]?.state ?? null,
          next: nextAction(ctx.db, rs, items),
        };
      });
  }, [ctx]);

  const sites = useMemo(() => {
    const vis = visibleWorksiteIds(ctx);
    return ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && vis.has(w.id)).sort((a, b) => a.code.localeCompare(b.code));
  }, [ctx]);
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);
  const roles = ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id);

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    return all.filter((r) => {
      if (situacion === 'activos' && r.emp.status !== 'active') return false;
      if (situacion === 'inactivos' && r.emp.status !== 'inactive') return false;
      if (needle && !norm(`${r.name} ${r.emp.code}`).includes(needle)) return false;
      if (departamento && r.assignment?.departmentId !== departamento) return false;
      if (puesto && r.assignment?.jobRoleId !== puesto) return false;
      if (centro && !r.assignment?.worksiteIds.includes(centro)) return false;
      if (estado && !r.readiness.some((x) => x.state === estado && (!centro || x.worksiteId === centro))) return false;
      return true;
    });
  }, [all, q, situacion, departamento, puesto, centro, estado]);

  const { sort, onSort } = useSort('readiness', 'asc');
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (r, col) => {
        switch (col) {
          case 'name': return r.name;
          case 'department': return r.department;
          case 'role': return r.role;
          case 'manager': return r.manager;
          case 'counted': return r.counts.counted;
          case 'accepted': return r.counts.accepted;
          case 'missing': return r.counts.missing;
          case 'awaiting': return r.counts.awaiting;
          case 'readiness': return r.emp.status === 'active' ? readinessRank(r.worst) : null;
          default: return r.name;
        }
      }),
    [filtered, sort],
  );
  const paged = usePaged(sorted, 25);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    paged.reset();
  };
  const clear = () => {
    setParams(new URLSearchParams(), { replace: true });
    paged.reset();
  };
  const hasFilters = !!(q || estado || centro || departamento || puesto || situacion !== 'activos');

  // Summary over the active people in scope (assignments = employee × worksite).
  const activeRows = all.filter((r) => r.emp.status === 'active');
  const assignments = activeRows.flatMap((r) => r.readiness);
  const stateCount = (s: ReadinessState) => assignments.filter((x) => x.state === s).length;
  const awaiting = activeRows.reduce((n, r) => n + r.counts.awaiting, 0);
  const isSupervisorView = !ctx.can('employees.view_all');

  return (
    <div className="stack people-area">
      <PageHeader
        title={t('Empleados')}
        subtitle={isSupervisorView ? t('Personas de su equipo y de los centros que coordina, con la disponibilidad según los requisitos configurados.') : t('Requisitos aplicables, evidencias y disponibilidad de cada persona por centro de trabajo.')}
      />

      <div className="kpis">
        <button type="button" className="kpi" onClick={() => setParam('estado', '')}>
          <span className="label">{t('Personas activas')}</span>
          <span className="value">{activeRows.length}</span>
          <span className="meta">{t('{n} asignaciones a centros', { n: assignments.length })}</span>
        </button>
        <button type="button" className="kpi" onClick={() => setParam('estado', 'ready')} aria-pressed={estado === 'ready'}>
          <span className="label">{t('Asignaciones listas')}</span>
          <span className="value">{stateCount('ready')}</span>
          <span className="meta">{t('Según los requisitos configurados')}</span>
        </button>
        <button type="button" className={`kpi ${stateCount('blocked') ? 'tone-danger' : ''}`} onClick={() => setParam('estado', 'blocked')} aria-pressed={estado === 'blocked'}>
          <span className="label">{t('Asignaciones bloqueadas')}</span>
          <span className="value">{stateCount('blocked')}</span>
          <span className="meta">{t('Con algún requisito crítico sin resolver')}</span>
        </button>
        <button type="button" className={`kpi ${awaiting ? 'tone-warning' : ''}`} onClick={() => setParam('estado', 'in_review')} aria-pressed={estado === 'in_review'}>
          <span className="label">{t('Evidencias en revisión')}</span>
          <span className="value">{awaiting}</span>
          <span className="meta">{t('Recibidas, pendientes de la autoridad de revisión')}</span>
        </button>
      </div>
      <ReadinessDisclaimer />

      <Card flush>
        <div className="toolbar" role="search">
          <TextField className="search" label={t('Buscar')} placeholder={t('Nombre o código')} value={q} onChange={(e) => setParam('q', e.target.value)} />
          <SelectField label={t('Departamento')} value={departamento} onChange={(e) => setParam('departamento', e.target.value)}>
            <option value="">{t('Todos')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </SelectField>
          <SelectField label={t('Centro de trabajo')} value={centro} onChange={(e) => setParam('centro', e.target.value)}>
            <option value="">{t('Todos')}</option>
            {sites.map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </SelectField>
          <SelectField label={t('Puesto')} value={puesto} onChange={(e) => setParam('puesto', e.target.value)}>
            <option value="">{t('Todos')}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </SelectField>
          <SelectField label={t('Disponibilidad')} value={estado} onChange={(e) => setParam('estado', e.target.value)}>
            <option value="">{t('Todos')}</option>
            {[...READINESS_ORDER].reverse().map((s) => (
              <option key={s} value={s}>{t(READINESS[s].label)}</option>
            ))}
          </SelectField>
          <SelectField label={t('Situación laboral')} value={situacion} onChange={(e) => setParam('situacion', e.target.value === 'activos' ? '' : e.target.value)}>
            <option value="activos">{t('Activos')}</option>
            <option value="inactivos">{t('Inactivos')}</option>
            <option value="todos">{t('Todos')}</option>
          </SelectField>
          {hasFilters && (
            <Button variant="ghost" onClick={clear}>
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <EmptyState icon={all.length ? Search : Users} title={all.length ? t('Ninguna persona coincide con los filtros') : t('No hay personas en su ámbito')}>
            {all.length ? t('Cambie o limpie los filtros. Las personas inactivas solo aparecen con el filtro «Situación laboral».') : t('Su rol no incluye personas visibles en esta empresa.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table people-table">
                <caption className="sr-only">{t('Directorio de empleados con requisitos, evidencias y disponibilidad')}</caption>
                <thead>
                  <tr>
                    <SortHeader label={t('Empleado/a')} col="name" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Puesto y departamento')} col="role" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Supervisor/a')} col="manager" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Aplicables')} col="counted" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('Aceptadas')} col="accepted" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('Por aportar')} col="missing" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('En revisión')} col="awaiting" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('Centros y disponibilidad')} col="readiness" sort={sort} onSort={onSort} />
                    <th>{t('Próxima acción')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <tr key={r.emp.id}>
                      <td className="emp-cell">
                        <Link to={`/empleados/${r.emp.id}`} className="strong">{r.name}</Link>
                        <div className="sub mono">{r.emp.code}</div>
                        <div className="sub">
                          <span className="sr-only">{t('Situación laboral')}: </span>
                          {r.emp.status === 'active' ? <Badge tone="success">{t('Activo')}</Badge> : <Badge tone="neutral">{t('Inactivo')}</Badge>}
                        </div>
                        {r.emp.status !== 'active' && r.emp.endDate && <div className="sub">{t('Baja: {date}', { date: formatDate(r.emp.endDate) })}</div>}
                      </td>
                      <td>
                        {r.role}
                        <div className="sub">{r.department}</div>
                      </td>
                      <td className="small">{r.manager}</td>
                      <td className="num">{r.emp.status === 'active' ? r.counts.counted : '—'}</td>
                      <td className="num">{r.emp.status === 'active' ? r.counts.accepted : '—'}</td>
                      <td className="num">{r.emp.status === 'active' ? <span className={r.counts.missing ? 'strong' : ''}>{r.counts.missing}</span> : '—'}</td>
                      <td className="num">{r.emp.status === 'active' ? r.counts.awaiting : '—'}</td>
                      <td>
                        {r.readiness.length ? (
                          <ul className="readiness-list">
                            {r.readiness.map((x) => (
                              <li key={x.worksiteId}>
                                <span className="small site-name" title={worksiteName(ctx.db, x.worksiteId)}>
                                  <span className="tag">{worksiteCode(ctx.db, x.worksiteId)}</span> {worksiteName(ctx.db, x.worksiteId)}
                                </span>
                                <ReadinessBadge state={x.state} />
                              </li>
                            ))}
                          </ul>
                        ) : r.assignment?.worksiteIds.length ? (
                          <ul className="readiness-list">
                            {r.assignment.worksiteIds.map((w) => (
                              <li key={w}>
                                <span className="small site-name">
                                  <span className="tag">{worksiteCode(ctx.db, w)}</span> {worksiteName(ctx.db, w)}
                                </span>
                                <span className="muted tiny">{r.emp.status === 'active' ? t('Sin asignación vigente') : t('No se calcula (inactivo)')}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted small">{t('Sin asignación vigente')}</span>
                        )}
                      </td>
                      <td className="next-action">
                        {r.next ? (
                          <>
                            <div className="small">{msg(r.next.action)}</div>
                            {r.next.owner && <div className="sub">{t('Responsable: {owner}', { owner: t(r.next.owner) })}</div>}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>
    </div>
  );
}
