import { useState } from 'react';
import { locale, t } from '../i18n';

export interface BarGroup {
  label: string;
  values: number[];
}

/**
 * Grouped bar chart (≤ 2 series, categorical slots 1–2). Legend always present,
 * per-bar hover/focus tooltip, a table alternative, recessive grid, one axis.
 */
/** Hours formatter used by JornadaPulse charts (values are hours). */
export function formatHoursValue(v: number): string {
  return `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })} h`;
}

export function GroupedBarChart({ groups, series, height = 220, ariaLabel, format = formatHoursValue, groupHeader }: { groups: BarGroup[]; series: string[]; height?: number; ariaLabel: string; format?: (v: number) => string; groupHeader?: string }) {
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 640, H = height, padL = 64, padB = 26, padT = 10, padR = 8;
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const nice = niceMax(max);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const gw = plotW / Math.max(1, groups.length);
  const bw = Math.min(26, (gw - 14) / series.length - 2);
  const y = (v: number) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  const colors = ['var(--series-1)', 'var(--series-2)'];

  return (
    <div className="stack-sm">
      <div className="row between">
        <div className="legend" aria-hidden={asTable}>
          {series.map((s, i) => (
            <span key={s}><span className="sw" style={{ background: colors[i] }} />{s}</span>
          ))}
        </div>
        <button className="btn ghost sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? t('Ver gráfico') : t('Ver tabla')}</button>
      </div>
      {asTable ? (
        <table className="table">
          <thead><tr><th>{groupHeader ?? t('Periodo')}</th>{series.map((s) => <th key={s} className="num">{s}</th>)}</tr></thead>
          <tbody>{groups.map((g) => <tr key={g.label}><td>{g.label}</td>{g.values.map((v, i) => <td key={i} className="num">{format(v)}</td>)}</tr>)}</tbody>
        </table>
      ) : (
        <div className="chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
            <g className="grid">{ticks.map((tick) => <line key={tick} x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} />)}</g>
            <g className="axis">
              {ticks.map((tick) => <text key={tick} x={padL - 6} y={y(tick) + 4} textAnchor="end">{format(tick)}</text>)}
              {groups.map((g, gi) => <text key={g.label} x={padL + gw * gi + gw / 2} y={H - 8} textAnchor="middle">{g.label}</text>)}
            </g>
            {groups.map((g, gi) =>
              g.values.map((v, si) => {
                const x = padL + gw * gi + (gw - (bw + 2) * series.length) / 2 + si * (bw + 2);
                const top = y(v);
                const h = Math.max(0, padT + plotH - top);
                const r = Math.min(4, h);
                return (
                  <g key={`${gi}-${si}`}>
                    <path
                      className="bar"
                      d={h <= 0 ? '' : `M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${padT + plotH} Z`}
                      fill={colors[si]}
                    />
                    <rect
                      x={x - 2}
                      y={padT}
                      width={bw + 4}
                      height={plotH}
                      fill="transparent"
                      tabIndex={0}
                      role="img"
                      aria-label={`${g.label}, ${series[si]}: ${format(v)}`}
                      onMouseEnter={() => setHover({ g: gi, s: si })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ g: gi, s: si })}
                      onBlur={() => setHover(null)}
                      style={{ outline: 'none' }}
                    />
                  </g>
                );
              }),
            )}
          </svg>
          {hover && (
            <div
              className="chart-tooltip"
              style={{
                left: `${((padL + gw * hover.g + gw / 2) / W) * 100}%`,
                top: `${(y(groups[hover.g].values[hover.s]) / H) * 100}%`,
              }}
            >
              <div className="strong">{groups[hover.g].label}</div>
              <div><span className="sw" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: colors[hover.s], marginRight: 6 }} />{series[hover.s]}: {format(groups[hover.g].values[hover.s])}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceMax(v: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}
