import { Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/Kit.jsx'

/**
 * Rows of name and value, each switchable — query parameters and headers.
 *
 * A row that is switched off stays on screen and is not sent, so a filter can be tried with and
 * without without retyping it. `hints` puts each documented parameter's description under its row.
 */
export default function KeyValueEditor({ rows, onChange, keyLabel = 'Name', valueLabel = 'Value', hints = {}, addLabel = 'Add row' }) {
  const update = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const remove = (index) => onChange(rows.filter((_, i) => i !== index))
  const add = () => onChange([...rows, { key: '', value: '', enabled: true }])

  return (
    <div className="kv">
      {rows.length ? (
        <div className="kv-row kv-head" aria-hidden="true">
          <span />
          <span>{keyLabel}</span>
          <span>{valueLabel}</span>
          <span />
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div className="kv-row" key={index} data-off={row.enabled === false || undefined}>
          <input
            type="checkbox"
            className="kv-check"
            checked={row.enabled !== false}
            onChange={(event) => update(index, { enabled: event.target.checked })}
            aria-label={`Send ${row.key || `row ${index + 1}`}`}
          />
          <input
            className="input mono"
            value={row.key}
            onChange={(event) => update(index, { key: event.target.value })}
            placeholder={keyLabel}
            aria-label={`${keyLabel} ${index + 1}`}
            spellCheck={false}
          />
          <span className="kv-value">
            <input
              className="input mono"
              value={row.value}
              onChange={(event) => update(index, { value: event.target.value })}
              placeholder={valueLabel}
              aria-label={`${valueLabel} ${index + 1}`}
              spellCheck={false}
            />
            {hints[row.key] ? <span className="field-hint">{hints[row.key]}</span> : null}
          </span>
          <button type="button" className="pager-btn" onClick={() => remove(index)} aria-label={`Remove ${row.key || `row ${index + 1}`}`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div>
        <Button icon={Plus} onClick={add}>{addLabel}</Button>
      </div>
    </div>
  )
}
