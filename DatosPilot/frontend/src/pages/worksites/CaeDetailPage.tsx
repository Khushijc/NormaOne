/**
 * Detalle de un caso CAE: participants, information exchanges with FOUR separate facts (sent,
 * receipt confirmed, recipient acknowledgement, review decision), simulated share links, the CAE
 * package export, open points and the history. Representatives see the case read-only.
 */
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ClipboardCheck, FileText, Lock, Pencil, Plus, Send, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { KindDate, WorksiteLink } from '../../components/bits';
import { ExportButton } from '../../components/ExportButton';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, PageHeader, StatusBadge, Tabs, useAction } from '../../components/ui';
import { CAE_REVIEW, CAE_ROLE_LABEL } from '../../domain/status';
import { formatDate, localDate } from '../../domain/time';
import type { CaeCase, CaeExchange } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { casePending, closeCase, visibleCases, type ExchangeStep } from '../../services/caeService';
import { canSeeDocument, userName } from '../../services/context';
import { EMPTY_FILTERS } from '../../services/reportService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { CaseFormModal } from './CaseFormModal';
import { AddParticipantModal, RecordExchangeModal, ReviewExchangeModal, StepModal } from './CaeModals';
import { ShareLinksPanel } from './CaeShareLinks';
import { CaseStatusBadge, customerName, participantName, pendingItems } from './worksiteShared';

type TabId = 'resumen' | 'intercambios' | 'enlaces' | 'historial';
const TABS: TabId[] = ['resumen', 'intercambios', 'enlaces', 'historial'];

export function CaeDetailPage() {
  const { id = '' } = useParams();
  const ctx = useCtx();
  const kase = visibleCases(ctx).find((c) => c.id === id);
  if (!kase) return <RecordNotFound back="/cae" label={tKey('Coordinación CAE')} />;
  return <CaseDetail ctx={ctx} kase={kase} />;
}

function CaseDetail({ ctx, kase }: { ctx: UiCtx; kase: CaeCase }) {
  const [params, setParams] = useSearchParams();
  const { runOk } = useAction();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState(false);
  const [step, setStep] = useState<{ x: CaeExchange; step: ExchangeStep } | null>(null);
  const [reviewing, setReviewing] = useState<CaeExchange | null>(null);

  const closed = kase.status === 'closed';
  const canManage = ctx.can('cae.manage') && !closed;
  const fullView = ctx.can('cae.view');
  const canReview = canManage && ctx.can('evidence.review');
  const ws = ctx.db.worksites.find((w) => w.id === kase.worksiteId);
  const exchanges = ctx.db.caeExchanges.filter((x) => x.caseId === kase.id && x.companyId === ctx.company.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = casePending(ctx, kase);
  const items = closed ? [] : pendingItems(pending);
  const links = ctx.db.shareLinks.filter((l) => l.caseId === kase.id);

  const raw = params.get('tab') as TabId | null;
  const tab: TabId = raw && TABS.includes(raw) && (raw !== 'enlaces' || fullView) ? raw : 'resumen';
  const setTab = (v: TabId) => setParams((p) => { p.set('tab', v); return p; }, { replace: true });

  return (
    <div className="stack-lg">
      <PageHeader
        breadcrumbs={<Link to="/cae">{t('Coordinación CAE')}</Link>}
        title={`${kase.code} · ${kase.title}`}
        subtitle={
          <span className="row-wrap" style={{ gap: 6 }}>
            <CaseStatusBadge status={kase.status} />
            <WorksiteLink id={kase.worksiteId} />
            {ws?.kind === 'customer' && <span className="muted">· {customerName(ctx, ws.customerId)}</span>}
          </span>
        }
        actions={
          <>
            {fullView && ctx.can('reports.export') && <ExportButton reportId="cae_package" filters={{ ...EMPTY_FILTERS, caseId: kase.id }} label={t('Exportar paquete CAE')} />}
            {canManage && (
              <>
                <Button icon={Pencil} onClick={() => setEditing(true)}>
                  {t('Editar caso')}
                </Button>
                <Button icon={Lock} variant="danger-outline" onClick={() => setClosing(true)}>
                  {t('Cerrar caso')}
                </Button>
              </>
            )}
          </>
        }
      />

      {!ctx.can('cae.manage') && (
        <Callout tone="info" title={t('Consulta en modo lectura')}>
          {t('Su rol permite consultar el caso, sin registrar intercambios ni modificarlo.')}
        </Callout>
      )}
      {closed && (
        <Callout tone="neutral" title={t('Caso cerrado')}>
          {t('Cerrado el {date}. Los enlaces se revocaron; los intercambios y el historial se conservan.', { date: kase.closedAt ? formatDate(localDate(kase.closedAt)) : '—' })}
        </Callout>
      )}

      {!closed && (items.length > 0 || kase.openQuestions.trim()) ? (
        <Callout tone="warning" title={t('Información pendiente y puntos abiertos')}>
          <ul className="cae-plain-list cae-missing">
            {kase.openQuestions.trim() && (
              <li>
                <span className="strong">{t('Preguntas abiertas')}:</span> {kase.openQuestions}
              </li>
            )}
            {items.map((i) => (
              <li key={i.key}>{i.text}</li>
            ))}
            {!exchanges.some((x) => x.direction === 'received') && <li>{t('Todavía no se ha registrado información recibida de las demás empresas.')}</li>}
          </ul>
        </Callout>
      ) : (
        !closed && (
          <Callout tone="success" title={t('Sin puntos abiertos registrados')}>
            {t('No hay envíos pendientes de confirmar ni información por revisar. Esto no certifica que la coordinación sea suficiente.')}
          </Callout>
        )
      )}

      <Tabs<TabId>
        label={t('Secciones del caso')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'resumen', label: t('Resumen y participantes'), count: kase.participants.length },
          { id: 'intercambios', label: t('Intercambios de información'), count: exchanges.length },
          { id: 'enlaces', label: t('Enlaces simulados'), count: links.length, hidden: !fullView },
          { id: 'historial', label: t('Historial') },
        ]}
      />

      {tab === 'resumen' && (
        <div className="grid-main-side">
          <div className="stack">
            <Card title={t('Datos del caso')}>
              <KV
                items={[
                  [t('Centro de trabajo'), <WorksiteLink id={kase.worksiteId} />],
                  [t('Cliente'), ws?.kind === 'customer' ? customerName(ctx, ws.customerId) : t('Centro propio')],
                  [t('Estado'), <CaseStatusBadge status={kase.status} />],
                  [t('Actividades concurrentes'), kase.activities || <span className="muted">{t('No indicadas')}</span>],
                  [t('Riesgos que se coordinan'), kase.risksSummary || <span className="muted">{t('No indicados')}</span>],
                  [t('Medios de coordinación'), kase.coordinationMeans || <span className="muted">{t('No indicados')}</span>],
                  [t('Responsable del seguimiento'), kase.followUpOwnerId ? userName(ctx.db, kase.followUpOwnerId) : <span className="muted">{t('Sin asignar')}</span>],
                  [t('Próximo seguimiento'), <KindDate kind="internal" date={kase.nextFollowUp} today={closed ? undefined : ctx.today} />],
                  [t('Preguntas abiertas'), kase.openQuestions || <span className="muted">{t('Ninguna')}</span>],
                  [t('Creado'), <span>{userName(ctx.db, kase.createdBy)} · <DateTimeText at={kase.createdAt} /></span>],
                ]}
              />
            </Card>
            <Card
              title={t('Participantes')}
              actions={
                canManage && (
                  <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
                    {t('Añadir participante')}
                  </Button>
                )
              }
              flush
            >
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">{t('Participantes')}</caption>
                  <thead>
                    <tr>
                      <th>{t('Organización')}</th>
                      <th>{t('Papel en la coordinación')}</th>
                      <th>{t('Contacto')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kase.participants.map((p) => (
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
          </div>
          <div className="stack">
            <Card title={t('Qué registra un caso CAE')}>
              <ul className="cae-plain-list small stack-sm">
                <li>{t('Quién informa de qué, a quién y cuándo.')}</li>
                <li>{t('Enviar o subir información no implica que se haya recibido.')}</li>
                <li>{t('Que se haya recibido no implica que se haya entendido (acuse del destinatario).')}</li>
                <li>{t('Lo recibido de otras empresas se revisa por separado (aceptado o con objeciones).')}</li>
              </ul>
            </Card>
            <Callout tone="neutral" title={t('Fuera del alcance inicial')}>
              {t('La coordinación específica de obras de construcción (RD 1627/1997: estudio y plan de seguridad, coordinador en obra, libro de subcontratación) no se gestiona en esta versión.')}
            </Callout>
          </div>
        </div>
      )}

      {tab === 'intercambios' && (
        <ExchangesTab
          ctx={ctx}
          kase={kase}
          exchanges={exchanges}
          canManage={canManage}
          canReview={canReview}
          onRecord={() => setRecording(true)}
          onStep={(x, s) => setStep({ x, step: s })}
          onReview={setReviewing}
        />
      )}

      {tab === 'enlaces' && fullView && <ShareLinksPanel kase={kase} canManage={canManage} />}

      {tab === 'historial' && (
        <Card title={t('Historial del caso')}>
          <AuditList filter={(e) => e.entityId === kase.id} />
        </Card>
      )}

      {editing && <CaseFormModal kase={kase} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {adding && <AddParticipantModal kase={kase} onClose={() => setAdding(false)} />}
      {recording && <RecordExchangeModal kase={kase} onClose={() => setRecording(false)} />}
      {step && <StepModal kase={kase} exchange={step.x} step={step.step} onClose={() => setStep(null)} />}
      {reviewing && <ReviewExchangeModal kase={kase} exchange={reviewing} onClose={() => setReviewing(null)} />}
      {closing && (
        <ConfirmDialog
          title={t('Cerrar el caso {code}', { code: kase.code })}
          danger
          confirmLabel={t('Cerrar caso')}
          requireReason
          reasonLabel={t('Motivo del cierre (fin de la concurrencia, fin del contrato…)')}
          message={
            <div className="stack-sm small">
              <p style={{ margin: 0 }}>{t('Se revocarán los {n} enlaces simulados activos. Los intercambios y el historial se conservan.', { n: links.filter((l) => !l.revokedAt).length })}</p>
              {items.length > 0 && <p style={{ margin: 0 }}>{t('Atención: el caso tiene {n} puntos abiertos que quedarán sin resolver.', { n: items.length })}</p>}
            </div>
          }
          onConfirm={(reason) => runOk(() => closeCase(kase.id, reason), t('Caso cerrado'))}
          onClose={() => setClosing(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Intercambios ───────────────────────────────

type DirFilter = 'all' | 'sent' | 'received';

function ExchangesTab({
  ctx,
  kase,
  exchanges,
  canManage,
  canReview,
  onRecord,
  onStep,
  onReview,
}: {
  ctx: UiCtx;
  kase: CaeCase;
  exchanges: CaeExchange[];
  canManage: boolean;
  canReview: boolean;
  onRecord: () => void;
  onStep: (x: CaeExchange, s: ExchangeStep) => void;
  onReview: (x: CaeExchange) => void;
}) {
  const [dir, setDir] = useState<DirFilter>('all');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const isOpen = (x: CaeExchange) => (x.direction === 'sent' ? !x.acknowledgedAt : x.review === 'pending');
  const rows = exchanges.filter((x) => (dir === 'all' || x.direction === dir) && (!onlyOpen || isOpen(x)));
  const day = (instant: string | null) => (instant ? localDate(instant) : null);

  const docCell = (x: CaeExchange) => {
    if (!x.documentId) return <span className="muted small">{x.versionLabel !== '—' ? t('Sin documento adjunto ({v})', { v: x.versionLabel }) : t('Sin documento adjunto')}</span>;
    const d = ctx.db.documents.find((z) => z.id === x.documentId);
    if (!d) return <span className="muted small">—</span>;
    return (
      <>
        {canSeeDocument(ctx, d) ? <Link to={`/documentacion/${d.id}`}>{d.title}</Link> : <span>{d.title}</span>}
        <div className="tiny muted">
          {d.code} · {x.versionLabel}
        </div>
      </>
    );
  };

  const nextStep = (x: CaeExchange): ExchangeStep | null => (x.direction !== 'sent' ? null : !x.sentAt ? 'sent' : !x.receivedAt ? 'receipt' : !x.acknowledgedAt ? 'acknowledged' : null);
  const STEP_LABEL: Record<ExchangeStep, string> = { sent: t('Registrar envío'), receipt: t('Registrar recepción'), acknowledged: t('Registrar acuse') };
  // The action for the next missing fact sits in that fact's own column (steps go in order).
  const stepBtn = (x: CaeExchange, step: ExchangeStep) =>
    canManage && nextStep(x) === step ? (
      <div className="cae-cell-action">
        <Button size="sm" onClick={() => onStep(x, step)}>
          {STEP_LABEL[step]}
        </Button>
      </div>
    ) : null;

  return (
    <div className="stack">
      <Callout tone="info" title={t('Cuatro hechos distintos')}>
        {t('Cada intercambio registra por separado el envío, la confirmación de recepción, el acuse de comprensión del destinatario y la decisión de revisión. Subir o enviar un documento no implica que se haya recibido, entendido ni aceptado.')}
      </Callout>
      <Card
        title={t('Intercambios de información')}
        actions={
          canManage && (
            <Button size="sm" variant="primary" icon={Plus} onClick={onRecord}>
              {t('Registrar intercambio')}
            </Button>
          )
        }
        flush
      >
        <div className="toolbar">
          <div className="segmented" role="group" aria-label={t('Dirección')}>
            {(['all', 'sent', 'received'] as DirFilter[]).map((d) => (
              <button key={d} type="button" aria-pressed={dir === d} onClick={() => setDir(d)}>
                {d === 'all' ? t('Todos') : d === 'sent' ? t('Enviados') : t('Recibidos')}
              </button>
            ))}
          </div>
          <label className="checkbox ws-toolbar-check">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            <span>{t('Solo pendientes')}</span>
          </label>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Send} title={exchanges.length ? t('Ningún intercambio coincide con el filtro') : t('Sin intercambios registrados')}>
            {exchanges.length ? undefined : t('Registre la información enviada a las demás empresas y la recibida de ellas.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table cae-exchanges">
              <caption className="sr-only">{t('Intercambios de información')}</caption>
              <thead>
                <tr>
                  <th>{t('Dirección')}</th>
                  <th>{t('Asunto')}</th>
                  <th>{t('Documento y versión')}</th>
                  <th>{t('Remitente → destinatario')}</th>
                  <th>{t('Enviado')}</th>
                  <th>{t('Recepción confirmada')}</th>
                  <th>{t('Acuse del destinatario')}</th>
                  <th>{t('Revisión')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  return (
                    <tr key={x.id}>
                      <td className="nowrap">
                        {x.direction === 'sent' ? (
                          <Badge tone="accent" icon={ArrowUpRight}>
                            {t('Enviado')}
                          </Badge>
                        ) : (
                          <Badge tone="info" icon={ArrowDownLeft}>
                            {t('Recibido')}
                          </Badge>
                        )}
                      </td>
                      <td>
                        <div className="strong small">{x.subject}</div>
                        {x.followUp && <div className="tiny muted">{t('Seguimiento')}: {x.followUp}</div>}
                      </td>
                      <td className="small">{docCell(x)}</td>
                      <td className="small">
                        {participantName(kase, x.senderParticipantId)} → {participantName(kase, x.recipientParticipantId)}
                      </td>
                      <td className="small">
                        {x.sentAt ? <DateText date={day(x.sentAt)} /> : x.direction === 'sent' ? <Badge tone="warning">{t('No enviado')}</Badge> : <span className="muted">{t('No indicada')}</span>}
                        {stepBtn(x, 'sent')}
                      </td>
                      <td className="small">
                        {x.receivedAt ? (
                          <>
                            <span className="row" style={{ gap: 4 }}>
                              <CheckCircle2 size={13} aria-hidden style={{ color: 'var(--success)' }} />
                              <DateText date={day(x.receivedAt)} />
                            </span>
                            {x.receiptConfirmedBy && <div className="tiny muted">{t('por {name}', { name: x.receiptConfirmedBy })}</div>}
                          </>
                        ) : x.sentAt ? (
                          <>
                            <Badge tone="warning">{t('Sin confirmar')}</Badge>
                            {stepBtn(x, 'receipt')}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="small">
                        {x.direction === 'received' ? (
                          <span className="muted" title={t('El acuse de comprensión se pide al destinatario de la información que enviamos.')}>
                            {t('No aplica')}
                          </span>
                        ) : x.acknowledgedAt ? (
                          <span className="row" style={{ gap: 4 }}>
                            <ClipboardCheck size={13} aria-hidden style={{ color: 'var(--success)' }} />
                            <DateText date={day(x.acknowledgedAt)} />
                          </span>
                        ) : x.receivedAt ? (
                          <>
                            <Badge tone="warning">{t('Sin acuse')}</Badge>
                            {stepBtn(x, 'acknowledged')}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="small">
                        <StatusBadge meta={CAE_REVIEW[x.review]} />
                        {x.reviewedBy && <div className="tiny muted">{userName(ctx.db, x.reviewedBy)}</div>}
                        {x.reviewNote && <div className="tiny muted">{x.reviewNote}</div>}
                        {canManage && x.direction === 'received' && x.review === 'pending' && (
                          <div className="cae-cell-action">
                            <Button size="sm" onClick={() => onReview(x)} disabled={!canReview} title={canReview ? undefined : t('La revisión del contenido corresponde a la coordinación de PRL o al servicio de prevención.')}>
                              {t('Revisar')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="row-wrap tiny muted cae-legend">
        <span>
          <FileText size={12} aria-hidden /> {t('Solo se envía evidencia aceptada, no restringida y relevante para el centro.')}
        </span>
        <span>
          <Users size={12} aria-hidden /> {t('Las fechas de recepción y acuse las confirma la empresa destinataria.')}
        </span>
      </div>
    </div>
  );
}
