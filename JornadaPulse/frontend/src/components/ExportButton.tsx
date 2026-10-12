import { Download } from 'lucide-react';
import { useRef, useState } from 'react';
import { t } from '../i18n';
import { createExport, type Column } from '../services/reportService';
import { useAction } from './ui';

/**
 * CSV / JSON export of exactly the rows on screen (after filters). The file carries metadata and
 * the number of open exceptions; the export is recorded in the audit log (TIM-08, PLT-06).
 */
export function ExportButton<T>({ kind, title, rows, columns, filters, period, own, label, disabled }: { kind: string; title: string; rows: T[]; columns: Column<T>[]; filters: string; period?: string | null; own?: boolean; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { run, pending } = useAction();
  const go = async (format: 'csv' | 'json') => {
    setOpen(false);
    await run(() => createExport({ kind, title, format, rows, columns, filters, period: period ?? null, own }), (r) => t('Exportación generada: {n} registros', { n: r.job.recordCount }));
  };
  return (
    <div className="dropdown" ref={ref} onBlur={(e) => !ref.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} disabled={disabled || pending || rows.length === 0} onClick={() => setOpen((v) => !v)} title={rows.length === 0 ? t('No hay registros que exportar') : undefined}>
        <Download size={15} aria-hidden /> {label ?? t('Exportar')}
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" style={{ minWidth: 220 }}>
          <div className="group">{t('{n} registros con los filtros actuales', { n: rows.length })}</div>
          <button role="menuitem" className="item" onClick={() => go('csv')}>
            {t('Descargar CSV (Excel, separador «;»)')}
          </button>
          <button role="menuitem" className="item" onClick={() => go('json')}>
            {t('Descargar JSON')}
          </button>
        </div>
      )}
    </div>
  );
}
