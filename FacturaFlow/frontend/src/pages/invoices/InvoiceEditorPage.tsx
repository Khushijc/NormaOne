import { Plus, Save, Send, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RecordNotFound } from '../../components/guards';
import { IssueGatePanel } from '../../components/invoiceBits';
import { Button, Callout, Card, Money, PageHeader, SelectField, TextAreaField, TextField, useAction } from '../../components/ui';
import { addDays } from '../../domain/dates';
import { computeTotals, lineAmounts } from '../../domain/invoiceCalc';
import { centsToInput, formatPct, parseAmountToCents, parseDecimal } from '../../domain/money';
import { newId } from '../../domain/ids';
import type { Invoice, InvoiceLine } from '../../domain/types';
import { validateInvoiceForApproval } from '../../domain/validation';
import { requestApproval, saveDraft } from '../../services/invoiceService';
import { getLang, t } from '../../i18n';
import { useCtx } from '../../store/hooks';
import { PartyFormModal } from '../parties/PartyFormModal';

/** Quantity / percentage as typed in the interface language (decimal comma in Spanish). */
const decToInput = (n: number) => (getLang() === 'en' ? String(n) : String(n).replace('.', ','));

interface LineDraft {
  id: string;
  description: string;
  qty: string;
  price: string;
  disc: string;
  taxCode: string;
}

const toDraft = (l: InvoiceLine): LineDraft => ({ id: l.id, description: l.description, qty: decToInput(l.quantity), price: centsToInput(l.unitPriceCents), disc: decToInput(l.discountPct), taxCode: l.taxCode });

function toLine(d: LineDraft): InvoiceLine {
  return {
    id: d.id,
    description: d.description.trim(),
    quantity: parseDecimal(d.qty) ?? NaN,
    unitPriceCents: parseAmountToCents(d.price) ?? NaN,
    discountPct: d.disc.trim() === '' ? 0 : parseDecimal(d.disc) ?? NaN,
    taxCode: d.taxCode,
  };
}

export function InvoiceEditorPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const db = ctx.db;
  const existing = id ? db.invoices.find((i) => i.id === id && i.companyId === ctx.company.id) : undefined;
  if (id && !existing) return <RecordNotFound back="/facturas" label={t('facturas')} />;
  if (existing && existing.documentStatus !== 'draft') {
    return (
      <Card>
        <Callout tone="warning" title={t('Esta factura no es editable')}>
          {existing.documentStatus === 'approved'
            ? t('Está aprobada. Revoque la aprobación desde el detalle para volver a editarla.')
            : t('Las facturas emitidas no se modifican ni se eliminan: cree una factura rectificativa vinculada.')}
        </Callout>
        <div style={{ marginTop: 12 }}>
          <Link className="btn" to={`/facturas/${existing.id}`}>{t('Volver al detalle')}</Link>
        </div>
      </Card>
    );
  }
  return <Editor key={existing?.id ?? 'new'} existing={existing} />;
}

function Editor({ existing }: { existing?: Invoice }) {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const { run, runOk, pending } = useAction();
  const rectifying = existing?.kind === 'rectifying';
  const customers = db.customers.filter((c) => c.companyId === ctx.company.id && (!c.archived || c.id === existing?.customerId));
  const series = db.series.filter((s) => s.companyId === ctx.company.id && s.active && s.kind === (rectifying ? 'rectifying' : 'ordinary'));
  const taxCodes = db.taxCodes;
  const defaultTax = ctx.finance.approvedTaxCodes[0] ?? 'IVA21';

  const [customerId, setCustomerId] = useState(existing?.customerId ?? '');
  const [seriesId, setSeriesId] = useState(existing?.seriesId ?? series[0]?.id ?? '');
  const [operationDate, setOperationDate] = useState(existing?.operationDate ?? ctx.today);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? addDays(ctx.today, ctx.finance.defaultPaymentTermsDays));
  const [paymentTerms, setPaymentTerms] = useState(existing?.paymentTerms ?? `Transferencia bancaria a ${ctx.finance.defaultPaymentTermsDays} días`);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [withholdingPct, setWithholdingPct] = useState(existing?.totals.withholdingPct ?? (ctx.finance.irpfWithholding.applies ? ctx.finance.irpfWithholding.ratePct : 0));
  const [lines, setLines] = useState<LineDraft[]>(existing ? existing.lines.map(toDraft) : [{ id: newId('lin'), description: '', qty: '1', price: '', disc: '0', taxCode: defaultTax }]);
  const [showErrors, setShowErrors] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);

  const parsed = lines.map(toLine);
  const lineOk = parsed.every((l) => Number.isFinite(l.quantity) && Number.isFinite(l.unitPriceCents) && Number.isFinite(l.discountPct));
  const totals = useMemo(() => computeTotals(parsed.map((l) => ({ ...l, quantity: Number.isFinite(l.quantity) ? l.quantity : 0, unitPriceCents: Number.isFinite(l.unitPriceCents) ? l.unitPriceCents : 0, discountPct: Number.isFinite(l.discountPct) ? l.discountPct : 0 })), taxCodes, withholdingPct), [parsed, taxCodes, withholdingPct]);
  const customer = customers.find((c) => c.id === customerId);

  const candidate: Invoice = {
    ...(existing ?? ({} as Invoice)),
    id: existing?.id ?? 'new',
    companyId: ctx.company.id,
    kind: existing?.kind ?? 'ordinary',
    seriesId,
    customerId,
    operationDate: operationDate || null,
    dueDate: dueDate || null,
    lines: parsed,
    totals,
    rectification: existing?.rectification ?? null,
  };
  const original = existing?.rectification ? db.invoices.find((i) => i.id === existing.rectification!.originalInvoiceId) : undefined;
  const validation = validateInvoiceForApproval(candidate, customer, ctx.finance, taxCodes, ctx.today, original ? original.operationDate ?? original.issueDate : null);
  // Validation messages are produced in Spanish (domain/validation.ts) and translated for display.
  const err = (k: string) => (showErrors && validation.errors[k] ? t(validation.errors[k]) : undefined);

  const onCustomer = (cid: string) => {
    setCustomerId(cid);
    const c = customers.find((x) => x.id === cid);
    if (!c) return;
    setDueDate(addDays(ctx.today, c.paymentTermsDays));
    setPaymentTerms(c.paymentTermsDays === 0 ? 'Pago al contado' : `Transferencia bancaria a ${c.paymentTermsDays} días`);
    if (ctx.finance.irpfWithholding.applies) setWithholdingPct(c.kind === 'individual' ? 0 : ctx.finance.irpfWithholding.ratePct);
    if (!existing) setLines((ls) => ls.map((l) => (l.description || l.price ? l : { ...l, taxCode: ctx.finance.approvedTaxCodes.includes(c.defaultTaxCode) ? c.defaultTaxCode : defaultTax })));
  };

  const updateLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async (andRequest: boolean) => {
    setShowErrors(true);
    if (!customerId || !seriesId) return;
    if (!lineOk) return;
    const inv = await run(() => saveDraft(existing?.id ?? null, { customerId, seriesId, operationDate: operationDate || null, dueDate: dueDate || null, lines: parsed, notes, paymentTerms, withholdingPct }), t('Borrador guardado'));
    if (!inv) return;
    if (andRequest) {
      const ok = await runOk(() => requestApproval(inv.id, ''), t('Aprobación solicitada a las personas autorizadas'));
      if (!ok) {
        navigate(`/facturas/${inv.id}/editar`, { replace: true });
        return;
      }
    }
    navigate(`/facturas/${inv.id}`);
  };

  const errorList = Object.values(validation.errors);
  const selectedSeries = series.find((s) => s.id === seriesId);
  const rect = existing?.rectification;
  return (
    <>
      <PageHeader
        title={existing ? (rectifying ? t('Editar rectificativa (borrador)') : t('Editar borrador')) : t('Nueva factura')}
        breadcrumbs={<><Link to="/facturas">{t('Facturas')}</Link> / {existing ? t('Editar') : t('Nueva')}</>}
        subtitle={t('El número se asigna al emitir, desde el contador de la serie, para garantizar la numeración correlativa sin huecos.')}
        actions={
          <>
            <Button onClick={() => navigate(existing ? `/facturas/${existing.id}` : '/facturas')}>{t('Cancelar')}</Button>
            <Button icon={Save} onClick={() => save(false)} loading={pending}>{t('Guardar borrador')}</Button>
            <Button variant="primary" icon={Send} onClick={() => save(true)} loading={pending}>{t('Guardar y solicitar aprobación')}</Button>
          </>
        }
      />
      <div className="stack-lg">
        <IssueGatePanel ctx={ctx} />
        {rectifying && original && (
          <Callout tone="info" title={t('Rectificativa de {n} · {code} · {method}', { n: original.number ?? '', code: rect?.reasonCode ?? '', method: rect?.method === 'substitution' ? t('por sustitución') : t('por diferencias') })}>
            {t('Motivo: {reason}. La factura original no se modifica.', { reason: rect?.reasonText ?? '' })}
          </Callout>
        )}
        <Card title={t('Datos generales')}>
          <div className="form-grid">
            <div className="span-2">
              <SelectField label={t('Cliente')} required value={customerId} onChange={(e) => onCustomer(e.target.value)} error={showErrors && !customerId ? t('Seleccione un cliente.') : err('customerId')} disabled={rectifying}>
                <option value="">{t('Seleccione…')}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName} · {c.idNumber || t('sin NIF')}
                  </option>
                ))}
              </SelectField>
              {ctx.can('customers.manage') && !rectifying && (
                <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setNewCustomer(true)}>
                  <UserPlus size={14} /> {t('Nuevo cliente')}
                </button>
              )}
            </div>
            <SelectField label={t('Serie')} required value={seriesId} onChange={(e) => setSeriesId(e.target.value)} error={err('seriesId')} hint={selectedSeries ? t('Próximo número previsto: {n} (se confirma al emitir)', { n: `${selectedSeries.prefix}${String(selectedSeries.nextNumber).padStart(selectedSeries.padding, '0')}` }) : undefined}>
              {series.length === 0 && <option value="">{t('No hay series activas')}</option>}
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.description}
                </option>
              ))}
            </SelectField>
            <TextField label={t('Fecha de operación')} type="date" value={operationDate} onChange={(e) => setOperationDate(e.target.value)} error={err('operationDate')} hint={t('Si difiere de la fecha de expedición (art. 6.1.i).')} />
            <TextField label={t('Vencimiento')} type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={err('dueDate')} hint={customer ? t('Plazo del cliente: {n} días', { n: customer.paymentTermsDays }) : undefined} />
            <TextField label={t('Condiciones de pago')} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="span-2" />
            {ctx.finance.irpfWithholding.applies && (
              <SelectField label={t('Retención IRPF')} value={String(withholdingPct)} onChange={(e) => setWithholdingPct(Number(e.target.value))} hint={t('Profesional persona física con cliente empresario/profesional (LIRPF art. 101.5). El 7 % exige declaración del inicio de actividad.')}>
                <option value="15">{t('15 % (general)')}</option>
                <option value="7">{t('7 % (inicio de actividad)')}</option>
                <option value="0">{t('Sin retención')}</option>
              </SelectField>
            )}
          </div>
        </Card>

        <Card title={t('Líneas')} actions={<Button size="sm" icon={Plus} onClick={() => setLines((ls) => [...ls, { id: newId('lin'), description: '', qty: '1', price: '', disc: '0', taxCode: customer?.defaultTaxCode && ctx.finance.approvedTaxCodes.includes(customer.defaultTaxCode) ? customer.defaultTaxCode : defaultTax }])}>{t('Añadir línea')}</Button>} flush>
          {err('lines') && <div style={{ padding: '8px 16px' }}><Callout tone="danger">{err('lines')}</Callout></div>}
          <div className="table-wrap">
            <table className="table line-editor">
              <thead>
                <tr>
                  <th style={{ minWidth: 260 }}>{t('Descripción')}</th>
                  <th className="num" style={{ width: 90 }}>{t('Cantidad')}</th>
                  <th className="num" style={{ width: 120 }}>{t('Precio unit. (sin IVA)')}</th>
                  <th className="num" style={{ width: 80 }}>{t('Dto. %')}</th>
                  <th style={{ width: 200 }}>{t('Tratamiento fiscal')}</th>
                  <th className="num" style={{ width: 110 }}>{t('Base')}</th>
                  <th style={{ width: 44 }}><span className="sr-only">{t('Acciones')}</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = parsed[i];
                  const base = Number.isFinite(p.quantity) && Number.isFinite(p.unitPriceCents) && Number.isFinite(p.discountPct) ? lineAmounts(p).baseCents : null;
                  const e = (k: string) => err(`lines.${i}.${k}`);
                  const n = i + 1;
                  return (
                    <tr key={l.id}>
                      <td>
                        <input className="input" aria-label={t('Descripción línea {n}', { n })} value={l.description} onChange={(ev) => updateLine(i, { description: ev.target.value })} aria-invalid={!!e('description') || undefined} placeholder={t('Servicio prestado')} />
                        {e('description') && <div className="error small" style={{ color: 'var(--danger)' }}>{e('description')}</div>}
                      </td>
                      <td>
                        <input className="input num" inputMode="decimal" aria-label={t('Cantidad línea {n}', { n })} value={l.qty} onChange={(ev) => updateLine(i, { qty: ev.target.value })} aria-invalid={!Number.isFinite(p.quantity) || !!e('quantity') || undefined} />
                        {(e('quantity') || (showErrors && !Number.isFinite(p.quantity))) && <div className="small" style={{ color: 'var(--danger)' }}>{e('quantity') ?? t('Número no válido')}</div>}
                      </td>
                      <td>
                        <input className="input num" inputMode="decimal" aria-label={t('Precio línea {n}', { n })} value={l.price} onChange={(ev) => updateLine(i, { price: ev.target.value })} placeholder={t('0,00')} aria-invalid={(l.price !== '' && !Number.isFinite(p.unitPriceCents)) || !!e('unitPriceCents') || undefined} />
                        {((showErrors && !Number.isFinite(p.unitPriceCents)) || e('unitPriceCents')) && <div className="small" style={{ color: 'var(--danger)' }}>{e('unitPriceCents') ?? t('Importe no válido (p. ej. 1.234,56)')}</div>}
                      </td>
                      <td>
                        <input className="input num" inputMode="decimal" aria-label={t('Descuento línea {n}', { n })} value={l.disc} onChange={(ev) => updateLine(i, { disc: ev.target.value })} aria-invalid={!!e('discountPct') || undefined} />
                        {e('discountPct') && <div className="small" style={{ color: 'var(--danger)' }}>{e('discountPct')}</div>}
                      </td>
                      <td>
                        <select className="select" aria-label={t('Tratamiento fiscal línea {n}', { n })} value={l.taxCode} onChange={(ev) => updateLine(i, { taxCode: ev.target.value })} aria-invalid={!!e('taxCode') || undefined}>
                          {taxCodes.map((tc) => {
                            const approved = ctx.finance.approvedTaxCodes.includes(tc.code);
                            return (
                              <option key={tc.code} value={tc.code} disabled={!approved && tc.code !== l.taxCode}>
                                {t(tc.label)}
                                {tc.supportStatus === 'unsupported' ? ` — ${t('no soportado')}` : !approved ? ` — ${t('no aprobado')}` : ''}
                              </option>
                            );
                          })}
                        </select>
                        {e('taxCode') && <div className="small" style={{ color: 'var(--danger)' }}>{e('taxCode')}</div>}
                      </td>
                      <td className="num">{base === null ? '—' : <Money cents={base} />}</td>
                      <td>
                        <Button size="sm" variant="ghost" iconOnly icon={Trash2} aria-label={t('Eliminar línea {n}', { n })} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid-main-side">
          <div className="stack">
            <Card title={t('Notas')}>
              <TextAreaField label={t('Notas visibles en la factura')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </Card>
            {(showErrors && errorList.length > 0) && (
              <Callout tone="danger" title={t('La factura no podrá aprobarse hasta corregir:')}>
                <ul>{errorList.map((e, i) => <li key={i}>{t(e)}</li>)}</ul>
              </Callout>
            )}
            {validation.warnings.length > 0 && (
              <Callout tone="warning" title={t('Avisos (no bloquean el guardado)')}>
                <ul>{validation.warnings.map((w, i) => <li key={i}>{t(w)}</li>)}</ul>
              </Callout>
            )}
          </div>
          <Card title={t('Totales')}>
            <div className="stack-sm">
              <div className="row between"><span>{t('Importe bruto')}</span><Money cents={totals.grossCents} /></div>
              {totals.discountCents !== 0 && <div className="row between"><span>{t('Descuentos')}</span><Money cents={-totals.discountCents} /></div>}
              <hr className="sep" />
              {totals.breakdown.map((b) => (
                <div key={b.taxCode} className="stack-sm" style={{ gap: 0 }}>
                  <div className="row between small"><span>{t('Base')} {t(b.label)}</span><Money cents={b.baseCents} /></div>
                  <div className="row between small"><span className="muted">{t('Cuota ({rate})', { rate: formatPct(b.ratePct) })}</span><Money cents={b.taxCents} /></div>
                </div>
              ))}
              <hr className="sep" />
              <div className="row between"><span>{t('Base imponible')}</span><Money cents={totals.baseCents} /></div>
              <div className="row between"><span>{t('Total IVA')}</span><Money cents={totals.taxCents} /></div>
              <div className="row between strong" style={{ fontSize: 16 }}><span>{t('Total factura')}</span><Money cents={totals.totalCents} /></div>
              {totals.withholdingCents > 0 && (
                <>
                  <div className="row between"><span>{t('Retención IRPF ({rate})', { rate: formatPct(totals.withholdingPct) })}</span><Money cents={-totals.withholdingCents} /></div>
                  <div className="row between strong"><span>{t('Líquido a cobrar')}</span><Money cents={totals.payableCents} /></div>
                </>
              )}
              <p className="tiny muted">{t('El IVA se calcula sobre la base agregada de cada tipo y se redondea al céntimo.')}</p>
            </div>
          </Card>
        </div>
      </div>
      {newCustomer && <PartyFormModal kind="customer" onClose={() => setNewCustomer(false)} onSaved={(p) => onCustomer(p.id)} />}
    </>
  );
}
