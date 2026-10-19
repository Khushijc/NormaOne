import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, LogIn, LogOut, MailCheck, RotateCw, UserPlus } from 'lucide-react'
import { useApi, useApiState } from '../../api/apiContext.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { Badge, Button, Card, Field, Input } from '../../components/ui/Kit.jsx'
import { refusalOf } from '../../lib/forms.js'
import { landingFor, SET_PASSWORD_PATH } from '../../lib/landing.js'

/**
 * Account › Sign up & in — register, verify, log in, one step at a time.
 *
 * ONE FORM ON SCREEN. The progress row says where you are; each step moves to the next only on the
 * backend's success (202 from register, 200 from verify, 200 from login), and stays put on a
 * refusal, showing the backend's own message. Resending the code is an action of the verify step,
 * not a step of its own.
 *
 * NOTHING ENTERED IS LOST BY GOING BACK. Name, email and password live in this screen's state —
 * memory only, never storage — so "Back" returns to a filled form, and the login step starts with the
 * email (and, in the same visit, the password) already in it. The password is dropped on sign-in.
 *
 * INVITED ACCOUNTS do not register or verify: their invitation email carries a temporary password.
 * Logging in with it answers NEW_PASSWORD_REQUIRED, and this screen hands over to Set password.
 *
 * LOGIN SETS THE SESSION, NOT THE PAGE. The backend answers with HttpOnly cookies and no token; this
 * screen then asks the backend who signed in (GET /api/auth/session and GET /api/users/me) and goes
 * where that answer says: onboarding while requiresTenantSetup, otherwise the account's dashboard.
 *
 * The calls are quiet — no pop-up after each step — and each step's EndpointTag opens its last call.
 */
const STEPS = [
  { id: 'register', label: 'Register' },
  { id: 'verify', label: 'Verify email' },
  { id: 'login', label: 'Login' },
]

export default function Auth() {
  const { account } = useApiState()
  const [step, setStep] = useState('register')
  const [person, setPerson] = useState({ name: '', email: '', password: '' })
  const [notice, setNotice] = useState(null)

  const go = (next, message = null) => {
    setNotice(message)
    setStep(next)
  }

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Sign up & sign in</h1>
          <p className="muted">
            Cognito through the backend. The session is kept in HttpOnly cookies — this page never sees a token.
          </p>
        </div>
      </div>

      {account.session?.authenticated ? <SignedIn /> : null}

      <ol className="steps" aria-label="Progress">
        {STEPS.map((one, index) => {
          const current = one.id === step
          const done = STEPS.findIndex((s) => s.id === step) > index
          return (
            <li key={one.id} className="steps-item" data-current={current || undefined} data-done={done || undefined}>
              <button
                type="button"
                className="steps-button"
                aria-current={current ? 'step' : undefined}
                // Any step can be opened directly — an account registered yesterday starts at Login —
                // but Verify needs an email to verify.
                disabled={one.id === 'verify' && !person.email.trim()}
                onClick={() => go(one.id)}
              >
                <span className="steps-number">{index + 1}</span>
                {one.label}
              </button>
              {index < STEPS.length - 1 ? <ArrowRight size={14} className="steps-arrow" aria-hidden="true" /> : null}
            </li>
          )
        })}
      </ol>

      {notice ? <p className="banner" data-tone="good">{notice}</p> : null}

      {step === 'register' ? (
        <RegisterStep person={person} setPerson={setPerson} onDone={() => go('verify', `A verification code was sent to ${person.email.trim()}.`)} go={go} />
      ) : step === 'verify' ? (
        <VerifyStep person={person} go={go} />
      ) : (
        <LoginStep person={person} setPerson={setPerson} go={go} />
      )}
    </div>
  )
}

/** Runs one auth call quietly and keeps its refusal for the form. */
function useStep(endpointId, label) {
  const { call } = useApi()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [result, setResult] = useState(null)
  const run = async (body) => {
    setBusy(true)
    const answer = await call(endpointId, { label, body, quiet: true })
    setBusy(false)
    setResult(answer)
    setRefusal(refusalOf(answer))
    return answer
  }
  return { busy, refusal, result, run }
}

/** The page's own checks — the backend validates again and its answer is shown as it comes. */
function missing(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => !String(value).trim()).map(([key]) => [key, 'Required.']))
}

function RegisterStep({ person, setPerson, onDone, go }) {
  const step = useStep('register', 'Register')
  const [local, setLocal] = useState({})
  const set = (key) => (event) => setPerson({ ...person, [key]: event.target.value })

  const submit = async () => {
    const problems = missing({ name: person.name, email: person.email, password: person.password })
    if (person.password && person.password.length < 8) problems.password = 'At least 8 characters.'
    setLocal(problems)
    if (Object.keys(problems).length) return
    const answer = await step.run({ name: person.name.trim(), email: person.email.trim(), password: person.password })
    if (answer.status === 202) onDone()
  }

  const errors = { ...step.refusal.fields, ...local }
  return (
    <Card title="1. Register" description="Creates the Cognito account and emails a verification code. Answers 202.">
      <form className="stack auth-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Field label="Name" required error={errors.name}>
          <Input value={person.name} error={errors.name} onChange={set('name')} autoComplete="name" />
        </Field>
        <Field label="Email" required error={errors.email}>
          <Input type="email" value={person.email} error={errors.email} onChange={set('email')} autoComplete="username" />
        </Field>
        <Field label="Password" required hint="8–256 characters, plus Cognito's own policy." error={errors.password}>
          <Input type="password" value={person.password} error={errors.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        {step.refusal.message ? (
          <div className="banner" data-tone="bad">
            <div>
              <span>{step.refusal.message}</span>
              {step.result?.status === 409 ? (
                <span className="btn-row" style={{ marginTop: 8 }}>
                  <Button onClick={() => go('verify')}>Verify this email</Button>
                  <Button onClick={() => go('login')}>Go to login</Button>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="toolbar">
          <Button type="submit" look="primary" icon={UserPlus} busy={step.busy}>Register</Button>
          <EndpointTag id="register" name="Register" look="primary" />
          <span className="toolbar-spacer" />
          <button type="button" className="picker-plain" onClick={() => go('login')}>Already registered? Log in</button>
        </div>
      </form>
    </Card>
  )
}

function VerifyStep({ person, go }) {
  const verify = useStep('verify-email', 'Verify email')
  const resend = useStep('resend-code', 'Resend code')
  const [code, setCode] = useState('')
  const [local, setLocal] = useState(null)
  const email = person.email.trim()

  const submit = async () => {
    if (!code.trim()) {
      setLocal('Enter the code from the email.')
      return
    }
    setLocal(null)
    // Email and code only: the password is not sent here, so verifying never signs in by itself.
    const answer = await verify.run({ email, code: code.trim() })
    if (answer.ok) go('login', 'Email verified. Log in to continue.')
  }

  const resent = resend.result?.ok
  return (
    <Card title="2. Verify email" description="Enter the code Cognito emailed. A wrong or expired code keeps you here.">
      <form className="stack auth-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <p>Verifying <span className="mono">{email}</span></p>
        <Field label="Verification code" required error={local || verify.refusal.fields.code}>
          <Input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric"
                 autoComplete="one-time-code" error={local || verify.refusal.fields.code} autoFocus />
        </Field>
        {verify.refusal.message ? (
          <div className="banner" data-tone="bad">
            <div>
              <span>{verify.refusal.message}</span>
              {verify.result?.status === 409 ? (
                <span className="btn-row" style={{ marginTop: 8 }}><Button onClick={() => go('login')}>Go to login</Button></span>
              ) : null}
            </div>
          </div>
        ) : null}
        {resend.result ? (
          <p className="banner" data-tone={resent ? 'good' : 'bad'}>
            {resent ? `A new code was sent to ${email}.` : resend.refusal.message}
          </p>
        ) : null}
        <div className="toolbar">
          <Button icon={ArrowLeft} onClick={() => go('register')}>Back</Button>
          <Button type="submit" look="primary" icon={MailCheck} busy={verify.busy}>Verify</Button>
          <EndpointTag id="verify-email" name="Verify" look="primary" />
          <span className="toolbar-spacer" />
          <Button look="quiet" icon={RotateCw} busy={resend.busy} onClick={() => resend.run({ email })}>Resend code</Button>
          <EndpointTag id="resend-code" name="Resend" showPath={false} />
        </div>
      </form>
    </Card>
  )
}

function LoginStep({ person, setPerson, go }) {
  const { checkAccount } = useApi()
  const navigate = useNavigate()
  const login = useStep('login', 'Login')
  const [local, setLocal] = useState({})
  const [after, setAfter] = useState(null)
  const set = (key) => (event) => setPerson({ ...person, [key]: event.target.value })

  const submit = async () => {
    const problems = missing({ email: person.email, password: person.password })
    setLocal(problems)
    if (Object.keys(problems).length) return
    setAfter(null)
    const answer = await login.run({ email: person.email.trim(), password: person.password })
    if (!answer.ok) return
    // An invited account's temporary password: Cognito wants a permanent one first, and there is no
    // session yet — only the HttpOnly challenge cookie. The email goes in navigation state, not the URL.
    if (answer.bodyJson?.challenge === 'NEW_PASSWORD_REQUIRED') {
      setPerson({ ...person, password: '' })
      navigate(SET_PASSWORD_PATH, { state: { email: person.email.trim() } })
      return
    }
    // The cookies are set; the page holds nothing. Forget the password and ask who signed in.
    setPerson({ ...person, password: '' })
    const account = await checkAccount()
    if (!account.session?.authenticated) {
      setAfter('The login succeeded but no session came back. Are cookies blocked for this site?')
      return
    }
    if (!account.me) {
      setAfter(`Signed in, but GET /api/users/me answered ${account.meResult?.status ?? 'nothing'}.`)
      return
    }
    navigate(landingFor(account.me))
  }

  const errors = { ...login.refusal.fields, ...local }
  return (
    <Card title="3. Login" description="Sets the session as HttpOnly cookies, then opens onboarding or your dashboard. Invited by an administrator? Sign in with the temporary password from the invitation email — you will be asked to choose a permanent one.">
      <form className="stack auth-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Field label="Email" required error={errors.email}>
          <Input type="email" value={person.email} error={errors.email} onChange={set('email')} autoComplete="username" />
        </Field>
        <Field label="Password" required error={errors.password}>
          <Input type="password" value={person.password} error={errors.password} onChange={set('password')} autoComplete="current-password" />
        </Field>
        {login.refusal.message ? (
          <div className="banner" data-tone="bad">
            <div>
              <span>{login.refusal.message}</span>
              {login.result?.status === 403 ? (
                <span className="btn-row" style={{ marginTop: 8 }}><Button onClick={() => go('verify')}>Verify the email</Button></span>
              ) : null}
            </div>
          </div>
        ) : null}
        {after ? <p className="banner" data-tone="bad">{after}</p> : null}
        <div className="toolbar">
          <Button icon={ArrowLeft} onClick={() => go(person.email.trim() ? 'verify' : 'register')}>Back</Button>
          <Button type="submit" look="primary" icon={LogIn} busy={login.busy}>Log in</Button>
          <EndpointTag id="login" name="Login" look="primary" />
        </div>
      </form>
    </Card>
  )
}

/** Shown above the steps while a session exists: who, and where they belong. */
function SignedIn() {
  const { logout } = useApi()
  const { account } = useApiState()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const me = account.me

  return (
    <div className="banner" data-tone="good">
      <div>
        <span>
          <Badge tone="good">Signed in</Badge> <span className="mono">{me?.email || account.session?.email}</span>
          {me?.effectiveRole ? ` · ${me.effectiveRole}` : ''}{me?.onboardingStatus ? ` · ${me.onboardingStatus}` : ''}
        </span>
        <span className="btn-row" style={{ marginTop: 8 }}>
          {me ? <Button look="primary" icon={ArrowRight} onClick={() => navigate(landingFor(me))}>Continue</Button> : null}
          <Button icon={LogOut} busy={busy} onClick={async () => { setBusy(true); await logout(); setBusy(false) }}>
            Sign out to use another account
          </Button>
        </span>
      </div>
    </div>
  )
}
