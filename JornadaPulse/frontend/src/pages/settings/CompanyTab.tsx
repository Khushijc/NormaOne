/**
 * Company master data (read-only here: it comes from the shared portal platform, PLT-02),
 * with its departments and worksites.
 */
import type { Company } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { useCtx } from '../../store/hooks';
import { Badge, Callout, Card, EmptyState, KV } from '../../components/ui';

const REPRESENTATION_LABEL: Record<Company['workerRepresentation'], string> = {
  delegados: tKey('Delegados de personal'),
  comite: tKey('Comité de empresa'),
  none: tKey('Sin representación legal de los trabajadores'),
};

export function CompanyTab() {
  const ctx = useCtx();
  const c = ctx.company;
  const employees = ctx.db.employees.filter((e) => e.companyId === c.id);
  const departments = ctx.db.departments.filter((d) => d.companyId === c.id);
  const sites = ctx.db.worksites.filter((w) => w.companyId === c.id);
  const calendar = (id: string) => ctx.db.calendars.find((x) => x.id === id)?.name ?? '—';
  return (
    <div className="stack">
      <Callout tone="neutral">{t('Los datos de la empresa proceden de la plataforma común del portal y se comparten con los demás módulos. Aquí son de solo lectura.')}</Callout>
      <div className="grid-2">
        <Card title={t('Datos de la empresa')}>
          <KV
            items={[
              [t('Razón social'), c.legalName],
              [t('Nombre comercial'), c.tradeName],
              ['NIF', <span className="mono">{c.nif}</span>],
              [t('Actividad'), c.activity],
              [t('Provincia'), c.province],
              [t('Zona horaria de referencia'), <span className="mono">{c.timezone}</span>],
              [t('Plantilla declarada'), t('{n} personas', { n: c.employeeCount })],
              [t('Representación de los trabajadores'), t(REPRESENTATION_LABEL[c.workerRepresentation])],
            ]}
          />
          <p className="tiny muted settings-gap">
            {c.workerRepresentation === 'none'
              ? t('Sin representación legal, el protocolo de registro se decide por la empresa; no hay consulta previa que documentar.')
              : t('Con representación legal, los cambios del protocolo de registro requieren consulta previa (ET art. 34.9) y la representación tiene acceso a los registros.')}
          </p>
        </Card>
        <Card title={t('Departamentos')} flush>
          {departments.length === 0 ? (
            <EmptyState title={t('Sin departamentos')} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">{t('Departamentos')}</caption>
                <thead>
                  <tr>
                    <th>{t('Departamento')}</th>
                    <th className="num">{t('Personas activas')}</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td className="num">{employees.filter((e) => e.departmentId === d.id && e.status === 'active').length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <Card title={t('Centros de trabajo')} flush>
        {sites.length === 0 ? (
          <EmptyState title={t('Sin centros de trabajo')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Centros de trabajo')}</caption>
              <thead>
                <tr>
                  <th>{t('Centro')}</th>
                  <th>{t('Tipo')}</th>
                  <th>{t('Dirección')}</th>
                  <th>{t('Calendario laboral')}</th>
                  <th className="num">{t('Personas asignadas')}</th>
                  <th>{t('Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((w) => (
                  <tr key={w.id}>
                    <td className="strong">{w.name}</td>
                    <td>
                      <Badge tone={w.kind === 'own' ? 'info' : 'neutral'} icon={false}>{w.kind === 'own' ? t('Centro propio') : t('Centro de cliente')}</Badge>
                    </td>
                    <td className="small">
                      {w.address}
                      <div className="sub">{w.city}</div>
                    </td>
                    <td className="small">{calendar(w.calendarId)}</td>
                    <td className="num">{employees.filter((e) => e.status === 'active' && e.worksiteIds.includes(w.id)).length}</td>
                    <td>
                      <Badge tone={w.active ? 'success' : 'neutral'}>{w.active ? t('Activo') : t('Inactivo')}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer tiny muted">{t('Los festivos se aplican según el calendario del centro. En los centros de clientes la persona trabajadora registra su jornada igual que en un centro propio.')}</div>
      </Card>
    </div>
  );
}
