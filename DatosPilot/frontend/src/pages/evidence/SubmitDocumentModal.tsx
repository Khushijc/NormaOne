/**
 * «Presentar documento»: new document or new version (replacement) of an existing one.
 * Upload never implies approval; a possible clinical file goes to quarantine and is not added
 * to the ordinary record. Legal expiry, provider review and internal follow-up stay separate and
 * a missing expiry is recorded as «No indicada» (no date is invented).
 */
import { AlertTriangle, ShieldAlert, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FilePicker } from '../../components/FilePicker';
import { Button, Callout, Checkbox, Modal, SelectField, TextAreaField, TextField, useAction, useToast } from '../../components/ui';
import { ITEM_STATUS, ACCESS_CLASS } from '../../domain/status';
import type { DemoFile, DocumentVersion, EvidenceDocument, ID } from '../../domain/types';
import { t } from '../../i18n';
import { clinicalKeywordHit, submitDocument, validateSubmit, versionsOfDocument, type SubmitInput } from '../../services/evidenceService';
import { employeeName, itemsFor, visibleEmployeeIds, visibleWorksiteIds, worksiteName } from '../../services/context';
import { getDb } from '../../store/db';
import { stored } from '../../components/localizedForm';
import { useCtx } from '../../store/hooks';
import { RequirementRef, suggestedCategory } from './evidenceShared';

type Subject = 'employee' | 'worksite';
type ExpiryChoice = DocumentVersion['expiryMode'] | '';
type FieldKey = 'employee' | 'requirement' | 'category' | 'title' | 'issuer' | 'issueDate' | 'expiry' | 'legal' | 'provider' | 'internal' | 'file';

/** Maps a validation message (Spanish, from the service) to the field it belongs to. */
function fieldOf(msg: string): FieldKey | null {
  if (msg.startsWith('Título')) return 'title';
  if (msg.startsWith('Emisor')) return 'issuer';
  if (msg.startsWith('Tipo de documento')) return 'category';
  if (msg.startsWith('Fecha de emisión') || msg.startsWith('La fecha de emisión')) return 'issueDate';
  if (msg.startsWith('Caducidad legal') || msg.startsWith('La caducidad')) return 'legal';
  if (msg.startsWith('Fecha de revisión del proveedor')) return 'provider';
  if (msg.startsWith('Fecha de seguimiento interno')) return 'internal';
  if (msg.startsWith('Archivo')) return 'file';
  if (msg.startsWith('Persona trabajadora')) return 'employee';
  if (msg.startsWith('Indique si')) return 'expiry';
  if (msg.startsWith('El requisito') || msg.startsWith('La vigilancia') || msg.startsWith('Este requisito')) return 'requirement';
  return null;
}

export function SubmitDocumentModal({
  onClose,
  onSubmitted,
  initialEmployeeId,
  initialTemplateId,
  document: existing,
  trainingId,
}: {
  onClose: () => void;
  /** Called with the document id when the document was added to the ordinary record. */
  onSubmitted?: (documentId: ID) => void;
  initialEmployeeId?: ID | null;
  initialTemplateId?: ID | null;
  /** Replacement: the new version is added to this document; the previous ones are preserved. */
  document?: EvidenceDocument | null;
  trainingId?: ID | null;
}) {
  const ctx = useCtx();
  const toast = useToast();
  const { run, pending } = useAction();
  const canOthers = ctx.can('evidence.upload');
  const canOwn = ctx.can('own.submit') && !!ctx.employee;

  const employees = useMemo(() => {
    const ids = canOthers ? visibleEmployeeIds(ctx) : new Set<ID>(canOwn && ctx.employee ? [ctx.employee.id] : []);
    return ctx.db.employees
      .filter((e) => ids.has(e.id) && e.companyId === ctx.company.id && e.status === 'active')
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es'));
  }, [ctx, canOthers, canOwn]);
  const worksites = useMemo(() => {
    const ids = visibleWorksiteIds(ctx);
    return ctx.db.worksites.filter((w) => ids.has(w.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [ctx]);
  const categories = ctx.db.categories.filter((c) => c.companyId === ctx.company.id && c.active && c.accessClass !== 'health' && c.accessClass !== 'quarantined');

  const startEmployee = existing ? existing.employeeId : initialEmployeeId && employees.some((e) => e.id === initialEmployeeId) ? initialEmployeeId : !canOthers && ctx.employee ? ctx.employee.id : '';
  const [subject, setSubject] = useState<Subject>(existing && !existing.employeeId ? 'worksite' : 'employee');
  const [employeeId, setEmployeeId] = useState<ID>(startEmployee ?? '');
  const [worksiteId, setWorksiteId] = useState<ID>(existing?.worksiteId ?? '');

  const items = useMemo(
    () => (subject === 'employee' && employeeId ? itemsFor(ctx, employeeId).filter((i) => !i.restricted && (i.version.evidenceMode === 'document' || i.version.evidenceMode === 'training')) : []),
    [ctx, subject, employeeId],
  );
  const initialItem = !existing && initialTemplateId ? items.find((i) => i.template.id === initialTemplateId) : undefined;
  const [itemKey, setItemKey] = useState<string>(initialItem?.key ?? '');
  const item = items.find((i) => i.key === itemKey);
  const missingInitial = !existing && !!initialTemplateId && !!employeeId && !initialItem && !itemKey;

  const latest = existing ? versionsOfDocument(ctx, existing.id)[0] : undefined;
  // Prefill from the stored record (the display database may be translated).
  const storedIssuer = latest ? getDb().docVersions.find((x) => x.id === latest.id)?.issuer ?? '' : '';
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? (initialItem ? suggestedCategory(initialItem.version.category) : ''));
  const [title, setTitle] = useState(existing?.title ?? (initialItem && startEmployee ? `${initialItem.version.name} — ${employeeName(ctx.db, startEmployee)}` : ''));
  const [issuer, setIssuer] = useState(storedIssuer);
  const [issueDate, setIssueDate] = useState('');
  const [expiry, setExpiry] = useState<ExpiryChoice>('');
  const [legal, setLegal] = useState('');
  const [provider, setProvider] = useState('');
  const [internal, setInternal] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<DemoFile | null>(null);
  const [clinical, setClinical] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const chooseItem = (key: string) => {
    setItemKey(key);
    const it = items.find((i) => i.key === key);
    if (it && !existing) {
      setCategoryId(suggestedCategory(it.version.category));
      if (!title.trim() && employeeId) setTitle(`${it.version.name} — ${employeeName(ctx.db, employeeId)}`);
    }
  };
  const chooseEmployee = (id: ID) => {
    setEmployeeId(id);
    setItemKey('');
  };

  const category = categories.find((c) => c.id === categoryId);
  const keyword = clinicalKeywordHit(ctx, title, file?.name, notes);
  const reviewRule = item?.version.reviewRule;

  // The suggested title is shown translated; if it was left unchanged, save it with the stored Spanish name.
  const storedTitle = (): string => {
    if (existing) return stored(title, getDb().documents.find((d) => d.id === existing.id)?.title);
    const it = item ?? initialItem;
    const person = employeeId ? employeeName(ctx.db, employeeId) : '';
    const rawName = it ? getDb().versions.find((v) => v.id === it.version.id)?.name : undefined;
    return it && rawName && title === `${it.version.name} — ${person}` ? `${rawName} — ${person}` : title;
  };

  const buildInput = (): SubmitInput => ({
    documentId: existing?.id ?? null,
    employeeId: existing ? existing.employeeId : subject === 'employee' ? employeeId || null : null,
    worksiteId: existing ? existing.worksiteId : subject === 'employee' ? item?.worksiteId ?? null : worksiteId || null,
    templateId: existing ? existing.templateId : subject === 'employee' ? item?.template.id ?? null : null,
    categoryId,
    title: storedTitle(),
    issuer,
    issueDate: issueDate || null,
    expiryMode: expiry || 'unknown',
    legalExpiryDate: expiry === 'date' ? legal || null : null,
    providerReviewDate: provider || null,
    internalFollowUpDate: internal || null,
    file,
    containsClinical: clinical,
    sourceReference,
    notes,
    trainingId: trainingId ?? null,
  });

  const submit = async () => {
    const input = buildInput();
    const local: string[] = [];
    if (!existing && subject === 'employee' && !employeeId) local.push('Persona trabajadora: obligatoria.');
    if (!expiry) local.push('Indique si el emisor establece una fecha de caducidad.');
    const all = [...local, ...validateSubmit(ctx, input)];
    setErrors(all);
    if (all.length) return;
    const r = await run(() => submitDocument(input));
    if (!r) return;
    if (r.quarantined) {
      toast.warning(t('Enviado a cuarentena: no se ha incorporado al expediente; lo gestionará el servicio médico'));
      onClose();
      return;
    }
    toast.success(existing ? t('Nueva versión recibida: pendiente de revisión (la versión anterior se conserva)') : t('Documento recibido: pendiente de revisión (la subida no implica aprobación)'));
    onClose();
    onSubmitted?.(r.document.id);
  };

  const errorFor = (k: FieldKey) => {
    const m = errors.find((e) => fieldOf(e) === k);
    return m ? t(m) : undefined;
  };
  const general = errors.filter((e) => fieldOf(e) === null);
  const noUploadRight = !canOthers && !canOwn;

  return (
    <Modal
      wide
      title={existing ? t('Presentar nueva versión') : t('Presentar documento')}
      description={existing ? t('{code} · se añadirá como versión {n}; las versiones anteriores se conservan.', { code: existing.code, n: (latest?.version ?? 0) + 1 }) : t('El documento queda recibido y pendiente de revisión. La subida no implica aprobación.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" icon={Upload} onClick={submit} loading={pending} disabled={noUploadRight}>
            {t('Presentar')}
          </Button>
        </>
      }
    >
      {noUploadRight && <Callout tone="warning">{t('Su rol no permite presentar documentos.')}</Callout>}
      {errors.length > 0 && (
        <Callout tone="danger" title={t('Revise los datos del documento')}>
          {general.length > 0 ? (
            <ul>
              {general.map((e) => (
                <li key={e}>{t(e)}</li>
              ))}
            </ul>
          ) : (
            t('Hay campos con errores; se indican junto a cada campo.')
          )}
        </Callout>
      )}

      <fieldset className="ev-fieldset">
        <legend>{t('A quién o a qué se refiere')}</legend>
        {existing ? (
          <dl className="kv">
            <dt>{existing.employeeId ? t('Persona trabajadora') : t('Centro de trabajo')}</dt>
            <dd>{existing.employeeId ? employeeName(ctx.db, existing.employeeId) : existing.worksiteId ? worksiteName(ctx.db, existing.worksiteId) : t('Toda la empresa')}</dd>
            <dt>{t('Requisito')}</dt>
            <dd>
              <RequirementRef templateId={existing.templateId} compact />
            </dd>
          </dl>
        ) : (
          <div className="stack">
            {canOthers && (
              <div className="segmented ev-scope" role="group" aria-label={t('Ámbito del documento')}>
                <button type="button" aria-pressed={subject === 'employee'} onClick={() => setSubject('employee')}>
                  {t('De una persona trabajadora')}
                </button>
                <button type="button" aria-pressed={subject === 'worksite'} onClick={() => setSubject('worksite')}>
                  {t('General o de un centro')}
                </button>
              </div>
            )}
            {subject === 'employee' ? (
              <div className="form-grid">
                <SelectField label={t('Persona trabajadora')} required value={employeeId} onChange={(e) => chooseEmployee(e.target.value)} disabled={!canOthers} error={errorFor('employee')}>
                  <option value="">{t('Seleccione…')}</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.firstName} {e.lastName}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={t('Requisito')}
                  className="span-2"
                  value={itemKey}
                  onChange={(e) => chooseItem(e.target.value)}
                  disabled={!employeeId}
                  error={errorFor('requirement')}
                  hint={employeeId && items.length === 0 ? t('No hay requisitos documentales o de formación aplicables a esta persona.') : t('Solo los requisitos que se aplican a esta persona y se acreditan con un documento o con formación.')}
                >
                  <option value="">{t('Sin requisito vinculado')}</option>
                  {items.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.template.code} · {i.version.name}
                      {i.worksiteId ? ` · ${worksiteName(ctx.db, i.worksiteId)}` : ''} ({t(ITEM_STATUS[i.status].label)})
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : (
              <div className="form-grid">
                <SelectField label={t('Centro de trabajo')} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)} hint={t('Instrucciones del centro, información general o evidencias sin persona concreta.')}>
                  <option value="">{t('Toda la empresa (sin centro)')}</option>
                  {worksites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
            {missingInitial && <Callout tone="warning">{t('El requisito indicado no se aplica a esta persona según la matriz vigente, o no se acredita con un documento. Elija otro o preséntelo sin requisito.')}</Callout>}
            {item && (
              <p className="small muted">
                {t('Evidencia esperada')}: {item.version.evidenceRequired || '—'}
              </p>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="ev-fieldset">
        <legend>{t('Documento')}</legend>
        <div className="form-grid">
          <SelectField
            label={t('Tipo de documento')}
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            error={errorFor('category')}
            hint={category && category.accessClass !== 'ordinary' ? `${t('Clasificación')}: ${t(ACCESS_CLASS[category.accessClass].label)} — ${t(ACCESS_CLASS[category.accessClass].help)}` : undefined}
          >
            <option value="">{t('Seleccione…')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Título')} required className="span-2" value={title} onChange={(e) => setTitle(e.target.value)} error={errorFor('title')} disabled={!!existing} hint={existing ? t('El título es el del documento; la nueva versión lo conserva.') : undefined} />
          <TextField label={t('Emisor')} required value={issuer} onChange={(e) => setIssuer(e.target.value)} error={errorFor('issuer')} hint={t('Entidad o persona que emite el documento.')} />
          <TextField label={t('Fecha de emisión')} type="date" max={ctx.today} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} error={errorFor('issueDate')} />
          <TextField label={t('Referencia de origen')} value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} hint={t('Número de certificado, registro o expediente del emisor.')} />
        </div>
      </fieldset>

      <fieldset className="ev-fieldset">
        <legend>{t('Fechas: tres tipos distintos')}</legend>
        <div className="stack">
          <div role="radiogroup" aria-label={t('Caducidad legal')} className="ev-radios">
            <span className="ev-radios-label">
              {t('Caducidad legal')}
              <span className="req" aria-hidden>
                *
              </span>
            </span>
            <label className="ev-radio">
              <input type="radio" name="ev-expiry" checked={expiry === 'date'} onChange={() => setExpiry('date')} />
              <span>{t('Fecha de caducidad indicada por el emisor')}</span>
            </label>
            {expiry === 'date' && (
              <div className="ev-radio-detail">
                <TextField label={t('Fecha de caducidad legal')} type="date" required value={legal} onChange={(e) => setLegal(e.target.value)} error={errorFor('legal')} />
              </div>
            )}
            <label className="ev-radio">
              <input type="radio" name="ev-expiry" checked={expiry === 'none'} onChange={() => setExpiry('none')} />
              <span>{t('Sin caducidad (el emisor no la establece)')}</span>
            </label>
            <label className="ev-radio">
              <input type="radio" name="ev-expiry" checked={expiry === 'unknown'} onChange={() => setExpiry('unknown')} />
              <span>
                {t('No indicada — requiere revisión')}
                <span className="small muted" style={{ display: 'block' }}>
                  {t('No se inventa ninguna fecha: el elemento queda como «Revisión necesaria» hasta que la autoridad de revisión la confirme.')}
                </span>
              </span>
            </label>
            {errorFor('expiry') && (
              <span className="ev-error" role="alert">
                <AlertTriangle size={12} aria-hidden /> {errorFor('expiry')}
              </span>
            )}
          </div>
          <div className="form-grid">
            <TextField
              label={t('Fecha de revisión del proveedor (opcional)')}
              type="date"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              error={errorFor('provider')}
              hint={reviewRule?.kind === 'interval' ? t('Este requisito tiene una periodicidad fijada por {who}: si se deja vacía, se calculará al aceptar.', { who: reviewRule.setBy ?? '—' }) : t('Solo si el proveedor la indica. Es distinta de la caducidad legal.')}
            />
            <TextField label={t('Seguimiento interno (opcional)')} type="date" value={internal} onChange={(e) => setInternal(e.target.value)} error={errorFor('internal')} hint={t('Fecha interna de la empresa; no es un plazo legal.')} />
          </div>
        </div>
      </fieldset>

      <fieldset className="ev-fieldset">
        <legend>{t('Archivo y clasificación')}</legend>
        <div className="stack">
          <FilePicker value={file} onChange={setFile} error={errorFor('file')} />
          <Checkbox
            label={t('Este archivo puede contener información médica o clínica')}
            hint={t('Si lo marca, el archivo va a cuarentena: no se incorpora al expediente ordinario y solo lo gestiona el servicio médico.')}
            checked={clinical}
            onChange={setClinical}
          />
          {(clinical || keyword) && (
            <Callout tone="warning" icon={ShieldAlert} title={t('Irá a cuarentena')}>
              {keyword && !clinical ? t('El texto coincide con un término configurado («{term}»). El archivo no se incorporará al expediente.', { term: keyword }) : t('El archivo no se incorporará al expediente ordinario ni será visible en esta lista.')}
            </Callout>
          )}
          <TextAreaField label={t('Notas')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} hint={t('No incluya datos de salud.')} />
        </div>
      </fieldset>
    </Modal>
  );
}
