import { FilePenLine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RecordNotFound } from '../../components/guards';
import { Button, Callout, Card, Money, PageHeader, SelectField, TextAreaField, useAction } from '../../components/ui';
import { diffDays } from '../../domain/dates';
import { computeTotals, lineAmounts } from '../../domain/invoiceCalc';
import { centsToInput, formatEUR, formatNumber, parseAmountToCents, parseDecimal } from '../../domain/money';
import type { InvoiceLine, RectificationMethod, RectificationReasonCode } from '../../domain/types';
import { buildRectifyingLines, createRectification } from '../../services/invoiceService';
import { getLang, t, tKey } from '../../i18n';
import { useCtx } from '../../store/hooks';

const REASONS: Record<RectificationReasonCode, string> = {
  R1: tKey('R1 — Error fundado en derecho y causas del art. 80.Uno, Dos y Seis LIVA (p. ej. error de precio, descuento posterior, devolución)'),
  R2: tKey('R2 — Art. 80.Tres LIVA (concurso del destinatario)'),
  R3: tKey('R3 — Art. 80.Cuatro LIVA (créditos incobrables)'),
  R4: tKey('R4 — Resto de causas (p. ej. datos identificativos, menciones)'),
};

/** Quantity / percentage as typed in the interface language (decimal comma in Spanish). */
const decToInput = (n: number) => (getLang() === 'en' ? String(n) : String(n).replace('.', ','));

export function RectifyPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const original = ctx.db.invoices.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!original) return <RecordNotFound back="/facturas" label={t('facturas')} />;
  if (original.kind !== 'ordinary' || (original.documentStatus !== 'issued' && original.documentStatus !== 'rectified')) {
    return <Card><Callout tone="warning" title={t('No rectificable')}>{t('Solo se rectifican facturas ordinarias emitidas.')} <Link to={`/facturas/${original.id}`}>{t('Volver')}</Link></Callout></Card>;
  }
  return <Wizard originalId={original.id} />;
}

function Wizard({ originalId }: { originalId: string }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const { run, pending } = useAction();
  const original = ctx.db.invoices.find((i) => i.id === originalId)!;
  const [reasonCode, setReasonCode] = useState<RectificationReasonCode>('R1');
  const [method, setMethod] = useState<RectificationMethod>('differences');
  const [reasonText, setReasonText] = useState('');
  const [rows, setRows] = useState(original.lines.map((l) => ({ id: l.id, description: l.description, qty: decToInput(l.quantity), price: centsToInput(l.unitPriceCents), disc: decToInput(l.discountPct), taxCode: l.taxCode, removed: false })));
  const [touched, setTouched] = useState(false);

  const corrected: InvoiceLine[] = rows.filter((r) => !r.removed).map((r) => ({ id: r.id, description: r.description, quantity: parseDecimal(r.qty) ?? 0, unitPriceCents: parseAmountToCents(r.price) ?? 0, discountPct: parseDecimal(r.disc) ?? 0, taxCode: r.taxCode }));
  const preview = useMemo(() => buildRectifyingLines(original.lines, corrected, method), [original.lines, corrected, method]);
  const totals = computeTotals(preview, ctx.db.taxCodes, original.totals.withholdingPct);
  const correctedTotals = computeTotals(corrected, ctx.db.taxCodes, original.totals.withholdingPct);
  const age = diffDays(original.operationDate ?? original.issueDate!, ctx.today);
  const pendingRect = ctx.db.invoices.find((i) => i.rectification?.originalInvoiceId === original.id && (i.documentStatus === 'draft' || i.documentStatus === 'approved'));
  const rectSeries = ctx.db.series.find((s) => s.companyId === ctx.company.id && s.kind === 'rectifying' && s.active);
  const upd = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    setTouched(true);
    if (!reasonText.trim()) return;
    const inv = await run(() => createRectification(original.id, { reasonCode, method, reasonText, correctedLines: corrected }), t('Rectificativa creada como borrador: revísela y solicite su aprobación'));
    if (inv) navigate(`/facturas/${inv.id}`);
  };

  return (
    <>
      <PageHeader
        breadcrumbs={<><Link to="/facturas">{t('Facturas')}</Link> / <Link to={`/facturas/${original.id}`}>{original.number}</Link> / {t('Rectificar')}</>}
        title={t('Rectificar {n}', { n: original.number ?? '' })}
        subtitle={t('Se crea una factura rectificativa nueva, en serie propia y vinculada. La factura original no se modifica ni se elimina.')}
        actions={<><Button onClick={() => navigate(`/facturas/${original.id}`)}>{t('Cancelar')}</Button><Button variant="primary" icon={FilePenLine} loading={pending} onClick={submit} disabled={!!pendingRect || !rectSeries}>{t('Crear rectificativa (borrador)')}</Button></>}
      />
      <div className="stack-lg">
        {pendingRect && <Callout tone="warning" title={t('Ya existe una rectificativa en preparación')}><Link to={`/facturas/${pendingRect.id}`}>{t('Ábrala')}</Link> {t('para completarla o elimínela antes de crear otra.')}</Callout>}
        {!rectSeries && <Callout tone="danger" title={t('No hay serie de rectificativas activa')}>{t('Configúrela en Configuración → Series (RD 1619/2012, art. 6.1.a).')}</Callout>}
        {age > 4 * 365 && <Callout tone="danger" title={t('Plazo de rectificación')}>{t('Han pasado más de cuatro años desde el devengo: no puede rectificarse (art. 15.3). Consulte al asesor.')}</Callout>}
        <Callout tone="neutral" title={t('Requiere revisión profesional en casos dudosos')}>
          {t('La causa (R1–R4) y la modalidad tienen efectos fiscales. Ante dudas, consulte a {adviser}. El prototipo no decide la causa aplicable.', { adviser: ctx.finance.responsibleAdviser })}
        </Callout>
        <Card title={t('1. Causa y modalidad')}>
          <div className="form-grid">
            <SelectField label={t('Causa de rectificación')} className="span-2" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as RectificationReasonCode)}>
              {Object.entries(REASONS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </SelectField>
            <SelectField label={t('Modalidad')} value={method} onChange={(e) => setMethod(e.target.value as RectificationMethod)} hint={method === 'differences' ? t('La rectificativa recoge solo la diferencia, con su signo.') : t('La rectificativa recoge los importes correctos completos.')}>
              <option value="differences">{t('Por diferencias')}</option>
              <option value="substitution">{t('Por sustitución')}</option>
            </SelectField>
            <TextAreaField label={t('Motivo detallado')} required className="span-all" rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} error={touched && !reasonText.trim() ? t('El motivo es obligatorio y queda vinculado al original.') : undefined} />
          </div>
        </Card>
        <Card title={t('2. Contenido correcto de la factura')} flush>
          <div className="table-wrap">
            <table className="table line-editor">
              <thead><tr><th>{t('Descripción')}</th><th className="num">{t('Cant.')}</th><th className="num">{t('Precio')}</th><th className="num">{t('Dto. %')}</th><th>{t('Tratamiento')}</th><th className="num">{t('Base original → corregida')}</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const o = original.lines.find((l) => l.id === r.id);
                  const c = corrected.find((l) => l.id === r.id);
                  const n = i + 1;
                  return (
                    <tr key={r.id} style={r.removed ? { opacity: 0.5 } : undefined}>
                      <td><input className="input" aria-label={t('Descripción línea {n}', { n })} value={r.description} disabled={r.removed} onChange={(e) => upd(i, { description: e.target.value })} /></td>
                      <td><input className="input num" aria-label={t('Cantidad línea {n}', { n })} value={r.qty} disabled={r.removed} onChange={(e) => upd(i, { qty: e.target.value })} /></td>
                      <td><input className="input num" aria-label={t('Precio línea {n}', { n })} value={r.price} disabled={r.removed} onChange={(e) => upd(i, { price: e.target.value })} /></td>
                      <td><input className="input num" aria-label={t('Descuento línea {n}', { n })} value={r.disc} disabled={r.removed} onChange={(e) => upd(i, { disc: e.target.value })} /></td>
                      <td>
                        <select className="select" aria-label={t('Tratamiento fiscal línea {n}', { n })} value={r.taxCode} disabled={r.removed} onChange={(e) => upd(i, { taxCode: e.target.value })}>
                          {ctx.db.taxCodes.map((tc) => <option key={tc.code} value={tc.code} disabled={!ctx.finance.approvedTaxCodes.includes(tc.code) && tc.code !== r.taxCode}>{t(tc.label)}</option>)}
                        </select>
                      </td>
                      <td className="num">{o ? formatEUR(lineAmounts(o).baseCents) : '—'} → {c ? formatEUR(lineAmounts(c).baseCents) : formatEUR(0)}</td>
                      <td><Button size="sm" variant="ghost" onClick={() => upd(i, { removed: !r.removed })}>{r.removed ? t('Restaurar') : t('Quitar')}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 12 }}>
            <Button size="sm" onClick={() => setRows((rs) => [...rs, { id: `new_${rs.length}_${Date.now()}`, description: '', qty: '1', price: centsToInput(0), disc: '0', taxCode: ctx.finance.approvedTaxCodes[0] ?? 'IVA21', removed: false }])}>{t('Añadir línea')}</Button>
          </div>
        </Card>
        <div className="grid-2">
          <Card title={t('3. Líneas de la rectificativa (vista previa)')} flush>
            {preview.length === 0 ? <div style={{ padding: 16 }} className="muted">{t('Sin diferencias respecto a la factura original.')}</div> : (
              <table className="table">
                <thead><tr><th>{t('Descripción')}</th><th className="num">{t('Cant.')}</th><th className="num">{t('Base')}</th></tr></thead>
                <tbody>{preview.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{formatNumber(l.quantity)}</td><td className={`num ${lineAmounts(l).baseCents < 0 ? 'diff-neg' : ''}`}><Money cents={lineAmounts(l).baseCents} /></td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <Card title={t('Impacto')}>
            <div className="stack-sm">
              <div className="row between"><span>{t('Total original')}</span><Money cents={original.totals.totalCents} /></div>
              <div className="row between"><span>{t('Total correcto')}</span><Money cents={correctedTotals.totalCents} /></div>
              <div className="row between strong"><span>{t('Total de la rectificativa')}</span><Money cents={totals.totalCents} className={totals.totalCents < 0 ? 'diff-neg' : ''} /></div>
              <p className="small muted">{method === 'substitution' ? t('El cobro pendiente de la factura original se recalcula con la rectificativa (sustituye el importe) cuando esta se emita.') : t('El cobro pendiente de la factura original se recalcula con la rectificativa (suma la diferencia) cuando esta se emita.')}</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
