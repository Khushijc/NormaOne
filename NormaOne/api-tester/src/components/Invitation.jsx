import { useState } from 'react'
import { Mail, RotateCw } from 'lucide-react'
import { useApi } from '../api/apiContext.js'
import EndpointTag from './EndpointTag.jsx'
import { Button } from './ui/Kit.jsx'

/**
 * How an invitation reached the person, as the backend reported it (InvitationInfo): a temporary
 * password emailed by Cognito, an existing account that links at its next sign-in, or self
 * registration. The message is the backend's own; nothing here ever holds a password.
 */
export function InvitationNotice({ info }) {
  if (!info) return null
  return (
    <p className="banner" data-tone={info.emailSent ? 'good' : 'warn'}>
      <Mail size={14} aria-hidden="true" />
      <span>{info.message}</span>
    </p>
  )
}

/**
 * Sends a pending invitation again — a new temporary password from Cognito, which is also the way
 * past an expired one. Offered only while the account is INVITED; the backend refuses it otherwise.
 */
export function ResendInvitation({ endpointId, pathParams, onDone }) {
  const { call } = useApi()
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)

  const resend = async () => {
    setBusy(true)
    const result = await call(endpointId, { label: 'Resend the invitation', pathParams })
    setBusy(false)
    if (result.ok) {
      setInfo(result.bodyJson?.invitation ?? null)
      onDone?.()
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <InvitationNotice info={info} />
      <div className="toolbar">
        <Button icon={RotateCw} busy={busy} onClick={resend}>Resend invitation</Button>
        <EndpointTag id={endpointId} name="Resend" pathParams={pathParams} />
      </div>
    </div>
  )
}
