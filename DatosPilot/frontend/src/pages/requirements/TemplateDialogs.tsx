/**
 * Decision dialogs of the requirement detail: professional approval, retirement and explicit
 * assignment. Each one validates inline and calls the service (which re-checks permissions).
 */
import { useState } from 'react';
import { affectedBy } from '../../domain/requirements';
import { REQUIREMENT_TYPE } from '../../domain/status';
import type { ID, RequirementVersion } from '../../domain/types';
import { t } from '../../i18n';
import { alertDays, employeeName, visibleEmployeeIds, visibleWorksiteIds } from '../../services/context';
import { approveVersion, assignTemplate, retireTemplate } from '../../services/requirementService';
import { useCtx } from '../../store/hooks';
import { Button, Callout, Checkbox, DateText, KV, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { SourceLink, TARGET_KIND_LABEL, approvalIssues, isHealthVersion } from './shared';

export function ApproveDialog({ v, code, onClose }: { v: RequirementVersion; code: string; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [critical, setCritical] = useState(v.critical);
  const [exceptionAllowed, setExceptionAllowed] = useState(v.exceptionAllowed);
  const [note, setNote] = useState('');
  const [reviewDate, setReviewDate] = useState(v.policyReviewDate ?? '');
  const [touched, setTouched] = useState(false);
  const issues = approvalIssues(ctx, v);
  const law = v.source.kind === 'law';
  const noteError = touched && !note.trim() ? t('Indique la base profesional de la aprobación.') : undefined;
  const dateError = touched && reviewDate && reviewDate < ctx.today ? t('La revisión de la política debe ser posterior a hoy.') : undefined;

  const submit = async () => {
    setTouched(true);
    if (!note.trim() || issues.length || (reviewDate && reviewDate < ctx.today)) return;
    const r = await run(() => approveVersion(v.id, { critical, exceptionAllowed: law ? false : exceptionAllowed, note: note.trim(), policyReviewDate: reviewDate || null }), t('Versión aprobada: se aplicará desde su fecha de efecto'));
    if (r) onClose();
  };

  return (
    <Modal
      wide
      title={t('Aprobar {code} (v{n})', { code, n: v.version })}
      description={t('Al aprobar, usted asume la base profesional del requisito. La aprobación queda registrada con su nombre y su nota.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={issues.length > 0}>
            {t('Aprobar versión')}
          </Button>
        </>
      }
    >
      <KV
        items={[
          [t('Requisito'), v.name],
          [t('Tipo de requisito'), t(REQUIREMENT_TYPE[v.requirementType].label)],
          [t('Fuente o referencia'), <SourceLink key="s" v={v} />],
          [t('En vigor desde'), <DateText key="d" date={v.effectiveFrom} />],
        ]}
      />
      {issues.length > 0 && (
        <Callout tone="danger" title={t('No se puede aprobar tal como está')}>
          <ul className="rq-error-list">
            {issues.map((e, i) => (
              <li key={i}>{t(e)}</li>
            ))}
          </ul>
          <div className="tiny">{t('Rechace la versión con el motivo para que se corrija, o pida a quien la redactó que cree una nueva.')}</div>
        </Callout>
      )}
      <fieldset>
        <legend>{t('Decisión profesional')}</legend>
        <div className="stack-sm">
          <Checkbox label={t('Crítico para la asignación')} checked={critical} onChange={setCritical} hint={t('Si no está resuelto, la asignación queda bloqueada.')} />
          <Checkbox
            label={t('Admite excepción validada')}
            checked={law ? false : exceptionAllowed}
            onChange={setExceptionAllowed}
            disabled={law}
            hint={law ? t('Un control exigido por una norma no admite excepciones de rutina.') : t('Existe un procedimiento de excepción validado (describa la medida compensatoria en la nota).')}
          />
        </div>
      </fieldset>
      <TextAreaField label={t('Base profesional de la aprobación')} required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={noteError} hint={isHealthVersion(v) ? t('Indique los protocolos o la decisión del servicio médico.') : t('Por ejemplo, la evaluación de riesgos o la planificación que lo justifica.')} />
      <TextField label={t('Revisión de la política (opcional)')} type="date" min={ctx.today} value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} error={dateError} hint={t('Fecha en la que debe reconsiderarse el requisito. Déjela vacía si no se ha establecido.')} />
    </Modal>
  );
}

export function RetireDialog({ templateId, code, name, onClose }: { templateId: ID; code: string; name: string; onClose: () => void }) {
  const ctx = useCtx();
  const { runOk, pending } = useAction();
  const [date, setDate] = useState(ctx.today);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const visible = visibleEmployeeIds(ctx);
  const affected = new Set(affectedBy(ctx.db, ctx.company.id, templateId, ctx.today, alertDays(ctx)).filter((i) => visible.has(i.employeeId)).map((i) => i.employeeId)).size;
  const dateError = touched && (!date || date < ctx.today) ? t('Elija hoy o una fecha posterior: la retirada no es retroactiva.') : undefined;
  const reasonError = touched && !reason.trim() ? t('Obligatorio.') : undefined;
  const submit = async () => {
    setTouched(true);
    if (!date || date < ctx.today || !reason.trim()) return;
    if (await runOk(() => retireTemplate(templateId, date, reason.trim()), t('Requisito retirado: el historial y las evidencias se conservan'))) onClose();
  };
  return (
    <Modal
      title={t('Retirar {code}', { code })}
      description={name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="danger" onClick={submit} loading={pending}>
            {t('Retirar requisito')}
          </Button>
        </>
      }
    >
      <Callout tone="warning">{t('El requisito dejará de aplicarse a partir del día siguiente a la fecha indicada. Las versiones, evidencias y decisiones anteriores se conservan. Personas afectadas hoy: {n}.', { n: affected })}</Callout>
      <TextField label={t('Última fecha en vigor')} type="date" required min={ctx.today} value={date} onChange={(e) => setDate(e.target.value)} error={dateError} />
      <TextAreaField label={t('Motivo de la retirada (queda registrado en la auditoría)')} required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={reasonError} />
    </Modal>
  );
}

type TargetKind = 'employee' | 'role' | 'worksite';

export function AssignDialog({ templateId, code, onClose }: { templateId: ID; code: string; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [kind, setKind] = useState<TargetKind>('employee');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState(ctx.today);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const visible = visibleEmployeeIds(ctx);
  const sites = visibleWorksiteIds(ctx);
  const options: { id: ID; label: string }[] =
    kind === 'employee'
      ? ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active' && visible.has(e.id)).map((e) => ({ id: e.id, label: employeeName(ctx.db, e.id) })).sort((a, b) => a.label.localeCompare(b.label, 'es'))
      : kind === 'role'
        ? ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id && r.active).map((r) => ({ id: r.id, label: r.name }))
        : ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && w.active && sites.has(w.id)).map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }));
  const open = ctx.db.requirementAssignments.find((a) => a.templateId === templateId && a.target.kind === kind && a.target.id === target && !a.effectiveTo);
  const errs = {
    target: !target ? t('Seleccione el destino.') : open ? t('Ya existe una asignación vigente para este destino.') : undefined,
    from: !from || from < ctx.today ? t('Hoy o una fecha posterior: la asignación no es retroactiva.') : undefined,
    reason: !reason.trim() ? t('Obligatorio.') : undefined,
  };
  const submit = async () => {
    setTouched(true);
    if (errs.target || errs.from || errs.reason) return;
    const r = await run(() => assignTemplate(templateId, { kind, id: target }, from, reason.trim()), t('Requisito asignado'));
    if (r) onClose();
  };
  return (
    <Modal
      title={t('Asignar {code}', { code })}
      description={t('Asignación explícita, además del ámbito definido en la versión. Queda registrada con fecha de efecto y motivo.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Asignar')}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend>{t('Asignar a')}</legend>
        <div className="segmented" role="group" aria-label={t('Tipo de destino')}>
          {(['employee', 'role', 'worksite'] as TargetKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setTarget('');
              }}
            >
              {t(TARGET_KIND_LABEL[k])}
            </button>
          ))}
        </div>
      </fieldset>
      <SelectField label={t(TARGET_KIND_LABEL[kind])} required value={target} onChange={(e) => setTarget(e.target.value)} error={touched ? errs.target : undefined}>
        <option value="">{t('Seleccione…')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </SelectField>
      <TextField label={t('En vigor desde')} type="date" required min={ctx.today} value={from} onChange={(e) => setFrom(e.target.value)} error={touched ? errs.from : undefined} />
      <TextAreaField label={t('Motivo')} required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={touched ? errs.reason : undefined} hint={t('Por ejemplo, un requisito del titular del centro o una medida de la evaluación.')} />
    </Modal>
  );
}
