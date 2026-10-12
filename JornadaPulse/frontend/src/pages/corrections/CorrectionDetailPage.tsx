/**
 * Detail of one correction request (`/correcciones/:id`): original, requested and approved
 * values side by side, explanation, decision, employee response, full history and audit trail.
 *
 * Actions depend on role and status; the service re-checks every one (self-review is refused,
 * repeated decisions are refused). R25: original preserved, reviewer and time kept, outcome
 * notified. R26: company proposals need the employee's agreement or a recorded disagreement.
 */
import { Check, CheckCheck, FileClock, MessageSquareWarning, ThumbsUp, Undo2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { EmployeeLink, TimeText } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, DateTimeText, KV, PageHeader, StatusBadge, TextAreaField, useAction, Modal } from '../../components/ui';
import { stateFromValues, toValues, ValuesEditor, type EditorState } from '../../components/ValuesEditor';
import { policyOn, relationshipOn } from '../../domain/records';
import { CORRECTION_KIND_LABEL, CORRECTION_STATUS, EVENT_TYPE_LABEL } from '../../domain/status';
import { formatDate, formatDateLong, formatInstant, localDate } from '../../domain/time';
import type { CorrectionRequest, Employee } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { canReview, userName } from '../../services/context';
import { applyWithDisagreement, checkValues, respondToProposal, reviewCorrection, visibleCorrections, withdrawCorrection, type ValuesCheck } from '../../services/correctionService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { HISTORY_ACTION_LABEL, InitiatedBadge, NoteDialog, sameValues, ValuesFields, worksiteNamer } from './correctionBits';

type DialogKind = 'approve' | 'reject' | 'agree' | 'disagree' | 'apply' | 'withdraw' | null;

function paidBreakKindsFor(ctx: UiCtx, c: CorrectionRequest) {
  const rel = relationshipOn(ctx.db, c.employeeId, c.date);
  return rel ? policyOn(ctx.db, c.companyId, rel.policyKey, c.date)?.breaks.paidBreakKinds ?? [] : [];
}

export function CorrectionDetailPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const db = ctx.db;
  const [dialog, setDialog] = useState<DialogKind>(null);
  const { run } = useAction();

  const c = visibleCorrections(ctx).find((x) => x.id === id);
  if (!c) return <RecordNotFound back="/correcciones" label={tKey('Solicitudes de corrección')} />;

  const emp = db.employees.find((e) => e.id === c.employeeId);
  const session = c.sessionId ? db.sessions.find((s) => s.id === c.sessionId) : undefined;
  const failed = c.failedAttemptId ? db.failedAttempts.find((f) => f.id === c.failedAttemptId) : undefined;
  const tz = session?.timezone ?? ctx.company.timezone;
  const nameOf = worksiteNamer(db);
  const paidKinds = paidBreakKindsFor(ctx, c);

  const isEmployee = ctx.employee?.id === c.employeeId;
  const active = c.status === 'pending' || c.status === 'pending_employee';
  const reviewer = c.status === 'pending' && canReview(ctx, c.employeeId, 'corrections');
  const respondsOnBehalf = !isEmployee && !emp?.userId && ctx.can('corrections.propose');
  const canRespond = (isEmployee || respondsOnBehalf) && c.status === 'pending_employee' && !c.employeeResponse;
  const disagreement = c.status === 'pending_employee' && !!c.employeeResponse && !c.employeeResponse.agreed;
  const hrDecides = disagreement && ctx.can('corrections.propose');
  const isRequester = c.requestedBy === ctx.user.id || (isEmployee && c.initiatedBy === 'employee');
  const canWithdraw = active && (isRequester || (c.initiatedBy === 'company' && ctx.can('corrections.propose')));
  const onBehalf = c.initiatedBy === 'employee' && c.requestedBy !== emp?.userId;
  const hasApp = !!emp?.userId;
  const adjusted = !!c.approved && !sameValues(c.requested, c.approved);

  const notifiedText = hasApp ? t('El resultado se notifica al empleado en la aplicación.') : t('El empleado no tiene acceso a la aplicación: comuníquele el resultado por el canal habitual.');

  // History: some imported requests have no entries; show the request itself at least.
  const history = c.history.length ? c.history : [{ at: c.requestedAt, by: c.requestedBy, action: c.initiatedBy === 'company' ? 'proposed' : 'requested', note: null }];

  const approvedEmpty =
    c.status === 'rejected'
      ? t('No se aplicó: la solicitud fue rechazada.')
      : c.status === 'withdrawn'
        ? t('No se aplicó: la solicitud se retiró.')
        : c.status === 'pending_employee'
          ? t('Pendiente de la conformidad del empleado.')
          : t('Pendiente de la decisión del revisor.');

  return (
    <div className="stack-lg">
      <PageHeader
        breadcrumbs={
          <>
            <Link to="/correcciones">{t('Solicitudes de corrección')}</Link> <span aria-hidden>/</span> <span>{formatDate(c.date)}</span>
          </>
        }
        title={t('Corrección del {date}', { date: formatDate(c.date) })}
        subtitle={
          <>
            {emp ? `${emp.firstName} ${emp.lastName}` : '—'} · {t(CORRECTION_KIND_LABEL[c.kind])} · {formatDateLong(c.date)}
          </>
        }
        actions={
          <div className="row-wrap">
            <StatusBadge meta={CORRECTION_STATUS[c.status]} prefix="Estado" />
            <InitiatedBadge c={c} onBehalf={onBehalf} />
          </div>
        }
      />

      {/* Situation for the current viewer */}
      {canRespond && (
        <Callout tone="warning" title={t('La empresa propone corregir su registro')}>
          {t('Compare los valores originales y propuestos. Puede dar su conformidad (la corrección se aplica) o manifestar su discrepancia (queda constancia y RR. HH. decide). Mientras no responda, su registro no cambia.')}
        </Callout>
      )}
      {isEmployee && c.status === 'pending' && (
        <Callout tone="info" title={t('No puede revisar sus propias solicitudes')}>
          {t('La revisará su supervisor o RR. HH. Recibirá una notificación con la decisión y el motivo.')}
        </Callout>
      )}
      {hrDecides && (
        <Callout tone="warning" title={t('El empleado ha manifestado su discrepancia')}>
          {t('Puede retirar la propuesta o aplicarla dejando constancia de la discrepancia. Si la aplica, informe a la representación legal de los trabajadores e indíquelo en la nota.')}
        </Callout>
      )}

      <section aria-label={t('Valores original, solicitado y aprobado')} className="corr-columns">
        <Card title={t('Original')} className="corr-col">
          <ValuesFields values={c.original} tz={tz} worksiteName={nameOf} paidBreakKinds={paidKinds} empty={t('Sin registro original: jornada no registrada.')} />
          <p className="tiny muted corr-col-note">{t('Valores vigentes cuando se pidió la corrección. Los fichajes originales nunca se modifican.')}</p>
        </Card>
        <Card title={c.initiatedBy === 'company' ? t('Propuesto') : t('Solicitado')} className="corr-col">
          <ValuesFields values={c.requested} tz={tz} compareTo={c.original} changedLabel={t('cambia')} worksiteName={nameOf} paidBreakKinds={paidKinds} empty="—" />
        </Card>
        <Card title={t('Aprobado')} className={`corr-col ${c.approved ? 'is-applied' : ''}`}>
          <ValuesFields values={c.approved} tz={tz} compareTo={c.original} changedLabel={t('cambia')} secondCompare={adjusted ? c.requested : undefined} secondLabel={t('ajustado por el revisor')} worksiteName={nameOf} paidBreakKinds={paidKinds} empty={approvedEmpty} />
          {adjusted && <p className="tiny muted corr-col-note">{t('El revisor aprobó valores distintos de los solicitados; ambos se conservan.')}</p>}
        </Card>
      </section>

      <div className="grid-main-side corr-detail-grid">
        <div className="stack-lg">
          <Card title={t('Solicitud')}>
            <KV
              items={[
                [t('Empleado'), <EmployeeLink key="e" id={c.employeeId} />],
                [t('Tipo'), t(CORRECTION_KIND_LABEL[c.kind])],
                [t('Explicación'), <span key="x" className="corr-quote">{c.explanation}</span>],
                [t('Iniciada por'), <InitiatedBadge key="i" c={c} onBehalf={onBehalf} />],
                [t('Solicitada por'), <span key="r">{userName(db, c.requestedBy)} · <DateTimeText at={c.requestedAt} tz={tz} /></span>],
                [t('Revisor'), c.reviewerId ? userName(db, c.reviewerId) : <span className="muted">{active ? t('Pendiente') : '—'}</span>],
                [t('Decisión'), c.decidedAt ? <DateTimeText key="d" at={c.decidedAt} tz={tz} /> : <span className="muted">—</span>],
                [t('Motivo de la decisión'), c.decisionReason ? <span key="m" className="corr-quote">{t(c.decisionReason)}</span> : <span className="muted">—</span>],
                [
                  t('Respuesta del empleado'),
                  c.employeeResponse ? (
                    <span key="er" className="stack-sm" style={{ gap: 2 }}>
                      <span>
                        {c.employeeResponse.agreed ? <Badge tone="success">{t('Conformidad')}</Badge> : <Badge tone="danger">{t('Discrepancia')}</Badge>} <span className="tiny muted">{formatInstant(c.employeeResponse.at, tz)}</span>
                      </span>
                      {c.employeeResponse.comment && <span className="corr-quote">{t(c.employeeResponse.comment)}</span>}
                    </span>
                  ) : c.initiatedBy === 'company' ? (
                    <span className="muted">{t('Sin respuesta todavía')}</span>
                  ) : (
                    <span className="muted">{t('No aplica (solicitada por el empleado)')}</span>
                  ),
                ],
                [
                  t('Registro'),
                  session ? (
                    <Link key="s" to={`/registros/${session.id}`} className="row" style={{ gap: 4, display: 'inline-flex' }}>
                      <FileClock size={14} aria-hidden /> {t('Ver el registro del {date}', { date: formatDate(session.date) })}
                    </Link>
                  ) : (
                    <span className="muted">{t('Jornada no registrada: si se aprueba, se crea una sesión marcada como procedente de una corrección.')}</span>
                  ),
                ],
                ...(failed
                  ? ([
                      [
                        t('Fichaje «No registrado»'),
                        <span key="f" className="stack-sm" style={{ gap: 2 }}>
                          <span>
                            {t(EVENT_TYPE_LABEL[failed.action])} · {formatDate(localDate(failed.attemptedAt, tz))} <TimeText at={failed.attemptedAt} tz={tz} /> · {nameOf(failed.worksiteId)}
                          </span>
                          <span className="tiny muted">{t(failed.reason)}</span>
                          <Link className="tiny" to={`/registros?empleado=${c.employeeId}&desde=${localDate(failed.attemptedAt, tz)}&hasta=${localDate(failed.attemptedAt, tz)}`}>
                            {t('Ver los registros de ese día')}
                          </Link>
                        </span>,
                      ],
                    ] as [string, ReactNode][])
                  : []),
              ]}
            />
          </Card>

          <Card title={t('Historial de la solicitud')}>
            <ol className="timeline" aria-label={t('Historial de la solicitud')}>
              {history.map((h, i) => (
                <li key={i}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="strong">{t(HISTORY_ACTION_LABEL[h.action] ?? h.action)}</span>
                    <span className="tiny muted nowrap">{formatInstant(h.at, tz)}</span>
                  </div>
                  <div className="tiny muted">{userName(db, h.by)}</div>
                  {h.note && <div className="tiny">{t(h.note)}</div>}
                </li>
              ))}
            </ol>
          </Card>

          {(ctx.can('audit.view') || isEmployee) && (
            <Card title={t('Auditoría')}>
              <AuditList filter={(e) => e.entityId === c.id} />
            </Card>
          )}
        </div>

        <div className="stack-lg corr-side">
          <Card title={t('Acciones')}>
            <div className="stack">
              {reviewer && (
                <>
                  <p className="small">{t('Compruebe la explicación y, si procede, ajuste los valores antes de aprobar.')}</p>
                  <div className="row-wrap">
                    <Button variant="primary" icon={Check} onClick={() => setDialog('approve')}>
                      {t('Aprobar')}
                    </Button>
                    <Button variant="danger-outline" icon={X} onClick={() => setDialog('reject')}>
                      {t('Rechazar')}
                    </Button>
                  </div>
                </>
              )}
              {canRespond && (
                <div className="row-wrap">
                  <Button variant="primary" icon={ThumbsUp} onClick={() => setDialog('agree')}>
                    {respondsOnBehalf ? t('Registrar conformidad del empleado') : t('Dar conformidad')}
                  </Button>
                  <Button variant="danger-outline" icon={MessageSquareWarning} onClick={() => setDialog('disagree')}>
                    {respondsOnBehalf ? t('Registrar discrepancia del empleado') : t('Manifestar discrepancia')}
                  </Button>
                  {respondsOnBehalf && <div className="tiny muted">{t('El empleado no tiene acceso a la aplicación: RR. HH. registra su respuesta y queda constancia en el historial.')}</div>}
                </div>
              )}
              {hrDecides && (
                <Button variant="accent" icon={CheckCheck} onClick={() => setDialog('apply')}>
                  {t('Aplicar con discrepancia')}
                </Button>
              )}
              {canWithdraw && (
                <Button variant="ghost" icon={Undo2} onClick={() => setDialog('withdraw')}>
                  {c.initiatedBy === 'company' ? t('Retirar propuesta') : t('Retirar')}
                </Button>
              )}
              {!reviewer && !canRespond && !hrDecides && !canWithdraw && (
                <p className="small muted">
                  {active
                    ? c.status === 'pending'
                      ? t('Pendiente de revisión por la persona supervisora o RR. HH.')
                      : c.employeeResponse
                        ? t('Pendiente de la decisión de RR. HH. tras la discrepancia del empleado.')
                        : t('Pendiente de la conformidad del empleado.')
                    : t('Solicitud cerrada: la decisión es definitiva y no puede repetirse. Para un nuevo cambio, cree otra solicitud.')}
                </p>
              )}
              {active && <p className="tiny muted">{notifiedText}</p>}
            </div>
          </Card>
          <Callout tone="neutral" title={t('Trazabilidad')}>
            {t('Se conservan los valores original, solicitado y aprobado, quién revisó, cuándo y por qué. Las aprobaciones resuelven las incidencias del registro y mantienen su historial.')}
          </Callout>
        </div>
      </div>

      {dialog === 'approve' && emp && <ApproveDialog c={c} employee={emp} tz={tz} hasApp={hasApp} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && (
        <NoteDialog
          title={t('Rechazar la corrección')}
          danger
          label={t('Motivo del rechazo')}
          minLength={5}
          confirmLabel={t('Rechazar')}
          hint={t('El empleado verá este motivo.')}
          message={<p className="small">{t('El registro se mantiene con sus valores actuales. El motivo queda registrado en la solicitud y en la auditoría.')}</p>}
          onConfirm={async (note) => !!(await run(() => reviewCorrection(c.id, 'reject', note), hasApp ? t('Corrección rechazada. Se ha notificado al empleado.') : t('Corrección rechazada. Comunique el resultado al empleado.')))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'agree' && (
        <NoteDialog
          title={t('Dar conformidad a la propuesta')}
          label={t('Comentario (opcional)')}
          confirmLabel={t('Dar conformidad')}
          message={<p className="small">{t('Al dar su conformidad, los valores propuestos se aplican como corrección de su registro. Los fichajes originales se conservan.')}</p>}
          onConfirm={async (note) => !!(await run(() => respondToProposal(c.id, true, note), t('Conformidad registrada: la corrección se ha aplicado.')))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'disagree' && (
        <NoteDialog
          title={t('Manifestar discrepancia')}
          danger
          label={t('Explique su discrepancia')}
          minLength={5}
          confirmLabel={t('Registrar discrepancia')}
          message={<p className="small">{t('Su registro no cambia. Queda constancia de su discrepancia y RR. HH. decidirá si retira la propuesta o la aplica informando a la representación legal de los trabajadores.')}</p>}
          onConfirm={async (note) => !!(await run(() => respondToProposal(c.id, false, note), t('Discrepancia registrada. RR. HH. ha sido notificado.')))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'apply' && (
        <NoteDialog
          title={t('Aplicar con discrepancia')}
          label={t('Motivo y cómo se ha informado a la representación legal de los trabajadores')}
          minLength={10}
          confirmLabel={t('Aplicar con discrepancia')}
          placeholder={t('Ej.: Se aplica según el parte firmado; se ha informado al delegado de personal el …')}
          message={
            <div className="stack-sm">
              <p className="small">{t('La corrección se aplicará con los valores propuestos y la discrepancia del empleado quedará registrada junto a ella.')}</p>
              <Callout tone="warning">{t('Informe a la representación legal de los trabajadores e indique en la nota cuándo y cómo se ha hecho.')}</Callout>
            </div>
          }
          onConfirm={async (note) => !!(await run(() => applyWithDisagreement(c.id, note), hasApp ? t('Corrección aplicada con la discrepancia registrada. Se ha notificado al empleado.') : t('Corrección aplicada con la discrepancia registrada.')))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'withdraw' && (
        <NoteDialog
          title={c.initiatedBy === 'company' ? t('Retirar la propuesta') : t('Retirar la solicitud')}
          label={t('Nota (opcional)')}
          confirmLabel={c.initiatedBy === 'company' ? t('Retirar propuesta') : t('Retirar')}
          message={<p className="small">{t('La solicitud queda como «Retirada» y no se aplica ningún cambio. El historial se conserva.')}</p>}
          onConfirm={async (note) => !!(await run(() => withdrawCorrection(c.id, note), t('Solicitud retirada.')))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** Reviewer approval: requested values prefilled, adjustable ("valores aprobados"), with warnings. */
function ApproveDialog({ c, employee, tz, hasApp, onClose }: { c: CorrectionRequest; employee: Employee; tz: string; hasApp: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const db = ctx.db;
  const { run, pending } = useAction();
  const [state, setState] = useState<EditorState>(() => stateFromValues(c.requested, c.date, tz, c.requested.worksiteId ?? employee.primaryWorksiteId));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const nameOf = worksiteNamer(db);

  const conv = toValues(state, tz);
  let check: ValuesCheck = { errors: [], warnings: [] };
  try {
    check = checkValues(ctx, c.employeeId, conv.values, c.sessionId);
  } catch {
    check = { errors: ['Empleado no disponible.'], warnings: [] };
  }
  const errors = [...conv.errors, ...check.errors.map((e) => t(e))];
  const adjusted = !sameValues(conv.values, c.requested);
  const allowRemote = relationshipOn(db, c.employeeId, state.date)?.remoteAllowed ?? false;

  const submit = async () => {
    setTried(true);
    if (errors.length || pending) return;
    const r = await run(
      () => reviewCorrection(c.id, 'approve', note.trim(), adjusted ? conv.values : undefined),
      hasApp ? t('Corrección aprobada. Se ha notificado al empleado.') : t('Corrección aprobada. Comunique el resultado al empleado.'),
    );
    if (r) onClose();
  };

  return (
    <Modal
      wide
      title={t('Aprobar la corrección')}
      description={t('Los valores aprobados se aplican como una capa sobre los fichajes originales, que se conservan.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon={Check} onClick={submit} loading={pending}>
            {adjusted ? t('Aprobar con valores ajustados') : t('Aprobar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="corr-form-grid">
          <div className="stack">
            <div className="strong">{t('Valores aprobados')}</div>
            <ValuesEditor state={state} onChange={setState} tz={tz} employee={employee} worksites={db.worksites.filter((w) => w.companyId === ctx.company.id)} allowRemote={allowRemote} disabledDate={!!c.sessionId} />
            {adjusted && <Badge tone="warning">{t('Distintos de los solicitados: se conservarán ambos')}</Badge>}
          </div>
          <aside className="corr-original stack" aria-label={t('Valores de referencia')}>
            <div className="stack-sm">
              <div className="strong small">{t('Original')}</div>
              <ValuesFields values={c.original} tz={tz} worksiteName={nameOf} paidBreakKinds={[]} empty={t('Sin registro original: jornada no registrada.')} />
            </div>
            <div className="stack-sm">
              <div className="strong small">{c.initiatedBy === 'company' ? t('Propuesto') : t('Solicitado')}</div>
              <ValuesFields values={c.requested} tz={tz} compareTo={c.original} changedLabel={t('cambia')} worksiteName={nameOf} paidBreakKinds={[]} empty="—" />
            </div>
            <div className="tiny corr-quote">{c.explanation}</div>
          </aside>
        </div>
        {check.warnings.length > 0 && (
          <Callout tone="warning" title={t('Avisos para la revisión')}>
            <ul>
              {check.warnings.map((w, i) => (
                <li key={i}>{t(w)}</li>
              ))}
            </ul>
          </Callout>
        )}
        {(tried || conv.errors.length > 0) && errors.length > 0 && (
          <Callout tone="danger" title={t('Los valores aprobados no son válidos')}>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Callout>
        )}
        <TextAreaField label={t('Nota de la decisión (opcional)')} rows={3} value={note} onChange={(e) => setNote(e.target.value)} hint={t('El empleado verá esta nota junto a la decisión.')} />
        <p className="tiny muted">{hasApp ? t('El resultado se notifica al empleado en la aplicación.') : t('El empleado no tiene acceso a la aplicación: comuníquele el resultado por el canal habitual.')}</p>
      </div>
    </Modal>
  );
}
