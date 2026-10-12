/**
 * Documentación › detalle (`/documentacion/:id`): metadata, full version history (rejected and
 * superseded versions stay visible), review decision by the configured authority only, date
 * corrections, replacement versions, evidence requests, demo download, acknowledgements of
 * general information and the record's audit trail.
 */
import { CheckCircle2, ClipboardCheck, Download, FilePlus2, FileSignature, History, PlayCircle, Send, ShieldAlert, Users, XCircle, CalendarClock } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { AccessBadge, DocStatusBadge, EmployeeLink, KindDate, WorksiteLink } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, DateText, DateTimeText, EmptyState, KV, PageHeader, StatusBadge, useAction } from '../../components/ui';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { versionOn } from '../../domain/requirements';
import { ACCESS_CLASS, DOC_STATUS } from '../../domain/status';
import type { DocumentVersion } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { acknowledgeDocument, authorityOf, canDecide, documentState, startReview } from '../../services/evidenceService';
import { canSeeDocument, canSeeEmployee, itemsFor, userName, visibleEmployeeIds } from '../../services/context';
import { useCtx } from '../../store/hooks';
import { DatesModal, DecisionModal, PaperAckModal } from './DocumentModals';
import { DemoFileLabel, LegalExpiry, RequestEvidenceModal, RequirementRef, useDownload } from './evidenceShared';
import { SubmitDocumentModal } from './SubmitDocumentModal';

const ACK_CATEGORIES = ['info_riesgos', 'instruccion_centro'];

type Dialog = { kind: 'decide'; decision: 'accept' | 'reject'; v: DocumentVersion } | { kind: 'dates'; v: DocumentVersion } | { kind: 'paper'; v: DocumentVersion } | { kind: 'new' } | { kind: 'request' } | null;

export function DocumentDetailPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const { download, pending: downloading } = useDownload();
  const [dialog, setDialog] = useState<Dialog>(null);

  const doc = ctx.db.documents.find((d) => d.id === id && d.companyId === ctx.company.id);
  const visible = !!doc && canSeeDocument(ctx, doc);
  const restricted = !!doc && (doc.accessClass === 'health' || doc.accessClass === 'quarantined');
  const state = useMemo(() => (doc && visible && !restricted ? documentState(ctx, doc.id) : null), [ctx, doc, visible, restricted]);

  const acks = useMemo(() => (doc ? ctx.db.acknowledgements.filter((a) => a.subject.kind === 'document' && a.subject.id === doc.id && a.companyId === ctx.company.id) : []), [ctx, doc]);
  const canSeeAcks = ctx.can('evidence.view_all') || ctx.can('evidence.upload') || ctx.can('team.view');
  const pendingAck = useMemo(() => {
    if (!doc || !canSeeAcks || doc.employeeId) return [];
    const out: { employeeId: string; worksiteId: string | null }[] = [];
    for (const empId of visibleEmployeeIds(ctx)) {
      for (const it of itemsFor(ctx, empId)) if (it.version.instructionDocumentId === doc.id && it.status === 'pending_ack') out.push({ employeeId: empId, worksiteId: it.worksiteId });
    }
    return out;
  }, [ctx, doc, canSeeAcks]);

  if (!doc || !visible) return <RecordNotFound back="/documentacion" label={tKey('Documentación')} />;
  if (restricted || !state) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title={t('Documento restringido')} action={<Link className="btn" to="/salud?tab=cuarentena">{t('Ir al área de salud')}</Link>}>
          {t('Este documento tiene posible contenido clínico o de salud: no forma parte del expediente ordinario y se gestiona solo en el área restringida.')}
        </EmptyState>
      </Card>
    );
  }

  const { versions, accepted, pending: pendingVersion, latest } = state;
  const authority = authorityOf(ctx, doc);
  const authorityLabel = t(AUTHORITY_LABEL[authority]);
  const decidable = !!pendingVersion && canDecide(ctx, doc, pendingVersion);
  const isOwn = !!ctx.employee && doc.employeeId === ctx.employee.id;
  const canSubmitNew = (isOwn && ctx.can('own.submit')) || ctx.can('evidence.upload');
  const canRequest = ctx.can('evidence.request') && !!doc.employeeId && !!doc.templateId && canSeeEmployee(ctx, doc.employeeId);
  const canDates = canDecide(ctx, doc) || ctx.can('evidence.request');
  const category = ctx.db.categories.find((c) => c.id === doc.categoryId && c.companyId === ctx.company.id);
  const reqVersionNow = doc.templateId ? versionOn(ctx.db, doc.templateId, ctx.today) : undefined;
  const ackable = !doc.employeeId && ACK_CATEGORIES.includes(doc.categoryId);
  const ownAck = accepted && ctx.employee ? acks.find((a) => a.employeeId === ctx.employee!.id && a.documentVersionId === accepted.id) : undefined;
  const ownOlderAck = !ownAck && ctx.employee ? acks.find((a) => a.employeeId === ctx.employee!.id) : undefined;
  // The caller is asked to acknowledge only information that applies to them (or that they acknowledged before).
  const appliesToMe = !!ctx.employee && (!!ownAck || !!ownOlderAck || itemsFor(ctx, ctx.employee.id).some((it) => it.version.instructionDocumentId === doc.id));
  const visibleIds = visibleEmployeeIds(ctx);
  const ackRows = acks.filter((a) => visibleIds.has(a.employeeId)).sort((a, b) => b.acknowledgedAt.localeCompare(a.acknowledgedAt));
  const caseRow = doc.caseId ? ctx.db.caeCases.find((c) => c.id === doc.caseId) : undefined;
  const versionNo = (vid: string | null) => versions.find((x) => x.id === vid)?.version;

  const reqVersionLabel = (v: DocumentVersion) => {
    if (!v.requirementVersionId) return <span className="muted">—</span>;
    const rv = ctx.db.versions.find((x) => x.id === v.requirementVersionId);
    if (!rv) return <span className="muted">—</span>;
    const old = !!reqVersionNow && reqVersionNow.id !== rv.id;
    return (
      <span className="row-wrap" style={{ gap: 6 }}>
        <span>{t('Versión {n} del requisito', { n: rv.version })}</span>
        {old && (
          <Badge tone="warning" title={t('Revisada bajo una versión anterior del requisito; la vigente es la {n}.', { n: reqVersionNow!.version })}>
            {t('Versión anterior')}
          </Badge>
        )}
      </span>
    );
  };

  return (
    <div className="stack-lg">
      <PageHeader
        breadcrumbs={
          <>
            <Link to="/documentacion">{t('Documentación')}</Link>
            <span aria-hidden>/</span>
            <span>{doc.code}</span>
          </>
        }
        title={doc.title}
        subtitle={
          <span className="row-wrap">
            <span className="tag">{doc.code}</span>
            {latest ? <DocStatusBadge status={latest.status} /> : null}
            <AccessBadge cls={doc.accessClass} />
            <span className="small muted">{category?.label ?? doc.categoryId}</span>
          </span>
        }
        actions={
          <>
            {canSubmitNew && (
              <Button icon={FilePlus2} onClick={() => setDialog({ kind: 'new' })}>
                {t('Presentar nueva versión')}
              </Button>
            )}
            {canRequest && (
              <Button icon={Send} onClick={() => setDialog({ kind: 'request' })}>
                {t('Solicitar nueva evidencia')}
              </Button>
            )}
          </>
        }
      />

      <div className="grid-main-side">
        <div className="stack-lg">
          <Card title={t('Revisión')}>
            <div className="stack">
              {pendingVersion ? (
                <>
                  <div className="row-wrap">
                    <span className="strong">{t('Versión {n}', { n: pendingVersion.version })}</span>
                    <DocStatusBadge status={pendingVersion.status} />
                    <span className="small muted">
                      {t('Recibida')} <DateTimeText at={pendingVersion.receivedAt} tz={ctx.company.timezone} /> · {userName(ctx.db, pendingVersion.submittedBy)}
                    </span>
                  </div>
                  {decidable ? (
                    <div className="row-wrap">
                      {pendingVersion.status === 'received' && (
                        <Button icon={PlayCircle} loading={pending} onClick={() => run(() => startReview(pendingVersion.id), t('Revisión iniciada'))}>
                          {t('Iniciar revisión')}
                        </Button>
                      )}
                      <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog({ kind: 'decide', decision: 'accept', v: pendingVersion })}>
                        {t('Aceptar')}
                      </Button>
                      <Button variant="danger-outline" icon={XCircle} onClick={() => setDialog({ kind: 'decide', decision: 'reject', v: pendingVersion })}>
                        {t('Rechazar')}
                      </Button>
                    </div>
                  ) : (
                    <Callout tone="neutral">{t('Solo la autoridad de revisión configurada ({authority}) puede decidir; nunca sobre su propio documento.', { authority: authorityLabel })}</Callout>
                  )}
                </>
              ) : (
                <p className="small">{accepted ? t('No hay versiones pendientes de revisión. La versión vigente es la {n}.', { n: accepted.version }) : t('No hay versiones pendientes de revisión ni una versión aceptada.')}</p>
              )}
              <p className="small muted">{t('Autoridad de revisión: {authority}. La subida no implica aprobación; aceptar la evidencia no es una aprobación profesional de seguridad.', { authority: authorityLabel })}</p>
            </div>
          </Card>

          <Card title={t('Historial de versiones')} actions={<span className="small muted">{versions.length === 1 ? t('1 versión') : t('{n} versiones', { n: versions.length })}</span>}>
            {versions.length === 0 ? (
              <EmptyState icon={History} title={t('Sin versiones')} />
            ) : (
              <ol className="ev-versions" aria-label={t('Historial de versiones')}>
                {versions.map((v) => {
                  const current = accepted?.id === v.id;
                  return (
                    <li key={v.id} className={`ev-version ${current ? 'is-current' : ''} ev-status-${v.status}`}>
                      <div className="ev-version-head">
                        <span className="strong">{t('Versión {n}', { n: v.version })}</span>
                        <DocStatusBadge status={v.status} />
                        {current && (
                          <Badge tone="accent" icon={false}>
                            {t('Vigente [documento]')}
                          </Badge>
                        )}
                        <span className="grow" />
                        {v.file && (
                          <Button size="sm" icon={Download} loading={downloading} onClick={() => download(v.id)}>
                            {t('Descargar')}
                          </Button>
                        )}
                        {canDates && (v.status === 'accepted' || v.status === 'received' || v.status === 'in_review') && (
                          <Button size="sm" icon={CalendarClock} onClick={() => setDialog({ kind: 'dates', v })}>
                            {t('Actualizar fechas')}
                          </Button>
                        )}
                      </div>
                      <dl className="ev-version-grid">
                        <div>
                          <dt>{t('Recibida')}</dt>
                          <dd>
                            <DateTimeText at={v.receivedAt} tz={ctx.company.timezone} />
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Presentada por')}</dt>
                          <dd>{userName(ctx.db, v.submittedBy)}</dd>
                        </div>
                        <div>
                          <dt>{t('Emisor')}</dt>
                          <dd>{v.issuer || '—'}</dd>
                        </div>
                        <div>
                          <dt>{t('Fecha de emisión')}</dt>
                          <dd>
                            {v.issueDate ? <DateText date={v.issueDate} /> : <span className="muted small">{t('No indicada')}</span>}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Caducidad legal')}</dt>
                          <dd>
                            <LegalExpiry v={v} />
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Revisión del proveedor')}</dt>
                          <dd>
                            <KindDate kind="provider" date={v.providerReviewDate} today={v.status === 'accepted' ? ctx.today : undefined} />
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Seguimiento interno')}</dt>
                          <dd>
                            <KindDate kind="internal" date={v.internalFollowUpDate} today={v.status === 'accepted' ? ctx.today : undefined} />
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Persona revisora')}</dt>
                          <dd>
                            {v.reviewerId ? userName(ctx.db, v.reviewerId) : <span className="muted">{t('Sin asignar')}</span>}
                            {v.reviewedAt && (
                              <span className="sub">
                                {' · '}
                                <DateTimeText at={v.reviewedAt} tz={ctx.company.timezone} />
                              </span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Revisada bajo')}</dt>
                          <dd>{reqVersionLabel(v)}</dd>
                        </div>
                        <div className="ev-span">
                          <dt>{t('Archivo')}</dt>
                          <dd>
                            <DemoFileLabel v={v} />
                          </dd>
                        </div>
                        {v.decisionNote && (
                          <div className="ev-span">
                            <dt>{t('Nota de la decisión')}</dt>
                            <dd>{v.decisionNote}</dd>
                          </div>
                        )}
                        {v.rejectionReason && (
                          <div className="ev-span">
                            <dt>{t('Motivo del rechazo')}</dt>
                            <dd className="ev-reject">{v.rejectionReason}</dd>
                          </div>
                        )}
                        {v.supersededBy && (
                          <div>
                            <dt>{t('Sustituida por')}</dt>
                            <dd>{versionNo(v.supersededBy) ? t('Versión {n}', { n: versionNo(v.supersededBy)! }) : t('Otra evidencia aceptada del mismo requisito')}</dd>
                          </div>
                        )}
                        {v.sourceReference && (
                          <div>
                            <dt>{t('Referencia de origen')}</dt>
                            <dd>{v.sourceReference}</dd>
                          </div>
                        )}
                        {v.notes && (
                          <div className="ev-span">
                            <dt>{t('Notas')}</dt>
                            <dd>{v.notes}</dd>
                          </div>
                        )}
                      </dl>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          {ackable && (
            <Card title={t('Confirmación de la información')} actions={ctx.can('evidence.upload') && accepted ? <Button size="sm" icon={FileSignature} onClick={() => setDialog({ kind: 'paper', v: accepted })}>{t('Registrar confirmación en papel')}</Button> : undefined}>
              <div className="stack">
                <Callout tone="info">{t('La confirmación indica que la persona recibió y leyó esta versión. No acredita formación. Una nueva versión necesita una nueva confirmación.')}</Callout>
                {ctx.employee && ctx.can('own.acknowledge') && appliesToMe && (
                  <div className="ev-own-ack">
                    {!accepted ? (
                      <span className="small muted">{t('La información no tiene una versión aceptada que confirmar.')}</span>
                    ) : ownAck ? (
                      <span className="row-wrap small">
                        <Badge tone="success">{t('Confirmada [información]')}</Badge>
                        {t('Usted confirmó la versión {n} el', { n: accepted.version })} <DateTimeText at={ownAck.acknowledgedAt} tz={ctx.company.timezone} />
                      </span>
                    ) : (
                      <div className="row-wrap">
                        <span className="small">{ownOlderAck ? t('Usted confirmó una versión anterior. Confirme la versión vigente ({n}).', { n: accepted.version }) : t('Confirme que ha recibido y leído la versión {n}.', { n: accepted.version })}</span>
                        <Button variant="primary" size="sm" icon={ClipboardCheck} loading={pending} onClick={() => run(() => acknowledgeDocument(doc.id), t('Recepción confirmada (versión {n}). No sustituye a la formación.', { n: accepted.version }))}>
                          {t('Confirmar recepción y lectura')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {canSeeAcks && (
                  <>
                    <div className="strong small">{t('Confirmaciones registradas')}</div>
                    {ackRows.length === 0 ? (
                      <EmptyState icon={Users} title={t('Sin confirmaciones en su ámbito')} />
                    ) : (
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>{t('Persona trabajadora')}</th>
                              <th>{t('Versión')}</th>
                              <th>{t('Fecha')}</th>
                              <th>{t('Método')}</th>
                              <th>{t('Registrada por')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ackRows.map((a) => {
                              const n = versionNo(a.documentVersionId);
                              const isCurrent = !!accepted && a.documentVersionId === accepted.id;
                              return (
                                <tr key={a.id}>
                                  <td>
                                    <EmployeeLink id={a.employeeId} />
                                  </td>
                                  <td>
                                    <span className="row-wrap" style={{ gap: 6 }}>
                                      {n ? t('Versión {n}', { n }) : '—'}
                                      {isCurrent ? (
                                        <Badge tone="success" icon={false}>
                                          {t('Vigente [documento]')}
                                        </Badge>
                                      ) : (
                                        <Badge tone="warning" title={t('Confirmó una versión anterior: falta confirmar la vigente.')}>
                                          {t('Versión anterior')}
                                        </Badge>
                                      )}
                                    </span>
                                  </td>
                                  <td>
                                    <DateTimeText at={a.acknowledgedAt} tz={ctx.company.timezone} />
                                  </td>
                                  <td>{a.method === 'in_app' ? t('En la aplicación') : t('Firma en papel registrada')}</td>
                                  <td>{userName(ctx.db, a.recordedBy)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {pendingAck.length > 0 && (
                      <div className="stack-sm">
                        <div className="strong small">{t('Pendientes de confirmar la versión vigente ({n})', { n: pendingAck.length })}</div>
                        <ul className="ev-chips">
                          {pendingAck.map((p) => (
                            <li key={`${p.employeeId}|${p.worksiteId ?? ''}`}>
                              <EmployeeLink id={p.employeeId} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="stack-lg">
          <Card title={t('Datos del documento')}>
            <KV
              items={[
                [t('Código'), doc.code],
                [t('Tipo de documento'), category?.label ?? doc.categoryId],
                [doc.employeeId ? t('Persona trabajadora') : t('Ámbito'), doc.employeeId ? <EmployeeLink id={doc.employeeId} /> : doc.worksiteId ? <WorksiteLink id={doc.worksiteId} /> : t('Toda la empresa')],
                ...(doc.employeeId && doc.worksiteId ? ([[t('Centro de trabajo'), <WorksiteLink id={doc.worksiteId} />]] as [string, ReactNode][]) : []),
                [t('Requisito'), <RequirementRef templateId={doc.templateId} />],
                [t('Autoridad de revisión'), authorityLabel],
                [t('Clasificación de acceso'), <StatusBadge meta={ACCESS_CLASS[doc.accessClass]} />],
                [t('Estado actual'), latest ? <span className="row-wrap" style={{ gap: 6 }}><DocStatusBadge status={latest.status} /><span className="small muted">{t('Versión {n}', { n: latest.version })}</span></span> : '—'],
                [t('Versión aceptada vigente'), accepted ? t('Versión {n}', { n: accepted.version }) : <span className="muted">{t('Ninguna')}</span>],
                [t('Referencia de origen'), latest?.sourceReference || <span className="muted">—</span>],
                ...(caseRow ? ([[t('Coordinación CAE'), <Link to={`/cae/${caseRow.id}`}>{caseRow.code}</Link>]] as [string, ReactNode][]) : []),
                [t('Creado'), <span><DateTimeText at={doc.createdAt} tz={ctx.company.timezone} /> · {userName(ctx.db, doc.createdBy)}</span>],
              ]}
            />
            <p className="small muted" style={{ marginTop: 12 }}>
              {t(DOC_STATUS[latest?.status ?? 'received'].help)}
            </p>
          </Card>
          <Card title={t('Auditoría del documento')}>
            <AuditList filter={(e) => e.entityId === doc.id} />
          </Card>
        </div>
      </div>

      {dialog?.kind === 'decide' && <DecisionModal doc={doc} version={dialog.v} decision={dialog.decision} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'dates' && <DatesModal doc={doc} version={dialog.v} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'paper' && <PaperAckModal doc={doc} version={dialog.v} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'new' && <SubmitDocumentModal document={doc} onClose={() => setDialog(null)} onSubmitted={(docId) => docId !== doc.id && navigate(`/documentacion/${docId}`)} />}
      {dialog?.kind === 'request' && doc.employeeId && doc.templateId && <RequestEvidenceModal employeeId={doc.employeeId} templateId={doc.templateId} worksiteId={doc.worksiteId} onClose={() => setDialog(null)} />}
    </div>
  );
}
