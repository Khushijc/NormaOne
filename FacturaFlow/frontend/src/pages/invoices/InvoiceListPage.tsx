import { FileText, Plus, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExportButton } from '../../components/ExportButton';
import { InvoiceStatusStack } from '../../components/invoiceBits';
import { Button, Card, DateText, EmptyState, Money, PageHeader, Pagination, SortHeader, sortRows, usePaged, useSort } from '../../components/ui';
import { inRange } from '../../domain/dates';
import { COLLECTION_STATUS, DOCUMENT_STATUS, EXCHANGE_STATUS, FISCAL_STATUS } from '../../domain/status';
import type { Invoice } from '../../domain/types';
import { invoiceColumns } from '../../services/exportColumns';
import { t, tKey } from '../../i18n';
import { useCtx } from '../../store/hooks';
import { collectionStatus, invoicePeriodDate, isOverdue, outstandingCents } from '../../store/selectors';

/** Filter names. Kept in Spanish for the export metadata; translated with t() on screen. */
const FILTER_LABELS: Record<string, string> = {
  q: tKey('Texto'),
  doc: tKey('Documento'),
  fiscal: tKey('Fiscal'),
  exchange: tKey('Envío'),
  collection: tKey('Cobro'),
  overdue: tKey('Vencidas'),
  from: tKey('Desde'),
  to: tKey('Hasta'),
  customer: tKey('Cliente'),
  kind: tKey('Tipo'),
  review: tKey('Revisión'),
};

const same = (s: string) => s;

export function InvoiceListPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const { sort, onSort } = useSort('date');
  const db = ctx.db;

  const filtered = useMemo(() => {
    const q = get('q').toLowerCase();
    return db.invoices.filter((i) => {
      if (i.companyId !== ctx.company.id) return false;
      if (!ctx.can('invoices.view_drafts') && (i.documentStatus === 'draft' || i.documentStatus === 'approved')) return false;
      if (get('doc') && i.documentStatus !== get('doc')) return false;
      if (get('fiscal') && i.fiscalStatus !== get('fiscal')) return false;
      if (get('exchange') && i.exchangeStatus !== get('exchange')) return false;
      if (get('collection') && collectionStatus(db, i) !== get('collection')) return false;
      if (get('overdue') && !isOverdue(db, i, ctx.today)) return false;
      if (get('kind') && i.kind !== get('kind')) return false;
      if (get('review') && i.review.state !== get('review')) return false;
      if (get('customer') && i.customerId !== get('customer')) return false;
      if ((get('from') || get('to')) && !inRange(invoicePeriodDate(i), get('from') || null, get('to') || null)) return false;
      if (q) {
        const c = db.customers.find((x) => x.id === i.customerId);
        const hay = `${i.number ?? ''} ${c?.legalName ?? ''} ${c?.idNumber ?? ''} ${i.lines.map((l) => l.description).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, params, ctx.company.id]);

  const sorted = sortRows(filtered, sort, (i, col) => {
    switch (col) {
      case 'number': return i.number ?? 'zzz';
      case 'customer': return db.customers.find((c) => c.id === i.customerId)?.legalName ?? '';
      case 'date': return invoicePeriodDate(i);
      case 'due': return i.dueDate;
      case 'total': return i.totals.totalCents;
      case 'outstanding': return outstandingCents(db, i);
      default: return null;
    }
  });
  const paged = usePaged(sorted);
  const active = Array.from(params.entries()).filter(([k, v]) => v && FILTER_LABELS[k]);
  const totalSel = filtered.reduce((s, i) => s + i.totals.totalCents, 0);
  const pendingSel = filtered.reduce((s, i) => s + outstandingCents(db, i), 0);
  /** Filter value as text: Spanish for the export metadata, or translated with `tr = t` for the chips. */
  const chipValue = (k: string, v: string, tr: (s: string) => string = same) => {
    const label = (meta: { label: string } | undefined) => (meta ? tr(meta.label) : v);
    if (k === 'doc') return label(DOCUMENT_STATUS[v as Invoice['documentStatus']]);
    if (k === 'fiscal') return label(FISCAL_STATUS[v as Invoice['fiscalStatus']]);
    if (k === 'exchange') return label(EXCHANGE_STATUS[v as Invoice['exchangeStatus']]);
    if (k === 'collection') return label(COLLECTION_STATUS[v as keyof typeof COLLECTION_STATUS]);
    if (k === 'customer') return db.customers.find((c) => c.id === v)?.legalName ?? v;
    if (k === 'overdue') return tr(tKey('Sí'));
    if (k === 'kind') return tr(v === 'rectifying' ? tKey('Rectificativas') : tKey('Ordinarias'));
    if (k === 'review') return v === 'requested' ? tr(tKey('Pendiente de aprobación')) : v;
    if (k === 'from' || k === 'to') return v.split('-').reverse().join('/');
    return v;
  };

  return (
    <>
      <PageHeader
        title={t('Facturas emitidas')}
        subtitle={t('Facturas de venta y rectificativas. Documento, registro fiscal, envío y cobro se siguen como estados independientes.')}
        actions={
          <>
            <ExportButton kind="invoices.list" baseName="facturas" rows={sorted} columns={invoiceColumns(db)} filters={active.map(([k, v]) => `${FILTER_LABELS[k]}: ${chipValue(k, v)}`).join(', ')} periodFrom={get('from') || null} periodTo={get('to') || null} totalCents={totalSel} />
            {ctx.can('invoices.edit_draft') && (
              <Button variant="primary" icon={Plus} onClick={() => navigate('/facturas/nueva')}>
                {t('Nueva factura')}
              </Button>
            )}
          </>
        }
      />
      <Card flush>
        <div className="toolbar" role="search" aria-label={t('Filtros de facturas')}>
          <div className="field search">
            <label htmlFor="inv-q">{t('Buscar')}</label>
            <input id="inv-q" className="input" placeholder={t('Número, cliente, NIF o concepto')} value={get('q')} onChange={(e) => set('q', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-doc">{t('Documento')}</label>
            <select id="inv-doc" className="select" value={get('doc')} onChange={(e) => set('doc', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {Object.entries(DOCUMENT_STATUS).map(([k, m]) => (ctx.can('invoices.view_drafts') || k === 'issued' || k === 'rectified') && <option key={k} value={k}>{t(m.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inv-fiscal">{t('Fiscal')}</label>
            <select id="inv-fiscal" className="select" value={get('fiscal')} onChange={(e) => set('fiscal', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {Object.entries(FISCAL_STATUS).map(([k, m]) => <option key={k} value={k}>{t(m.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inv-exch">{t('Envío')}</label>
            <select id="inv-exch" className="select" value={get('exchange')} onChange={(e) => set('exchange', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {Object.entries(EXCHANGE_STATUS).map(([k, m]) => <option key={k} value={k}>{t(m.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inv-col">{t('Cobro')}</label>
            <select id="inv-col" className="select" value={get('collection')} onChange={(e) => set('collection', e.target.value)}>
              <option value="">{t('Todos')}</option>
              {Object.entries(COLLECTION_STATUS).map(([k, m]) => <option key={k} value={k}>{t(m.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inv-from">{t('Desde')}</label>
            <input id="inv-from" type="date" className="input" value={get('from')} onChange={(e) => set('from', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-to">{t('Hasta')}</label>
            <input id="inv-to" type="date" className="input" value={get('to')} onChange={(e) => set('to', e.target.value)} />
          </div>
          <label className="checkbox" style={{ alignSelf: 'center', marginTop: 18 }}>
            <input type="checkbox" checked={!!get('overdue')} onChange={(e) => set('overdue', e.target.checked ? '1' : '')} /> {t('Solo vencidas')}
          </label>
        </div>
        {active.length > 0 && (
          <div className="filter-chips" aria-label={t('Filtros activos')}>
            {active.map(([k, v]) => (
              <span key={k} className="chip">
                {t(FILTER_LABELS[k])}: {chipValue(k, v, t)}
                <button aria-label={t('Quitar filtro {name}', { name: t(FILTER_LABELS[k]) })} onClick={() => set(k, '')}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <button className="btn ghost sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>{t('Limpiar filtros')}</button>
          </div>
        )}
        {sorted.length === 0 ? (
          <EmptyState icon={FileText} title={active.length ? t('Ninguna factura coincide con los filtros') : t('Todavía no hay facturas')} action={ctx.can('invoices.edit_draft') && !active.length ? <Link className="btn primary" to="/facturas/nueva">{t('Crear la primera factura')}</Link> : undefined}>
            {active.length ? t('Modifique o limpie los filtros.') : t('Cree un borrador, solicite su aprobación y emítalo a través del proveedor fiscal simulado.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label={t('Número')} col="number" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Cliente')} col="customer" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Fecha')} col="date" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Vencimiento')} col="due" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Total')} col="total" sort={sort} onSort={onSort} num />
                    <SortHeader label={t('Pendiente [importe]')} col="outstanding" sort={sort} onSort={onSort} num />
                    <th>{t('Estados')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((i) => {
                    const c = db.customers.find((x) => x.id === i.customerId);
                    return (
                      <tr key={i.id} className="clickable" onClick={() => navigate(`/facturas/${i.id}`)}>
                        <td>
                          <Link to={`/facturas/${i.id}`} onClick={(e) => e.stopPropagation()} className="strong">
                            {i.number ?? (i.kind === 'rectifying' ? t('Rectificativa (borrador)') : t('Borrador'))}
                          </Link>
                          {i.kind === 'rectifying' && <div className="sub">{t('Rectifica {n}', { n: db.invoices.find((o) => o.id === i.rectification?.originalInvoiceId)?.number ?? '' })}</div>}
                        </td>
                        <td>
                          {c?.legalName}
                          <div className="sub">{c?.idNumber}</div>
                        </td>
                        <td><DateText date={invoicePeriodDate(i)} />{!i.issueDate && <div className="sub">{t('creación')}</div>}</td>
                        <td><DateText date={i.dueDate} /></td>
                        <td className="num"><Money cents={i.totals.totalCents} /></td>
                        <td className="num">{collectionStatus(db, i) ? <Money cents={outstandingCents(db, i)} /> : <span className="muted">—</span>}</td>
                        <td><InvoiceStatusStack db={db} inv={i} today={ctx.today} compact /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>{filtered.length === 1 ? t('{n} factura en la selección', { n: 1 }) : t('{n} facturas en la selección', { n: filtered.length })}</td>
                    <td className="num"><Money cents={totalSel} /></td>
                    <td className="num"><Money cents={pendingSel} /></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>
      {!ctx.can('invoices.view_drafts') && <p className="small muted" style={{ marginTop: 8 }}>{t('Su rol solo ve facturas emitidas; los borradores internos no se comparten con la gestoría.')}</p>}
    </>
  );
}
