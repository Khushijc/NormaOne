/**
 * Configuración (settings.manage). Each tab reads through the context/services and writes only
 * through the services (`updateSettings`, `saveJobRole`, `revokeMembership`), which re-check
 * permissions and record every change in the audit log.
 */
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '../../components/ui';
import { t } from '../../i18n';
import { useCtx } from '../../store/hooks';
import { SettingsAccessTab } from './SettingsAccessTab';
import { SettingsAlertsTab } from './SettingsAlertsTab';
import { SettingsCategoriesTab } from './SettingsCategoriesTab';
import { SettingsCompanyTab } from './SettingsCompanyTab';
import { SettingsDemoTab } from './SettingsDemoTab';
import { SettingsRolesTab } from './SettingsRolesTab';

type TabId = 'empresa' | 'avisos' | 'puestos' | 'documentos' | 'accesos' | 'demo';
const TAB_IDS: TabId[] = ['empresa', 'avisos', 'puestos', 'documentos', 'accesos', 'demo'];

export function SettingsPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as TabId | null;
  const tab: TabId = requested && TAB_IDS.includes(requested) ? requested : 'empresa';
  const setTab = (v: TabId) => {
    const next = new URLSearchParams(params);
    if (v === 'empresa') next.delete('tab');
    else next.set('tab', v);
    setParams(next, { replace: true });
  };
  return (
    <div className="stack">
      <PageHeader
        title={t('Configuración')}
        subtitle={t('Datos de prevención, avisos, puestos y riesgos, tipos de documento y accesos de {company}. Cada cambio queda en la auditoría.', { company: ctx.company.tradeName })}
      />
      <Tabs<TabId>
        label={t('Secciones de configuración')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'empresa', label: t('Empresa y prevención') },
          { id: 'avisos', label: t('Avisos y enlaces') },
          { id: 'puestos', label: t('Puestos y riesgos') },
          { id: 'documentos', label: t('Tipos de documento') },
          { id: 'accesos', label: t('Accesos') },
          { id: 'demo', label: t('Datos de demostración') },
        ]}
      />
      <div role="tabpanel" aria-label={t('Contenido de la sección')}>
        {tab === 'empresa' && <SettingsCompanyTab />}
        {tab === 'avisos' && <SettingsAlertsTab />}
        {tab === 'puestos' && <SettingsRolesTab />}
        {tab === 'documentos' && <SettingsCategoriesTab />}
        {tab === 'accesos' && <SettingsAccessTab />}
        {tab === 'demo' && <SettingsDemoTab />}
      </div>
    </div>
  );
}
