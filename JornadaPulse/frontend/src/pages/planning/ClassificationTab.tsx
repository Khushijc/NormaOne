/**
 * "Clasificación de jornada": employment terms in force today (effective-dated relationships,
 * TIM-01). Read-only; changes are made as a new version in the employee's record (/equipo/:id).
 */
import { Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmployeeLink } from '../../components/bits';
import { Badge, Callout, Card, Checkbox, DateText, EmptyState, Pagination, SelectField, SortHeader, sortRows, usePaged, useSort } from '../../components/ui';
import { relationshipOn } from '../../domain/records';
import { WORKDAY_LABEL } from '../../domain/status';
import { formatDate } from '../../domain/time';
import type { Employee, EmploymentRelationship } from '../../domain/types';
import { t } from '../../i18n';
import { can, teamIds } from '../../services/context';
import { useCtx } from '../../store/hooks';
import { fullName } from './shared';

const LEY_4_2026_DATE = '2026-10-23';

interface Row {
  e: Employee;
  rel: EmploymentRelationship | undefined;
  next: EmploymentRelationship | undefined;
  dept: string;
  policy: string;
}

export function ClassificationTab() {
  const ctx = useCtx();
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const [inactive, setInactive] = useState(false);
  const { sort, onSort } = useSort('name', 'asc');

  const all = useMemo<Row[]>(() => {
    const team = teamIds(ctx);
    const scoped = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && (can(ctx, 'employees.view_all') || (can(ctx, 'employees.view_team') && (team.has(e.id) || ctx.employee?.id === e.id))));
    return scoped.map((e) => {
      const rel = relationshipOn(ctx.db, e.id, ctx.today);
      const next = ctx.db.relationships.filter((r) => r.employeeId === e.id && r.effectiveFrom > ctx.today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
      const policy = rel ? ctx.db.policies.find((p) => p.companyId === ctx.company.id && p.key === rel.policyKey)?.name ?? rel.policyKey : '—';
      return { e, rel, next, dept: ctx.db.departments.find((d) => d.id === e.departmentId)?.name ?? '—', policy };
    });
  }, [ctx]);

  const filtered = all.filter((r) => (inactive || r.e.status === 'active') && (!dept || r.e.departmentId === dept) && (!type || r.rel?.workdayType === type));
  const sorted = sortRows(filtered, sort, (r, col) => {
    switch (col) {
      case 'name': return fullName(r.e);
      case 'dept': return r.dept;
      case 'type': return r.rel?.workdayType ?? null;
      case 'hours': return r.rel?.weeklyHours ?? null;
      case 'pct': return r.rel?.partTimePct ?? null;
      case 'policy': return r.policy;
      case 'from': return r.rel?.effectiveFrom ?? null;
      default: return null;
    }
  });
  const paged = usePaged(sorted, 25);
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id);

  return (
    <div className="stack">
      <Callout tone="info" title={t('Condiciones vigentes hoy ({date})', { date: formatDate(ctx.today) })}>
        {t('Las horas contratadas no son horas planificadas ni horas registradas. Los cambios se registran como una nueva versión con fecha de efecto en la ficha de cada persona (Equipo); las versiones anteriores se conservan y los registros ya realizados no se recalculan.')}
      </Callout>
      <Callout tone="neutral" title={t('Reducción de jornada por cuidado (ET art. 37.6)')}>
        {t('La Ley 4/2026 modifica el artículo 37.6 del Estatuto de los Trabajadores con efecto el {date}. Se muestra como información: la reducción se guarda como dato de las condiciones laborales y JornadaPulse no recalcula nada automáticamente. Revise con la asesoría laboral las reducciones afectadas.', { date: formatDate(LEY_4_2026_DATE) })}
      </Callout>

      <Card flush title={t('Clasificación de jornada')}>
        <div className="toolbar">
          <SelectField label={t('Departamento')} value={dept} onChange={(e) => { setDept(e.target.value); paged.reset(); }}>
            <option value="">{t('Todos')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </SelectField>
          <SelectField label={t('Tipo de jornada')} value={type} onChange={(e) => { setType(e.target.value); paged.reset(); }}>
            <option value="">{t('Todos')}</option>
            <option value="full_time">{t(WORKDAY_LABEL.full_time)}</option>
            <option value="part_time">{t(WORKDAY_LABEL.part_time)}</option>
          </SelectField>
          <Checkbox label={t('Incluir personas dadas de baja')} checked={inactive} onChange={(v) => { setInactive(v); paged.reset(); }} />
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={Users} title={t('No hay personas con estos filtros')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label={t('Persona')} col="name" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Departamento')} col="dept" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Tipo de jornada')} col="type" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Horas semanales contratadas')} col="hours" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('% de parcialidad')} col="pct" sort={sort} onSort={onSort} num />
                    <th scope="col">{t('Reducción de jornada')}</th>
                    <th scope="col">{t('Trabajo a distancia')}</th>
                    <SortHeader label={t('Política de jornada')} col="policy" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Vigente desde')} col="from" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map(({ e, rel, next, dept: deptName, policy }) => (
                    <tr key={e.id}>
                      <td>
                        <EmployeeLink id={e.id} />
                        <div className="tiny muted">{e.code}</div>
                        {e.status !== 'active' && <Badge tone="neutral">{t('Baja')}</Badge>}
                      </td>
                      <td className="small">{deptName}</td>
                      {rel ? (
                        <>
                          <td><Badge tone={rel.workdayType === 'part_time' ? 'accent' : 'neutral'} icon={false}>{t(WORKDAY_LABEL[rel.workdayType])}</Badge></td>
                          <td className="num">{rel.weeklyHours} h</td>
                          <td className="num">{rel.partTimePct !== null ? `${rel.partTimePct} %` : '—'}</td>
                          <td className="small">
                            {rel.reducedHours ? (
                              <>
                                <div className="strong">{t('{pct} % de reducción', { pct: rel.reducedHours.pct })}</div>
                                <div className="tiny muted">{rel.reducedHours.basis}</div>
                              </>
                            ) : (
                              <span className="muted">{t('No')}</span>
                            )}
                          </td>
                          <td>{rel.remoteAllowed ? t('Permitido') : <span className="muted">{t('No')}</span>}</td>
                          <td className="small">
                            <div>{policy}</div>
                            <div className="tiny muted mono">{rel.policyKey}</div>
                          </td>
                          <td>
                            <DateText date={rel.effectiveFrom} />
                            {next && <div><Badge tone="info">{t('Cambio programado: {date}', { date: formatDate(next.effectiveFrom) })}</Badge></div>}
                          </td>
                        </>
                      ) : (
                        <td colSpan={7} className="muted small">{t('Sin condiciones laborales vigentes hoy.')}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
        <div className="card-footer tiny muted">
          {t('Solo lectura: las condiciones se cambian en la ficha de cada persona.')} <Link to="/equipo">{t('Ir a Equipo')}</Link>
        </div>
      </Card>
    </div>
  );
}
