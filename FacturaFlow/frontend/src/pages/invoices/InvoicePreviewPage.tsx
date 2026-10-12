import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { RecordNotFound } from '../../components/guards';
import { Button, Callout } from '../../components/ui';
import { formatDate } from '../../domain/dates';
import { lineAmounts } from '../../domain/invoiceCalc';
import { t } from '../../i18n';
import { useCtx, useLang } from '../../store/hooks';

/**
 * The invoice document is issued in Spanish to a Spanish customer, so the sheet below is
 * deliberately NOT translated: its texts live here and its amounts use Spanish formatting
 * whatever the interface language. Only the page chrome around it goes through t().
 */
const DOC = {
  watermarkDraft: 'BORRADOR — SIN NÚMERO NI VALIDEZ FISCAL',
  watermarkIssued: 'DOCUMENTO DE DEMOSTRACIÓN — NO VÁLIDO COMO FACTURA · REGISTRO FISCAL SIMULADO',
  invoice: 'FACTURA',
  rectifying: 'FACTURA RECTIFICATIVA',
  number: 'Nº',
  numberPending: '(se asigna al emitir)',
  issueDate: 'Fecha de expedición:',
  issueDatePending: '(al emitir)',
  operationDate: 'Fecha de operación:',
  dueDate: 'Vencimiento:',
  qrLines: ['QR SIMULADO', 'no verificable', '(RD 1619/2012 art. 6.5)'],
  issuer: 'Emisor',
  recipient: 'Destinatario',
  nif: 'NIF',
  rectifiesPrefix: 'Rectifica la factura nº',
  rectifiesDated: 'de fecha',
  cause: 'Causa',
  bySubstitution: 'Por sustitución',
  byDifferences: 'Por diferencias',
  reason: 'Motivo:',
  colDescription: 'Descripción',
  colQty: 'Cant.',
  colUnitPrice: 'Precio unit.',
  colDiscount: 'Dto.',
  colVat: 'IVA',
  colBase: 'Base',
  baseRate: (rate: string) => `Base ${rate} · cuota`,
  taxableBase: 'Base imponible',
  vatAmount: 'Cuota IVA',
  grandTotal: 'TOTAL FACTURA',
  withholding: (rate: string) => `Retención IRPF (${rate})`,
  payable: 'LÍQUIDO A PAGAR',
  paymentMethod: 'Forma de pago:',
  verifactuNote:
    'La leyenda «VERI*FACTU» / «Factura verificable en la sede electrónica de la AEAT» se omite deliberadamente: el prototipo no es un sistema informático de facturación y no remite registros a la AEAT.',
};

const ES_EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const ES_NUM = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 });
const ES_PCT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const docEUR = (cents: number) => ES_EUR.format(cents / 100);
const docNum = (n: number) => ES_NUM.format(n);
const docPct = (n: number) => `${ES_PCT.format(n)} %`;

/** Printable rendering. Explicitly watermarked: it is not a legally valid invoice. */
export function InvoicePreviewPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const lang = useLang();
  const db = ctx.db;
  const inv = db.invoices.find((i) => i.id === id && i.companyId === ctx.company.id);
  if (!inv || (!ctx.can('invoices.view_drafts') && !inv.number)) return <RecordNotFound back="/facturas" label={t('facturas')} />;
  const customer = db.customers.find((c) => c.id === inv.customerId)!;
  const recipient = inv.customerSnapshot ?? { legalName: customer.legalName, idType: customer.idType, idNumber: customer.idNumber, address: customer.address };
  const issuer = inv.issuerSnapshot ?? { legalName: ctx.company.legalName, idNumber: ctx.company.nif, address: ctx.company.registeredAddress };
  const original = inv.rectification ? db.invoices.find((i) => i.id === inv.rectification!.originalInvoiceId) : undefined;
  const draft = !inv.number;
  return (
    <>
      <div className="row between no-print" style={{ marginBottom: 12 }}>
        <Link className="btn" to={`/facturas/${inv.id}`}><ArrowLeft size={15} /> {t('Volver al detalle')}</Link>
        <Button variant="primary" icon={Printer} onClick={() => window.print()}>{t('Imprimir / guardar como PDF')}</Button>
      </div>
      <div className="no-print stack-sm" style={{ marginBottom: 12 }}>
        <Callout tone="warning">{t('Vista generada por el prototipo con datos ficticios. Un PDF no es una factura electrónica estructurada ni prueba de aceptación fiscal, entrega o cobro.')}</Callout>
        {lang === 'en' && <Callout tone="info">{t('El documento de factura se muestra en español, el idioma en que se emite.')}</Callout>}
      </div>
      <article className="doc-sheet" lang="es" aria-label={t('Vista previa de la factura')}>
        <div className="doc-watermark">
          {draft ? DOC.watermarkDraft : DOC.watermarkIssued}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <h1>{inv.kind === 'rectifying' ? DOC.rectifying : DOC.invoice}</h1>
            <div style={{ marginTop: 6 }}>
              <strong>{DOC.number} {inv.number ?? DOC.numberPending}</strong>
              <br />{DOC.issueDate} {formatDate(inv.issueDate) === '—' ? DOC.issueDatePending : formatDate(inv.issueDate)}
              {inv.operationDate && inv.operationDate !== inv.issueDate && <><br />{DOC.operationDate} {formatDate(inv.operationDate)}</>}
              {inv.dueDate && <><br />{DOC.dueDate} {formatDate(inv.dueDate)}</>}
            </div>
          </div>
          <div className="qr-placeholder" aria-label={t('Espacio reservado para el código QR')}>{DOC.qrLines[0]}<br />{DOC.qrLines[1]}<br />{DOC.qrLines[2]}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7685', textTransform: 'uppercase' }}>{DOC.issuer}</div>
            <strong>{issuer.legalName}</strong>
            <br />{DOC.nif}: {issuer.idNumber}
            <br />{issuer.address.street}
            <br />{issuer.address.postalCode} {issuer.address.city} ({issuer.address.province})
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7685', textTransform: 'uppercase' }}>{DOC.recipient}</div>
            <strong>{recipient.legalName}</strong>
            <br />{recipient.idType === 'NIF' ? DOC.nif : recipient.idType}: {recipient.idNumber || '—'}
            <br />{recipient.address.street}
            <br />{recipient.address.postalCode} {recipient.address.city} ({recipient.address.province})
          </div>
        </div>
        {original && (
          <p style={{ marginTop: 16 }}>
            {DOC.rectifiesPrefix} <strong>{original.number}</strong> {DOC.rectifiesDated} {formatDate(original.issueDate)} · {DOC.cause} {inv.rectification?.reasonCode} · {inv.rectification?.method === 'substitution' ? DOC.bySubstitution : DOC.byDifferences}. {DOC.reason} {inv.rectification?.reasonText}
          </p>
        )}
        <table>
          <thead>
            <tr><th>{DOC.colDescription}</th><th style={{ textAlign: 'right' }}>{DOC.colQty}</th><th style={{ textAlign: 'right' }}>{DOC.colUnitPrice}</th><th style={{ textAlign: 'right' }}>{DOC.colDiscount}</th><th style={{ textAlign: 'right' }}>{DOC.colVat}</th><th style={{ textAlign: 'right' }}>{DOC.colBase}</th></tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td style={{ textAlign: 'right' }}>{docNum(l.quantity)}</td>
                <td style={{ textAlign: 'right' }}>{docEUR(l.unitPriceCents)}</td>
                <td style={{ textAlign: 'right' }}>{l.discountPct ? docPct(l.discountPct) : ''}</td>
                <td style={{ textAlign: 'right' }}>{docPct(db.taxCodes.find((tc) => tc.code === l.taxCode)?.ratePct ?? 0)}</td>
                <td style={{ textAlign: 'right' }}>{docEUR(lineAmounts(l).baseCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          {inv.totals.breakdown.map((b) => (
            <div key={b.taxCode}><span>{DOC.baseRate(docPct(b.ratePct))}</span><span>{docEUR(b.baseCents)} · {docEUR(b.taxCents)}</span></div>
          ))}
          <div><span>{DOC.taxableBase}</span><span>{docEUR(inv.totals.baseCents)}</span></div>
          <div><span>{DOC.vatAmount}</span><span>{docEUR(inv.totals.taxCents)}</span></div>
          <div className="grand"><span>{DOC.grandTotal}</span><span>{docEUR(inv.totals.totalCents)}</span></div>
          {inv.totals.withholdingCents > 0 && (
            <>
              <div><span>{DOC.withholding(docPct(inv.totals.withholdingPct))}</span><span>−{docEUR(inv.totals.withholdingCents)}</span></div>
              <div className="grand"><span>{DOC.payable}</span><span>{docEUR(inv.totals.payableCents)}</span></div>
            </>
          )}
        </div>
        {inv.totals.breakdown.filter((b) => b.mention).map((b) => <p key={b.taxCode} style={{ marginTop: 10, fontStyle: 'italic' }}>{b.mention}</p>)}
        <p style={{ marginTop: 20 }}><strong>{DOC.paymentMethod}</strong> {inv.paymentTerms}</p>
        {inv.notes && <p style={{ marginTop: 6 }}>{inv.notes}</p>}
        <p style={{ marginTop: 24, fontSize: 11, color: '#6b7685' }}>
          {DOC.verifactuNote}
        </p>
      </article>
    </>
  );
}
