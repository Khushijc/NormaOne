/**
 * "Turnos y horarios" (/turnos): planned shifts, working-time policies, collective agreement
 * references, working calendars, worksites/departments and workday classification.
 *
 * Planned shifts, recorded time, absences, reviewed exceptions and payroll treatment are kept
 * separate everywhere on this screen (BRD §09, research R11–R12).
 */
import { useSearchParams } from 'react-router-dom';
import { Callout, PageHeader, Tabs } from '../components/ui';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { AgreementsTab } from './planning/AgreementsTab';
import { CalendarsTab } from './planning/CalendarsTab';
import { ClassificationTab } from './planning/ClassificationTab';
import { PoliciesTab } from './planning/PoliciesTab';
import { ShiftsTab } from './planning/ShiftsTab';
import { SitesTab } from './planning/SitesTab';

type TabId = 'turnos' | 'politicas' | 'convenios' | 'calendarios' | 'centros' | 'clasificacion';

export function PlanningPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const canPlan = ctx.can('shifts.manage_team') || ctx.can('shifts.manage_all');
  const canViewPolicies = ctx.can('policies.view');
  const canViewTerms = canViewPolicies && (ctx.can('employees.view_all') || ctx.can('employees.view_team'));

  const tabs: { id: TabId; label: string; hidden?: boolean }[] = [
    { id: 'turnos', label: t('Turnos planificados'), hidden: !canPlan && !canViewPolicies },
    { id: 'politicas', label: t('Políticas de jornada'), hidden: !canViewPolicies },
    { id: 'convenios', label: t('Convenios colectivos'), hidden: !canViewPolicies },
    { id: 'calendarios', label: t('Calendarios laborales'), hidden: !canViewPolicies },
    { id: 'centros', label: t('Centros y departamentos'), hidden: !canViewPolicies },
    { id: 'clasificacion', label: t('Clasificación de jornada'), hidden: !canViewTerms },
  ];
  const visible = tabs.filter((x) => !x.hidden);
  const requested = params.get('pestana') as TabId | null;
  const tab: TabId | undefined = visible.find((x) => x.id === requested)?.id ?? visible[0]?.id;
  const readOnly = !ctx.can('policies.manage');

  return (
    <>
      <PageHeader
        title={t('Turnos y horarios')}
        subtitle={t('{company} · planificación, políticas de jornada, convenios de referencia y calendarios laborales.', { company: ctx.company.tradeName })}
      />
      {readOnly && tab !== 'turnos' && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="neutral">{t('Consulta de solo lectura: las políticas, los convenios y los calendarios los gestiona RR. HH.')}</Callout>
        </div>
      )}
      <Tabs label={t('Secciones de turnos y horarios')} value={tab ?? 'turnos'} onChange={(id) => setParams({ pestana: id }, { replace: true })} tabs={tabs} />
      {tab === 'turnos' && <ShiftsTab />}
      {tab === 'politicas' && <PoliciesTab />}
      {tab === 'convenios' && <AgreementsTab />}
      {tab === 'calendarios' && <CalendarsTab />}
      {tab === 'centros' && <SitesTab />}
      {tab === 'clasificacion' && <ClassificationTab />}
    </>
  );
}
