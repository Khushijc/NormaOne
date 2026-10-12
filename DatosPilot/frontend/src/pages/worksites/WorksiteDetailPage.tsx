/**
 * Detalle de un centro de trabajo: summary, assigned people with readiness for THIS site (scoped:
 * supervisors see their scope, representatives only aggregated counts), applicable requirement
 * templates, site instructions with versions and acknowledgement counts, related documents, open
 * preventive actions, CAE counterparties, requirement delta reviews and the audit history.
 */
import { AlertTriangle, ClipboardList, FileText, Handshake, Pencil, Power, ShieldAlert, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { DocStatusBadge, EmployeeLink, KindDate, msg, ReadinessBadge, ReadinessDisclaimer } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, PageHeader, StatusBadge, Tabs, useAction } from '../../components/ui';
import { assignmentOn } from '../../domain/requirements';
import { ACTION_STATUS, CAE_ROLE_LABEL, EVIDENCE_MODE_LABEL, PRIORITY, READINESS_ORDER, REQUIREMENT_TYPE } from '../../domain/status';
import type { ID, Worksite } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { casePending, visibleCases } from '../../services/caeService';
import { canSeeEmployee, employeeName, readinessAggregate, roleName, userName, visibleReadiness, visibleWorksiteIds } from '../../services/context';
import { documentState, versionsOfDocument, visibleDocuments } from '../../services/evidenceService';
import { employeesAt, setWorksiteActive } from '../../services/peopleService';
import { visibleActions } from '../../services/safetyService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { WorksiteFormModal } from './WorksiteFormModal';
import { CaseStatusBadge, customerName, isSpecialistTag, PendingBadges, ReadinessBreakdown, RiskTags, siteTemplates } from './worksiteShared';

type TabId = 'resumen' | 'personal' | 'requisitos' | 'instrucciones' | 'acciones' | 'cae' | 'historial';
const TABS: TabId[] = ['resumen', 'personal', 'requisitos', 'instrucciones', 'acciones', 'cae', 'historial'];

export function WorksiteDetailPage() {
  const { id = '' } = useParams();
  const ctx = useCtx();
  const ws = ctx.db.worksites.find((w) => w.id === id && w.companyId === ctx.company.id && visibleWorksiteIds(ctx).has(w.id));
  if (!ws) return <RecordNotFound back="/centros" label={tKey('Centros de trabajo')} />;
  return <WorksiteDetail ctx={ctx} ws={ws} />;
}

function WorksiteDetail({ ctx, ws }: { ctx: UiCtx; ws: Worksite }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { run } = useAction();
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const canManage = ctx.can('worksites.manage');
  const individual = ctx.can('employees.view_all') || ctx.can('team.view');
  const caeVisible = ctx.can('cae.view') || ctx.can('representative.view');

  const people = useMemo(() => employeesAt(ctx, ws.id), [ctx, ws.id]);
  const agg = readinessAggregate(ctx).find((a) => a.worksiteId === ws.id);
  const cases = caeVisible ? visibleCases(ctx).filter((c) => c.worksiteId === ws.id) : [];
  const openActions = visibleActions(ctx).filter((a) => a.worksiteId === ws.id && a.status !== 'resolved');
  const deltaReviews = ctx.db.changes.filter((c) => c.companyId === ctx.company.id && c.trigger === 'worksite_change' && c.focusWorksiteIds.includes(ws.id));
  const pendingReviews = deltaReviews.filter((c) => c.status === 'pending_review');
  const specialist = ws.riskTags.filter((x) => isSpecialistTag(ctx, x));

  const raw = params.get('tab') as TabId | null;
  const tab: TabId = raw && TABS.includes(raw) && (raw !== 'cae' || caeVisible) ? raw : 'resumen';
  const setTab = (v: TabId) => setParams((p) => { p.set('tab', v); return p; }, { replace: true });

  return (
    <div className="stack-lg">
      <PageHeader
        breadcrumbs={<Link to="/centros">{t('Centros de trabajo')}</Link>}
        title={ws.name}
        subtitle={
          <span className="row-wrap" style={{ gap: 6 }}>
            <span className="tag">{ws.code}</span>
            <span>{ws.kind === 'customer' ? customerName(ctx, ws.customerId) : t('Centro propio')}</span>
            <span className="muted">· {ws.municipality}</span>
            {ws.active ? <Badge tone="success">{t('Activo')}</Badge> : <Badge tone="neutral">{t('Inactivo')}</Badge>}
            {ws.sharedWorkplace && <Badge tone="info" icon={Handshake}>{t('Lugar compartido')}</Badge>}
          </span>
        }
        actions={
          canManage && (
            <>
              <Button icon={Pencil} onClick={() => setEditing(true)}>
                {t('Editar')}
              </Button>
              <Button icon={Power} variant={ws.active ? 'danger-outline' : 'secondary'} onClick={() => setToggling(true)}>
                {ws.active ? t('Desactivar centro') : t('Reactivar centro')}
              </Button>
            </>
          )
        }
      />

      {!ws.active && (
        <Callout tone="neutral" title={t('Centro inactivo')}>
          {t('No se pueden asignar personas nuevas. El historial, las evidencias y los casos CAE se conservan.')}
        </Callout>
      )}
      {specialist.length > 0 && (
        <Callout tone="warning" title={t('Riesgos de alcance especializado')}>
          {t('Este centro tiene riesgos fuera del alcance inicial del producto (por ejemplo, obras de construcción o espacios confinados). Requieren un circuito aprobado aparte.')}
        </Callout>
      )}
      {pendingReviews.length > 0 && (
        <Callout tone="warning" title={t('{n} revisiones de requisitos pendientes por cambios en este centro', { n: pendingReviews.length })}>
          <button type="button" className="link-btn" onClick={() => setTab('historial')}>
            {t('Ver las revisiones pendientes')}
          </button>
        </Callout>
      )}
      {ws.active && ws.sharedWorkplace && caeVisible && !cases.some((c) => c.status !== 'closed') && (
        <Callout tone="info" title={t('Lugar compartido sin caso CAE abierto')}>
          {t('Concurren trabajadores de otras empresas, pero no hay un caso de coordinación abierto. Que proceda la CAE es una valoración profesional.')}{' '}
          {ctx.can('cae.manage') && <Link to={`/cae?nuevo=1&centro=${ws.id}`}>{t('Abrir caso CAE')}</Link>}
        </Callout>
      )}

      <Tabs<TabId>
        label={t('Secciones del centro')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'resumen', label: t('Resumen') },
          { id: 'personal', label: t('Personal'), count: people.length },
          { id: 'requisitos', label: t('Requisitos') },
          { id: 'instrucciones', label: t('Instrucciones y documentos') },
          { id: 'acciones', label: t('Acciones preventivas'), count: openActions.length },
          { id: 'cae', label: t('Coordinación CAE'), count: cases.length, hidden: !caeVisible },
          { id: 'historial', label: t('Revisiones e historial'), count: pendingReviews.length || undefined },
        ]}
      />

      {tab === 'resumen' && (
        <div className="grid-main-side">
          <div className="stack">
            <Card title={t('Datos del centro')}>
              <KV
                items={[
                  [t('Código'), ws.code],
                  [t('Tipo de centro'), ws.kind === 'customer' ? t('Centro de un cliente') : t('Centro propio')],
                  [t('Organización cliente'), ws.kind === 'customer' ? customerName(ctx, ws.customerId) : '—'],
                  [t('Dirección'), `${ws.address}, ${ws.municipality}`],
                  [t('Contacto en el centro'), ws.siteContactName ? `${ws.siteContactName}${ws.siteContactPhone ? ` · ${ws.siteContactPhone}` : ''}` : <span className="muted">{t('Sin contacto')}</span>],
                  [t('Coordinación interna'), ws.coordinatorEmployeeId ? (canSeeEmployee(ctx, ws.coordinatorEmployeeId) ? <EmployeeLink id={ws.coordinatorEmployeeId} /> : employeeName(ctx.db, ws.coordinatorEmployeeId)) : <span className="muted">{t('Sin asignar')}</span>],
                  [t('Lugar compartido'), ws.sharedWorkplace ? t('Sí: concurren otras empresas') : t('No')],
                  [t('Última modificación'), <DateTimeText at={ws.updatedAt} />],
                ]}
              />
            </Card>
            <Card title={t('Riesgos y actividades del centro')}>
              <div className="stack-sm">
                <div>
                  <div className="small muted">{t('Actividades')}</div>
                  <p style={{ margin: '2px 0 0' }}>{ws.activities || <span className="muted">{t('Sin actividades registradas')}</span>}</p>
                </div>
                <div>
                  <div className="small muted">{t('Riesgos')}</div>
                  <RiskTags ctx={ctx} tags={ws.riskTags} />
                </div>
                <p className="tiny muted">{t('Cada centro tiene sus propios riesgos: los requisitos aplicables dependen de ellos y del puesto de cada persona.')}</p>
              </div>
            </Card>
          </div>
          <div className="stack">
            <Card title={t('Disponibilidad en este centro')}>
              <div className="stack-sm">
                {ws.active ? <ReadinessBreakdown counts={agg?.counts ?? {}} /> : <span className="muted small">{t('Centro inactivo')}</span>}
                <ReadinessDisclaimer />
              </div>
            </Card>
            <Card title={t('Resumen')}>
              <KV
                items={[
                  [t('Personas asignadas'), people.length],
                  [t('Acciones abiertas'), openActions.length],
                  [t('Revisiones de requisitos pendientes'), pendingReviews.length],
                  [t('Casos CAE'), caeVisible ? cases.length : <span className="muted small">{t('Sin acceso')}</span>],
                ]}
              />
            </Card>
          </div>
        </div>
      )}

      {tab === 'personal' && <PeopleTab ctx={ctx} ws={ws} people={people} individual={individual} counts={agg?.counts ?? {}} />}
      {tab === 'requisitos' && <RequirementsTab ctx={ctx} ws={ws} />}
      {tab === 'instrucciones' && <InstructionsTab ctx={ctx} ws={ws} people={people} />}
      {tab === 'acciones' && <ActionsTab ctx={ctx} actions={openActions} />}
      {tab === 'cae' && caeVisible && <CaeTab ctx={ctx} ws={ws} cases={cases} />}
      {tab === 'historial' && <HistoryTab ctx={ctx} ws={ws} reviews={deltaReviews} individual={individual} />}

      {editing && <WorksiteFormModal worksite={ws} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {toggling && (
        <ConfirmDialog
          title={ws.active ? t('Desactivar {name}', { name: ws.name }) : t('Reactivar {name}', { name: ws.name })}
          danger={ws.active}
          confirmLabel={ws.active ? t('Desactivar centro') : t('Reactivar centro')}
          requireReason
          message={
            <p className="small">
              {ws.active
                ? t('Hay {n} personas asignadas a este centro. Al desactivarlo se abrirá una revisión de cambios de requisitos para las personas afectadas. El historial, las evidencias y los casos CAE se conservan.', { n: people.length })
                : t('Al reactivarlo, las {n} personas asignadas recibirán una revisión de cambios de requisitos. El historial se conserva.', { n: people.length })}
            </p>
          }
          onConfirm={async (reason) => {
            const wasActive = ws.active;
            const r = await run(() => setWorksiteActive(ws.id, !wasActive, reason), (res) => (wasActive ? t('Centro desactivado: {n} revisiones de requisitos abiertas', { n: res.reviews }) : t('Centro reactivado: {n} revisiones de requisitos abiertas', { n: res.reviews })));
            if (r && r.reviews) navigate(`/centros/${ws.id}?tab=historial`, { replace: true });
            return !!r;
          }}
          onClose={() => setToggling(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Personal ───────────────────────────────

function PeopleTab({ ctx, ws, people, individual, counts }: { ctx: UiCtx; ws: Worksite; people: ID[]; individual: boolean; counts: Record<string, number> }) {
  const rows = useMemo(() => (individual ? visibleReadiness(ctx).filter((r) => r.worksiteId === ws.id) : []), [ctx, ws.id, individual]);
  const roleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of people) {
      const name = roleName(ctx.db, assignmentOn(ctx.db, id, ctx.today)?.jobRoleId);
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [ctx, people]);

  if (!individual) {
    return (
      <Card title={t('Personal asignado (datos agregados)')}>
        <div className="stack">
          <Callout tone="info">{t('Su rol da acceso a información agregada: no se muestran nombres ni el detalle individual.')}</Callout>
          <KV items={[[t('Personas asignadas'), people.length], ...roleCounts.map(([name, n]) => [name, n] as [string, number])]} />
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Disponibilidad agregada')}</caption>
              <thead>
                <tr>
                  <th>{t('Disponibilidad')}</th>
                  <th className="num">{t('Personas')}</th>
                </tr>
              </thead>
              <tbody>
                {READINESS_ORDER.map((s) => (
                  <tr key={s}>
                    <td>
                      <ReadinessBadge state={s} />
                    </td>
                    <td className="num">{counts[s] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ReadinessDisclaimer />
        </div>
      </Card>
    );
  }

  const sorted = [...rows].sort((a, b) => READINESS_ORDER.indexOf(a.state) - READINESS_ORDER.indexOf(b.state) || employeeName(ctx.db, a.employeeId).localeCompare(employeeName(ctx.db, b.employeeId), 'es'));
  const hidden = people.length - rows.length;
  return (
    <Card title={t('Personal asignado y disponibilidad en este centro')} flush>
      {sorted.length === 0 ? (
        <EmptyState icon={Users} title={people.length ? t('No hay personas de su ámbito en este centro') : t('No hay personas asignadas')}>
          {people.length ? t('Hay {n} personas asignadas fuera de su ámbito de acceso.', { n: people.length }) : t('Asigne personal desde la ficha de cada empleado (cambio de puesto o centro).')}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Personal asignado y disponibilidad en este centro')}</caption>
              <thead>
                <tr>
                  <th>{t('Persona')}</th>
                  <th>{t('Puesto')}</th>
                  <th>{t('Disponibilidad')}</th>
                  <th className="num">{t('Requisitos resueltos')}</th>
                  <th>{t('Motivo principal')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const reason = r.reasons.find((x) => x.state === r.state) ?? r.reasons[0];
                  return (
                    <tr key={r.employeeId}>
                      <td>
                        <Link to={`/empleados/${r.employeeId}?tab=requisitos`}>{employeeName(ctx.db, r.employeeId)}</Link>
                      </td>
                      <td className="small">{roleName(ctx.db, assignmentOn(ctx.db, r.employeeId, ctx.today)?.jobRoleId)}</td>
                      <td>
                        <ReadinessBadge state={r.state} />
                        {r.exceptions.length > 0 && (
                          <div className="tiny muted">{t('Con excepción temporal autorizada')}</div>
                        )}
                      </td>
                      <td className="num nowrap">
                        {r.counts.satisfied}/{r.counts.counted}
                        {r.counts.criticalOpen > 0 && (
                          <div>
                            <Badge tone="danger">{t('{n} críticos abiertos', { n: r.counts.criticalOpen })}</Badge>
                          </div>
                        )}
                      </td>
                      <td className="small">{reason ? msg(reason.msg) : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body stack-sm">
            {hidden > 0 && <p className="tiny muted">{t('Otras {n} personas asignadas quedan fuera de su ámbito y no se muestran.', { n: hidden })}</p>}
            <ReadinessDisclaimer />
          </div>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────── Requisitos ───────────────────────────────

function RequirementsTab({ ctx, ws }: { ctx: UiCtx; ws: Worksite }) {
  const rows = useMemo(() => siteTemplates(ctx, ws), [ctx, ws]);
  const canOpen = ctx.can('requirements.view');
  return (
    <Card title={t('Requisitos aplicables por el centro')} flush>
      {rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('Ningún requisito vigente se dirige a este centro')}>
          {t('Los requisitos derivados del puesto de cada persona se muestran en su ficha.')}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Requisitos aplicables por el centro')}</caption>
              <thead>
                <tr>
                  <th>{t('Código')}</th>
                  <th>{t('Requisito')}</th>
                  <th>{t('Tipo')}</th>
                  <th>{t('Evidencia')}</th>
                  <th>{t('Crítico')}</th>
                  <th>{t('Por qué aplica')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ template, version, via }) => (
                  <tr key={template.id}>
                    <td className="nowrap">
                      <span className="tag">{template.code}</span>
                      <div className="tiny muted">v{version.version}</div>
                    </td>
                    <td>{canOpen ? <Link to={`/requisitos/${template.id}`}>{version.name}</Link> : version.name}</td>
                    <td>
                      <StatusBadge meta={REQUIREMENT_TYPE[version.requirementType]} />
                    </td>
                    <td className="small">{t(EVIDENCE_MODE_LABEL[version.evidenceMode])}</td>
                    <td>{version.critical ? <Badge tone="danger" icon={ShieldAlert}>{t('Crítico')}</Badge> : <span className="muted small">{t('No')}</span>}</td>
                    <td className="small">
                      {via.map((v) => t(v)).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body">
            <p className="tiny muted">{t('Solo se listan versiones vigentes aprobadas cuyo ámbito incluye este centro o sus riesgos. Los requisitos derivados del puesto de cada persona se muestran en su ficha.')}</p>
          </div>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────── Instrucciones y documentos ───────────────────────────────

function InstructionsTab({ ctx, ws, people }: { ctx: UiCtx; ws: Worksite; people: ID[] }) {
  const docs = visibleDocuments(ctx).filter((d) => d.worksiteId === ws.id && !d.employeeId);
  const instructions = docs.filter((d) => d.categoryId === 'instruccion_centro');
  const related = docs.filter((d) => d.categoryId !== 'instruccion_centro');
  const assigned = new Set(people);
  const catLabel = (id: string) => ctx.db.categories.find((c) => c.id === id && c.companyId === ctx.company.id)?.label ?? id;
  const ackCount = (docId: ID, versionId: ID, onlyAssigned: boolean) =>
    new Set(ctx.db.acknowledgements.filter((a) => a.companyId === ctx.company.id && a.subject.kind === 'document' && a.subject.id === docId && a.documentVersionId === versionId && (!onlyAssigned || assigned.has(a.employeeId))).map((a) => a.employeeId)).size;

  return (
    <div className="stack">
      <Card title={t('Instrucciones de seguridad del centro')}>
        {instructions.length === 0 ? (
          <EmptyState icon={FileText} title={t('Sin instrucciones del centro registradas')}>
            {ws.kind === 'customer' ? t('Si el titular del centro facilita instrucciones, regístrelas como documento de la categoría «Instrucciones de seguridad del centro».') : t('No hay instrucciones específicas registradas para este centro.')}
          </EmptyState>
        ) : (
          <div className="stack">
            {instructions.map((d) => {
              const st = documentState(ctx, d.id);
              const current = st.accepted;
              const acked = current ? ackCount(d.id, current.id, true) : 0;
              return (
                <section key={d.id} className="ws-doc">
                  <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <Link to={`/documentacion/${d.id}`} className="strong">
                        {d.title}
                      </Link>
                      <div className="tiny muted">
                        {d.code} · {current ? t('Versión vigente: v{v}', { v: current.version }) : t('Sin versión aceptada')}
                      </div>
                    </div>
                    {current ? (
                      <Badge tone={acked >= people.length && people.length > 0 ? 'success' : 'warning'}>
                        {t('{n} de {total} confirmaciones de la versión vigente', { n: acked, total: people.length })}
                      </Badge>
                    ) : (
                      <Badge tone="warning">{t('Sin versión aceptada')}</Badge>
                    )}
                  </div>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table className="table">
                      <caption className="sr-only">{t('Versiones de {title}', { title: d.title })}</caption>
                      <thead>
                        <tr>
                          <th>{t('Versión')}</th>
                          <th>{t('Emisor')}</th>
                          <th>{t('Fecha de emisión')}</th>
                          <th>{t('Estado')}</th>
                          <th>{t('Revisión del proveedor')}</th>
                          <th className="num">{t('Confirmaciones')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {versionsOfDocument(ctx, d.id).map((v) => (
                          <tr key={v.id}>
                            <td className="nowrap">v{v.version}</td>
                            <td className="small">{v.issuer}</td>
                            <td>
                              <DateText date={v.issueDate} />
                            </td>
                            <td>
                              <DocStatusBadge status={v.status} />
                            </td>
                            <td>
                              <KindDate kind="provider" date={v.providerReviewDate} today={ctx.today} />
                            </td>
                            <td className="num">{ackCount(d.id, v.id, false)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
            <p className="tiny muted">{t('Confirmaciones requeridas: una por persona asignada para la versión vigente. Una versión nueva necesita una confirmación nueva. La confirmación de recepción no equivale a formación.')}</p>
          </div>
        )}
      </Card>

      <Card title={t('Otros documentos del centro')} flush>
        {related.length === 0 ? (
          <EmptyState icon={FileText} title={t('Sin otros documentos del centro')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Otros documentos del centro')}</caption>
              <thead>
                <tr>
                  <th>{t('Documento')}</th>
                  <th>{t('Categoría')}</th>
                  <th>{t('Última versión')}</th>
                  <th>{t('Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {related.map((d) => {
                  const st = documentState(ctx, d.id);
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link to={`/documentacion/${d.id}`}>{d.title}</Link>
                        <div className="tiny muted">{d.code}</div>
                      </td>
                      <td className="small">{catLabel(d.categoryId)}</td>
                      <td className="nowrap">{st.latest ? `v${st.latest.version}` : '—'}</td>
                      <td>{st.latest ? <DocStatusBadge status={st.latest.status} /> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────── Acciones ───────────────────────────────

function ActionsTab({ ctx, actions }: { ctx: UiCtx; actions: ReturnType<typeof visibleActions> }) {
  return (
    <Card title={t('Acciones preventivas abiertas')} flush>
      {actions.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('Sin acciones preventivas abiertas en este centro')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">{t('Acciones preventivas abiertas')}</caption>
            <thead>
              <tr>
                <th>{t('Código')}</th>
                <th>{t('Acción')}</th>
                <th>{t('Prioridad')}</th>
                <th>{t('Estado')}</th>
                <th>{t('Responsable')}</th>
                <th>{t('Fecha objetivo')}</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">
                    <span className="tag">{a.code}</span>
                  </td>
                  <td>
                    <Link to={`/acciones/${a.id}`}>{a.title}</Link>
                    {a.affectsReadiness && <div className="tiny muted">{t('Afecta a la disponibilidad del centro')}</div>}
                  </td>
                  <td>
                    <StatusBadge meta={PRIORITY[a.priority]} />
                  </td>
                  <td>
                    <StatusBadge meta={ACTION_STATUS[a.status]} />
                  </td>
                  <td className="small">{a.ownerUserId ? userName(ctx.db, a.ownerUserId) : <span className="muted">{t('Sin asignar')}</span>}</td>
                  <td>
                    <KindDate kind="target" date={a.targetDate} today={ctx.today} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────── CAE ───────────────────────────────

function CaeTab({ ctx, ws, cases }: { ctx: UiCtx; ws: Worksite; cases: ReturnType<typeof visibleCases> }) {
  if (!cases.length) {
    return (
      <Card>
        <EmptyState
          icon={Handshake}
          title={t('Sin casos de coordinación en este centro')}
          action={ctx.can('cae.manage') && ws.active ? <Link className="btn" to={`/cae?nuevo=1&centro=${ws.id}`}>{t('Abrir caso CAE')}</Link> : undefined}
        >
          {ws.sharedWorkplace ? t('El centro está marcado como lugar compartido.') : t('El centro no está marcado como lugar compartido.')}
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="stack">
      {cases.map((c) => (
        <Card
          key={c.id}
          title={
            <h2>
              <Link to={`/cae/${c.id}`}>
                {c.code} · {c.title}
              </Link>
            </h2>
          }
          actions={<CaseStatusBadge status={c.status} />}
          flush
        >
          <div className="card-body stack-sm">
            <div className="row-wrap small">
              <span className="muted">{t('Puntos abiertos')}:</span>
              <PendingBadges p={casePending(ctx, c)} />
            </div>
            <div className="row-wrap small">
              <span className="muted">{t('Próximo seguimiento')}:</span>
              <KindDate kind="internal" date={c.nextFollowUp} today={ctx.today} />
              <span className="muted">· {userName(ctx.db, c.followUpOwnerId)}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Empresas y contactos del caso {code}', { code: c.code })}</caption>
              <thead>
                <tr>
                  <th>{t('Organización')}</th>
                  <th>{t('Papel en la coordinación')}</th>
                  <th>{t('Contacto')}</th>
                </tr>
              </thead>
              <tbody>
                {c.participants.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.organisation} {p.isOwnCompany && <Badge tone="neutral">{t('Propia empresa')}</Badge>}
                    </td>
                    <td className="small">{t(CAE_ROLE_LABEL[p.role])}</td>
                    <td className="small">
                      {p.contactName}
                      {p.contactEmail && <div className="tiny muted">{p.contactEmail}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────── Revisiones e historial ───────────────────────────────

function HistoryTab({ ctx, ws, reviews, individual }: { ctx: UiCtx; ws: Worksite; reviews: UiCtx['db']['changes']; individual: boolean }) {
  const pending = reviews.filter((c) => c.status === 'pending_review').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = reviews.length - pending.length;
  const visible = pending.filter((c) => individual && canSeeEmployee(ctx, c.employeeId));
  return (
    <div className="stack">
      <Card title={t('Revisiones de requisitos por cambios en el centro')} flush>
        {pending.length === 0 ? (
          <EmptyState icon={AlertTriangle} title={t('Sin revisiones de requisitos pendientes')}>
            {done ? t('{n} revisiones ya completadas.', { n: done }) : t('Un cambio de riesgos o la desactivación del centro abre una revisión para cada persona afectada.')}
          </EmptyState>
        ) : (
          <>
            {visible.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">{t('Revisiones de requisitos pendientes')}</caption>
                  <thead>
                    <tr>
                      <th>{t('Persona')}</th>
                      <th>{t('Creada')}</th>
                      <th>{t('Motivo')}</th>
                      <th className="num">{t('Nuevos')}</th>
                      <th className="num">{t('Ya no aplican')}</th>
                      <th className="num">{t('Críticos sin resolver')}</th>
                      <th>{t('Estado')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/empleados/${c.employeeId}?tab=cambios`}>{employeeName(ctx.db, c.employeeId)}</Link>
                        </td>
                        <td>
                          <DateTimeText at={c.createdAt} />
                        </td>
                        <td className="small">{t(c.reason)}</td>
                        <td className="num">{c.delta.newlyRequired.length}</td>
                        <td className="num">{c.delta.noLongerApplicable.length}</td>
                        <td className="num">{c.delta.newCriticalUnresolved.length ? <Badge tone="danger">{c.delta.newCriticalUnresolved.length}</Badge> : 0}</td>
                        <td>
                          <Badge tone="warning">{t('Pendiente de revisar')}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="card-body">
              <p className="tiny muted">
                {visible.length < pending.length
                  ? t('{n} revisiones pendientes en total; solo se muestran las de personas de su ámbito.', { n: pending.length })
                  : t('Se revisan en la ficha de cada persona (pestaña Cambios). Las evidencias existentes no se invalidan por el cambio.')}
                {done ? ` ${t('{n} revisiones ya completadas.', { n: done })}` : ''}
              </p>
            </div>
          </>
        )}
      </Card>
      <Card title={t('Historial del centro')}>
        <AuditList filter={(e) => e.entityId === ws.id} />
      </Card>
    </div>
  );
}
