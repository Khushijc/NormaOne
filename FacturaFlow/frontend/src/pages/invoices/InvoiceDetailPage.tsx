import { CheckCircle2, CircleSlash, Coins, Eye, FilePenLine, Pencil, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2, Undo2, Wrench, MessageSquareWarning, BellRing } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { RecordNotFound } from '../../components/guards';
import { InvoiceTracks, IssueGatePanel } from '../../components/invoiceBits';
import { Badge, Button, Callout, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, Money, PageHeader, SimulatedTag, StatusBadge, Tabs, useAction } from '../../components/ui';
import { diffDays } from '../../domain/dates';
import { buildFiscalPayload } from '../../domain/fiscalPayload';
import { lineAmounts } from '../../domain/invoiceCalc';
import { formatEUR, formatNumber, formatPct, roundCents } from '../../domain/money';
import { FISCAL_OPERATION_STATE } from '../../domain/status';
import type { Invoice } from '../../domain/types';
import { currentRule } from '../../domain/applicability';
import { t, tKey } from '../../i18n';
import { resolveDispute, reversePayment, sendManualReminder, PAYMENT_METHOD_LABEL } from '../../services/collectionService';
import { approveInvoice, deleteDraft, reconcileOperation, requestApproval, resubmitFiscal, returnToAuthor, revokeApproval, validateForApproval } from '../../services/invoiceService';
import { useCtx } from '../../store/hooks';
import { collectibleCents, collectionStatus, isCollectible, isOverdue, daysOverdue, openDispute, outstandingCents, paidCents, reversedPaymentIds, userName } from '../../store/selectors';
import { CorrectionDialog, DisputeDialog, IssueDialog, PaymentDialog, SendDialog } from './invoiceDialogs';

type TabId = 'resumen' | 'fiscal' | 'envios' | 'cobros' | 'historial';
type DialogId = null | 'issue' | 'payment' | 'dispute' | 'send' | 'correct' | 'approve' | 'return' | 'revoke' | 'delete' | 'request' | 'resubmit';

const DELIVERY_STATUS_LABEL = {
  sent: tKey('Enviada'),
  delivered: tKey('Entregada'),
  failed: tKey('Fallida'),
  accepted: tKey('Aceptada'),
  rejected: tKey('Rechazada'),
} as const;

const REMINDER_STATUS_LABEL = {
  sent: tKey('Enviado'),
  delivered: tKey('Entregado'),
  failed: tKey('Fallido'),
  suppressed: tKey('Suprimido'),
} as const;

export function InvoiceDetailPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const inv = ctx.db.invoices.find((i) => i.id === id && i.companyId === ctx.company.id);
  const hiddenDraft = inv && !ctx.can('invoices.view_drafts') && (inv.documentStatus === 'draft' || inv.documentStatus === 'approved');
  if (!inv || hiddenDraft) return <RecordNotFound back="/facturas" label={t('facturas')} />;
  return <Detail inv={inv} />;
}

function draftTitle(inv: Invoice, customer: string): string {
  const approved = inv.documentStatus === 'approved';
  if (inv.kind === 'rectifying') return approved ? t('Rectificativa aprobada (sin número) · {customer}', { customer }) : t('Rectificativa en borrador · {customer}', { customer });
  return approved ? t('Factura aprobada (sin número) · {customer}', { customer }) : t('Factura en borrador · {customer}', { customer });
}

function Detail({ inv }: { inv: Invoice }) {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId) || 'resumen';
  const setTab = (next: TabId) => setParams(next === 'resumen' ? {} : { tab: next }, { replace: true });
  const [dialog, setDialog] = useState<DialogId>(null);
  const { run, runOk, pending } = useAction();

  const customer = db.customers.find((c) => c.id === inv.customerId)!;
  const original = inv.rectification ? db.invoices.find((i) => i.id === inv.rectification!.originalInvoiceId) : undefined;
  const rectifications = db.invoices.filter((i) => i.rectification?.originalInvoiceId === inv.id);
  const ops = db.fiscalOperations.filter((o) => o.invoiceId === inv.id).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  const deliveries = db.deliveries.filter((d) => d.invoiceId === inv.id).sort((a, b) => (a.at < b.at ? 1 : -1));
  const payments = db.payments.filter((p) => p.invoiceId === inv.id).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  const reminders = db.reminders.filter((r) => r.invoiceId === inv.id).sort((a, b) => (a.at < b.at ? 1 : -1));
  const disputes = db.disputes.filter((d) => d.invoiceId === inv.id);
  const dispute = openDispute(db, inv.id);
  const pendingOp = inv.pendingOperationId ? db.fiscalOperations.find((o) => o.id === inv.pendingOperationId) : undefined;
  const validation = inv.documentStatus === 'draft' || inv.documentStatus === 'approved' ? validateForApproval(ctx, inv) : null;
  const reversed = reversedPaymentIds(db, inv.id);
  const issued = inv.documentStatus === 'issued' || inv.documentStatus === 'rectified';
  const col = collectionStatus(db, inv);
  const interestRule = currentRule(db.rules, 'late_payment.interest', ctx.today);

  const title = inv.number ?? draftTitle(inv, customer.legalName);
  const isAuthor = inv.createdBy === ctx.user.id;
  const sameAuthorBlock = ctx.finance.requireDifferentApprover && isAuthor;

  const actions = (
    <>
      <Button icon={Eye} onClick={() => navigate(`/facturas/${inv.id}/vista`)}>{t('Vista previa')}</Button>
      {inv.documentStatus === 'draft' && ctx.can('invoices.edit_draft') && <Button icon={Pencil} onClick={() => navigate(`/facturas/${inv.id}/editar`)}>{t('Editar')}</Button>}
      {inv.documentStatus === 'draft' && ctx.can('invoices.edit_draft') && inv.review.state !== 'requested' && <Button icon={Send} onClick={() => setDialog('request')}>{t('Solicitar aprobación')}</Button>}
      {inv.documentStatus === 'draft' && ctx.can('invoices.approve') && (
        <>
          <Button icon={Undo2} onClick={() => setDialog('return')}>{t('Devolver')}</Button>
          <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog('approve')} disabled={sameAuthorBlock} title={sameAuthorBlock ? t('Control interno: debe aprobar otra persona') : undefined}>{t('Aprobar')}</Button>
        </>
      )}
      {inv.documentStatus === 'approved' && ctx.can('invoices.approve') && !inv.pendingOperationId && <Button icon={RotateCcw} onClick={() => setDialog('revoke')}>{t('Revocar aprobación')}</Button>}
      {inv.documentStatus === 'approved' && ctx.can('invoices.issue') && !inv.pendingOperationId && <Button variant="primary" icon={ShieldCheck} onClick={() => setDialog('issue')}>{t('Emitir')}</Button>}
      {pendingOp && ctx.can('fiscal.reconcile') && <Button variant="primary" icon={RefreshCw} loading={pending} onClick={() => run(() => reconcileOperation(pendingOp.id), (r) => t(r.message))}>{t('Conciliar operación')}</Button>}
      {issued && ctx.can('invoices.deliver') && inv.kind === 'ordinary' && <Button icon={Send} onClick={() => setDialog('send')}>{t('Enviar')}</Button>}
      {issued && inv.kind === 'rectifying' && ctx.can('invoices.deliver') && <Button icon={Send} onClick={() => setDialog('send')}>{t('Enviar')}</Button>}
      {issued && isCollectible(inv) && ctx.can('payments.record') && col !== 'paid' && <Button icon={Coins} onClick={() => setDialog('payment')}>{t('Registrar cobro')}</Button>}
      {issued && inv.kind === 'ordinary' && (ctx.can('invoices.rectify_request') || ctx.can('invoices.issue')) && <Button icon={Wrench} onClick={() => setDialog('correct')}>{t('Corregir…')}</Button>}
      {inv.documentStatus === 'draft' && ctx.can('invoices.edit_draft') && <Button variant="danger-outline" icon={Trash2} onClick={() => setDialog('delete')}>{t('Eliminar borrador')}</Button>}
    </>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={<><Link to="/facturas">{t('Facturas')}</Link> / {title}</>}
        title={title}
        subtitle={
          <>
            {inv.kind === 'rectifying' ? t('Factura rectificativa') : t('Factura ordinaria')} · <Link to={`/clientes/${customer.id}`}>{customer.legalName}</Link> · {t('Total')} {formatEUR(inv.totals.totalCents)}
            {inv.totals.withholdingCents > 0 && <> · {t('Líquido')} {formatEUR(inv.totals.payableCents)}</>}
          </>
        }
        actions={actions}
      />
      <div className="stack-lg">
        <InvoiceTracks db={db} inv={inv} today={ctx.today} />

        {inv.review.state === 'requested' && inv.documentStatus === 'draft' && (
          <Callout tone="info" title={t('Pendiente de aprobación')}>
            {t('Solicitada por {name} el', { name: userName(db, inv.review.by) })} <DateTimeText at={inv.review.at} />.{inv.review.comment && <> {t('Comentario:')} «{inv.review.comment}»</>}
            {sameAuthorBlock && ctx.can('invoices.approve') && <> {t('Usted es el autor: la aprobación debe hacerla otra persona autorizada (control interno configurable).')}</>}
          </Callout>
        )}
        {inv.review.state === 'returned' && inv.documentStatus === 'draft' && (
          <Callout tone="warning" title={t('Devuelta para corrección')}>«{inv.review.comment}» — {userName(db, inv.review.by)}, <DateTimeText at={inv.review.at} /></Callout>
        )}
        {pendingOp && (
          <Callout tone="warning" title={t('Emisión con resultado incierto — pendiente de conciliación')}>
            {t('El intento {n} (clave', { n: pendingOp.attempt })} <span className="mono">{pendingOp.operationKey}</span>, {t('número reservado')} <strong className="mono">{pendingOp.reservedNumber}</strong>) {t('no obtuvo respuesta. Para no duplicar la factura, la emisión está bloqueada hasta consultar al proveedor por la clave de operación.')}
          </Callout>
        )}
        {inv.documentStatus === 'approved' && !pendingOp && <IssueGatePanel ctx={ctx} />}
        {validation && Object.keys(validation.errors).length > 0 && (
          <Callout tone="danger" title={t('La factura no supera la validación')}>
            <ul>{Object.values(validation.errors).map((e, i) => <li key={i}>{t(e)}</li>)}</ul>
          </Callout>
        )}
        {validation && validation.warnings.length > 0 && (
          <Callout tone="warning" title={t('Avisos')}><ul>{validation.warnings.map((w, i) => <li key={i}>{t(w)}</li>)}</ul></Callout>
        )}
        {original && (
          <Callout tone="info" title={t('Rectifica la factura {number}', { number: original.number ?? '—' })}>
            {inv.rectification?.reasonCode} · {inv.rectification?.method === 'substitution' ? t('por sustitución') : t('por diferencias')} · {t('Motivo:')} {inv.rectification?.reasonText}. <Link to={`/facturas/${original.id}`}>{t('Ver factura original')}</Link>
          </Callout>
        )}
        {rectifications.length > 0 && (
          <Callout tone="warning" title={t('Esta factura tiene rectificativas vinculadas')}>
            <ul>
              {rectifications.map((r) => (
                <li key={r.id}>
                  <Link to={`/facturas/${r.id}`}>{r.number ?? t('Rectificativa en borrador')}</Link> · {r.rectification?.reasonCode} · {formatEUR(r.totals.totalCents)} · {r.documentStatus === 'issued' ? t('emitida') : t('en preparación')}
                </li>
              ))}
            </ul>
            {t('El contenido de esta factura se conserva sin cambios.')}
          </Callout>
        )}

        <Tabs
          label={t('Detalle de la factura')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'resumen', label: t('Resumen') },
            { id: 'fiscal', label: t('Fiscal'), count: ops.length },
            { id: 'envios', label: t('Envíos'), count: deliveries.length },
            { id: 'cobros', label: t('Cobros'), count: payments.length },
            { id: 'historial', label: t('Historial') },
          ]}
        />

        {tab === 'resumen' && (
          <div className="grid-main-side">
            <Card title={t('Líneas')} flush>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('Descripción')}</th><th className="num">{t('Cant.')}</th><th className="num">{t('Precio')}</th><th className="num">{t('Dto.')}</th><th>{t('Tratamiento')}</th><th className="num">{t('Base')}</th></tr></thead>
                  <tbody>
                    {inv.lines.map((l) => {
                      const taxLabel = db.taxCodes.find((tc) => tc.code === l.taxCode)?.label;
                      return (
                        <tr key={l.id}>
                          <td>{l.description}</td>
                          <td className="num">{formatNumber(l.quantity)}</td>
                          <td className="num"><Money cents={l.unitPriceCents} /></td>
                          <td className="num">{l.discountPct ? formatPct(l.discountPct) : '—'}</td>
                          <td>{taxLabel ? t(taxLabel) : l.taxCode}</td>
                          <td className="num"><Money cents={lineAmounts(l).baseCents} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {inv.totals.breakdown.map((b) => (
                      <tr key={b.taxCode}><td colSpan={4}>{t('Base')} {t(b.label)}</td><td className="num"><Money cents={b.baseCents} /></td><td className="num">{t('Cuota')} <Money cents={b.taxCents} /></td></tr>
                    ))}
                    <tr><td colSpan={5}>{t('Total factura')}</td><td className="num"><Money cents={inv.totals.totalCents} /></td></tr>
                    {inv.totals.withholdingCents > 0 && <tr><td colSpan={5}>{t('Retención IRPF {pct} · líquido a cobrar', { pct: formatPct(inv.totals.withholdingPct) })}</td><td className="num"><Money cents={inv.totals.payableCents} /></td></tr>}
                  </tfoot>
                </table>
              </div>
              {inv.totals.breakdown.some((b) => b.mention) && (
                <div style={{ padding: 12 }}>
                  <Callout tone="neutral" title={t('Menciones obligatorias que figurarán en la factura')}>
                    <ul>{inv.totals.breakdown.filter((b) => b.mention).map((b) => <li key={b.taxCode}>{t(b.mention!)}</li>)}</ul>
                  </Callout>
                </div>
              )}
            </Card>
            <div className="stack">
              <Card title={t('Datos')}>
                <KV
                  items={[
                    [t('Serie'), db.series.find((s) => s.id === inv.seriesId)?.code],
                    [t('Número'), inv.number ?? <span className="muted">{t('Se asigna al emitir')}</span>],
                    [t('Expedición'), <DateText date={inv.issueDate} />],
                    [t('Operación'), inv.operationDate ? <DateText date={inv.operationDate} /> : t('Igual a expedición')],
                    [t('Vencimiento'), <DateText date={inv.dueDate} />],
                    [t('Condiciones'), inv.paymentTerms || '—'],
                    [t('Notas'), inv.notes || '—'],
                    [t('Preparada por'), `${userName(db, inv.createdBy)}`],
                    [t('Aprobada por'), inv.approvedBy ? <>{userName(db, inv.approvedBy)} · <DateTimeText at={inv.approvedAt} /></> : '—'],
                    [t('Emitida por'), inv.issuedBy ? <>{userName(db, inv.issuedBy)} · <DateTimeText at={inv.issuedAt} /></> : '—'],
                  ]}
                />
              </Card>
              <Card title={t('Destinatario')}>
                {inv.customerSnapshot ? (
                  <>
                    <KV items={[[t('Nombre'), inv.customerSnapshot.legalName], [t('Identificación'), <span className="mono">{inv.customerSnapshot.idNumber}</span>], [t('Domicilio'), `${inv.customerSnapshot.address.street}, ${inv.customerSnapshot.address.postalCode} ${inv.customerSnapshot.address.city}`]]} />
                    <p className="tiny muted" style={{ marginTop: 8 }}>{t('Copia congelada en el momento de la emisión: los cambios posteriores en la ficha del cliente no alteran la factura.')}</p>
                  </>
                ) : (
                  <KV items={[[t('Nombre'), customer.legalName], [t('Identificación'), <span className="mono">{customer.idNumber}</span>], [t('Domicilio'), `${customer.address.street}, ${customer.address.postalCode} ${customer.address.city}`]]} />
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === 'fiscal' && (
          <div className="stack">
            <Card title={<div className="row"><h2>{t('Registro fiscal')}</h2><SimulatedTag /></div>} actions={(inv.fiscalStatus === 'rejected' || inv.fiscalStatus === 'needs_review') && !pendingOp && ctx.can('invoices.issue') ? <Button variant="primary" icon={RefreshCw} onClick={() => setDialog('resubmit')}>{t('Subsanar y reenviar')}</Button> : undefined}>
              <KV
                items={[
                  [t('ID en el proveedor'), <span className="mono">{inv.providerInvoiceId ?? '—'}</span>],
                  [t('ID de registro'), <span className="mono">{inv.fiscalRecordId ?? '—'}</span>],
                  [t('Huella'), <span className="mono">{inv.fiscalHash ?? '—'} <span className="muted">{t('(demostración; la huella real SHA-256 la calcula el SIF del proveedor)')}</span></span>],
                  [t('Modalidad'), ctx.finance.sifMode === 'verifactu' ? t('VERI*FACTU (vía proveedor)') : ctx.finance.sifMode === 'no_verifactu' ? t('No VERI*FACTU') : t('Sin decidir')],
                  [t('Componente'), `${ctx.provider?.componentVersion ?? '—'} · ${ctx.provider?.producerDeclaration ? t('declaración responsable disponible (demo)') : t('sin declaración')}`],
                ]}
              />
            </Card>
            <Card title={t('Operaciones con el proveedor')} flush>
              {ops.length === 0 ? <EmptyState title={t('Sin operaciones')}>{t('La factura todavía no se ha enviado al proveedor.')}</EmptyState> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{t('Solicitada')}</th><th>{t('Intento')}</th><th>{t('Clave de operación')}</th><th>{t('Número')}</th><th>{t('Resultado')}</th><th>{t('Respuesta')}</th><th /></tr></thead>
                    <tbody>
                      {ops.map((o) => (
                        <tr key={o.id}>
                          <td><DateTimeText at={o.requestedAt} /><div className="sub">{userName(db, o.requestedBy)}</div></td>
                          <td className="num">{o.attempt}</td>
                          <td className="mono small">{o.operationKey}</td>
                          <td className="mono">{o.reservedNumber ?? '—'}</td>
                          <td><StatusBadge meta={FISCAL_OPERATION_STATE[o.state]} />{o.reconciledAt && <div className="sub">{t('Conciliada')} <DateTimeText at={o.reconciledAt} /></div>}</td>
                          <td className="small">
                            {o.responseCode && <strong>{t(o.responseCode)}. </strong>}
                            {o.responseMessage && t(o.responseMessage)}
                            {o.errors.map((e) => <div key={e.code} style={{ color: 'var(--danger)' }}>{e.code}: {t(e.message)}</div>)}
                          </td>
                          <td>{(o.state === 'uncertain' || o.state === 'in_flight') && ctx.can('fiscal.reconcile') && <Button size="sm" icon={RefreshCw} loading={pending} onClick={() => run(() => reconcileOperation(o.id), (r) => t(r.message))}>{t('Conciliar')}</Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title={t('Vista del registro (ilustrativa)')}>
              <p className="small muted" style={{ marginBottom: 8 }}>{t('Estructura inspirada en el registro de alta de la Orden HAC/1177/2024 para identificar los datos que necesitará la integración real. No es un envío válido.')}</p>
              <pre className="json">{JSON.stringify(buildFiscalPayload({ ...inv, customerSnapshot: inv.customerSnapshot ?? { legalName: customer.legalName, idType: customer.idType, idNumber: customer.idNumber, address: customer.address } }, ctx.company, db.taxCodes, inv.number ?? t('(se asigna al emitir)'), inv.issueDate ?? ctx.today, original), null, 2)}</pre>
            </Card>
          </div>
        )}

        {tab === 'envios' && (
          <Card title={t('Envíos e intercambio')} actions={issued && ctx.can('invoices.deliver') ? <Button icon={Send} onClick={() => setDialog('send')}>{inv.exchangeStatus === 'delivery_failed' ? t('Reintentar envío') : t('Enviar')}</Button> : undefined} flush>
            {inv.exchangeStatus === 'delivery_failed' && <div style={{ padding: 12 }}><Callout tone="danger" title={t('El último envío falló')}>{t('Revise el correo del cliente o use otro canal. El fallo permanece visible hasta que se resuelva.')}</Callout></div>}
            {deliveries.length === 0 ? <EmptyState title={t('Sin envíos')}>{issued ? t('La factura emitida todavía no se ha enviado al cliente.') : t('Solo se envían facturas emitidas.')}</EmptyState> : (
              <table className="table">
                <thead><tr><th>{t('Fecha')}</th><th>{t('Canal')}</th><th>{t('Destinatario')}</th><th>{t('Estado')}</th><th>{t('Detalle')}</th></tr></thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td><DateTimeText at={d.at} /></td>
                      <td>{d.channel === 'email' ? t('Correo') : d.channel === 'manual' ? t('Manual') : 'B2B'} {d.simulated && <SimulatedTag />}</td>
                      <td>{d.recipient}</td>
                      <td><Badge tone={d.status === 'delivered' || d.status === 'accepted' ? 'success' : d.status === 'failed' || d.status === 'rejected' ? 'danger' : 'info'}>{t(DELIVERY_STATUS_LABEL[d.status])}</Badge></td>
                      <td className="small">{t(d.detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ padding: 12 }}>
              <Callout tone="neutral">{t('La aceptación o rechazo comercial y la comunicación del pago forman parte de la factura electrónica B2B (RD 238/2026, arts. 10 y 12). Requiere un conector validado (FIN-09, condicional) y no está disponible en este prototipo.')}</Callout>
            </div>
          </Card>
        )}

        {tab === 'cobros' && (
          <div className="stack">
            {!isCollectible(inv) ? (
              <Card><EmptyState icon={CircleSlash} title={t('Sin cobro asociado')}>{inv.kind === 'rectifying' ? t('El importe de la rectificativa se compensa en el pendiente de la factura original.') : t('Solo las facturas emitidas generan derecho de cobro.')}</EmptyState></Card>
            ) : (
              <>
                <div className="kpis">
                  <div className="kpi" style={{ cursor: 'default' }}><span className="label">{t('A cobrar (neto de rectificativas)')}</span><span className="value"><Money cents={collectibleCents(db, inv)} /></span></div>
                  <div className="kpi" style={{ cursor: 'default' }}><span className="label">{t('Cobrado')}</span><span className="value"><Money cents={paidCents(db, inv.id)} /></span></div>
                  <div className={`kpi ${isOverdue(db, inv, ctx.today) ? 'tone-danger' : ''}`} style={{ cursor: 'default' }}><span className="label">{t('Pendiente [importe]')}</span><span className="value"><Money cents={outstandingCents(db, inv)} /></span><span className="meta">{isOverdue(db, inv, ctx.today) ? t('Vencida hace {n} días', { n: daysOverdue(db, inv, ctx.today) }) : inv.dueDate ? t('Vence en {n} días', { n: diffDays(ctx.today, inv.dueDate) }) : ''}</span></div>
                </div>
                {isOverdue(db, inv, ctx.today) && customer.kind !== 'individual' && interestRule && (
                  <Callout tone="info" title={t('Información sobre demora (Ley 3/2004) — no se factura automáticamente')}>
                    {t('Interés legal de demora vigente: {rate} anual. Estimación a hoy: {amount} + {fee} de compensación por costes de cobro. Reclamarlo es una decisión de la empresa.', {
                      rate: formatPct(Number(interestRule.value)),
                      amount: formatEUR(roundCents((outstandingCents(db, inv) * Number(interestRule.value) / 100) * daysOverdue(db, inv, ctx.today) / 365)),
                      fee: formatEUR(4000),
                    })}
                  </Callout>
                )}
                <Card
                  title={t('Cobros registrados')}
                  flush
                  actions={
                    <>
                      {ctx.can('reminders.send') && col !== 'paid' && <Button size="sm" icon={BellRing} loading={pending} onClick={() => run(() => sendManualReminder(inv.id), (r) => (r.status === 'delivered' ? t('Recordatorio entregado (simulado)') : t('El recordatorio falló (simulado)')))}>{t('Enviar recordatorio')}</Button>}
                      {ctx.can('disputes.manage') && !dispute && col !== 'paid' && <Button size="sm" icon={MessageSquareWarning} onClick={() => setDialog('dispute')}>{t('Abrir disputa')}</Button>}
                      {ctx.can('payments.record') && col !== 'paid' && <Button size="sm" variant="primary" icon={Coins} onClick={() => setDialog('payment')}>{t('Registrar cobro')}</Button>}
                    </>
                  }
                >
                  {payments.length === 0 ? <EmptyState title={t('Sin cobros')}>{t('Registre los cobros con su referencia bancaria. El envío o la entrega no implican cobro.')}</EmptyState> : (
                    <table className="table">
                      <thead><tr><th>{t('Fecha')}</th><th>{t('Tipo')}</th><th>{t('Método')}</th><th>{t('Referencia')}</th><th>{t('Registrado')}</th><th className="num">{t('Importe')}</th><th /></tr></thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td><DateText date={p.date} /></td>
                            <td>{p.kind === 'payment' ? (reversed.has(p.id) ? <Badge tone="neutral">{t('Cobro anulado')}</Badge> : t('Cobro')) : <Badge tone="danger">{t('Anulación')}</Badge>}{p.note && <div className="sub">{p.note}</div>}</td>
                            <td>{t(PAYMENT_METHOD_LABEL[p.method])}</td>
                            <td className="mono small">{p.reference}</td>
                            <td className="small">{userName(db, p.recordedBy)}<div className="sub"><DateTimeText at={p.recordedAt} /></div></td>
                            <td className="num"><Money cents={p.kind === 'payment' ? p.amountCents : -p.amountCents} /></td>
                            <td>{p.kind === 'payment' && !reversed.has(p.id) && ctx.can('payments.reverse') && <ReverseButton paymentId={p.id} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
                {disputes.length > 0 && (
                  <Card title={t('Disputas')}>
                    <div className="stack">
                      {disputes.map((d) => (
                        <div key={d.id} className="stack-sm">
                          <div className="row"><Badge tone={d.status === 'open' ? 'danger' : 'success'}>{d.status === 'open' ? t('Abierta') : t('Resuelta')}</Badge>{d.holdReminders && d.status === 'open' && <Badge tone="warning">{t('Recordatorios retenidos')}</Badge>}<span className="small muted">{userName(db, d.openedBy)} · <DateTimeText at={d.openedAt} /></span></div>
                          <div>{d.reason}</div>
                          {d.status === 'resolved' && <div className="small">{t('Resolución:')} {d.resolution} — {userName(db, d.resolvedBy)}, <DateTimeText at={d.resolvedAt} /></div>}
                          {d.status === 'open' && ctx.can('disputes.manage') && <ResolveDisputeButton disputeId={d.id} />}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
                <Card title={<div className="row"><h2>{t('Recordatorios')}</h2><SimulatedTag /></div>} flush>
                  {reminders.length === 0 ? <EmptyState title={t('Sin recordatorios')} /> : (
                    <table className="table">
                      <thead><tr><th>{t('Fecha')}</th><th>{t('Paso')}</th><th>{t('Estado')}</th><th>{t('Detalle')}</th></tr></thead>
                      <tbody>
                        {reminders.map((r) => (
                          <tr key={r.id}>
                            <td><DateTimeText at={r.at} /></td>
                            <td>{r.offsetDays === null ? t('Manual') : t('+{n} días', { n: r.offsetDays })}</td>
                            <td><Badge tone={r.status === 'delivered' ? 'success' : r.status === 'suppressed' ? 'neutral' : r.status === 'failed' ? 'danger' : 'info'}>{t(REMINDER_STATUS_LABEL[r.status])}</Badge></td>
                            <td className="small">{t(r.reason)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </>
            )}
          </div>
        )}

        {tab === 'historial' && (
          <Card title={t('Historial de auditoría')}>
            <AuditList events={db.audit.filter((e) => e.entityId === inv.id && e.companyId === ctx.company.id)} />
          </Card>
        )}
      </div>

      {dialog === 'issue' && <IssueDialog inv={inv} onClose={() => setDialog(null)} />}
      {dialog === 'payment' && <PaymentDialog inv={inv} onClose={() => setDialog(null)} />}
      {dialog === 'dispute' && <DisputeDialog inv={inv} onClose={() => setDialog(null)} />}
      {dialog === 'send' && <SendDialog inv={inv} onClose={() => setDialog(null)} />}
      {dialog === 'correct' && <CorrectionDialog inv={inv} onClose={() => setDialog(null)} />}
      {dialog === 'request' && <ConfirmDialog title={t('Solicitar aprobación')} message={t('Se notificará a las personas con autoridad de aprobación.')} requireReason={false} reasonLabel={t('Comentario para el aprobador (opcional)')} confirmLabel={t('Solicitar')} onConfirm={(c) => runOk(() => requestApproval(inv.id, c), t('Aprobación solicitada'))} onClose={() => setDialog(null)} />}
      {dialog === 'approve' && <ConfirmDialog title={t('Aprobar factura')} message={<>{t('Confirma que ha revisado cliente, líneas, tratamiento fiscal y totales ({total}). Aprobar no emite la factura.', { total: formatEUR(inv.totals.totalCents) })}{validation && validation.warnings.length > 0 && <> {t('Existen {n} aviso(s) que quedarán registrados como aceptados.', { n: validation.warnings.length })}</>}</>} confirmLabel={t('Aprobar')} onConfirm={() => runOk(() => approveInvoice(inv.id), t('Factura aprobada'))} onClose={() => setDialog(null)} />}
      {dialog === 'return' && <ConfirmDialog title={t('Devolver al autor')} requireReason reasonLabel={t('Qué debe corregirse')} confirmLabel={t('Devolver')} onConfirm={(c) => runOk(() => returnToAuthor(inv.id, c), t('Borrador devuelto'))} onClose={() => setDialog(null)} />}
      {dialog === 'revoke' && <ConfirmDialog title={t('Revocar aprobación')} message={t('La factura vuelve a borrador y podrá editarse.')} requireReason confirmLabel={t('Revocar')} onConfirm={(r) => runOk(() => revokeApproval(inv.id, r), t('Aprobación revocada'))} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <ConfirmDialog danger title={t('Eliminar borrador')} message={t('El borrador no tiene número ni efectos fiscales. La eliminación quedará registrada en la auditoría.')} requireReason confirmLabel={t('Eliminar')} onConfirm={async (r) => { const ok = await runOk(() => deleteDraft(inv.id, r), t('Borrador eliminado')); if (ok) navigate('/facturas'); return ok; }} onClose={() => setDialog(null)} />}
      {dialog === 'resubmit' && <ConfirmDialog title={t('Subsanar y reenviar el registro')} message={t('Se enviará un nuevo registro (subsanación) con una clave de operación nueva. El resultado depende del escenario simulado configurado en Integración fiscal.')} requireReason reasonLabel={t('Corrección realizada')} confirmLabel={t('Reenviar')} onConfirm={(r) => run(() => resubmitFiscal(inv.id, r), (o) => t(o.message)).then((o) => o !== undefined)} onClose={() => setDialog(null)} />}
    </>
  );
}

function ReverseButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const { runOk } = useAction();
  return (
    <>
      <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setOpen(true)}>{t('Anular')}</Button>
      {open && <ConfirmDialog danger title={t('Anular cobro')} message={t('Se registrará un evento de anulación vinculado; el cobro original se conserva en el historial.')} requireReason confirmLabel={t('Anular cobro')} onConfirm={(r) => runOk(() => reversePayment(paymentId, r), t('Cobro anulado'))} onClose={() => setOpen(false)} />}
    </>
  );
}

function ResolveDisputeButton({ disputeId }: { disputeId: string }) {
  const [open, setOpen] = useState(false);
  const { runOk } = useAction();
  return (
    <>
      <div><Button size="sm" icon={FilePenLine} onClick={() => setOpen(true)}>{t('Resolver disputa')}</Button></div>
      {open && <ConfirmDialog title={t('Resolver disputa')} requireReason reasonLabel={t('Resolución (p. ej. rectificativa emitida, cliente acepta)')} confirmLabel={t('Resolver')} onConfirm={(r) => runOk(() => resolveDispute(disputeId, r), t('Disputa resuelta'))} onClose={() => setOpen(false)} />}
    </>
  );
}
