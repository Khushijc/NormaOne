import { AlertTriangle, CalendarClock, Coins, FilePlus, Receipt, ShieldAlert, UserPlus, Truck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuditList } from '../components/AuditList';
import { GroupedBarChart } from '../components/charts';
import { IssueGatePanel } from '../components/invoiceBits';
import { Badge, Button, Callout, Card, DateText, Money, PageHeader } from '../components/ui';
import { addMonths, diffDays, formatDate, inRange, PERIOD_LABELS, resolvePeriod, startOfMonth, type PeriodPreset } from '../domain/dates';
import { formatEUR } from '../domain/money';
import { locale, t } from '../i18n';
import { useCtx } from '../store/hooks';
import { AGEING_LABEL, ageingBucket, collectibleCents, collectionStatus, isCollectible, isOverdue, outstandingCents, type AgeingBucket } from '../store/selectors';

export function DashboardPage() {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const preset = (params.get('periodo') as PeriodPreset) || 'ytd';
  const custom = { from: params.get('desde') || null, to: params.get('hasta') || null };
  const { from, to } = preset === 'custom' ? custom : resolvePeriod(preset, ctx.today);
  const setPreset = (p: string) => setParams(p === 'custom' ? { periodo: p, desde: from ?? '', hasta: to ?? '' } : { periodo: p }, { replace: true });
  const periodQS = `${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;

  const invoices = db.invoices.filter((i) => i.companyId === ctx.company.id);
  const inPeriod = (d: string | null) => inRange(d, from, to);
  const issuedInPeriod = invoices.filter((i) => i.kind === 'ordinary' && (i.documentStatus === 'issued' || i.documentStatus === 'rectified') && inPeriod(i.issueDate));
  const count = (s: string) => invoices.filter((i) => i.documentStatus === s && (s === 'draft' || s === 'approved' ? true : inPeriod(i.issueDate))).length;
  const collectible = invoices.filter(isCollectible);
  const outstanding = collectible.reduce((s, i) => s + outstandingCents(db, i), 0);
  const overdue = collectible.filter((i) => isOverdue(db, i, ctx.today));
  const overdueAmt = overdue.reduce((s, i) => s + outstandingCents(db, i), 0);
  const partial = collectible.filter((i) => collectionStatus(db, i) === 'partial');
  const paidInPeriod = issuedInPeriod.filter((i) => collectionStatus(db, i) === 'paid').length;
  const collectedInPeriod = db.payments.filter((p) => p.companyId === ctx.company.id && inPeriod(p.date)).reduce((s, p) => s + (p.kind === 'payment' ? p.amountCents : -p.amountCents), 0);
  const expenses = db.expenses.filter((e) => e.companyId === ctx.company.id);
  const expPeriod = expenses.filter((e) => e.reviewStatus === 'approved' && inPeriod(e.documentDate));
  const supplierInvPeriod = expPeriod.filter((e) => e.kind === 'supplier_invoice');
  const expPending = expenses.filter((e) => e.reviewStatus === 'submitted');
  const fiscalExceptions = invoices.filter((i) => i.pendingOperationId || i.fiscalStatus === 'rejected' || i.fiscalStatus === 'needs_review');
  const pendingApproval = invoices.filter((i) => i.documentStatus === 'draft' && i.review.state === 'requested');

  const months = Array.from({ length: 6 }, (_, k) => addMonths(startOfMonth(ctx.today), k - 5));
  const groups = months.map((m) => {
    const key = m.slice(0, 7);
    const invoiced = invoices.filter((i) => (i.documentStatus === 'issued' || i.documentStatus === 'rectified') && i.issueDate?.startsWith(key)).reduce((s, i) => s + i.totals.totalCents, 0);
    const collected = db.payments.filter((p) => p.companyId === ctx.company.id && p.date.startsWith(key)).reduce((s, p) => s + (p.kind === 'payment' ? p.amountCents : -p.amountCents), 0);
    const label = new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}T00:00:00Z`));
    return { label: label.replace('.', ''), values: [invoiced, collected] };
  });

  const buckets: AgeingBucket[] = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
  const ageing = buckets.map((b) => ({ b, amount: collectible.filter((i) => outstandingCents(db, i) > 0 && ageingBucket(db, i, ctx.today) === b).reduce((s, i) => s + outstandingCents(db, i), 0) }));
  const maxAge = Math.max(1, ...ageing.map((a) => a.amount));
  const upcoming = collectible.filter((i) => outstandingCents(db, i) > 0 && i.dueDate && i.dueDate >= ctx.today && diffDays(ctx.today, i.dueDate) <= 21).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));

  const Kpi = ({ label, value, meta, to, tone, icon: Icon }: { label: string; value: React.ReactNode; meta?: React.ReactNode; to: string; tone?: 'danger' | 'warning'; icon?: typeof Coins }) => (
    <button className={`kpi ${tone ? `tone-${tone}` : ''}`} onClick={() => navigate(to)} aria-label={t('{label}: ver detalle', { label })}>
      <span className="label">{Icon && <Icon size={14} aria-hidden />}{label}</span>
      <span className="value">{value}</span>
      {meta && <span className="meta">{meta}</span>}
    </button>
  );

  const sifText = ctx.finance.sif.deadline ? t('sistemas adaptados antes del {date}', { date: formatDate(ctx.finance.sif.deadline) }) : t('pendiente de decisión');
  const b2bText = ctx.finance.b2b.deadline ? t('desde el {date} (capacidad no validada, FIN-09)', { date: formatDate(ctx.finance.b2b.deadline) }) : t('pendiente de decisión');

  return (
    <>
      <PageHeader
        title={t('Panel de finanzas')}
        subtitle={t('Estado operativo de {company}. Indicadores calculados a partir de los registros; no constituyen una evaluación de cumplimiento legal.', { company: ctx.company.legalName })}
        actions={
          <>
            <div className="field" style={{ minWidth: 180 }}>
              <label htmlFor="d-period" className="sr-only">{t('Periodo')}</label>
              <select id="d-period" className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {Object.entries(PERIOD_LABELS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </select>
            </div>
            {preset === 'custom' && (
              <>
                <input aria-label={t('Desde')} type="date" className="input" style={{ width: 150 }} value={custom.from ?? ''} onChange={(e) => setParams({ periodo: 'custom', desde: e.target.value, hasta: custom.to ?? '' }, { replace: true })} />
                <input aria-label={t('Hasta')} type="date" className="input" style={{ width: 150 }} value={custom.to ?? ''} onChange={(e) => setParams({ periodo: 'custom', desde: custom.from ?? '', hasta: e.target.value }, { replace: true })} />
              </>
            )}
          </>
        }
      />
      <div className="stack-lg">
        <p className="small muted" style={{ marginTop: -8 }}>
          {t('Periodo: {from} – {to} · Los saldos pendientes y vencidos se muestran siempre a fecha de hoy ({today}).', { from: from ? formatDate(from) : t('inicio'), to: to ? formatDate(to) : t('hoy'), today: formatDate(ctx.today) })}
        </p>
        <IssueGatePanel ctx={ctx} />

        <div className="row-wrap">
          {ctx.can('invoices.edit_draft') && <Button variant="primary" icon={FilePlus} onClick={() => navigate('/facturas/nueva')}>{t('Nueva factura')}</Button>}
          {ctx.can('expenses.submit_own') && <Button icon={Receipt} onClick={() => navigate('/gastos/nuevo?tipo=empleado')}>{t('Nuevo gasto')}</Button>}
          {ctx.can('payments.record') && <Button icon={Coins} onClick={() => navigate('/cobros?vista=pendientes')}>{t('Registrar cobro')}</Button>}
          {ctx.can('customers.manage') && <Button icon={UserPlus} onClick={() => navigate('/clientes?nuevo=1')}>{t('Nuevo cliente')}</Button>}
          {ctx.can('suppliers.manage') && <Button icon={Truck} onClick={() => navigate('/proveedores?nuevo=1')}>{t('Nuevo proveedor')}</Button>}
        </div>

        <section aria-label={t('Facturación')}>
          <h2 style={{ marginBottom: 8 }}>{t('Facturación')}</h2>
          <div className="kpis">
            <Kpi label={t('Facturado en el periodo')} value={<Money cents={issuedInPeriod.reduce((s, i) => s + collectibleCents(db, i), 0)} />} meta={issuedInPeriod.length === 1 ? t('{n} factura emitida', { n: 1 }) : t('{n} facturas emitidas', { n: issuedInPeriod.length })} to={`/facturas?kind=ordinary${periodQS}`} />
            <Kpi label={t('Borradores')} value={count('draft')} meta={pendingApproval.length === 1 ? t('{n} pendiente de aprobación', { n: 1 }) : t('{n} pendientes de aprobación', { n: pendingApproval.length })} to="/facturas?doc=draft" />
            <Kpi label={t('Aprobadas sin emitir')} value={count('approved')} to="/facturas?doc=approved" />
            <Kpi label={t('Emitidas (periodo)')} value={count('issued')} to={`/facturas?doc=issued${periodQS}`} />
            <Kpi label={t('Rectificadas (periodo)')} value={count('rectified')} to={`/facturas?doc=rectified${periodQS}`} />
            <Kpi label={t('Excepciones fiscales')} value={fiscalExceptions.length} meta={t('Rechazos, errores o resultado incierto')} to="/integracion-fiscal" tone={fiscalExceptions.length ? 'danger' : undefined} icon={ShieldAlert} />
          </div>
        </section>

        <section aria-label={t('Cobros')}>
          <h2 style={{ marginBottom: 8 }}>{t('Cobros')}</h2>
          <div className="kpis">
            <Kpi label={t('Pendiente de cobro')} value={<Money cents={outstanding} />} meta={t('Todas las facturas emitidas')} to="/cobros" />
            <Kpi label={t('Vencido')} value={<Money cents={overdueAmt} />} meta={overdue.length === 1 ? t('{n} factura vencida', { n: 1 }) : t('{n} facturas vencidas', { n: overdue.length })} to="/facturas?overdue=1" tone={overdue.length ? 'danger' : undefined} icon={AlertTriangle} />
            <Kpi label={t('Cobro parcial')} value={partial.length} meta={t('{amount} pendientes', { amount: formatEUR(partial.reduce((s, i) => s + outstandingCents(db, i), 0)) })} to="/facturas?collection=partial" tone={partial.length ? 'warning' : undefined} />
            <Kpi label={t('Cobradas (emitidas en periodo)')} value={paidInPeriod} to={`/facturas?collection=paid${periodQS}`} />
            <Kpi label={t('Cobrado en el periodo')} value={<Money cents={collectedInPeriod} />} to="/cobros?vista=historial" />
          </div>
        </section>

        <section aria-label={t('Gastos')}>
          <h2 style={{ marginBottom: 8 }}>{t('Gastos')}</h2>
          <div className="kpis">
            <Kpi label={t('Gastos aprobados (periodo)')} value={<Money cents={expPeriod.reduce((s, e) => s + e.totalCents, 0)} />} meta={expPeriod.length === 1 ? t('{n} documento', { n: 1 }) : t('{n} documentos', { n: expPeriod.length })} to="/gastos?vista=all&revision=approved" />
            <Kpi label={t('Facturas de proveedores (periodo)')} value={<Money cents={supplierInvPeriod.reduce((s, e) => s + e.totalCents, 0)} />} meta={supplierInvPeriod.length === 1 ? t('{n} factura', { n: 1 }) : t('{n} facturas', { n: supplierInvPeriod.length })} to="/gastos?vista=supplier" />
            <Kpi label={t('Pendientes de revisión')} value={expPending.length} meta={formatEUR(expPending.reduce((s, e) => s + e.totalCents, 0))} to="/gastos?vista=all&revision=submitted" tone={expPending.length ? 'warning' : undefined} />
            <Kpi label={t('Aprobados sin pagar')} value={expenses.filter((e) => e.reviewStatus === 'approved' && e.paymentStatus === 'unpaid').length} to="/gastos?vista=all&revision=approved&pago=unpaid" />
          </div>
        </section>

        <div className="grid-2">
          <Card title={t('Facturado y cobrado · últimos 6 meses')}>
            <GroupedBarChart groups={groups} series={[t('Facturado (total)'), t('Cobrado')]} ariaLabel={t('Gráfico de barras: facturado y cobrado por mes')} />
          </Card>
          <Card title={t('Antigüedad del saldo pendiente')} actions={<Link to="/cobros" className="small">{t('Ver cobros')}</Link>}>
            <div className="stack-sm">
              {ageing.map((a) => (
                <Link key={a.b} to={`/cobros?tramo=${a.b}`} className="hbar" aria-label={`${t(AGEING_LABEL[a.b])}: ${formatEUR(a.amount)}`} title={`${t(AGEING_LABEL[a.b])}: ${formatEUR(a.amount)}`}>
                  <span>{t(AGEING_LABEL[a.b])}</span>
                  <span className="track-bg"><span className="fill" style={{ width: `${(a.amount / maxAge) * 100}%`, display: 'block' }} /></span>
                  <span className="num">{formatEUR(a.amount)}</span>
                </Link>
              ))}
              <p className="tiny muted">{t('Importe pendiente por días desde el vencimiento, a fecha de hoy.')}</p>
            </div>
          </Card>
        </div>

        <div className="grid-2">
          <Card title={t('Próximos vencimientos (21 días)')} flush>
            {upcoming.length === 0 ? <div style={{ padding: 16 }} className="muted">{t('No hay vencimientos próximos.')}</div> : (
              <table className="table">
                <thead><tr><th>{t('Factura')}</th><th>{t('Cliente')}</th><th>{t('Vence')}</th><th className="num">{t('Pendiente [importe]')}</th></tr></thead>
                <tbody>
                  {upcoming.slice(0, 8).map((i) => (
                    <tr key={i.id} className="clickable" onClick={() => navigate(`/facturas/${i.id}`)}>
                      <td><Link to={`/facturas/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number}</Link></td>
                      <td>{db.customers.find((c) => c.id === i.customerId)?.legalName}</td>
                      <td><DateText date={i.dueDate} /> <Badge tone="info" icon={CalendarClock}>{t('{n} d', { n: diffDays(ctx.today, i.dueDate!) })}</Badge></td>
                      <td className="num"><Money cents={outstandingCents(db, i)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={t('Actividad reciente')} actions={ctx.can('audit.view') ? <Link to="/auditoria" className="small">{t('Ver auditoría')}</Link> : undefined}>
            <AuditList events={db.audit.filter((e) => e.companyId === ctx.company.id)} limit={7} />
          </Card>
        </div>
        <Callout tone="neutral" title={t('Plazos normativos configurados para esta empresa')}>
          {t('SIF/RRSIF: {sif} · Factura electrónica B2B: {b2b}.', { sif: sifText, b2b: b2bText })}{' '}
          {t('Hacienda anunció el 05/10/2026 un aplazamiento de VERI*FACTU a octubre de 2028 sin instrumento publicado: no se aplica.')}{' '}
          <Link to="/configuracion?tab=reglas">{t('Ver reglas y fuentes')}</Link>
        </Callout>
      </div>
    </>
  );
}
