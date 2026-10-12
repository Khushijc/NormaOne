import { Download } from 'lucide-react';
import { useState } from 'react';
import { createExport, type Column } from '../services/exportService';
import { t } from '../i18n';
import { useCtx } from '../store/hooks';
import { Button, Modal, useToast } from './ui';

/** Exports the CURRENT filtered rows as CSV or JSON and records the export (audited). */
export function ExportButton<T>({
  kind,
  baseName,
  rows,
  columns,
  filters,
  periodFrom = null,
  periodTo = null,
  totalCents = null,
  label,
}: {
  kind: string;
  baseName: string;
  rows: T[];
  columns: Column<T>[];
  filters: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  totalCents?: number | null;
  label?: string;
}) {
  const ctx = useCtx();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!ctx.can('exports.create')) return null;
  const go = (format: 'csv' | 'json') => {
    try {
      const rec = createExport({ kind, baseName, format, rows, columns, filters, periodFrom, periodTo, totalCents });
      toast.success(t('Exportación generada: {file}', { file: rec.fileName }), [
        t('{n} registros · huella demo {fp}', { n: rec.recordCount, fp: rec.fingerprint }),
        t('Registrada en el historial de exportaciones y en la auditoría.'),
      ]);
      setOpen(false);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <Button icon={Download} onClick={() => setOpen(true)} disabled={rows.length === 0} title={rows.length === 0 ? t('No hay registros que exportar') : undefined}>
        {label ?? t('Exportar')}
      </Button>
      {open && (
        <Modal
          title={t('Exportar registros')}
          onClose={() => setOpen(false)}
          description={t('{n} registros con los filtros actuales: {filters}.', { n: rows.length, filters: filters || t('sin filtros') })}
        >
          <p className="small">
            {t('CSV con separador «;» y coma decimal (compatible con hojas de cálculo en español) o JSON con metadatos. Se conservan los identificadores internos como referencia de origen. Es una exportación operativa, no una declaración tributaria.')}
          </p>
          <div className="row">
            <Button variant="primary" icon={Download} onClick={() => go('csv')}>{t('Descargar CSV')}</Button>
            <Button icon={Download} onClick={() => go('json')}>{t('Descargar JSON')}</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
