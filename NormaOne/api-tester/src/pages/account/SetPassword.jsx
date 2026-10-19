import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff, KeyRound, X } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { Button, Card, Empty, Field, Input } from '../../components/ui/Kit.jsx'
import { refusalOf } from '../../lib/forms.js'
import { landingFor, SIGN_IN_PATH } from '../../lib/landing.js'

/**
 * Account › Set password — the first sign-in of an account an administrator invited.
 *
 * The invitation email carried a temporary password. Signing in with it does not open a session:
 * Cognito answers NEW_PASSWORD_REQUIRED, the backend keeps that challenge in an HttpOnly cookie, and
 * the login step sends the person here with the email in the navigation state (never the URL). Only
 * POST /api/auth/new-password with a permanent password completes the challenge and sets the
 * session; then the account is read from /api/users/me and the page goes where it belongs.
 *
 * The rules shown come from the user pool (GET /api/auth/password-policy) — or Cognito's defaults when
 * the backend may not read the pool, which this page says. Cognito checks the real policy either way,
 * and its refusal is shown as it comes. The password lives in this form's state and nowhere else.
 */
export default function SetPassword() {
  const { state } = useLocation()
  const email = state?.email

  if (!email) {
    return (
      <div className="page stack">
        <Card>
          <Empty
            title="Sign in with your temporary password first"
            description="This step comes after signing in with the email and temporary password from your invitation. Open the invitation email, then sign in."
            action={<Link className="btn" data-look="primary" to={SIGN_IN_PATH}>Go to sign in</Link>}
          />
        </Card>
      </div>
    )
  }
  return <SetPasswordForm email={email} />
}

/** Each rule the pool enforces, as a check against what is typed. */
function rulesFor(policy) {
  if (!policy) return []
  return [
    { id: 'length', label: `At least ${policy.minimumLength} characters`, test: (p) => p.length >= policy.minimumLength },
    policy.requireUppercase && { id: 'upper', label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
    policy.requireLowercase && { id: 'lower', label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
    policy.requireNumbers && { id: 'number', label: 'A number', test: (p) => /[0-9]/.test(p) },
    policy.requireSymbols && { id: 'symbol', label: 'A symbol, such as ! @ # $ %', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  ].filter(Boolean)
}

function SetPasswordForm({ email }) {
  const { call, checkAccount } = useApi()
  const navigate = useNavigate()
  const policy = useRead('auth-password-policy', { label: 'Password policy' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [expired, setExpired] = useState(false)
  // Busy state disables the button only after a render; a fast double click lands before that.
  const sending = useRef(false)

  const rules = rulesFor(policy.data)
  const unmet = rules.filter((rule) => !rule.test(password))
  const mismatch = confirm.length > 0 && confirm !== password
  const ready = password.length > 0 && unmet.length === 0 && confirm === password && !busy

  const submit = async () => {
    if (!ready || sending.current) return
    sending.current = true
    setBusy(true)
    setRefusal(null)
    const answer = await call('auth-new-password', { label: 'Set permanent password', body: { email, newPassword: password }, quiet: true })
    if (!answer.ok) {
      sending.current = false
      setBusy(false)
      setExpired(answer.status === 401)
      setRefusal(refusalOf(answer).message || refusalOf(answer).fields?.newPassword || `The backend answered ${answer.status ?? 'nothing'}.`)
      return
    }
    // The session cookies are set now. Drop the password and ask who signed in.
    setPassword('')
    setConfirm('')
    const account = await checkAccount()
    setBusy(false)
    navigate(landingFor(account.me), { replace: true })
  }

  const type = visible ? 'text' : 'password'
  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Set your permanent password</h1>
          <p className="muted">
            Signing in as <span className="mono">{email}</span>. Your temporary password worked; choose the password you will use from now on.
          </p>
        </div>
      </div>

      <Card>
        <form className="stack auth-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
          <Field label="New password" required>
            <span className="password-box">
              <Input type={type} value={password} onChange={(event) => setPassword(event.target.value)}
                     autoComplete="new-password" autoFocus aria-describedby="password-rules" />
              <button type="button" className="password-toggle" onClick={() => setVisible((was) => !was)}
                      aria-label={visible ? 'Hide passwords' : 'Show passwords'} aria-pressed={visible}>
                {visible ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </Field>
          <Field label="Confirm new password" required error={mismatch ? 'The two passwords do not match.' : null}>
            <Input type={type} value={confirm} onChange={(event) => setConfirm(event.target.value)}
                   autoComplete="new-password" error={mismatch} />
          </Field>

          <div id="password-rules" className="password-rules">
            {policy.data ? (
              <>
                <ul>
                  {rules.map((rule) => {
                    const met = rule.test(password)
                    return (
                      <li key={rule.id} data-met={met || undefined}>
                        {met ? <Check size={13} /> : <X size={13} />} {rule.label}
                      </li>
                    )
                  })}
                </ul>
                <p className="muted">
                  {policy.data.source === 'COGNITO'
                    ? 'These are the user pool\'s rules.'
                    : 'These are Cognito\'s default rules; the pool\'s own could not be read. Cognito checks the real ones when you save.'}
                </p>
              </>
            ) : <p className="muted">{policy.loading ? 'Reading the password rules…' : 'At least 8 characters.'}</p>}
          </div>

          {refusal ? (
            <div className="banner" data-tone="bad">
              <div>
                <span>{refusal}</span>
                {expired ? (
                  <span className="btn-row" style={{ marginTop: 8 }}>
                    <Link className="btn" to={SIGN_IN_PATH}>Sign in again with the temporary password</Link>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="toolbar">
            <Button type="submit" look="primary" icon={KeyRound} busy={busy} disabled={!ready}>Set password and continue</Button>
            <EndpointTag id="auth-new-password" name="Set password" look="primary" />
          </div>
        </form>
      </Card>
    </div>
  )
}
