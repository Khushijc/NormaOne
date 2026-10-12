/**
 * Detail of one risk assessment record: data, hazards and measures as transcribed from the
 * assessor's document (no scores), linked requirements and preventive actions, versions and the
 * review workflow. Accepting records the assessment as current; it never declares a site safe.
 */
import { CheckCircle2, ClipboardList, CornerUpLeft, FileText, Flag, GitBranch, Pencil, PlayCircle, Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { DocStatusBadge, KindDate, WorksiteLink } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, Modal, PageHeader, SelectField, StatusBadge, TextAreaField, useAction } from '../../components/ui';
import { latestVersion } from '../../domain/requirements';
import { ACTION_STATUS, ASSESSMENT_STATUS } from '../../domain/status';
import { formatInstant } from '../../domain/time';
import type { RiskAssessment } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { canSeeDocument, roleName, userName } from '../../services/context';
import { documentState } from '../../services/evidenceService';
import { markAssessmentForReview, reviewAssessment, submitAssessment, visibleActions, visibleAssessments } from '../../services/safetyService';
import { useCtx } from '../../store/hooks';
import { AssessmentFormDialog, type AssessmentFormMode } from './AssessmentForm';
import { AssessmentDisclaimer } from './AssessmentsPage';
import { isOverdue, NameList } from './shared';

type Decision = 'accept' | 'return' | 'keep';

/** Causes that require reviewing an assessment (RD 39/1997, arts. 4 and 6). Stored in Spanish. */
const REVIEW_CAUSES = [
  tKey('Cambio en las condiciones de trabajo'),
  tKey('Nuevos equipos, sustancias o tecnologías'),
  tKey('Daños a la salud detectados'),
  tKey('Actividades preventivas o controles periódicos inadecuados'),
  tKey('Acuerdo con la representación de los trabajadores'),
  tKey('Otra causa'),
];

export function AssessmentDetailPage() {
  const { id = '' } = useParams();
  const ctx = useCtx();
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const [form, setForm] = useState<AssessmentFormMode | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [marking, setMarking] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const visible = visibleAssessments(ctx);
  const a = visible.find((x) => x.id === id);
  if (!a) {
    return (
      <>
        <PageHeader title={t('Evaluación de riesgos')} breadcrumbs={<Link to="/evaluaciones">{t('Evaluaciones de riesgos')}</Link>} />
        <RecordNotFound back="/evaluaciones" label={tKey('Evaluaciones de riesgos')} />
      </>
    );
  }

  const canRegister = ctx.can('risk.register');
  const canReview = ctx.can('risk.review');
  const versions = visible.filter((x) => x.code === a.code).sort((x, y) => y.version - x.version);
  const newer = visible.find((x) => x.supersedesId === a.id);
  const previous = a.supersedesId ? visible.find((x) => x.id === a.supersedesId) : undefined;
  const newerInProgress = !!newer && newer.status !== 'superseded' && newer.status !== 'accepted';
  const provider = a.providerId ? ctx.db.providers.find((p) => p.id === a.providerId) : undefined;
  const doc = a.documentId ? ctx.db.documents.find((d) => d.id === a.documentId) : undefined;
  const docVisible = !!doc && canSeeDocument(ctx, doc);
  const docLatest = doc && docVisible ? documentState(ctx, doc.id).latest : null;
  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const actions = visibleActions(ctx).filter((x) => x.source.refId === a.id || (!!a.worksiteId && x.worksiteId === a.worksiteId));
  const canCreateAction = ctx.can('actions.manage') && a.status !== 'superseded';
  const newActionUrl = `/acciones?nueva=1&origen=risk_assessment&ref=${a.id}${a.worksiteId ? `&centro=${a.worksiteId}` : ''}`;

  const doStart = () => run(() => reviewAssessment(a.id, 'start', ''), t('Revisión iniciada'));

  return (
    <>
      <PageHeader
        breadcrumbs={<Link to="/evaluaciones">{t('Evaluaciones de riesgos')}</Link>}
        title={a.title}
        subtitle={
          <span className="row-wrap">
            <span className="strong">
              {a.code} · {t('Versión {n}', { n: a.version })}
            </span>
            <StatusBadge meta={ASSESSMENT_STATUS[a.status]} />
          </span>
        }
      />
      <div className="stack">
        <AssessmentDisclaimer />
        {a.status === 'review_required' && (
          <Callout tone="warning" title={t('Marcada para revisión')}>
            {a.reviewNote ? t(a.reviewNote) : t('Sin motivo registrado.')}
            <div className="small muted">{t('Sigue siendo el registro vigente hasta que se acepte una nueva versión o se confirme sin cambios.')}</div>
          </Callout>
        )}
        {a.status === 'draft' && a.reviewNote && a.reviewedBy && (
          <Callout tone="info" title={t('Devuelta a borrador por {name}', { name: userName(ctx.db, a.reviewedBy) })}>
            {t(a.reviewNote)}
          </Callout>
        )}
        {a.status === 'superseded' && (
          <Callout tone="neutral" title={t('Versión sustituida (se conserva como historial)')}>
            {newer ? (
              <Link to={`/evaluaciones/${newer.id}`}>{t('Ver la versión {n}', { n: newer.version })}</Link>
            ) : (
              t('Existe una versión posterior.')
            )}
          </Callout>
        )}
        {a.status === 'accepted' && (
          <Callout tone="success" title={t('Aceptada como registro vigente')}>
            {t('Aceptada por {name} el {date}. Esto no declara que el centro sea seguro ni sustituye el criterio del evaluador.', { name: userName(ctx.db, a.reviewedBy), date: formatInstant(a.reviewedAt) })}
          </Callout>
        )}

        <div className="grid-main-side">
          <div className="stack">
            <Card title={t('Datos de la evaluación')}>
              <div className="sf-kv">
                <KV
                  items={[
                    [t('Código y versión'), `${a.code} · v${a.version}`],
                    [t('Estado'), <StatusBadge meta={ASSESSMENT_STATUS[a.status]} />],
                    [t('Centro de trabajo'), a.worksiteId ? <WorksiteLink id={a.worksiteId} /> : <span className="muted">{t('Sin centro (evaluación por puestos)')}</span>],
                    [t('Actividad evaluada'), a.activity],
                    [t('Puestos evaluados'), <NameList names={a.jobRoleIds.map((r) => roleName(ctx.db, r))} />],
                    [t('Servicio de prevención o entidad'), provider?.name ?? <span className="muted">{t('Personal propio / sin entidad')}</span>],
                    [t('Evaluador/a'), a.assessorName],
                    [t('Responsable interno'), userName(ctx.db, a.ownerUserId)],
                    [t('Fecha de emisión'), a.issueDate ? <DateText date={a.issueDate} /> : <span className="muted">{t('Sin fecha')}</span>],
                    [t('Fecha de efecto'), a.effectiveDate ? <DateText date={a.effectiveDate} /> : <span className="muted">{t('Se fijará al aceptarla')}</span>],
                    [t('Fecha de revisión fijada por el evaluador'), <KindDate kind="assessment" date={a.reviewDate} today={a.status === 'accepted' ? ctx.today : undefined} />],
                    [
                      t('Documento de la evaluación'),
                      !doc ? (
                        <span className="muted">{t('Sin documento vinculado')}</span>
                      ) : docVisible ? (
                        <span className="row-wrap">
                          <Link to={`/documentacion/${doc.id}`}>
                            <FileText size={13} aria-hidden style={{ verticalAlign: -2 }} /> {doc.code} · {doc.title}
                          </Link>
                          {docLatest && <DocStatusBadge status={docLatest.status} />}
                        </span>
                      ) : (
                        <span className="muted">{t('Documento no visible para su rol')}</span>
                      ),
                    ],
                    [t('Fecha de registro'), <span>{userName(ctx.db, a.createdBy)} · <DateTimeText at={a.createdAt} /></span>],
                    [t('Última decisión de revisión'), a.reviewedAt ? <span>{userName(ctx.db, a.reviewedBy)} · <DateTimeText at={a.reviewedAt} /></span> : <span className="muted">—</span>],
                  ]}
                />
              </div>
            </Card>

            <Card title={t('Peligros identificados y medidas')} flush>
              {a.hazards.length === 0 ? (
                <EmptyState title={t('Sin peligros transcritos')}>{t('Consulte el documento de la evaluación.')}</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>{t('Riesgo asociado')}</th>
                        <th>{t('Descripción del peligro')}</th>
                        <th>{t('Medidas indicadas')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.hazards.map((h, i) => {
                        const tag = tags.find((r) => r.id === h.riskTag);
                        return (
                          <tr key={h.id || i}>
                            <td className="num">{i + 1}</td>
                            <td className="small" style={{ minWidth: 150 }}>
                              {tag ? tag.label : <span className="muted">{t('Sin etiqueta')}</span>}
                              {tag?.specialist && (
                                <div>
                                  <Badge tone="danger">{t('Alcance especializado')}</Badge>
                                </div>
                              )}
                            </td>
                            <td style={{ minWidth: 200 }}>{h.description}</td>
                            <td style={{ minWidth: 200 }}>{h.measures || <span className="muted">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="card-footer tiny muted">{t('Sin niveles ni puntuaciones: la valoración del riesgo consta en el documento del evaluador.')}</div>
            </Card>

            <Card title={t('Medidas preventivas y planificación')}>
              {a.preventiveMeasures ? <p className="sf-pre">{a.preventiveMeasures}</p> : <p className="muted small">{t('No se han transcrito medidas. Consulte el documento de la evaluación.')}</p>}
            </Card>
          </div>

          <div className="stack">
            <Card title={t('Flujo de revisión')}>
              <div className="stack-sm">
                <p className="small muted">{t(ASSESSMENT_STATUS[a.status].help)}</p>
                {a.status === 'draft' && canRegister && (
                  <>
                    <Button icon={Pencil} onClick={() => setForm('edit')}>
                      {t('Editar borrador')}
                    </Button>
                    <Button variant="primary" icon={Send} disabled={!a.documentId} onClick={() => setConfirmSubmit(true)}>
                      {t('Enviar a revisión')}
                    </Button>
                    {!a.documentId && <p className="tiny muted">{t('Vincule el documento de la evaluación antes de enviarla.')}</p>}
                  </>
                )}
                {(a.status === 'submitted' || a.status === 'under_review') &&
                  (canReview ? (
                    <>
                      {a.status === 'submitted' && (
                        <Button icon={PlayCircle} loading={pending} onClick={doStart}>
                          {t('Iniciar revisión')}
                        </Button>
                      )}
                      <Button variant="primary" icon={CheckCircle2} onClick={() => setDecision('accept')}>
                        {t('Aceptar como vigente')}
                      </Button>
                      <Button icon={CornerUpLeft} onClick={() => setDecision('return')}>
                        {t('Devolver a borrador')}
                      </Button>
                    </>
                  ) : (
                    <p className="small">{t('Pendiente de la revisión del servicio de prevención (técnico).')}</p>
                  ))}
                {a.status === 'accepted' && (canRegister || canReview) && (
                  <Button icon={Flag} onClick={() => setMarking(true)}>
                    {t('Marcar para revisión')}
                  </Button>
                )}
                {a.status === 'review_required' && canReview && (
                  <Button icon={CheckCircle2} onClick={() => setDecision('keep')}>
                    {t('Confirmar vigente tras revisarla')}
                  </Button>
                )}
                {(a.status === 'accepted' || a.status === 'review_required') && canRegister && !newerInProgress && (
                  <Button variant={a.status === 'review_required' ? 'primary' : 'secondary'} icon={GitBranch} onClick={() => setForm('version')}>
                    {t('Registrar nueva versión')}
                  </Button>
                )}
                {newerInProgress && newer && (
                  <Callout tone="info">
                    <Link to={`/evaluaciones/${newer.id}`}>{t('Versión {n} en curso ({status})', { n: newer.version, status: t(ASSESSMENT_STATUS[newer.status].label) })}</Link>
                  </Callout>
                )}
                {a.status === 'superseded' && <p className="small muted">{t('Las versiones sustituidas no admiten cambios.')}</p>}
                {!canRegister && !canReview && <p className="small muted">{t('Consulta en modo de solo lectura.')}</p>}
              </div>
            </Card>

            <Card title={t('Requisitos vinculados')}>
              {a.linkedTemplateIds.length === 0 ? (
                <p className="small muted">{t('Ningún requisito vinculado.')}</p>
              ) : (
                <ul className="sf-plain-list">
                  {a.linkedTemplateIds.map((tid) => {
                    const tpl = ctx.db.templates.find((x) => x.id === tid);
                    const name = latestVersion(ctx.db, tid)?.name ?? '';
                    const label = `${tpl?.code ?? tid}${name ? ` · ${name}` : ''}`;
                    return <li key={tid}>{ctx.can('requirements.view') ? <Link to={`/requisitos/${tid}`}>{label}</Link> : label}</li>;
                  })}
                </ul>
              )}
            </Card>

            <Card title={t('Versiones')}>
              <ol className="sf-plain-list">
                {versions.map((v) => (
                  <li key={v.id} className="row-wrap">
                    {v.id === a.id ? <span className="strong">{t('Versión {n}', { n: v.version })}</span> : <Link to={`/evaluaciones/${v.id}`}>{t('Versión {n}', { n: v.version })}</Link>}
                    <StatusBadge meta={ASSESSMENT_STATUS[v.status]} />
                    {v.issueDate && (
                      <span className="tiny muted">
                        <DateText date={v.issueDate} />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {previous && previous.status !== 'superseded' && <p className="tiny muted">{t('Al aceptar esta versión, la versión {n} quedará sustituida y se conservará.', { n: previous.version })}</p>}
            </Card>
          </div>
        </div>

        <Card
          title={t('Acciones preventivas vinculadas')}
          flush
          actions={
            canCreateAction && (
              <Button size="sm" icon={Plus} onClick={() => navigate(newActionUrl)}>
                {t('Crear acción preventiva')}
              </Button>
            )
          }
        >
          {actions.length === 0 ? (
            <EmptyState icon={ClipboardList} title={t('Sin acciones vinculadas')}>
              {t('Las acciones creadas desde esta evaluación o para el mismo centro aparecerán aquí.')}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Código')}</th>
                    <th>{t('Título')}</th>
                    <th>{t('Relación con la evaluación')}</th>
                    <th>{t('Responsable')}</th>
                    <th>{t('Fecha objetivo')}</th>
                    <th>{t('Estado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((x) => (
                    <tr key={x.id}>
                      <td className="nowrap">
                        <Link to={`/acciones/${x.id}`}>{x.code}</Link>
                      </td>
                      <td style={{ minWidth: 220 }}>{x.title}</td>
                      <td className="small">{x.source.refId === a.id ? t('Origen: esta evaluación') : t('Mismo centro de trabajo')}</td>
                      <td className="small">{x.ownerUserId ? userName(ctx.db, x.ownerUserId) : <span className="muted">{t('Sin asignar')}</span>}</td>
                      <td className="small">
                        <KindDate kind="target" date={x.targetDate} today={x.status !== 'resolved' ? ctx.today : undefined} />
                        {isOverdue(x, ctx.today) && (
                          <div>
                            <Badge tone="danger">{t('Vencida [fecha objetivo]')}</Badge>
                          </div>
                        )}
                      </td>
                      <td>
                        <StatusBadge meta={ACTION_STATUS[x.status]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('Historial de revisión')}>
          <AuditList filter={(e) => e.entityId === a.id} />
        </Card>
      </div>

      {form && <AssessmentFormDialog mode={form} base={a} onClose={() => setForm(null)} onSaved={(r) => r.id !== a.id && navigate(`/evaluaciones/${r.id}`)} />}
      {confirmSubmit && (
        <ConfirmDialog
          title={t('Enviar la evaluación a revisión')}
          confirmLabel={t('Enviar a revisión')}
          message={t('Se notificará al servicio de prevención (técnico) para que la revise. Mientras tanto no se puede editar.')}
          onConfirm={() => run(() => submitAssessment(a.id), t('Evaluación enviada a revisión')).then((r) => !!r)}
          onClose={() => setConfirmSubmit(false)}
        />
      )}
      {decision && <DecisionDialog assessment={a} decision={decision} previous={previous} onClose={() => setDecision(null)} />}
      {marking && <MarkForReviewDialog assessment={a} onClose={() => setMarking(false)} />}
    </>
  );
}

function DecisionDialog({ assessment: a, decision, previous, onClose }: { assessment: RiskAssessment; decision: Decision; previous?: RiskAssessment; onClose: () => void }) {
  const { run, pending } = useAction();
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const accept = decision !== 'return';
  const submit = async () => {
    setTouched(true);
    if (!note.trim()) return;
    const r = await run(() => reviewAssessment(a.id, accept ? 'accept' : 'return', note), decision === 'return' ? t('Evaluación devuelta a borrador') : decision === 'keep' ? t('Evaluación confirmada como vigente tras la revisión') : t('Evaluación aceptada como registro vigente'));
    if (r) onClose();
  };
  const title = decision === 'return' ? t('Devolver a borrador') : decision === 'keep' ? t('Confirmar vigente tras revisarla') : t('Aceptar como registro vigente');
  return (
    <Modal
      title={title}
      description={`${a.code} · v${a.version}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant={accept ? 'primary' : 'danger'} loading={pending} onClick={submit}>
            {title}
          </Button>
        </>
      }
    >
      <div className="stack">
        {accept ? (
          <Callout tone="warning">
            {t('Aceptar registra la evaluación como vigente. No declara que el centro sea seguro ni que se cumpla la normativa, y no sustituye el criterio profesional del evaluador.')}
            {decision === 'accept' && previous && previous.status !== 'superseded' && <div className="small">{t('La versión {n} quedará sustituida y se conservará.', { n: previous.version })}</div>}
          </Callout>
        ) : (
          <Callout tone="info">{t('La evaluación vuelve a borrador para que se corrija y se envíe de nuevo. La nota queda en el historial.')}</Callout>
        )}
        <TextAreaField label={t('Nota de revisión (queda registrada)')} required rows={4} value={note} onChange={(e) => setNote(e.target.value)} error={touched && !note.trim() ? t('Obligatorio.') : undefined} />
      </div>
    </Modal>
  );
}

function MarkForReviewDialog({ assessment: a, onClose }: { assessment: RiskAssessment; onClose: () => void }) {
  const { run, pending } = useAction();
  const [cause, setCause] = useState<string>(REVIEW_CAUSES[0]);
  const [detail, setDetail] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = async () => {
    setTouched(true);
    if (!detail.trim()) return;
    // Stored in the language of the record (Spanish); translated on display.
    const r = await run(() => markAssessmentForReview(a.id, `${cause}: ${detail.trim()}`), t('Evaluación marcada para revisión'));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Marcar para revisión')}
      description={`${a.code} · v${a.version}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Marcar para revisión')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="info">{t('La evaluación debe revisarse cuando cambien las condiciones de trabajo, se introduzcan nuevos equipos o sustancias, se detecten daños a la salud o los controles periódicos indiquen que las actividades preventivas son inadecuadas (RD 39/1997, arts. 4 y 6). Se notificará al servicio de prevención y a la coordinación de PRL.')}</Callout>
        <SelectField label={t('Causa')} required value={cause} onChange={(e) => setCause(e.target.value)}>
          {REVIEW_CAUSES.map((c) => (
            <option key={c} value={c}>
              {t(c)}
            </option>
          ))}
        </SelectField>
        <TextAreaField label={t('Descripción del cambio o del hecho')} required rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} error={touched && !detail.trim() ? t('Obligatorio.') : undefined} hint={t('No incluya datos de salud de personas concretas.')} />
      </div>
    </Modal>
  );
}
