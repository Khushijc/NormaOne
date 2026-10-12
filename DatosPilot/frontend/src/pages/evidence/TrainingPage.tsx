/**
 * Formación e información (`/formacion?tab=catalogo|asignaciones|mi-formacion`).
 * Catalogue, assignments (scheduled date, attendance, completion and evidence in separate
 * columns), training requirements without accepted evidence, and the employee's own view.
 * Attendance, completion, acknowledgement of information and evidence acceptance are distinct.
 */
import { BookOpen, CalendarPlus, CheckSquare, ClipboardList, GraduationCap, Pencil, Plus, Send, Upload, UserCheck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExportButton } from '../../components/ExportButton';
import { DocStatusBadge, EmployeeLink, ItemStatusBadge, msg } from '../../components/bits';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, EmptyState, PageHeader, Pagination, SelectField, SortHeader, StatusBadge, Tabs, TextField, sortRows, useAction, usePaged, useSort } from '../../components/ui';
import { assignmentOn, type MatrixItem } from '../../domain/requirements';
import { TRAINING_STATUS } from '../../domain/status';
import type { DocStatus, ID, TrainingAssignment, TrainingStatus } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { EMPTY_FILTERS } from '../../services/reportService';
import { cancelTraining, visibleTrainings } from '../../services/trainingService';
import { canSeeDocument, employeeName, itemsFor, visibleEmployeeIds, visibleWorksiteIds } from '../../services/context';
import { versionsOfDocument } from '../../services/evidenceService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { RequestEvidenceModal, RequirementRef } from './evidenceShared';
import { AssignModal, CourseModal, MODALITY, TrainingDateModal, refresherText } from './TrainingModals';

type Tab = 'catalogo' | 'asignaciones' | 'mi-formacion';
const OPEN: TrainingStatus[] = ['assigned', 'scheduled', 'attended'];

const SEPARATE_FACTS = tKey('La asistencia, la finalización, la confirmación de información y la aceptación de la evidencia son hechos distintos; ninguno sustituye a otro.');

/** Evidence status of an assignment, from its linked document (latest version). */
function evidenceOf(ctx: UiCtx, tr: TrainingAssignment): { status: DocStatus | null; docId: ID | null; visible: boolean } {
  if (!tr.documentId) return { status: null, docId: null, visible: false };
  const v = versionsOfDocument(ctx, tr.documentId)[0];
  const doc = ctx.db.documents.find((d) => d.id === tr.documentId);
  return { status: v?.status ?? null, docId: tr.documentId, visible: !!doc && canSeeDocument(ctx, doc) };
}

function EvidenceCell({ tr }: { tr: TrainingAssignment }) {
  const ctx = useCtx();
  const ev = evidenceOf(ctx, tr);
  if (!ev.status) return <span className="muted small">{t('Sin evidencia')}</span>;
  return ev.visible ? (
    <Link to={`/documentacion/${ev.docId}`} className="ev-plain-link" aria-label={t('Ver evidencia')}>
      <DocStatusBadge status={ev.status} />
    </Link>
  ) : (
    <DocStatusBadge status={ev.status} />
  );
}

function DateOrDash({ date, hint }: { date: string | null; hint?: string }) {
  if (!date) return <span className="muted small">{hint ?? '—'}</span>;
  return <DateText date={date} />;
}

export function TrainingPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const canManage = ctx.can('training.manage');
  const canViewAll = canManage || ctx.can('employees.view_all') || ctx.can('team.view');
  const hasOwn = !!ctx.employee && ctx.can('own.view');
  const requested = params.get('tab') as Tab | null;
  const fallback: Tab = canViewAll ? 'asignaciones' : hasOwn ? 'mi-formacion' : 'catalogo';
  const tab: Tab = requested === 'catalogo' || (requested === 'asignaciones' && canViewAll) || (requested === 'mi-formacion' && hasOwn) ? requested : fallback;
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="stack-lg">
      <PageHeader title={t('Formación e información')} subtitle={t('Catálogo de cursos, asignaciones y evidencias de formación. La formación se acredita con evidencia aceptada por la autoridad de revisión.')} />
      <Callout tone="info">{t(SEPARATE_FACTS)}</Callout>
      <Tabs<Tab>
        label={t('Secciones de formación')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'asignaciones', label: t('Asignaciones'), hidden: !canViewAll },
          { id: 'catalogo', label: t('Catálogo') },
          { id: 'mi-formacion', label: t('Mi formación'), hidden: !hasOwn },
        ]}
      />
      {tab === 'catalogo' && <CatalogTab />}
      {tab === 'asignaciones' && canViewAll && <AssignmentsTab />}
      {tab === 'mi-formacion' && hasOwn && <MyTrainingTab />}
    </div>
  );
}

// ─────────────────────────────── Catálogo ───────────────────────────────

function CatalogTab() {
  const ctx = useCtx();
  const canManage = ctx.can('training.manage');
  const [editing, setEditing] = useState<ID | 'new' | null>(null);
  const [q, setQ] = useState('');
  const tagLabel = (id: string) => ctx.db.riskTags.find((r) => r.id === id && r.companyId === ctx.company.id)?.label ?? id;
  const all = ctx.db.courses.filter((c) => c.companyId === ctx.company.id);
  const needle = q.trim().toLowerCase();
  const rows = all.filter((c) => !needle || [c.code, c.title, c.providerName, c.contentSummary].some((x) => x.toLowerCase().includes(needle)));
  const { sort, onSort } = useSort('code', 'asc');
  const sorted = sortRows(rows, sort, (c, col) => (col === 'title' ? c.title : col === 'provider' ? c.providerName : col === 'hours' ? c.durationHours : c.code));
  const paged = usePaged(sorted, 25);
  return (
    <Card
      flush
      title={t('Catálogo de cursos')}
      actions={
        canManage && (
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            {t('Nuevo curso')}
          </Button>
        )
      }
    >
      <div className="toolbar">
        <TextField className="search" label={t('Buscar')} type="search" placeholder={t('Código, título, proveedor…')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {all.length === 0 ? (
        <EmptyState icon={BookOpen} title={t('El catálogo está vacío')} action={canManage && <Button icon={Plus} onClick={() => setEditing('new')}>{t('Nuevo curso')}</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={BookOpen} title={t('Ningún curso coincide con la búsqueda')} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label={t('Código')} col="code" sort={sort} onSort={onSort} />
                  <SortHeader label={t('Curso')} col="title" sort={sort} onSort={onSort} />
                  <SortHeader label={t('Proveedor')} col="provider" sort={sort} onSort={onSort} />
                  <th>{t('Modalidad')}</th>
                  <SortHeader label={t('Horas')} col="hours" sort={sort} onSort={onSort} num />
                  <th>{t('Riesgos')}</th>
                  <th>{t('Reciclaje')}</th>
                  {canManage && <th>{t('Acciones')}</th>}
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">
                      <span className="tag">{c.code}</span>
                    </td>
                    <td className="ev-title-cell">
                      <span className="strong">{c.title}</span>
                      {!c.active && (
                        <>
                          {' '}
                          <Badge tone="neutral">{t('Inactivo')}</Badge>
                        </>
                      )}
                      {c.contentSummary && <span className="sub" style={{ display: 'block' }}>{c.contentSummary}</span>}
                    </td>
                    <td className="small">{c.providerName}</td>
                    <td className="small">{t(MODALITY[c.modality])}</td>
                    <td className="num">{c.durationHours ?? '—'}</td>
                    <td>
                      {c.riskTags.length ? (
                        <span className="status-stack">
                          {c.riskTags.map((r) => (
                            <span key={r} className="tag">
                              {tagLabel(r)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted small">{t('General')}</span>
                      )}
                    </td>
                    <td className="small">
                      {c.refresher.kind === 'not_determined' ? <Badge tone="warning">{refresherText(c.refresher)}</Badge> : refresherText(c.refresher)}
                    </td>
                    {canManage && (
                      <td>
                        <Button size="sm" icon={Pencil} onClick={() => setEditing(c.id)} aria-label={t('Editar curso {code}', { code: c.code })}>
                          {t('Editar')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paged.props} />
        </>
      )}
      <div className="card-footer small muted">{t('El reciclaje solo se aplica cuando lo fija el proveedor, una norma o la evaluación de riesgos; la aplicación no impone una formación anual universal.')}</div>
      {editing && <CourseModal courseId={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

// ─────────────────────────────── Asignaciones ───────────────────────────────

type RowDialog = { kind: 'schedule' | 'attendance' | 'completion'; tr: TrainingAssignment } | { kind: 'cancel'; tr: TrainingAssignment } | null;

function AssignmentsTab() {
  const ctx = useCtx();
  const canManage = ctx.can('training.manage');
  const canUpload = ctx.can('evidence.upload');
  const { runOk } = useAction();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TrainingStatus | ''>('');
  const [courseId, setCourseId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [dialog, setDialog] = useState<RowDialog>(null);
  const [assign, setAssign] = useState<{ employeeId?: ID; courseId?: ID; templateId?: ID | null } | null>(null);

  const trainings = visibleTrainings(ctx);
  const sitesOf = useMemo(() => {
    const cache = new Map<ID, ID[]>();
    return (id: ID) => {
      if (!cache.has(id)) cache.set(id, assignmentOn(ctx.db, id, ctx.today)?.worksiteIds ?? []);
      return cache.get(id)!;
    };
  }, [ctx]);
  const empIds = visibleEmployeeIds(ctx);
  const employees = ctx.db.employees.filter((e) => empIds.has(e.id)).sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es'));
  const wsIds = visibleWorksiteIds(ctx);
  const worksites = ctx.db.worksites.filter((w) => wsIds.has(w.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const courses = ctx.db.courses.filter((c) => c.companyId === ctx.company.id);
  const courseOf = (id: ID) => courses.find((c) => c.id === id);

  const inScope = (empId: ID) => (!employeeId || empId === employeeId) && (!worksiteId || sitesOf(empId).includes(worksiteId));
  const needle = q.trim().toLowerCase();
  const filtered = trainings.filter((tr) => {
    if (!inScope(tr.employeeId)) return false;
    if (status && tr.status !== status) return false;
    if (courseId && tr.courseId !== courseId) return false;
    if (needle) {
      const c = courseOf(tr.courseId);
      if (![employeeName(ctx.db, tr.employeeId), c?.title ?? '', c?.code ?? ''].some((x) => x.toLowerCase().includes(needle))) return false;
    }
    return true;
  });
  const { sort, onSort } = useSort('scheduled', 'desc');
  const sorted = sortRows(filtered, sort, (tr, col) => {
    switch (col) {
      case 'employee':
        return employeeName(ctx.db, tr.employeeId);
      case 'course':
        return courseOf(tr.courseId)?.title ?? tr.courseId;
      case 'status':
        return Object.keys(TRAINING_STATUS).indexOf(tr.status);
      case 'attendance':
        return tr.attendanceDate;
      case 'completion':
        return tr.completionDate;
      case 'evidence':
        return evidenceOf(ctx, tr).status ?? '';
      default:
        return tr.scheduledDate ?? tr.assignedAt.slice(0, 10);
    }
  });
  const paged = usePaged(sorted, 25);

  // Training requirements without accepted evidence (per visible employee, health masked by itemsFor).
  const missing = useMemo(() => {
    const out: MatrixItem[] = [];
    for (const id of empIds) for (const it of itemsFor(ctx, id)) if (it.version.evidenceMode === 'training' && !it.satisfied && !it.restricted) out.push(it);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  const missingFiltered = missing.filter((it) => inScope(it.employeeId)).sort((a, b) => employeeName(ctx.db, a.employeeId).localeCompare(employeeName(ctx.db, b.employeeId), 'es'));
  const missingPaged = usePaged(missingFiltered, 10);
  const [requestFor, setRequestFor] = useState<MatrixItem | null>(null);
  const openTrainingFor = (empId: ID, templateId: ID) => trainings.find((x) => x.employeeId === empId && x.templateId === templateId && OPEN.includes(x.status));

  const scoped = trainings.filter((tr) => inScope(tr.employeeId));
  const completedNoEvidence = scoped.filter((tr) => tr.status === 'completed' && evidenceOf(ctx, tr).status !== 'accepted').length;
  const evidenceLink = (tr: { employeeId: ID; templateId: ID | null; id?: ID }) => `/documentacion?nuevo=1${tr.templateId ? `&requisito=${tr.templateId}` : ''}&empleado=${tr.employeeId}${tr.id ? `&formacion=${tr.id}` : ''}`;

  const kpi = (label: string, value: number, s: TrainingStatus | '', tone?: 'warning' | 'danger', meta?: string) => (
    <button type="button" className={`kpi ${tone ? `tone-${tone}` : ''} ${s && status === s ? 'ev-kpi-active' : ''}`} aria-pressed={!!s && status === s} onClick={() => setStatus(status === s ? '' : s)}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {meta && <span className="meta">{meta}</span>}
    </button>
  );

  return (
    <div className="stack-lg">
      <div className="kpis">
        {kpi(t('Sin fecha prevista'), scoped.filter((x) => x.status === 'assigned').length, 'assigned', undefined, t('Asignadas, pendientes de programar'))}
        {kpi(t('Programadas'), scoped.filter((x) => x.status === 'scheduled').length, 'scheduled')}
        {kpi(t('Asistencia sin finalización'), scoped.filter((x) => x.status === 'attended').length, 'attended', undefined, t('La asistencia no acredita la finalización'))}
        {kpi(t('Finalizadas sin evidencia aceptada'), completedNoEvidence, 'completed', completedNoEvidence ? 'warning' : undefined, t('La finalización no cumple el requisito'))}
      </div>

      <Card
        flush
        title={t('Asignaciones de formación')}
        actions={
          <>
            {ctx.can('reports.export') && <ExportButton reportId="training" filters={{ ...EMPTY_FILTERS, worksiteId, employeeId }} label={t('Exportar resumen')} />}
            {canManage && (
              <Button variant="primary" icon={Plus} onClick={() => setAssign({ employeeId: employeeId || undefined })}>
                {t('Asignar formación')}
              </Button>
            )}
          </>
        }
      >
        <div className="toolbar">
          <TextField className="search" label={t('Buscar')} type="search" placeholder={t('Persona o curso…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <SelectField label={t('Estado')} value={status} onChange={(e) => setStatus(e.target.value as TrainingStatus | '')}>
            <option value="">{t('Todos')}</option>
            {(Object.keys(TRAINING_STATUS) as TrainingStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(TRAINING_STATUS[s].label)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Curso')} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">{t('Todos')}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title}
              </option>
            ))}
          </SelectField>
          {employees.length > 1 && (
            <SelectField label={t('Empleado')} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </SelectField>
          )}
          {worksites.length > 1 && (
            <SelectField label={t('Centro')} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </SelectField>
          )}
          {(q || status || courseId || employeeId || worksiteId) && (
            <Button
              variant="ghost"
              onClick={() => {
                setQ('');
                setStatus('');
                setCourseId('');
                setEmployeeId('');
                setWorksiteId('');
              }}
            >
              {t('Limpiar filtros')}
            </Button>
          )}
        </div>
        {trainings.length === 0 ? (
          <EmptyState icon={GraduationCap} title={t('Sin formaciones asignadas en su ámbito')} action={canManage && <Button icon={Plus} onClick={() => setAssign({})}>{t('Asignar formación')}</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={GraduationCap} title={t('Ninguna formación coincide con los filtros')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label={t('Empleado')} col="employee" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Curso')} col="course" sort={sort} onSort={onSort} />
                    <th>{t('Requisito vinculado')}</th>
                    <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Fecha prevista')} col="scheduled" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Asistencia')} col="attendance" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Finalización')} col="completion" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Evidencia')} col="evidence" sort={sort} onSort={onSort} />
                    {(canManage || canUpload) && <th>{t('Acciones')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((tr, i) => {
                    const c = courseOf(tr.courseId);
                    const ev = evidenceOf(ctx, tr);
                    const open = OPEN.includes(tr.status);
                    const needsEvidence = tr.status !== 'cancelled' && (!ev.status || ev.status === 'rejected');
                    return (
                      <tr key={`${tr.id}-${i}`}>
                        <td>
                          <EmployeeLink id={tr.employeeId} />
                        </td>
                        <td className="ev-title-cell">
                          {c ? (
                            <>
                              <span className="tag">{c.code}</span> {c.title}
                            </>
                          ) : (
                            tr.courseId
                          )}
                          {tr.note && <span className="sub" style={{ display: 'block' }}>{tr.note}</span>}
                        </td>
                        <td className="small">{tr.templateId ? <RequirementRef templateId={tr.templateId} /> : <span className="muted">—</span>}</td>
                        <td>
                          <StatusBadge meta={TRAINING_STATUS[tr.status]} />
                        </td>
                        <td>
                          <DateOrDash date={tr.scheduledDate} hint={t('Sin fecha')} />
                        </td>
                        <td>
                          <DateOrDash date={tr.attendanceDate} hint={t('No registrada')} />
                        </td>
                        <td>
                          <DateOrDash date={tr.completionDate} hint={t('No registrada')} />
                          {tr.hours != null && tr.completionDate && <span className="sub" style={{ display: 'block' }}>{t('{n} h', { n: tr.hours })}</span>}
                        </td>
                        <td>
                          <EvidenceCell tr={tr} />
                        </td>
                        {(canManage || canUpload) && (
                          <td>
                            <div className="ev-row-actions">
                              {canManage && (tr.status === 'assigned' || tr.status === 'scheduled') && (
                                <>
                                  <Button size="sm" icon={CalendarPlus} onClick={() => setDialog({ kind: 'schedule', tr })}>
                                    {tr.scheduledDate ? t('Reprogramar') : t('Programar')}
                                  </Button>
                                  <Button size="sm" icon={UserCheck} onClick={() => setDialog({ kind: 'attendance', tr })}>
                                    {t('Asistencia')}
                                  </Button>
                                </>
                              )}
                              {canManage && tr.status === 'attended' && (
                                <Button size="sm" icon={CheckSquare} onClick={() => setDialog({ kind: 'completion', tr })}>
                                  {t('Finalización')}
                                </Button>
                              )}
                              {canUpload && needsEvidence && (
                                <Link className="btn sm" to={evidenceLink(tr)}>
                                  <Upload size={14} aria-hidden /> {t('Aportar evidencia')}
                                </Link>
                              )}
                              {canManage && open && (
                                <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setDialog({ kind: 'cancel', tr })} aria-label={t('Cancelar formación')}>
                                  {t('Cancelar')}
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>

      <Card flush title={t('Requisitos de formación sin evidencia aceptada')} actions={<span className="small muted">{t('{n} elementos', { n: missingFiltered.length })}</span>}>
        {missingFiltered.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t('No hay requisitos de formación pendientes en el ámbito filtrado')}>
            {t('Solo cuentan como cumplidos los requisitos con evidencia aceptada (o marcados como no aplicables con motivo).')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Empleado')}</th>
                    <th>{t('Requisito')}</th>
                    <th>{t('Situación del requisito')}</th>
                    <th>{t('Formación')}</th>
                    <th>{t('Acciones')}</th>
                  </tr>
                </thead>
                <tbody>
                  {missingPaged.rows.map((it) => {
                    const tr = openTrainingFor(it.employeeId, it.template.id);
                    const course = it.version.courseId ? courseOf(it.version.courseId) : undefined;
                    return (
                      <tr key={it.key}>
                        <td>
                          <EmployeeLink id={it.employeeId} />
                        </td>
                        <td className="small">
                          <RequirementRef templateId={it.template.id} />
                          {!it.counted && <Badge tone="neutral">{t('Opcional')}</Badge>}
                        </td>
                        <td>
                          <ItemStatusBadge status={it.status} />
                          <span className="sub" style={{ display: 'block' }}>{msg(it.reason)}</span>
                        </td>
                        <td className="small">{tr ? <StatusBadge meta={TRAINING_STATUS[tr.status]} /> : course ? <span className="muted">{t('Sin asignar ({code})', { code: course.code })}</span> : <span className="muted">{t('Sin curso vinculado')}</span>}</td>
                        <td>
                          <div className="ev-row-actions">
                            {ctx.can('evidence.request') &&
                              (it.evidence.requestId ? (
                                <Badge tone="warning">{t('Solicitud abierta')}</Badge>
                              ) : (
                                <Button size="sm" icon={Send} onClick={() => setRequestFor(it)}>
                                  {t('Solicitar evidencia')}
                                </Button>
                              ))}
                            {canManage && !tr && course && (
                              <Button size="sm" icon={Plus} onClick={() => setAssign({ employeeId: it.employeeId, courseId: course.id, templateId: it.template.id })}>
                                {t('Asignar')}
                              </Button>
                            )}
                            {canUpload && (
                              <Link className="btn sm" to={evidenceLink({ employeeId: it.employeeId, templateId: it.template.id, id: tr?.id })}>
                                <Upload size={14} aria-hidden /> {t('Aportar evidencia')}
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...missingPaged.props} />
          </>
        )}
      </Card>

      {dialog && dialog.kind !== 'cancel' && <TrainingDateModal training={dialog.tr} kind={dialog.kind} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'cancel' && (
        <ConfirmDialog
          title={t('Cancelar formación')}
          message={t('La formación quedará cancelada con el motivo indicado. El historial se conserva.')}
          confirmLabel={t('Cancelar formación')}
          danger
          requireReason
          onConfirm={(reason) => runOk(() => cancelTraining(dialog.tr.id, reason), t('Formación cancelada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {assign && <AssignModal initialEmployeeId={assign.employeeId} initialCourseId={assign.courseId} initialTemplateId={assign.templateId} onClose={() => setAssign(null)} />}
      {requestFor && <RequestEvidenceModal employeeId={requestFor.employeeId} templateId={requestFor.template.id} worksiteId={requestFor.worksiteId} onClose={() => setRequestFor(null)} />}
    </div>
  );
}

// ─────────────────────────────── Mi formación ───────────────────────────────

function MyTrainingTab() {
  const ctx = useCtx();
  const me = ctx.employee!;
  const mine = visibleTrainings(ctx)
    .filter((x) => x.employeeId === me.id)
    .sort((a, b) => (b.scheduledDate ?? b.assignedAt).localeCompare(a.scheduledDate ?? a.assignedAt));
  const items = itemsFor(ctx, me.id).filter((it) => it.version.evidenceMode === 'training');
  const canSubmit = ctx.can('own.submit');
  return (
    <div className="stack-lg">
      <Card flush title={t('Mis requisitos de formación')}>
        {items.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t('No tiene requisitos de formación configurados')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Requisito')}</th>
                  <th>{t('Situación del requisito')}</th>
                  <th>{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.key}>
                    <td className="small">
                      <RequirementRef templateId={it.template.id} />
                    </td>
                    <td>
                      <ItemStatusBadge status={it.status} />
                      <span className="sub" style={{ display: 'block' }}>{msg(it.reason)}</span>
                    </td>
                    <td>
                      {it.evidence.documentId ? (
                        <Link to={`/documentacion/${it.evidence.documentId}`}>{t('Ver evidencia')}</Link>
                      ) : canSubmit && !it.satisfied ? (
                        <Link className="btn sm" to={`/documentacion?nuevo=1&requisito=${it.template.id}&empleado=${me.id}`}>
                          <Upload size={14} aria-hidden /> {t('Aportar certificado')}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card flush title={t('Mis formaciones')}>
        {mine.length === 0 ? (
          <EmptyState icon={GraduationCap} title={t('No tiene formaciones asignadas')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Curso')}</th>
                  <th>{t('Estado')}</th>
                  <th>{t('Fecha prevista')}</th>
                  <th>{t('Asistencia')}</th>
                  <th>{t('Finalización')}</th>
                  <th>{t('Evidencia')}</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((tr, i) => {
                  const c = ctx.db.courses.find((x) => x.id === tr.courseId);
                  return (
                    <tr key={`${tr.id}-${i}`}>
                      <td className="ev-title-cell">
                        {c ? c.title : tr.courseId}
                        {c && <span className="sub" style={{ display: 'block' }}>{c.providerName} · {t(MODALITY[c.modality])}</span>}
                      </td>
                      <td>
                        <StatusBadge meta={TRAINING_STATUS[tr.status]} />
                      </td>
                      <td>
                        <DateOrDash date={tr.scheduledDate} hint={t('Sin fecha')} />
                      </td>
                      <td>
                        <DateOrDash date={tr.attendanceDate} hint={t('No registrada')} />
                      </td>
                      <td>
                        <DateOrDash date={tr.completionDate} hint={t('No registrada')} />
                      </td>
                      <td>
                        <EvidenceCell tr={tr} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">{t('Confirmar que ha recibido una ficha de información o unas instrucciones no equivale a haber recibido formación.')}</p>
    </div>
  );
}
