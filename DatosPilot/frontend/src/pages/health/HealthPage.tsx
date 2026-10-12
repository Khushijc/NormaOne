/**
 * Aptitud y vigilancia de la salud (`/salud`) — restricted area (LPRL art. 22; GDPR art. 9).
 * Reached only through HealthGuard (health.view_conclusions or health.manage). The portal keeps
 * offers, responses and the minimum fitness conclusion with operational measures; never
 * diagnoses or clinical reports. Nothing rendered here is reused by other screens.
 */
import { History, Lock, ShieldAlert } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { Badge, Button, Callout, Card, PageHeader, Tabs } from '../../components/ui';
import type { ID } from '../../domain/types';
import { t } from '../../i18n';
import { healthRows, quarantineRows } from '../../services/healthService';
import { useCtx } from '../../store/hooks';
import { ConclusionsTab } from './HealthConclusions';
import { OffersTab } from './HealthOffers';
import { QuarantineTab } from './HealthQuarantine';

type TabId = 'conclusiones' | 'ofertas' | 'cuarentena';

export function HealthPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const manage = ctx.can('health.manage');
  const raw = params.get('tab');
  const tab: TabId = raw === 'ofertas' || raw === 'cuarentena' ? raw : 'conclusiones';
  const rows = useMemo(() => healthRows(ctx), [ctx]);
  const quarantine = useMemo(() => quarantineRows(ctx), [ctx]);
  const requested = params.get('empleado') ?? '';
  const employeeId = requested && rows.some((r) => r.employee.id === requested) ? requested : '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const onEmployee = (id: ID) => setParam('empleado', id);

  const counts = {
    conclusions: rows.filter((r) => r.conclusion).length,
    pendingOffers: rows.filter((r) => r.offer?.response === 'pending').length,
    quarantined: quarantine.filter((x) => x.q.status === 'quarantined').length,
  };

  return (
    <>
      <PageHeader
        title={t('Aptitud y vigilancia de la salud')}
        subtitle={t('Ofertas de vigilancia de la salud, respuestas de la persona trabajadora y conclusiones mínimas de aptitud con sus medidas operativas.')}
        actions={
          <Badge tone="danger" icon={Lock}>
            {t('Área restringida')}
          </Badge>
        }
      />
      <div className="stack">
        <section className="health-banner" aria-labelledby="health-banner-title">
          <ShieldAlert size={22} aria-hidden className="health-banner-icon" />
          <div className="grow stack-sm">
            <h2 id="health-banner-title" className="health-banner-title">
              {t('Área restringida: datos relativos a la salud (LPRL art. 22; RGPD art. 9)')}
            </h2>
            <p className="small">{t('El portal guarda únicamente las ofertas, las respuestas y la conclusión mínima de aptitud (apto/a, apto/a con medidas preventivas, no apto/a temporalmente, no apto/a) con las medidas operativas que debe aplicar la empresa.')}</p>
            <ul className="health-banner-list small">
              <li>{t('No se registran diagnósticos, pruebas, tratamientos ni informes clínicos.')}</li>
              <li>{t('La historia clínico-laboral la custodia el servicio médico; aquí solo consta su referencia externa.')}</li>
              <li>{t('Cada consulta, cambio e intento de acceso denegado queda en la auditoría restringida.')}</li>
              <li>{t('Nada de esta área aparece en otras pantallas: fuera de aquí solo se muestra «Detalle restringido».')}</li>
            </ul>
            <div className="row-wrap small">
              <Badge tone={manage ? 'accent' : 'info'} icon={false}>
                {manage ? t('Su acceso: personal sanitario') : t('Su acceso: coordinación de PRL')}
              </Badge>
              <span className="muted">
                {manage
                  ? t('Puede registrar ofertas, respuestas y conclusiones, consultar la referencia clínica externa y gestionar la cuarentena.')
                  : t('Puede consultar conclusiones, registrar ofertas y respuestas y confirmar medidas aplicadas. Registrar conclusiones, consultar la referencia clínica y gestionar la cuarentena corresponde al servicio médico.')}
              </span>
            </div>
          </div>
        </section>

        {requested && !employeeId && (
          <Callout tone="warning" title={t('Empleado no disponible')}>
            {t('La persona indicada no existe, no está activa o está fuera de su ámbito.')}{' '}
            <Button size="sm" variant="ghost" onClick={() => setParam('empleado', '')}>
              {t('Ver todas las personas')}
            </Button>
          </Callout>
        )}

        <div>
          <Tabs<TabId>
            label={t('Secciones del área de salud')}
            value={tab}
            onChange={(v) => setParam('tab', v === 'conclusiones' ? '' : v)}
            tabs={[
              { id: 'conclusiones', label: t('Conclusiones de aptitud'), count: counts.conclusions },
              { id: 'ofertas', label: t('Ofertas y respuestas'), count: counts.pendingOffers },
              { id: 'cuarentena', label: t('Cuarentena'), count: counts.quarantined, hidden: !manage },
            ]}
          />
          {tab === 'conclusiones' && <ConclusionsTab rows={rows} employeeId={employeeId} onEmployee={onEmployee} />}
          {tab === 'ofertas' && <OffersTab rows={rows} employeeId={employeeId} onEmployee={onEmployee} />}
          {tab === 'cuarentena' &&
            (manage ? (
              <QuarantineTab rows={quarantine} />
            ) : (
              <Callout tone="neutral" icon={Lock} title={t('Cuarentena reservada al servicio médico')}>
                {t('Los documentos con posible contenido clínico solo los gestiona el personal sanitario. Su rol no puede verlos ni abrirlos.')}
              </Callout>
            ))}
        </div>

        <Card
          title={
            <h2 className="row">
              <History size={16} aria-hidden /> {t('Auditoría restringida (últimos 20 eventos)')}
            </h2>
          }
        >
          <p className="small muted health-audit-note">{t('Solo los usuarios con acceso al área de salud ven estos eventos. Incluye las consultas del área y los intentos de acceso denegados.')}</p>
          {!ctx.can('audit.view') && <p className="small muted health-audit-note">{t('Su rol no incluye la consulta de la auditoría de la empresa: aquí solo aparecen los eventos sobre sus propios registros.')}</p>}
          <AuditList filter={(e) => e.restricted} limit={20} />
        </Card>
      </div>
    </>
  );
}
