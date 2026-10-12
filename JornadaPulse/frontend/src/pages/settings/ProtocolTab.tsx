/**
 * How the company organises its time record (ET art. 34.9: by collective agreement, company
 * agreement or, failing that, company decision after consulting the workers' representatives).
 * The draft Royal Decree on digital time recording (research doc L3) is NOT in force.
 */
import { FilePlus2, Fingerprint } from 'lucide-react';
import { useState } from 'react';
import { SOURCE_LABEL } from '../../domain/status';
import { formatDate, isValidISODate } from '../../domain/time';
import type { ClockSource, RecordingProtocol } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { newProtocolVersion } from '../../services/planningService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { Badge, Button, Callout, Card, Checkbox, DateText, DateTimeText, EmptyState, KV, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { GeneralErrors } from '../team/employeeForms';

export const BASIS_LABEL: Record<RecordingProtocol['basis'], string> = {
  convenio: tKey('Convenio colectivo'),
  acuerdo_empresa: tKey('Acuerdo de empresa'),
  decision_previa_consulta: tKey('Decisión de la empresa previa consulta a la representación'),
};

/** Sources a protocol may allow. Corrections are not a clocking source; biometrics do not exist. */
const PROTOCOL_SOURCES: ClockSource[] = ['web', 'mobile', 'kiosk_pin', 'import'];

export function ProtocolTab() {
  const ctx = useCtx();
  const [creating, setCreating] = useState(false);
  const all = ctx.db.protocols.filter((p) => p.companyId === ctx.company.id).sort((a, b) => b.version - a.version);
  const active = all.find((p) => p.status === 'active');
  const canManage = ctx.can('settings.manage');
  return (
    <div className="stack">
      <Callout tone="info" title={t('Proyecto de Real Decreto de registro digital: no vigente')}>
        {t('El Ministerio de Trabajo sometió a audiencia pública en octubre de 2025 un proyecto de Real Decreto sobre el registro digital de jornada. En la última comprobación documentada (12/10/2026) no estaba publicado en el BOE, por lo que no es obligatorio; debe volver a comprobarse antes de usar la aplicación en producción. Se muestra solo como nota informativa: la aplicación está preparada para algunos de sus contenidos (modalidad, pausas, correcciones con conformidad), pero no los presenta como obligaciones.')}
      </Callout>

      <Card
        title={t('Protocolo de registro en vigor (ET art. 34.9)')}
        actions={
          canManage ? (
            <Button variant="primary" size="sm" icon={FilePlus2} onClick={() => setCreating(true)}>
              {t('Nueva versión')}
            </Button>
          ) : null
        }
      >
        {active ? (
          <div className="stack">
            <KV
              items={[
                [t('Versión'), <span>{t('v{v}', { v: active.version })} <Badge tone="success">{t('Vigente')}</Badge></span>],
                [t('Con efecto desde'), <DateText date={active.effectiveFrom} />],
                [t('Base de la organización del registro'), t(BASIS_LABEL[active.basis])],
                [t('Referencia'), active.basisReference],
                [t('Consulta a la representación'), active.consultedRepresentativesOn ? <DateText date={active.consultedRepresentativesOn} /> : <span className="muted">{ctx.company.workerRepresentation === 'none' ? t('No aplica: la empresa no tiene representación legal') : t('Sin fecha registrada')}</span>],
                [
                  t('Medios de registro permitidos'),
                  <span className="row-wrap">
                    {active.sources.map((s) => (
                      <Badge key={s} tone="neutral" icon={false}>{t(SOURCE_LABEL[s])}</Badge>
                    ))}
                    <Badge tone="info" icon={Fingerprint}>{t('Sin biometría')}</Badge>
                  </span>,
                ],
                [t('Procedimiento de corrección'), active.correctionProcedure],
                [t('Si falla la conexión'), active.connectivityFallback],
                [t('Aprobado por'), <span>{active.approvedBy} · <DateTimeText at={active.approvedAt} tz={ctx.company.timezone} /></span>],
              ]}
            />
            <p className="tiny muted">{t('El cierre de periodos exige un protocolo aprobado. No se ofrece huella dactilar ni reconocimiento facial: según la guía de la AEPD, el registro de jornada no justifica el tratamiento de datos biométricos.')}</p>
          </div>
        ) : (
          <EmptyState title={t('No hay protocolo de registro en vigor')}>{t('Sin protocolo aprobado no se pueden cerrar periodos. Cree la primera versión indicando su base (convenio, acuerdo o decisión previa consulta).')}</EmptyState>
        )}
      </Card>

      <Card title={t('Historial de versiones')} flush>
        {all.length === 0 ? (
          <EmptyState title={t('Sin versiones registradas')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Historial de versiones del protocolo de registro')}</caption>
              <thead>
                <tr>
                  <th>{t('Versión')}</th>
                  <th>{t('Con efecto desde')}</th>
                  <th>{t('Base')}</th>
                  <th>{t('Referencia')}</th>
                  <th>{t('Medios')}</th>
                  <th>{t('Aprobado por')}</th>
                  <th>{t('Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {all.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{t('v{v}', { v: p.version })}</td>
                    <td>
                      <DateText date={p.effectiveFrom} />
                    </td>
                    <td>{t(BASIS_LABEL[p.basis])}</td>
                    <td className="small">{p.basisReference}</td>
                    <td className="small">{p.sources.map((s) => t(SOURCE_LABEL[s])).join(', ')}</td>
                    <td className="small">
                      {p.approvedBy}
                      <div className="sub">
                        <DateTimeText at={p.approvedAt} tz={ctx.company.timezone} />
                      </div>
                    </td>
                    <td>
                      <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.status === 'active' ? t('Vigente') : t('Sustituida')}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer tiny muted">{t('Las versiones anteriores se conservan como historial y en la auditoría; no se pueden editar.')}</div>
      </Card>

      {creating && <NewProtocolModal ctx={ctx} current={active} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProtocolModal({ ctx, current, onClose }: { ctx: UiCtx; current: RecordingProtocol | undefined; onClose: () => void }) {
  const { run, pending } = useAction();
  const [basis, setBasis] = useState<RecordingProtocol['basis']>(current?.basis ?? 'decision_previa_consulta');
  const [basisReference, setBasisReference] = useState(current?.basisReference ?? '');
  const [consulted, setConsulted] = useState(current?.consultedRepresentativesOn ?? '');
  const [sources, setSources] = useState<ClockSource[]>(current?.sources.filter((s) => PROTOCOL_SOURCES.includes(s)) ?? ['web']);
  const [correctionProcedure, setCorrectionProcedure] = useState(current?.correctionProcedure ?? '');
  const [connectivityFallback, setConnectivityFallback] = useState(current?.connectivityFallback ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(ctx.today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string[]>([]);
  const needsConsultation = basis === 'decision_previa_consulta' && ctx.company.workerRepresentation !== 'none';

  const toggle = (s: ClockSource, on: boolean) => setSources((xs) => (on ? [...xs, s] : xs.filter((x) => x !== s)));

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!basisReference.trim()) e.basisReference = t('Indique la referencia del acuerdo, convenio o consulta.');
    if (needsConsultation && !isValidISODate(consulted)) e.consulted = t('Indique la fecha de consulta a la representación legal (ET art. 34.9).');
    if (!sources.length) e.sources = t('Seleccione al menos un medio de registro.');
    if (!correctionProcedure.trim()) e.correctionProcedure = t('Describa cómo se corrigen los errores u omisiones.');
    if (!connectivityFallback.trim()) e.connectivityFallback = t('Describa qué hacer si un fichaje no se registra.');
    if (!isValidISODate(effectiveFrom) || effectiveFrom < ctx.today) e.effectiveFrom = t('La fecha de efecto debe ser hoy o posterior.');
    setErrors(e);
    setGeneral([]);
    if (Object.keys(e).length) return;
    const ok = await run(
      () => newProtocolVersion({ basis, basisReference: basisReference.trim(), consultedRepresentativesOn: isValidISODate(consulted) ? consulted : null, sources, correctionProcedure: correctionProcedure.trim(), connectivityFallback: connectivityFallback.trim() }, effectiveFrom),
      (r) => t('Protocolo v{v} registrado con efecto {date}', { v: r.version, date: formatDate(r.effectiveFrom) }),
    );
    if (ok) onClose();
  };

  return (
    <Modal
      wide
      title={t('Nueva versión del protocolo de registro')}
      description={current ? t('Sustituye a la versión {v}. La versión anterior queda en el historial.', { v: current.version }) : undefined}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Aprobar y registrar')}
          </Button>
        </>
      }
    >
      <Callout tone="info">{t('ET art. 34.9: el registro se organiza mediante negociación colectiva o acuerdo de empresa o, en su defecto, por decisión de la empresa previa consulta con la representación legal de las personas trabajadoras.')}</Callout>
      <GeneralErrors items={general} />
      <div className="form-grid">
        <SelectField className="span-2" label={t('Base de la organización del registro')} required value={basis} onChange={(e) => setBasis(e.target.value as RecordingProtocol['basis'])}>
          {(Object.keys(BASIS_LABEL) as RecordingProtocol['basis'][]).map((k) => (
            <option key={k} value={k}>{t(BASIS_LABEL[k])}</option>
          ))}
        </SelectField>
        <TextField label={t('Con efecto desde')} required type="date" min={ctx.today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} error={errors.effectiveFrom} />
        <TextField className="span-2" label={t('Referencia')} required value={basisReference} onChange={(e) => setBasisReference(e.target.value)} error={errors.basisReference} hint={t('Artículo del convenio, acuerdo firmado o acta de la consulta.')} />
        <TextField label={t('Fecha de consulta a la representación')} required={needsConsultation} type="date" value={consulted} onChange={(e) => setConsulted(e.target.value)} error={errors.consulted} hint={ctx.company.workerRepresentation === 'none' ? t('La empresa no tiene representación legal registrada.') : undefined} />
        <fieldset className="span-all">
          <legend>
            {t('Medios de registro permitidos')}
            <span className="req" aria-hidden>*</span>
          </legend>
          <div className="settings-sources">
            {PROTOCOL_SOURCES.map((s) => (
              <Checkbox key={s} label={t(SOURCE_LABEL[s])} checked={sources.includes(s)} onChange={(on) => toggle(s, on)} />
            ))}
          </div>
          <p className="tiny muted">{t('Sin biometría ni geolocalización: no existen como medio de registro en esta aplicación.')}</p>
          {errors.sources && (
            <span className="error settings-error" role="alert">
              {errors.sources}
            </span>
          )}
        </fieldset>
        <TextAreaField className="span-all" label={t('Procedimiento de corrección')} required rows={3} value={correctionProcedure} onChange={(e) => setCorrectionProcedure(e.target.value)} error={errors.correctionProcedure} />
        <TextAreaField className="span-all" label={t('Si falla la conexión')} required rows={3} value={connectivityFallback} onChange={(e) => setConnectivityFallback(e.target.value)} error={errors.connectivityFallback} />
      </div>
      <p className="tiny muted">{t('Se registrará como aprobada por {name} en este momento.', { name: ctx.user.name })}</p>
    </Modal>
  );
}
