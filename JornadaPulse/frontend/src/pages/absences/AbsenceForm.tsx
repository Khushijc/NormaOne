/**
 * New absence request / draft editor (Modal). Live validation uses validateAbsence and the
 * conflictsFor preview; saving goes through saveAbsence. Evidence can be attached once a draft
 * exists (addAbsenceAttachment). Sick leave (IT) has no note, no evidence and no diagnosis.
 */
import { Info, Send, Save, ShieldAlert, Upload } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { msg } from '../../components/bits';
import { Button, Callout, Checkbox, KV, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { isValidISODate } from '../../domain/time';
import type { AbsenceRequest, ID } from '../../domain/types';
import { t } from '../../i18n';
import { absenceTypesFor, addAbsenceAttachment, conflictsFor, saveAbsence, validateAbsence, type AbsenceInput } from '../../services/absenceService';
import { employeeName } from '../../services/context';
import { useCtx } from '../../store/hooks';
import { AttachmentList, EVIDENCE_LABEL, EVIDENCE_TYPES, MAX_EVIDENCE_BYTES, PAID_LABEL, readAsDataUrl } from './absenceUi';

export function AbsenceForm({ existing, initialDate, onClose }: { existing?: AbsenceRequest | null; initialDate?: string | null; onClose: () => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const fileId = useId();
  const isHr = ctx.can('absences.review_all');

  const [draftId, setDraftId] = useState<ID | null>(existing?.id ?? null);
  const [employeeId, setEmployeeId] = useState<ID>(existing?.employeeId ?? ctx.employee?.id ?? '');
  const [typeId, setTypeId] = useState<ID>(existing?.typeId ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? initialDate ?? '');
  const [endDate, setEndDate] = useState(existing?.endDate ?? initialDate ?? '');
  const [partialOn, setPartialOn] = useState(!!existing?.partial);
  const [startTime, setStartTime] = useState(existing?.partial?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(existing?.partial?.endTime ?? '11:00');
  const [note, setNote] = useState(existing?.note ?? '');
  const [attempted, setAttempted] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const types = absenceTypesFor(ctx);
  const type = types.find((x) => x.id === typeId);
  const isSickLeave = type?.code === 'IT';
  const partial = partialOn && type?.allowsPartialDay;

  const employees = useMemo(
    () => ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active').sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'es')),
    [ctx.db.employees, ctx.company.id],
  );
  const onBehalf = !!employeeId && employeeId !== ctx.employee?.id;

  const input: AbsenceInput = {
    employeeId,
    typeId,
    startDate,
    endDate: partial ? startDate : endDate,
    partial: partial ? { startTime, endTime } : null,
    note: isSickLeave ? '' : note,
  };
  const ready = !!employeeId && !!typeId && isValidISODate(input.startDate) && isValidISODate(input.endDate);
  const check = employeeId ? validateAbsence(ctx, input, draftId, false) : { errors: [t('Seleccione la persona empleada.')], warnings: [] };
  const submitCheck = employeeId ? validateAbsence(ctx, input, draftId, true) : check;
  const conflicts = ready && input.endDate >= input.startDate ? conflictsFor(ctx, { id: draftId ?? '', employeeId, startDate: input.startDate, endDate: input.endDate, partial: input.partial }) : [];
  const attachments = draftId ? ctx.db.attachments.filter((x) => x.ownerId === draftId) : [];
  const showErrors = attempted || ready;
  const submitOnlyErrors = submitCheck.errors.filter((e) => !check.errors.includes(e));

  const save = async (submit: boolean) => {
    setAttempted(true);
    const v = submit ? submitCheck : check;
    if (!employeeId || v.errors.length) return;
    const r = await run(
      () => saveAbsence(input, submit, draftId),
      (x) => (x.status === 'draft' ? t('Borrador guardado') : x.status === 'approved' ? t('Ausencia registrada: este tipo no requiere aprobación') : t('Solicitud enviada para revisión')),
    );
    if (!r) return;
    if (!submit && type && type.evidence !== 'none') {
      setDraftId(r.id);
      return;
    }
    onClose();
    navigate(`/ausencias/${r.id}`);
  };

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file || !draftId) return;
    if (!EVIDENCE_TYPES.test(file.type)) return setFileError(t('Formato no admitido: use PDF, PNG o JPG.'));
    if (file.size > MAX_EVIDENCE_BYTES) return setFileError(t('El archivo supera 5 MB.'));
    setUploading(true);
    try {
      const dataUrl = await run(() => readAsDataUrl(file));
      if (dataUrl === undefined) return;
      await run(() => addAbsenceAttachment(draftId, { name: file.name, type: file.type, size: file.size, dataUrl }), t('Justificante adjuntado con acceso restringido'));
    } finally {
      setUploading(false);
    }
  };

  const submitLabel = type && !type.requiresApproval ? t('Registrar ausencia') : t('Enviar solicitud');

  return (
    <Modal
      wide
      title={draftId ? t('Borrador de ausencia') : t('Nueva solicitud de ausencia')}
      description={t('La ausencia se gestiona aparte del registro de jornada: aprobarla nunca crea fichajes de entrada o salida.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
          <Button icon={Save} onClick={() => save(false)} loading={pending} disabled={!typeId}>
            {t('Guardar borrador')}
          </Button>
          <Button variant="primary" icon={Send} onClick={() => save(true)} loading={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {isHr && (
          <SelectField label={t('Persona empleada')} required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!!draftId} hint={draftId ? t('No se puede cambiar la persona de un borrador ya guardado.') : undefined}>
            <option value="">{t('Seleccione…')}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName} · {e.code}
                {e.id === ctx.employee?.id ? ` (${t('usted')})` : ''}
              </option>
            ))}
          </SelectField>
        )}
        {onBehalf && (
          <Callout tone="info" title={t('Registro por RR. HH.')}>
            {t('La ausencia constará como registrada por RR. HH. en nombre de {name}, en el historial y en la auditoría.', { name: employeeName(ctx.db, employeeId) })}
          </Callout>
        )}

        <SelectField
          label={t('Tipo de ausencia')}
          required
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            const next = types.find((x) => x.id === e.target.value);
            if (!next?.allowsPartialDay) setPartialOn(false);
          }}
        >
          <option value="">{t('Seleccione…')}</option>
          {types.map((x) => (
            <option key={x.id} value={x.id}>
              {t(x.name)}
            </option>
          ))}
        </SelectField>

        {type && (
          <div className="abs-type-info">
            <KV
              items={[
                [t('Referencia legal'), type.legalReference ? t(type.legalReference) : '—'],
                [t('Duración de referencia'), type.referenceDuration ? <span>{t(type.referenceDuration)} <span className="muted small">({t('referencia mínima legal; revise su convenio')})</span></span> : t('Sin duración de referencia')],
                [t('Retribución'), t(PAID_LABEL[type.paid])],
                [t('Aprobación'), type.requiresApproval ? t('Requiere aprobación de su responsable o de RR. HH.') : t('No requiere aprobación: se registra directamente')],
                [t('Justificante'), t(EVIDENCE_LABEL[type.evidence])],
              ]}
            />
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>
              {t('La duración es solo informativa: no es un derecho calculado ni se aprueba automáticamente.')}
            </p>
          </div>
        )}

        {isSickLeave && (
          <Callout tone="info" icon={ShieldAlert} title={t('Baja médica (IT)')}>
            {t('No necesita aportar ningún parte ni documento médico: el INSS lo comunica directamente a la empresa. Solo se registran las fechas; no indique diagnósticos.')}
          </Callout>
        )}

        <div className="abs-dates">
          <TextField label={t('Fecha de inicio')} type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField label={t('Fecha de fin')} type="date" required value={partial ? startDate : endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!!partial} hint={partial ? t('Una ausencia por horas empieza y termina el mismo día.') : undefined} />
        </div>

        {type?.allowsPartialDay && (
          <Checkbox label={t('Ausencia por horas (parte de la jornada)')} checked={partialOn} onChange={setPartialOn} />
        )}
        {partial && (
          <div className="abs-dates">
            <TextField label={t('Hora de inicio')} type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <TextField label={t('Hora de fin')} type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        )}

        {isSickLeave ? (
          <p className="small muted">{t('Para la baja médica no se recoge ninguna nota ni motivo (minimización de datos de salud).')}</p>
        ) : (
          <TextAreaField
            label={t('Nota')}
            required={type?.code === 'OTRA'}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            hint={type?.sensitive ? t('No incluya diagnósticos ni datos de salud: no son necesarios para gestionar la ausencia.') : t('Información útil para quien revisa la solicitud.')}
          />
        )}
        {type?.sensitive && !isSickLeave && (
          <Callout tone="warning" title={t('Categoría reservada')}>
            {t('Su supervisor verá solo «Ausencia justificada (categoría reservada)». No incluya diagnósticos ni datos de salud en la nota.')}
          </Callout>
        )}

        {showErrors && check.errors.length > 0 && (
          <Callout tone="danger" title={t('Revise la solicitud')}>
            <ul>
              {check.errors.map((e) => (
                <li key={e}>{t(e)}</li>
              ))}
            </ul>
          </Callout>
        )}
        {attempted && check.errors.length === 0 && submitOnlyErrors.length > 0 && (
          <Callout tone="warning" title={t('Antes de enviar')}>
            <ul>
              {submitOnlyErrors.map((e) => (
                <li key={e}>{t(e)}</li>
              ))}
            </ul>
          </Callout>
        )}
        {check.warnings.length > 0 && (
          <Callout tone="warning">
            <ul>
              {check.warnings.map((w) => (
                <li key={w}>{t(w)}</li>
              ))}
            </ul>
          </Callout>
        )}

        {ready && (
          <section aria-label={t('Conflictos detectados')} className="stack-sm">
            <h3 className="abs-h3">{t('Comprobación de calendario')}</h3>
            {conflicts.length === 0 ? (
              <p className="small muted">{t('Sin turnos planificados, registros de trabajo, ausencias del equipo ni festivos en estas fechas.')}</p>
            ) : (
              conflicts.map((c) => (
                <Callout key={c.code} tone={c.severity === 'warning' ? 'warning' : 'info'}>
                  {msg(c.message)}
                </Callout>
              ))
            )}
            <p className="tiny muted">{t('Quien revise la solicitud deberá confirmar cada aviso antes de aprobarla.')}</p>
          </section>
        )}

        {type && type.evidence !== 'none' && (
          <section aria-label={t('Justificante')} className="stack-sm">
            <h3 className="abs-h3">
              {t('Justificante')} <span className="muted small">({t(EVIDENCE_LABEL[type.evidence])})</span>
            </h3>
            <Callout tone="neutral" icon={Info}>
              {t('Acceso restringido: solo la persona empleada, quien revisa la solicitud y RR. HH. pueden ver el archivo. Adjuntarlo no implica aprobación. En la demostración el archivo se guarda solo en este navegador.')}
            </Callout>
            {!draftId ? (
              <p className="small muted">{t('Guarde primero el borrador para poder adjuntar el justificante (PDF, PNG o JPG, máximo 5 MB).')}</p>
            ) : (
              <>
                <AttachmentList items={attachments} canOpen tz={ctx.company.timezone} />
                <div className="field">
                  <label htmlFor={fileId}>
                    <Upload size={13} aria-hidden /> {t('Adjuntar archivo (PDF, PNG o JPG, máximo 5 MB)')}
                  </label>
                  <input
                    id={fileId}
                    type="file"
                    className="input abs-file"
                    accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                    disabled={uploading || pending}
                    onChange={(e) => {
                      void onFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  {fileError && (
                    <span className="error" role="alert">
                      {fileError}
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
