/**
 * Forms of the restricted health area. Every save goes through healthService; the inline checks
 * only mirror the service rules so the user sees problems before submitting.
 */
import { ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { versionOn } from '../../domain/requirements';
import { FITNESS_LABEL } from '../../domain/status';
import { formatDate } from '../../domain/time';
import type { FitnessConclusion, HealthOffer, ID } from '../../domain/types';
import { t } from '../../i18n';
import { employeeName } from '../../services/context';
import { healthRows, recordConclusion, recordOffer, recordResponse } from '../../services/healthService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { Button, Callout, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { BASIS_HELP, BASIS_LABEL, requirementLabel } from './healthShared';

/** Health requirements whose current approved version is a health-surveillance one. */
function healthRequirements(ctx: UiCtx) {
  return ctx.db.templates
    .filter((tp) => tp.companyId === ctx.company.id && !tp.retiredAt)
    .map((tp) => ({ tp, v: versionOn(ctx.db, tp.id, ctx.today) }))
    .filter((x) => x.v?.evidenceMode === 'health')
    .map((x) => ({ id: x.tp.id, label: `${x.tp.code} · ${x.v!.name}`, mandatory: x.v!.health?.kind === 'mandatory_exception' && x.v!.status === 'active' }));
}

const CLINICAL_RE = /diagn[oó]stic|patolog|enfermedad|tratamiento|medicaci/i;

// ─────────────────────────────── Offer ───────────────────────────────

export function OfferModal({ employeeId, onClose }: { employeeId: ID | null; onClose: () => void }) {
  const ctx = useCtx();
  const rows = useMemo(() => healthRows(ctx), [ctx]);
  const reqs = useMemo(() => healthRequirements(ctx), [ctx]);
  const voluntary = reqs.filter((r) => !r.mandatory);
  const mandatory = reqs.filter((r) => r.mandatory);
  const [emp, setEmp] = useState<ID>(employeeId ?? '');
  const [basis, setBasis] = useState<HealthOffer['basis']>('voluntary');
  const [tpl, setTpl] = useState<ID>(voluntary[0]?.id ?? '');
  const [date, setDate] = useState(ctx.today);
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();
  const options = basis === 'voluntary' ? voluntary : mandatory;
  const pendingOffer = rows.find((r) => r.employee.id === emp)?.offers.some((o) => o.response === 'pending');

  const errors = {
    emp: !emp ? t('Seleccione la persona trabajadora.') : undefined,
    date: !date ? t('Indique la fecha de la oferta.') : date > ctx.today ? t('La fecha de la oferta no puede ser futura.') : undefined,
  };
  const changeBasis = (b: HealthOffer['basis']) => {
    setBasis(b);
    setTpl((b === 'voluntary' ? voluntary : mandatory)[0]?.id ?? '');
  };
  const submit = async () => {
    setTouched(true);
    if (errors.emp || errors.date) return;
    const r = await run(() => recordOffer({ employeeId: emp, templateId: tpl || null, basis, offeredAt: date }), t('Oferta registrada'));
    if (r) onClose();
  };

  return (
    <Modal
      title={t('Registrar oferta de vigilancia de la salud')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Registrar oferta')}
          </Button>
        </>
      }
    >
      <SelectField label={t('Persona trabajadora')} required value={emp} onChange={(e) => setEmp(e.target.value)} error={touched ? errors.emp : undefined}>
        <option value="">{t('Seleccione…')}</option>
        {rows.map((r) => (
          <option key={r.employee.id} value={r.employee.id}>
            {employeeName(ctx.db, r.employee.id)}
          </option>
        ))}
      </SelectField>
      {pendingOffer && <Callout tone="warning">{t('Esta persona ya tiene una oferta pendiente de respuesta: registre primero la respuesta.')}</Callout>}
      <fieldset className="health-fieldset">
        <legend>{t('Carácter de la oferta')}</legend>
        {(['voluntary', 'mandatory_exception'] as const).map((b) => (
          <label key={b} className="checkbox">
            <input type="radio" name="basis" value={b} checked={basis === b} onChange={() => changeBasis(b)} />
            <span>
              {t(BASIS_LABEL[b])}
              <span className="hint small muted" style={{ display: 'block' }}>
                {t(BASIS_HELP[b])}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {basis === 'mandatory_exception' && mandatory.length === 0 && (
        <Callout tone="warning" title={t('No hay ninguna excepción del art. 22.1 aprobada')}>
          {t('Un reconocimiento obligatorio solo puede registrarse con un requisito aprobado por el servicio médico que recoja la excepción y el informe previo de la representación. Sin él, el servicio rechazará el registro: ofrézcalo como voluntario.')}
        </Callout>
      )}
      <SelectField
        label={t('Requisito')}
        value={tpl}
        onChange={(e) => setTpl(e.target.value)}
        hint={basis === 'voluntary' ? t('Requisito de vigilancia de la salud al que corresponde la oferta.') : t('Solo requisitos aprobados con una excepción del art. 22.1 LPRL.')}
      >
        {basis === 'voluntary' && <option value="">{t('Sin requisito vinculado')}</option>}
        {basis === 'mandatory_exception' && options.length === 0 && <option value="">{t('Ninguno disponible')}</option>}
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </SelectField>
      <TextField label={t('Fecha de la oferta')} type="date" required max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? errors.date : undefined} />
    </Modal>
  );
}

// ─────────────────────────────── Response ───────────────────────────────

export function ResponseModal({ offer, onClose }: { offer: HealthOffer; onClose: () => void }) {
  const ctx = useCtx();
  const [response, setResponse] = useState<'accepted' | 'declined'>('accepted');
  const [date, setDate] = useState(ctx.today);
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();
  const dateError = !date ? t('Indique la fecha de la respuesta.') : date < offer.offeredAt || date > ctx.today ? t('La respuesta debe estar entre la oferta y hoy.') : undefined;
  const submit = async () => {
    setTouched(true);
    if (dateError) return;
    const r = await run(() => recordResponse(offer.id, response, date), response === 'accepted' ? t('Respuesta registrada: oferta aceptada') : t('Respuesta registrada: oferta no aceptada'));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Registrar respuesta a la oferta')}
      description={`${employeeName(ctx.db, offer.employeeId)} · ${t(BASIS_LABEL[offer.basis])} · ${formatDate(offer.offeredAt)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Registrar respuesta')}
          </Button>
        </>
      }
    >
      <p className="small muted">{requirementLabel(ctx, offer.templateId)}</p>
      <fieldset className="health-fieldset">
        <legend>{t('Respuesta de la persona trabajadora')}</legend>
        <label className="checkbox">
          <input type="radio" name="response" checked={response === 'accepted'} onChange={() => setResponse('accepted')} />
          <span>{t('Acepta la oferta')}</span>
        </label>
        <label className="checkbox">
          <input type="radio" name="response" checked={response === 'declined'} onChange={() => setResponse('declined')} />
          <span>
            {t('No acepta la oferta')}
            <span className="hint small muted" style={{ display: 'block' }}>
              {t('En una oferta voluntaria no es un incumplimiento y no bloquea la disponibilidad.')}
            </span>
          </span>
        </label>
      </fieldset>
      {response === 'declined' && offer.basis === 'mandatory_exception' && (
        <Callout tone="warning" title={t('Reconocimiento obligatorio')}>
          {t('La negativa a un reconocimiento obligatorio por una excepción confirmada profesionalmente no se registra como respuesta ordinaria: debe tratarla el servicio médico. El servicio rechazará este registro.')}
        </Callout>
      )}
      <TextField label={t('Fecha de la respuesta')} type="date" required min={offer.offeredAt} max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? dateError : undefined} />
      <p className="small muted">{t('Registre solo la respuesta (acepta / no acepta). Los motivos de la persona trabajadora no se guardan en el portal.')}</p>
    </Modal>
  );
}

// ─────────────────────────────── Conclusion ───────────────────────────────

const FITNESS_ORDER: FitnessConclusion[] = ['fit', 'fit_with_measures', 'temporarily_unfit', 'unfit'];

export function ConclusionModal({ employeeId, onClose }: { employeeId: ID | null; onClose: () => void }) {
  const ctx = useCtx();
  const rows = useMemo(() => healthRows(ctx), [ctx]);
  const [emp, setEmp] = useState<ID>(employeeId ?? '');
  const row = rows.find((r) => r.employee.id === emp);
  const accepted = (row?.offers ?? []).filter((o) => o.response === 'accepted');
  const [offerId, setOfferId] = useState<ID>(accepted[0]?.id ?? '');
  const [conclusion, setConclusion] = useState<FitnessConclusion>('fit');
  const [scope, setScope] = useState('');
  const [measures, setMeasures] = useState('');
  const [date, setDate] = useState(ctx.today);
  const [next, setNext] = useState('');
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();

  const changeEmp = (id: ID) => {
    setEmp(id);
    const r = rows.find((x) => x.employee.id === id);
    setOfferId(r?.offers.find((o) => o.response === 'accepted')?.id ?? '');
  };

  const clinicalHit = CLINICAL_RE.test(measures) || ctx.settings.clinicalKeywords.some((k) => k && measures.toLowerCase().includes(k.toLowerCase()));
  const errors = {
    emp: !emp ? t('Seleccione la persona trabajadora.') : undefined,
    scope: !scope.trim() ? t('Indique el puesto o las tareas evaluadas.') : undefined,
    measures: clinicalHit
      ? t('Parece contener información clínica. Describa solo la limitación operativa (qué tareas o condiciones evitar), sin diagnósticos ni tratamientos.')
      : conclusion !== 'fit' && !measures.trim()
        ? t('Indique las medidas preventivas o las tareas afectadas.')
        : undefined,
    date: !date ? t('Indique la fecha de la conclusión.') : date > ctx.today ? t('La conclusión no puede tener fecha futura.') : undefined,
    next: next && date && next <= date ? t('La próxima revisión debe ser posterior a la conclusión.') : undefined,
    reference: !reference.trim() ? t('Indique la referencia externa del expediente clínico.') : undefined,
  };
  const submit = async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const r = await run(
      () => recordConclusion({ employeeId: emp, offerId: offerId || null, conclusion, scope, measures, conclusionDate: date, nextReviewDate: next || null, clinicalRecordReference: reference }),
      t('Conclusión de aptitud registrada'),
    );
    if (r) onClose();
  };
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  return (
    <Modal
      wide
      title={t('Registrar conclusión de aptitud')}
      description={t('Solo la conclusión mínima que el servicio médico comunica a la empresa. Sin diagnósticos ni informes clínicos.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Registrar conclusión')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <SelectField label={t('Persona trabajadora')} required value={emp} onChange={(e) => changeEmp(e.target.value)} error={err('emp')}>
          <option value="">{t('Seleccione…')}</option>
          {rows.map((r) => (
            <option key={r.employee.id} value={r.employee.id}>
              {employeeName(ctx.db, r.employee.id)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('Oferta aceptada')}
          value={offerId}
          onChange={(e) => setOfferId(e.target.value)}
          hint={emp && accepted.length === 0 ? t('Esta persona no tiene ofertas aceptadas. La conclusión debe corresponder a una oferta aceptada o a un reconocimiento obligatorio.') : undefined}
        >
          <option value="">{t('Sin oferta vinculada')}</option>
          {accepted.map((o) => (
            <option key={o.id} value={o.id}>
              {t('{basis} · ofrecida el {date}', { basis: t(BASIS_LABEL[o.basis]), date: formatDate(o.offeredAt) })}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('Conclusión')} required value={conclusion} onChange={(e) => setConclusion(e.target.value as FitnessConclusion)} hint={t(FITNESS_LABEL[conclusion].help)}>
          {FITNESS_ORDER.map((c) => (
            <option key={c} value={c}>
              {t(FITNESS_LABEL[c].label)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('Ámbito (puesto o tareas evaluadas)')} required value={scope} onChange={(e) => setScope(e.target.value)} error={err('scope')} placeholder={t('Ej.: puesto actual según el protocolo')} />
      </div>
      {row?.conclusion && (
        <Callout tone="info">
          {t('La conclusión vigente ({label}, {date}) pasará al historial como sustituida.', { label: t(FITNESS_LABEL[row.conclusion.conclusion].label), date: formatDate(row.conclusion.conclusionDate) })}
        </Callout>
      )}
      <Callout tone="warning" icon={ShieldAlert} title={t('Sin información clínica')}>
        {t('No escriba diagnósticos, enfermedades, pruebas, tratamientos ni medicación. Indique solo la limitación operativa y las medidas que debe aplicar la empresa. El servicio rechaza textos con contenido clínico.')}
      </Callout>
      <TextAreaField
        label={t('Medidas preventivas operativas')}
        required={conclusion !== 'fit'}
        rows={3}
        value={measures}
        onChange={(e) => setMeasures(e.target.value)}
        error={err('measures') ?? (clinicalHit ? errors.measures : undefined)}
        hint={t('Ej.: evitar la manipulación manual de cargas superiores a 15 kg sin ayuda mecánica.')}
      />
      <div className="form-grid">
        <TextField label={t('Fecha de la conclusión')} type="date" required max={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={err('date')} />
        <TextField
          label={t('Próxima revisión (opcional)')}
          type="date"
          value={next}
          min={date || undefined}
          onChange={(e) => setNext(e.target.value)}
          error={err('next')}
          hint={t('Solo si el servicio médico la ha indicado. El portal no la calcula.')}
        />
      </div>
      <TextField
        label={t('Referencia externa del expediente clínico')}
        required
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        error={err('reference')}
        hint={t('Dónde se custodia la historia clínico-laboral (el informe no se guarda en el portal).')}
        placeholder={t('Ej.: historia clínico-laboral custodiada por el servicio médico (ref. HCL-…)')}
      />
    </Modal>
  );
}
