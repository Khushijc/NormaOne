import { CheckCircle2, FileText, Pencil, Send, Trash2, Upload, Wallet, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AuditList } from '../../components/AuditList';
import { RecordNotFound } from '../../components/guards';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, DateText, DateTimeText, KV, Modal, Money, PageHeader, StatusBadge, TextField, useAction, useToast } from '../../components/ui';
import { formatDate, formatPeriod } from '../../domain/dates';
import { formatEUR } from '../../domain/money';
import { EXPENSE_PAYMENT_STATUS, EXPENSE_REVIEW_STATUS } from '../../domain/status';
import type { Attachment, ExpenseRecord } from '../../domain/types';
import { validateExpense } from '../../domain/validation';
import { t } from '../../i18n';
import { addAttachment, canReviewExpense, canViewExpense, deleteExpenseDraft, DOCUMENT_TYPE_LABEL, duplicatesFor, EXPENSE_CATEGORIES, markExpensePaid, readLocalFile, reviewExpense, submitExpense } from '../../services/expenseService';
import { useCtx } from '../../store/hooks';
import { userName } from '../../store/selectors';

export function ExpenseDetailPage() {
  const { id } = useParams();
  const ctx = useCtx();
  const e = ctx.db.expenses.find((x) => x.id === id);
  if (!e || !canViewExpense(ctx, e)) return <RecordNotFound back="/gastos" label={t('gastos')} />;
  return <Detail e={e} />;
}

function Detail({ e }: { e: ExpenseRecord }) {
  const ctx = useCtx();
  const db = ctx.db;
  const navigate = useNavigate();
  const toast = useToast();
  const { runOk, pending } = useAction();
  const [dialog, setDialog] = useState<null | 'approve' | 'reject' | 'submit' | 'pay' | 'delete'>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const supplier = db.suppliers.find((s) => s.id === e.supplierId);
  const atts = db.attachments.filter((a) => a.ownerType === 'expense' && a.ownerId === e.id).sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
  const current = atts.filter((a) => e.attachmentIds.includes(a.id));
  const superseded = atts.filter((a) => !e.attachmentIds.includes(a.id));
  const review = canReviewExpense(ctx, e);
  const dups = duplicatesFor(e);
  const editable = (e.reviewStatus === 'draft' || e.reviewStatus === 'rejected') && (e.submittedBy === ctx.user.id || ctx.can('expenses.manage_supplier'));
  const warnings = validateExpense(e, ctx.today, false).warnings;

  const onFile = async (list: FileList | null) => {
    if (!list?.[0]) return;
    try {
      const lf = await readLocalFile(list[0]);
      await runOk(() => addAttachment(e.id, lf, replaceId), replaceId ? t('Nueva versión del justificante guardada; la anterior se conserva') : t('Justificante adjuntado'));
    } catch (err) {
      toast.error(err);
    } finally {
      setReplaceId(null);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={<><Link to="/gastos">{t('Gastos')}</Link> / {e.documentNumber || e.description}</>}
        title={`${e.kind === 'supplier_invoice' ? t('Factura recibida') : t('Gasto')} ${e.documentNumber || ''}`.trim()}
        subtitle={<>{supplier ? <Link to={`/proveedores/${supplier.id}`}>{supplier.legalName}</Link> : e.merchantName} · {e.description}</>}
        actions={
          <>
            {editable && <Button icon={Pencil} onClick={() => navigate(`/gastos/${e.id}/editar`)}>{t('Editar')}</Button>}
            {editable && <Button variant="primary" icon={Send} onClick={() => setDialog('submit')}>{t('Enviar a revisión')}</Button>}
            {e.reviewStatus === 'draft' && editable && <Button variant="danger-outline" icon={Trash2} onClick={() => setDialog('delete')}>{t('Eliminar borrador')}</Button>}
            {e.reviewStatus === 'submitted' && (ctx.can('expenses.review_all') || ctx.can('expenses.review_team')) && (
              <>
                <Button icon={XCircle} onClick={() => setDialog('reject')} disabled={!review.ok} title={review.ok ? undefined : t(review.reason)}>{t('Rechazar')}</Button>
                <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog('approve')} disabled={!review.ok} title={review.ok ? undefined : t(review.reason)}>{t('Aprobar')}</Button>
              </>
            )}
            {e.reviewStatus === 'approved' && e.paymentStatus === 'unpaid' && ctx.can('expenses.record_payment') && <Button icon={Wallet} onClick={() => setDialog('pay')}>{e.kind === 'employee_expense' ? t('Registrar reembolso') : t('Registrar pago')}</Button>}
          </>
        }
      />
      <div className="stack-lg">
        <div className="row-wrap">
          <StatusBadge meta={EXPENSE_REVIEW_STATUS[e.reviewStatus]} prefix={t('Revisión')} />
          {e.reviewStatus === 'approved' && <StatusBadge meta={EXPENSE_PAYMENT_STATUS[e.paymentStatus]} prefix={t('Pago')} />}
          <Badge tone="neutral" icon={false}>{e.kind === 'supplier_invoice' ? t('Factura de proveedor') : t('Gasto de empleado')}</Badge>
        </div>
        {e.reviewStatus === 'submitted' && !review.ok && (ctx.can('expenses.review_all') || ctx.can('expenses.review_team')) && <Callout tone="info">{t(review.reason)}</Callout>}
        {e.reviewStatus === 'rejected' && <Callout tone="danger" title={t('Rechazado por {name}', { name: userName(db, e.reviewedBy) })}>{e.reviewComment}</Callout>}
        {e.reviewStatus === 'approved' && <Callout tone="success" title={t('Aprobado por {name}', { name: userName(db, e.reviewedBy) })}>{e.reviewComment || t('Sin comentarios.')} {t('La aprobación interna no fija el tratamiento fiscal (deducibilidad): lo valida la gestoría.')}</Callout>}
        {dups.length > 0 && e.reviewStatus !== 'approved' && (
          <Callout tone="danger" title={t('Posible duplicado')}>
            <ul>{dups.map((d) => <li key={d.id}>{t(d.reason)} <Link to={`/gastos/${d.id}`}>{t('Ver')}</Link>{e.duplicateAcknowledged.includes(d.id) && <> — <em>{t('el remitente confirmó que no es duplicado')}</em></>}</li>)}</ul>
          </Callout>
        )}
        {warnings.length > 0 && <Callout tone="warning" title={t('Avisos')}><ul>{warnings.map((w, i) => <li key={i}>{t(w)}</li>)}</ul></Callout>}

        <div className="grid-main-side">
          <div className="stack">
            <Card title={t('Datos')}>
              <KV
                items={[
                  [t('Documento'), `${t(DOCUMENT_TYPE_LABEL[e.documentType])} ${e.documentNumber}`],
                  [t('Fecha'), <DateText date={e.documentDate} />],
                  [t('Periodo contable'), formatPeriod(e.accountingPeriod)],
                  [t('Categoría'), t(EXPENSE_CATEGORIES[e.category] ?? e.category)],
                  [t('Proveedor'), supplier ? <>{supplier.legalName} · <span className="mono">{supplier.idNumber}</span></> : t('{name} (no registrado)', { name: e.merchantName })],
                  [t('Base imponible'), <Money cents={e.baseCents} />],
                  [t('IVA soportado'), <><Money cents={e.vatCents} /> ({e.vatRatePct} %)</>],
                  ...(e.withholdingCents ? ([[t('Retención'), <Money cents={-e.withholdingCents} />]] as [string, React.ReactNode][]) : []),
                  [t('Total'), <strong><Money cents={e.totalCents} /></strong>],
                  ...(e.documentType === 'simplified_invoice' ? ([[t('NIF empresa en ticket'), e.recipientNifShown ? t('Sí') : t('No')]] as [string, string][]) : []),
                  ...(e.dueDate ? ([[t('Vencimiento'), <DateText date={e.dueDate} />]] as [string, React.ReactNode][]) : []),
                  [t('Presentado por'), <>{userName(db, e.submittedBy)}{e.submittedAt && <> · <DateTimeText at={e.submittedAt} /></>}</>],
                  [t('Pago'), e.paymentStatus === 'unpaid' ? t('Pendiente') : t('{status} el {date} · ref. {ref}', { status: t(EXPENSE_PAYMENT_STATUS[e.paymentStatus].label), date: formatDate(e.paidAt), ref: e.paymentReference })],
                  ...(e.extraction ? ([[t('Extracción'), t('Sugerencias simuladas ({fields}), revisadas por el usuario', { fields: e.extraction.fields.join(', ') })]] as [string, string][]) : []),
                ]}
              />
            </Card>
            <Card title={t('Historial')}>
              <AuditList events={db.audit.filter((a) => a.entityId === e.id && a.companyId === ctx.company.id)} />
            </Card>
          </div>
          <Card title={t('Justificantes')} actions={editable ? <Button size="sm" icon={Upload} onClick={() => { setReplaceId(null); fileRef.current?.click(); }}>{t('Adjuntar')}</Button> : undefined}>
            <input ref={fileRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(ev) => { onFile(ev.target.files); ev.target.value = ''; }} />
            {current.length === 0 && <Callout tone="warning">{t('Sin justificante. Es obligatorio para enviar a revisión.')}</Callout>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack-sm">
              {current.map((a) => (
                <li key={a.id} className="card card-body" style={{ padding: 10 }}>
                  <div className="row between">
                    <button className="btn ghost sm" onClick={() => setPreview(a)}><FileText size={14} /> {a.fileName}</button>
                    {editable && <Button size="sm" variant="ghost" onClick={() => { setReplaceId(a.id); fileRef.current?.click(); }}>{t('Sustituir')}</Button>}
                  </div>
                  <div className="tiny muted">v{a.version} · {Math.round(a.sizeBytes / 1024)} KB · {userName(db, a.uploadedBy)} · <DateTimeText at={a.uploadedAt} />{a.demo && ` · ${t('archivo de demostración')}`}</div>
                </li>
              ))}
            </ul>
            {superseded.length > 0 && (
              <details className="disclosure" style={{ marginTop: 10 }}>
                <summary>{t('Versiones anteriores ({n})', { n: superseded.length })}</summary>
                <ul className="small">{superseded.map((a) => <li key={a.id}>{a.fileName} (v{a.version}) · <DateTimeText at={a.uploadedAt} /></li>)}</ul>
              </details>
            )}
            <p className="tiny muted" style={{ marginTop: 10 }}>{t('Adjuntar no implica aprobación (PLT-05). Sustituir crea una nueva versión y conserva la original.')}</p>
          </Card>
        </div>
      </div>

      {preview && (
        <Modal wide title={preview.fileName} onClose={() => setPreview(null)}>
          {preview.dataUrl ? (
            preview.mimeType === 'application/pdf' ? <iframe title={preview.fileName} src={preview.dataUrl} style={{ width: '100%', height: '65vh', border: 0 }} /> : <img src={preview.dataUrl} alt={t('Justificante {name}', { name: preview.fileName })} style={{ maxWidth: '100%' }} />
          ) : (
            <Callout tone="neutral" title={t('Vista previa no disponible')}>{preview.demo ? t('Archivo de demostración: solo existen sus metadatos (nombre, tamaño, huella).') : t('Archivo grande: el prototipo guarda solo sus metadatos para no saturar el almacenamiento local.')}</Callout>
          )}
          <p className="tiny muted">{t('Huella (demo):')} <span className="mono">{preview.fingerprint}</span> · {t('clase de acceso:')} {preview.accessClass}</p>
        </Modal>
      )}
      {dialog === 'approve' && <ConfirmDialog title={t('Aprobar gasto')} message={t('Total {total}. Confirma que el justificante corresponde al gasto y que es un gasto de la empresa.', { total: formatEUR(e.totalCents) })} requireReason={false} reasonLabel={t('Comentario (opcional)')} confirmLabel={t('Aprobar')} onConfirm={(c) => runOk(() => reviewExpense(e.id, 'approve', c), t('Gasto aprobado'))} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && <ConfirmDialog danger title={t('Rechazar gasto')} requireReason reasonLabel={t('Motivo del rechazo (se comunica a quien lo presentó)')} confirmLabel={t('Rechazar')} onConfirm={(c) => runOk(() => reviewExpense(e.id, 'reject', c), t('Gasto rechazado'))} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <ConfirmDialog danger title={t('Eliminar borrador')} message={t('Solo se eliminan borradores que nunca se enviaron a revisión. Queda registrado.')} confirmLabel={t('Eliminar')} onConfirm={async () => { const ok = await runOk(() => deleteExpenseDraft(e.id), t('Borrador eliminado')); if (ok) navigate('/gastos'); return ok; }} onClose={() => setDialog(null)} />}
      {dialog === 'submit' && <SubmitDialog e={e} dupCount={dups.length} onClose={() => setDialog(null)} pending={pending} onSubmit={(ack) => runOk(() => submitExpense(e.id, ack), t('Gasto enviado a revisión'))} />}
      {dialog === 'pay' && <PayDialog e={e} onClose={() => setDialog(null)} />}
    </>
  );
}

function SubmitDialog({ e, dupCount, onClose, onSubmit, pending }: { e: ExpenseRecord; dupCount: number; onClose: () => void; onSubmit: (ack: boolean) => Promise<boolean>; pending: boolean }) {
  const [ack, setAck] = useState(false);
  return (
    <Modal title={t('Enviar a revisión')} onClose={onClose} footer={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" loading={pending} disabled={dupCount > 0 && !ack} onClick={async () => (await onSubmit(ack)) && onClose()}>{t('Enviar')}</Button></>}>
      <p>{t('Una vez enviado, el gasto no podrá modificarse salvo que sea rechazado.')} {e.kind === 'employee_expense' ? t('Lo revisará su supervisor/a o la dirección.') : t('Lo revisará la propiedad o la persona responsable.')}</p>
      {dupCount > 0 && <Checkbox label={t('He comprobado los {n} posibles duplicados y no lo son', { n: dupCount })} checked={ack} onChange={setAck} />}
    </Modal>
  );
}

function PayDialog({ e, onClose }: { e: ExpenseRecord; onClose: () => void }) {
  const ctx = useCtx();
  const { runOk, pending } = useAction();
  const [date, setDate] = useState(ctx.today);
  const [ref, setRef] = useState('');
  return (
    <Modal title={e.kind === 'employee_expense' ? t('Registrar reembolso') : t('Registrar pago al proveedor')} description={t('Registro operativo del pago ya realizado. El prototipo no inicia pagos bancarios.')} onClose={onClose} footer={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" loading={pending} onClick={async () => (await runOk(() => markExpensePaid(e.id, date, ref), t('Pago registrado'))) && onClose()}>{t('Registrar')}</Button></>}>
      <TextField label={t('Fecha')} type="date" value={date} max={ctx.today} onChange={(ev) => setDate(ev.target.value)} />
      <TextField label={t('Referencia')} required value={ref} onChange={(ev) => setRef(ev.target.value)} hint={t('Nº de transferencia o nómina.')} />
    </Modal>
  );
}
