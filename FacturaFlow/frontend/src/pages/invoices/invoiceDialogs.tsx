import { Ban, FilePenLine, FileX2, Send, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IssueGatePanel } from '../../components/invoiceBits';
import { Button, Callout, Checkbox, Modal, Money, SelectField, SimulatedTag, TextAreaField, TextField, useAction } from '../../components/ui';
import { financeIssueGate, isIssueBlocked } from '../../domain/applicability';
import { centsToInput, formatEUR, parseAmountToCents } from '../../domain/money';
import type { Invoice, PaymentEvent, ProviderScenario } from '../../domain/types';
import { t, tKey } from '../../i18n';
import { SCENARIO_LABEL, setNextScenario } from '../../services/adminService';
import { checkPayment, CASH_LIMIT_CENTS, openDisputeOn, PAYMENT_METHOD_LABEL, recordPayment } from '../../services/collectionService';
import { issueInvoice, requestFiscalAnnulment, sendInvoice, type IssueOutcome } from '../../services/invoiceService';
import { useCtx, useLang } from '../../store/hooks';
import { cashCollectedCents, outstandingCents } from '../../store/selectors';

const ISSUE_RESULT_TITLE: Record<IssueOutcome['kind'], string> = {
  issued: tKey('Factura emitida y registro aceptado (simulado)'),
  needs_review: tKey('Emitida: registro aceptado con errores'),
  rejected: tKey('Emitida, pero el registro fiscal fue rechazado'),
  uncertain: tKey('Resultado incierto: no reintente, concilie'),
  not_processed: tKey('No procesada'),
  failed: tKey('Proveedor no disponible: no se emitió'),
};

export function IssueDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const [result, setResult] = useState<IssueOutcome | null>(null);
  const [scenario, setScenario] = useState<ProviderScenario>(ctx.provider?.nextScenario ?? 'accept');
  const series = ctx.db.series.find((s) => s.id === inv.seriesId);
  const prevOp = ctx.db.fiscalOperations.filter((o) => o.invoiceId === inv.id && o.reservedNumber).sort((a, b) => b.attempt - a.attempt)[0];
  const number = prevOp?.reservedNumber ?? (series ? `${series.prefix}${String(series.nextNumber).padStart(series.padding, '0')}` : '—');
  const blocked = isIssueBlocked(financeIssueGate(ctx.company, ctx.finance, ctx.provider, ctx.today));
  const customer = ctx.db.customers.find((c) => c.id === inv.customerId);

  const go = async () => {
    if (scenario !== ctx.provider?.nextScenario) await setNextScenario(scenario);
    const r = await run(() => issueInvoice(inv.id));
    if (r) setResult(r);
  };
  const tone = result?.kind === 'issued' ? 'success' : result?.kind === 'rejected' || result?.kind === 'failed' ? 'danger' : 'warning';
  return (
    <Modal
      title={t('Emitir factura')}
      description={t('La emisión se realiza a través del proveedor fiscal SIMULADO. No hay conexión con la AEAT.')}
      onClose={onClose}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>{t('Cerrar')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button variant="primary" icon={ShieldCheck} onClick={go} loading={pending} disabled={blocked || !!inv.pendingOperationId}>
              {t('Emitir {number}', { number })}
            </Button>
          </>
        )
      }
    >
      {!result && (
        <>
          <IssueGatePanel ctx={ctx} />
          <div className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
            <dt>{t('Cliente')}</dt><dd>{customer?.legalName} · {customer?.idNumber}</dd>
            <dt>{t('Número a asignar')}</dt><dd className="mono">{number} {prevOp && <span className="muted small">{t('(reservado en el intento anterior; se reutiliza)')}</span>}</dd>
            <dt>{t('Total')}</dt><dd><Money cents={inv.totals.totalCents} /></dd>
            <dt>{t('Clave de idempotencia')}</dt><dd className="mono small">inv:{inv.id}:issue</dd>
          </div>
          {(ctx.can('fiscal.simulate') || ctx.can('fiscal.reconcile') || ctx.can('invoices.issue')) && (
            <SelectField label={<>{t('Respuesta del proveedor simulado')} <SimulatedTag /></>} value={scenario} onChange={(e) => setScenario(e.target.value as ProviderScenario)} hint={t('Control de demostración para probar éxito, rechazo, tiempo de espera y caída del proveedor. Se aplica solo a este envío.')}>
              {Object.entries(SCENARIO_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </SelectField>
          )}
          <Callout tone="neutral">
            {t('Tras emitir, la factura no podrá modificarse ni eliminarse: cualquier corrección se hará con una factura rectificativa. Un PDF o una respuesta correcta del proveedor no implican entrega ni cobro.')}
          </Callout>
        </>
      )}
      {result && (
        <Callout tone={tone} title={t(ISSUE_RESULT_TITLE[result.kind])}>
          {'number' in result && <div>{t('Número:')} <strong className="mono">{result.number}</strong></div>}
          <div>{t(result.message)}</div>
          {result.kind === 'uncertain' && <div style={{ marginTop: 6 }}>{t('El botón «Emitir» queda bloqueado hasta conciliar la operación en la pestaña Fiscal o en Integración fiscal. Así se evita emitir dos veces la misma factura.')}</div>}
          {result.kind === 'rejected' && <div style={{ marginTop: 6 }}>{t('Se ha creado una excepción asignada al emisor (copia a la propiedad). Corrija y reenvíe desde la pestaña Fiscal.')}</div>}
        </Callout>
      )}
    </Modal>
  );
}

export function PaymentDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const ctx = useCtx();
  const { runOk, pending } = useAction();
  const outstanding = outstandingCents(ctx.db, inv);
  const [date, setDate] = useState(ctx.today);
  const [amount, setAmount] = useState(centsToInput(outstanding));
  const [method, setMethod] = useState<PaymentEvent['method']>('transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const cents = parseAmountToCents(amount);
  const errors = cents === null ? [tKey('Importe no válido (p. ej. 1.234,56).')] : checkPayment(inv.id, { date, amountCents: cents, method, reference, note });
  const cashSoFar = cashCollectedCents(ctx.db, inv.id);
  const submit = async () => {
    setTouched(true);
    if (errors.length || cents === null) return;
    if (await runOk(() => recordPayment(inv.id, { date, amountCents: cents, method, reference, note }), cents === outstanding ? t('Cobro registrado: factura cobrada') : t('Cobro parcial registrado'))) onClose();
  };
  return (
    <Modal
      title={t('Registrar cobro · {number}', { number: inv.number ?? '—' })}
      description={t('Pendiente de cobro: {amount}. Un cobro nunca se deduce del envío ni de la emisión: se registra con su justificante.', { amount: formatEUR(outstanding) })}
      onClose={onClose}
      footer={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" onClick={submit} loading={pending}>{t('Registrar cobro')}</Button></>}
    >
      <div className="form-grid">
        <TextField label={t('Fecha de cobro')} type="date" required value={date} onChange={(e) => setDate(e.target.value)} max={ctx.today} />
        <TextField label={t('Importe (€)')} required inputMode="decimal" placeholder={t('0,00')} value={amount} onChange={(e) => setAmount(e.target.value)} hint={<button className="btn ghost sm" type="button" onClick={() => setAmount(centsToInput(outstanding))}>{t('Usar pendiente total')}</button>} />
        <SelectField label={t('Método')} value={method} onChange={(e) => setMethod(e.target.value as PaymentEvent['method'])}>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </SelectField>
        <TextField label={t('Referencia del movimiento')} required={method !== 'cash'} value={reference} onChange={(e) => setReference(e.target.value)} hint={t('Nº de transferencia, recibo o ticket.')} />
        <TextAreaField label={t('Nota')} className="span-all" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {method === 'cash' && (
        <Callout tone="warning" title={t('Pagos en efectivo')}>
          {t('Límite de 1.000 € por operación cuando alguna parte actúa como empresario o profesional, sumando pagos fraccionados (Ley 7/2012, art. 7). Efectivo ya cobrado en esta factura: {cash}; máximo adicional: {max}.', { cash: formatEUR(cashSoFar), max: formatEUR(Math.max(0, CASH_LIMIT_CENTS - 1 - cashSoFar)) })}
        </Callout>
      )}
      {touched && errors.length > 0 && <Callout tone="danger" title={t('No se puede registrar')}><ul>{errors.map((e, i) => <li key={i}>{t(e)}</li>)}</ul></Callout>}
    </Modal>
  );
}

export function DisputeDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  useLang();
  const { runOk, pending } = useAction();
  const [reason, setReason] = useState('');
  const [hold, setHold] = useState(true);
  return (
    <Modal title={t('Abrir disputa · {number}', { number: inv.number ?? '—' })} onClose={onClose} footer={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" loading={pending} onClick={async () => (await runOk(() => openDisputeOn(inv.id, reason, hold), t('Disputa abierta'))) && onClose()}>{t('Abrir disputa')}</Button></>}>
      <TextAreaField label={t('Motivo de la disputa')} required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      <Checkbox label={t('Retener los recordatorios de cobro mientras la disputa esté abierta')} checked={hold} onChange={setHold} hint={t('Los recordatorios programados quedarán registrados como suprimidos.')} />
      <p className="small muted">{t('La disputa no modifica la factura. Si procede corregir importes, emita una rectificativa.')}</p>
    </Modal>
  );
}

export function SendDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const customer = ctx.db.customers.find((c) => c.id === inv.customerId);
  const [channel, setChannel] = useState<'email' | 'manual'>(customer?.deliveryChannel ?? 'email');
  const [to, setTo] = useState(customer?.email ?? '');
  // The service detail stays Spanish; it is translated when rendered.
  const [done, setDone] = useState<{ ok: boolean; detail: string } | null>(null);
  return (
    <Modal
      title={t('Enviar factura · {number}', { number: inv.number ?? '—' })}
      onClose={onClose}
      footer={done ? <Button variant="primary" onClick={onClose}>{t('Cerrar')}</Button> : <><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" icon={Send} loading={pending} onClick={async () => { const r = await run(() => sendInvoice(inv.id, channel, channel === 'manual' ? customer?.legalName ?? 'Entrega en mano' : to)); if (r) setDone({ ok: r.status === 'delivered', detail: r.detail }); }}>{t('Enviar')}</Button></>}
    >
      {!done ? (
        <>
          <SelectField label={t('Canal')} value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'manual')}>
            <option value="email">{t('Correo electrónico con PDF (simulado)')}</option>
            <option value="manual">{t('Entrega manual registrada')}</option>
            <option value="b2b" disabled>{t('Factura electrónica B2B — no disponible (FIN-09, condicional)')}</option>
          </SelectField>
          {channel === 'email' && <TextField label={t('Destinatario')} type="email" value={to} onChange={(e) => setTo(e.target.value)} hint={t('Para simular un rebote, use una dirección que contenga «rebote».')} />}
          <Callout tone="info">{t('El envío por correo no es una factura electrónica estructurada B2B. Un flujo solo PDF no se considera preparado para la obligación B2B.')}</Callout>
        </>
      ) : (
        <Callout tone={done.ok ? 'success' : 'danger'}>{done.ok ? t('Entregada. {detail}', { detail: t(done.detail) }) : t('Error: {detail}', { detail: t(done.detail) })}</Callout>
      )}
    </Modal>
  );
}

/** FIN-05 / C6: rectification, fiscal-record annulment and cancellation are not interchangeable. */
export function CorrectionDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const { runOk, pending } = useAction();
  const [annul, setAnnul] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Modal wide title={t('Corregir la factura {number}', { number: inv.number ?? '—' })} description={t('Elija la operación adecuada. No son intercambiables.')} onClose={onClose} footer={<Button onClick={onClose}>{t('Cerrar')}</Button>}>
      <div className="stack">
        <div className="card card-body stack-sm">
          <div className="row"><FilePenLine size={18} aria-hidden /><h3>{t('Factura rectificativa')}</h3></div>
          <p className="small">{t('Para errores en el contenido, importes o tipo impositivo, o cambios en la base (RD 1619/2012, art. 15; LIVA art. 80). Se emite un documento nuevo en la serie de rectificativas, vinculado al original. El original no se modifica.')}</p>
          <div><Button variant="primary" disabled={!ctx.can('invoices.rectify_request')} onClick={() => navigate(`/facturas/${inv.id}/rectificar`)}>{t('Crear rectificativa')}</Button></div>
        </div>
        <div className="card card-body stack-sm">
          <div className="row"><FileX2 size={18} aria-hidden /><h3>{t('Anulación del registro de facturación')}</h3> <SimulatedTag label={tKey('Requiere revisión profesional')} /></div>
          <p className="small">{t('Operación del sistema de facturación (registro de anulación, Orden HAC/1177/2024 art. 11) para registros generados por error. No anula la obligación de facturar ni sustituye a una rectificativa. Cuándo procede debe decidirlo el asesor fiscal.')}</p>
          {!annul ? (
            <div><Button disabled={!ctx.can('invoices.issue')} onClick={() => setAnnul(true)}>{t('Solicitar revisión de anulación')}</Button></div>
          ) : (
            <>
              <TextAreaField label={t('Motivo y contexto para el asesor')} required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              <div className="row">
                <Button variant="primary" loading={pending} onClick={async () => (await runOk(() => requestFiscalAnnulment(inv.id, reason), t('Solicitud enviada a revisión profesional (no se ha anulado nada)'))) && onClose()}>{t('Enviar a revisión')}</Button>
                <Button onClick={() => setAnnul(false)}>{t('Cancelar')}</Button>
              </div>
            </>
          )}
        </div>
        <div className="card card-body stack-sm" style={{ opacity: 0.85 }}>
          <div className="row"><Ban size={18} aria-hidden /><h3>{t('Cancelar o eliminar la factura')}</h3></div>
          <p className="small">{t('No disponible. Una factura expedida no se elimina ni se modifica: se conserva durante el plazo legal y se corrige mediante rectificativa.')}</p>
        </div>
      </div>
    </Modal>
  );
}
