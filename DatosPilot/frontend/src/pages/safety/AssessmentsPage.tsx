/**
 * Evaluaciones de riesgos: register of the assessments produced by the assessor / prevention
 * service, with versions, review workflow and established review dates. A record-management
 * tool: no risk scores, and an accepted assessment does not mean that a workplace is safe.
 */
import { FilePlus2, Search, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KindDate } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { Button, Callout, Card, Checkbox, DateText, EmptyState, PageHeader, Pagination, SelectField, SortHeader, StatusBadge, TextField, sortRows, usePaged, useSort } from '../../components/ui';
import { ASSESSMENT_STATUS } from '../../domain/status';
import type { AssessmentStatus, RiskAssessment } from '../../domain/types';
import { t } from '../../i18n';
import { roleName, visibleWorksiteIds, worksiteName } from '../../services/context';
import { EMPTY_FILTERS } from '../../services/reportService';
import { visibleActions, visibleAssessments } from '../../services/safetyService';
import { useCtx } from '../../store/hooks';
import { AssessmentFormDialog } from './AssessmentForm';
import { KpiButton, NameList } from './shared';

type StatusFilter = '' | AssessmentStatus | 'in_review' | 'review_overdue';

export function AssessmentDisclaimer() {
  return (
    <Callout tone="warning" icon={TriangleAlert} title={t('Gestión documental, no evaluación de riesgos')}>
      {t('DatosPilot guarda y sigue las evaluaciones elaboradas por personal competente o por el servicio de prevención. No evalúa riesgos ni calcula puntuaciones, y una evaluación aceptada no significa que el centro sea seguro. Las evaluaciones especializadas (obras de construcción, espacios confinados, procesos peligrosos) quedan fuera del alcance de la aplicación.')}
    </Callout>
  );
}

export function AssessmentsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canRegister = ctx.can('risk.register');
  const rep = !canRegister && ctx.can('representative.view') && !ctx.can('risk.review');
  const all = useMemo(() => visibleAssessments(ctx), [ctx]);
  const actions = useMemo(() => visibleActions(ctx), [ctx]);
  const [q, setQ] = useState('');
  const [ws, setWs] = useState(params.get('centro') ?? '');
  const [status, setStatus] = useState<StatusFilter>((params.get('estado') as StatusFilter) ?? '');
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [creating, setCreating] = useState(params.get('nuevo') === '1' && canRegister);
  const { sort, onSort } = useSort('code', 'asc');

  const linkedCount = (a: RiskAssessment) => actions.filter((x) => x.source.refId === a.id).length;
  const match = (a: RiskAssessment, s: StatusFilter) => {
    if (!s) return true;
    if (s === 'in_review') return a.status === 'submitted' || a.status === 'under_review';
    if (s === 'review_overdue') return a.status === 'accepted' && !!a.reviewDate && a.reviewDate < ctx.today;
    return a.status === s;
  };
  const counts = {
    accepted: all.filter((a) => a.status === 'accepted').length,
    in_review: all.filter((a) => match(a, 'in_review')).length,
    review_required: all.filter((a) => a.status === 'review_required').length,
    draft: all.filter((a) => a.status === 'draft').length,
    review_overdue: all.filter((a) => match(a, 'review_overdue')).length,
  };
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = all.filter(
      (a) =>
        (showSuperseded || status === 'superseded' || a.status !== 'superseded') &&
        (!ws || a.worksiteId === ws) &&
        match(a, status) &&
        (!s || `${a.code} ${a.title} ${a.activity} ${a.assessorName}`.toLowerCase().includes(s)),
    );
    return sortRows(list, sort, (a, col) => (col === 'title' ? a.title : col === 'issue' ? a.issueDate : col === 'review' ? a.reviewDate : col === 'status' ? a.status : `${a.code}-${String(a.version).padStart(3, '0')}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, ws, status, showSuperseded, sort]);
  const paged = usePaged(rows);
  const toggle = (s: StatusFilter) => setStatus((cur) => (cur === s ? '' : s));
  const filtered = !!(q || ws || status);
  const canExport = ctx.can('reports.export') || ctx.can('representative.view');
  const closeCreate = () => {
    setCreating(false);
    if (params.get('nuevo')) {
      const p = new URLSearchParams(params);
      p.delete('nuevo');
      setParams(p, { replace: true });
    }
  };

  return (
    <>
      <PageHeader
        title={t('Evaluaciones de riesgos')}
        subtitle={t('Registro de versiones, revisión por el servicio de prevención y fechas de revisión establecidas por el evaluador.')}
        actions={
          canRegister && (
            <Button variant="primary" icon={FilePlus2} onClick={() => setCreating(true)}>
              {t('Registrar evaluación')}
            </Button>
          )
        }
      />
      <div className="stack">
        <AssessmentDisclaimer />
        {rep && <Callout tone="neutral">{t('Vista de la representación de los trabajadores: se muestran en modo de consulta las evaluaciones aceptadas, las marcadas para revisión y las sustituidas.')}</Callout>}
        <div className="kpis">
          <KpiButton label={t('Aceptadas')} value={counts.accepted} pressed={status === 'accepted'} onClick={() => toggle('accepted')} />
          {!rep && <KpiButton label={t('En revisión del servicio de prevención')} value={counts.in_review} pressed={status === 'in_review'} onClick={() => toggle('in_review')} />}
          <KpiButton label={t(ASSESSMENT_STATUS.review_required.label)} value={counts.review_required} tone={counts.review_required ? 'warning' : undefined} pressed={status === 'review_required'} onClick={() => toggle('review_required')} />
          {!rep && <KpiButton label={t('Borradores')} value={counts.draft} pressed={status === 'draft'} onClick={() => toggle('draft')} />}
          <KpiButton label={t('Fecha de revisión fijada ya pasada')} value={counts.review_overdue} meta={t('Solo cuando el evaluador fijó una fecha')} tone={counts.review_overdue ? 'warning' : undefined} pressed={status === 'review_overdue'} onClick={() => toggle('review_overdue')} />
        </div>
        <Card flush>
          <div className="toolbar sf-toolbar">
            <TextField className="search" label={t('Buscar')} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Código, título, actividad o evaluador')} />
            <SelectField label={t('Centro')} value={ws} onChange={(e) => setWs(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {[...visibleWorksiteIds(ctx)].map((id) => (
                <option key={id} value={id}>
                  {worksiteName(ctx.db, id)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('Estado')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="">{t('Todos')}</option>
              {(Object.keys(ASSESSMENT_STATUS) as AssessmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {t(ASSESSMENT_STATUS[s].label)}
                </option>
              ))}
              {!rep && <option value="in_review">{t('En revisión del servicio de prevención')}</option>}
              <option value="review_overdue">{t('Fecha de revisión fijada ya pasada')}</option>
            </SelectField>
            <div className="sf-toolbar-check">
              <Checkbox label={t('Incluir versiones sustituidas')} checked={showSuperseded} onChange={setShowSuperseded} />
            </div>
            {filtered && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQ('');
                  setWs('');
                  setStatus('');
                }}
              >
                {t('Limpiar filtros')}
              </Button>
            )}
            <div className="grow" />
            {canExport && <ExportButton reportId="assessments" filters={{ ...EMPTY_FILTERS, worksiteId: ws }} />}
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={all.length ? Search : TriangleAlert} title={all.length ? t('Ninguna evaluación coincide con los filtros') : t('Sin evaluaciones registradas')}>
              {all.length ? t('Cambie o limpie los filtros.') : canRegister ? t('Registre la evaluación que le haya entregado el servicio de prevención.') : t('No hay evaluaciones visibles en su ámbito.')}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader label={t('Código')} col="code" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Título')} col="title" sort={sort} onSort={onSort} />
                      <th>{t('Centro o actividad')}</th>
                      <th>{t('Puestos')}</th>
                      <th>{t('Evaluador/a')}</th>
                      <SortHeader label={t('Emisión / efecto')} col="issue" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Revisión fijada')} col="review" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Estado')} col="status" sort={sort} onSort={onSort} />
                      <th className="num">{t('Acciones vinculadas')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((a) => {
                      const provider = a.providerId ? ctx.db.providers.find((p) => p.id === a.providerId)?.name : null;
                      const n = linkedCount(a);
                      return (
                        <tr key={a.id} className="clickable" onClick={() => navigate(`/evaluaciones/${a.id}`)}>
                          <td className="nowrap">
                            <Link to={`/evaluaciones/${a.id}`} onClick={(e) => e.stopPropagation()}>
                              {a.code}
                            </Link>
                            <div className="sub">{t('Versión {n}', { n: a.version })}</div>
                          </td>
                          <td style={{ minWidth: 220 }}>{a.title}</td>
                          <td className="small" style={{ minWidth: 160 }}>
                            {a.worksiteId ? worksiteName(ctx.db, a.worksiteId) : <span className="muted">{t('Por puestos')}</span>}
                            <div className="sub">{a.activity}</div>
                          </td>
                          <td className="small" style={{ minWidth: 140 }}>
                            <NameList names={a.jobRoleIds.map((r) => roleName(ctx.db, r))} />
                          </td>
                          <td className="small" style={{ minWidth: 160 }}>
                            {a.assessorName}
                            {provider && <div className="sub">{provider}</div>}
                          </td>
                          <td className="small">
                            {a.issueDate ? <DateText date={a.issueDate} /> : <span className="muted">{t('Sin fecha')}</span>}
                            {a.effectiveDate && (
                              <div className="sub">
                                {t('Efecto [fecha]')}: <DateText date={a.effectiveDate} />
                              </div>
                            )}
                          </td>
                          <td className="small">
                            <KindDate kind="assessment" date={a.reviewDate} today={a.status === 'accepted' ? ctx.today : undefined} />
                          </td>
                          <td>
                            <StatusBadge meta={ASSESSMENT_STATUS[a.status]} />
                          </td>
                          <td className="num">{n || <span className="muted">0</span>}</td>
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
        <p className="tiny muted">{t('Las fechas de revisión solo aparecen si el evaluador las fijó; si no, se indica «No establecida». La evaluación debe revisarse además cuando cambien las condiciones de trabajo o se detecten daños a la salud (RD 39/1997, arts. 4 y 6).')}</p>
      </div>
      {creating && <AssessmentFormDialog mode="create" onClose={closeCreate} onSaved={(a) => navigate(`/evaluaciones/${a.id}`)} />}
    </>
  );
}
