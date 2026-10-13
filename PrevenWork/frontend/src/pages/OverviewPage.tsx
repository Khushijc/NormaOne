import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Lock,
  Plus,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Clock72h } from '../components/Clock72h';
import { CalendarMonthBadge } from '../components/CalendarMonthBadge';
import { Badge, Button, Card, StatCard } from '../components/ui';
import { evaluateRightsDeadline, formatDate, formatInstant, today } from '../domain/time';
import { DOC_STATUS, RIGHT_TYPE, ROPA_STATUS, TASK_PRIORITY } from '../domain/status';
import { useCtx } from '../store/hooks';
import { t } from '../i18n';

export function OverviewPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const now = today();

  const companyRopas = ctx.db.ropaActivities.filter((r) => r.companyId === ctx.company.id);
  const companyRights = ctx.db.rightsRequests.filter((r) => r.companyId === ctx.company.id);
  const companyIncidents = ctx.db.incidents.filter((i) => i.companyId === ctx.company.id);
  const companyDocs = ctx.db.documents.filter((d) => d.companyId === ctx.company.id);
  const companyTasks = ctx.db.tasks.filter((t) => t.companyId === ctx.company.id);
  const companySuppliers = ctx.db.suppliers.filter((s) => s.companyId === ctx.company.id);

  // Metrics
  const activeRopas = companyRopas.filter((r) => r.status === 'approved' || r.status === 'in_review');
  const openRights = companyRights.filter((r) => !['closed', 'rejected', 'withdrawn'].includes(r.status));

  const approachingRights = openRights.filter((r) => {
    const evalRes = evaluateRightsDeadline(r.effectiveDeadline, false);
    return evalRes.status === 'approaching' || evalRes.status === 'overdue';
  });

  const openIncidents = companyIncidents.filter((i) => i.status !== 'closed');
  const incidentsNeedingDecision = openIncidents.filter(
    (i) => i.authorityStatus === 'assessing' || i.subjectStatus === 'evaluating'
  );

  const docsAwaitingReview = companyDocs.filter(
    (d) => d.nextReviewDate <= now || !d.lastReviewDate
  );

  const pendingTasks = companyTasks.filter(
    (t) => t.status === 'open' || t.status === 'in_progress'
  );

  const overdueTasks = companyTasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate < now
  );

  // Specialist reviews pending
  const ropasNeedingSpecialist = companyRopas.filter(
    (r) => r.specialistReviewFlag || r.legalBasisReviewStatus === 'expert_justification_needed'
  );
  const suppliersNeedingSpecialist = companySuppliers.filter(
    (s) => s.assessedRole === 'needs_professional_review'
  );

  const canViewRestrictedIncidents = ctx.can('incidents.view_restricted');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {t('Operaciones de Privacidad · {name}', { name: ctx.company.tradeName })}
          </h1>
          <p className="page-subtitle">
            {t(
              'Cuadro de mando general de cumplimiento RGPD / LOPDGDD para {nif}. Registro de tratamientos, plazos de respuesta, reloj 72h de brechas y custodia documental.',
              { nif: ctx.company.nif }
            )}
          </p>
        </div>
        <div className="page-actions row gap-2">
          {ctx.can('rights.manage') && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => navigate('/derechos?crear=1')}
            >
              {t('Nueva solicitud')}
            </Button>
          )}
          {ctx.can('incidents.manage') && (
            <Button
              variant="danger"
              icon={ShieldAlert}
              onClick={() => navigate('/incidentes?crear=1')}
            >
              {t('Notificar incidente')}
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards Grid (All 7 required operational metrics) */}
      <div className="kpis">
        <StatCard
          label="Tratamientos activos (RAT)"
          value={activeRopas.length}
          subtext={t('{n} tratamientos registrados', { n: companyRopas.length })}
          tone="info"
          icon={FileSpreadsheet}
          onClick={() => navigate('/tratamientos')}
        />

        <StatCard
          label="Solicitudes de derechos abiertas"
          value={openRights.length}
          subtext={t('{n} casos en tramitación', { n: openRights.length })}
          tone="neutral"
          icon={UserCheck}
          onClick={() => navigate('/derechos')}
        />

        <StatCard
          label="Derechos próximos a vencer o vencidos"
          value={approachingRights.length}
          subtext={
            approachingRights.length > 0 ? (
              <span className="text-danger font-semibold">
                {t('{n} requieren atención urgente', { n: approachingRights.length })}
              </span>
            ) : (
              t('Todas dentro del plazo mensual')
            )
          }
          tone={approachingRights.length > 0 ? 'danger' : 'success'}
          icon={Clock}
          onClick={() => navigate('/derechos')}
        />

        <StatCard
          label="Incidentes de datos activos"
          value={openIncidents.length}
          subtext={
            openIncidents.length > 0 ? (
              <span className="text-warning font-semibold">
                {t('{n} brechas en investigación', { n: openIncidents.length })}
              </span>
            ) : (
              t('Sin incidencias críticas')
            )
          }
          tone={openIncidents.length > 0 ? 'warning' : 'success'}
          icon={ShieldAlert}
          onClick={() => navigate('/incidentes')}
        />

        <StatCard
          label="Decisión AEPD / Afectados pendiente"
          value={incidentsNeedingDecision.length}
          subtext={
            incidentsNeedingDecision.length > 0 ? (
              <span className="text-danger font-semibold">
                {t('Evaluación 72h requerida')}
              </span>
            ) : (
              t('Todas las decisiones adoptadas')
            )
          }
          tone={incidentsNeedingDecision.length > 0 ? 'danger' : 'neutral'}
          icon={AlertTriangle}
          onClick={() => navigate('/incidentes')}
        />

        <StatCard
          label="Políticas y documentos por revisar"
          value={docsAwaitingReview.length}
          subtext={t('{n} políticas y contratos vigentes', { n: companyDocs.length })}
          tone={docsAwaitingReview.length > 0 ? 'warning' : 'neutral'}
          icon={FileText}
          onClick={() => navigate('/documentos')}
        />

        <StatCard
          label="Tareas de privacidad vencidas"
          value={overdueTasks.length}
          subtext={
            overdueTasks.length > 0 ? (
              <span className="text-danger font-semibold">
                {t('{n} tareas fuera de plazo', { n: overdueTasks.length })}
              </span>
            ) : (
              t('{n} tareas pendientes al día', { n: pendingTasks.length })
            )
          }
          tone={overdueTasks.length > 0 ? 'danger' : 'neutral'}
          icon={ListChecks}
          onClick={() => navigate('/tareas')}
        />
      </div>

      {/* Critical Incidents & 72h Clock Watch Panel */}
      {openIncidents.length > 0 && (
        <Card
          title={
            <div className="row items-center gap-2">
              <ShieldAlert className="text-danger" size={20} />
              <span>{t('Vigilancia de incidentes de seguridad y reloj AEPD')}</span>
            </div>
          }
          subtitle={t(
            'El plazo de 72 horas para notificar a la autoridad (Art. 33 RGPD) computa desde el conocimiento organizativo de forma ininterrumpida.'
          )}
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Referencia')}</th>
                  <th>{t('Incidente')}</th>
                  <th>{t('Conocimiento organizativo')}</th>
                  <th>{t('Reloj 72h')}</th>
                  <th>{t('Estado AEPD')}</th>
                  <th>{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {openIncidents.map((inc) => (
                  <tr key={inc.id}>
                    <td className="strong">{inc.reference}</td>
                    <td>
                      {canViewRestrictedIncidents ? (
                        inc.title
                      ) : (
                        <span className="muted italic">
                          <Lock size={12} className="inline mr-1" />
                          {t('[Detalle restringido a Responsable/DPO]')}
                        </span>
                      )}
                    </td>
                    <td>{formatInstant(inc.awarenessTimestamp)}</td>
                    <td>
                      <Clock72h
                        awarenessTimestamp={inc.awarenessTimestamp}
                        authorityNotified={inc.authorityStatus === 'submitted'}
                      />
                    </td>
                    <td>
                      <Badge
                        tone={
                          inc.authorityStatus === 'submitted'
                            ? 'success'
                            : inc.authorityStatus === 'pending_submission'
                            ? 'danger'
                            : inc.authorityStatus === 'assessing'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {inc.authorityStatus === 'submitted'
                          ? t('Notificada a la AEPD')
                          : inc.authorityStatus === 'pending_submission'
                          ? t('Pendiente de tramitación')
                          : inc.authorityStatus === 'assessing'
                          ? t('En evaluación (72h)')
                          : t('No procede (sin riesgo)')}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/incidentes?id=${inc.id}`)}
                      >
                        {t('Ver caso')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Grid: Upcoming Rights Deadlines & Processing Records Requiring Attention */}
      <div className="grid-2 gap-6">
        {/* Upcoming Rights Deadlines (Calendar-Month Rule) */}
        <Card
          title={t('Próximos vencimientos de derechos (Regla del mes natural)')}
          subtitle={t('Plazos legales calculados conforme al Art. 12.3 RGPD')}
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate('/derechos')}>
              {t('Ver todos')}
            </Button>
          }
        >
          {openRights.length === 0 ? (
            <div className="p-4 text-center text-muted">
              {t('No hay solicitudes de derechos pendientes en tramitación.')}
            </div>
          ) : (
            <div className="space-y-3">
              {openRights.slice(0, 5).map((req) => {
                const rightMeta = RIGHT_TYPE[req.rightType];
                return (
                  <div
                    key={req.id}
                    className="p-3 border rounded row between items-center clickable hover-surface"
                    onClick={() => navigate(`/derechos?id=${req.id}`)}
                  >
                    <div>
                      <div className="row items-center gap-2">
                        <span className="strong">{req.reference}</span>
                        <Badge tone="info">{rightMeta ? t(rightMeta.label) : req.rightType}</Badge>
                        {req.retentionConflict?.conflictDetected && (
                          <Badge tone="warning">
                            {t('Conflicto retención/fiscal')}
                          </Badge>
                        )}
                      </div>
                      <div className="tiny muted mt-1">
                        {t('Solicitante:')} {req.requesterName} · {t('Recepción:')} {formatDate(req.receiptTimestamp.slice(0, 10))}
                      </div>
                    </div>
                    <div>
                      <CalendarMonthBadge
                        effectiveDeadline={req.effectiveDeadline}
                        isClosed={false}
                        hasExtension={!!req.extension}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Processing Records Requiring Attention */}
        <Card
          title={t('Tratamientos (RAT) que requieren atención')}
          subtitle={t('Campos obligatorios pendientes o validación técnica requerida')}
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate('/tratamientos')}>
              {t('Ver registro')}
            </Button>
          }
        >
          {companyRopas.filter((r) => r.status === 'draft' || r.missingFieldsWarning?.length || r.specialistReviewFlag).length === 0 ? (
            <div className="p-4 text-center text-muted">
              {t('Todas las actividades de tratamiento están debidamente validadas.')}
            </div>
          ) : (
            <div className="space-y-3">
              {companyRopas
                .filter((r) => r.status === 'draft' || r.missingFieldsWarning?.length || r.specialistReviewFlag)
                .slice(0, 5)
                .map((rat) => (
                  <div
                    key={rat.id}
                    className="p-3 border rounded row between items-center clickable hover-surface"
                    onClick={() => navigate(`/tratamientos?id=${rat.id}`)}
                  >
                    <div>
                      <div className="row items-center gap-2">
                        <span className="strong">{rat.code}</span>
                        <span>{rat.name}</span>
                        <Badge tone={ROPA_STATUS[rat.status].tone}>
                          {t(ROPA_STATUS[rat.status].label)}
                        </Badge>
                      </div>
                      <div className="tiny text-warning mt-1">
                        {rat.missingFieldsWarning?.length ? (
                          <span>⚠️ {t(rat.missingFieldsWarning[0])}</span>
                        ) : rat.specialistReviewFlag ? (
                          <span>⚖️ {t('Marcado para dictamen de asesor especializado / EIPD')}</span>
                        ) : (
                          <span className="muted">{t('En borrador')}</span>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost">
                      {t('Revisar')}
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>

      {/* Grid: Policies Requiring Review & Pending Tasks */}
      <div className="grid-2 gap-6">
        {/* Policies Requiring Review */}
        <Card
          title={t('Políticas y documentos que requieren revisión')}
          subtitle={t('Control de vigencia anual y actualización de cláusulas (Art. 24 RGPD)')}
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate('/documentos')}>
              {t('Ver documentos')}
            </Button>
          }
        >
          {docsAwaitingReview.length === 0 ? (
            <div className="p-4 text-center text-muted">
              {t('Todos los documentos y políticas están al día de revisión.')}
            </div>
          ) : (
            <div className="space-y-3">
              {docsAwaitingReview.slice(0, 5).map((doc) => (
                <div
                  key={doc.id}
                  className="p-3 border rounded row between items-center clickable hover-surface"
                  onClick={() => navigate(`/documentos?id=${doc.id}`)}
                >
                  <div>
                    <div className="row items-center gap-2">
                      <span className="strong">{doc.reference}</span>
                      <span>{doc.title}</span>
                      <Badge tone={doc.currentVersion ? DOC_STATUS[doc.currentVersion.status].tone : 'neutral'}>
                        v{doc.currentVersion?.version ?? '1.0'}
                      </Badge>
                    </div>
                    <div className="tiny text-warning mt-1">
                      {doc.nextReviewDate <= now ? (
                        <span>⚠️ {t('Revisión vencida el {date}', { date: formatDate(doc.nextReviewDate) })}</span>
                      ) : (
                        <span>{t('Próxima revisión: {date}', { date: formatDate(doc.nextReviewDate) })}</span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost">
                    {t('Gestionar')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Pending Tasks & DPO Review Queue */}
        <Card
          title={t('Tareas pendientes y revisiones prioritarias')}
          subtitle={t('Acciones operativas asignadas y seguimiento de plazos')}
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate('/tareas')}>
              {t('Ver tareas')}
            </Button>
          }
        >
          {pendingTasks.length === 0 ? (
            <div className="p-4 text-center text-muted">
              {t('No hay tareas pendientes en este momento.')}
            </div>
          ) : (
            <div className="space-y-3">
              {pendingTasks.slice(0, 5).map((task) => {
                const priorityMeta = TASK_PRIORITY[task.priority];
                const isOverdue = task.dueDate < now;
                return (
                  <div
                    key={task.id}
                    className="p-3 border rounded row between items-center clickable hover-surface"
                    onClick={() => navigate('/tareas')}
                  >
                    <div>
                      <div className="row items-center gap-2">
                        <span className="strong">{task.reference}</span>
                        <span>{task.title}</span>
                        <Badge tone={priorityMeta.tone}>
                          {t(priorityMeta.label)}
                        </Badge>
                      </div>
                      <div className="tiny muted mt-1">
                        <span className={isOverdue ? 'text-danger font-semibold' : ''}>
                          {t('Límite: {date}', { date: formatDate(task.dueDate) })}
                        </span>
                        {isOverdue && ` (${t('Fuera de plazo')})`}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost">
                      {t('Ver detalle')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Grid: Specialist Decisions & Recent Audit Timeline */}
      <div className="grid-2 gap-6">
        {/* Outstanding Professional-Review Decisions */}
        <Card
          title={t('Dictámenes y revisiones profesionales pendientes')}
          subtitle={t('Tratamientos de alto riesgo y proveedores sin evaluar como encargados')}
        >
          {ropasNeedingSpecialist.length === 0 && suppliersNeedingSpecialist.length === 0 ? (
            <div className="p-4 text-center text-muted">
              {t('No hay consultas técnicas o EIPD pendientes de dictamen.')}
            </div>
          ) : (
            <div className="space-y-3">
              {ropasNeedingSpecialist.map((r) => (
                <div key={r.id} className="p-3 border rounded bg-surface-2">
                  <div className="row between items-center">
                    <span className="strong">{r.code} · {r.name}</span>
                    <Badge tone="warning">{t('Revisión legal RAT')}</Badge>
                  </div>
                  <p className="tiny text-muted mt-1">
                    {r.dpiaRequired
                      ? t('Posible necesidad de Evaluación de Impacto (EIPD / DPIA). Requiere informe previo del DPO.')
                      : t('Base jurídica requiere ponderación de interés legítimo o confirmación por el asesor.')}
                  </p>
                  <Button
                    size="sm"
                    variant="link"
                    className="p-0 mt-1"
                    onClick={() => navigate(`/tratamientos?id=${r.id}`)}
                  >
                    {t('Gestionar dictamen →')}
                  </Button>
                </div>
              ))}

              {suppliersNeedingSpecialist.map((s) => (
                <div key={s.id} className="p-3 border rounded bg-surface-2">
                  <div className="row between items-center">
                    <span className="strong">{s.reference} · {s.name}</span>
                    <Badge tone="danger">{t('Rol Art. 28 por definir')}</Badge>
                  </div>
                  <p className="tiny text-muted mt-1">
                    {t('Proveedor con acceso a datos. No se asume automáticamente encargo; requiere revisión de contrato y funciones.')}
                  </p>
                  <Button
                    size="sm"
                    variant="link"
                    className="p-0 mt-1"
                    onClick={() => navigate(`/proveedores?id=${s.id}`)}
                  >
                    {t('Evaluar proveedor →')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Audit Feed */}
        <Card
          title={t('Registro de trazabilidad y auditoría')}
          subtitle={t('Evidencias inmutables encadenadas criptográficamente (Art. 5.2 RGPD)')}
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate('/auditoria')}>
              {t('Ver auditoría completa')}
            </Button>
          }
        >
          {ctx.db.audit.length === 0 ? (
            <div className="p-4 text-center text-muted">{t('Sin eventos registrados.')}</div>
          ) : (
            <div className="space-y-2">
              {ctx.db.audit
                .filter((a) => a.companyId === ctx.company.id)
                .slice(-5)
                .reverse()
                .map((ev) => (
                  <div key={ev.id} className="text-sm p-2 border-b last:border-b-0">
                    <div className="row between items-center">
                      <span className="strong tiny uppercase tracking-wider text-muted">
                        {t(ev.action)}
                      </span>
                      <span className="tiny muted">{formatInstant(ev.at)}</span>
                    </div>
                    <div className="mt-1">
                      {ev.restricted && !canViewRestrictedIncidents ? (
                        <span className="muted italic">
                          <Lock size={11} className="inline mr-1" />
                          {t('[Acceso auditado a registro sensible]')}
                        </span>
                      ) : (
                        t(ev.summary)
                      )}
                    </div>
                    <div className="tiny muted mt-0.5">
                      {t('Por:')} {ev.actor.name} ({t(ev.actor.role)})
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
