import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, LogIn, LogOut, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useApi, useApiState } from '../api/apiContext.js'
import { SIGN_IN_PATH } from '../lib/landing.js'
import EndpointTag from './EndpointTag.jsx'
import { Badge, Button } from './ui/Kit.jsx'

/**
 * The signed-in account, as the backend reports it. It replaced the token slots this control used
 * to hold.
 *
 * NOTHING HERE IS A TOKEN. The session is a pair of HttpOnly cookies the page cannot read; what is
 * shown comes from GET /api/auth/session (signed in? until when?) and GET /api/users/me (who, which
 * role, onboarded?). "Renew" is POST /api/auth/refresh, "Sign out" POST /api/auth/logout — the
 * backend sets and clears the cookies itself.
 *
 * Testing a different account is signing in as it. A one-off request with a specific token can still
 * be sent from the console, with Auth set to "Bearer token"; that token stays in the form.
 */
export default function SessionControl() {
  const { checkAccount, logout, renewSession } = useApi()
  const { account } = useApiState()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    const onClick = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const run = async (what, action) => {
    setBusy(what)
    await action()
    setBusy(null)
  }

  const session = account.session
  const me = account.me
  const signedIn = session?.authenticated === true
  const label = !account.checked ? 'checking…'
    : account.error ? 'backend unreachable'
      : signedIn ? (me?.email || session.email || 'signed in')
        : 'signed out'

  return (
    <div className="picker" ref={box}>
      <button
        type="button"
        className={`picker-trigger${signedIn ? ' is-on' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
        title="The browser's session, as the backend reports it"
      >
        {signedIn ? <ShieldCheck size={14} className="picker-icon" /> : <ShieldAlert size={14} className="picker-icon" />}
        <span className="picker-label">Session</span>
        <span className={`picker-value${signedIn ? '' : ' is-empty'}`}>
          {label}
          {signedIn && me?.effectiveRole ? ` · ${me.effectiveRole}` : ''}
        </span>
        <ChevronDown size={14} className="picker-caret" />
      </button>

      {open ? (
        <div className="picker-pop token-pop" role="dialog" aria-label="Session">
          <div className="session-facts">
            {signedIn ? (
              <>
                <p><Badge tone="good">Signed in</Badge> <span className="mono">{me?.email || session.email}</span></p>
                <dl className="session-dl">
                  <dt>Role</dt><dd>{me?.effectiveRole || 'none yet'}</dd>
                  <dt>Onboarding</dt><dd>{me?.onboardingStatus || '—'}</dd>
                  <dt>Organization</dt><dd>{me?.organizationName || '—'}</dd>
                  <dt>Session ends</dt><dd>{session.expiresAt ? new Date(session.expiresAt).toLocaleTimeString() : '—'}</dd>
                  <dt>Renewable</dt><dd>{session.refreshAvailable ? 'yes' : 'no — sign in again when it ends'}</dd>
                </dl>
              </>
            ) : (
              <p>
                <Badge tone={account.error ? 'bad' : 'warn'}>{account.error ? 'No answer' : 'Signed out'}</Badge>{' '}
                {account.error
                  ? 'The backend could not be asked. Is it running?'
                  : session?.refreshAvailable ? 'The session ended; it can be renewed.' : 'Sign in to start a session.'}
              </p>
            )}
            <p className="muted">
              The session is held in HttpOnly cookies set by the backend. This page never sees the tokens.
            </p>
          </div>
          <div className="picker-foot">
            {signedIn || session?.refreshAvailable ? (
              <Button icon={RefreshCw} busy={busy === 'renew'} onClick={() => run('renew', renewSession)}>Renew</Button>
            ) : null}
            <Button busy={busy === 'check'} onClick={() => run('check', checkAccount)}>Recheck</Button>
            <span className="toolbar-spacer" />
            {signedIn ? (
              <Button look="danger" icon={LogOut} busy={busy === 'logout'}
                      onClick={() => run('logout', async () => { await logout(); setOpen(false); navigate(SIGN_IN_PATH) })}>
                Sign out
              </Button>
            ) : (
              <Link className="btn" data-look="primary" to={SIGN_IN_PATH} onClick={() => setOpen(false)}>
                <LogIn size={13} /> Sign in
              </Link>
            )}
          </div>
          <div className="session-tags">
            <EndpointTag id="auth-session" name="Status" />
            <EndpointTag id="auth-refresh" name="Renew" />
            <EndpointTag id="auth-logout" name="Sign out" look="danger" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
