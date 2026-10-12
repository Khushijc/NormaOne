/**
 * Absence detail (/ausencias/:id): request data (masked for sensitive categories), evidence,
 * history, conflicts and the actions allowed by status and role. Nobody reviews their own
 * absence; approving never creates attendance.
 */
import { Ban, Check, CheckCheck, Pencil, Send, Undo2, Upload, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { EmployeeLink, msg } from '../../components/bits';
import { RecordNotFound } from '../../components/guards';
import { Button, Callout, Card, Checkbox, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, Modal, PageHeader, StatusBadge, TextAreaField, useAction } from '../../components/ui';
import { ABSENCE_STATUS, ABSENCE_TRANSITIONS, canTransition } from '../../domain/status';
import { formatDate, formatDateLong } from '../../domain/time';
import type { AbsenceRequest, AbsenceStatus } from '../../domain/types';
import { t, tKey } from '../../i18n';
import {
  absenceTypeLabel,
  addAbsenceAttachment,
  conflictsFor,
  countDays,
  decideCancellation,
  requestCancellation,
  reviewAbsence,
  saveAbsence,
  visibleAbsences,
  withdrawAbsence,
} from '../../services/absenceService';
import { canReview, employeeName, userName } from '../../services/context';
import { useCtx, type UiCtx } from '../../store/hooks';
import { AbsenceForm } from './AbsenceForm';
import { AttachmentList, CONFLICT_LABEL, EVIDENCE_LABEL, EVIDENCE_TYPES, HISTORY_LABEL, MASKED_NOTE, MAX_EVIDENCE_BYTES, PAID_LABEL, canOpenEvidence, readAsDataUrl, seesDetail, typeOf } from './absenceUi';

const SECTION_LABEL = tKey('Ausencias');

type Dialog = null | 'approve' | 'reject' | 'cancel_accept' | 'cancel_deny' | 'cancel_direct' | 'withdraw' | 'request_cancel' | 'edit';

export function AbsenceDetailPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const [dialog, setDialog] = useState<Dialog>(null);
  const { run, runOk, pending } = useAction();

  const a = visibleAbsences(ctx).find((x) => x.id === id);
  if (!a) return <RecordNotFound back="/ausencias" label={SECTION_LABEL} />;

  const type = typeOf(ctx, a);
  const detail = seesDetail(ctx, a);
  const isOwner = ctx.employee?.id === a.employeeId;
  const isCreator = a.createdBy === ctx.user.id;
  const reviewer = !isOwner && canReview(ctx, a.employeeId, 'absences');
  const can = (to: AbsenceStatus) => canTransition(ABSENCE_TRANSITIONS, a.status, to);
  const tz = ctx.company.timezone;
  const name = employeeName(ctx.db, a.employeeId);
  const emp = ctx.db.employees.find((e) => e.id === a.employeeId);
  const byHr = a.createdBy !== emp?.userId;

  const canApprove = reviewer && a.status === 'pending' && can('approved');
  const canReject = reviewer && a.status === 'pending' && can('rejected');
  const canDecideCancel = reviewer && a.status === 'cancel_requested';
  const canCancelDirect = reviewer && ctx.can('absences.review_all') && a.status === 'approved' && can('cancelled');
  const ownerOrCreator = isOwner || isCreator;
  const canEditDraft = ownerOrCreator && a.status === 'draft';
  const canWithdraw = ownerOrCreator && can('withdrawn');
  const canRequestCancel = isOwner && a.status === 'approved' && can('cancel_requested') && a.startDate > ctx.today;
  const anyAction = canApprove || canReject || canDecideCancel || canCancelDirect || canEditDraft || canWithdraw || canRequestCancel;

  const workingDays = countDays(ctx, a.employeeId, a.startDate, a.endDate, 'working');
  const naturalDays = countDays(ctx, a.employeeId, a.startDate, a.endDate, 'natural');
  const attachments = ctx.db.attachments.filter((x) => x.ownerId === a.id && x.companyId === ctx.company.id);
  const showConflicts = ['draft', 'pending', 'approved', 'cancel_requested'].includes(a.status);
  const conflicts = showConflicts ? conflictsFor(ctx, a) : [];

  const submitDraft = () =>
    run(
      () => saveAbsence({ employeeId: a.employeeId, typeId: a.typeId, startDate: a.startDate, endDate: a.endDate, partial: a.partial, note: a.note }, true, a.id),
      (r) => (r.status === 'approved' ? t('Ausencia registrada: este tipo no requiere aprobación') : t('Solicitud enviada para revisión')),
    );

  return (
    <div className="stack-lg">
      <PageHeader
        breadcrumbs={<Link to="/ausencias">{t('Ausencias')}</Link>}
        title={t('Ausencia de {name}', { name })}
        subtitle={
          <>
            <span className={detail ? undefined : 'muted'}>{t(absenceTypeLabel(ctx, a))}</span> · <DateText date={a.startDate} />
            {a.endDate !== a.startDate && (
              <>
                {' → '}
                <DateText date={a.endDate} />
              </>
            )}
          </>
        }
        actions={<StatusBadge meta={ABSENCE_STATUS[a.status]} prefix="Estado" />}
      />

      {isOwner && (a.status === 'pending' || a.status === 'cancel_requested') && (
        <Callout tone="neutral">{t('No puede aprobar ni rechazar sus propias ausencias: decide su responsable o RR. HH.')}</Callout>
      )}

      <div className="grid-main-side">
        <div className="stack">
          <Card title={t('Solicitud')}>
            <KV
              items={[
                [t('Empleado'), <EmployeeLink key="e" id={a.employeeId} />],
                [t('Categoría'), <span key="c" className={detail ? undefined : 'muted'}>{t(absenceTypeLabel(ctx, a))}</span>],
                [t('Referencia legal'), detail ? (type?.legalReference ? t(type.legalReference) : '—') : <span key="l" className="muted">{t(MASKED_NOTE)}</span>],
                ...(detail && type
                  ? ([
                      [t('Retribución'), t(PAID_LABEL[type.paid])],
                      [t('Duración de referencia'), type.referenceDuration ? <span key="d">{t(type.referenceDuration)} <span className="muted small">({t('referencia mínima legal; revise su convenio')})</span></span> : '—'],
                    ] as [string, ReactNode][])
                  : []),
                [t('Fechas'), <span key="f">{formatDateLong(a.startDate)}{a.endDate !== a.startDate ? ` → ${formatDateLong(a.endDate)}` : ''}</span>],
                ...(a.partial ? ([[t('Franja horaria'), t('Por horas: {from}–{to} (hora local del centro)', { from: a.partial.startTime, to: a.partial.endTime })]] as [string, ReactNode][]) : []),
                [t('Días computados'), a.partial ? t('Parte de una jornada') : t('Laborables: {w} · naturales: {n}', { w: workingDays, n: naturalDays })],
                [t('Estado'), <span key="s">{t(ABSENCE_STATUS[a.status].label)} <span className="muted small">· {t(ABSENCE_STATUS[a.status].help)}</span></span>],
                [t('Creada'), <span key="cr"><DateTimeText at={a.createdAt} tz={tz} /> · {userName(ctx.db, a.createdBy)}{byHr ? ` (${t('registrada por RR. HH. en nombre de la persona empleada')})` : ''}</span>],
                [t('Enviada'), a.submittedAt ? <DateTimeText key="sb" at={a.submittedAt} tz={tz} /> : '—'],
                [t('Nota'), detail ? (a.note ? <span key="n" className="abs-break">{a.note}</span> : <span key="n" className="muted">{t('Sin nota')}</span>) : <span key="n" className="muted">{t(MASKED_NOTE)}</span>],
                [t('Revisor'), a.reviewerId ? userName(ctx.db, a.reviewerId) : '—'],
                [t('Decisión'), a.decidedAt ? <DateTimeText key="dd" at={a.decidedAt} tz={tz} /> : '—'],
                [t('Motivo de la decisión'), a.decisionReason ? (detail ? t(a.decisionReason) : <span key="dr" className="muted">{t(MASKED_NOTE)}</span>) : '—'],
              ]}
            />
          </Card>

          <Callout tone="info">
            {t('Esta ausencia no crea ni modifica fichajes. Los registros de jornada y los turnos planificados se conservan tal como están; las diferencias se revisan en Incidencias.')}
          </Callout>

          {showConflicts && (
            <Card title={t('Comprobación de calendario')}>
              <div className="stack-sm">
                {conflicts.length === 0 ? (
                  <p className="small muted" style={{ margin: 0 }}>{t('Sin turnos planificados, registros de trabajo, ausencias del equipo ni festivos en estas fechas.')}</p>
                ) : (
                  conflicts.map((c) => (
                    <Callout key={c.code} tone={c.severity === 'warning' ? 'warning' : 'info'}>
                      {msg(c.message)}
                    </Callout>
                  ))
                )}
                {a.acknowledgedConflicts.length > 0 && (
                  <div>
                    <div className="small strong">{t('Avisos confirmados por el revisor al aprobar')}</div>
                    <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {a.acknowledgedConflicts.map((code) => (
                        <li key={code}>{CONFLICT_LABEL[code] ? t(CONFLICT_LABEL[code]) : code}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}

          {detail && type && (type.evidence !== 'none' || attachments.length > 0) && (
            <Card title={t('Justificantes')}>
              <div className="stack-sm">
                <p className="small muted" style={{ margin: 0 }}>
                  {t(EVIDENCE_LABEL[type.evidence])} · {t('Acceso restringido: solo la persona empleada, quien revisa la solicitud y RR. HH. pueden abrir el archivo.')}
                </p>
                <AttachmentList items={attachments} canOpen={canOpenEvidence(ctx, a)} tz={tz} />
                {type.evidence !== 'none' && (a.status === 'draft' || a.status === 'pending') && (isOwner || ctx.can('absences.review_all')) && <EvidenceUpload ctx={ctx} a={a} />}
              </div>
            </Card>
          )}

          <Card title={t('Historial de la solicitud')}>
            {a.history.length === 0 ? (
              <EmptyState title={t('Sin movimientos: borrador no enviado')} />
            ) : (
              <ol className="timeline">
                {a.history.map((h, i) => (
                  <li key={i}>
                    <div className="row between" style={{ gap: 8 }}>
                      <span className="strong">{t(HISTORY_LABEL[h.action] ?? h.action)}</span>
                      <span className="tiny muted nowrap">
                        <DateTimeText at={h.at} tz={tz} />
                      </span>
                    </div>
                    <div className="tiny muted">{userName(ctx.db, h.by)}</div>
                    {h.note && <div className="tiny abs-break">{detail ? t(h.note) : t(MASKED_NOTE)}</div>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title={t('Acciones')}>
            {!anyAction ? (
              <p className="small muted" style={{ margin: 0 }}>
                {isOwner && a.status === 'approved' && a.startDate <= ctx.today
                  ? t('La ausencia ya ha empezado: para modificarla, contacte con RR. HH.')
                  : t('No hay acciones disponibles para usted en este estado.')}
              </p>
            ) : (
              <div className="stack-sm">
                {canApprove && (
                  <Button variant="primary" icon={Check} onClick={() => setDialog('approve')}>
                    {t('Aprobar')}
                  </Button>
                )}
                {canReject && (
                  <Button variant="danger-outline" icon={X} onClick={() => setDialog('reject')}>
                    {t('Rechazar')}
                  </Button>
                )}
                {canDecideCancel && (
                  <>
                    <Button variant="primary" icon={CheckCheck} onClick={() => setDialog('cancel_accept')}>
                      {t('Aceptar cancelación')}
                    </Button>
                    <Button icon={X} onClick={() => setDialog('cancel_deny')}>
                      {t('Denegar cancelación')}
                    </Button>
                  </>
                )}
                {canCancelDirect && (
                  <Button variant="danger-outline" icon={Ban} onClick={() => setDialog('cancel_direct')}>
                    {t('Cancelar ausencia')}
                  </Button>
                )}
                {canEditDraft && (
                  <>
                    <Button icon={Pencil} onClick={() => setDialog('edit')}>
                      {t('Editar borrador')}
                    </Button>
                    <Button variant="primary" icon={Send} onClick={submitDraft} loading={pending}>
                      {t('Enviar solicitud')}
                    </Button>
                  </>
                )}
                {canRequestCancel && (
                  <Button icon={Undo2} onClick={() => setDialog('request_cancel')}>
                    {t('Solicitar cancelación')}
                  </Button>
                )}
                {canWithdraw && (
                  <Button variant="danger-outline" icon={Undo2} onClick={() => setDialog('withdraw')}>
                    {t('Retirar')}
                  </Button>
                )}
                {reviewer && <p className="tiny muted" style={{ margin: 0 }}>{t('Aprobar no crea fichajes. La decisión queda en el historial y en la auditoría.')}</p>}
              </div>
            )}
          </Card>

          <Card title={t('Auditoría')}>
            <AuditList filter={(e) => e.entityId === a.id} />
          </Card>
        </div>
      </div>

      {dialog === 'approve' && <ApproveDialog ctx={ctx} a={a} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && (
        <ConfirmDialog
          title={t('Rechazar solicitud')}
          message={t('Indique el motivo del rechazo. La persona empleada lo verá en el detalle de la solicitud.')}
          confirmLabel={t('Rechazar')}
          danger
          requireReason
          reasonLabel={t('Motivo del rechazo (mínimo 5 caracteres)')}
          onConfirm={(reason) => runOk(() => reviewAbsence(a.id, 'reject', reason, []), t('Solicitud rechazada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel_accept' && (
        <ConfirmDialog
          title={t('Aceptar cancelación')}
          message={t('La ausencia pasará a «Cancelada». No se borra: el historial se conserva.')}
          confirmLabel={t('Aceptar cancelación')}
          requireReason
          reasonLabel={t('Motivo de la decisión (mínimo 5 caracteres)')}
          onConfirm={(reason) => runOk(() => decideCancellation(a.id, true, reason), t('Cancelación aceptada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel_deny' && (
        <ConfirmDialog
          title={t('Denegar cancelación')}
          message={t('La ausencia seguirá aprobada.')}
          confirmLabel={t('Denegar cancelación')}
          danger
          requireReason
          reasonLabel={t('Motivo de la decisión (mínimo 5 caracteres)')}
          onConfirm={(reason) => runOk(() => decideCancellation(a.id, false, reason), t('Cancelación denegada: la ausencia sigue aprobada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel_direct' && (
        <ConfirmDialog
          title={t('Cancelar ausencia aprobada')}
          message={t('RR. HH. cancela la ausencia directamente. No se borra: queda como «Cancelada» con su historial, y se avisa a la persona empleada.')}
          confirmLabel={t('Cancelar ausencia')}
          danger
          requireReason
          reasonLabel={t('Motivo de la cancelación (mínimo 5 caracteres)')}
          onConfirm={(reason) => runOk(() => decideCancellation(a.id, true, reason), t('Ausencia cancelada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'withdraw' && (
        <ConfirmDialog
          title={t('Retirar solicitud')}
          message={t('La solicitud quedará como «Retirada» y no se podrá reactivar.')}
          confirmLabel={t('Retirar')}
          danger
          requireReason={false}
          reasonLabel={t('Comentario (opcional)')}
          onConfirm={(note) => runOk(() => withdrawAbsence(a.id, note), t('Solicitud retirada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'request_cancel' && (
        <ConfirmDialog
          title={t('Solicitar cancelación')}
          message={t('La ausencia sigue aprobada hasta que su responsable o RR. HH. decida.')}
          confirmLabel={t('Solicitar cancelación')}
          requireReason
          reasonLabel={t('Motivo de la cancelación (mínimo 5 caracteres)')}
          onConfirm={(reason) => runOk(() => requestCancellation(a.id, reason), t('Cancelación solicitada'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'edit' && <AbsenceForm existing={a} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ApproveDialog({ ctx, a, onClose }: { ctx: UiCtx; a: AbsenceRequest; onClose: () => void }) {
  const { runOk, pending } = useAction();
  const conflicts = conflictsFor(ctx, a);
  const warnings = conflicts.filter((c) => c.severity === 'warning');
  const infos = conflicts.filter((c) => c.severity !== 'warning');
  const [acked, setAcked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const allAcked = warnings.every((w) => acked.includes(w.code));
  const approve = async () => {
    if (!allAcked) return;
    const ok = await runOk(() => reviewAbsence(a.id, 'approve', note, acked), t('Ausencia aprobada'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('Aprobar ausencia')}
      description={t('Solicitud de {name}: del {from} al {to}', { name: employeeName(ctx.db, a.employeeId), from: formatDate(a.startDate), to: formatDate(a.endDate) })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" icon={Check} onClick={approve} loading={pending} disabled={!allAcked}>
            {t('Aprobar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="info">{t('Aprobar una ausencia nunca crea fichajes de entrada o salida ni cancela turnos: revise la planificación por separado.')}</Callout>
        {warnings.length > 0 ? (
          <fieldset className="abs-ack">
            <legend className="small strong">{t('Confirme cada aviso antes de aprobar')}</legend>
            {warnings.map((w) => (
              <Checkbox
                key={w.code}
                label={msg(w.message)}
                hint={t(CONFLICT_LABEL[w.code] ?? w.code)}
                checked={acked.includes(w.code)}
                onChange={(v) => setAcked((xs) => (v ? [...xs, w.code] : xs.filter((x) => x !== w.code)))}
              />
            ))}
          </fieldset>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>{t('No hay avisos que confirmar.')}</p>
        )}
        {infos.map((c) => (
          <Callout key={c.code} tone="neutral">
            {msg(c.message)}
          </Callout>
        ))}
        <TextAreaField label={t('Comentario (opcional)')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {!allAcked && <p className="small muted" style={{ margin: 0 }}>{t('El botón «Aprobar» se activa cuando todos los avisos están confirmados.')}</p>}
      </div>
    </Modal>
  );
}

function EvidenceUpload({ ctx, a }: { ctx: UiCtx; a: AbsenceRequest }) {
  const { run, pending } = useAction();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!EVIDENCE_TYPES.test(file.type)) return setError(t('Formato no admitido: use PDF, PNG o JPG.'));
    if (file.size > MAX_EVIDENCE_BYTES) return setError(t('El archivo supera 5 MB.'));
    const dataUrl = await run(() => readAsDataUrl(file));
    if (dataUrl === undefined) return;
    await run(() => addAbsenceAttachment(a.id, { name: file.name, type: file.type, size: file.size, dataUrl }), t('Justificante adjuntado con acceso restringido'));
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        <Upload size={13} aria-hidden /> {t('Adjuntar archivo (PDF, PNG o JPG, máximo 5 MB)')}
      </label>
      <input
        id={id}
        type="file"
        className="input abs-file"
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        disabled={pending || ctx.company.id !== a.companyId}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
