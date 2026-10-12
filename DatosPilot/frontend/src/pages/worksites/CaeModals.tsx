/**
 * Dialogs of a CAE case: add participant, record an exchange, record one step of a sent
 * exchange (sent → receipt → recipient acknowledgement, in that order) and review received
 * information. Each fact is recorded separately through caeService.
 */
import { useState } from 'react';
import { Button, Callout, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { CAE_ROLE_LABEL } from '../../domain/status';
import type { CaeCase, CaeExchange, CaeRole, ID } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { addParticipant, recordExchange, recordExchangeStep, reviewExchange, shareableVersions, type ExchangeStep } from '../../services/caeService';
import { visibleDocuments, versionsOfDocument } from '../../services/evidenceService';
import { useCtx } from '../../store/hooks';
import { participantName } from './worksiteShared';

const ROLES = Object.keys(CAE_ROLE_LABEL) as CaeRole[];

export function AddParticipantModal({ kase, onClose }: { kase: CaeCase; onClose: () => void }) {
  const { run, pending } = useAction();
  const [p, setP] = useState({ organisation: '', role: 'concurrente' as CaeRole, contactName: '', contactEmail: '' });
  const [touched, setTouched] = useState(false);
  const missingOrg = !p.organisation.trim();
  const missingContact = !p.contactName.trim();
  const submit = async () => {
    setTouched(true);
    if (missingOrg || missingContact) return;
    const r = await run(() => addParticipant(kase.id, { ...p, contactEmail: p.contactEmail.trim() }), t('Participante añadido'));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Añadir participante')}
      description={t('Otra empresa o persona autónoma que concurre en el centro.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Añadir participante')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label={t('Organización')} required value={p.organisation} onChange={(e) => setP({ ...p, organisation: e.target.value })} error={touched && missingOrg ? t('Obligatorio.') : undefined} className="span-2" />
        <SelectField label={t('Papel')} value={p.role} onChange={(e) => setP({ ...p, role: e.target.value as CaeRole })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(CAE_ROLE_LABEL[r])}
            </option>
          ))}
        </SelectField>
        <TextField label={t('Persona de contacto')} required value={p.contactName} onChange={(e) => setP({ ...p, contactName: e.target.value })} error={touched && missingContact ? t('Obligatorio.') : undefined} />
        <TextField label={t('Correo de contacto')} type="email" value={p.contactEmail} onChange={(e) => setP({ ...p, contactEmail: e.target.value })} className="span-2" />
      </div>
    </Modal>
  );
}

export function RecordExchangeModal({ kase, onClose }: { kase: CaeCase; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const own = kase.participants.find((p) => p.isOwnCompany);
  const others = kase.participants.filter((p) => !p.isOwnCompany);
  const [direction, setDirection] = useState<CaeExchange['direction']>('sent');
  const [other, setOther] = useState<ID>(others[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [versionId, setVersionId] = useState<ID>('');
  const [sentAt, setSentAt] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [touched, setTouched] = useState(false);

  const shareable = shareableVersions(ctx, kase);
  // Received information may refer to a document already registered for this case or worksite.
  const receivedDocs = visibleDocuments(ctx)
    .filter((d) => !d.employeeId && (d.caseId === kase.id || d.worksiteId === kase.worksiteId))
    .flatMap((d) => versionsOfDocument(ctx, d.id).map((v) => ({ doc: d, version: v })));
  const options = direction === 'sent' ? shareable : receivedDocs;

  const errors: Record<string, string> = {};
  if (!subject.trim()) errors.subject = t('Obligatorio.');
  if (!other) errors.other = t('Obligatorio.');
  if (sentAt && sentAt > ctx.today) errors.sentAt = t('La fecha no puede ser futura.');
  if (!own) errors.other = t('El caso no tiene participante de la propia empresa.');
  const err = (k: string) => (touched ? errors[k] : undefined);

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length || !own) return;
    const r = await run(
      () =>
        recordExchange({
          caseId: kase.id,
          direction,
          subject: subject.trim(),
          documentVersionId: versionId || null,
          senderParticipantId: direction === 'sent' ? own.id : other,
          recipientParticipantId: direction === 'sent' ? other : own.id,
          sentAt: sentAt || null,
          followUp: followUp.trim(),
        }),
      direction === 'sent' ? (sentAt ? t('Envío registrado. La recepción y el acuse se registran aparte.') : t('Envío registrado como pendiente de enviar.')) : t('Recepción registrada; revisión del contenido pendiente.'),
    );
    if (r) onClose();
  };

  return (
    <Modal
      wide
      title={t('Registrar intercambio de información')}
      description={t('Registre cada intercambio por separado. Enviar o subir un documento no implica que se haya recibido, entendido ni aceptado.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Registrar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <SelectField
            label={t('Dirección')}
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as CaeExchange['direction']);
              setVersionId('');
            }}
          >
            <option value="sent">{t('Enviado por nuestra empresa')}</option>
            <option value="received">{t('Recibido de otra empresa')}</option>
          </SelectField>
          <SelectField label={direction === 'sent' ? t('Destinatario') : t('Remitente')} required value={other} onChange={(e) => setOther(e.target.value)} error={err('other')}>
            {others.length === 0 && <option value="">{t('Añada antes otra empresa participante')}</option>}
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.organisation} ({t(CAE_ROLE_LABEL[p.role])})
              </option>
            ))}
          </SelectField>
          <TextField label={t('Asunto')} required value={subject} onChange={(e) => setSubject(e.target.value)} error={err('subject')} className="span-all" />
          <SelectField
            label={t('Documento y versión')}
            value={versionId}
            onChange={(e) => {
              setVersionId(e.target.value);
              const hit = options.find((o) => o.version.id === e.target.value);
              if (hit && !subject.trim()) setSubject(hit.doc.title);
            }}
            className="span-all"
            hint={direction === 'sent' ? t('Solo evidencia aceptada, no restringida y relevante para este centro.') : t('Opcional: documento ya registrado para este caso o centro.')}
          >
            <option value="">{t('Sin documento adjunto')}</option>
            {options.map(({ doc, version }) => (
              <option key={version.id} value={version.id}>
                {doc.code} · {doc.title} · v{version.version}
              </option>
            ))}
          </SelectField>
          <TextField
            label={direction === 'sent' ? t('Fecha de envío') : t('Fecha de envío del remitente')}
            type="date"
            max={ctx.today}
            value={sentAt}
            onChange={(e) => setSentAt(e.target.value)}
            error={err('sentAt')}
            hint={direction === 'sent' ? t('Déjela vacía si todavía no se ha enviado.') : t('Si la conoce. La recepción por nuestra empresa se registra hoy.')}
          />
          <TextAreaField label={t('Seguimiento')} value={followUp} onChange={(e) => setFollowUp(e.target.value)} rows={2} className="span-all" hint={t('Por ejemplo: pedir confirmación de recepción.')} />
        </div>
        {direction === 'sent' && shareable.length === 0 && (
          <Callout tone="info">{t('No hay evidencia aceptada y relevante para este centro que se pueda adjuntar. Puede registrar el envío sin documento.')}</Callout>
        )}
      </div>
    </Modal>
  );
}

const STEP_TITLE: Record<ExchangeStep, string> = {
  sent: tKey('Registrar envío'),
  receipt: tKey('Registrar confirmación de recepción'),
  acknowledged: tKey('Registrar acuse del destinatario'),
};

export function StepModal({ kase, exchange, step, onClose }: { kase: CaeCase; exchange: CaeExchange; step: ExchangeStep; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const recipient = kase.participants.find((p) => p.id === exchange.recipientParticipantId);
  const [date, setDate] = useState(ctx.today);
  const [by, setBy] = useState(step === 'receipt' ? recipient?.contactName ?? '' : '');
  const [touched, setTouched] = useState(false);
  const minDate = exchange.sentAt ? exchange.sentAt.slice(0, 10) : undefined;
  const errors: Record<string, string> = {};
  if (!date) errors.date = t('Obligatorio.');
  else if (date > ctx.today) errors.date = t('La fecha no puede ser futura.');
  else if (minDate && date < minDate) errors.date = t('La fecha no puede ser anterior al envío.');
  if (step === 'receipt' && !by.trim()) errors.by = t('Obligatorio.');
  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const ok = step === 'sent' ? t('Envío registrado') : step === 'receipt' ? t('Recepción confirmada registrada') : t('Acuse del destinatario registrado');
    const r = await run(() => recordExchangeStep(exchange.id, step, { date, confirmedBy: by.trim() }), ok);
    if (r) onClose();
  };
  return (
    <Modal
      title={t(STEP_TITLE[step])}
      description={exchange.subject}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Registrar')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="info">
          {step === 'sent'
            ? t('Registra que la información salió de nuestra empresa. No implica que el destinatario la haya recibido.')
            : step === 'receipt'
              ? t('Registra que {org} confirma haber recibido la información. No implica que la haya entendido ni aceptado.', { org: participantName(kase, exchange.recipientParticipantId) })
              : t('Registra que {org} declara haber entendido la información. No es una aprobación de su contenido ni de la seguridad del centro.', { org: participantName(kase, exchange.recipientParticipantId) })}
        </Callout>
        <TextField label={t('Fecha')} type="date" required min={minDate} max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? errors.date : undefined} />
        {step === 'receipt' && (
          <TextField label={t('Quién confirma la recepción en la empresa destinataria')} required value={by} onChange={(e) => setBy(e.target.value)} error={touched ? errors.by : undefined} />
        )}
      </div>
    </Modal>
  );
}

export function ReviewExchangeModal({ kase, exchange, onClose }: { kase: CaeCase; exchange: CaeExchange; onClose: () => void }) {
  const { run, pending } = useAction();
  const [decision, setDecision] = useState<'accepted' | 'rejected'>('accepted');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = async () => {
    setTouched(true);
    if (!note.trim()) return;
    const r = await run(() => reviewExchange(exchange.id, decision, note.trim()), decision === 'accepted' ? t('Información revisada y aceptada') : t('Información revisada con objeciones'));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Revisar información recibida')}
      description={t('{subject} · de {org}', { subject: exchange.subject, org: participantName(kase, exchange.senderParticipantId) })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant={decision === 'accepted' ? 'primary' : 'danger'} onClick={submit} loading={pending}>
            {decision === 'accepted' ? t('Aceptar contenido') : t('Registrar objeciones')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="info">{t('La revisión valora el contenido recibido para la coordinación. Haberlo recibido no implica aceptarlo, y aceptarlo no certifica la seguridad del centro.')}</Callout>
        <fieldset>
          <legend className="small strong">{t('Decisión')}</legend>
          <div className="stack-sm">
            <label className="checkbox">
              <input type="radio" name="cae-review" checked={decision === 'accepted'} onChange={() => setDecision('accepted')} />
              <span>{t('Revisado y aceptado')}</span>
            </label>
            <label className="checkbox">
              <input type="radio" name="cae-review" checked={decision === 'rejected'} onChange={() => setDecision('rejected')} />
              <span>{t('Revisado con objeciones (requiere corrección o aclaración)')}</span>
            </label>
          </div>
        </fieldset>
        <TextAreaField label={t('Nota de revisión')} required value={note} onChange={(e) => setNote(e.target.value)} rows={3} error={touched && !note.trim() ? t('Obligatorio.') : undefined} />
      </div>
    </Modal>
  );
}
