/**
 * Register / edit / new version of a risk assessment record. The app stores what the assessor or
 * the prevention service produced; it never computes or suggests a risk level.
 */
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Callout, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { latestVersion } from '../../domain/requirements';
import type { Hazard, RiskAssessment } from '../../domain/types';
import { t } from '../../i18n';
import { visibleDocuments } from '../../services/evidenceService';
import { emptyHazard, registerAssessment, updateAssessment, validateAssessment, type AssessmentInput } from '../../services/safetyService';
import { getDb } from '../../store/db';
import { shown, shownFields, stored, storedFields } from '../../components/localizedForm';
import { useCtx } from '../../store/hooks';
import { companyUsers, ErrorList, MultiCheck } from './shared';

export type AssessmentFormMode = 'create' | 'edit' | 'version';

function toInput(a: RiskAssessment): AssessmentInput {
  return {
    title: a.title,
    worksiteId: a.worksiteId,
    activity: a.activity,
    jobRoleIds: [...a.jobRoleIds],
    providerId: a.providerId,
    assessorName: a.assessorName,
    issueDate: a.issueDate,
    effectiveDate: a.effectiveDate,
    reviewDate: a.reviewDate,
    hazards: a.hazards.map((h) => ({ ...h })),
    preventiveMeasures: a.preventiveMeasures,
    documentId: a.documentId,
    linkedTemplateIds: [...a.linkedTemplateIds],
    ownerUserId: a.ownerUserId,
  };
}

const TEXTS = ['title', 'activity', 'preventiveMeasures'] as const;

function displayInput(v: AssessmentInput): AssessmentInput {
  return { ...shownFields(v, [...TEXTS]), hazards: v.hazards.map((h) => ({ ...h, description: shown(h.description), measures: shown(h.measures) })) };
}

function storedInput(v: AssessmentInput, raw: RiskAssessment): AssessmentInput {
  return {
    ...storedFields(v, raw, [...TEXTS]),
    hazards: v.hazards.map((h) => {
      const o = raw.hazards.find((x) => x.id === h.id);
      return o ? { ...h, description: stored(h.description, o.description), measures: stored(h.measures, o.measures) } : h;
    }),
  };
}

export function AssessmentFormDialog({ mode, base, onClose, onSaved }: { mode: AssessmentFormMode; base?: RiskAssessment; onClose: () => void; onSaved?: (a: RiskAssessment) => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  // Texts are shown in the interface language; unchanged ones are saved back as the stored Spanish.
  const [raw] = useState(() => (base ? getDb().assessments.find((x) => x.id === base.id) ?? base : null));
  const [f, setF] = useState<AssessmentInput>(() => {
    if (raw && mode === 'edit') return displayInput(toInput(raw));
    if (raw && mode === 'version') return { ...displayInput(toInput(raw)), issueDate: null, effectiveDate: null, reviewDate: null, documentId: null, ownerUserId: ctx.user.id };
    return { title: '', worksiteId: null, activity: '', jobRoleIds: [], providerId: null, assessorName: '', issueDate: null, effectiveDate: null, reviewDate: null, hazards: [emptyHazard()], preventiveMeasures: '', documentId: null, linkedTemplateIds: [], ownerUserId: ctx.user.id };
  });
  const [errors, setErrors] = useState<string[]>([]);
  const set = (patch: Partial<AssessmentInput>) => setF((p) => ({ ...p, ...patch }));
  const setHazard = (i: number, patch: Partial<Hazard>) => setF((p) => ({ ...p, hazards: p.hazards.map((h, k) => (k === i ? { ...h, ...patch } : h)) }));

  const sites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && (w.active || w.id === f.worksiteId));
  const roles = ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id && (r.active || f.jobRoleIds.includes(r.id)));
  const providers = ctx.db.providers.filter((p) => p.companyId === ctx.company.id);
  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const templates = ctx.db.templates.filter((x) => x.companyId === ctx.company.id && !x.retiredAt);
  const docs = visibleDocuments(ctx).filter((d) => d.categoryId === 'evaluacion_riesgos' && d.companyId === ctx.company.id);
  const users = companyUsers(ctx);
  const specialist = new Set(tags.filter((r) => r.specialist).map((r) => r.id));

  const submit = async () => {
    const restored = raw ? storedInput(f, raw) : f;
    const input: AssessmentInput = { ...restored, title: restored.title.trim(), activity: restored.activity.trim(), assessorName: restored.assessorName.trim(), issueDate: f.issueDate || null, effectiveDate: f.effectiveDate || null, reviewDate: f.reviewDate || null };
    const errs = validateAssessment(ctx, input);
    setErrors(errs);
    if (errs.length) return;
    const r = await run(
      () => (mode === 'edit' && base ? updateAssessment(base.id, input) : registerAssessment(input, mode === 'version' ? base?.id : undefined)),
      mode === 'edit' ? t('Borrador de la evaluación actualizado') : mode === 'version' ? t('Nueva versión registrada en borrador') : t('Evaluación registrada en borrador'),
    );
    if (r) {
      onClose();
      onSaved?.(r);
    }
  };

  const title = mode === 'edit' ? t('Editar borrador {code} v{version}', { code: base?.code ?? '', version: base?.version ?? 1 }) : mode === 'version' ? t('Nueva versión de {code}', { code: base?.code ?? '' }) : t('Registrar evaluación de riesgos');

  return (
    <Modal
      wide
      title={title}
      description={t('Registre la evaluación elaborada por personal competente o por el servicio de prevención. La aplicación no evalúa riesgos ni calcula puntuaciones.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {mode === 'edit' ? t('Guardar borrador') : t('Registrar en borrador')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {mode === 'version' && base && <Callout tone="info">{t('La versión {version} sigue vigente hasta que se acepte la nueva; después quedará sustituida y se conserva.', { version: base.version })}</Callout>}
        <ErrorList errors={errors} title={t('No se puede registrar la evaluación')} />

        <div className="form-grid">
          <TextField className="span-2" label={t('Título')} required value={f.title} onChange={(e) => set({ title: e.target.value })} />
          <SelectField label={t('Centro de trabajo')} value={f.worksiteId ?? ''} onChange={(e) => set({ worksiteId: e.target.value || null })} hint={t('Opcional si la evaluación es por puestos.')}>
            <option value="">{t('Sin centro (evaluación por puestos)')}</option>
            {sites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </SelectField>
          <TextField className="span-all" label={t('Actividad evaluada')} required value={f.activity} onChange={(e) => set({ activity: e.target.value })} />
          <SelectField label={t('Servicio de prevención o entidad')} value={f.providerId ?? ''} onChange={(e) => set({ providerId: e.target.value || null })}>
            <option value="">{t('Personal propio / sin entidad')}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Evaluador/a')} required value={f.assessorName} onChange={(e) => set({ assessorName: e.target.value })} hint={t('Nombre y cualificación (RD 39/1997, art. 4.3).')} />
          <SelectField label={t('Responsable interno')} required value={f.ownerUserId} onChange={(e) => set({ ownerUserId: e.target.value })}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Fecha de emisión')} type="date" max={ctx.today} value={f.issueDate ?? ''} onChange={(e) => set({ issueDate: e.target.value || null })} />
          <TextField label={t('Fecha de efecto')} type="date" value={f.effectiveDate ?? ''} onChange={(e) => set({ effectiveDate: e.target.value || null })} hint={t('Si se deja vacía, se toma la fecha de aceptación.')} />
          <TextField label={t('Fecha de revisión fijada por el evaluador')} type="date" value={f.reviewDate ?? ''} onChange={(e) => set({ reviewDate: e.target.value || null })} hint={t('Solo si el evaluador la estableció. Si no, se mostrará «No establecida».')} />
        </div>

        <MultiCheck legend={t('Puestos evaluados')} options={roles.map((r) => ({ id: r.id, label: r.name }))} value={f.jobRoleIds} onChange={(v) => set({ jobRoleIds: v })} hint={t('Indique el centro, los puestos o ambos.')} />

        <fieldset>
          <legend>{t('Peligros identificados y medidas')}</legend>
          <p className="tiny muted" style={{ margin: '0 0 8px' }}>
            {t('Transcriba lo que indica el documento del evaluador. No se registran niveles ni puntuaciones de riesgo.')}
          </p>
          <div className="stack-sm">
            {f.hazards.length === 0 && <p className="small muted">{t('Sin peligros añadidos.')}</p>}
            {f.hazards.map((h, i) => (
              <div key={i} className="sf-hazard">
                <div className="row between">
                  <span className="strong small">{t('Peligro {n}', { n: i + 1 })}</span>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => set({ hazards: f.hazards.filter((_, k) => k !== i) })} aria-label={t('Quitar el peligro {n}', { n: i + 1 })}>
                    {t('Quitar')}
                  </Button>
                </div>
                <div className="sf-hazard-grid">
                  <SelectField label={t('Riesgo asociado')} value={h.riskTag} onChange={(e) => setHazard(i, { riskTag: e.target.value })} error={specialist.has(h.riskTag) ? t('Alcance especializado: fuera del alcance inicial del producto.') : undefined}>
                    <option value="">{t('Sin etiqueta')}</option>
                    {tags.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </SelectField>
                  <TextAreaField label={t('Descripción del peligro')} required rows={2} value={h.description} onChange={(e) => setHazard(i, { description: e.target.value })} />
                  <TextAreaField label={t('Medidas indicadas')} rows={2} value={h.measures} onChange={(e) => setHazard(i, { measures: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
          <Button size="sm" icon={Plus} onClick={() => set({ hazards: [...f.hazards, emptyHazard()] })} className="sf-mt">
            {t('Añadir peligro')}
          </Button>
        </fieldset>

        <TextAreaField label={t('Medidas preventivas y planificación')} rows={3} value={f.preventiveMeasures} onChange={(e) => set({ preventiveMeasures: e.target.value })} />

        <div className="form-grid">
          <SelectField
            className="span-2"
            label={t('Documento de la evaluación')}
            value={f.documentId ?? ''}
            onChange={(e) => set({ documentId: e.target.value || null })}
            hint={t('Necesario para enviarla a revisión. Puede registrar el borrador sin documento y vincularlo después.')}
          >
            <option value="">{t('Sin documento vinculado')}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.title}
              </option>
            ))}
          </SelectField>
          <div className="field sf-align-end">
            <Link to="/documentacion?nuevo=1&categoria=evaluacion_riesgos" className="btn" target="_blank" rel="noopener">
              <ExternalLink size={15} aria-hidden /> {t('Subir documento en Documentación')}
            </Link>
            <span className="hint">{t('Se abre en otra pestaña; al volver, vuelva a abrir este formulario para verlo en la lista.')}</span>
          </div>
        </div>

        <MultiCheck
          legend={t('Requisitos vinculados')}
          options={templates.map((x) => ({ id: x.id, label: `${x.code} · ${latestVersion(ctx.db, x.id)?.name ?? ''}` }))}
          value={f.linkedTemplateIds}
          onChange={(v) => set({ linkedTemplateIds: v })}
          hint={t('Requisitos de la matriz que tienen su origen en esta evaluación (solo referencia; no los aprueba).')}
        />
      </div>
    </Modal>
  );
}
