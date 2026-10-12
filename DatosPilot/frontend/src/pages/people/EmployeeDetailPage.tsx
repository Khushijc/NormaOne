/**
 * Employee profile (/empleados/:id?tab=…). Only employees in the caller's scope are shown; any
 * other id (unknown, another company, out of team / provider scope) renders as "not found".
 * Employees reach only their own profile. Health details are never shown here: the requirement
 * matrix and readiness come already masked from the services.
 */
import { Eye } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { formatDate } from '../../domain/time';
import { t, tKey } from '../../i18n';
import { canSeeEmployee, itemsFor, roleName, visibleReadiness } from '../../services/context';
import { changesFor } from '../../services/peopleService';
import { visibleActions } from '../../services/safetyService';
import { useCtx } from '../../store/hooks';
import { AuditList } from '../../components/AuditList';
import { ReadinessBadge } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Badge, Callout, Card, PageHeader, Tabs } from '../../components/ui';
import { AssignmentTab } from './AssignmentTab';
import { ChangesTab } from './ChangesTab';
import { ReadinessPanel } from './ReadinessPanel';
import { ActionsTab, DocumentsTab, EquipmentTab, TrainingTab } from './RecordTabs';
import { RequirementsTab } from './RequirementsTab';
import { byWorst, departmentName, displayAssignment } from './peopleData';

type TabId = 'resumen' | 'puestos' | 'requisitos' | 'documentacion' | 'formacion' | 'equipos' | 'acciones' | 'cambios' | 'historial';
const TAB_IDS: TabId[] = ['resumen', 'puestos', 'requisitos', 'documentacion', 'formacion', 'equipos', 'acciones', 'cambios', 'historial'];

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();

  const emp = ctx.db.employees.find((e) => e.id === id && e.companyId === ctx.company.id);
  const visible = !!emp && canSeeEmployee(ctx, emp.id);

  const data = useMemo(() => {
    if (!emp || !visible) return null;
    return {
      items: emp.status === 'active' ? itemsFor(ctx, emp.id) : [],
      readiness: byWorst(visibleReadiness(ctx).filter((r) => r.employeeId === emp.id)),
      pendingChanges: changesFor(ctx, emp.id).filter((c) => c.status === 'pending_review').length,
      openActions: visibleActions(ctx).filter((a) => a.employeeId === emp.id && a.status !== 'resolved').length,
    };
  }, [ctx, emp, visible]);

  const directory = ctx.can('employees.view_all') || ctx.can('team.view');
  if (!emp || !visible || !data) return <RecordNotFound back={directory ? '/empleados' : '/'} label={directory ? tKey('Empleados') : tKey('Inicio')} />;

  const isSelf = ctx.employee?.id === emp.id;
  const fullView = ctx.can('employees.view_all');
  const canDocs = ctx.can('evidence.view_all') || isSelf;
  const canAudit = ctx.can('audit.view') || isSelf;
  const hidden: Partial<Record<TabId, boolean>> = { documentacion: !canDocs, historial: !canAudit };
  const requested = params.get('tab') as TabId | null;
  const tab: TabId = requested && TAB_IDS.includes(requested) && !hidden[requested] ? requested : 'resumen';
  const setTab = (v: TabId) => {
    const next = new URLSearchParams(params);
    if (v === 'resumen') next.delete('tab');
    else next.set('tab', v);
    setParams(next, { replace: true });
  };

  const assignment = displayAssignment(ctx.db, emp.id, ctx.today);
  const name = `${emp.firstName} ${emp.lastName}`;
  const worst = data.readiness[0]?.state ?? null;

  return (
    <div className="stack people-area">
      <PageHeader
        breadcrumbs={
          directory ? (
            <>
              <Link to="/empleados">{t('Empleados')}</Link>
              <span aria-hidden>/</span>
              <span>{emp.code}</span>
            </>
          ) : undefined
        }
        title={name}
        subtitle={
          <span className="row-wrap">
            <span className="mono">{emp.code}</span>
            <span>{roleName(ctx.db, assignment?.jobRoleId)}</span>
            <span className="muted">{departmentName(ctx.db, assignment?.departmentId)}</span>
            {emp.status === 'active' ? <Badge tone="success">{t('Activo')}</Badge> : <Badge tone="neutral">{t('Inactivo')}</Badge>}
            {worst && <ReadinessBadge state={worst} />}
            {isSelf && <Badge tone="info">{t('Su propia ficha')}</Badge>}
          </span>
        }
      />

      {!fullView && !isSelf && (
        <Callout tone="neutral" icon={Eye}>
          {t('Vista de supervisión: se muestra la información mínima necesaria (estado de los requisitos y disponibilidad), sin el contenido de los documentos.')}
        </Callout>
      )}
      {emp.status !== 'active' && tab !== 'resumen' && (
        <p className="tiny muted">{t('Persona inactiva desde el {date}. El historial se conserva.', { date: formatDate(emp.endDate) })}</p>
      )}

      <Tabs<TabId>
        label={t('Secciones de la ficha')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'resumen', label: t('Resumen') },
          { id: 'puestos', label: t('Puestos y centros') },
          { id: 'requisitos', label: t('Requisitos aplicables'), count: data.items.length },
          { id: 'documentacion', label: t('Documentación'), hidden: hidden.documentacion },
          { id: 'formacion', label: t('Formación') },
          { id: 'equipos', label: t('Equipos asignados') },
          { id: 'acciones', label: t('Acciones pendientes'), count: data.openActions },
          { id: 'cambios', label: t('Cambios'), count: data.pendingChanges || undefined },
          { id: 'historial', label: t('Historial y auditoría'), hidden: hidden.historial },
        ]}
      />

      <div role="tabpanel" aria-label={t('Contenido de la pestaña')}>
        {tab === 'resumen' && <ReadinessPanel emp={emp} isSelf={isSelf} items={data.items} readiness={data.readiness} />}
        {tab === 'puestos' && <AssignmentTab emp={emp} />}
        {tab === 'requisitos' && <RequirementsTab emp={emp} isSelf={isSelf} items={data.items} />}
        {tab === 'documentacion' && <DocumentsTab emp={emp} isSelf={isSelf} />}
        {tab === 'formacion' && <TrainingTab emp={emp} />}
        {tab === 'equipos' && <EquipmentTab emp={emp} />}
        {tab === 'acciones' && <ActionsTab emp={emp} />}
        {tab === 'cambios' && <ChangesTab emp={emp} />}
        {tab === 'historial' && (
          <Card title={t('Historial y auditoría')}>
            <AuditList filter={(e) => e.employeeId === emp.id || e.entityId === emp.id} />
            <p className="readiness-note">{t('Los eventos restringidos (salud) solo se muestran a personas autorizadas.')}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
