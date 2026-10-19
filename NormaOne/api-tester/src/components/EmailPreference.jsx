import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useApi } from '../api/apiContext.js'
import ComingSoon from './ComingSoon.jsx'
import EndpointTag from './EndpointTag.jsx'
import { refusalOf } from '../lib/forms.js'
import { EMAIL_DELIVERY_AVAILABLE } from '../config/features.js'

/**
 * An email-notification preference switch.
 *
 * IT SHOWS ONLY WHAT IS STORED. The switch starts from the backend's value (`enabled`) and moves only
 * when the backend answers that the change is saved; a refused or failed save leaves it where it was
 * and says why. `endpointId` / `pathParams` name the PUT (own: me-set-email-preference; a team user:
 * tenant-set-user-email-preference). `who` is whose preference this is, said on the switch itself.
 */
export function EmailPreferenceToggle({ enabled, endpointId, pathParams, who, compact, onSaved }) {
  const { call } = useApi()
  const [stored, setStored] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null)

  const change = async () => {
    const next = !stored
    setBusy(true)
    setOutcome(null)
    const result = await call(endpointId, { label: `Email notifications ${next ? 'on' : 'off'} — ${who}`, pathParams, body: { enabled: next } })
    setBusy(false)
    if (result.ok && typeof result.bodyJson?.emailNotificationsEnabled === 'boolean') {
      setStored(result.bodyJson.emailNotificationsEnabled)
      setOutcome({ tone: 'good', text: 'Saved' })
      onSaved?.(result.bodyJson)
    } else {
      setOutcome({ tone: 'bad', text: refusalOf(result).message || 'Not saved — the preference is unchanged.' })
    }
  }

  const label = `Email notifications for ${who}`
  return (
    <span className="pref-switch-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="pref-switch"
        role="switch"
        aria-checked={Boolean(stored)}
        aria-label={label}
        title={label}
        disabled={busy || stored === undefined}
        onClick={change}
      >
        <span className="pref-switch-knob" aria-hidden="true" />
      </button>
      <span className={stored ? '' : 'muted'}>{stored === undefined ? '—' : stored ? 'Enabled' : 'Disabled'}</span>
      {busy ? <Loader2 size={13} className="spin" aria-label="Saving" /> : null}
      {outcome ? <span className={outcome.tone === 'good' ? 'muted' : 'field-error'} role="status">{outcome.text}</span> : null}
      {!compact && endpointId ? <EndpointTag id={endpointId} name="Save" pathParams={pathParams} /> : null}
    </span>
  )
}

/** "Saved, applies once email delivery exists" — next to a preference while email is Coming Soon. */
export function EmailDeliveryNote() {
  if (EMAIL_DELIVERY_AVAILABLE) return null
  return (
    <p className="muted" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      Email delivery <ComingSoon /> — the preference is saved now and applies once email is available. In-app notifications are not affected.
    </p>
  )
}
