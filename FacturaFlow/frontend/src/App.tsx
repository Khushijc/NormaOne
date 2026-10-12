import { Navigate, Route, Routes } from 'react-router-dom';
import { RequirePerm } from './components/guards';
import { Card, EmptyState } from './components/ui';
import { AppShell } from './layout/AppShell';
import { AuditPage } from './pages/AuditPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpenseDetailPage } from './pages/expenses/ExpenseDetailPage';
import { ExpenseEditorPage } from './pages/expenses/ExpenseEditorPage';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { FiscalPage } from './pages/FiscalPage';
import { GestoriaPage } from './pages/GestoriaPage';
import { InvoiceDetailPage } from './pages/invoices/InvoiceDetailPage';
import { InvoiceEditorPage } from './pages/invoices/InvoiceEditorPage';
import { InvoiceListPage } from './pages/invoices/InvoiceListPage';
import { InvoicePreviewPage } from './pages/invoices/InvoicePreviewPage';
import { RectifyPage } from './pages/invoices/RectifyPage';
import { PartyDetailPage } from './pages/parties/PartyDetailPage';
import { PartyListPage } from './pages/parties/PartyListPage';
import { ReportsPage } from './pages/ReportsPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';
import { t } from './i18n';
import { useCtx, useLang } from './store/hooks';

function Home() {
  const ctx = useCtx();
  // Employees and supervisors land on their expenses; finance roles on the dashboard.
  if (ctx.membership && !ctx.can('dashboard.view') && ctx.can('expenses.submit_own')) return <Navigate to="/gastos" replace />;
  return (
    <RequirePerm perm="dashboard.view">
      <DashboardPage />
    </RequirePerm>
  );
}

export default function App() {
  // Subscribing here re-renders every route when the interface language changes,
  // without remounting (open forms and filters keep their state).
  useLang();
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/facturas" element={<RequirePerm perm="invoices.view"><InvoiceListPage /></RequirePerm>} />
        <Route path="/facturas/nueva" element={<RequirePerm perm="invoices.edit_draft"><InvoiceEditorPage /></RequirePerm>} />
        <Route path="/facturas/:id" element={<RequirePerm perm="invoices.view"><InvoiceDetailPage /></RequirePerm>} />
        <Route path="/facturas/:id/editar" element={<RequirePerm perm="invoices.edit_draft"><InvoiceEditorPage /></RequirePerm>} />
        <Route path="/facturas/:id/vista" element={<RequirePerm perm="invoices.view"><InvoicePreviewPage /></RequirePerm>} />
        <Route path="/facturas/:id/rectificar" element={<RequirePerm perm="invoices.rectify_request"><RectifyPage /></RequirePerm>} />
        <Route path="/cobros" element={<RequirePerm perm={['payments.record', 'reports.view']}><CollectionsPage /></RequirePerm>} />
        <Route path="/clientes" element={<RequirePerm perm="customers.view"><PartyListPage kind="customer" /></RequirePerm>} />
        <Route path="/clientes/:id" element={<RequirePerm perm="customers.view"><PartyDetailPage kind="customer" /></RequirePerm>} />
        <Route path="/proveedores" element={<RequirePerm perm="suppliers.view"><PartyListPage kind="supplier" /></RequirePerm>} />
        <Route path="/proveedores/:id" element={<RequirePerm perm="suppliers.view"><PartyDetailPage kind="supplier" /></RequirePerm>} />
        <Route path="/gastos" element={<RequirePerm perm={['expenses.submit_own', 'expenses.view_all']}><ExpensesPage /></RequirePerm>} />
        <Route path="/gastos/nuevo" element={<RequirePerm perm={['expenses.submit_own', 'expenses.manage_supplier']}><ExpenseEditorPage /></RequirePerm>} />
        <Route path="/gastos/:id" element={<RequirePerm perm={['expenses.submit_own', 'expenses.view_all']}><ExpenseDetailPage /></RequirePerm>} />
        <Route path="/gastos/:id/editar" element={<RequirePerm perm={['expenses.submit_own', 'expenses.manage_supplier']}><ExpenseEditorPage /></RequirePerm>} />
        <Route path="/integracion-fiscal" element={<RequirePerm perm="fiscal.view"><FiscalPage /></RequirePerm>} />
        <Route path="/gestoria" element={<RequirePerm perm="handover.view"><GestoriaPage /></RequirePerm>} />
        <Route path="/informes" element={<RequirePerm perm="reports.view"><ReportsPage /></RequirePerm>} />
        <Route path="/tareas" element={<RequirePerm perm={['dashboard.view', 'expenses.submit_own']}><TasksPage /></RequirePerm>} />
        <Route path="/auditoria" element={<RequirePerm perm="audit.view"><AuditPage /></RequirePerm>} />
        <Route path="/configuracion" element={<RequirePerm perm="settings.view"><SettingsPage /></RequirePerm>} />
        <Route path="/requisitos" element={<RequirementsPage />} />
        <Route
          path="*"
          element={
            <Card>
              <EmptyState title={t('Página no encontrada')}>{t('La dirección no corresponde a ninguna pantalla del módulo.')}</EmptyState>
            </Card>
          }
        />
      </Routes>
    </AppShell>
  );
}
