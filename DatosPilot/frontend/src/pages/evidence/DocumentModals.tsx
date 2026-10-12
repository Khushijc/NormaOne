/**
 * Dialogs of the document detail page: review decision, date correction and paper acknowledgement.
 * Every action goes through evidenceService; the service re-checks permissions and rules.
 */
import { CheckCircle2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Callout, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { versionOn } from '../../domain/requirements';
import { addMonths, formatDate } from '../../domain/time';
import type { DocumentVersion, EvidenceDocument, ID } from '../../domain/types';
import { t } from '../../i18n';
import { acknowledgeDocument, canDecide, decideDocument, updateDates } from '../../services/evidenceService';
import { visibleEmployeeIds } from '../../services/context';
import { useCtx } from '../../store/hooks';

type ExpiryMode = DocumentVersion['expiryMode'];

function ExpiryFields({ mode, setMode, legal, setLegal, disabled }: { mode: ExpiryMode; setMode: (m: ExpiryMode) => void; legal: string; setLegal: (d: string) => void; disabled?: boolean }) {
  return (
    <div className="form-grid">
      <SelectField label={t('Caducidad legal')} value={mode} onChange={(e) => setMode(e.target.value as ExpiryMode)} disabled={disabled}>
        <option value="date">{t('Fecha de caducidad indicada por el emisor')}</option>
        <option value="none">{t('Sin caducidad (el emisor no la establece)')}</option>
        <option value="unknown">{t('No indicada — requiere revisión')}</option>
      </SelectField>
      {mode === 'date' && <TextField label={t('Fecha de caducidad legal')} type="date" required value={legal} onChange={(e) => setLegal(e.target.value)} disabled={disabled} />}
    </div>
  );
}

/** Accept or reject a version. Rejection requires a reason; acceptance may confirm the dates. */
export function DecisionModal({ doc, version, decision, onClose }: { doc: EvidenceDocument; version: DocumentVersion; decision: 'accept' | 'reject'; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<ExpiryMode>(version.expiryMode);
  const [legal, setLegal] = useState(version.legalExpiryDate ?? '');
  const [provider, setProvider] = useState(version.providerReviewDate ?? '');
  const reqVersion = doc.templateId ? versionOn(ctx.db, doc.templateId, ctx.today) : undefined;
  const rule = reqVersion?.reviewRule;
  const interval = rule?.kind === 'interval' && rule.months ? rule : null;
  const computed = interval && version.issueDate ? addMonths(version.issueDate, interval.months!) : null;
  const accept = decision === 'accept';

  const submit = async () => {
    setTouched(true);
    if (!accept && !reason.trim()) return;
    const r = await run(
      () =>
        decideDocument(version.id, decision, {
          note,
          rejectionReason: accept ? undefined : reason,
          ...(accept ? { expiryMode: mode, legalExpiryDate: mode === 'date' ? legal || null : null, providerReviewDate: provider || null } : {}),
        }),
      accept ? t('Versión {n} aceptada por la autoridad de revisión', { n: version.version }) : t('Versión {n} rechazada; se conserva en el historial', { n: version.version }),
    );
    if (r) onClose();
  };

  return (
    <Modal
      title={accept ? t('Aceptar la versión {n}', { n: version.version }) : t('Rechazar la versión {n}', { n: version.version })}
      description={`${doc.code} · ${doc.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant={accept ? 'primary' : 'danger'} icon={accept ? CheckCircle2 : XCircle} onClick={submit} loading={pending}>
            {accept ? t('Aceptar evidencia') : t('Rechazar evidencia')}
          </Button>
        </>
      }
    >
      {accept ? (
        <>
          <Callout tone="info">{t('Aceptar la evidencia confirma que el documento es adecuado para el requisito configurado. No es una aprobación profesional de seguridad ni certifica el cumplimiento legal.')}</Callout>
          <div className="stack-sm">
            <div className="strong small">{t('Fechas confirmadas por la persona revisora')}</div>
            <ExpiryFields mode={mode} setMode={setMode} legal={legal} setLegal={setLegal} />
            {mode === 'unknown' && <p className="small muted">{t('Con la caducidad «No indicada», el requisito seguirá como «Revisión necesaria» hasta que se confirme. No se inventa ninguna fecha.')}</p>}
            <TextField
              label={t('Fecha de revisión del proveedor (opcional)')}
              type="date"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              hint={
                interval
                  ? computed
                    ? t('Si la deja vacía se calculará con la periodicidad aprobada ({months} meses, fijada por {who}) desde la emisión: {date}.', { months: interval.months!, who: interval.setBy ?? '—', date: formatDate(computed) })
                    : t('La periodicidad aprobada ({months} meses, fijada por {who}) no se puede aplicar: el documento no tiene fecha de emisión.', { months: interval.months!, who: interval.setBy ?? '—' })
                  : t('Solo si el proveedor la indica. No se calcula ninguna fecha sin una periodicidad aprobada.')
              }
            />
          </div>
        </>
      ) : (
        <>
          <TextAreaField label={t('Motivo del rechazo')} required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={touched && !reason.trim() ? t('Obligatorio.') : undefined} hint={t('La persona que lo presentó lo verá. La versión rechazada se conserva en el historial.')} />
        </>
      )}
      <TextAreaField label={t('Nota de la decisión (opcional)')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

/** Correct or confirm the dates of a version (always with the source or reason, audited before/after). */
export function DatesModal({ doc, version, onClose }: { doc: EvidenceDocument; version: DocumentVersion; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const full = canDecide(ctx, doc);
  const [mode, setMode] = useState<ExpiryMode>(version.expiryMode);
  const [legal, setLegal] = useState(version.legalExpiryDate ?? '');
  const [provider, setProvider] = useState(version.providerReviewDate ?? '');
  const [internal, setInternal] = useState(version.internalFollowUpDate ?? '');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = async () => {
    setTouched(true);
    if (!reason.trim()) return;
    const r = await run(
      () =>
        updateDates(version.id, {
          expiryMode: mode,
          legalExpiryDate: mode === 'date' ? legal || null : null,
          providerReviewDate: full ? provider || null : version.providerReviewDate,
          internalFollowUpDate: internal || null,
          reason,
        }),
      t('Fechas actualizadas (cambio registrado en la auditoría)'),
    );
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Actualizar fechas de la versión {n}', { n: version.version })}
      description={`${doc.code} · ${doc.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Guardar fechas')}
          </Button>
        </>
      }
    >
      {!full && <Callout tone="info">{t('La caducidad legal y la revisión del proveedor las confirma la autoridad de revisión. Usted puede cambiar el seguimiento interno.')}</Callout>}
      <ExpiryFields mode={mode} setMode={setMode} legal={legal} setLegal={setLegal} disabled={!full} />
      <div className="form-grid">
        <TextField label={t('Revisión del proveedor')} type="date" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={!full} hint={t('Fecha indicada por el proveedor; distinta de la caducidad.')} />
        <TextField label={t('Seguimiento interno')} type="date" value={internal} onChange={(e) => setInternal(e.target.value)} hint={t('Fecha interna; no es un plazo legal.')} />
      </div>
      <TextAreaField label={t('Fuente o motivo del cambio')} required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={touched && !reason.trim() ? t('Obligatorio.') : undefined} hint={t('Por ejemplo: «Fecha indicada en el certificado, página 2».')} />
    </Modal>
  );
}

/** Coordinator records a paper-signed acknowledgement for an employee (current accepted version only). */
export function PaperAckModal({ doc, version, onClose }: { doc: EvidenceDocument; version: DocumentVersion; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [employeeId, setEmployeeId] = useState<ID>('');
  const [touched, setTouched] = useState(false);
  const options = useMemo(() => {
    const ids = visibleEmployeeIds(ctx);
    const done = new Set(ctx.db.acknowledgements.filter((a) => a.subject.kind === 'document' && a.subject.id === doc.id && a.documentVersionId === version.id).map((a) => a.employeeId));
    return ctx.db.employees
      .filter((e) => ids.has(e.id) && e.status === 'active' && !done.has(e.id))
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es'));
  }, [ctx, doc.id, version.id]);
  const submit = async () => {
    setTouched(true);
    if (!employeeId) return;
    const r = await run(() => acknowledgeDocument(doc.id, employeeId), t('Confirmación en papel registrada (versión {n})', { n: version.version }));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Registrar confirmación en papel')}
      description={`${doc.code} · ${t('versión {n}', { n: version.version })}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={options.length === 0}>
            {t('Registrar confirmación')}
          </Button>
        </>
      }
    >
      <Callout tone="info">{t('Registra que la persona firmó en papel la recepción de esta versión. La confirmación de la información no acredita formación.')}</Callout>
      <SelectField label={t('Persona trabajadora')} required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} error={touched && !employeeId ? t('Obligatorio.') : undefined} hint={options.length === 0 ? t('Todas las personas de su ámbito ya han confirmado esta versión.') : undefined}>
        <option value="">{t('Seleccione…')}</option>
        {options.map((e) => (
          <option key={e.id} value={e.id}>
            {e.firstName} {e.lastName}
          </option>
        ))}
      </SelectField>
    </Modal>
  );
}
