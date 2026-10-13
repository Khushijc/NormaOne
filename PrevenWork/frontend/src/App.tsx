import { SearchX } from 'lucide-react';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NoMembership, RequirePerm } from './components/guards';
import { Card, EmptyState } from './components/ui';
import { t } from './i18n';
import { AppShell, SECTION_PERMS } from './layout/AppShell';
import { useCtx, useLang } from './store/hooks';

// Pages load on demand
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const OverviewPage = page(() => import('./pages/OverviewPage'), 'OverviewPage');
const RopaPage = page(() => import('./pages/RopaPage'), 'RopaPage');
const RightsPage = page(() => import('./pages/RightsPage'), 'RightsPage');
const IncidentsPage = page(() => import('./pages/IncidentsPage'), 'IncidentsPage');
const DocumentsPage = page(() => import('./pages/DocumentsPage'), 'DocumentsPage');
const SuppliersPage = page(() => import('./pages/SuppliersPage'), 'SuppliersPage');
const RetentionPage = page(() => import('./pages/RetentionPage'), 'RetentionPage');
const TasksPage = page(() => import('./pages/TasksPage'), 'TasksPage');
const ReportsPage = page(() => import('./pages/ReportsPage'), 'ReportsPage');
const AuditPage = page(() => import('./pages/AuditPage'), 'AuditPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');

function Member({ children }: { children: ReactNode }) {
  const ctx = useCtx();
  if (!ctx.membership || ctx.perms.size === 0) return <NoMembership />;
  return <>{children}</>;
}

export default function App() {
  useLang();
  const P = SECTION_PERMS;

  return (
    <AppShell>
      <Suspense
        fallback={
          <Card>
            <div className="muted p-4" role="status">
              {t('Cargando módulo de privacidad…')}
            </div>
          </Card>
        }
      >
        <Routes>
          <Route
            path="/"
            element={
              <Member>
                <OverviewPage />
              </Member>
            }
          />
          <Route
            path="/tratamientos"
            element={
              <RequirePerm perm={P.ropa}>
                <RopaPage />
              </RequirePerm>
            }
          />
          <Route
            path="/derechos"
            element={
              <RequirePerm perm={P.rights}>
                <RightsPage />
              </RequirePerm>
            }
          />
          <Route
            path="/incidentes"
            element={
              <RequirePerm perm={P.incidents}>
                <IncidentsPage />
              </RequirePerm>
            }
          />
          <Route
            path="/documentos"
            element={
              <RequirePerm perm={P.documents}>
                <DocumentsPage />
              </RequirePerm>
            }
          />
          <Route
            path="/proveedores"
            element={
              <RequirePerm perm={P.suppliers}>
                <SuppliersPage />
              </RequirePerm>
            }
          />
          <Route
            path="/conservacion"
            element={
              <RequirePerm perm={P.retention}>
                <RetentionPage />
              </RequirePerm>
            }
          />
          <Route
            path="/tareas"
            element={
              <RequirePerm perm={P.tasks}>
                <TasksPage />
              </RequirePerm>
            }
          />
          <Route
            path="/informes"
            element={
              <RequirePerm perm={P.reports}>
                <ReportsPage />
              </RequirePerm>
            }
          />
          <Route
            path="/auditoria"
            element={
              <RequirePerm perm={P.audit}>
                <AuditPage />
              </RequirePerm>
            }
          />
          <Route
            path="/configuracion"
            element={
              <RequirePerm perm={P.settings}>
                <SettingsPage />
              </RequirePerm>
            }
          />
          <Route
            path="*"
            element={
              <Card>
                <EmptyState icon={SearchX} title={t('Página no encontrada')}>
                  {t('La dirección no corresponde a ninguna pantalla de PrevenWork.')}
                </EmptyState>
              </Card>
            }
          />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
