/**
 * Configuración (HR administrator, owner). Each tab reads through the services and writes only
 * through them; permissions are re-checked by the service on every change.
 */
import { useSearchParams } from 'react-router-dom';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { PageHeader, Tabs } from '../components/ui';
import { AbsenceTypesTab } from './settings/AbsenceTypesTab';
import { AccessTab } from './settings/AccessTab';
import { CompanyTab } from './settings/CompanyTab';
import { DemoDataTab } from './settings/DemoDataTab';
import { ProtocolTab } from './settings/ProtocolTab';

type TabId = 'ausencias' | 'protocolo' | 'accesos' | 'empresa' | 'demo';
const TAB_IDS: TabId[] = ['ausencias', 'protocolo', 'accesos', 'empresa', 'demo'];

export function SettingsPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const requested = params.get('pestana') as TabId | null;
  const tab: TabId = requested && TAB_IDS.includes(requested) ? requested : 'ausencias';
  const setTab = (v: TabId) => {
    const next = new URLSearchParams(params);
    if (v === 'ausencias') next.delete('pestana');
    else next.set('pestana', v);
    setParams(next, { replace: true });
  };
  return (
    <div className="stack team-area">
      <PageHeader
        title={t('Configuración')}
        subtitle={t('Tipos de ausencia, protocolo de registro, accesos y datos de la empresa de {company}. Los cambios quedan versionados y en la auditoría.', { company: ctx.company.tradeName })}
      />
      <Tabs<TabId>
        label={t('Secciones de configuración')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'ausencias', label: t('Tipos de ausencia') },
          { id: 'protocolo', label: t('Protocolo de registro') },
          { id: 'accesos', label: t('Usuarios y accesos') },
          { id: 'empresa', label: t('Empresa') },
          { id: 'demo', label: t('Datos de demostración') },
        ]}
      />
      {tab === 'ausencias' && <AbsenceTypesTab />}
      {tab === 'protocolo' && <ProtocolTab />}
      {tab === 'accesos' && <AccessTab />}
      {tab === 'empresa' && <CompanyTab />}
      {tab === 'demo' && <DemoDataTab />}
    </div>
  );
}
