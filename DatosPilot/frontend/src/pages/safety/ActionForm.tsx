/**
 * Create a preventive action from a requirement gap, a review finding, a risk assessment, CAE,
 * a provider review, an incident or another source. Owner and target date are assigned later
 * with a justification (no deadline is invented here).
 */
import { useState } from 'react';
import { Button, Callout, Checkbox, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { PRIORITY } from '../../domain/status';
import { latestVersion } from '../../domain/requirements';
import type { Database, ID, PreventiveAction, Priority, ReviewAuthority } from '../../domain/types';
import { t } from '../../i18n';
import { employeeName, visibleEmployeeIds, visibleWorksiteIds, worksiteName } from '../../services/context';
import { createAction, type ActionInput } from '../../services/safetyService';
import { getDb } from '../../store/db';
import { shown, stored } from '../../components/localizedForm';
import { useCtx } from '../../store/hooks';
import { ACTION_SOURCE_KINDS, ACTION_SOURCE_LABEL, ErrorList, type ActionSourceKind } from './shared';

export interface ActionPrefill {
  kind?: string | null;
  refId?: string | null;
  employeeId?: string | null;
  worksiteId?: string | null;
  jobRoleId?: string | null;
  title?: string | null;
}

/** Default source label from the referenced record, in the language of the record (Spanish). */
function sourceLabelFor(db: Database, companyId: ID, refId: string | null | undefined): string {
  if (!refId) return '';
  const ra = db.assessments.find((x) => x.id === refId && x.companyId === companyId);
  if (ra) return `${ra.code} v${ra.version} · ${ra.title}`;
  const tpl = db.templates.find((x) => x.id === refId && x.companyId === companyId);
  if (tpl) {
    const v = latestVersion(db, tpl.id);
    return `${tpl.code}${v ? ` · ${v.name}` : ''}`;
  }
  const cae = db.caeCases.find((x) => x.id === refId && x.companyId === companyId);
  if (cae) return `${cae.code} · ${cae.title}`;
  const doc = db.documents.find((x) => x.id === refId && x.companyId === companyId);
  if (doc) return `${doc.code} · ${doc.title}`;
  return '';
}

const AUTHORITIES: ReviewAuthority[] = ['coordinator', 'provider_technical'];

export function ActionFormDialog({ prefill, onClose, onCreated }: { prefill: ActionPrefill; onClose: () => void; onCreated: (a: PreventiveAction) => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const canDecideReadiness = ctx.can('requirements.approve_professional');
  const empIds = visibleEmployeeIds(ctx);
  const siteIds = visibleWorksiteIds(ctx);
  const [f, setF] = useState<ActionInput>(() => {
    const kind = (ACTION_SOURCE_KINDS as string[]).includes(prefill.kind ?? '') ? (prefill.kind as ActionSourceKind) : 'other';
    const refId = prefill.refId ?? null;
    return {
      title: prefill.title ?? '',
      description: '',
      source: { kind, refId, label: shown(sourceLabelFor(getDb(), ctx.company.id, refId)) },
      employeeId: prefill.employeeId && empIds.has(prefill.employeeId) ? prefill.employeeId : null,
      jobRoleId: prefill.jobRoleId ?? null,
      worksiteId: prefill.worksiteId && siteIds.has(prefill.worksiteId) ? prefill.worksiteId : null,
      priority: 'medium',
      requiredEvidence: '',
      evidenceRequired: true,
      reviewAuthority: 'coordinator',
      affectsReadiness: false,
    };
  });
  const [errors, setErrors] = useState<string[]>([]);
  const set = (patch: Partial<ActionInput>) => setF((p) => ({ ...p, ...patch }));
  const employees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && e.status === 'active' && empIds.has(e.id)).sort((a, b) => employeeName(ctx.db, a.id).localeCompare(employeeName(ctx.db, b.id), 'es'));
  const roles = ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id && r.active);

  const submit = async () => {
    const errs: string[] = [];
    if (!f.title.trim()) errs.push('Título: obligatorio.');
    if (!f.source.label.trim()) errs.push('Origen: obligatorio (requisito, revisión, evaluación, CAE…).');
    if (f.evidenceRequired && !f.requiredEvidence.trim()) errs.push('Describa la evidencia necesaria para cerrarla.');
    setErrors(errs);
    if (errs.length) return;
    const r = await run(() => createAction({ ...f, title: f.title.trim(), description: f.description.trim(), requiredEvidence: f.requiredEvidence.trim(), source: { ...f.source, label: stored(f.source.label.trim(), sourceLabelFor(getDb(), ctx.company.id, f.source.refId)) } }), (x) => t('Acción {code} creada. Asigne un responsable y una fecha objetivo justificada.', { code: x.code }));
    if (r) onCreated(r);
  };

  return (
    <Modal
      wide
      title={t('Nueva acción preventiva')}
      description={t('El responsable y la fecha objetivo se asignan después, con una justificación.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('Crear acción')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorList errors={errors} title={t('No se puede crear la acción')} />
        <div className="form-grid">
          <TextField className="span-all" label={t('Título')} required value={f.title} onChange={(e) => set({ title: e.target.value })} />
          <TextAreaField className="span-all" label={t('Descripción')} rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
          <SelectField label={t('Tipo de origen')} required value={f.source.kind} onChange={(e) => set({ source: { ...f.source, kind: e.target.value as ActionSourceKind } })}>
            {ACTION_SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(ACTION_SOURCE_LABEL[k])}
              </option>
            ))}
          </SelectField>
          <TextField className="span-2" label={t('Origen concreto')} required value={f.source.label} onChange={(e) => set({ source: { ...f.source, label: e.target.value } })} placeholder={t('Por ejemplo, informe de la visita técnica del 3 de octubre')} hint={f.source.refId ? t('Vinculada al registro de origen.') : undefined} />
          <SelectField label={t('Centro de trabajo')} value={f.worksiteId ?? ''} onChange={(e) => set({ worksiteId: e.target.value || null })}>
            <option value="">{t('Sin centro concreto')}</option>
            {[...siteIds].map((id) => (
              <option key={id} value={id}>
                {worksiteName(ctx.db, id)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Persona afectada')} value={f.employeeId ?? ''} onChange={(e) => set({ employeeId: e.target.value || null })} hint={t('Solo si la acción se refiere a una persona concreta.')}>
            <option value="">{t('Ninguna')}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Puesto')} value={f.jobRoleId ?? ''} onChange={(e) => set({ jobRoleId: e.target.value || null })}>
            <option value="">{t('Ninguno')}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Prioridad')} value={f.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
            {(Object.keys(PRIORITY) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {t(PRIORITY[p].label)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('Autoridad de revisión')} value={f.reviewAuthority} onChange={(e) => set({ reviewAuthority: e.target.value as ReviewAuthority })} hint={t('Quién acepta la resolución. El responsable nunca acepta su propia acción.')}>
            {AUTHORITIES.map((r) => (
              <option key={r} value={r}>
                {t(AUTHORITY_LABEL[r])}
              </option>
            ))}
          </SelectField>
        </div>
        <fieldset>
          <legend>{t('Evidencia para cerrarla')}</legend>
          <div className="stack-sm">
            <Checkbox label={t('Exigir evidencia antes de enviarla a revisión')} checked={f.evidenceRequired} onChange={(v) => set({ evidenceRequired: v })} />
            {f.evidenceRequired && <TextAreaField label={t('Evidencia necesaria')} required rows={2} value={f.requiredEvidence} onChange={(e) => set({ requiredEvidence: e.target.value })} placeholder={t('Por ejemplo, foto de la señalización instalada y confirmación del titular')} />}
          </div>
        </fieldset>
        <div>
          <Checkbox
            label={t('Condiciona la disponibilidad mientras esté abierta')}
            checked={f.affectsReadiness}
            disabled={!canDecideReadiness}
            onChange={(v) => set({ affectsReadiness: v })}
            hint={canDecideReadiness ? t('Márquelo solo si la política aprobada lo establece: el centro afectado aparecerá como pendiente hasta que se resuelva.') : t('Solo un profesional del servicio de prevención (con aprobación profesional de requisitos) puede decidir que una acción condiciona la disponibilidad. Su rol no lo permite.')}
          />
        </div>
        {f.employeeId && <Callout tone="neutral">{t('La representación de los trabajadores verá esta acción sin el nombre de la persona afectada.')}</Callout>}
      </div>
    </Modal>
  );
}
