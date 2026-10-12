import { Archive, ArchiveRestore, FilePlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { RecordNotFound } from '../../components/guards';
import { InvoiceStatusStack } from '../../components/invoiceBits';
import { Badge, Button, Card, ConfirmDialog, DateText, DateTimeText, EmptyState, KV, Money, PageHeader, StatusBadge, Tabs, useAction } from '../../components/ui';
import { EXPENSE_PAYMENT_STATUS, EXPENSE_REVIEW_STATUS } from '../../domain/status';
import type { Customer, Supplier } from '../../domain/types';
import { t } from '../../i18n';
import { PAYMENT_METHOD_LABEL } from '../../services/collectionService';
import { EXPENSE_CATEGORIES } from '../../services/expenseService';
import { setPartyArchived } from '../../services/partyService';
import { useCtx } from '../../store/hooks';
import { collectibleCents, isCollectible, isOverdue, outstandingCents, paidCents, userName } from '../../store/selectors';
import { ID_TYPE_LABEL, PARTY_KIND_LABEL, PartyFormModal } from './PartyFormModal';

type Kind = 'customer' | 'supplier';

export function PartyDetailPage({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const { runOk } = useAction();
  const isCustomer = kind === 'customer';
  const base = isCustomer ? '/clientes' : '/proveedores';
  const party: Customer | Supplier | undefined = (isCustomer ? db.customers : db.suppliers).find((p) => p.id === id && p.companyId === ctx.company.id);
  const [tab, setTab] = useState<'docs' | 'payments' | 'history'>('docs');
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  if (!party) return <RecordNotFound back={base} label={isCustomer ? t('clientes') : t('proveedores')} />;
  const manage = ctx.can(isCustomer ? 'customers.manage' : 'suppliers.manage');

  const invoices = db.invoices.filter((i) => i.customerId === party.id && (ctx.can('invoices.view_drafts') || i.number)).sort((a, b) => ((a.issueDate ?? a.createdAt) < (b.issueDate ?? b.createdAt) ? 1 : -1));
  const expenses = db.expenses.filter((e) => e.supplierId === party.id).sort((a, b) => (a.documentDate < b.documentDate ? 1 : -1));
  const payments = db.payments.filter((p) => invoices.some((i) => i.id === p.invoiceId)).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  const collectible = invoices.filter(isCollectible);
  const invoiced = collectible.reduce((s, i) => s + collectibleCents(db, i), 0);
  const outstanding = collectible.reduce((s, i) => s + outstandingCents(db, i), 0);
  const overdue = collectible.filter((i) => isOverdue(db, i, ctx.today)).reduce((s, i) => s + outstandingCents(db, i), 0);
  const spent = expenses.filter((e) => e.reviewStatus === 'approved').reduce((s, e) => s + e.totalCents, 0);
  const unpaid = expenses.filter((e) => e.reviewStatus === 'approved' && e.paymentStatus === 'unpaid').reduce((s, e) => s + e.totalCents, 0);
  const taxCodeLabel = isCustomer ? db.taxCodes.find((tc) => tc.code === (party as Customer).defaultTaxCode)?.label : undefined;

  return (
    <>
      <PageHeader
        breadcrumbs={<><Link to={base}>{isCustomer ? t('Clientes') : t('Proveedores')}</Link> / {party.legalName}</>}
        title={party.legalName}
        subtitle={<>{t(PARTY_KIND_LABEL[party.kind])} · <span className="mono">{party.idNumber || t('sin identificación')}</span> {party.archived && <Badge tone="neutral">{t('Archivado')}</Badge>}</>}
        actions={
          manage && (
            <>
              {isCustomer && !party.archived && ctx.can('invoices.edit_draft') && <Button icon={FilePlus} onClick={() => navigate('/facturas/nueva')}>{t('Nueva factura')}</Button>}
              <Button icon={Pencil} onClick={() => setEditing(true)}>{t('Editar')}</Button>
              <Button icon={party.archived ? ArchiveRestore : Archive} onClick={() => setArchiving(true)}>{party.archived ? t('Reactivar') : t('Archivar')}</Button>
            </>
          )
        }
      />
      <div className="kpis" style={{ marginBottom: 16 }}>
        {isCustomer ? (
          <>
            <div className="kpi" style={{ cursor: 'default' }}><span className="label">{t('Facturado (neto)')}</span><span className="value"><Money cents={invoiced} /></span><span className="meta">{t('{n} facturas emitidas', { n: collectible.length })}</span></div>
            <div className="kpi" style={{ cursor: 'default' }}><span className="label">{t('Pendiente de cobro')}</span><span className="value"><Money cents={outstanding} /></span></div>
            <div className={`kpi ${overdue ? 'tone-danger' : ''}`} style={{ cursor: 'default' }}><span className="label">{t('Vencido')}</span><span className="value"><Money cents={overdue} /></span></div>
          </>
        ) : (
          <>
            <div className="kpi" style={{ cursor: 'default' }}><span className="label">{t('Gasto aprobado')}</span><span className="value"><Money cents={spent} /></span><span className="meta">{t('{n} documentos', { n: expenses.length })}</span></div>
            <div className="kpi" style={{ cursor: 'default' }}><span className="label">{t('Aprobado pendiente de pago')}</span><span className="value"><Money cents={unpaid} /></span></div>
          </>
        )}
      </div>
      <div className="grid-main-side">
        <div>
          <Tabs
            label={t('Secciones')}
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'docs', label: isCustomer ? t('Facturas') : t('Documentos y gastos'), count: isCustomer ? invoices.length : expenses.length },
              { id: 'payments', label: t('Cobros'), count: payments.length, hidden: !isCustomer },
              { id: 'history', label: t('Historial de cambios') },
            ]}
          />
          {tab === 'docs' && isCustomer && (
            <Card flush>
              {invoices.length === 0 ? <EmptyState title={t('Sin facturas')} /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{t('Número')}</th><th>{t('Fecha')}</th><th>{t('Vencimiento')}</th><th className="num">{t('Total')}</th><th className="num">{t('Pendiente [importe]')}</th><th>{t('Estados')}</th></tr></thead>
                    <tbody>
                      {invoices.map((i) => (
                        <tr key={i.id} className="clickable" onClick={() => navigate(`/facturas/${i.id}`)}>
                          <td><Link to={`/facturas/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number ?? t('Borrador')}</Link></td>
                          <td><DateText date={i.issueDate} /></td>
                          <td><DateText date={i.dueDate} /></td>
                          <td className="num"><Money cents={i.totals.totalCents} /></td>
                          <td className="num">{isCollectible(i) ? <Money cents={outstandingCents(db, i)} /> : '—'}</td>
                          <td><InvoiceStatusStack db={db} inv={i} today={ctx.today} compact /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {tab === 'docs' && !isCustomer && (
            <Card flush>
              {expenses.length === 0 ? <EmptyState title={t('Sin documentos registrados')} /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{t('Documento')}</th><th>{t('Fecha')}</th><th>{t('Categoría')}</th><th className="num">{t('Total')}</th><th>{t('Revisión')}</th><th>{t('Pago')}</th></tr></thead>
                    <tbody>
                      {expenses.map((e) => (
                        <tr key={e.id} className="clickable" onClick={() => navigate(`/gastos/${e.id}`)}>
                          <td><Link to={`/gastos/${e.id}`} onClick={(ev) => ev.stopPropagation()}>{e.documentNumber || '—'}</Link><div className="sub">{e.description}</div></td>
                          <td><DateText date={e.documentDate} /></td>
                          <td>{t(EXPENSE_CATEGORIES[e.category] ?? e.category)}</td>
                          <td className="num"><Money cents={e.totalCents} /></td>
                          <td><StatusBadge meta={EXPENSE_REVIEW_STATUS[e.reviewStatus]} /></td>
                          <td><StatusBadge meta={EXPENSE_PAYMENT_STATUS[e.paymentStatus]} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {tab === 'payments' && (
            <Card flush>
              {payments.length === 0 ? <EmptyState title={t('Sin cobros registrados')} /> : (
                <table className="table">
                  <thead><tr><th>{t('Fecha')}</th><th>{t('Factura')}</th><th>{t('Método')}</th><th>{t('Referencia')}</th><th className="num">{t('Importe')}</th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td><DateText date={p.date} /></td>
                        <td><Link to={`/facturas/${p.invoiceId}?tab=cobros`}>{db.invoices.find((i) => i.id === p.invoiceId)?.number}</Link></td>
                        <td>{t(PAYMENT_METHOD_LABEL[p.method])}{p.kind === 'reversal' && <> · <Badge tone="danger">{t('Anulación')}</Badge></>}</td>
                        <td className="mono">{p.reference}</td>
                        <td className="num"><Money cents={p.kind === 'payment' ? p.amountCents : -p.amountCents} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>{t('Total cobrado neto')}</td><td className="num"><Money cents={invoices.reduce((s, i) => s + paidCents(db, i.id), 0)} /></td></tr></tfoot>
                </table>
              )}
            </Card>
          )}
          {tab === 'history' && (
            <Card>
              <AuditList events={db.audit.filter((e) => e.entityId === party.id && e.companyId === ctx.company.id)} />
            </Card>
          )}
        </div>
        <Card title={t('Ficha')}>
          <KV
            items={[
              [t('Identificación'), <>{t(ID_TYPE_LABEL[party.idType])}: <span className="mono">{party.idNumber || '—'}</span></>],
              [t('Nombre comercial'), party.tradeName || '—'],
              [t('Domicilio'), <>{party.address.street}<br />{party.address.postalCode} {party.address.city} ({party.address.province}) · {party.address.country}</>],
              [t('Correo'), party.email || '—'],
              [t('Teléfono'), party.phone || '—'],
              [t('Contacto'), party.contactName || '—'],
              [t('Plazo de pago'), `${(party as Customer | Supplier).paymentTermsDays} ${t('días')}`],
              ...(isCustomer
                ? ([[t('Canal de envío'), (party as Customer).deliveryChannel === 'email' ? t('Correo (simulado)') : t('Manual')], [t('Tratamiento por defecto'), taxCodeLabel ? t(taxCodeLabel) : undefined]] as [string, string | undefined][])
                : ([[t('Categoría'), t(EXPENSE_CATEGORIES[(party as Supplier).defaultCategory] ?? (party as Supplier).defaultCategory)], ['IBAN', (party as Supplier).ibanMasked || '—']] as [string, string][])),
              [t('Notas'), party.notes || '—'],
              [t('Alta del registro'), <>{userName(db, party.createdBy)} · <DateTimeText at={party.createdAt} /></>],
              ...(party.archived ? ([[t('Archivado'), <>{party.archivedReason} · <DateTimeText at={party.archivedAt} /></>]] as [string, React.ReactNode][]) : []),
            ]}
          />
        </Card>
      </div>
      {editing && <PartyFormModal kind={kind} existing={party} onClose={() => setEditing(false)} />}
      {archiving && (
        <ConfirmDialog
          title={party.archived ? t('Reactivar registro') : t('Archivar registro')}
          message={party.archived ? t('Volverá a estar disponible para nuevos documentos.') : t('No podrá seleccionarse en nuevos documentos. Sus facturas, gastos y cobros se conservan y siguen consultables. No se elimina ningún dato.')}
          confirmLabel={party.archived ? t('Reactivar') : t('Archivar')}
          requireReason={!party.archived}
          onConfirm={(reason) => runOk(() => setPartyArchived(kind, party.id, !party.archived, reason), party.archived ? t('Registro reactivado') : t('Registro archivado'))}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  );
}
