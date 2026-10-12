/**
 * Resumen tab of the employee profile: readiness per worksite with the reasons that explain it,
 * counters, confirmations and authorised exceptions. A blocked assignment can never be forced to
 * "ready": the critical requirement must be resolved, or covered by a time-limited exception
 * only where the approved requirement allows it.
 */
import { CheckCircle2, ShieldAlert, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import type { MatrixItem, Readiness } from '../../domain/requirements';
import { READINESS } from '../../domain/status';
import { addDays, formatDate } from '../../domain/time';
import type { Employee, ReadinessDecision } from '../../domain/types';
import { t } from '../../i18n';
import { userName, worksiteName } from '../../services/context';
import { confirmReady, EXCEPTION_MAX_DAYS, grantException, revokeDecision } from '../../services/peopleService';
import { useCtx } from '../../store/hooks';
import { msg, ReadinessBadge, ReadinessDisclaimer, WorksiteLink } from '../../components/bits';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, DateText, DateTimeText, EmptyState, Modal, TextAreaField, TextField, useAction } from '../../components/ui';
import { itemCounts } from './peopleData';

type Dialog = { kind: 'confirm'; r: Readiness } | { kind: 'exception'; r: Readiness; eligible: MatrixItem[] } | { kind: 'revoke'; d: ReadinessDecision } | null;

/** Blocking items that the approved policy allows to cover with an exception (never legal controls). */
function eligibleForException(r: Readiness): MatrixItem[] {
  const covered = new Set(r.exceptions.flatMap((e) => e.templateIds));
  return r.items.filter((it) => it.counted && it.critical && !it.satisfied && it.version.exceptionAllowed && it.version.source.kind !== 'law' && !covered.has(it.template.id));
}

export function ReadinessPanel({ emp, isSelf, items, readiness }: { emp: Employee; isSelf: boolean; items: MatrixItem[]; readiness: Readiness[] }) {
  const ctx = useCtx();
  const { runOk } = useAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const counts = itemCounts(items);
  const canDecide = ctx.can('readiness.decide') && !isSelf;
  const canException = ctx.can('readiness.exception') && !isSelf;
  const decisions = ctx.db.readinessDecisions.filter((d) => d.companyId === ctx.company.id && d.employeeId === emp.id).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const optional = items.filter((i) => i.version.requirementType === 'optional').length;

  const decisionStatus = (d: ReadinessDecision): { label: string; tone: 'success' | 'neutral' | 'warning' } => {
    if (d.revokedAt) return { label: t('Revocada [decisión]'), tone: 'neutral' };
    if (d.kind === 'exception' && d.validUntil && d.validUntil < ctx.today) return { label: t('Caducada [decisión]'), tone: 'neutral' };
    if (d.kind === 'confirmed_ready') {
      const r = readiness.find((x) => x.worksiteId === d.worksiteId);
      if (!r || r.confirmation?.id !== d.id) return { label: t('Ya no válida'), tone: 'warning' };
    }
    return { label: t('Vigente [decisión]'), tone: 'success' };
  };

  return (
    <div className="stack">
      {emp.status !== 'active' && (
        <Callout tone="warning" title={t('Persona inactiva desde el {date}', { date: formatDate(emp.endDate) })}>
          {t('No se calcula la disponibilidad de personas inactivas. Sus requisitos, evidencias y decisiones se conservan en el historial.')}
        </Callout>
      )}

      {emp.status === 'active' && (
        <div className="kpis">
          <div className="kpi">
            <span className="label">{t('Requisitos obligatorios aplicables')}</span>
            <span className="value">{counts.counted}</span>
            <span className="meta">{t('{n} opcionales · {na} no aplicables', { n: optional, na: counts.notApplicable })}</span>
          </div>
          <div className="kpi">
            <span className="label">{t('Evidencias aceptadas')}</span>
            <span className="value">{counts.accepted}</span>
            <span className="meta">{t('No equivale a una aprobación de seguridad')}</span>
          </div>
          <div className={`kpi ${counts.missing ? 'tone-warning' : ''}`}>
            <span className="label">{t('Evidencia pendiente de aportar')}</span>
            <span className="value">{counts.missing}</span>
            <span className="meta">{t('Sin aportar, solicitada, rechazada, caducada o sin confirmar')}</span>
          </div>
          <div className="kpi">
            <span className="label">{t('En revisión')}</span>
            <span className="value">{counts.awaiting}</span>
            <span className="meta">{t('Recibidas, pendientes de la autoridad de revisión')}</span>
          </div>
          <div className={`kpi ${counts.review ? 'tone-warning' : ''}`}>
            <span className="label">{t('Revisión profesional necesaria')}</span>
            <span className="value">{counts.review}</span>
            <span className="meta">{t('Fechas sin determinar o revisiones vencidas')}</span>
          </div>
          <div className={`kpi ${counts.criticalOpen ? 'tone-danger' : ''}`}>
            <span className="label">{t('Críticos sin resolver')}</span>
            <span className="value">{counts.criticalOpen}</span>
            <span className="meta">{t('Bloquean la disponibilidad')}</span>
          </div>
        </div>
      )}

      {emp.status === 'active' && readiness.length === 0 && (
        <Card>
          <EmptyState title={t('Sin asignación vigente a centros activos')}>{t('La disponibilidad se calcula por cada centro asignado. Asigne un puesto y al menos un centro activo en «Puestos y centros».')}</EmptyState>
        </Card>
      )}

      <div className="readiness-grid">
        {readiness.map((r) => {
          const eligible = eligibleForException(r);
          const blocking = r.reasons.filter((x) => x.state === 'blocked');
          return (
            <Card
              key={r.worksiteId}
              className="readiness-card"
              title={
                <div className="stack-sm" style={{ gap: 4 }}>
                  <h2>
                    <WorksiteLink id={r.worksiteId} />
                  </h2>
                  <div>
                    <ReadinessBadge state={r.state} />
                  </div>
                </div>
              }
            >
              <div className="stack-sm">
                <p className="small">
                  {t('{s} de {n} requisitos obligatorios resueltos · {c} críticos sin resolver', { s: r.counts.satisfied, n: r.counts.counted, c: r.counts.criticalOpen })}
                </p>
                {r.reasons.length > 0 ? (
                  <ul className="reason-list" aria-label={t('Motivos del estado')}>
                    {r.reasons.map((x, i) => (
                      <li key={i} className={`reason tone-${READINESS[x.state].tone}`}>
                        <span className="tiny muted">{t(READINESS[x.state].label)}</span>
                        <span className="small">{msg(x.msg)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">{t('Todas las evidencias obligatorias configuradas están aceptadas.')}</p>
                )}

                {r.confirmation && (
                  <div className="decision-box">
                    <div className="row-wrap">
                      <CheckCircle2 size={14} aria-hidden />
                      <span className="small strong">{t('Confirmada como lista')}</span>
                      <span className="tiny muted">
                        {userName(ctx.db, r.confirmation.decidedBy)} · <DateTimeText at={r.confirmation.decidedAt} />
                      </span>
                    </div>
                    <div className="tiny">{t('Nota')}: {r.confirmation.reason}</div>
                    {canDecide && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'revoke', d: r.confirmation! })}>
                        {t('Revocar confirmación')}
                      </Button>
                    )}
                  </div>
                )}
                {r.confirmationStale && (
                  <Callout tone="warning">{t('Existía una confirmación, pero el estado ha cambiado desde entonces: ya no es válida.')}</Callout>
                )}
                {r.exceptions.map((e) => (
                  <div key={e.id} className="decision-box warning">
                    <div className="row-wrap">
                      <ShieldAlert size={14} aria-hidden />
                      <span className="small strong">{t('Excepción autorizada hasta el {date}', { date: formatDate(e.validUntil) })}</span>
                    </div>
                    <div className="tiny">{t('Medida compensatoria')}: {e.compensatingMeasure ?? '—'}</div>
                    <div className="tiny">{t('Motivo')}: {e.reason}</div>
                    <div className="tiny muted">
                      {userName(ctx.db, e.decidedBy)} · <DateTimeText at={e.decidedAt} />
                    </div>
                    {canException && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'revoke', d: e })}>
                        {t('Revocar excepción')}
                      </Button>
                    )}
                  </div>
                ))}

                {r.state === 'blocked' && (canDecide || canException) && (
                  <Callout tone="danger" title={t('No se puede marcar como lista')}>
                    {t('Un requisito crítico configurado no está resuelto. Debe resolverse con evidencia aceptada por la autoridad de revisión; no existe ninguna opción para forzar el estado.')}
                    {blocking.length > 0 && (
                      <ul className="tiny" style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                        {blocking.map((x, i) => (
                          <li key={i}>{msg(x.msg)}</li>
                        ))}
                      </ul>
                    )}
                  </Callout>
                )}

                {(canDecide || canException) && (
                  <div className="row-wrap">
                    {canDecide && !r.confirmation && (
                      <Button variant="primary" size="sm" icon={CheckCircle2} disabled={r.state !== 'ready'} onClick={() => setDialog({ kind: 'confirm', r })} title={r.state !== 'ready' ? t('Solo se puede confirmar cuando el estado es «Listo según los requisitos configurados».') : undefined}>
                        {t('Confirmar como lista')}
                      </Button>
                    )}
                    {canException && r.state === 'blocked' && eligible.length > 0 && (
                      <Button size="sm" icon={ShieldOff} onClick={() => setDialog({ kind: 'exception', r, eligible })}>
                        {t('Excepción autorizada [decisión]')}
                      </Button>
                    )}
                  </div>
                )}
                {canDecide && !r.confirmation && r.state !== 'ready' && r.state !== 'blocked' && (
                  <p className="tiny muted">{t('Solo se puede confirmar cuando el estado es «Listo según los requisitos configurados».')}</p>
                )}
                {canException && r.state === 'blocked' && eligible.length === 0 && (
                  <p className="tiny muted">{t('Ningún requisito bloqueante admite excepción según la política aprobada (los controles obligatorios por norma nunca la admiten).')}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {readiness.length > 0 && <ReadinessDisclaimer />}

      <Card title={t('Decisiones de disponibilidad')} flush>
        {decisions.length === 0 ? (
          <EmptyState title={t('Sin confirmaciones ni excepciones registradas')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Decisión')}</th>
                  <th>{t('Centro')}</th>
                  <th>{t('Motivo o nota')}</th>
                  <th>{t('Válida hasta')}</th>
                  <th>{t('Registrada por')}</th>
                  <th>{t('Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => {
                  const st = decisionStatus(d);
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.kind === 'exception' ? t('Excepción autorizada [decisión]') : t('Confirmada como lista')}
                        <div className="sub">{t('Estado al decidir: {state}', { state: t(READINESS[d.stateAtDecision].label) })}</div>
                      </td>
                      <td>{worksiteName(ctx.db, d.worksiteId)}</td>
                      <td className="small">
                        {d.reason}
                        {d.compensatingMeasure && <div className="sub">{t('Medida compensatoria')}: {d.compensatingMeasure}</div>}
                      </td>
                      <td>{d.kind === 'exception' ? <DateText date={d.validUntil} /> : <span className="muted">—</span>}</td>
                      <td>
                        {userName(ctx.db, d.decidedBy)}
                        <div className="sub"><DateTimeText at={d.decidedAt} /></div>
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.kind === 'confirm' && (
        <ConfirmDialog
          title={t('Confirmar como lista')}
          confirmLabel={t('Confirmar como lista')}
          requireReason
          reasonLabel={t('Nota de la confirmación (queda registrada en la auditoría)')}
          message={
            <div className="stack-sm">
              <p>{`${emp.firstName} ${emp.lastName} · ${worksiteName(ctx.db, dialog.r.worksiteId)}`}</p>
              <p className="small muted">{t('La confirmación registra que la evidencia configurada como obligatoria está aceptada. No es una aprobación profesional de seguridad ni certifica el cumplimiento legal. Si el estado cambia, la confirmación deja de ser válida.')}</p>
            </div>
          }
          onConfirm={(note) => runOk(() => confirmReady(emp.id, dialog.r.worksiteId, note), t('Asignación confirmada como lista según los requisitos configurados'))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'exception' && <ExceptionModal emp={emp} r={dialog.r} eligible={dialog.eligible} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'revoke' && (
        <ConfirmDialog
          title={dialog.d.kind === 'exception' ? t('Revocar excepción') : t('Revocar confirmación')}
          confirmLabel={t('Revocar')}
          danger
          requireReason
          message={<p className="small">{t('La decisión se conserva en el historial como revocada. La disponibilidad se recalcula a partir de los requisitos configurados.')}</p>}
          onConfirm={(reason) => runOk(() => revokeDecision(dialog.d.id, reason), dialog.d.kind === 'exception' ? t('La excepción se ha revocado') : t('La confirmación se ha revocado'))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ExceptionModal({ emp, r, eligible, onClose }: { emp: Employee; r: Readiness; eligible: MatrixItem[]; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const max = addDays(ctx.today, EXCEPTION_MAX_DAYS);
  const [selected, setSelected] = useState<string[]>(eligible.length === 1 ? [eligible[0].template.id] : []);
  const [reason, setReason] = useState('');
  const [measure, setMeasure] = useState('');
  const [until, setUntil] = useState('');
  const [touched, setTouched] = useState(false);

  const errors = {
    items: selected.length ? undefined : t('Seleccione al menos un requisito crítico.'),
    reason: reason.trim().length >= 10 ? undefined : t('Motivo: mínimo 10 caracteres.'),
    measure: measure.trim() ? undefined : t('Medida compensatoria: obligatoria.'),
    until: !until ? t('Obligatorio.') : until < ctx.today || until > max ? t('Entre hoy y {date} (máximo {n} días).', { date: formatDate(max), n: EXCEPTION_MAX_DAYS }) : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    const ok = await run(() => grantException({ employeeId: emp.id, worksiteId: r.worksiteId, templateIds: selected, reason, compensatingMeasure: measure, validUntil: until }), t('Excepción registrada'));
    if (ok) onClose();
  };

  return (
    <Modal
      title={t('Excepción autorizada [decisión]')}
      description={`${emp.firstName} ${emp.lastName} · ${worksiteName(ctx.db, r.worksiteId)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Registrar excepción')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout tone="warning">
          {t('La excepción es temporal (máximo {n} días), exige una medida compensatoria validada y solo es posible si la versión aprobada del requisito lo permite. Nunca cubre un control obligatorio por norma. Queda registrada en la auditoría y se notifica a la coordinación y al supervisor/a.', { n: EXCEPTION_MAX_DAYS })}
        </Callout>
        <fieldset className="plain-fieldset">
          <legend className="field-legend">
            {t('Requisitos críticos que cubre')}
            <span className="req" aria-hidden>*</span>
          </legend>
          <div className="stack-sm">
            {eligible.map((it) => (
              <Checkbox
                key={it.key}
                label={it.version.name}
                hint={t('Autoridad de revisión: {authority}', { authority: t(AUTHORITY_LABEL[it.version.reviewAuthority]) })}
                checked={selected.includes(it.template.id)}
                onChange={(v) => setSelected((s) => (v ? [...s, it.template.id] : s.filter((x) => x !== it.template.id)))}
              />
            ))}
          </div>
          {touched && errors.items && (
            <span className="field-error" role="alert">
              {errors.items}
            </span>
          )}
        </fieldset>
        <TextAreaField label={t('Motivo')} required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={touched ? errors.reason : undefined} />
        <TextAreaField label={t('Medida compensatoria validada')} required rows={3} value={measure} onChange={(e) => setMeasure(e.target.value)} error={touched ? errors.measure : undefined} hint={t('Medida que el profesional ha validado mientras el requisito no esté resuelto.')} />
        <TextField label={t('Válida hasta')} type="date" required min={ctx.today} max={max} value={until} onChange={(e) => setUntil(e.target.value)} error={touched ? errors.until : undefined} hint={t('Máximo {n} días desde hoy.', { n: EXCEPTION_MAX_DAYS })} />
      </div>
    </Modal>
  );
}
