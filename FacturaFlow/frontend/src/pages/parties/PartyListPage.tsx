import { Plus, Truck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExportButton } from '../../components/ExportButton';
import { Badge, Button, Card, EmptyState, Money, PageHeader, Pagination, SortHeader, sortRows, usePaged, useSort } from '../../components/ui';
import type { Customer, Supplier } from '../../domain/types';
import { t } from '../../i18n';
import { EXPENSE_CATEGORIES } from '../../services/expenseService';
import { useCtx } from '../../store/hooks';
import { isCollectible, outstandingCents } from '../../store/selectors';
import { PARTY_KIND_LABEL, PartyFormModal } from './PartyFormModal';

type Kind = 'customer' | 'supplier';

export function PartyListPage({ kind }: { kind: Kind }) {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [typeFilter, setTypeFilter] = useState('');
  const [params, setParams] = useSearchParams();
  const [creating, setCreatingState] = useState(params.get('nuevo') === '1');
  const setCreating = (v: boolean) => {
    setCreatingState(v);
    if (!v && params.get('nuevo')) setParams({}, { replace: true });
  };
  const { sort, onSort } = useSort('name', 'asc');
  const isCustomer = kind === 'customer';
  const base = isCustomer ? '/clientes' : '/proveedores';
  const manage = ctx.can(isCustomer ? 'customers.manage' : 'suppliers.manage');

  const all: (Customer | Supplier)[] = (isCustomer ? db.customers : db.suppliers).filter((p) => p.companyId === ctx.company.id);
  const balance = (p: Customer | Supplier) =>
    isCustomer
      ? db.invoices.filter((i) => i.customerId === p.id && isCollectible(i)).reduce((s, i) => s + outstandingCents(db, i), 0)
      : db.expenses.filter((e) => e.supplierId === p.id && e.reviewStatus === 'approved' && e.paymentStatus === 'unpaid').reduce((s, e) => s + e.totalCents, 0);
  const docs = (p: Customer | Supplier) => (isCustomer ? db.invoices.filter((i) => i.customerId === p.id && i.number).length : db.expenses.filter((e) => e.supplierId === p.id).length);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((p) => {
      if (status === 'active' && p.archived) return false;
      if (status === 'archived' && !p.archived) return false;
      if (typeFilter && p.kind !== typeFilter) return false;
      if (s && !`${p.legalName} ${p.tradeName} ${p.idNumber} ${p.email} ${p.address.city}`.toLowerCase().includes(s)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, q, status, typeFilter, kind, ctx.company.id]);
  const sorted = sortRows(rows, sort, (p, c) => (c === 'name' ? p.legalName : c === 'id' ? p.idNumber : c === 'city' ? p.address.city : c === 'balance' ? balance(p) : c === 'docs' ? docs(p) : null));
  const paged = usePaged(sorted);

  return (
    <>
      <PageHeader
        title={isCustomer ? t('Clientes') : t('Proveedores')}
        subtitle={isCustomer ? t('Destinatarios de las facturas. Los clientes con facturas no se eliminan: se archivan.') : t('Emisores de facturas recibidas y gastos. Los proveedores con documentos no se eliminan: se archivan.')}
        actions={
          <>
            <ExportButton
              kind={`${kind}s.list`}
              baseName={isCustomer ? 'clientes' : 'proveedores'}
              rows={sorted}
              filters={`Estado: ${status}${q ? `, texto: ${q}` : ''}`}
              columns={[
                { key: 'id', label: 'ID', value: (p) => p.id },
                { key: 'razon_social', label: 'Razón social', value: (p) => p.legalName },
                { key: 'tipo', label: 'Tipo', value: (p) => PARTY_KIND_LABEL[p.kind] },
                { key: 'nif', label: 'Identificación', value: (p) => p.idNumber },
                { key: 'domicilio', label: 'Domicilio', value: (p) => `${p.address.street}, ${p.address.postalCode} ${p.address.city}` },
                { key: 'email', label: 'Correo', value: (p) => p.email },
                { key: 'saldo', label: isCustomer ? 'Pendiente de cobro' : 'Pendiente de pago', value: (p) => balance(p), money: true },
                { key: 'archivado', label: 'Archivado', value: (p) => (p.archived ? 'Sí' : 'No') },
              ]}
            />
            {manage && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{isCustomer ? t('Nuevo cliente') : t('Nuevo proveedor')}</Button>}
          </>
        }
      />
      <Card flush>
        <div className="toolbar">
          <div className="field search">
            <label htmlFor="p-q">{t('Buscar')}</label>
            <input id="p-q" className="input" placeholder={t('Nombre, NIF, correo o población')} value={q} onChange={(e) => { setQ(e.target.value); paged.reset(); }} />
          </div>
          <div className="field">
            <label htmlFor="p-t">{t('Tipo')}</label>
            <select id="p-t" className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">{t('Todos')}</option>
              {Object.entries(PARTY_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="label">{t('Estado')}</span>
            <div className="segmented" role="group" aria-label={t('Estado')}>
              {(['active', 'archived', 'all'] as const).map((s) => (
                <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {s === 'active' ? t('Activos') : s === 'archived' ? t('Archivados') : t('Todos')}
                </button>
              ))}
            </div>
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={isCustomer ? Users : Truck} title={t('No hay registros que mostrar')} action={manage ? <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{t('Crear')}</Button> : undefined}>
            {q || typeFilter || status !== 'active' ? t('Pruebe con otros filtros.') : t('Añada el primer registro.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label={t('Nombre')} col="name" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Identificación')} col="id" sort={sort} onSort={onSort} />
                    <SortHeader label={t('Población')} col="city" sort={sort} onSort={onSort} />
                    <th>{isCustomer ? t('Plazo') : t('Categoría')}</th>
                    <SortHeader label={isCustomer ? t('Facturas') : t('Documentos')} col="docs" sort={sort} onSort={onSort} num />
                    <SortHeader label={isCustomer ? t('Pendiente de cobro') : t('Pendiente de pago')} col="balance" sort={sort} onSort={onSort} num />
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`${base}/${p.id}`)}>
                      <td>
                        <Link to={`${base}/${p.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{p.legalName}</Link>
                        <div className="sub">{t(PARTY_KIND_LABEL[p.kind])}{p.archived && <> · <Badge tone="neutral">{t('Archivado')}</Badge></>}</div>
                      </td>
                      <td className="mono">{p.idNumber || '—'}</td>
                      <td>{p.address.city}</td>
                      <td>{isCustomer ? `${(p as Customer).paymentTermsDays} ${t('días')}` : t(EXPENSE_CATEGORIES[(p as Supplier).defaultCategory])}</td>
                      <td className="num">{docs(p)}</td>
                      <td className="num"><Money cents={balance(p)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...paged.props} />
          </>
        )}
      </Card>
      {creating && <PartyFormModal kind={kind} onClose={() => setCreating(false)} onSaved={(p) => navigate(`${base}/${p.id}`)} />}
    </>
  );
}
