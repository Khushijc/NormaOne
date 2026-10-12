/**
 * Requirement version form: create a draft template, start a new version, or edit a draft.
 * Validation runs locally with validateVersion() before the service call (which validates again).
 * "Critical" and "exception allowed" are never editable by ordinary users: the professional
 * approver sets them.
 */
import { Info, Lock, Search, Stethoscope } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { AUTHORITY_LABEL } from '../../domain/permissions';
import { CATEGORY_LABEL, EVIDENCE_MODE_LABEL, EXPIRY_RULE_LABEL, REQUIREMENT_TYPE, REVIEW_RULE_LABEL, SOURCE_KIND_LABEL } from '../../domain/status';
import type { EvidenceMode, ExpiryRule, HealthBasis, ID, RequirementCategory, RequirementType, RequirementVersion, ReviewAuthority, ReviewRule, SourceKind } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { createTemplate, needsProfessionalApproval, newVersion, updateDraft, validateVersion, type VersionInput } from '../../services/requirementService';
import { canSeeDocument, employeeName, visibleEmployeeIds } from '../../services/context';
import { getDb } from '../../store/db';
import { shown as shownText, shownFields, stored, storedFields } from '../../components/localizedForm';
import { useCtx } from '../../store/hooks';
import { Badge, Button, Callout, Checkbox, Modal, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { EXPIRY_EXPLAIN, HEALTH_GROUND_LABEL, HEALTH_KIND_LABEL, REVIEW_EXPLAIN, isApprover, isHealthVersion } from './shared';

export type FormMode = 'create' | 'new_version' | 'edit';

const INPUT_KEYS = ['name', 'description', 'purpose', 'category', 'evidenceMode', 'requirementType', 'scope', 'perWorksite', 'source', 'applicabilityNote', 'reviewAuthority', 'responsibleReviewer', 'evidenceRequired', 'expiryRule', 'reviewRule', 'policyReviewDate', 'courseId', 'equipmentItemId', 'instructionDocumentId', 'health', 'effectiveFrom', 'changeReason', 'invalidatesPriorEvidence'] as const;

function emptyInput(today: string): VersionInput {
  return {
    name: '',
    description: '',
    purpose: '',
    category: 'training',
    evidenceMode: 'training',
    requirementType: 'mandatory_policy',
    scope: { jobRoleIds: [], worksiteIds: [], riskTags: [], employeeIds: [], appliesToAll: false },
    perWorksite: false,
    source: { kind: 'risk_assessment', label: '', url: null, assessmentId: null },
    applicabilityNote: '',
    reviewAuthority: 'coordinator',
    responsibleReviewer: '',
    evidenceRequired: '',
    expiryRule: 'per_document',
    reviewRule: { kind: 'none', months: null, setBy: null },
    policyReviewDate: null,
    courseId: null,
    equipmentItemId: null,
    instructionDocumentId: null,
    health: null,
    effectiveFrom: today,
    changeReason: '',
    invalidatesPriorEvidence: false,
    critical: false,
    exceptionAllowed: false,
  };
}

function fromVersion(v: RequirementVersion, mode: FormMode, today: string): VersionInput {
  const picked: Record<string, unknown> = {};
  for (const k of INPUT_KEYS) picked[k] = v[k];
  const base = picked as Omit<VersionInput, 'critical' | 'exceptionAllowed'>;
  const input: VersionInput = {
    ...base,
    scope: { ...v.scope, jobRoleIds: [...v.scope.jobRoleIds], worksiteIds: [...v.scope.worksiteIds], riskTags: [...v.scope.riskTags], employeeIds: [...v.scope.employeeIds] },
    source: { ...v.source },
    reviewRule: { ...v.reviewRule },
    health: v.health ? { ...v.health } : null,
    critical: v.critical,
    exceptionAllowed: v.exceptionAllowed,
  };
  if (mode === 'new_version') {
    input.effectiveFrom = v.effectiveFrom > today ? v.effectiveFrom : today;
    input.changeReason = '';
    input.invalidatesPriorEvidence = false;
  }
  return input;
}

const VERSION_TEXTS = ['name', 'description', 'purpose', 'applicabilityNote', 'responsibleReviewer', 'evidenceRequired', 'changeReason'] as const;

/** Text fields shown in the interface language (nested ones too). */
function displayInput(v: VersionInput): VersionInput {
  return {
    ...shownFields(v, [...VERSION_TEXTS]),
    source: { ...v.source, label: shownText(v.source.label) },
    reviewRule: { ...v.reviewRule, setBy: v.reviewRule.setBy && shownText(v.reviewRule.setBy) },
    health: v.health && { ...v.health, professionalReference: v.health.professionalReference && shownText(v.health.professionalReference) },
  };
}

/** Unchanged texts go back to the stored Spanish of the version being edited. */
function storedInput(v: VersionInput, raw: RequirementVersion): VersionInput {
  return {
    ...storedFields(v, raw, [...VERSION_TEXTS]),
    source: { ...v.source, label: stored(v.source.label, raw.source.label) },
    reviewRule: { ...v.reviewRule, setBy: v.reviewRule.setBy && stored(v.reviewRule.setBy, raw.reviewRule.setBy) },
    health: v.health && { ...v.health, professionalReference: v.health.professionalReference && stored(v.health.professionalReference, raw.health?.professionalReference) },
  };
}

/** Which form field a validation message belongs to (messages come from the service in Spanish). */
type FieldKey = 'name' | 'evidenceRequired' | 'source' | 'applicabilityNote' | 'scope' | 'effectiveFrom' | 'policyReviewDate' | 'link' | 'reviewRule' | 'evidenceMode' | 'reviewAuthority' | 'health' | 'changeReason' | 'url';
function fieldOf(e: string): FieldKey | null {
  const map: [string, FieldKey][] = [
    ['Nombre', 'name'],
    ['Evidencia requerida', 'evidenceRequired'],
    ['Fuente o referencia', 'source'],
    ['Explicación de la aplicabilidad', 'applicabilityNote'],
    ['Ámbito', 'scope'],
    ['Fecha de efecto', 'effectiveFrom'],
    ['La fecha de efecto', 'effectiveFrom'],
    ['Fecha de revisión de la política', 'policyReviewDate'],
    ['Requisito de formación', 'link'],
    ['Requisito de EPI', 'link'],
    ['Requisito de confirmación', 'link'],
    ['Periodicidad de revisión', 'reviewRule'],
    ['La vigilancia de la salud', 'evidenceMode'],
    ['El modo «salud»', 'evidenceMode'],
    ['La autoridad de revisión', 'reviewAuthority'],
    ['Reconocimiento obligatorio', 'health'],
    ['Motivo del cambio', 'changeReason'],
    ['Enlace de la fuente', 'url'],
  ];
  return map.find(([p]) => e.startsWith(p))?.[1] ?? null;
}

/** Checkbox list for multi-select scope criteria (labelled fieldset, optional filter). */
function CheckList({ legend, options, value, onChange, hint, searchable, emptyText }: { legend: string; options: { id: string; label: string; flag?: ReactNode }[]; value: string[]; onChange: (v: string[]) => void; hint?: ReactNode; searchable?: boolean; emptyText: string }) {
  const [q, setQ] = useState('');
  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((x) => x !== id));
  return (
    <fieldset className="rq-checklist-set">
      <legend>
        {legend} <span className="tiny muted">({t('{n} seleccionados', { n: value.length })})</span>
      </legend>
      {searchable && (
        <div className="rq-checklist-search">
          <Search size={14} aria-hidden />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filtrar…')} aria-label={t('Filtrar {list}', { list: legend })} />
        </div>
      )}
      <div className="rq-checklist">
        {shown.length === 0 && <div className="tiny muted">{t(emptyText)}</div>}
        {shown.map((o) => (
          <Checkbox
            key={o.id}
            checked={value.includes(o.id)}
            onChange={(on) => toggle(o.id, on)}
            label={
              <span>
                {o.label} {o.flag}
              </span>
            }
          />
        ))}
      </div>
      {hint && <div className="tiny muted">{hint}</div>}
    </fieldset>
  );
}

export function VersionForm({ mode, templateId, base, code, onClose, onSaved }: { mode: FormMode; templateId?: ID; base?: RequirementVersion | null; code?: string; onClose: () => void; onSaved: (templateId: ID) => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  // Texts are shown in the interface language; unchanged ones are saved back as the stored Spanish.
  const raw = base ? getDb().versions.find((x) => x.id === base.id) ?? base : null;
  const [input, setInput] = useState<VersionInput>(() => (raw ? displayInput(fromVersion(raw, mode, ctx.today)) : emptyInput(ctx.today)));
  const [submitted, setSubmitted] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const professional = isApprover(ctx);

  const set = <K extends keyof VersionInput>(k: K, val: VersionInput[K]) => setInput((s) => ({ ...s, [k]: val }));
  const setScope = (patch: Partial<VersionInput['scope']>) => setInput((s) => ({ ...s, scope: { ...s.scope, ...patch } }));
  const setSource = (patch: Partial<VersionInput['source']>) => setInput((s) => ({ ...s, source: { ...s.source, ...patch } }));
  const setReview = (patch: Partial<ReviewRule>) => setInput((s) => ({ ...s, reviewRule: { ...s.reviewRule, ...patch } }));
  const setHealth = (patch: Partial<HealthBasis>) => setInput((s) => ({ ...s, health: { ...(s.health ?? { kind: 'voluntary', exceptionGround: null, representativesReportOn: null, professionalReference: null }), ...patch } }));

  const health = isHealthVersion(input);

  const onCategory = (c: RequirementCategory) =>
    setInput((s) => {
      if (c === 'health_surveillance') return { ...s, category: c, evidenceMode: 'health', reviewAuthority: 'provider_medical', health: s.health ?? { kind: 'voluntary', exceptionGround: null, representativesReportOn: null, professionalReference: null } };
      const evidenceMode: EvidenceMode = s.evidenceMode === 'health' ? 'document' : s.evidenceMode;
      return { ...s, category: c, evidenceMode, health: null, reviewAuthority: s.reviewAuthority === 'provider_medical' ? 'coordinator' : s.reviewAuthority };
    });
  const onMode = (m: EvidenceMode) => setInput((s) => ({ ...s, evidenceMode: m, courseId: m === 'training' ? s.courseId : null, equipmentItemId: m === 'ppe_issue' ? s.equipmentItemId : null, instructionDocumentId: m === 'acknowledgement' ? s.instructionDocumentId : null }));

  // Reference data of the active company.
  const roles = ctx.db.jobRoles.filter((r) => r.companyId === ctx.company.id && (r.active || input.scope.jobRoleIds.includes(r.id)));
  const sites = ctx.db.worksites.filter((w) => w.companyId === ctx.company.id && (w.active || input.scope.worksiteIds.includes(w.id)));
  const tags = ctx.db.riskTags.filter((r) => r.companyId === ctx.company.id);
  const visible = visibleEmployeeIds(ctx);
  const employees = ctx.db.employees.filter((e) => e.companyId === ctx.company.id && ((e.status === 'active' && visible.has(e.id)) || input.scope.employeeIds.includes(e.id)));
  const courses = ctx.db.courses.filter((c) => c.companyId === ctx.company.id && (c.active || c.id === input.courseId));
  const equipment = ctx.db.equipment.filter((e) => e.companyId === ctx.company.id && (e.active || e.id === input.equipmentItemId));
  const instructionDocs = ctx.db.documents.filter((d) => d.companyId === ctx.company.id && !d.employeeId && (d.categoryId === 'info_riesgos' || d.categoryId === 'instruccion_centro') && canSeeDocument(ctx, d));
  const specialistSelected = input.scope.riskTags.some((id) => tags.find((x) => x.id === id)?.specialist);

  const errors = useMemo(() => {
    const e = validateVersion(ctx, input);
    if (mode === 'new_version' && !input.changeReason.trim()) e.push('Motivo del cambio: obligatorio en una nueva versión.');
    if (input.source.url && !/^https?:\/\/\S+$/i.test(input.source.url.trim())) e.push('Enlace de la fuente: debe empezar por http:// o https://.');
    return e;
  }, [ctx, input, mode]);
  const approvalGaps = useMemo(() => {
    if (!health || input.health?.kind !== 'mandatory_exception') return [];
    const normal = new Set(validateVersion(ctx, input));
    return validateVersion(ctx, input, { forApproval: true }).filter((x) => !normal.has(x));
  }, [ctx, input, health]);

  const shown = submitted ? errors : [];
  const err = (f: FieldKey) => {
    const list = shown.filter((e) => fieldOf(e) === f);
    return list.length ? list.map((e) => t(e)).join(' ') : undefined;
  };

  const save = async () => {
    setSubmitted(true);
    if (errors.length) {
      summaryRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const restored = raw ? storedInput(input, raw) : input;
    const clean: VersionInput = { ...restored, source: { ...restored.source, url: restored.source.url?.trim() || null }, critical: professional ? input.critical : false, exceptionAllowed: professional ? input.exceptionAllowed : false };
    if (mode === 'create') {
      const r = await run(() => createTemplate(clean), t('Borrador creado: todavía no produce efectos'));
      if (r) onSaved(r.template.id);
    } else if (mode === 'new_version' && templateId) {
      const r = await run(() => newVersion(templateId, clean), (x) => t('Versión {n} creada como borrador', { n: x.version }));
      if (r) onSaved(templateId);
    } else if (mode === 'edit' && raw) {
      const r = await run(() => updateDraft(raw.id, clean), t('Borrador guardado'));
      if (r) onSaved(r.templateId);
    }
  };

  const title = mode === 'create' ? t('Nuevo requisito') : mode === 'new_version' ? t('Nueva versión de {code}', { code: code ?? '' }) : t('Editar borrador de {code} (v{n})', { code: code ?? '', n: raw?.version ?? 1 });
  const needsApproval = needsProfessionalApproval({ ...input, critical: !!input.critical, exceptionAllowed: !!input.exceptionAllowed });

  return (
    <Modal
      wide
      title={title}
      onClose={onClose}
      description={mode === 'new_version' ? t('La versión aprobada actual no se modifica: la nueva versión se aplicará desde su fecha de efecto, una vez aprobada o activada.') : t('Se guarda como borrador. Un borrador no produce efectos hasta que se aprueba o se activa.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={save} loading={pending}>
            {mode === 'create' ? t('Crear borrador') : mode === 'new_version' ? t('Crear versión en borrador') : t('Guardar borrador')}
          </Button>
        </>
      }
    >
      <div ref={summaryRef} className="stack">
        {shown.length > 0 && (
          <Callout tone="danger" title={t('Revise el requisito ({n} problemas)', { n: shown.length })}>
            <ul className="rq-error-list">
              {shown.map((e, i) => (
                <li key={i}>{t(e)}</li>
              ))}
            </ul>
          </Callout>
        )}

        <fieldset>
          <legend>{t('Identificación')}</legend>
          <div className="form-grid">
            <TextField className="span-all" label={t('Nombre')} required value={input.name} onChange={(e) => set('name', e.target.value)} error={err('name')} maxLength={160} />
            <TextAreaField className="span-all" label={t('Descripción')} rows={2} value={input.description} onChange={(e) => set('description', e.target.value)} />
            <TextAreaField className="span-all" label={t('Finalidad')} hint={t('Qué se pretende acreditar con este requisito.')} rows={2} value={input.purpose} onChange={(e) => set('purpose', e.target.value)} />
            <SelectField label={t('Categoría')} required value={input.category} onChange={(e) => onCategory(e.target.value as RequirementCategory)}>
              {(Object.keys(CATEGORY_LABEL) as RequirementCategory[]).map((c) => (
                <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>
              ))}
            </SelectField>
            <SelectField label={t('Tipo de requisito')} required value={input.requirementType} onChange={(e) => set('requirementType', e.target.value as RequirementType)} hint={t(REQUIREMENT_TYPE[input.requirementType].help)}>
              {(Object.keys(REQUIREMENT_TYPE) as RequirementType[]).map((k) => (
                <option key={k} value={k}>{t(REQUIREMENT_TYPE[k].label)}</option>
              ))}
            </SelectField>
          </div>
        </fieldset>

        {health && (
          <Callout tone="warning" icon={Stethoscope} title={t('Requisito de vigilancia de la salud')}>
            {t('Solo el servicio médico puede aprobar requisitos de vigilancia de la salud. Un reconocimiento obligatorio exige un supuesto del art. 22.1 LPRL, el informe previo de la representación y una referencia profesional.')}
          </Callout>
        )}

        <fieldset>
          <legend>{t('Cómo se acredita')}</legend>
          <div className="form-grid">
            <SelectField label={t('Modo de evidencia')} required value={input.evidenceMode} onChange={(e) => onMode(e.target.value as EvidenceMode)} error={err('evidenceMode')} disabled={health}>
              {(Object.keys(EVIDENCE_MODE_LABEL) as EvidenceMode[])
                .filter((m) => (health ? m === 'health' : m !== 'health'))
                .map((m) => (
                  <option key={m} value={m}>{t(EVIDENCE_MODE_LABEL[m])}</option>
                ))}
            </SelectField>
            {input.evidenceMode === 'training' && (
              <SelectField label={t('Curso del catálogo')} required value={input.courseId ?? ''} onChange={(e) => set('courseId', e.target.value || null)} error={err('link')} hint={t('La asistencia y la finalización no sustituyen a la evidencia aceptada.')}>
                <option value="">{t('Seleccione un curso…')}</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.title}</option>
                ))}
              </SelectField>
            )}
            {input.evidenceMode === 'ppe_issue' && (
              <SelectField label={t('Equipo del catálogo')} required value={input.equipmentItemId ?? ''} onChange={(e) => set('equipmentItemId', e.target.value || null)} error={err('link')}>
                <option value="">{t('Seleccione un equipo…')}</option>
                {equipment.map((x) => (
                  <option key={x.id} value={x.id}>{x.code} · {x.name}</option>
                ))}
              </SelectField>
            )}
            {input.evidenceMode === 'acknowledgement' && (
              <SelectField label={t('Documento de información o instrucciones')} required value={input.instructionDocumentId ?? ''} onChange={(e) => set('instructionDocumentId', e.target.value || null)} error={err('link')} hint={t('La confirmación acredita la recepción, no la formación.')}>
                <option value="">{t('Seleccione un documento…')}</option>
                {instructionDocs.map((d) => (
                  <option key={d.id} value={d.id}>{d.code} · {d.title}</option>
                ))}
              </SelectField>
            )}
            <TextAreaField className="span-all" label={t('Evidencia requerida')} required rows={2} value={input.evidenceRequired} onChange={(e) => set('evidenceRequired', e.target.value)} error={err('evidenceRequired')} />
          </div>
          {input.evidenceMode === 'acknowledgement' && instructionDocs.length === 0 && <p className="tiny muted">{t('No hay documentos de información o instrucciones de centro sin persona asignada. Regístrelos primero en Documentación.')}</p>}
        </fieldset>

        {health && (
          <fieldset>
            <legend>{t('Base de la vigilancia de la salud')}</legend>
            <div className="form-grid">
              <SelectField className="span-2" label={t('Carácter')} required value={input.health?.kind ?? 'voluntary'} onChange={(e) => setHealth({ kind: e.target.value as HealthBasis['kind'] })} error={err('health')}>
                {(Object.keys(HEALTH_KIND_LABEL) as HealthBasis['kind'][]).map((k) => (
                  <option key={k} value={k}>{t(HEALTH_KIND_LABEL[k])}</option>
                ))}
              </SelectField>
              {input.health?.kind === 'mandatory_exception' && (
                <>
                  <SelectField className="span-all" label={t('Supuesto del art. 22.1 LPRL')} value={input.health.exceptionGround ?? ''} onChange={(e) => setHealth({ exceptionGround: (e.target.value || null) as HealthBasis['exceptionGround'] })}>
                    <option value="">{t('Sin indicar')}</option>
                    {(Object.keys(HEALTH_GROUND_LABEL) as NonNullable<HealthBasis['exceptionGround']>[]).map((g) => (
                      <option key={g} value={g}>{t(HEALTH_GROUND_LABEL[g])}</option>
                    ))}
                  </SelectField>
                  <TextField label={t('Fecha del informe previo de la representación')} type="date" value={input.health.representativesReportOn ?? ''} onChange={(e) => setHealth({ representativesReportOn: e.target.value || null })} />
                  <TextField className="span-2" label={t('Referencia de la decisión profesional')} value={input.health.professionalReference ?? ''} onChange={(e) => setHealth({ professionalReference: e.target.value })} />
                </>
              )}
              {input.health?.kind === 'voluntary' && <TextField className="span-all" label={t('Referencia profesional (protocolos)')} value={input.health?.professionalReference ?? ''} onChange={(e) => setHealth({ professionalReference: e.target.value || null })} />}
            </div>
            {approvalGaps.length > 0 && (
              <Callout tone="warning" title={t('Puede guardarse como propuesta, pero el servicio médico no podrá aprobarla mientras falte:')}>
                <ul className="rq-error-list">
                  {approvalGaps.map((g, i) => (
                    <li key={i}>{t(g)}</li>
                  ))}
                </ul>
              </Callout>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend>{t('Ámbito de aplicación')}</legend>
          <div className="stack">
            <p className="tiny muted">{t('No se asume que todos los puestos necesiten los mismos documentos: indique solo los puestos, centros o riesgos a los que se aplica según la fuente.')}</p>
            {err('scope') && (
              <span className="error small" role="alert">
                {err('scope')}
              </span>
            )}
            <Checkbox label={t('Se aplica a toda la plantilla')} checked={input.scope.appliesToAll} onChange={(v) => setScope({ appliesToAll: v })} hint={t('Solo cuando la fuente lo exige para todas las personas (p. ej., formación inicial del puesto).')} />
            <div className="rq-scope-grid">
              <CheckList legend={t('Puestos')} options={roles.map((r) => ({ id: r.id, label: r.name }))} value={input.scope.jobRoleIds} onChange={(v) => setScope({ jobRoleIds: v })} emptyText={tKey('No hay puestos.')} />
              <CheckList legend={t('Centros de trabajo')} options={sites.map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }))} value={input.scope.worksiteIds} onChange={(v) => setScope({ worksiteIds: v })} emptyText={tKey('No hay centros.')} />
              <CheckList
                legend={t('Riesgos o tareas')}
                options={tags.map((r) => ({ id: r.id, label: r.label, flag: r.specialist ? <Badge tone="warning">{t('Fuera del alcance inicial')}</Badge> : undefined }))}
                value={input.scope.riskTags}
                onChange={(v) => setScope({ riskTags: v })}
                emptyText={tKey('No hay riesgos configurados.')}
              />
              <CheckList legend={t('Empleados concretos')} searchable options={employees.map((e) => ({ id: e.id, label: employeeName(ctx.db, e.id) }))} value={input.scope.employeeIds} onChange={(v) => setScope({ employeeIds: v })} emptyText={tKey('Sin resultados.')} />
            </div>
            {specialistSelected && (
              <Callout tone="warning" title={t('Riesgo especializado fuera del alcance inicial')}>
                {t('Los espacios confinados y las obras de construcción requieren gestión profesional específica. La aplicación solo registra la evidencia que el profesional indique.')}
              </Callout>
            )}
            <Checkbox label={t('Una evidencia por centro de trabajo')} checked={input.perWorksite} onChange={(v) => set('perWorksite', v)} hint={t('Para instrucciones de centro o información de coordinación: cada centro genera su propio elemento.')} />
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('Fuente y aplicabilidad')}</legend>
          <div className="form-grid">
            <SelectField label={t('Tipo de fuente')} required value={input.source.kind} onChange={(e) => setSource({ kind: e.target.value as SourceKind })}>
              {(Object.keys(SOURCE_KIND_LABEL) as SourceKind[]).map((k) => (
                <option key={k} value={k}>{t(SOURCE_KIND_LABEL[k])}</option>
              ))}
            </SelectField>
            <TextField className="span-2" label={t('Fuente o referencia')} required value={input.source.label} onChange={(e) => setSource({ label: e.target.value })} error={err('source')} placeholder={t('p. ej., Ley 31/1995, art. 19 o Evaluación ER-001')} />
            <TextField className="span-all" label={t('Enlace a la fuente (opcional)')} type="url" inputMode="url" value={input.source.url ?? ''} onChange={(e) => setSource({ url: e.target.value || null })} error={err('url')} hint={t('Preferiblemente la fuente oficial (BOE, INSST).')} />
            <TextAreaField className="span-all" label={t('Explicación de la aplicabilidad')} required rows={2} value={input.applicabilityNote} onChange={(e) => set('applicabilityNote', e.target.value)} error={err('applicabilityNote')} hint={t('Por qué se aplica a este ámbito y no a otros.')} />
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('Revisión, caducidad y fechas')}</legend>
          <div className="stack">
            <Callout tone="info" icon={Info}>
              {t('La aplicación no aplica periodicidades por defecto: una caducidad o revisión solo existe si la indica el documento, el proveedor o un profesional. «Sin caducidad» y «Revisión necesaria (no determinada)» son situaciones distintas.')}
            </Callout>
            <div className="form-grid">
              <SelectField label={t('Autoridad de revisión')} required value={input.reviewAuthority} onChange={(e) => set('reviewAuthority', e.target.value as ReviewAuthority)} error={err('reviewAuthority')} disabled={health}>
                {(Object.keys(AUTHORITY_LABEL) as ReviewAuthority[]).map((a) => (
                  <option key={a} value={a}>{t(AUTHORITY_LABEL[a])}</option>
                ))}
              </SelectField>
              <TextField className="span-2" label={t('Persona revisora responsable')} value={input.responsibleReviewer} onChange={(e) => set('responsibleReviewer', e.target.value)} placeholder={t('Nombre y organización')} />
              <SelectField className="span-all" label={t('Caducidad legal de la evidencia')} required value={input.expiryRule} onChange={(e) => set('expiryRule', e.target.value as ExpiryRule)} hint={t(EXPIRY_EXPLAIN[input.expiryRule])}>
                {(Object.keys(EXPIRY_RULE_LABEL) as ExpiryRule[]).map((k) => (
                  <option key={k} value={k}>{t(EXPIRY_RULE_LABEL[k])}</option>
                ))}
              </SelectField>
              <SelectField className="span-all" label={t('Revisión periódica de la evidencia')} required value={input.reviewRule.kind} onChange={(e) => setReview({ kind: e.target.value as ReviewRule['kind'], ...(e.target.value === 'interval' ? {} : { months: null, setBy: null }) })} hint={t(REVIEW_EXPLAIN[input.reviewRule.kind])} error={err('reviewRule')}>
                {(Object.keys(REVIEW_RULE_LABEL) as ReviewRule['kind'][]).map((k) => (
                  <option key={k} value={k}>{t(REVIEW_RULE_LABEL[k])}</option>
                ))}
              </SelectField>
              {input.reviewRule.kind === 'interval' && (
                <>
                  <TextField label={t('Meses entre revisiones')} required type="number" min={1} max={120} inputMode="numeric" value={input.reviewRule.months ?? ''} onChange={(e) => setReview({ months: e.target.value ? Math.round(Number(e.target.value)) : null })} />
                  <TextField className="span-2" label={t('Quién fijó la periodicidad')} required value={input.reviewRule.setBy ?? ''} onChange={(e) => setReview({ setBy: e.target.value || null })} placeholder={t('Proveedor o profesional y documento')} />
                </>
              )}
              <TextField label={t('Revisión de la política (opcional)')} type="date" value={input.policyReviewDate ?? ''} onChange={(e) => set('policyReviewDate', e.target.value || null)} error={err('policyReviewDate')} hint={t('Fecha para reconsiderar el propio requisito. No es la caducidad de las evidencias.')} />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('Aprobación profesional')}</legend>
          {professional ? (
            <div className="stack-sm">
              <Checkbox label={t('Propuesta: crítico para la asignación')} checked={!!input.critical} onChange={(v) => set('critical', v)} hint={t('La decisión final la toma otro profesional al aprobar (doble control).')} />
              <Checkbox label={t('Propuesta: admite excepción validada')} checked={!!input.exceptionAllowed} onChange={(v) => set('exceptionAllowed', v)} disabled={input.source.kind === 'law'} hint={input.source.kind === 'law' ? t('Un control exigido por una norma no admite excepciones de rutina.') : undefined} />
            </div>
          ) : (
            <p className="small rq-locked">
              <Lock size={14} aria-hidden /> {t('«Crítico» y «admite excepción» solo los fija el profesional que aprueba el requisito. Este borrador se guarda sin esos valores.')}
            </p>
          )}
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {needsApproval
              ? health
                ? t('Necesitará la aprobación del servicio médico antes de aplicarse.')
                : t('Necesitará la aprobación de un profesional del servicio de prevención antes de aplicarse.')
              : t('Opcional o no aplicable: la coordinación de PRL puede activarlo sin aprobación profesional.')}
          </p>
        </fieldset>

        <fieldset>
          <legend>{t('Vigencia y cambio')}</legend>
          <div className="form-grid">
            <TextField label={t('En vigor desde')} required type="date" min={ctx.today} value={input.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} error={err('effectiveFrom')} hint={t('Hoy o una fecha posterior: los cambios no son retroactivos.')} />
            <TextAreaField className="span-2" label={mode === 'new_version' ? t('Motivo del cambio') : t('Motivo o contexto (opcional)')} required={mode === 'new_version'} rows={2} value={input.changeReason} onChange={(e) => set('changeReason', e.target.value)} error={err('changeReason')} />
            {(mode === 'new_version' || (mode === 'edit' && (raw?.version ?? 1) > 1)) && (
              <div className="span-all">
                <Checkbox label={t('Las evidencias aceptadas con versiones anteriores deben revisarse de nuevo')} checked={input.invalidatesPriorEvidence} onChange={(v) => set('invalidatesPriorEvidence', v)} hint={t('Si no se marca, la evidencia ya aceptada sigue siendo válida con la nueva versión.')} />
              </div>
            )}
          </div>
        </fieldset>
        {shown.length > 0 && <p className="rq-error-foot small">{t('Hay {n} problemas por corregir (ver arriba).', { n: shown.length })}</p>}
      </div>
    </Modal>
  );
}
