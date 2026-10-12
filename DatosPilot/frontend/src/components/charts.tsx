import { useState } from 'react';
import { locale, t } from '../i18n';

/** Count formatter (DatosPilot charts show numbers of items or assignments). */
function formatCount(v: number): string {
  return v.toLocaleString(locale(), { maximumFractionDigits: 0 });
}

export interface StackSegment {
  key: string;
  label: string;
  /** CSS colour (status token). Status colours are always paired with a text label. */
  color: string;
}

export interface StackRow {
  id: string;
  label: string;
  values: Record<string, number>;
  /** Optional link target when a segment or row is activated. */
  href?: (segmentKey: string | null) => string;
}

/**
 * Horizontal 100%-width stacked bars (one row per worksite / role). Legend always present,
 * 2px surface gaps between segments, hover/focus tooltip per segment, keyboard-activatable
 * segments, and a table alternative. Counts are shown as text next to each row.
 */
export function StackedBars({ rows, segments, ariaLabel, onActivate, rowHeader }: { rows: StackRow[]; segments: StackSegment[]; ariaLabel: string; onActivate?: (rowId: string, segmentKey: string | null) => void; rowHeader: string }) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<{ row: string; seg: string } | null>(null);
  const totals = rows.map((r) => segments.reduce((s, seg) => s + (r.values[seg.key] ?? 0), 0));
  return (
    <div className="stack-sm">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="legend" aria-hidden={asTable}>
          {segments.map((s) => (
            <span key={s.key}><span className="sw" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
        <button className="btn ghost sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? t('Ver gráfico') : t('Ver tabla')}</button>
      </div>
      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{rowHeader}</th>{segments.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">{t('Total')}</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={r.id}><td>{r.label}</td>{segments.map((s) => <td key={s.key} className="num">{formatCount(r.values[s.key] ?? 0)}</td>)}<td className="num">{formatCount(totals[i])}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <ul className="stacked-bars" aria-label={ariaLabel}>
          {rows.map((r, i) => (
            <li key={r.id}>
              <div className="sb-label">
                {onActivate ? <button className="link-btn" onClick={() => onActivate(r.id, null)}>{r.label}</button> : r.label}
                <span className="tiny muted">{formatCount(totals[i])}</span>
              </div>
              <div className="sb-track">
                {totals[i] === 0 && <span className="tiny muted">{t('Sin asignaciones')}</span>}
                {segments.map((s) => {
                  const v = r.values[s.key] ?? 0;
                  if (!v) return null;
                  const active = hover?.row === r.id && hover.seg === s.key;
                  return (
                    <button
                      key={s.key}
                      className="sb-seg"
                      style={{ flexGrow: v, background: s.color }}
                      aria-label={`${r.label}: ${s.label}, ${formatCount(v)}`}
                      onMouseEnter={() => setHover({ row: r.id, seg: s.key })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ row: r.id, seg: s.key })}
                      onBlur={() => setHover(null)}
                      onClick={() => onActivate?.(r.id, s.key)}
                    >
                      {active && (
                        <span className="chart-tooltip sb-tip" role="tooltip">
                          <span className="strong">{r.label}</span>
                          <span>{s.label}: {formatCount(v)}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
