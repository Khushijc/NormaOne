/** Exports (FIN-08, NFR-10). Files are generated and downloaded locally; nothing is uploaded. */
import { formatDate, formatDateTime, nowISO } from '../domain/dates';
import { demoHash, newId } from '../domain/ids';
import type { ExportRecord, ISODate } from '../domain/types';
import { transact } from '../store/db';
import { getCtx, requirePerm } from './context';

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  /** Render as Spanish decimal amount (cents in, "1234,56" out). */
  money?: boolean;
}

/** CSV for Spanish spreadsheets: ';' separator, decimal comma, UTF-8 with BOM. */
export function toCSV<T>(rows: T[], columns: Column<T>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Exports are always Spanish (headers, decimal comma) whatever the interface language:
  // they are the file format agreed with the accountant. Strip any i18n " [context]" marker.
  const head = columns.map((c) => esc(c.label.replace(/ \[[^\]]+\]$/, ''))).join(';');
  const body = rows.map((r) => columns.map((c) => {
    const v = c.value(r);
    return esc(c.money && typeof v === 'number' ? (v / 100).toFixed(2).replace('.', ',') : v);
  }).join(';'));
  return '﻿' + [head, ...body].join('\r\n');
}

export function toJSON<T>(rows: T[], columns: Column<T>[], meta: Record<string, unknown>): string {
  return JSON.stringify(
    {
      meta,
      records: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.value(r) ?? null]))),
    },
    null,
    2,
  );
}

export function downloadFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportRequest<T> {
  kind: string;
  baseName: string;
  format: 'csv' | 'json';
  rows: T[];
  columns: Column<T>[];
  periodFrom: ISODate | null;
  periodTo: ISODate | null;
  filters: string;
  totalCents?: number | null;
  /** Download in the browser (false in tests). */
  download?: boolean;
}

export const SCOPE_NOTE = 'Exportación operativa generada por el prototipo con datos de demostración. No es una declaración tributaria ni un libro registro oficial.';

/** Generates an export, downloads it and records it in the export history (audited). */
export function createExport<T>(req: ExportRequest<T>): ExportRecord {
  const ctx = getCtx();
  requirePerm(ctx, 'exports.create');
  const meta = {
    empresa: ctx.company.legalName,
    nif: ctx.company.nif,
    tipo: req.kind,
    periodo: req.periodFrom || req.periodTo ? `${formatDate(req.periodFrom)} – ${formatDate(req.periodTo)}` : 'Todo',
    filtros: req.filters,
    registros: req.rows.length,
    generado: formatDateTime(nowISO()),
    generadoPor: ctx.user.name,
    alcance: SCOPE_NOTE,
  };
  const content = req.format === 'csv' ? toCSV(req.rows, req.columns) : toJSON(req.rows, req.columns, meta);
  const stamp = nowISO().slice(0, 16).replace(/[-:T]/g, '');
  const fileName = `${req.baseName}_${stamp}.${req.format}`;
  const fingerprint = demoHash(content);
  if (req.download !== false) downloadFile(fileName, content, req.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
  return transact(ctx.actor, (tx) => {
    const rec: ExportRecord = {
      id: newId('xpt'),
      companyId: ctx.company.id,
      kind: req.kind,
      format: req.format,
      fileName,
      periodFrom: req.periodFrom,
      periodTo: req.periodTo,
      filters: req.filters,
      recordCount: req.rows.length,
      totalCents: req.totalCents ?? null,
      fingerprint,
      scopeNote: SCOPE_NOTE,
      createdBy: ctx.user.id,
      createdAt: nowISO(),
    };
    tx.insert('exports', rec);
    tx.audit({ action: 'export.create', entityType: 'export', entityId: rec.id, entityLabel: fileName, summary: `${rec.recordCount} registros · ${req.filters} · huella demo ${fingerprint}`, reason: null, changes: [] });
    return rec;
  });
}
