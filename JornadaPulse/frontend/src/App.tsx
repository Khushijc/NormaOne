import { SearchX } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NoMembership, RequirePerm } from './components/guards';
import { Card, EmptyState } from './components/ui';
import { t } from './i18n';
import { AppShell, SECTION_PERMS } from './layout/AppShell';

import { useCtx, useLang } from './store/hooks';

// Screens load on demand so the first paint stays small.
const AbsenceDetailPage = lazy(() => import('./pages/absences/AbsenceDetailPage').then((m) => ({ default: m.AbsenceDetailPage })));
const AbsencesPage = lazy(() => import('./pages/absences/AbsencesPage').then((m) => ({ default: m.AbsencesPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const CorrectionDetailPage = lazy(() => import('./pages/corrections/CorrectionDetailPage').then((m) => ({ default: m.CorrectionDetailPage })));
const CorrectionsPage = lazy(() => import('./pages/corrections/CorrectionsPage').then((m) => ({ default: m.CorrectionsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ExceptionsPage = lazy(() => import('./pages/ExceptionsPage').then((m) => ({ default: m.ExceptionsPage })));
const MyDayPage = lazy(() => import('./pages/MyDayPage').then((m) => ({ default: m.MyDayPage })));
const PlanningPage = lazy(() => import('./pages/PlanningPage').then((m) => ({ default: m.PlanningPage })));
const RecordDetailPage = lazy(() => import('./pages/records/RecordDetailPage').then((m) => ({ default: m.RecordDetailPage })));
const RecordsPage = lazy(() => import('./pages/records/RecordsPage').then((m) => ({ default: m.RecordsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const RequirementsPage = lazy(() => import('./pages/RequirementsPage').then((m) => ({ default: m.RequirementsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const EmployeeDetailPage = lazy(() => import('./pages/team/EmployeeDetailPage').then((m) => ({ default: m.EmployeeDetailPage })));
const TeamPage = lazy(() => import('./pages/team/TeamPage').then((m) => ({ default: m.TeamPage })));

function Home() {
  const ctx = useCtx();
  if (!ctx.membership || ctx.perms.size === 0) return <NoMembership />;
  return <DashboardPage />;
}

export default function App() {
  // Re-renders every route when the interface language changes, without remounting.
  useLang();
  return (
    <AppShell>
      <Suspense fallback={<Card><div className="muted" role="status">{t('Cargando…')}</div></Card>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/mi-jornada" element={<RequirePerm perm={SECTION_PERMS.myDay}><MyDayPage /></RequirePerm>} />
        <Route path="/registros" element={<RequirePerm perm={SECTION_PERMS.records}><RecordsPage /></RequirePerm>} />
        <Route path="/registros/:id" element={<RequirePerm perm={SECTION_PERMS.records}><RecordDetailPage /></RequirePerm>} />
        <Route path="/calendario" element={<RequirePerm perm={SECTION_PERMS.calendar}><CalendarPage /></RequirePerm>} />
        <Route path="/ausencias" element={<RequirePerm perm={SECTION_PERMS.absences}><AbsencesPage /></RequirePerm>} />
        <Route path="/ausencias/:id" element={<RequirePerm perm={SECTION_PERMS.absences}><AbsenceDetailPage /></RequirePerm>} />
        <Route path="/correcciones" element={<RequirePerm perm={SECTION_PERMS.corrections}><CorrectionsPage /></RequirePerm>} />
        <Route path="/correcciones/:id" element={<RequirePerm perm={SECTION_PERMS.corrections}><CorrectionDetailPage /></RequirePerm>} />
        <Route path="/equipo" element={<RequirePerm perm={SECTION_PERMS.team}><TeamPage /></RequirePerm>} />
        <Route path="/equipo/:id" element={<RequirePerm perm={SECTION_PERMS.team}><EmployeeDetailPage /></RequirePerm>} />
        <Route path="/turnos" element={<RequirePerm perm={SECTION_PERMS.planning}><PlanningPage /></RequirePerm>} />
        <Route path="/incidencias" element={<RequirePerm perm={SECTION_PERMS.exceptions}><ExceptionsPage /></RequirePerm>} />
        <Route path="/informes" element={<RequirePerm perm={SECTION_PERMS.reports}><ReportsPage /></RequirePerm>} />
        <Route path="/configuracion" element={<RequirePerm perm={SECTION_PERMS.settings}><SettingsPage /></RequirePerm>} />
        <Route path="/auditoria" element={<RequirePerm perm={SECTION_PERMS.audit}><AuditPage /></RequirePerm>} />
        <Route path="/requisitos" element={<RequirementsPage />} />
        <Route
          path="*"
          element={
            <Card>
              <EmptyState icon={SearchX} title={t('Página no encontrada')}>
                {t('La dirección no corresponde a ninguna pantalla de JornadaPulse.')}
              </EmptyState>
            </Card>
          }
        />
      </Routes>
      </Suspense>
    </AppShell>
  );
}
