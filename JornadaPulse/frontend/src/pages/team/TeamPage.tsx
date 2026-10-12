/**
 * Equipo (spec §15): employee directory limited to the caller's scope (supervisors: direct
 * reports and themselves; HR, owner and payroll adviser: the whole company). Only
 * `employees.manage` can register a new employee; everybody else gets a read-only view.
 */
import { Search, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WORKDAY_LABEL } from '../../domain/status';
import type { Employee, WorkdayType } from '../../domain/types';
import { t } from '../../i18n';
import { visibleEmployeeIds } from '../../services/context';
import { createEmployee, validateEmployee, validateRelationship } from '../../services/planningService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { Badge, Button, Callout, Card, EmptyState, Modal, PageHeader, Pagination, SortHeader, sortRows, useAction, usePaged, useSort } from '../../components/ui';
import { emptyIdentity, emptyRel, fmtNum, GeneralErrors, IdentityFields, mapErrors, RelationshipFields, toEmployeeInput, toRelationshipInput, type FieldErrors, type IdentityState, type RelState } from './employeeForms';
import { currentRelationship, openItemsByEmployee, TODAY_STATE, todayState, type TodayState } from './teamData';

interface Row {
  e: Employee;
  name: string;
  department: string;
  site: string;
  siteCount: number;
  workday: WorkdayType | null;
  pct: number | null;
  reducedPct: number | null;
  hours: number | null;
  manager: string;
  today: TodayState;
  corrections: number;
  anomalies: number;
}

const EMPTY_FILTERS = { q: '', dep: '', site: '', status: '', workday: '' };

export function TeamPage() {
  const ctx = useCtx();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [creating, setCreating] = useState(false);
  const { sort, onSort } = useSort('name', 'asc');
  const canManage = ctx.can('employees.manage');
  const companyWide = ctx.can('employees.view_all');

  const rows = useMemo<Row[]>(() => {
    const ids = visibleEmployeeIds(ctx);
    const items = openItemsByEmployee(ctx);
    const dep = new Map(ctx.db.departments.map((d) => [d.id, d.name]));
    const site = new Map(ctx.db.worksites.map((w) => [w.id, w.name]));
    const emp = new Map(ctx.db.employees.map((e) => [e.id, e]));
    return ctx.db.employees
      .filter((e) => e.companyId === ctx.company.id && ids.has(e.id))
      .map((e) => {
        const rel = currentRelationship(ctx.db, e.id, ctx.today);
        const m = e.managerEmployeeId ? emp.get(e.managerEmployeeId) : undefined;
        const open = items.get(e.id);
        return {
          e,
          name: `${e.firstName} ${e.lastName}`,
          department: dep.get(e.departmentId) ?? '—',
          site: site.get(e.primaryWorksiteId) ?? '—',
          siteCount: e.worksiteIds.length,
          workday: rel?.workdayType ?? null,
          pct: rel?.partTimePct ?? null,
          reducedPct: rel?.reducedHours?.pct ?? null,
          hours: rel?.weeklyHours ?? null,
          manager: m ? `${m.firstName} ${m.lastName}` : '—',
          today: e.status === 'active' ? todayState(ctx.db, e.id, ctx.today) : 'none',
          corrections: open?.corrections ?? 0,
          anomalies: open?.anomalies ?? 0,
        };
      });
  }, [ctx]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && ![r.name, r.e.code, r.e.jobTitle, r.e.workEmail, r.department].some((x) => x.toLowerCase().includes(q))) return false;
      if (filters.dep && r.e.departmentId !== filters.dep) return false;
      if (filters.site && !r.e.worksiteIds.includes(filters.site)) return false;
      if (filters.status && r.e.status !== filters.status) return false;
      if (filters.workday && r.workday !== filters.workday) return false;
      return true;
    });
  }, [rows, filters]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (r, col) => {
        switch (col) {
          case 'name': return r.name;
          case 'code': return r.e.code;
          case 'department': return r.department;
          case 'site': return r.site;
          case 'job': return r.e.jobTitle;
          case 'workday': return r.workday ? `${r.workday}-${String(r.pct ?? 100).padStart(3, '0')}` : null;
          case 'hours': return r.hours;
          case 'manager': return r.manager;
          case 'status': return r.e.status;
          case 'today': return TODAY_STATE[r.today].order;
          case 'open': return r.corrections + r.anomalies;
          default: return null;
        }
      }),
    [filtered, sort],
  );
  const paged = usePaged(sorted);
  const set = (k: keyof typeof EMPTY_FILTERS, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    paged.reset();
  };
  const active = Object.values(filters).some(Boolean);
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);
  const sites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id);
  const activeCount = rows.filter((r) => r.e.status === 'active').length;
  const workingNow = rows.filter((r) => r.today === 'working' || r.today === 'on_break').length;

  return (
    <div className="stack team-area">
      <PageHeader
        title={t('Equipo')}
        subtitle={companyWide ? t('Plantilla de {company}: fichas, condiciones laborales vigentes y estado de hoy.', { company: ctx.company.tradeName }) : t('Su equipo directo y usted: fichas, condiciones laborales vigentes y estado de hoy.')}
        actions={
          canManage ? (
            <Button variant="primary" icon={UserPlus} onClick={() => setCreating(true)}>
              {t('Nuevo empleado')}
            </Button>
          ) : null
        }
      />

      {!canManage && (
        <Callout tone="neutral" title={t('Consulta en modo lectura')}>
          {companyWide ? t('Su rol permite consultar la plantilla, pero no dar de alta, modificar ni desactivar empleados. Esas acciones corresponden a Administración de RR. HH.') : t('Como supervisor/a ve a las personas que dependen directamente de usted. Las altas y cambios de condiciones los gestiona RR. HH.')}
        </Callout>
      )}

      <div className="team-summary small muted" aria-live="polite">
        {t('{n} personas en su ámbito · {active} activas · {working} con sesión abierta ahora', { n: rows.length, active: activeCount, working: workingNow })}
      </div>

      <Card flush>
        <div className="toolbar" role="search" aria-label={t('Filtros de empleados')}>
          <div className="field search">
            <label htmlFor="team-q">{t('Buscar')}</label>
            <input id="team-q" className="input" type="search" placeholder={t('Nombre, código, puesto o correo')} value={filters.q} onChange={(e) => set('q', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="team-dep">{t('Departamento')}</label>
            <select id="team-dep" className="select" value={filters.dep} onChange={(e) => set('dep', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="team-site">{t('Centro de trabajo')}</label>
            <select id="team-site" className="select" value={filters.site} onChange={(e) => set('site', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {sites.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="team-status">{t('Estado')}</label>
            <select id="team-status" className="select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">{t('Todos')}</option>
              <option value="active">{t('Activo')}</option>
              <option value="inactive">{t('Inactivo')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="team-wd">{t('Tipo de jornada')}</label>
            <select id="team-wd" className="select" value={filters.workday} onChange={(e) => set('workday', e.target.value)}>
              <option value="">{t('Todas')}</option>
              {(Object.keys(WORKDAY_LABEL) as WorkdayType[]).map((k) => (
                <option key={k} value={k}>{t(WORKDAY_LABEL[k])}</option>
              ))}
            </select>
          </div>
          {active && (
            <Button
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                paged.reset();
              }}
            >
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <EmptyState icon={rows.length ? Search : Users} title={rows.length ? t('Ningún empleado coincide con los filtros') : t('No hay empleados en su ámbito')}>
            {rows.length ? t('Cambie o limpie los filtros para ver más resultados.') : t('Cuando haya personas asignadas a su equipo aparecerán aquí.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table team-table">
                <caption className="sr-only">{t('Directorio de empleados')}</caption>
                <thead>
                  <tr>
                    <SortHeader label={t('Empleado')} col="name" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Departamento')} col="department" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Centro principal')} col="site" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Puesto')} col="job" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Jornada')} col="workday" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Horas/semana')} col="hours" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('Responsable')} col="manager" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Hoy')} col="today" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Pendientes')} col="open" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <tr key={r.e.id} className={r.e.status === 'inactive' ? 'team-inactive' : undefined}>
                      <td>
                        <Link to={`/equipo/${r.e.id}`} className="strong">{r.name}</Link>
                        <div className="sub mono">{r.e.code}</div>
                      </td>
                      <td>{r.department}</td>
                      <td>
                        {r.site}
                        {r.siteCount > 1 && <div className="sub">{t('y {n} más', { n: r.siteCount - 1 })}</div>}
                      </td>
                      <td>{r.e.jobTitle || '—'}</td>
                      <td>
                        {r.workday ? t(WORKDAY_LABEL[r.workday]) : '—'}
                        {r.workday === 'part_time' && r.pct !== null && <div className="sub">{fmtNum(r.pct)} %</div>}
                        {r.reducedPct !== null && <div className="sub">{t('Reducción {pct} %', { pct: fmtNum(r.reducedPct) })}</div>}
                      </td>
                      <td className="num">{r.hours !== null ? `${fmtNum(r.hours)} h` : '—'}</td>
                      <td>{r.manager}</td>
                      <td>
                        <Badge tone={r.e.status === 'active' ? 'success' : 'neutral'}>{r.e.status === 'active' ? t('Activo') : t('Inactivo')}</Badge>
                      </td>
                      <td>{r.e.status === 'active' ? <Badge tone={TODAY_STATE[r.today].tone} title={t(TODAY_STATE[r.today].help)}>{t(TODAY_STATE[r.today].label)}</Badge> : <span className="muted">—</span>}</td>
                      <td>
                        {r.corrections + r.anomalies === 0 ? (
                          <span className="muted small">{t('Nada pendiente')}</span>
                        ) : (
                          <div className="status-stack">
                            {r.corrections > 0 && <Badge tone="warning" title={t('Solicitudes de corrección pendientes de decisión o de conformidad')}>{t('Correcciones: {n}', { n: r.corrections })}</Badge>}
                            {r.anomalies > 0 && <Badge tone="accent" title={t('Indicadores de revisión configurables; no son conclusiones.')}>{t('Indicadores: {n}', { n: r.anomalies })}</Badge>}
                          </div>
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

      <p className="tiny muted">
        {t('El estado de hoy procede solo de los fichajes registrados: los turnos planificados y las ausencias no se convierten en tiempo trabajado. Las fichas desactivadas se conservan con sus registros durante cuatro años.')}
      </p>

      {creating && <NewEmployeeModal ctx={ctx} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewEmployeeModal({ ctx, onClose }: { ctx: UiCtx; onClose: () => void }) {
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const [identity, setIdentity] = useState<IdentityState>(() => emptyIdentity(ctx));
  const [rel, setRel] = useState<RelState>(() => emptyRel(ctx));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string[]>([]);

  const submit = async () => {
    const input = toEmployeeInput(identity);
    const relInput = toRelationshipInput({ ...rel, effectiveFrom: identity.hireDate });
    const messages = [...validateEmployee(ctx, input, null), ...validateRelationship(ctx, relInput)];
    // The relationship starts on the hire date, so a date error belongs to that field.
    const mapped = mapErrors(messages, { 'Indique la fecha de efecto.': 'hireDate' });
    setErrors(mapped.fields);
    setGeneral(mapped.general);
    if (messages.length) return;
    const created = await run(() => createEmployee(input, relInput), (e) => t('Alta registrada: {name} ({code})', { name: `${e.firstName} ${e.lastName}`, code: e.code }));
    if (created) {
      onClose();
      navigate(`/equipo/${created.id}`);
    }
  };

  return (
    <Modal
      wide
      title={t('Nuevo empleado')}
      description={t('Ficha de identificación y condiciones laborales iniciales. Las condiciones empiezan en la fecha de alta y quedan versionadas.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" icon={UserPlus} loading={pending} onClick={submit}>
            {t('Dar de alta')}
          </Button>
        </>
      }
    >
      <Callout tone="info" title={t('Minimización de datos')}>
        {t('Para el registro de jornada no se recogen el DNI/NIE, la dirección personal, la fecha de nacimiento ni datos de salud. Esos datos pertenecen a la gestión de nóminas.')}
      </Callout>
      <GeneralErrors items={general} />
      <h3>{t('Identificación')}</h3>
      <IdentityFields ctx={ctx} value={identity} onChange={setIdentity} errors={errors} selfId={null} />
      <h3>{t('Relación laboral inicial')}</h3>
      <RelationshipFields ctx={ctx} value={rel} onChange={setRel} errors={errors} showEffectiveFrom={false} />
      <p className="tiny muted">{t('La ficha se crea sin cuenta de usuario: el acceso a la aplicación se gestiona en la plataforma del portal.')}</p>
    </Modal>
  );
}
