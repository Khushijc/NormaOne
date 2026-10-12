import { Building2, Handshake } from 'lucide-react';
import { Badge, Callout, Card, DateText, EmptyState, KV } from '../../components/ui';
import { MODALITY_LABEL, SPECIALTY_LABEL } from '../../domain/status';
import type { PreventionProvider } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { useCtx } from '../../store/hooks';

const PROVIDER_KIND: Record<PreventionProvider['kind'], string> = {
  spa: tKey('Servicio de prevención ajeno (SPA)'),
  medical: tKey('Servicio médico'),
  training: tKey('Entidad formativa'),
  other: tKey('Otro proveedor'),
};

/** Company data and how prevention is organised: recorded by the company, never decided by the app. */
export function SettingsCompanyTab() {
  const ctx = useCtx();
  const c = ctx.company;
  const providers = ctx.db.providers.filter((p) => p.companyId === c.id);
  const linkedUsers = (providerId: string) =>
    ctx.db.memberships
      .filter((m) => m.companyId === c.id && m.providerId === providerId)
      .map((m) => ({ m, name: ctx.db.users.find((u) => u.id === m.userId)?.name ?? m.userId }));

  return (
    <div className="stack">
      <div className="grid-2">
        <Card title={<h2 className="row"><Building2 size={16} aria-hidden /> {t('Datos de la empresa')}</h2>}>
          <KV
            items={[
              [t('Razón social [empresa]'), c.legalName],
              [t('Nombre comercial'), c.tradeName],
              ['NIF', <span className="mono">{c.nif}</span>],
              [t('Actividad'), c.activity],
              [t('Provincia'), c.province],
              [t('Plantilla [personas]'), t('{n} personas', { n: c.employeeCount })],
              [t('Zona horaria [empresa]'), <span className="mono">{c.timezone}</span>],
              [t('Delegados de prevención'), c.hasPreventionDelegates ? t('Sí, hay delegados de prevención') : t('No constan delegados de prevención')],
            ]}
          />
          <p className="tiny muted control-gap">{t('Los datos de la empresa se mantienen en la plataforma común del portal; aquí son de solo lectura.')}</p>
        </Card>

        <Card title={t('Modalidad de organización preventiva')}>
          <div className="stack-sm">
            <div className="row-wrap">
              {c.preventionModality.length === 0 ? (
                <span className="muted small">{t('No registrada')}</span>
              ) : (
                c.preventionModality.map((m) => (
                  <Badge key={m} tone="info" icon={false}>
                    {t(MODALITY_LABEL[m])}
                  </Badge>
                ))
              )}
            </div>
            {c.preventionNote && <p className="small">{c.preventionNote}</p>}
            <Callout tone="neutral">
              {t('La modalidad la registra la empresa (LPRL arts. 30–31; RD 39/1997). La aplicación no la decide ni valida si es la adecuada: solo la usa para mostrar quién revisa cada evidencia.')}
            </Callout>
          </div>
        </Card>
      </div>

      <Card flush title={<h2 className="row"><Handshake size={16} aria-hidden /> {t('Servicios de prevención y proveedores')}</h2>}>
        {providers.length === 0 ? (
          <EmptyState icon={Handshake} title={t('No hay proveedores registrados')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Servicios de prevención y proveedores')}</caption>
              <thead>
                <tr>
                  <th>{t('Proveedor')}</th>
                  <th>{t('Especialidades [prevención]')}</th>
                  <th>{t('Referencia del contrato')}</th>
                  <th>{t('Vigencia [periodo]')}</th>
                  <th>{t('Contacto')}</th>
                  <th>{t('Usuarios vinculados')}</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  const expired = !!p.contractValidUntil && p.contractValidUntil < ctx.today;
                  const users = linkedUsers(p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="strong">{p.name}</span>
                        <div className="sub">{t(PROVIDER_KIND[p.kind])}</div>
                      </td>
                      <td>
                        {p.specialties.length === 0 ? (
                          <span className="muted small">{t('Sin especialidades preventivas')}</span>
                        ) : (
                          <div className="status-stack">
                            {p.specialties.map((s) => (
                              <Badge key={s} tone="neutral" icon={false}>
                                {t(SPECIALTY_LABEL[s])}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="small">{p.contractReference}</td>
                      <td className="small">
                        {p.contractValidUntil ? (
                          <>
                            {t('Hasta [periodo]')} <DateText date={p.contractValidUntil} />
                            {expired && (
                              <div>
                                <Badge tone="danger">{t('Contrato vencido')}</Badge>
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="muted">{t('Sin fecha de fin registrada')}</span>
                        )}
                      </td>
                      <td className="small">
                        {p.contactName}
                        <div className="sub control-break">{p.contactEmail}</div>
                      </td>
                      <td className="small">
                        {users.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          users.map(({ m, name }) => (
                            <div key={m.id}>
                              {name}
                              {m.status === 'revoked' && <span className="muted"> ({t('revocado')})</span>}
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer tiny muted">
          {t('Un contrato vencido no revoca por sí solo los accesos: revíselos en la pestaña «Accesos». Las especialidades indican quién puede revisar cada tipo de evidencia; no sustituyen al concierto.')}
        </div>
      </Card>
    </div>
  );
}
