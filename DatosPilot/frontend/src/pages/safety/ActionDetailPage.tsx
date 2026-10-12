/**
 * Detail of one preventive action: data, workflow (assign → progress → evidence → submit →
 * review by the configured authority → resolved / reopened), evidence with its own review status,
 * the action timeline and the audit trail. Uploading evidence never closes an action, and the
 * owner can never accept their own action.
 */
import { CheckCircle2, ClipboardList, FileText, MessageSquarePlus, RotateCcw, Send, Upload, UserCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { DocStatusBadge, EmployeeLink, KindDate, WorksiteLink } from '../../components/bits';
import { FilePicker } from '../../components/FilePicker';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, Modal, PageHeader, SelectField, StatusBadge, TextAreaField, TextField, useAction, useToast } from '../../components/ui';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { ACTION_STATUS, PRIORITY } from '../../domain/status';
import { formatInstant, isValidISODate } from '../../domain/time';
import type { DemoFile, PreventiveAction } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { canSeeDocument, roleName, userName } from '../../services/context';
import { documentState, submitDocument } from '../../services/evidenceService';
import { addProgress, assignAction, canReviewAction, reopenAction, reviewAction, submitAction, visibleActions } from '../../services/safetyService';
import { useCtx } from '../../store/hooks';
import { ACTION_SOURCE_LABEL, companyUsers, ErrorList, isOverdue, NOTE_KIND_LABEL } from './shared';

type DialogKind = 'assign' | 'progress' | 'evidence' | 'submit' | 'accept' | 'reject' | 'reopen';
const WORKING: PreventiveAction['status'][] = ['assigned', 'in_progress', 'reopened'];

const NEXT_STEP: Record<PreventiveAction['status'], string> = {
  open: tKey('Asignar un responsable y, si procede, una fecha objetivo justificada.'),
  assigned: tKey('El responsable registra avances, aporta la evidencia y la envía a revisión.'),
  in_progress: tKey('Aportar la evidencia requerida y enviar la acción a revisión.'),
  pending_review: tKey('La autoridad de revisión acepta o rechaza la resolución.'),
  resolved: tKey('Resuelta. Si el problema reaparece, puede reabrirse con motivo.'),
  reopened: tKey('Corregir lo indicado y volver a enviarla a revisión.'),
};

export function ActionDetailPage() {
  const { id = '' } = useParams();
  const ctx = useCtx();
  const { runOk } = useAction();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const a = visibleActions(ctx).find((x) => x.id === id);
  if (!a) {
    return (
      <>
        <PageHeader title={t('Acción preventiva')} breadcrumbs={<Link to="/acciones">{t('Acciones preventivas')}</Link>} />
        <RecordNotFound back="/acciones" label={tKey('Acciones preventivas')} />
      </>
    );
  }

  const canManage = ctx.can('actions.manage');
  const isOwner = a.ownerUserId === ctx.user.id;
  const canWork = (isOwner || canManage) && WORKING.includes(a.status);
  // The owner may attach evidence for their own action even without the general upload permission.
  const canUpload = ctx.can('evidence.upload') || isOwner;
  const canReview = a.status === 'pending_review' && canReviewAction(ctx, a);
  const overdue = isOverdue(a, ctx.today);
  const evidence = a.evidenceDocumentIds.map((docId) => ctx.db.documents.find((d) => d.id === docId)).filter((d): d is NonNullable<typeof d> => !!d);
  const visibleEvidence = evidence.filter((d) => canSeeDocument(ctx, d));
  const hiddenEvidence = evidence.length - visibleEvidence.length;
  const usableEvidence = evidence.filter((d) => {
    const st = documentState(ctx, d.id).latest?.status;
    return !!st && st !== 'rejected' && st !== 'superseded';
  });
  const missingEvidence = a.evidenceRequired && usableEvidence.length === 0;
  const notes = [...a.notes].sort((x, y) => y.at.localeCompare(x.at));
  const sourceLink = a.source.refId ? (a.source.kind === 'risk_assessment' ? `/evaluaciones/${a.source.refId}` : a.source.kind === 'cae' ? `/cae/${a.source.refId}` : a.source.kind === 'requirement_gap' ? `/requisitos/${a.source.refId}` : null) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={<Link to="/acciones">{t('Acciones preventivas')}</Link>}
        title={a.title}
        subtitle={
          <span className="row-wrap">
            <span className="strong">{a.code}</span>
            <StatusBadge meta={ACTION_STATUS[a.status]} />
            <StatusBadge meta={PRIORITY[a.priority]} prefix={tKey('Prioridad')} />
            {overdue && <Badge tone="danger">{t('Fecha objetivo vencida')}</Badge>}
          </span>
        }
      />
      <div className="stack">
        {a.affectsReadiness && a.status !== 'resolved' && (
          <Callout tone="info" title={t('Condiciona la disponibilidad')}>
            {t('Según la política aprobada por el servicio de prevención, mientras esta acción siga abierta el ámbito afectado no figura como listo según los requisitos configurados.')}
          </Callout>
        )}
        {a.status === 'reopened' && notes.find((n) => n.kind === 'rejected' || n.kind === 'reopened') && (
          <Callout tone="warning" title={t(ACTION_STATUS.reopened.label)}>
            {t(notes.find((n) => n.kind === 'rejected' || n.kind === 'reopened')!.text)}
          </Callout>
        )}

        <div className="grid-main-side">
          <div className="stack">
            <Card title={t('Datos de la acción')}>
              <div className="sf-kv">
                <KV
                  items={[
                    [t('Código'), a.code],
                    [t('Descripción'), a.description || <span className="muted">—</span>],
                    [
                      t('Origen [acción]'),
                      <span className="stack-sm" style={{ gap: 0 }}>
                        <span>{t(ACTION_SOURCE_LABEL[a.source.kind])}</span>
                        {a.source.label && <span className="small">{sourceLink ? <Link to={sourceLink}>{a.source.label}</Link> : a.source.label}</span>}
                      </span>,
                    ],
                    [t('Persona afectada'), a.employeeId ? <EmployeeLink id={a.employeeId} /> : <span className="muted">—</span>],
                    [t('Puesto'), a.jobRoleId ? roleName(ctx.db, a.jobRoleId) : <span className="muted">—</span>],
                    [t('Centro de trabajo'), a.worksiteId ? <WorksiteLink id={a.worksiteId} /> : <span className="muted">—</span>],
                    [t('Prioridad'), <StatusBadge meta={PRIORITY[a.priority]} />],
                    [t('Responsable'), a.ownerUserId ? userName(ctx.db, a.ownerUserId) : <span className="muted">{t('Sin asignar')}</span>],
                    [
                      t('Fecha objetivo'),
                      <span className="stack-sm" style={{ gap: 0 }}>
                        <KindDate kind="target" date={a.targetDate} today={a.status !== 'resolved' ? ctx.today : undefined} />
                        {a.targetJustification && <span className="tiny muted">{t('Justificación: {text}', { text: a.targetJustification })}</span>}
                      </span>,
                    ],
                    [t('Autoridad de revisión'), t(AUTHORITY_LABEL[a.reviewAuthority])],
                    [t('Evidencia exigida'), a.evidenceRequired ? a.requiredEvidence || <span className="muted">—</span> : <span className="muted">{t('No se exige evidencia para cerrarla')}</span>],
                    [t('Condiciona la disponibilidad'), a.affectsReadiness ? t('Sí') : t('No')],
                    [t('Resolución propuesta'), a.resolutionNote || <span className="muted">—</span>],
                    [t('Fecha de creación'), <span>{userName(ctx.db, a.createdBy)} · <DateTimeText at={a.createdAt} /></span>],
                    [t('Fecha de resolución'), a.resolvedAt ? <DateTimeText at={a.resolvedAt} /> : <span className="muted">—</span>],
                  ]}
                />
              </div>
            </Card>

            <Card
              title={t('Evidencia aportada')}
              flush
              actions={
                (isOwner || canManage) &&
                a.status !== 'resolved' &&
                a.status !== 'pending_review' &&
                canUpload && (
                  <Button size="sm" icon={Upload} onClick={() => setDialog('evidence')}>
                    {t('Aportar evidencia')}
                  </Button>
                )
              }
            >
              {visibleEvidence.length === 0 ? (
                <EmptyState icon={FileText} title={hiddenEvidence ? t('Evidencia no visible para su rol') : t('Sin evidencia aportada')}>
                  {a.evidenceRequired ? t('Se exige: {text}', { text: a.requiredEvidence || '—' }) : t('Esta acción no exige evidencia para enviarla a revisión.')}
                </EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('Documento')}</th>
                        <th>{t('Recibido')}</th>
                        <th>{t('Estado de la revisión')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEvidence.map((d) => {
                        const latest = documentState(ctx, d.id).latest;
                        return (
                          <tr key={d.id}>
                            <td style={{ minWidth: 220 }}>
                              <Link to={`/documentacion/${d.id}`}>
                                {d.code} · {d.title}
                              </Link>
                            </td>
                            <td className="small">{latest ? <DateTimeText at={latest.receivedAt} /> : <span className="muted">—</span>}</td>
                            <td>{latest ? <DocStatusBadge status={latest.status} /> : <span className="muted">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="card-footer tiny muted">
                {hiddenEvidence > 0 && <div>{t('{n} documentos de evidencia no son visibles para su rol.', { n: hiddenEvidence })}</div>}
                {t('La evidencia se revisa como cualquier documento. Aportarla no cierra la acción: la cierra la autoridad de revisión al aceptar la resolución.')}
              </div>
            </Card>

            <Card title={t('Cronología de la acción')}>
              {notes.length === 0 ? (
                <EmptyState icon={ClipboardList} title={t('Sin anotaciones')} />
              ) : (
                <ol className="timeline">
                  {notes.map((n, i) => (
                    <li key={i}>
                      <div className="row between" style={{ gap: 8 }}>
                        <span className="what">{t(NOTE_KIND_LABEL[n.kind])}</span>
                        <span className="when nowrap">{formatInstant(n.at)}</span>
                      </div>
                      <div className="small">{t(n.text)}</div>
                      <div className="tiny muted">{userName(ctx.db, n.by)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div className="stack">
            <Card title={t('Siguiente paso')}>
              <div className="stack-sm">
                <p className="small">{t(NEXT_STEP[a.status])}</p>
                {canManage && ['open', 'assigned', 'in_progress', 'reopened'].includes(a.status) && (
                  <Button variant={a.status === 'open' ? 'primary' : 'secondary'} icon={UserCheck} onClick={() => setDialog('assign')}>
                    {a.ownerUserId ? t('Reasignar o cambiar la fecha') : t('Asignar responsable')}
                  </Button>
                )}
                {canWork && (
                  <>
                    <Button icon={MessageSquarePlus} onClick={() => setDialog('progress')}>
                      {t('Registrar avance')}
                    </Button>
                    {canUpload ? (
                      <Button icon={Upload} onClick={() => setDialog('evidence')}>
                        {t('Aportar evidencia')}
                      </Button>
                    ) : (
                      <p className="tiny muted">{t('Su rol no permite subir documentos. Pida a la coordinación de PRL que incorpore la evidencia.')}</p>
                    )}
                    <Button variant="primary" icon={Send} onClick={() => setDialog('submit')}>
                      {t('Enviar a revisión')}
                    </Button>
                    {missingEvidence && <p className="tiny" style={{ color: 'var(--warning)' }}>{t('Falta la evidencia requerida: no podrá enviarla a revisión hasta aportarla.')}</p>}
                  </>
                )}
                {a.status === 'pending_review' &&
                  (canReview ? (
                    <>
                      <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog('accept')}>
                        {t('Aceptar la resolución')}
                      </Button>
                      <Button variant="danger-outline" icon={XCircle} onClick={() => setDialog('reject')}>
                        {t('Rechazar y reabrir')}
                      </Button>
                    </>
                  ) : (
                    <p className="small muted">
                      {isOwner ? t('Es el responsable: no puede aceptar su propia acción.') : t('Decide la autoridad de revisión: {authority}.', { authority: t(AUTHORITY_LABEL[a.reviewAuthority]) })}
                    </p>
                  ))}
                {a.status === 'resolved' && canManage && (
                  <Button icon={RotateCcw} onClick={() => setDialog('reopen')}>
                    {t('Reabrir')}
                  </Button>
                )}
                {!canManage && !isOwner && !canReview && <p className="tiny muted">{t('Consulta en modo de solo lectura.')}</p>}
              </div>
            </Card>
            <Card title={t('Historial de auditoría')}>
              <AuditList filter={(e) => e.entityId === a.id} limit={30} />
            </Card>
          </div>
        </div>
      </div>

      {dialog === 'assign' && <AssignDialog action={a} onClose={() => setDialog(null)} />}
      {dialog === 'progress' && <ProgressDialog action={a} onClose={() => setDialog(null)} />}
      {dialog === 'evidence' && <EvidenceDialog action={a} onClose={() => setDialog(null)} />}
      {dialog === 'submit' && <SubmitDialog action={a} missingEvidence={missingEvidence} onClose={() => setDialog(null)} />}
      {(dialog === 'accept' || dialog === 'reject') && <ReviewDialog action={a} decision={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'reopen' && (
        <ConfirmDialog
          title={t('Reabrir la acción')}
          message={t('La acción vuelve a estar abierta y se notificará en el historial. Indique por qué (por ejemplo, el problema ha reaparecido).')}
          confirmLabel={t('Reabrir')}
          requireReason
          reasonLabel={t('Motivo de la reapertura (queda registrado)')}
          onConfirm={(reason) => runOk(() => reopenAction(a.id, reason), t('Acción reabierta'))}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────── Dialogs ───────────────────────────────

function AssignDialog({ action: a, onClose }: { action: PreventiveAction; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const users = companyUsers(ctx);
  const [owner, setOwner] = useState(a.ownerUserId ?? '');
  const [date, setDate] = useState(a.targetDate ?? '');
  const [why, setWhy] = useState('');
  const [touched, setTouched] = useState(false);
  const errs = {
    owner: !owner ? t('Obligatorio.') : undefined,
    date: date && !isValidISODate(date) ? t('Fecha no válida.') : date && date < ctx.today ? t('La fecha objetivo no puede estar en el pasado.') : undefined,
    why: date && !why.trim() ? t('Justifique la fecha objetivo: no se fijan plazos sin base.') : undefined,
  };
  const submit = async () => {
    setTouched(true);
    if (errs.owner || errs.date || errs.why) return;
    const r = await run(() => assignAction(a.id, owner, date || null, why), t('Responsable asignado'));
    if (r) onClose();
  };
  return (
    <Modal
      title={a.ownerUserId ? t('Reasignar o cambiar la fecha') : t('Asignar responsable')}
      description={`${a.code} · ${a.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Asignar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <SelectField label={t('Responsable')} required value={owner} onChange={(e) => setOwner(e.target.value)} error={touched ? errs.owner : undefined}>
          <option value="">{t('Seleccione…')}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
        <TextField label={t('Fecha objetivo')} type="date" min={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? errs.date : undefined} hint={t('Opcional. Si la fija, indique en qué se basa (plazo del servicio de prevención, acuerdo CAE, disponibilidad del proveedor…).')} />
        <TextAreaField label={t('Justificación de la fecha')} required={!!date} rows={3} value={why} onChange={(e) => setWhy(e.target.value)} error={touched ? errs.why : undefined} />
        {a.reviewAuthority && <p className="tiny muted">{t('Quien sea responsable no podrá aceptar su propia acción: la resolución la acepta {authority}.', { authority: t(AUTHORITY_LABEL[a.reviewAuthority]) })}</p>}
      </div>
    </Modal>
  );
}

function ProgressDialog({ action: a, onClose }: { action: PreventiveAction; onClose: () => void }) {
  const { run, pending } = useAction();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = async () => {
    setTouched(true);
    if (!text.trim()) return;
    const r = await run(() => addProgress(a.id, text), t('Avance registrado'));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Registrar avance')}
      description={`${a.code} · ${a.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Registrar avance')}
          </Button>
        </>
      }
    >
      <TextAreaField label={t('Qué se ha hecho')} required rows={4} value={text} onChange={(e) => setText(e.target.value)} error={touched && !text.trim() ? t('Obligatorio.') : undefined} hint={t('No incluya datos de salud de personas concretas.')} />
    </Modal>
  );
}

function EvidenceDialog({ action: a, onClose }: { action: PreventiveAction; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const { run, pending } = useAction();
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState(ctx.company.legalName);
  const [issueDate, setIssueDate] = useState(ctx.today);
  const [file, setFile] = useState<DemoFile | null>(null);
  const [notes, setNotes] = useState('');
  const [clinical, setClinical] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const submit = async () => {
    const errs: string[] = [];
    if (!title.trim()) errs.push('Título: obligatorio.');
    if (!issuer.trim()) errs.push('Emisor: obligatorio.');
    if (issueDate && issueDate > ctx.today) errs.push('La fecha de emisión no puede ser futura.');
    setErrors(errs);
    if (errs.length) return;
    const r = await run(
      () =>
        submitDocument({
          categoryId: 'evidencia_accion',
          actionId: a.id,
          employeeId: null,
          worksiteId: a.worksiteId,
          templateId: null,
          title,
          issuer,
          issueDate: issueDate || null,
          expiryMode: 'none',
          legalExpiryDate: null,
          providerReviewDate: null,
          internalFollowUpDate: null,
          file,
          containsClinical: clinical,
          sourceReference: a.code,
          notes,
        }),
      (res) => (res.quarantined ? null : t('Evidencia recibida y pendiente de revisión. La acción sigue abierta.')),
    );
    if (r) {
      if (r.quarantined) toast.warning(t('Archivo enviado a cuarentena: no se ha vinculado a la acción'), [t('Lo gestionará el personal sanitario autorizado.')]);
      onClose();
    }
  };
  return (
    <Modal
      wide
      title={t('Aportar evidencia')}
      description={`${a.code} · ${a.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" icon={Upload} loading={pending} onClick={submit}>
            {t('Enviar evidencia')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="warning" title={t('Subir la evidencia no cierra la acción')}>
          {t('El documento queda «Recibido» y lo revisa la persona revisora. La acción se cierra solo cuando la autoridad de revisión acepta la resolución.')}
        </Callout>
        {a.evidenceRequired && a.requiredEvidence && <Callout tone="info">{t('Se exige: {text}', { text: a.requiredEvidence })}</Callout>}
        <ErrorList errors={errors} />
        <div className="form-grid">
          <TextField className="span-2" label={t('Título del documento')} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Por ejemplo, foto de la señalización instalada')} />
          <TextField label={t('Emisor')} required value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          <TextField label={t('Fecha del documento')} type="date" max={ctx.today} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          <TextAreaField className="span-all" label={t('Notas')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <FilePicker value={file} onChange={setFile} />
        <Checkbox label={t('El archivo puede contener información clínica')} checked={clinical} onChange={setClinical} hint={t('Si lo marca, el archivo va a cuarentena y no se incorpora a la acción. No suba informes médicos.')} />
      </div>
    </Modal>
  );
}

function SubmitDialog({ action: a, missingEvidence, onClose }: { action: PreventiveAction; missingEvidence: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = async () => {
    setTouched(true);
    if (!text.trim()) return;
    const r = await run(() => submitAction(a.id, text), t('Acción enviada a revisión'));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Enviar a revisión')}
      description={`${a.code} · ${a.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" icon={Send} loading={pending} onClick={submit}>
            {t('Enviar a revisión')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {missingEvidence ? (
          <ErrorList title={t('No se puede enviar a revisión')} errors={[t('Falta la evidencia requerida: {text}', { text: a.requiredEvidence || '—' })]} />
        ) : (
          <Callout tone="info">{t('La revisará: {authority}. La acción no se cierra hasta que acepte la resolución.', { authority: t(AUTHORITY_LABEL[a.reviewAuthority]) })}</Callout>
        )}
        <TextAreaField label={t('Resolución')} required rows={4} value={text} onChange={(e) => setText(e.target.value)} error={touched && !text.trim() ? t('Obligatorio.') : undefined} hint={t('Describa qué se ha hecho para resolverla.')} />
      </div>
    </Modal>
  );
}

function ReviewDialog({ action: a, decision, onClose }: { action: PreventiveAction; decision: 'accept' | 'reject'; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const accept = decision === 'accept';
  const pendingDocs = a.evidenceDocumentIds.filter((id) => {
    const st = documentState(ctx, id).latest?.status;
    return st === 'received' || st === 'in_review';
  }).length;
  const submit = async () => {
    setTouched(true);
    if (!note.trim()) return;
    const r = await run(() => reviewAction(a.id, decision, note), accept ? t('Resolución aceptada: acción resuelta') : t('Resolución rechazada: acción reabierta'));
    if (r) onClose();
  };
  return (
    <Modal
      title={accept ? t('Aceptar la resolución') : t('Rechazar y reabrir')}
      description={`${a.code} · ${a.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant={accept ? 'primary' : 'danger'} loading={pending} onClick={submit}>
            {accept ? t('Aceptar la resolución') : t('Rechazar y reabrir')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {a.resolutionNote && (
          <Callout tone="neutral" title={t('Resolución propuesta')}>
            {a.resolutionNote}
          </Callout>
        )}
        {accept && pendingDocs > 0 && <Callout tone="warning">{t('Hay {n} documentos de evidencia sin revisar. Aceptar la acción no acepta esos documentos: revíselos en Documentación.', { n: pendingDocs })}</Callout>}
        {accept && <p className="small muted">{t('Aceptar resuelve la acción. No certifica que el centro sea seguro ni que se cumpla la normativa.')}</p>}
        <TextAreaField label={t('Nota de revisión (queda registrada)')} required rows={4} value={note} onChange={(e) => setNote(e.target.value)} error={touched && !note.trim() ? t('Obligatorio.') : undefined} />
        <p className="tiny muted">
          {t('Persona revisora')}: {ctx.user.name} · <DateText date={ctx.today} />
        </p>
      </div>
    </Modal>
  );
}
