import { FilePlus2, Paperclip, Plus, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExportButton } from '../../components/ExportButton';
import { Badge, Button, Card, DateText, EmptyState, Money, PageHeader, Pagination, SortHeader, StatusBadge, Tabs, sortRows, usePaged, useSort } from '../../components/ui';
import { formatPeriod } from '../../domain/dates';
import { EXPENSE_PAYMENT_STATUS, EXPENSE_REVIEW_STATUS } from '../../domain/status';
import type { ExpenseRecord } from '../../domain/types';
import { expenseColumns } from '../../services/exportColumns';
import { canReviewExpense, canViewExpense, DOCUMENT_TYPE_LABEL, duplicatesFor, EXPENSE_CATEGORIES } from '../../services/expenseService';
import { t } from '../../i18n';
import { useCtx } from '../../store/hooks';
import { userName } from '../../store/selectors';

type View = 'all' | 'supplier' | 'employee' | 'mine' | 'review';

export function ExpensesPage() {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canAll = ctx.can('expenses.view_all');
  const canReview = ctx.can('expenses.review_all') || ctx.can('expenses.review_team');
  const view = (params.get('vista') as View) || (canAll ? 'all' : 'mine');
  const setView = (v: View) => { const n = new URLSearchParams(params); n.set('vista', v); setParams(n, { replace: true }); };
  const [q, setQ] = useState(params.get('q') ?? '');
  const review = params.get('revision') ?? '';
  const payment = params.get('pago') ?? '';
  const [category, setCategory] = useState('');
  const [period, setPeriod] = useState('');
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const { sort, onSort } = useSort('date');

  const visible = db.expenses.filter((e) => canViewExpense(ctx, e));
  const periods = Array.from(new Set(visible.map((e) => e.accountingPeriod))).sort().reverse();
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return visible.filter((e) => {
      if (view === 'supplier' && e.kind !== 'supplier_invoice') return false;
      if (view === 'employee' && e.kind !== 'employee_expense') return false;
      if (view === 'mine' && e.submittedBy !== ctx.user.id) return false;
      if (view === 'review' && !canReviewExpense(ctx, e).ok) return false;
      if (review && e.reviewStatus !== review) return false;
      if (payment && e.paymentStatus !== payment) return false;
      if (category && e.category !== category) return false;
      if (period && e.accountingPeriod !== period) return false;
      if (s) {
        const sup = db.suppliers.find((x) => x.id === e.supplierId);
        if (!`${e.documentNumber} ${e.description} ${e.merchantName} ${sup?.legalName ?? ''} ${userName(db, e.submittedBy)}`.toLowerCase().includes(s)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, view, q, review, payment, category, period, ctx.user.id, ctx.company.id]);
  const sorted = sortRows(rows, sort, (e, c) => (c === 'date' ? e.documentDate : c === 'total' ? e.totalCents : c === 'party' ? db.suppliers.find((s) => s.id === e.supplierId)?.legalName ?? e.merchantName : c === 'by' ? userName(db, e.submittedBy) : null));
  const paged = usePaged(sorted);
  const reviewCount = visible.filter((e) => canReviewExpense(ctx, e).ok).length;
  const total = rows.reduce((s, e) => s + e.totalCents, 0);

  return (
    <>
      <PageHeader
        title={t('Gastos y facturas recibidas')}
        subtitle={t('Facturas de proveedores y gastos de empleados con su justificante. Aprobar un gasto no determina su tratamiento fiscal: lo valida la gestoría.')}
        actions={
          <>
            <ExportButton kind="expenses.list" baseName="gastos" rows={sorted} columns={expenseColumns(db)} filters={[view, review, payment, category, period, q].filter(Boolean).join(', ')} totalCents={total} />
            {ctx.can('expenses.manage_supplier') && <Button icon={FilePlus2} onClick={() => navigate('/gastos/nuevo?tipo=proveedor')}>{t('Registrar factura recibida')}</Button>}
            {ctx.can('expenses.submit_own') && <Button variant="primary" icon={Plus} onClick={() => navigate('/gastos/nuevo?tipo=empleado')}>{t('Nuevo gasto')}</Button>}
          </>
        }
      />
      <Tabs
        label={t('Vistas de gastos')}
        value={view}
        onChange={setView}
        tabs={[
          { id: 'all', label: t('Todos'), hidden: !canAll },
          { id: 'supplier', label: t('Facturas recibidas'), hidden: !canAll },
          { id: 'employee', label: t('Gastos de empleados'), hidden: !canAll && !canReview },
          { id: 'mine', label: t('Mis gastos'), hidden: !ctx.can('expenses.submit_own') },
          { id: 'review', label: t('Pendientes de mi revisión'), count: reviewCount, hidden: !canReview },
        ]}
      />
      <Card flush>
        <div className="toolbar">
          <div className="field search">
            <label htmlFor="e-q">{t('Buscar')}</label>
            <input id="e-q" className="input" placeholder={t('Número, proveedor, concepto o persona')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="e-r">{t('Revisión')}</label>
            <select id="e-r" className="select" value={review} onChange={(e) => setParam('revision', e.target.value)}>
              <option value="">{t('Todas')}</option>
              {Object.entries(EXPENSE_REVIEW_STATUS).map(([k, m]) => <option key={k} value={k}>{t(m.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-p">{t('Pago')}</label>
            <select id="e-p" className="select" value={payment} onChange={(e) => setParam('pago', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {Object.entries(EXPENSE_PAYMENT_STATUS).map(([k, m]) => <option key={k} value={k}>{t(m.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-c">{t('Categoría')}</label>
            <select id="e-c" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('Todas')}</option>
              {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-per">{t('Periodo contable')}</label>
            <select id="e-per" className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {periods.map((p) => <option key={p} value={p}>{formatPeriod(p)}</option>)}
            </select>
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={Receipt} title={view === 'review' ? t('No tiene gastos pendientes de revisión') : t('No hay gastos con estos filtros')} action={view === 'mine' && ctx.can('expenses.submit_own') ? <Link className="btn primary" to="/gastos/nuevo?tipo=empleado">{t('Registrar un gasto')}</Link> : undefined}>
            {view === 'mine' ? t('Registre un gasto, adjunte el ticket o factura y envíelo a revisión.') : undefined}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label={t('Fecha')} col="date" sort={sort} onSort={onSort} />
                    <th>{t('Documento')}</th>
                    <SortHeader label={t('Proveedor / establecimiento')} col="party" sort={sort} onSort={onSort} />
                    <th>{t('Categoría')}</th>
                    <SortHeader label={t('Presentado por')} col="by" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Total')} col="total" sort={sort} onSort={onSort} num />
                    <th>{t('Estados')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((e: ExpenseRecord) => {
                    const dup = e.reviewStatus !== 'approved' && duplicatesFor(e).length > 0;
                    return (
                      <tr key={e.id} className="clickable" onClick={() => navigate(`/gastos/${e.id}`)}>
                        <td><DateText date={e.documentDate} /><div className="sub">{formatPeriod(e.accountingPeriod)}</div></td>
                        <td>
                          <Link to={`/gastos/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="strong">{e.documentNumber || t('Sin número')}</Link>
                          <div className="sub">{e.kind === 'supplier_invoice' ? t('Factura recibida') : t('Gasto de empleado')} · {t(DOCUMENT_TYPE_LABEL[e.documentType])}</div>
                        </td>
                        <td>{db.suppliers.find((s) => s.id === e.supplierId)?.legalName ?? e.merchantName}<div className="sub">{e.description}</div></td>
                        <td>{t(EXPENSE_CATEGORIES[e.category] ?? e.category)}</td>
                        <td>{userName(db, e.submittedBy)}</td>
                        <td className="num"><Money cents={e.totalCents} /></td>
                        <td>
                          <div className="status-stack">
                            <StatusBadge meta={EXPENSE_REVIEW_STATUS[e.reviewStatus]} />
                            {e.reviewStatus === 'approved' && <StatusBadge meta={EXPENSE_PAYMENT_STATUS[e.paymentStatus]} />}
                            {e.attachmentIds.length === 0 && <Badge tone="warning" icon={Paperclip}>{t('Sin justificante')}</Badge>}
                            {dup && <Badge tone="danger">{t('Posible duplicado')}</Badge>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><td colSpan={5}>{t('{n} registros', { n: rows.length })}</td><td className="num"><Money cents={total} /></td><td /></tr></tfoot>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>
    </>
  );
}
