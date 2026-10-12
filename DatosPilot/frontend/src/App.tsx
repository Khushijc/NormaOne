import { SearchX } from 'lucide-react';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { HealthGuard, NoMembership, RequirePerm } from './components/guards';
import { Card, EmptyState } from './components/ui';
import { t } from './i18n';
import { AppShell, SECTION_PERMS } from './layout/AppShell';
import { useCtx, useLang } from './store/hooks';

// Screens load on demand so the first paint stays small.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const TasksPage = page(() => import('./pages/TasksPage'), 'TasksPage');
const SourcesPage = page(() => import('./pages/SourcesPage'), 'SourcesPage');
const RequirementsPage = page(() => import('./pages/requirements/RequirementsPage'), 'RequirementsPage');
const TemplateDetailPage = page(() => import('./pages/requirements/TemplateDetailPage'), 'TemplateDetailPage');
const EmployeesPage = page(() => import('./pages/people/EmployeesPage'), 'EmployeesPage');
const EmployeeDetailPage = page(() => import('./pages/people/EmployeeDetailPage'), 'EmployeeDetailPage');
const WorksitesPage = page(() => import('./pages/worksites/WorksitesPage'), 'WorksitesPage');
const WorksiteDetailPage = page(() => import('./pages/worksites/WorksiteDetailPage'), 'WorksiteDetailPage');
const CaePage = page(() => import('./pages/worksites/CaePage'), 'CaePage');
const CaeDetailPage = page(() => import('./pages/worksites/CaeDetailPage'), 'CaeDetailPage');
const DocumentsPage = page(() => import('./pages/evidence/DocumentsPage'), 'DocumentsPage');
const DocumentDetailPage = page(() => import('./pages/evidence/DocumentDetailPage'), 'DocumentDetailPage');
const TrainingPage = page(() => import('./pages/evidence/TrainingPage'), 'TrainingPage');
const PpePage = page(() => import('./pages/safety/PpePage'), 'PpePage');
const AssessmentsPage = page(() => import('./pages/safety/AssessmentsPage'), 'AssessmentsPage');
const AssessmentDetailPage = page(() => import('./pages/safety/AssessmentDetailPage'), 'AssessmentDetailPage');
const ActionsPage = page(() => import('./pages/safety/ActionsPage'), 'ActionsPage');
const ActionDetailPage = page(() => import('./pages/safety/ActionDetailPage'), 'ActionDetailPage');
const HealthPage = page(() => import('./pages/health/HealthPage'), 'HealthPage');
const ExceptionsPage = page(() => import('./pages/health/ExceptionsPage'), 'ExceptionsPage');
const ReportsPage = page(() => import('./pages/control/ReportsPage'), 'ReportsPage');
const SettingsPage = page(() => import('./pages/control/SettingsPage'), 'SettingsPage');
const AuditPage = page(() => import('./pages/control/AuditPage'), 'AuditPage');

function Member({ children }: { children: ReactNode }) {
  const ctx = useCtx();
  if (!ctx.membership || ctx.perms.size === 0) return <NoMembership />;
  return <>{children}</>;
}

export default function App() {
  // Re-renders every route when the interface language changes, without remounting.
  useLang();
  const P = SECTION_PERMS;
  return (
    <AppShell>
      <Suspense fallback={<Card><div className="muted" role="status">{t('Cargando…')}</div></Card>}>
        <Routes>
          <Route path="/" element={<Member><DashboardPage /></Member>} />
          <Route path="/mis-tareas" element={<Member><TasksPage /></Member>} />
          <Route path="/requisitos" element={<RequirePerm perm={P.requirements}><RequirementsPage /></RequirePerm>} />
          <Route path="/requisitos/:id" element={<RequirePerm perm={P.requirements}><TemplateDetailPage /></RequirePerm>} />
          <Route path="/empleados" element={<RequirePerm perm={P.employees}><EmployeesPage /></RequirePerm>} />
          <Route path="/empleados/:id" element={<RequirePerm perm={[...P.employees, 'own.view']}><EmployeeDetailPage /></RequirePerm>} />
          <Route path="/centros" element={<RequirePerm perm={P.worksites}><WorksitesPage /></RequirePerm>} />
          <Route path="/centros/:id" element={<RequirePerm perm={P.worksites}><WorksiteDetailPage /></RequirePerm>} />
          <Route path="/documentacion" element={<RequirePerm perm={P.documents}><DocumentsPage /></RequirePerm>} />
          <Route path="/documentacion/:id" element={<RequirePerm perm={P.documents}><DocumentDetailPage /></RequirePerm>} />
          <Route path="/formacion" element={<RequirePerm perm={P.training}><TrainingPage /></RequirePerm>} />
          <Route path="/epi" element={<RequirePerm perm={P.ppe}><PpePage /></RequirePerm>} />
          <Route path="/evaluaciones" element={<RequirePerm perm={P.risk}><AssessmentsPage /></RequirePerm>} />
          <Route path="/evaluaciones/:id" element={<RequirePerm perm={P.risk}><AssessmentDetailPage /></RequirePerm>} />
          <Route path="/acciones" element={<RequirePerm perm={P.actions}><ActionsPage /></RequirePerm>} />
          <Route path="/acciones/:id" element={<RequirePerm perm={P.actions}><ActionDetailPage /></RequirePerm>} />
          <Route path="/cae" element={<RequirePerm perm={P.cae}><CaePage /></RequirePerm>} />
          <Route path="/cae/:id" element={<RequirePerm perm={P.cae}><CaeDetailPage /></RequirePerm>} />
          <Route path="/salud" element={<HealthGuard><HealthPage /></HealthGuard>} />
          <Route path="/incidencias" element={<RequirePerm perm={P.exceptions}><ExceptionsPage /></RequirePerm>} />
          <Route path="/informes" element={<RequirePerm perm={P.reports}><ReportsPage /></RequirePerm>} />
          <Route path="/configuracion" element={<RequirePerm perm={P.settings}><SettingsPage /></RequirePerm>} />
          <Route path="/auditoria" element={<RequirePerm perm={P.audit}><AuditPage /></RequirePerm>} />
          <Route path="/fuentes" element={<SourcesPage />} />
          <Route
            path="*"
            element={
              <Card>
                <EmptyState icon={SearchX} title={t('Página no encontrada')}>
                  {t('La dirección no corresponde a ninguna pantalla de DatosPilot.')}
                </EmptyState>
              </Card>
            }
          />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
