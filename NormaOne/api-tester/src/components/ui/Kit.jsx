import { useEffect } from 'react'
import { Loader2, X } from 'lucide-react'

/**
 * The everyday pieces the screens are built from.
 *
 * One file rather than one each: they are a handful of lines apiece and always arrive together,
 * and a directory of nine two-line files is harder to read than this.
 */

export function Button({ look, busy, disabled, icon: Icon, children, ...rest }) {
  return (
    <button
      type="button"
      className="btn"
      data-look={look || undefined}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <Loader2 size={13} className="spin" /> : Icon ? <Icon size={13} /> : null}
      {children}
    </button>
  )
}

export function Badge({ tone, children, title }) {
  return <span className="badge" data-tone={tone || undefined} title={title}>{children}</span>
}

export function Field({ label, required, hint, error, children, wide }) {
  return (
    // `wide` makes the field take the whole row of a .field-grid, for a value that reads badly
    // in half of one — a street address wraps after three words otherwise.
    <label className={wide ? 'field field-wide' : 'field'}>
      <span className="field-label">
        {label}
        {required ? <span> *</span> : null}
      </span>
      {children}
      {error
        ? <span className="field-error">{error}</span>
        : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Input({ error, ...rest }) {
  return <input className="input" aria-invalid={error ? 'true' : undefined} {...rest} />
}

export function TextArea({ error, ...rest }) {
  return <textarea className="textarea" aria-invalid={error ? 'true' : undefined} rows={3} {...rest} />
}

export function Card({ title, description, action, children }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="muted">{description}</p>}
          </div>
          {action && <div className="card-head-tools">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Empty({ title, description, action }) {
  return (
    <div className="placeholder">
      <h2 className="card-title">{title}</h2>
      {description && <p className="placeholder-text">{description}</p>}
      {action}
    </div>
  )
}

/**
 * A dialog. Closes on Escape, and the scrim is a real button so a click anywhere outside is a
 * close rather than something only a mouse user can discover.
 */
/** A body as JSON, or exactly as given when it is already a string. */
function asJson(value) {
  if (value === null || value === undefined) return '{}'
  if (typeof value === 'string') return value || '{}'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** A React node, as opposed to a body to be stringified. */
function isElement(value) {
  return value !== null && typeof value === 'object' && '$$typeof' in value
}

/** Whether there is nothing in it — an empty object counts, and so does an empty string. */
function isEmptyBody(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === '' || value.trim() === '{}'
  return Object.keys(value).length === 0
}

/**
 * A dialog, and for anything that sends a body, a full-screen split view.
 *
 * PASS `preview` AND IT TAKES THE SCREEN, with the form on the left and the exact JSON that will
 * be sent on the right, recomputed on every render so it tracks the fields as they are typed.
 * That is the whole point: on an API testing tool the payload is as much the subject as the form
 * is, and reading it after the fact tells you what you sent, not what you are about to send.
 *
 * `preview` takes an object (stringified here) or a ready-made string. `null` or `{}` still shows
 * the pane, saying the body is empty — because "this request sends nothing" is itself worth
 * seeing, and a pane that vanished would read as a bug.
 */
export function Modal({ open, onClose, title, description, endpoint, footer, preview,
  previewLabel, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-split={preview === undefined ? 'false' : 'true'}
    >
      <button type="button" className="modal-scrim" aria-label="Close" onClick={onClose} />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <h2 className="card-title">{title}</h2>
            {description && <p className="muted">{description}</p>}
          </div>
          <Button look="quiet" onClick={onClose} aria-label="Close"><X size={15} /></Button>
        </div>
        {/* Which request this is. The title says what the modal is for; this says what it sends. */}
        {endpoint && <div className="modal-endpoint">{endpoint}</div>}
        {preview === undefined ? (
          <div className="modal-body">{children}</div>
        ) : (
          <div className="modal-split">
            <div>{children}</div>
            <div className="modal-pane-preview">
              <p className="modal-pane-label">{previewLabel || 'Request body'}</p>
              {/* A ready-made node renders as it is — that is how the response view puts its
                  status line above the JSON. Anything else is a body to stringify. */}
              {isElement(preview) ? preview : (
                <pre className="modal-json" data-empty={isEmptyBody(preview) ? 'true' : 'false'}>
                  {asJson(preview)}
                </pre>
              )}
            </div>
          </div>
        )}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
