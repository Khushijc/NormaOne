import { FileBarChart } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ExportButton } from '../components/ExportButton';
import { Callout, Card, EmptyState, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, inRange, nowISO, PERIOD_LABELS, resolvePeriod, type PeriodPreset } from '../domain/dates';
import { formatEUR } from '../domain/money';
import { FISCAL_OPERATION_STATE } from '../domain/status';
import type { Database, FiscalOperation, Invoice } from '../domain/types';
import { invoiceColumns, paymentColumns } from '../services/exportColumns';
import type { Column } from '../services/exportService';
import { EXPENSE_CATEGORIES } from '../services/expenseService';
import { summarisePeriod } from '../services/handoverService';
import { t, tKey } from '../i18n';
import { useCtx } from '../store/hooks';
import { collectionStatus, daysOverdue, isCollectible, isOverdue, outstandingCents, userName } from '../store/selectors';

type ReportId = 'ventas' | 'gastos' | 'pendiente' | 'vencidas' | 'cobros' | 'fiscal' | 'conciliacion' | 'traspasos';

interface ReportDef {
  id: ReportId;
  title: string;
  description: string;
  periodBased: boolean;
}

const REPORTS: ReportDef[] = [
  { id: 'ventas', title: tKey('Ventas por periodo'), description: tKey('Facturas emitidas y rectificativas con desglose de base, IVA y retención.'), periodBased: true },
  { id: 'gastos', title: tKey('Gastos por periodo'), description: tKey('Gastos aprobados agrupados por categoría (periodo contable).'), periodBased: true },
  { id: 'pendiente', title: tKey('Saldo pendiente por cliente'), description: tKey('Importe pendiente de cobro y vencido por cliente, a fecha de hoy.'), periodBased: false },
  { id: 'vencidas', title: tKey('Vencidas y cobros parciales'), description: tKey('Facturas vencidas o con cobro parcial, a fecha de hoy.'), periodBased: false },
  { id: 'cobros', title: tKey('Historial de cobros'), description: tKey('Cobros y anulaciones registrados en el periodo.'), periodBased: true },
  { id: 'fiscal', title: tKey('Incidencias fiscales'), description: tKey('Operaciones con el proveedor (simulado) rechazadas, con errores, inciertas o fallidas.'), periodBased: true },
  { id: 'conciliacion', title: tKey('Excepciones de conciliación'), description: tKey('Excepciones que impiden un traspaso limpio a la gestoría.'), periodBased: true },
  { id: 'traspasos', title: tKey('Traspasos a la gestoría'), description: tKey('Estado de los traspasos contables por periodo.'), periodBased: false },
];

/**
 * Columns whose cell values are Spanish labels (statuses, categories, kinds). Export files keep
 * the Spanish values; the on-screen table translates them. Other columns carry business data.
 */
const LABEL_COLUMNS = new Set(['tipo', 'categoria', 'estado_fiscal', 'estado_cobro', 'resultado', 'estado', 'metodo', 'periodo', 'detalle']);

interface Built<T> {
  rows: T[];
  columns: Column<T>[];
  total?: number;
}

function build(id: ReportId, db: Database, companyId: string, today: string, from: string | null, to: string | null): Built<unknown> {
  const invs = db.invoices.filter((i) => i.companyId === companyId);
  switch (id) {
    case 'ventas': {
      const rows = invs.filter((i) => (i.documentStatus === 'issued' || i.documentStatus === 'rectified') && inRange(i.issueDate, from, to)).sort((a, b) => (a.issueDate! < b.issueDate! ? -1 : 1));
      const cols = invoiceColumns(db).filter((c) => ['numero', 'tipo', 'fecha_expedicion', 'cliente', 'nif_cliente', 'base', 'cuota', 'retencion', 'total', 'estado_fiscal'].includes(c.key));
      return { rows, columns: cols as Column<unknown>[], total: rows.reduce((s, i) => s + i.totals.totalCents, 0) };
    }
    case 'gastos': {
      const exps = db.expenses.filter((e) => e.companyId === companyId && e.reviewStatus === 'approved' && (!from || e.accountingPeriod >= from.slice(0, 7)) && (!to || e.accountingPeriod <= to.slice(0, 7)));
      const groups = Object.entries(exps.reduce<Record<string, typeof exps>>((acc, e) => ((acc[e.category] ||= []).push(e), acc), {})).map(([cat, list]) => ({ cat, count: list.length, base: list.reduce((s, e) => s + e.baseCents, 0), vat: list.reduce((s, e) => s + e.vatCents, 0), total: list.reduce((s, e) => s + e.totalCents, 0) }));
      return {
        rows: groups.sort((a, b) => b.total - a.total),
        columns: [
          { key: 'categoria', label: tKey('Categoría'), value: (r: (typeof groups)[number]) => EXPENSE_CATEGORIES[r.cat] ?? r.cat },
          { key: 'documentos', label: tKey('Documentos'), value: (r: (typeof groups)[number]) => r.count },
          { key: 'base', label: tKey('Base'), value: (r: (typeof groups)[number]) => r.base, money: true },
          { key: 'iva', label: tKey('IVA soportado'), value: (r: (typeof groups)[number]) => r.vat, money: true },
          { key: 'total', label: tKey('Total'), value: (r: (typeof groups)[number]) => r.total, money: true },
        ] as Column<unknown>[],
        total: groups.reduce((s, g) => s + g.total, 0),
      };
    }
    case 'pendiente': {
      const by = new Map<string, { name: string; nif: string; count: number; pending: number; overdue: number }>();
      for (const i of invs.filter(isCollectible)) {
        const o = outstandingCents(db, i);
        if (!o) continue;
        const c = db.customers.find((x) => x.id === i.customerId)!;
        const cur = by.get(c.id) ?? { name: c.legalName, nif: c.idNumber, count: 0, pending: 0, overdue: 0 };
        cur.count++;
        cur.pending += o;
        if (isOverdue(db, i, today)) cur.overdue += o;
        by.set(c.id, cur);
      }
      const rows = Array.from(by.values()).sort((a, b) => b.pending - a.pending);
      type R = (typeof rows)[number];
      return {
        rows,
        columns: [
          { key: 'cliente', label: tKey('Cliente'), value: (r: R) => r.name },
          { key: 'nif', label: tKey('NIF'), value: (r: R) => r.nif },
          { key: 'facturas', label: tKey('Facturas abiertas'), value: (r: R) => r.count },
          { key: 'pendiente', label: tKey('Pendiente [importe]'), value: (r: R) => r.pending, money: true },
          { key: 'vencido', label: tKey('Vencido'), value: (r: R) => r.overdue, money: true },
        ] as Column<unknown>[],
        total: rows.reduce((s, r) => s + r.pending, 0),
      };
    }
    case 'vencidas': {
      const rows = invs.filter((i) => isCollectible(i) && (isOverdue(db, i, today) || collectionStatus(db, i) === 'partial'));
      return {
        rows,
        columns: [
          ...invoiceColumns(db).filter((c) => ['numero', 'cliente', 'vencimiento', 'a_cobrar', 'cobrado', 'pendiente', 'estado_cobro'].includes(c.key)),
          { key: 'dias', label: tKey('Días vencida'), value: (i: Invoice) => daysOverdue(db, i, today) },
        ] as Column<unknown>[],
        total: rows.reduce((s, i) => s + outstandingCents(db, i as Invoice), 0),
      };
    }
    case 'cobros': {
      const rows = db.payments.filter((p) => p.companyId === companyId && inRange(p.date, from, to)).sort((a, b) => (a.date < b.date ? -1 : 1));
      return { rows, columns: paymentColumns(db) as Column<unknown>[], total: rows.reduce((s, p) => s + (p.kind === 'payment' ? p.amountCents : -p.amountCents), 0) };
    }
    case 'fiscal': {
      const rows = db.fiscalOperations.filter((o) => o.companyId === companyId && o.state !== 'accepted' && inRange(o.requestedAt.slice(0, 10), from, to));
      return {
        rows,
        columns: [
          { key: 'fecha', label: tKey('Solicitada'), value: (o: FiscalOperation) => formatDateTime(o.requestedAt) },
          { key: 'factura', label: tKey('Factura'), value: (o: FiscalOperation) => db.invoices.find((i) => i.id === o.invoiceId)?.number ?? o.reservedNumber },
          { key: 'clave', label: tKey('Clave de operación'), value: (o: FiscalOperation) => o.operationKey },
          { key: 'resultado', label: tKey('Resultado (simulado)'), value: (o: FiscalOperation) => FISCAL_OPERATION_STATE[o.state].label },
          { key: 'detalle', label: tKey('Detalle'), value: (o: FiscalOperation) => [o.responseMessage, ...o.errors.map((e) => `${e.code}: ${e.message}`)].filter(Boolean).join(' | ') },
          { key: 'conciliada', label: tKey('Conciliada'), value: (o: FiscalOperation) => (o.reconciledAt ? formatDateTime(o.reconciledAt) : '') },
          { key: 'por', label: tKey('Solicitada por'), value: (o: FiscalOperation) => userName(db, o.requestedBy) },
        ] as Column<unknown>[],
      };
    }
    case 'conciliacion': {
      const rows = summarisePeriod(db, companyId, from ?? '2000-01-01', to ?? today).exceptions;
      return {
        rows,
        columns: [
          { key: 'tipo', label: tKey('Tipo'), value: (r: (typeof rows)[number]) => ({ fiscal: tKey('Fiscal'), dispute: tKey('Disputa'), uncertain: tKey('Emisión incierta'), expense: tKey('Gasto sin revisar'), evidence: tKey('Sin justificante') } as Record<string, string>)[r.kind] ?? r.kind },
          { key: 'detalle', label: tKey('Detalle'), value: (r: (typeof rows)[number]) => r.label },
        ] as Column<unknown>[],
      };
    }
    case 'traspasos': {
      const rows = db.handovers.filter((h) => h.companyId === companyId).sort((a, b) => (a.periodFrom < b.periodFrom ? 1 : -1));
      type R = (typeof rows)[number];
      return {
        rows,
        columns: [
          { key: 'periodo', label: tKey('Periodo'), value: (h: R) => h.label },
          { key: 'estado', label: tKey('Estado'), value: (h: R) => ({ in_preparation: tKey('En preparación'), ready: tKey('Lista'), delivered: tKey('Entregada'), acknowledged: tKey('Recibida') })[h.status] },
          { key: 'checklist', label: tKey('Checklist manual'), value: (h: R) => `${h.checklist.filter((c) => c.done).length}/${h.checklist.length}` },
          { key: 'exportaciones', label: tKey('Exportaciones'), value: (h: R) => h.exportIds.length },
          { key: 'entregado', label: tKey('Entregado'), value: (h: R) => (h.deliveredAt ? formatDateTime(h.deliveredAt) : '') },
          { key: 'recibido', label: tKey('Recibido'), value: (h: R) => (h.acknowledgedAt ? `${formatDateTime(h.acknowledgedAt)} · ${userName(db, h.acknowledgedBy)}` : '') },
        ] as Column<unknown>[],
      };
    }
  }
}

export function ReportsPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const id = (params.get('informe') as ReportId) || 'ventas';
  const preset = (params.get('periodo') as PeriodPreset) || 'this_quarter';
  const def = REPORTS.find((r) => r.id === id) ?? REPORTS[0];
  const custom = { from: params.get('desde') || null, to: params.get('hasta') || null };
  const { from, to } = def.periodBased ? (preset === 'custom' ? custom : resolvePeriod(preset, ctx.today)) : { from: null, to: null };
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setParams(n, { replace: true }); };
  const built = build(def.id, ctx.db, ctx.company.id, ctx.today, from, to);
  const generated = nowISO();
  // The export record keeps its filter description in Spanish (record language); the screen shows it translated.
  const periodTextEs = def.periodBased ? `${from ? formatDate(from) : 'inicio'} – ${to ? formatDate(to) : 'hoy'}` : `Situación a ${formatDate(ctx.today)}`;
  const periodText = def.periodBased
    ? `${from ? formatDate(from) : t('inicio')} – ${to ? formatDate(to) : t('hoy')}`
    : t('Situación a {date}', { date: formatDate(ctx.today) });

  return (
    <>
      <PageHeader title={t('Informes')} subtitle={t('Informes operativos calculados a partir de los registros. No son declaraciones tributarias ni libros registro oficiales.')} />
      <div className="grid-main-side" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
        <Card title={t('Informes')} flush>
          <ul style={{ listStyle: 'none', margin: 0, padding: 6 }}>
            {REPORTS.map((r) => (
              <li key={r.id}><button className="list-btn" aria-current={r.id === def.id} onClick={() => set({ informe: r.id })}><span><strong>{t(r.title)}</strong><div className="tiny muted">{t(r.description)}</div></span></button></li>
            ))}
          </ul>
        </Card>
        <Card
          title={t(def.title)}
          actions={
            <>
              {def.periodBased && (
                <>
                  <select aria-label={t('Periodo')} className="select" style={{ width: 170 }} value={preset} onChange={(e) => set({ periodo: e.target.value })}>
                    {Object.entries(PERIOD_LABELS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
                  </select>
                  {preset === 'custom' && (
                    <>
                      <input aria-label={t('Desde')} type="date" className="input" style={{ width: 150 }} value={custom.from ?? ''} onChange={(e) => set({ desde: e.target.value })} />
                      <input aria-label={t('Hasta')} type="date" className="input" style={{ width: 150 }} value={custom.to ?? ''} onChange={(e) => set({ hasta: e.target.value })} />
                    </>
                  )}
                </>
              )}
              <ExportButton kind={`report.${def.id}`} baseName={`informe_${def.id}`} rows={built.rows} columns={built.columns} filters={`${def.title} · ${periodTextEs}`} periodFrom={from} periodTo={to} totalCents={built.total ?? null} />
            </>
          }
          flush
        >
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }} className="small">
            <strong>{ctx.company.legalName}</strong> ({ctx.company.nif}) · {t('Periodo: {period} · Generado: {at} por {user} · Alcance: registros de la empresa activa visibles para su rol; datos de demostración.', { period: periodText, at: formatDateTime(generated), user: ctx.user.name })}
          </div>
          {built.rows.length === 0 ? <EmptyState icon={FileBarChart} title={t('Sin datos para este informe y periodo')} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>{built.columns.map((c) => <th key={c.key} className={c.money ? 'num' : ''}>{t(c.label)}</th>)}</tr></thead>
                <tbody>
                  {built.rows.map((r, i) => (
                    <tr key={i}>{built.columns.map((c) => { const v = c.value(r); return <td key={c.key} className={c.money ? 'num' : ''}>{c.money && typeof v === 'number' ? formatEUR(v) : typeof v === 'string' && LABEL_COLUMNS.has(c.key) ? t(v) : v ?? ''}</td>; })}</tr>
                  ))}
                </tbody>
                {built.total !== undefined && (
                  <tfoot><tr><td colSpan={Math.max(1, built.columns.length - 1)}>{built.rows.length === 1 ? t('{n} fila · total', { n: 1 }) : t('{n} filas · total', { n: built.rows.length })}</td><td className="num">{formatEUR(built.total)}</td></tr></tfoot>
                )}
              </table>
            </div>
          )}
          {def.id === 'fiscal' && <div style={{ padding: 12 }}><Callout tone="warning">{t('Resultados del proveedor SIMULADO. No son respuestas de la AEAT.')}</Callout></div>}
        </Card>
      </div>
    </>
  );
}
