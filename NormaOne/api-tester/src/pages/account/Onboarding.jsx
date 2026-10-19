import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { useApi, useApiState } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken } from '../../components/Screen.jsx'
import { filled, refusalOf } from '../../lib/forms.js'
import { landingFor } from '../../lib/landing.js'
import TenantFields from '../../components/TenantFields.jsx'
import { Badge, Button, Card } from '../../components/ui/Kit.jsx'

/**
 * Account › Onboarding — POST /api/onboarding/tenant, the one endpoint that turns a Cognito account
 * into a NormaOne user. Before it, the account exists only in Cognito and the users collection has
 * nothing for it; after it there is a tenant, a BASIC subscription and the caller as its ADMIN.
 *
 * THE FORM SITS BESIDE THE JSON IT WILL SEND, the reference's split view, recomputed on every
 * keystroke — what you are about to send matters more here than what you sent.
 *
 * Blank optionals are left out rather than sent as "": the backend would take "" as a value and
 * validate it. The administrator is the caller, from the token — there is no field for it, and
 * the Super Admin's create (which has one) is a different endpoint.
 *
 * It is idempotent for the same subdomain: sending it again returns the same tenant, which is why
 * the button is not disabled after a success.
 */
const BLANK = {
  organizationName: '', subdomain: '', countryCode: 'ES', defaultLocale: '', defaultTimeZone: '',
  accountHolderName: '', emailAddress: '', phoneNumber: '', addressLine: '', city: '', postalCode: '', logoUrl: '',
}

export default function Onboarding() {
  const { account } = useApiState()
  const status = useRead('onboarding-status', { label: 'Onboarding status' })
  const { state: arrival } = useLocation()

  if (status.missingToken) {
    return <div className="page stack"><Card><NoToken needs="a signed-in account" /></Card></div>
  }

  const state = status.data
  const me = account.me

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Create my organization</h1>
          <p className="muted">The caller becomes its ADMIN and it gets the BASIC package.</p>
        </div>
      </div>

      {arrival?.from ? (
        <p className="banner" data-tone="warn">
          <span>Finish onboarding first: <span className="mono">{arrival.from}</span> needs an organization and a role.</span>
        </p>
      ) : null}

      {state ? (
        <p className="banner" data-tone={state.requiresTenantSetup ? 'warn' : 'good'}>
          <span>
            <Badge tone={state.requiresTenantSetup ? 'warn' : 'good'}>{state.onboardingStatus}</Badge>{' '}
            {state.requiresTenantSetup
              ? 'This account has no organization yet — this is the step it needs.'
              : state.accountType === 'PLATFORM'
                ? 'A platform account: onboarding is refused with 403.'
                : `Already onboarded (tenant ${state.tenantId}). The same subdomain returns the same tenant; another one answers 409.`}
          </span>
        </p>
      ) : null}

      {/* Keyed on the account, so the form starts again from that account's name when it changes. */}
      <OnboardingForm key={me?.userId || me?.cognitoSub || 'anonymous'} holderName={me?.name} email={me?.email} />
    </div>
  )
}

/**
 * The form. accountHolderName starts as the signed-in user's name from GET /api/users/me — the
 * holder of the account the organization is opened for, which is the person onboarding. It stays
 * editable: CreateTenant/TenantOnboardingRequest accept any holder name up to 100 characters, and
 * the person signing up is not always the legal account holder. It is a field of the organization,
 * not the administrator — the administrator is always the caller, from the token.
 *
 * emailAddress starts as the same user's email — the registered, verified address the administrator
 * signs in with. It is what the backend would use anyway when the field is left blank
 * (OnboardingService.resolveContactEmail), shown so it can be seen and changed: an organization may
 * want a shared contact address rather than its administrator's.
 *
 * On success the account is read again from the backend and the page goes where that answer says,
 * so it is the backend, not this form, that decides onboarding is complete.
 */
function OnboardingForm({ holderName, email }) {
  const { call, checkAccount } = useApi()
  const navigate = useNavigate()
  const [form, setForm] = useState(() => ({ ...BLANK, accountHolderName: holderName ?? '', emailAddress: email ?? '' }))
  const [refusal, setRefusal] = useState({ fields: {}, message: null })
  const [busy, setBusy] = useState(false)
  const body = filled(form)

  const submit = async () => {
    setBusy(true)
    const result = await call('onboard-tenant', { label: 'Create my organization', body, quiet: true })
    setRefusal(refusalOf(result))
    if (!result.ok) {
      setBusy(false)
      return
    }
    const account = await checkAccount()
    setBusy(false)
    navigate(landingFor(account.me))
  }

  return (
    <Card>
      <div className="form-split">
        <div className="stack">
          {refusal.message ? <p className="banner" data-tone="bad">{refusal.message}</p> : null}
          <TenantFields form={form} onChange={setForm} errors={refusal.fields} mode="create" />
          <div className="toolbar">
            <Button look="primary" icon={Building2} busy={busy} onClick={submit}>Create my organization</Button>
            <EndpointTag id="onboard-tenant" name="Create my organization" look="primary" />
          </div>
        </div>
        <div className="form-split-preview">
          <p className="modal-pane-label">Request body</p>
          <pre className="modal-json" data-empty={Object.keys(body).length ? 'false' : 'true'}>
            {JSON.stringify(body, null, 2)}
          </pre>
        </div>
      </div>
    </Card>
  )
}
