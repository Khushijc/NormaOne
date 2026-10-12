import { BellRing, Coins, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExportButton } from '../components/ExportButton';
import { Badge, Button, Callout, Card, DateText, DateTimeText, EmptyState, Money, PageHeader, Pagination, SimulatedTag, SortHeader, StatusBadge, Tabs, sortRows, usePaged, useSort, useAction } from '../components/ui';
import { inRange } from '../domain/dates';
import { COLLECTION_STATUS } from '../domain/status';
import type { Invoice } from '../domain/types';
import { PAYMENT_METHOD_LABEL, planReminders, runReminders } from '../services/collectionService';
import { invoiceColumns, paymentColumns } from '../services/exportColumns';
import { t, tKey } from '../i18n';
import { useCtx } from '../store/hooks';
import { AGEING_LABEL, ageingBucket, collectionStatus, daysOverdue, isCollectible, openDispute, outstandingCents, userName, type AgeingBucket } from '../store/selectors';
import { PaymentDialog } from './invoices/invoiceDialogs';

type View = 'pendientes' | 'historial' | 'recordatorios' | 'disputas';

const REMINDER_STATUS = { sent: tKey('Enviado'), delivered: tKey('Entregado'), failed: tKey('Fallido'), suppressed: tKey('Suprimido') } as const;
const REMINDER_STATUS_LOWER = { sent: tKey('enviado'), delivered: tKey('entregado'), failed: tKey('fallido'), suppressed: tKey('suprimido') } as const;

export function CollectionsPage() {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (params.get('vista') as View) || 'pendientes';
  const bucket = (params.get('tramo') as AgeingBucket) || '';
  const setP = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { run, pending } = useAction();
  const { sort, onSort } = useSort('days');

  const collectible = db.invoices.filter((i) => i.companyId === ctx.company.id && isCollectible(i));
  const open = collectible.filter((i) => outstandingCents(db, i) > 0 && (!bucket || ageingBucket(db, i, ctx.today) === bucket) && (!customer || i.customerId === customer));
  const sortedOpen = sortRows(open, sort, (i, c) => (c === 'days' ? daysOverdue(db, i, ctx.today) * 1e6 - (i.dueDate ? Date.parse(i.dueDate) / 1e8 : 0) : c === 'amount' ? outstandingCents(db, i) : c === 'due' ? i.dueDate : c === 'customer' ? db.customers.find((x) => x.id === i.customerId)?.legalName ?? '' : null));
  const pagedOpen = usePaged(sortedOpen);
  const payments = db.payments.filter((p) => p.companyId === ctx.company.id && inRange(p.date, from || null, to || null) && (!customer || db.invoices.find((i) => i.id === p.invoiceId)?.customerId === customer)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const pagedPay = usePaged(payments);
  const plan = view === 'recordatorios' ? planReminders() : [];
  const reminders = db.reminders.filter((r) => r.companyId === ctx.company.id).sort((a, b) => (a.at < b.at ? 1 : -1));
  const disputes = db.disputes.filter((d) => d.companyId === ctx.company.id).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  const policy = db.collectionPolicies.find((p) => p.companyId === ctx.company.id);
  const customers = db.customers.filter((c) => c.companyId === ctx.company.id);
  const buckets: AgeingBucket[] = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
  const totals = buckets.map((b) => collectible.filter((i) => outstandingCents(db, i) > 0 && ageingBucket(db, i, ctx.today) === b).reduce((s, i) => s + outstandingCents(db, i), 0));

  return (
    <>
      <PageHeader title={t('Cobros')} subtitle={t('Saldos pendientes, antigüedad, cobros registrados, recordatorios y disputas. Un cobro solo existe si se registra: nunca se deduce del envío o la entrega.')} />
      <div className="kpis" style={{ marginBottom: 16 }}>
        {buckets.map((b, i) => (
          <button key={b} className={`kpi ${b !== 'not_due' && totals[i] ? (b === 'd1_30' ? 'tone-warning' : 'tone-danger') : ''}`} aria-pressed={bucket === b} onClick={() => { const n = new URLSearchParams(params); n.set('vista', 'pendientes'); if (bucket === b) n.delete('tramo'); else n.set('tramo', b); setParams(n, { replace: true }); }} style={bucket === b ? { outline: '2px solid var(--focus)' } : undefined}>
            <span className="label">{t(AGEING_LABEL[b])}</span>
            <span className="value"><Money cents={totals[i]} /></span>
            <span className="meta">{bucket === b ? t('Filtro activo · pulse para quitar') : t('Filtrar')}</span>
          </button>
        ))}
      </div>
      <Tabs label={t('Vistas de cobro')} value={view} onChange={(v) => setP('vista', v)} tabs={[{ id: 'pendientes', label: t('Pendientes'), count: open.length }, { id: 'historial', label: t('Historial de cobros') }, { id: 'recordatorios', label: t('Recordatorios') }, { id: 'disputas', label: t('Disputas'), count: disputes.filter((d) => d.status === 'open').length }]} />

      {(view === 'pendientes' || view === 'historial') && (
        <div className="toolbar card" style={{ marginBottom: 12 }}>
          <div className="field">
            <label htmlFor="c-cust">{t('Cliente')}</label>
            <select id="c-cust" className="select" value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
            </select>
          </div>
          {view === 'historial' && (
            <>
              <div className="field"><label htmlFor="c-from">{t('Desde')}</label><input id="c-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field"><label htmlFor="c-to">{t('Hasta')}</label><input id="c-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>
          )}
          <div style={{ marginLeft: 'auto' }}>
            {view === 'pendientes' ? (
              <ExportButton kind="collections.outstanding" baseName="pendiente_cobro" rows={sortedOpen} columns={invoiceColumns(db)} filters={`${bucket ? AGEING_LABEL[bucket] : 'Todos los tramos'}${customer ? ', cliente filtrado' : ''}`} totalCents={open.reduce((s, i) => s + outstandingCents(db, i), 0)} />
            ) : (
              <ExportButton kind="collections.payments" baseName="cobros" rows={payments} columns={paymentColumns(db)} filters={`${from || 'inicio'} – ${to || 'hoy'}`} periodFrom={from || null} periodTo={to || null} />
            )}
          </div>
        </div>
      )}

      {view === 'pendientes' && (
        <Card flush>
          {sortedOpen.length === 0 ? <EmptyState icon={Coins} title={t('No hay importes pendientes con estos filtros')} /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('Factura')}</th>
                      <SortHeader label={t('Cliente')} col="customer" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Vencimiento')} col="due" sort={sort} onSort={onSort} />
                      <SortHeader label={t('Días vencida')} col="days" sort={sort} onSort={onSort} num />
                      <SortHeader label={t('Pendiente [importe]')} col="amount" sort={sort} onSort={onSort} num />
                      <th>{t('Estado')}</th>
                      <th><span className="sr-only">{t('Acciones')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedOpen.rows.map((i) => {
                      const st = collectionStatus(db, i)!;
                      const d = daysOverdue(db, i, ctx.today);
                      const lastRem = db.reminders.filter((r) => r.invoiceId === i.id).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
                      return (
                        <tr key={i.id}>
                          <td><Link to={`/facturas/${i.id}?tab=cobros`} className="strong">{i.number}</Link></td>
                          <td>{db.customers.find((c) => c.id === i.customerId)?.legalName}</td>
                          <td><DateText date={i.dueDate} /></td>
                          <td className="num">{d > 0 ? <Badge tone={d > 30 ? 'danger' : 'warning'}>{d} d</Badge> : <span className="muted">—</span>}</td>
                          <td className="num"><Money cents={outstandingCents(db, i)} /></td>
                          <td>
                            <div className="status-stack">
                              <StatusBadge meta={COLLECTION_STATUS[st]} />
                              {openDispute(db, i.id)?.holdReminders && <Badge tone="neutral">{t('Recordatorios retenidos')}</Badge>}
                            </div>
                            {lastRem && <div className="sub">{t('Último recordatorio: {status}', { status: t(REMINDER_STATUS_LOWER[lastRem.status]) })} · <DateTimeText at={lastRem.at} /></div>}
                          </td>
                          <td>{ctx.can('payments.record') && <Button size="sm" icon={Coins} onClick={() => setPaying(i)}>{t('Cobro')}</Button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>{open.length === 1 ? t('{n} factura', { n: 1 }) : t('{n} facturas', { n: open.length })}</td><td className="num"><Money cents={open.reduce((s, i) => s + outstandingCents(db, i), 0)} /></td><td colSpan={2} /></tr></tfoot>
                </table>
              </div>
              <Pagination {...pagedOpen.props} />
            </>
          )}
        </Card>
      )}

      {view === 'historial' && (
        <Card flush>
          {payments.length === 0 ? <EmptyState title={t('Sin cobros en el periodo')} /> : (
            <>
              <table className="table">
                <thead><tr><th>{t('Fecha')}</th><th>{t('Factura')}</th><th>{t('Cliente')}</th><th>{t('Método')}</th><th>{t('Referencia')}</th><th>{t('Registrado por')}</th><th className="num">{t('Importe')}</th></tr></thead>
                <tbody>
                  {pagedPay.rows.map((p) => {
                    const inv = db.invoices.find((i) => i.id === p.invoiceId);
                    return (
                      <tr key={p.id} className="clickable" onClick={() => navigate(`/facturas/${p.invoiceId}?tab=cobros`)}>
                        <td><DateText date={p.date} /></td>
                        <td><Link to={`/facturas/${p.invoiceId}?tab=cobros`} onClick={(e) => e.stopPropagation()}>{inv?.number}</Link></td>
                        <td>{db.customers.find((c) => c.id === inv?.customerId)?.legalName}</td>
                        <td>{t(PAYMENT_METHOD_LABEL[p.method])} {p.kind === 'reversal' && <Badge tone="danger">{t('Anulación')}</Badge>}</td>
                        <td className="mono small">{p.reference}</td>
                        <td>{userName(db, p.recordedBy)}</td>
                        <td className="num"><Money cents={p.kind === 'payment' ? p.amountCents : -p.amountCents} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><td colSpan={6}>{t('Total neto')}</td><td className="num"><Money cents={payments.reduce((s, p) => s + (p.kind === 'payment' ? p.amountCents : -p.amountCents), 0)} /></td></tr></tfoot>
              </table>
              <Pagination {...pagedPay.props} />
            </>
          )}
        </Card>
      )}

      {view === 'recordatorios' && (
        <div className="stack">
          <Card title={<div className="row"><h2>{t('Ejecución de recordatorios')}</h2><SimulatedTag label={t('Correo simulado')} /></div>} actions={ctx.can('reminders.send') && <Button variant="primary" icon={Play} loading={pending} disabled={plan.length === 0} onClick={() => run(() => runReminders(), (r) => t('Recordatorios: {sent} entregados, {suppressed} suprimidos, {failed} fallidos', { sent: r.sent, suppressed: r.suppressed, failed: r.failed }))}>{t('Ejecutar ahora ({n})', { n: plan.length })}</Button>}>
            <p className="small" style={{ marginBottom: 10 }}>
              {t('Política: recordatorios a los {days} días del vencimiento.', { days: policy?.reminderOffsetsDays.join(', ') ?? '' })} {policy?.suppressWhenDisputed ? t('Se suprimen si hay disputa con retención.') : ''} {t('Nunca se envían para facturas cobradas.')} <Link to="/configuracion?tab=cobros">{t('Configurar')}</Link>
            </p>
            {plan.length === 0 ? <Callout tone="success">{t('No hay recordatorios pendientes de enviar hoy.')}</Callout> : (
              <table className="table">
                <thead><tr><th>{t('Factura')}</th><th>{t('Paso')}</th><th>{t('Acción prevista')}</th></tr></thead>
                <tbody>{plan.map((p, i) => <tr key={i}><td><Link to={`/facturas/${p.invoiceId}?tab=cobros`}>{db.invoices.find((x) => x.id === p.invoiceId)?.number}</Link></td><td>{t('+{n} días', { n: p.offsetDays })}</td><td>{p.action === 'send' ? <Badge tone="info" icon={BellRing}>{t('Enviar')}</Badge> : <Badge tone="neutral">{t('Suprimir')}</Badge>} <span className="small">{t(p.reason)}</span></td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <Card title={t('Registro de recordatorios')} flush>
            {reminders.length === 0 ? <EmptyState title={t('Sin recordatorios')} /> : (
              <table className="table">
                <thead><tr><th>{t('Fecha')}</th><th>{t('Factura')}</th><th>{t('Paso')}</th><th>{t('Estado')}</th><th>{t('Detalle')}</th></tr></thead>
                <tbody>{reminders.map((r) => <tr key={r.id}><td><DateTimeText at={r.at} /></td><td><Link to={`/facturas/${r.invoiceId}?tab=cobros`}>{db.invoices.find((x) => x.id === r.invoiceId)?.number}</Link></td><td>{r.offsetDays === null ? t('Manual') : t('+{n} d', { n: r.offsetDays })}</td><td><Badge tone={r.status === 'delivered' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>{t(REMINDER_STATUS[r.status])}</Badge></td><td className="small">{t(r.reason)}</td></tr>)}</tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {view === 'disputas' && (
        <Card flush>
          {disputes.length === 0 ? <EmptyState title={t('No hay disputas registradas')}>{t('Las disputas se abren desde la pestaña Cobros de cada factura.')}</EmptyState> : (
            <table className="table">
              <thead><tr><th>{t('Factura')}</th><th>{t('Estado')}</th><th>{t('Motivo')}</th><th>{t('Abierta')}</th><th>{t('Resolución')}</th></tr></thead>
              <tbody>
                {disputes.map((d) => (
                  <tr key={d.id}>
                    <td><Link to={`/facturas/${d.invoiceId}?tab=cobros`}>{db.invoices.find((i) => i.id === d.invoiceId)?.number}</Link></td>
                    <td><Badge tone={d.status === 'open' ? 'danger' : 'success'}>{d.status === 'open' ? t('Abierta') : t('Resuelta')}</Badge>{d.holdReminders && d.status === 'open' && <div className="sub">{t('Retiene recordatorios')}</div>}</td>
                    <td className="small">{d.reason}</td>
                    <td className="small">{userName(db, d.openedBy)}<div className="sub"><DateTimeText at={d.openedAt} /></div></td>
                    <td className="small">{d.resolution ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {paying && <PaymentDialog inv={paying} onClose={() => setPaying(null)} />}
    </>
  );
}
