import { FileUp, Save, Send, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { RecordNotFound } from '../../components/guards';
import { Button, Callout, Card, Checkbox, Money, PageHeader, SelectField, SimulatedTag, TextAreaField, TextField, useAction, useToast } from '../../components/ui';
import { centsToInput, formatEUR, parseAmountToCents } from '../../domain/money';
import type { ExpenseRecord } from '../../domain/types';
import { findExpenseDuplicates, validateExpense } from '../../domain/validation';
import { t } from '../../i18n';
import { addAttachment, DOCUMENT_TYPE_LABEL, EXPENSE_CATEGORIES, readLocalFile, saveExpense, submitExpense, type ExpenseInput } from '../../services/expenseService';
import { extractFromDocument, type ExtractionSuggestion } from '../../services/mock/channels';
import { useCtx } from '../../store/hooks';

type LocalFile = Awaited<ReturnType<typeof readLocalFile>>;

export function ExpenseEditorPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const existing = id ? ctx.db.expenses.find((e) => e.id === id && e.companyId === ctx.company.id) : undefined;
  if (id && !existing) return <RecordNotFound back="/gastos" label={t('gastos')} />;
  if (existing && existing.reviewStatus !== 'draft' && existing.reviewStatus !== 'rejected') {
    return <Card><Callout tone="warning" title={t('Este gasto no es editable')}>{t('Un gasto enviado o aprobado se conserva como evidencia.')} <Link to={`/gastos/${existing.id}`}>{t('Volver')}</Link></Callout></Card>;
  }
  return <Editor key={existing?.id ?? 'new'} existing={existing} />;
}

function Editor({ existing }: { existing?: ExpenseRecord }) {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { runOk, pending } = useAction();
  const kind: ExpenseRecord['kind'] = existing?.kind ?? (params.get('tipo') === 'proveedor' && ctx.can('expenses.manage_supplier') ? 'supplier_invoice' : 'employee_expense');
  const suppliers = db.suppliers.filter((s) => s.companyId === ctx.company.id && (!s.archived || s.id === existing?.supplierId));

  const [f, setF] = useState({
    supplierId: existing?.supplierId ?? '',
    merchantName: existing?.merchantName ?? '',
    documentType: existing?.documentType ?? (kind === 'supplier_invoice' ? 'complete_invoice' : 'simplified_invoice'),
    documentNumber: existing?.documentNumber ?? '',
    documentDate: existing?.documentDate ?? ctx.today,
    accountingPeriod: existing?.accountingPeriod ?? ctx.today.slice(0, 7),
    category: existing?.category ?? (kind === 'supplier_invoice' ? 'materiales' : 'dietas'),
    description: existing?.description ?? '',
    base: existing ? centsToInput(existing.baseCents) : '',
    vatRatePct: String(existing?.vatRatePct ?? 21),
    vat: existing ? centsToInput(existing.vatCents) : '',
    vatTouched: !!existing,
    withholding: centsToInput(existing?.withholdingCents ?? 0),
    recipientNifShown: existing?.recipientNifShown ?? false,
    dueDate: existing?.dueDate ?? '',
  });
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [suggestion, setSuggestion] = useState<ExtractionSuggestion | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [ackDup, setAckDup] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const baseCents = parseAmountToCents(f.base);
  const rate = Number(f.vatRatePct);
  const autoVat = baseCents !== null ? Math.round((baseCents * rate) / 100) : 0;
  const vatCents = f.vatTouched ? parseAmountToCents(f.vat) ?? 0 : autoVat;
  const whCents = parseAmountToCents(f.withholding) ?? 0;
  const totalCents = (baseCents ?? 0) + vatCents - whCents;

  const input: ExpenseInput = {
    kind,
    supplierId: f.supplierId || null,
    merchantName: f.supplierId ? '' : f.merchantName,
    documentType: f.documentType,
    documentNumber: f.documentNumber.trim(),
    documentDate: f.documentDate,
    accountingPeriod: f.accountingPeriod,
    category: f.category,
    description: f.description,
    baseCents: baseCents ?? -1,
    vatRatePct: rate,
    vatCents,
    withholdingCents: whCents,
    totalCents,
    recipientNifShown: f.documentType === 'simplified_invoice' ? f.recipientNifShown : true,
    dueDate: kind === 'supplier_invoice' && f.dueDate ? f.dueDate : null,
  };
  const existingAttachments = existing ? db.attachments.filter((a) => existing.attachmentIds.includes(a.id)) : [];
  const v = validateExpense({ ...input, attachmentIds: [...(existing?.attachmentIds ?? []), ...files.map((x) => x.fingerprint)] }, ctx.today, true);
  const dups = findExpenseDuplicates({ ...input, id: existing?.id, companyId: ctx.company.id, attachmentIds: existing?.attachmentIds ?? [] }, db.expenses.filter((e) => e.companyId === ctx.company.id), db.attachments.filter((a) => a.companyId === ctx.company.id), files.map((x) => x.fingerprint));
  const e = (k: string) => (touched && v.errors[k] ? t(v.errors[k]) : undefined);

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      try {
        const lf = await readLocalFile(file);
        setFiles((fs) => [...fs, lf]);
      } catch (err) {
        toast.error(err);
      }
    }
  };

  const suggest = async () => {
    const src = files[files.length - 1] ?? existingAttachments[existingAttachments.length - 1];
    if (!src) return;
    setExtracting(true);
    try {
      setSuggestion(await extractFromDocument(src.fileName, src.sizeBytes));
    } finally {
      setExtracting(false);
    }
  };
  const applySuggestion = () => {
    if (!suggestion) return;
    setF((x) => ({
      ...x,
      documentNumber: suggestion.documentNumber ?? x.documentNumber,
      base: suggestion.baseCents !== undefined ? centsToInput(suggestion.baseCents) : x.base,
      vatRatePct: suggestion.vatRatePct !== undefined ? String(suggestion.vatRatePct) : x.vatRatePct,
      vatTouched: false,
    }));
    toast.info(t('Sugerencias aplicadas: revíselas con el documento antes de guardar.'));
  };

  const save = async (andSubmit: boolean) => {
    setTouched(true);
    const draftErrors = Object.entries(v.errors).filter(([k]) => k !== 'attachments');
    if (draftErrors.length || baseCents === null) return;
    if (andSubmit && v.errors.attachments) return;
    if (andSubmit && dups.length && !ackDup) return;
    let savedId = existing?.id ?? '';
    const ok = await runOk(async () => {
      const saved = await saveExpense(existing?.id ?? null, input);
      savedId = saved.id;
      for (const file of files) await addAttachment(saved.id, file);
      if (andSubmit) await submitExpense(saved.id, ackDup);
    }, andSubmit ? t('Gasto enviado a revisión') : t('Borrador guardado'));
    if (savedId) navigate(`/gastos/${savedId}`);
    void ok;
  };

  return (
    <>
      <PageHeader
        breadcrumbs={<><Link to="/gastos">{t('Gastos')}</Link> / {existing ? t('Editar') : t('Nuevo')}</>}
        title={existing ? t('Editar gasto') : kind === 'supplier_invoice' ? t('Registrar factura recibida') : t('Nuevo gasto de empleado')}
        subtitle={t('El justificante se conserva tal como se adjunta. El reconocimiento de datos es una ayuda simulada: nunca aprueba ni decide el tratamiento fiscal.')}
        actions={
          <>
            <Button onClick={() => navigate(existing ? `/gastos/${existing.id}` : '/gastos')}>{t('Cancelar')}</Button>
            <Button icon={Save} loading={pending} onClick={() => save(false)}>{t('Guardar borrador')}</Button>
            <Button variant="primary" icon={Send} loading={pending} onClick={() => save(true)}>{t('Guardar y enviar a revisión')}</Button>
          </>
        }
      />
      {existing?.reviewStatus === 'rejected' && <div style={{ marginBottom: 16 }}><Callout tone="danger" title={t('Rechazado')}>{existing.reviewComment}</Callout></div>}
      <div className="grid-main-side">
        <div className="stack">
          <Card title={t('Documento')}>
            <div className="form-grid">
              <SelectField label={t('Proveedor')} required={kind === 'supplier_invoice'} value={f.supplierId} onChange={(ev) => { set('supplierId', ev.target.value); const s = suppliers.find((x) => x.id === ev.target.value); if (s) set('category', s.defaultCategory); }} error={e('supplierId')} className="span-2">
                <option value="">{kind === 'supplier_invoice' ? t('Seleccione…') : t('Establecimiento no registrado')}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legalName} · {s.idNumber}</option>)}
              </SelectField>
              {!f.supplierId && kind === 'employee_expense' && <TextField label={t('Establecimiento')} required value={f.merchantName} onChange={(ev) => set('merchantName', ev.target.value)} error={e('supplierId')} />}
              <SelectField label={t('Tipo de documento')} value={f.documentType} onChange={(ev) => set('documentType', ev.target.value as ExpenseRecord['documentType'])}>
                {Object.entries(DOCUMENT_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </SelectField>
              <TextField label={t('Número')} required={f.documentType !== 'receipt_no_vat'} value={f.documentNumber} onChange={(ev) => set('documentNumber', ev.target.value)} error={e('documentNumber')} />
              <TextField label={t('Fecha del documento')} type="date" required value={f.documentDate} max={ctx.today} onChange={(ev) => { set('documentDate', ev.target.value); if (ev.target.value) set('accountingPeriod', ev.target.value.slice(0, 7)); }} error={e('documentDate')} />
              <TextField label={t('Periodo contable')} type="month" required value={f.accountingPeriod} onChange={(ev) => set('accountingPeriod', ev.target.value)} error={e('accountingPeriod')} />
              <SelectField label={t('Categoría')} required value={f.category} onChange={(ev) => set('category', ev.target.value)} error={e('category')}>
                {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </SelectField>
              {kind === 'supplier_invoice' && <TextField label={t('Vencimiento de pago')} type="date" value={f.dueDate} onChange={(ev) => set('dueDate', ev.target.value)} />}
              <TextAreaField label={t('Descripción / motivo del gasto')} required className="span-all" rows={2} value={f.description} onChange={(ev) => set('description', ev.target.value)} error={e('description')} />
            </div>
          </Card>
          <Card title={t('Importes')}>
            <div className="form-grid">
              <TextField label={t('Base imponible (€)')} required inputMode="decimal" value={f.base} onChange={(ev) => set('base', ev.target.value)} error={touched && baseCents === null ? t('Importe no válido.') : e('baseCents')} placeholder={t('0,00')} />
              <SelectField label={t('Tipo de IVA soportado')} value={f.vatRatePct} onChange={(ev) => setF((x) => ({ ...x, vatRatePct: ev.target.value, vatTouched: false }))} disabled={f.documentType === 'receipt_no_vat'}>
                {[21, 10, 4, 0].map((r) => <option key={r} value={r}>{r} %</option>)}
              </SelectField>
              <TextField label={t('Cuota de IVA (€)')} inputMode="decimal" value={f.vatTouched ? f.vat : centsToInput(autoVat)} onChange={(ev) => setF((x) => ({ ...x, vat: ev.target.value, vatTouched: true }))} error={e('vatCents')} hint={t('Calculada; edítela si el documento muestra otra cuota.')} />
              {kind === 'supplier_invoice' && <TextField label={t('Retención IRPF (€)')} inputMode="decimal" value={f.withholding} onChange={(ev) => set('withholding', ev.target.value)} hint={t('Solo si el proveedor es un profesional persona física.')} />}
              <div className="field"><span className="label">{t('Total')}</span><div style={{ fontSize: 20, fontWeight: 650, paddingTop: 4 }}><Money cents={totalCents} /></div></div>
            </div>
            {f.documentType === 'simplified_invoice' && (
              <div style={{ marginTop: 12 }}>
                <Checkbox label={t('El ticket muestra el NIF de la empresa y la cuota de IVA desglosada')} checked={f.recipientNifShown} onChange={(v2) => set('recipientNifShown', v2)} hint={t('Sin estos datos la cuota podría no ser deducible (RD 1619/2012 art. 7.2; LIVA art. 97). La gestoría decide.')} />
              </div>
            )}
          </Card>
          {(touched && Object.keys(v.errors).length > 0) && <Callout tone="danger" title={t('Corrija antes de continuar')}><ul>{Object.values(v.errors).map((x, i) => <li key={i}>{t(x)}</li>)}</ul></Callout>}
          {v.warnings.length > 0 && <Callout tone="warning" title={t('Avisos')}><ul>{v.warnings.map((w, i) => <li key={i}>{t(w)}</li>)}</ul></Callout>}
          {dups.length > 0 && (
            <Callout tone="danger" title={t('Posible duplicado')}>
              <ul>{dups.map((d) => <li key={d.id}>{t(d.reason)} <Link to={`/gastos/${d.id}`}>{t('Ver registro')}</Link></li>)}</ul>
              <div style={{ marginTop: 6 }}><Checkbox label={t('He comprobado que no es un duplicado (quedará registrado)')} checked={ackDup} onChange={setAckDup} /></div>
            </Callout>
          )}
        </div>
        <div className="stack">
          <Card title={t('Justificantes')}>
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && fileRef.current?.click()}
              onDragOver={(ev) => { ev.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(ev) => { ev.preventDefault(); setDrag(false); onFiles(ev.dataTransfer.files); }}
            >
              <FileUp size={22} aria-hidden />
              <div className="strong">{t('Arrastre o seleccione el ticket o factura')}</div>
              <div className="small">{t('PDF, JPG, PNG o WEBP · máx. 10 MB. Se guarda solo en este navegador; no se sube a ningún servicio.')}</div>
            </div>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden onChange={(ev) => { onFiles(ev.target.files); ev.target.value = ''; }} />
            {e('attachments') && <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>{e('attachments')}</div>}
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }} className="stack-sm">
              {existingAttachments.map((a) => <li key={a.id} className="small">📎 {a.fileName} <span className="muted">{t('(v{v}, ya adjunto)', { v: a.version })}</span></li>)}
              {files.map((x, i) => (
                <li key={i} className="row small">
                  📎 {x.fileName} <span className="muted">{x.dataUrl ? `(${Math.round(x.sizeBytes / 1024)} KB)` : t('({kb} KB, solo metadatos)', { kb: Math.round(x.sizeBytes / 1024) })}</span>
                  <Button size="sm" variant="ghost" iconOnly icon={X} aria-label={t('Quitar {name}', { name: x.fileName })} onClick={() => setFiles((fs) => fs.filter((_, idx) => idx !== i))} />
                </li>
              ))}
            </ul>
            {(files.length > 0 || existingAttachments.length > 0) && (
              <div style={{ marginTop: 12 }} className="stack-sm">
                <Button icon={Sparkles} loading={extracting} onClick={suggest}>{t('Sugerir datos del justificante')}</Button>
                <SimulatedTag label={t('Reconocimiento simulado (capacidad futura)')} />
                {suggestion && (
                  <Callout tone="info" title={t('Sugerencias (confianza {pct} %)', { pct: Math.round(suggestion.confidence * 100) })}>
                    <ul>
                      {suggestion.documentNumber && <li>{t('Número')}: {suggestion.documentNumber}</li>}
                      {suggestion.baseCents !== undefined && <li>{t('Base')}: {formatEUR(suggestion.baseCents)}</li>}
                      {suggestion.vatRatePct !== undefined && <li>{t('Tipo IVA')}: {suggestion.vatRatePct} %</li>}
                    </ul>
                    <div className="row" style={{ marginTop: 6 }}>
                      <Button size="sm" onClick={applySuggestion}>{t('Aplicar al formulario')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>{t('Descartar')}</Button>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 4 }}>{t('Valores ficticios generados localmente. Compruébelos con el documento.')}</div>
                  </Callout>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
