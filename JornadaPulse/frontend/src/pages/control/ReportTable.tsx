/**
 * Generic report table rendered from the SAME `Column` definitions the export uses, so the
 * on-screen table always matches the exported file (rows, order and columns). Only the
 * presentation differs: dates as dd/mm/yyyy, decimal hours in the interface locale and
 * Spanish labels translated with t().
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { INDICATOR_LABEL } from '../../components/bits';
import { EmptyState, Pagination, SortHeader, sortRows, usePaged, useSort, type SortDir } from '../../components/ui';
import { formatDate, isValidISODate } from '../../domain/time';
import { locale, t } from '../../i18n';
import type { Column } from '../../services/reportService';

const DATE_KEYS = new Set(['fecha', 'desde', 'hasta']);

export function formatHours(v: number): string {
  return v.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Display text of one cell (same value as the export, presented for the interface). */
export function cellText<T>(
  c: Column<T>,
  row: T,
  translate: boolean,
): string {
  const v = c.value(row);
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return c.hours ? formatHours(v) : v.toLocaleString(locale());
  if (DATE_KEYS.has(c.key) && isValidISODate(v)) return formatDate(v);
  if (c.key === 'indicadores') {
    return v
      .split(', ')
      .map((code) => (code in INDICATOR_LABEL ? t(INDICATOR_LABEL[code as keyof typeof INDICATOR_LABEL]) : code))
      .join(', ');
  }
  return translate ? t(v) : v;
}

/** Sort state shared by the table and the export button (the export keeps the on-screen order). */
export function useSortedRows<T>(
  rows: T[],
  columns: Column<T>[],
) {
  const { sort, onSort } = useSort('', 'asc');
  const sorted = useMemo(() => (sort.col ? sortRows(rows, sort, (r, col) => columns.find((c) => c.key === col)?.value(r)) : rows), [rows, sort, columns]);
  return { sorted, sort, onSort };
}

export function ColumnTable<T>({
  rows,
  columns,
  rowKey,
  sort,
  onSort,
  translate = [],
  link,
  footer,
  pageSize = 25,
  emptyTitle,
  emptyText,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  sort: { col: string; dir: SortDir };
  onSort: (col: string) => void;
  /** Column keys whose values are Spanish labels to translate. */
  translate?: string[];
  /** Turns one column's cell into a link (same text). */
  link?: { key: string; to: (row: T) => string | null };
  footer?: ReactNode;
  pageSize?: number;
  emptyTitle: string;
  emptyText?: string;
  caption: string;
}) {
  const paged = usePaged(rows, pageSize);
  const tr = new Set(translate);
  if (rows.length === 0) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>;
  return (
    <>
      <div className="table-wrap">
        <table className="table control-report-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <SortHeader key={c.key} label={t(c.label)} col={c.key} sort={sort} onSort={onSort} num={!!c.hours} />
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => {
                  const text = cellText(c, r, tr.has(c.key));
                  const v = c.value(r);
                  const to = link && link.key === c.key ? link.to(r) : null;
                  return (
                    <td key={c.key} className={typeof v === 'number' ? 'num' : c.key.endsWith('_utc') ? 'mono tiny' : undefined}>
                      {to ? <Link to={to}>{text}</Link> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      <Pagination {...paged.props} />
    </>
  );
}
