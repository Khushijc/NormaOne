/**
 * "Políticas de jornada": versioned working-time policies (TIM-01, PLT-07, research R12–R17).
 * Thresholds drive configurable review indicators only; they never block, cap or decide pay.
 */
import { FilePlus2, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmployeeLink } from '../../components/bits';
import { Badge, Button, Callout, Card, Checkbox, DateText, DateTimeText, EmptyState, KV, Modal, TextAreaField, TextField, useAction } from '../../components/ui';
import { policyOn, relationshipOn } from '../../domain/records';
import { BREAK_KIND_LABEL } from '../../domain/status';
import { addDays, formatDate, isValidISODate } from '../../domain/time';
import type { BreakKind, IndicatorThresholds, WorkingTimePolicy } from '../../domain/types';
import { t } from '../../i18n';
import { userName, visibleEmployeeIds } from '../../services/context';
import { newPolicyVersion } from '../../services/planningService';
import { useCtx } from '../../store/hooks';
import { byName, POLICY_PHASE, policyPhase, THRESHOLDS } from './shared';

const BREAK_KINDS: BreakKind[] = ['rest', 'meal', 'other'];

function unitText(unit: 'h' | 'min'): string {
  return unit === 'h' ? 'h' : 'min';
}

export function PoliciesTab() {
  const ctx = useCtx();
  const canManage = ctx.can('policies.manage');
  const [editing, setEditing] = useState<WorkingTimePolicy | null>(null);

  const families = useMemo(() => {
    const map = new Map<string, WorkingTimePolicy[]>();
    for (const p of ctx.db.policies.filter((x) => x.companyId === ctx.company.id)) map.set(p.key, [...(map.get(p.key) ?? []), p]);
    return [...map.entries()]
      .map(([key, versions]) => ({ key, versions: versions.sort((a, b) => b.version - a.version) }))
      .sort((a, b) => a.versions[0].name.localeCompare(b.versions[0].name, 'es'));
  }, [ctx]);

  const usage = useMemo(() => {
    const visible = visibleEmployeeIds(ctx);
    const map = new Map<string, { total: number; visible: typeof ctx.db.employees }>();
    for (const e of ctx.db.employees.filter((x) => x.companyId === ctx.company.id && x.status === 'active').sort(byName)) {
      const rel = relationshipOn(ctx.db, e.id, ctx.today);
      if (!rel) continue;
      const u = map.get(rel.policyKey) ?? { total: 0, visible: [] };
      u.total += 1;
      if (visible.has(e.id)) u.visible.push(e);
      map.set(rel.policyKey, u);
    }
    return map;
  }, [ctx]);

  return (
    <div className="stack">
      <Callout tone="info" title={t('Indicadores de revisión configurables, no conclusiones legales')}>
        {t('Los umbrales de cada política solo generan avisos para revisar. No existe una regla universal de «más de 6 h = horas extra»: las horas extraordinarias, las complementarias de los contratos a tiempo parcial y su compensación dependen del convenio, del contrato y de la revisión de la asesoría laboral (ET arts. 12.5 y 35). JornadaPulse no calcula importes ni el tratamiento en nómina.')}
      </Callout>
      <Callout tone="neutral" title={t('Versiones con fecha de efecto')}>
        {t('Cada versión se aplica desde su fecha de efecto. Los registros ya realizados se siguen calculando con la versión vigente en su fecha: una versión nueva nunca es retroactiva.')}
      </Callout>

      {families.length === 0 && (
        <Card>
          <EmptyState icon={Scale} title={t('No hay políticas de jornada configuradas')} />
        </Card>
      )}

      {families.map(({ key, versions }) => {
        const latest = versions[0];
        const current = policyOn(ctx.db, ctx.company.id, key, ctx.today);
        const agreement = ctx.db.agreements.find((a) => a.id === latest.agreementId);
        const used = usage.get(key);
        return (
          <Card
            key={key}
            title={
              <h2>
                {latest.name} <span className="tag">{key}</span>
              </h2>
            }
            actions={
              canManage && (
                <Button size="sm" icon={FilePlus2} onClick={() => setEditing(latest)}>
                  {t('Nueva versión')}
                </Button>
              )
            }
          >
            <div className="stack">
              <KV
                items={[
                  [t('Convenio de referencia'), agreement?.name ?? '—'],
                  [t('Versión vigente hoy'), current ? t('v{v} desde el {date}', { v: current.version, date: formatDate(current.effectiveFrom) }) : t('Ninguna versión vigente hoy')],
                  [
                    t('Se aplica hoy a'),
                    used ? (
                      <span className="stack-sm" style={{ gap: 4 }}>
                        <span>{t('{n} personas (condiciones laborales vigentes hoy)', { n: used.total })}</span>
                        {used.visible.length > 0 && (
                          <span className="plan-people">
                            {used.visible.map((e) => (
                              <EmployeeLink key={e.id} id={e.id} />
                            ))}
                          </span>
                        )}
                      </span>
                    ) : (
                      t('Nadie tiene asignada esta política hoy')
                    ),
                  ],
                ]}
              />
              <div className="table-wrap">
                <table className="table plan-policy-table">
                  <caption className="sr-only">{t('Versiones de la política {name}', { name: latest.name })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('Versión')}</th>
                      <th scope="col">{t('Vigencia')}</th>
                      <th scope="col">{t('Pausas retribuidas')}</th>
                      <th scope="col">{t('Umbrales de los indicadores')}</th>
                      <th scope="col">{t('Base')}</th>
                      <th scope="col">{t('Edición y aprobación')}</th>
                      <th scope="col">{t('Motivo del cambio')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((p) => {
                      const phase = POLICY_PHASE[policyPhase(p, ctx.today)];
                      return (
                        <tr key={p.id}>
                          <td>
                            <div className="strong">v{p.version}</div>
                            <Badge tone={phase.tone} title={t(phase.help)}>{t(phase.label)}</Badge>
                          </td>
                          <td className="nowrap">
                            <div><span className="muted tiny">{t('Desde')}</span> <DateText date={p.effectiveFrom} /></div>
                            <div><span className="muted tiny">{t('Hasta')}</span> {p.effectiveTo ? <DateText date={p.effectiveTo} /> : <span className="muted">{t('sin fecha de fin')}</span>}</div>
                          </td>
                          <td>
                            <div>{p.breaks.paidBreakKinds.length ? breakKindsText(p.breaks.paidBreakKinds) : <span className="muted">{t('Ninguna')}</span>}</div>
                            <div className="tiny muted">{t('Informativo: {m} min/día', { m: p.breaks.paidBreakMinutes })}</div>
                          </td>
                          <td>
                            <ThresholdList th={p.indicators} />
                          </td>
                          <td className="small plan-wide-text">{p.basis}</td>
                          <td className="small">
                            <div>{t('Editada por {name}', { name: userName(ctx.db, p.editedBy) })}</div>
                            <div className="tiny muted"><DateTimeText at={p.editedAt} tz={ctx.company.timezone} /></div>
                            <div style={{ marginTop: 4 }}>
                              {p.approvedBy ? (
                                <Badge tone="success">{t('Aprobada por {name}', { name: p.approvedBy })}</Badge>
                              ) : (
                                <Badge tone="warning">{t('Sin aprobación de la asesoría')}</Badge>
                              )}
                            </div>
                          </td>
                          <td className="small plan-wide-text">{p.changeReason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        );
      })}

      {editing && <NewVersionModal latest={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ThresholdList({ th }: { th: IndicatorThresholds }) {
  return (
    <ul className="plan-thresholds">
      {THRESHOLDS.map((d) => (
        <li key={d.key} title={t(d.help)}>
          <span className="muted">{t(d.label)}:</span> <span className="num">{th[d.key]} {unitText(d.unit)}</span>
        </li>
      ))}
      <li>
        <span className="muted">{t('Franja nocturna')}:</span> <span className="num">{th.nightStart}–{th.nightEnd}</span>
      </li>
    </ul>
  );
}

// ─────────────────────────────── New version ───────────────────────────────

type NumKey = (typeof THRESHOLDS)[number]['key'];

function initialNums(p: WorkingTimePolicy): Record<NumKey, string> {
  const out = {} as Record<NumKey, string>;
  for (const d of THRESHOLDS) out[d.key] = String(p.indicators[d.key]);
  return out;
}

function breakKindsText(kinds: BreakKind[]): string {
  return kinds.map((k) => t(BREAK_KIND_LABEL[k])).join(', ');
}

function NewVersionModal({ latest, onClose }: { latest: WorkingTimePolicy; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const minDate = latest.effectiveFrom >= ctx.today ? addDays(latest.effectiveFrom, 1) : ctx.today;
  const [effectiveFrom, setEffectiveFrom] = useState(minDate);
  const [paidKinds, setPaidKinds] = useState<BreakKind[]>(latest.breaks.paidBreakKinds);
  const [paidMinutes, setPaidMinutes] = useState(String(latest.breaks.paidBreakMinutes));
  const [nums, setNums] = useState(() => initialNums(latest));
  const [nightStart, setNightStart] = useState(latest.indicators.nightStart);
  const [nightEnd, setNightEnd] = useState(latest.indicators.nightEnd);
  const [basis, setBasis] = useState(latest.basis);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const n = (k: NumKey) => Number(nums[k].replace(',', '.'));
  const errors: Partial<Record<string, string>> = {};
  if (!isValidISODate(effectiveFrom)) errors.effectiveFrom = t('Indique la fecha de efecto.');
  else if (effectiveFrom < ctx.today) errors.effectiveFrom = t('No puede ser anterior a hoy: las versiones anteriores siguen aplicándose a sus fechas.');
  else if (effectiveFrom <= latest.effectiveFrom) errors.effectiveFrom = t('Debe ser posterior al inicio de la versión vigente ({date}).', { date: formatDate(latest.effectiveFrom) });
  for (const d of THRESHOLDS) if (nums[d.key].trim() === '' || Number.isNaN(n(d.key))) errors[d.key] = t('Indique un número.');
  if (!errors.dailyOrdinaryMaxHours && (n('dailyOrdinaryMaxHours') <= 0 || n('dailyOrdinaryMaxHours') > 12)) errors.dailyOrdinaryMaxHours = t('Entre 1 y 12 horas.');
  if (!errors.minRestBetweenDaysHours && (n('minRestBetweenDaysHours') < 0 || n('minRestBetweenDaysHours') > 24)) errors.minRestBetweenDaysHours = t('Entre 0 y 24 horas.');
  if (!errors.longSessionHours && n('longSessionHours') <= 0) errors.longSessionHours = t('Debe ser mayor que 0.');
  if (!errors.continuousWorkBreakAfterHours && n('continuousWorkBreakAfterHours') <= 0) errors.continuousWorkBreakAfterHours = t('Debe ser mayor que 0.');
  if (!errors.shortSessionMinutes && n('shortSessionMinutes') < 0) errors.shortSessionMinutes = t('No puede ser negativo.');
  if (!errors.minBreakMinutes && n('minBreakMinutes') < 0) errors.minBreakMinutes = t('No puede ser negativo.');
  if (!errors.missingClockOutAfterHours && n('missingClockOutAfterHours') < 4) errors.missingClockOutAfterHours = t('Como mínimo 4 horas.');
  const pm = Number(paidMinutes.replace(',', '.'));
  if (paidMinutes.trim() === '' || Number.isNaN(pm) || pm < 0) errors.paidMinutes = t('Indique un número igual o mayor que 0.');
  if (!/^\d{2}:\d{2}$/.test(nightStart) || !/^\d{2}:\d{2}$/.test(nightEnd)) errors.night = t('Indique la franja nocturna en formato HH:MM.');
  if (!basis.trim()) errors.basis = t('Indique la base (convenio, acuerdo o decisión de la empresa).');
  if (reason.trim().length < 10) errors.reason = t('Explique el motivo del cambio (al menos 10 caracteres).');
  const hasErrors = Object.keys(errors).length > 0;
  const show = (k: string) => (touched ? errors[k] : undefined);

  const changes: string[] = [];
  const sameKinds = [...paidKinds].sort().join(',') === [...latest.breaks.paidBreakKinds].sort().join(',');
  if (!sameKinds) changes.push(`${t('Pausas retribuidas')}: ${latest.breaks.paidBreakKinds.map((k) => t(BREAK_KIND_LABEL[k])).join(', ') || '—'} → ${paidKinds.map((k) => t(BREAK_KIND_LABEL[k])).join(', ') || '—'}`);
  if (!Number.isNaN(pm) && pm !== latest.breaks.paidBreakMinutes) changes.push(`${t('Minutos de pausa retribuida (informativo)')}: ${latest.breaks.paidBreakMinutes} → ${pm}`);
  for (const d of THRESHOLDS) if (!Number.isNaN(n(d.key)) && n(d.key) !== latest.indicators[d.key]) changes.push(`${t(d.label)}: ${latest.indicators[d.key]} → ${n(d.key)} ${unitText(d.unit)}`);
  if (nightStart !== latest.indicators.nightStart || nightEnd !== latest.indicators.nightEnd) changes.push(`${t('Franja nocturna')}: ${latest.indicators.nightStart}–${latest.indicators.nightEnd} → ${nightStart}–${nightEnd}`);
  if (basis.trim() !== latest.basis) changes.push(t('Base modificada'));

  const submit = async () => {
    setTouched(true);
    if (hasErrors) return;
    const indicators: IndicatorThresholds = { ...latest.indicators, nightStart, nightEnd };
    for (const d of THRESHOLDS) indicators[d.key] = n(d.key);
    const r = await run(
      () => newPolicyVersion(latest.key, { breaks: { paidBreakKinds: paidKinds, paidBreakMinutes: pm }, indicators, basis: basis.trim() }, effectiveFrom, reason.trim()),
      (p) => t('Versión {v} creada con efecto {date}. Los registros anteriores mantienen la versión vigente en su fecha.', { v: p.version, date: formatDate(p.effectiveFrom) }),
    );
    if (r) onClose();
  };

  const toggleKind = (k: BreakKind, on: boolean) => setPaidKinds((xs) => (on ? [...xs.filter((x) => x !== k), k] : xs.filter((x) => x !== k)));

  return (
    <Modal
      wide
      title={t('Nueva versión de «{name}»', { name: latest.name })}
      description={t('Parte de la versión {v}. La versión nueva se aplica desde su fecha de efecto; los registros existentes conservan la versión vigente en su fecha.', { v: latest.version })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Crear versión {v}', { v: latest.version + 1 })}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="info">
          {t('Los umbrales son indicadores de revisión configurables, no conclusiones legales: nunca bloquean un fichaje, no limitan horas y no deciden si algo es hora extra. No existe una regla universal de «más de 6 h = horas extra».')}
        </Callout>
        <div className="form-grid">
          <TextField label={t('Fecha de efecto')} required type="date" min={minDate} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} error={show('effectiveFrom')} hint={t('Hoy o posterior. No se admiten efectos retroactivos.')} />
        </div>

        <fieldset className="plan-fieldset">
          <legend>{t('Pausas')}</legend>
          <p className="tiny muted">{t('Las pausas registradas de los tipos marcados cuentan como tiempo de trabajo (no se descuentan). Las demás pausas registradas se descuentan del tiempo neto. Nunca se descuenta una pausa que no se haya registrado (ET art. 34.4).')}</p>
          <div className="row-wrap">
            {BREAK_KINDS.map((k) => (
              <Checkbox key={k} label={t(BREAK_KIND_LABEL[k])} checked={paidKinds.includes(k)} onChange={(on) => toggleKind(k, on)} />
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <TextField label={t('Minutos de pausa retribuida (informativo)')} inputMode="decimal" value={paidMinutes} onChange={(e) => setPaidMinutes(e.target.value)} error={show('paidMinutes')} hint={t('Dato informativo del acuerdo; no se aplica a ningún cálculo.')} />
          </div>
        </fieldset>

        <fieldset className="plan-fieldset">
          <legend>{t('Umbrales de los indicadores de revisión')}</legend>
          <div className="form-grid">
            {THRESHOLDS.map((d) => (
              <TextField
                key={d.key}
                label={`${t(d.label)} (${unitText(d.unit)})`}
                inputMode="decimal"
                value={nums[d.key]}
                onChange={(e) => setNums((x) => ({ ...x, [d.key]: e.target.value }))}
                error={show(d.key)}
                hint={t(d.help)}
              />
            ))}
            <TextField label={t('Inicio de la franja nocturna')} type="time" value={nightStart} onChange={(e) => setNightStart(e.target.value)} error={show('night')} hint={t('ET art. 36.1: trabajo nocturno entre las 22:00 y las 06:00. La clasificación como trabajador nocturno requiere revisión profesional.')} />
            <TextField label={t('Fin de la franja nocturna')} type="time" value={nightEnd} onChange={(e) => setNightEnd(e.target.value)} />
          </div>
        </fieldset>

        <TextAreaField label={t('Base de la regla')} required rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} error={show('basis')} hint={t('Artículo del convenio, acuerdo de empresa o decisión previa consulta. Se muestra junto a cada indicador.')} />
        <TextAreaField label={t('Motivo del cambio')} required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={show('reason')} hint={t('Queda registrado en la versión y en la auditoría.')} />

        <div className="small">
          <div className="strong">{t('Cambios respecto a la versión {v}', { v: latest.version })}</div>
          {changes.length === 0 ? (
            <p className="muted">{t('Sin cambios en pausas, umbrales ni base.')}</p>
          ) : (
            <ul className="plan-changes">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
