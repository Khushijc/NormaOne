import { Download } from 'lucide-react';
import { useState } from 'react';
import { t } from '../i18n';
import { createExport, REPORTS, type Filters } from '../services/reportService';
import { Button, Callout, Modal, SelectField, TextField, useAction } from './ui';

/**
 * CSV / JSON export of a report. Rows are rebuilt by the service from the caller's permitted
 * scope (never taken from the screen); the file carries metadata, the open items and the
 * recipient, and the export is recorded in the audit log.
 */
export function ExportButton({ reportId, filters, label, disabled }: { reportId: string; filters: Filters; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [recipient, setRecipient] = useState('');
  const { run, pending } = useAction();
  const def = REPORTS.find((r) => r.id === reportId);
  const go = async () => {
    const r = await run(() => createExport({ reportId, format, filters, recipient }), (res) => t('Exportación generada: {n} registros', { n: res.job.recordCount }));
    if (r) setOpen(false);
  };
  return (
    <>
      <Button icon={Download} onClick={() => setOpen(true)} disabled={disabled}>
        {label ?? t('Exportar')}
      </Button>
      {open && (
        <Modal
          title={t('Exportar informe')}
          description={def ? t(def.title) : undefined}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>{t('Cancelar')}</Button>
              <Button variant="primary" icon={Download} loading={pending} onClick={go}>
                {t('Generar y descargar')}
              </Button>
            </>
          }
        >
          <div className="stack">
            <SelectField label={t('Formato')} value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}>
              <option value="csv">{t('CSV (Excel, separador «;»)')}</option>
              <option value="json">JSON</option>
            </SelectField>
            <TextField label={t('Destinatario')} hint={t('Queda en los metadatos del archivo y en la auditoría.')} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={t('Uso interno')} />
            <Callout tone="info">{t('El archivo incluye solo lo que su rol puede ver, mantiene visibles los elementos pendientes y omite o enmascara los datos de salud y restringidos.')}</Callout>
          </div>
        </Modal>
      )}
    </>
  );
}
