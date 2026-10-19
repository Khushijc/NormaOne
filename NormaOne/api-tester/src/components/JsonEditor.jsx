import { useRef } from 'react'
import { Braces } from 'lucide-react'
import { checkJson } from '../lib/json.js'
import { applyVariables } from '../lib/variables.js'
import { Button } from './ui/Kit.jsx'

/**
 * A JSON body, with line numbers and a verdict under it.
 *
 * A textarea rather than an editor library: the reference adds no dependency for this, and what
 * matters here is knowing the body is valid before it goes — which the status line says on every
 * keystroke, with the line and column of the first mistake. Tab indents by two spaces instead of
 * leaving the box, because that is what anybody typing JSON expects it to do.
 *
 * {{$timestamp}}, {{$guid}}, {{$randomInt}} and {{$isoTimestamp}} are filled in when sending, and the
 * check runs on the text as it will be sent — so an unquoted {{$randomInt}} is not reported as broken.
 */
export default function JsonEditor({ value, onChange, disabled, disabledNote }) {
  const area = useRef(null)
  const gutter = useRef(null)
  const lines = Math.max(1, String(value || '').split('\n').length)
  const check = checkJson(applyVariables(value || '', {}).text)
  // Formatting the filled text would bake one timestamp into the draft for good, so Format works on
  // the text as typed — and is offered only when that parses on its own.
  const own = checkJson(value)

  const format = () => {
    if (own.ok && !own.empty) onChange(JSON.stringify(own.value, null, 2))
  }

  const onKeyDown = (event) => {
    if (event.key !== 'Tab' || event.shiftKey) return
    event.preventDefault()
    const el = event.target
    const { selectionStart: start, selectionEnd: end } = el
    const next = `${value.slice(0, start)}  ${value.slice(end)}`
    onChange(next)
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
  }

  if (disabled) return <p className="muted">{disabledNote}</p>

  return (
    <div className="json-editor">
      <div className="json-editor-box">
        <div className="json-gutter" ref={gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <span key={i} data-bad={!check.ok && check.error.line === i + 1 ? 'true' : undefined}>{i + 1}</span>
          ))}
        </div>
        <textarea
          ref={area}
          className="json-area"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.target.scrollTop }}
          spellCheck={false}
          aria-label="Request body"
          aria-invalid={check.ok ? undefined : 'true'}
          placeholder={'{\n  "field": "value"\n}'}
        />
      </div>
      <div className="toolbar">
        {check.empty ? (
          <span className="muted">No body will be sent.</span>
        ) : check.ok ? (
          <span className="muted good-text">Valid JSON</span>
        ) : (
          <span className="field-error" style={{ marginTop: 0 }}>
            {check.error.line ? `Line ${check.error.line}, column ${check.error.column}: ` : ''}{check.error.message}
          </span>
        )}
        <span className="toolbar-spacer" />
        <Button
          icon={Braces}
          disabled={!own.ok || own.empty}
          title={check.ok && !own.ok ? 'Only valid once placeholders are filled in, so it is left as typed.' : undefined}
          onClick={format}
        >
          Format
        </Button>
      </div>
    </div>
  )
}
