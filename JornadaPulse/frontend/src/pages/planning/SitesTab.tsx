/**
 * "Centros y departamentos": read-only view of worksites and departments of the active company.
 */
import { Building2, Network } from 'lucide-react';
import { Badge, Callout, Card, EmptyState } from '../../components/ui';
import { t } from '../../i18n';
import { useCtx } from '../../store/hooks';
import { WORKSITE_KIND_LABEL } from './shared';

export function SitesTab() {
  const ctx = useCtx();
  const employees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active');
  const worksites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'es') : a.kind === 'own' ? -1 : 1));
  const departments = ctx.db.departments.filter((d) => d.companyId === ctx.company.id).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const calendarName = (id: string) => ctx.db.calendars.find((c) => c.id === id)?.name ?? '—';

  return (
    <div className="stack">
      <Callout tone="neutral">{t('Consulta de solo lectura. Los recuentos incluyen solo a las personas activas; un centro de cliente es el lugar donde se presta el servicio, no un empleador.')}</Callout>
      <Card flush title={t('Centros de trabajo')}>
        {worksites.length === 0 ? (
          <EmptyState icon={Building2} title={t('No hay centros de trabajo')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('Centro')}</th>
                  <th scope="col">{t('Tipo')}</th>
                  <th scope="col">{t('Dirección')}</th>
                  <th scope="col">{t('Zona horaria')}</th>
                  <th scope="col">{t('Calendario laboral')}</th>
                  <th scope="col" className="num">{t('Personas asignadas')}</th>
                  <th scope="col" className="num">{t('Como centro principal')}</th>
                </tr>
              </thead>
              <tbody>
                {worksites.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <div className="strong">{w.name}</div>
                      {!w.active && <Badge tone="neutral">{t('Inactivo')}</Badge>}
                    </td>
                    <td><Badge tone={w.kind === 'own' ? 'info' : 'accent'} icon={false}>{t(WORKSITE_KIND_LABEL[w.kind])}</Badge></td>
                    <td className="small">
                      <div>{w.address}</div>
                      <div className="muted">{w.city}</div>
                    </td>
                    <td className="small mono">{w.timezone}</td>
                    <td className="small">{calendarName(w.calendarId)}</td>
                    <td className="num">{employees.filter((e) => e.worksiteIds.includes(w.id)).length}</td>
                    <td className="num">{employees.filter((e) => e.primaryWorksiteId === w.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card flush title={t('Departamentos')}>
        {departments.length === 0 ? (
          <EmptyState icon={Network} title={t('No hay departamentos')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('Departamento')}</th>
                  <th scope="col" className="num">{t('Personas activas')}</th>
                  <th scope="col" className="num">{t('A tiempo parcial')}</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => {
                  const people = employees.filter((e) => e.departmentId === d.id);
                  const partTime = people.filter((e) => ctx.db.relationships.some((r) => r.employeeId === e.id && r.workdayType === 'part_time' && r.effectiveFrom <= ctx.today && (!r.effectiveTo || r.effectiveTo >= ctx.today))).length;
                  return (
                    <tr key={d.id}>
                      <td className="strong">{d.name}</td>
                      <td className="num">{people.length}</td>
                      <td className="num">{partTime}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
