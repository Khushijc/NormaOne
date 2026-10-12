/**
 * Absence categories of the company (TIM-05). Statutory references are informative minimums;
 * the applicable collective agreement may improve them and must be reviewed by the adviser.
 */
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import type { AbsenceType } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { absenceTypesFor } from '../../services/absenceService';
import { updateAbsenceType } from '../../services/planningService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { Badge, Button, Callout, Card, Checkbox, DateText, EmptyState, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { fmtNum, GeneralErrors } from '../team/employeeForms';

export const PAID_LABEL: Record<AbsenceType['paid'], string> = {
  paid: tKey('Retribuido'),
  unpaid: tKey('No retribuido'),
  depends: tKey('Según el caso'),
};

export const EVIDENCE_LABEL: Record<AbsenceType['evidence'], string> = {
  none: tKey('No admite justificante'),
  optional: tKey('Justificante opcional'),
  required: tKey('Justificante obligatorio'),
};

const UNIT_LABEL: Record<'natural' | 'working', string> = {
  natural: tKey('días naturales'),
  working: tKey('días laborables'),
};

const yesNo = (v: boolean) => (v ? t('Sí') : t('No'));

export function AbsenceTypesTab() {
  const ctx = useCtx();
  const [editing, setEditing] = useState<AbsenceType | null>(null);
  const canEdit = ctx.can('policies.manage');
  const types = absenceTypesFor(ctx, true).sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
  return (
    <div className="stack">
      <Callout tone="warning" title={t('Referencias legales informativas')}>
        {t('Las referencias al Estatuto de los Trabajadores son mínimos legales mostrados como información. El convenio colectivo aplicable puede mejorarlos y debe revisarlo la asesoría laboral antes de configurar saldos o reglas. La aplicación no certifica el cumplimiento.')}
      </Callout>
      <Card title={t('Tipos de ausencia')} flush>
        {types.length === 0 ? (
          <EmptyState title={t('No hay tipos de ausencia configurados')} />
        ) : (
          <div className="table-wrap">
            <table className="table settings-types">
              <caption className="sr-only">{t('Tipos de ausencia')}</caption>
              <thead>
                <tr>
                  <th>{t('Tipo')}</th>
                  <th>{t('Referencia')}</th>
                  <th>{t('Retribución')}</th>
                  <th>{t('Aprobación')}</th>
                  <th>{t('Justificante')}</th>
                  <th>{t('Sensible')}</th>
                  <th>{t('Por horas')}</th>
                  <th>{t('Saldo anual')}</th>
                  <th>{t('Versión')}</th>
                  <th>{t('Estado')}</th>
                  {canEdit && <th><span className="sr-only">{t('Acciones')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {types.map((x) => (
                  <tr key={x.id} className={x.active ? undefined : 'settings-muted-row'}>
                    <td>
                      <span className="strong">{x.name}</span>
                      <div className="sub mono">{x.code}</div>
                      {x.note && <div className="sub">{x.note}</div>}
                    </td>
                    <td className="small">
                      {x.legalReference}
                      {x.referenceDuration && <div className="sub">{x.referenceDuration}</div>}
                    </td>
                    <td>{t(PAID_LABEL[x.paid])}</td>
                    <td>{x.requiresApproval ? t('Requiere aprobación') : t('Se registra sin aprobación')}</td>
                    <td>{t(EVIDENCE_LABEL[x.evidence])}</td>
                    <td>{x.sensitive ? <Badge tone="warning" title={t('Se muestra como «categoría reservada» a supervisores, propiedad y representación.')}>{t('Sensible')}</Badge> : t('No')}</td>
                    <td>{yesNo(x.allowsPartialDay)}</td>
                    <td>
                      {x.allowance ? (
                        <>
                          <span className="nowrap">
                            {fmtNum(x.allowance.days)} {t(UNIT_LABEL[x.allowance.unit])} · {x.allowance.year}
                          </span>
                          <div>
                            {x.allowance.adviserApproved ? <Badge tone="success">{t('Validado por la asesoría')}</Badge> : <Badge tone="warning">{t('Pendiente de validar: no se muestra saldo')}</Badge>}
                          </div>
                        </>
                      ) : (
                        <span className="muted small">{t('Sin saldo configurado')}</span>
                      )}
                    </td>
                    <td className="nowrap">
                      {t('v{v}', { v: x.version })}
                      <div className="sub">
                        {t('desde')} <DateText date={x.effectiveFrom} />
                      </div>
                    </td>
                    <td>
                      <Badge tone={x.active ? 'success' : 'neutral'}>{x.active ? t('Activo') : t('Inactivo')}</Badge>
                    </td>
                    {canEdit && (
                      <td>
                        <Button size="sm" icon={Pencil} onClick={() => setEditing(x)} aria-label={t('Editar {name}', { name: x.name })}>
                          {t('Editar')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer tiny muted">
          {canEdit ? t('Cada cambio crea una nueva versión con efecto hoy. Las solicitudes ya existentes no cambian.') : t('Su rol puede consultar los tipos de ausencia; solo Administración de RR. HH. puede modificarlos.')}
        </div>
      </Card>
      {editing && <EditTypeModal ctx={ctx} type={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditTypeModal({ ctx, type, onClose }: { ctx: UiCtx; type: AbsenceType; onClose: () => void }) {
  const { run, pending } = useAction();
  const [name, setName] = useState(type.name);
  const [requiresApproval, setRequiresApproval] = useState(type.requiresApproval);
  const [evidence, setEvidence] = useState(type.evidence);
  const [partial, setPartial] = useState(type.allowsPartialDay);
  const [active, setActive] = useState(type.active);
  const [note, setNote] = useState(type.note);
  const [hasAllowance, setHasAllowance] = useState(!!type.allowance);
  const [days, setDays] = useState(type.allowance ? String(type.allowance.days) : '');
  const [unit, setUnit] = useState<'natural' | 'working'>(type.allowance?.unit ?? 'natural');
  const [adviserApproved, setAdviserApproved] = useState(type.allowance?.adviserApproved ?? false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string[]>([]);

  const submit = async () => {
    const e: Record<string, string> = {};
    const nDays = Number(days.replace(',', '.'));
    if (!name.trim()) e.name = t('Indique el nombre del tipo de ausencia.');
    if (hasAllowance && !(nDays > 0 && nDays <= 60)) e.days = t('El saldo anual debe estar entre 1 y 60 días.');
    if (reason.trim().length < 5) e.reason = t('Indique el motivo del cambio (mínimo 5 caracteres).');
    const allowance: AbsenceType['allowance'] = hasAllowance ? { days: nDays, unit, year: type.allowance?.year ?? Number(ctx.today.slice(0, 4)), adviserApproved } : null;
    const next = { name: name.trim(), requiresApproval, evidence: type.sensitive ? 'none' : evidence, allowsPartialDay: partial, active, note: note.trim(), allowance };
    const patch: Partial<typeof next> = {};
    (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
      if (JSON.stringify(next[k]) !== JSON.stringify(type[k])) (patch as Record<string, unknown>)[k] = next[k];
    });
    const noChanges = Object.keys(patch).length === 0;
    setErrors(e);
    setGeneral(noChanges ? ['No hay cambios que guardar.'] : []);
    if (Object.keys(e).length || noChanges) return;
    const ok = await run(() => updateAbsenceType(type.id, patch, reason.trim()), (r) => t('Tipo de ausencia actualizado (versión {v})', { v: r.version }));
    if (ok) onClose();
  };

  return (
    <Modal
      wide
      title={t('Editar tipo de ausencia')}
      description={`${type.code} · ${type.legalReference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Guardar nueva versión')}
          </Button>
        </>
      }
    >
      <Callout tone="info">{t('El cambio crea la versión {v} con efecto hoy. Las solicitudes existentes conservan sus datos y su historial.', { v: type.version + 1 })}</Callout>
      <GeneralErrors items={general} />
      <div className="form-grid">
        <TextField className="span-2" label={t('Nombre')} required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <SelectField label={t('Justificante')} value={type.sensitive ? 'none' : evidence} onChange={(e) => setEvidence(e.target.value as AbsenceType['evidence'])} disabled={type.sensitive} hint={type.sensitive ? t('Categoría sensible: no admite justificantes (minimización de datos de salud).') : undefined}>
          {(Object.keys(EVIDENCE_LABEL) as AbsenceType['evidence'][]).map((k) => (
            <option key={k} value={k}>{t(EVIDENCE_LABEL[k])}</option>
          ))}
        </SelectField>
        <div className="span-all stack-sm">
          <Checkbox label={t('Requiere aprobación')} hint={t('Si no la requiere, se registra directamente (por ejemplo, la baja médica comunicada por el INSS).')} checked={requiresApproval} onChange={setRequiresApproval} />
          <Checkbox label={t('Admite periodos por horas')} checked={partial} onChange={setPartial} />
          <Checkbox label={t('Activo')} hint={t('Un tipo inactivo no se puede elegir en nuevas solicitudes; las existentes se conservan.')} checked={active} onChange={setActive} />
        </div>
        <fieldset className="span-all">
          <legend>{t('Saldo anual')}</legend>
          <div className="stack-sm">
            <Checkbox label={t('Configurar un saldo anual')} hint={t('Solo se muestra a las personas empleadas si la asesoría lo ha validado.')} checked={hasAllowance} onChange={setHasAllowance} />
            {hasAllowance && (
              <div className="form-grid">
                <TextField label={t('Días')} required type="number" inputMode="decimal" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} error={errors.days} />
                <SelectField label={t('Unidad')} value={unit} onChange={(e) => setUnit(e.target.value as 'natural' | 'working')}>
                  <option value="natural">{t(UNIT_LABEL.natural)}</option>
                  <option value="working">{t(UNIT_LABEL.working)}</option>
                </SelectField>
                <div className="span-all">
                  <Checkbox label={t('Validado por la asesoría laboral')} hint={t('Marque solo con la validación documentada de la asesoría; sin ella no se muestran saldos.')} checked={adviserApproved} onChange={setAdviserApproved} />
                </div>
              </div>
            )}
          </div>
        </fieldset>
        <TextAreaField className="span-all" label={t('Nota interna')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <TextAreaField className="span-all" label={t('Motivo del cambio')} required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} hint={t('Queda registrado en la auditoría.')} />
      </div>
    </Modal>
  );
}
