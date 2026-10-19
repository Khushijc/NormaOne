import { Link } from 'react-router-dom'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { ModuleSummary } from '../../components/ModuleParts.jsx'
import { Facts, NoToken, Problem, Raw, StatusBadge } from '../../components/Screen.jsx'
import { when } from '../../lib/forms.js'
import { Badge, Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { screenPath } from '../../paths.js'

/**
 * Account › Me — who the backend thinks the token belongs to.
 *
 * TWO READS THAT LOOK ALIKE AND ARE NOT. /api/users/me is the profile, and calling it is also what
 * LINKS a pending invitation — so the first call by an invited user changes their record from
 * INVITED to ACTIVE. /api/onboarding/status only reports. Both are shown so the difference between
 * "what the account is" and "what it still has to do" is visible side by side.
 *
 * Before onboarding there is no user record at all: the answer is 200 with onboardingStatus
 * NOT_STARTED, not a 404, and that is the state that sends the user to the onboarding screen.
 */
export default function Me() {
  const me = useRead('me', { label: 'Who am I' })
  const status = useRead('onboarding-status', { label: 'Onboarding status' })
  // Only for the modules' names and the count; the modules themselves come from /me.
  const catalogue = useRead('modules-catalog', { label: 'Module catalogue', skip: !me.data?.effectiveRole })

  if (me.missingToken) {
    return (
      <div className="page stack">
        <Card><NoToken needs="any valid token" /></Card>
      </div>
    )
  }

  const profile = me.data
  const state = status.data

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">{profile?.name || profile?.email || 'Me'}</h1>
          <p className="muted">As the backend sees the signed-in session.</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={me.loading || status.loading} onClick={() => { me.reload(); status.reload() }}>Refresh</Button>
      </div>

      {profile?.requiresTenantSetup ? (
        <p className="banner" data-tone="warn">
          <span>
            This account has no organization yet ({profile.onboardingStatus}).{' '}
            <Link className="inline-link" to={screenPath('account', 'me', 'onboarding')}>Create one <ArrowRight size={12} /></Link>
          </span>
        </p>
      ) : null}

      <Card title="Profile" action={<EndpointTag id="me" name="Who am I" />}>
        {me.result && !me.result.ok ? <Problem result={me.result} onRetry={me.reload} /> : profile ? (
          <div className="stack">
            <Facts rows={[
              ['Effective role', profile.effectiveRole ? <Badge key="r" tone="brand">{profile.effectiveRole}</Badge> : 'none'],
              ['Status', <StatusBadge key="s" status={profile.status} />],
              ['Account type', profile.accountType],
              ['Onboarding', profile.onboardingStatus],
              ['Email', profile.email],
              ['Phone', profile.phoneNumber],
              ['Organization', profile.organizationName],
              ['Subdomain', profile.subdomain && <span key="d" className="mono">{profile.subdomain}</span>],
              ['Tenant status', <StatusBadge key="t" status={profile.tenantStatus} />],
              ['Stored roles', profile.roles?.join(', ')],
              ['Module permissions now', profile.modulePermissions?.length ? profile.modulePermissions.join(', ') : 'none', true],
              ['User id', profile.userId && <span key="u" className="mono">{profile.userId}</span>],
              ['Tenant id', profile.tenantId && <span key="t" className="mono">{profile.tenantId}</span>],
              ['Cognito sub', profile.cognitoSub && <span key="c" className="mono">{profile.cognitoSub}</span>],
              ['Created', when(profile.createdAt)],
            ]} />
            <Raw data={profile} />
          </div>
        ) : <Empty title="Reading the profile…" />}
      </Card>

      {profile && profile.accountType !== 'NONE' ? (
        <Card
          title="My modules"
          description={profile.accountType === 'PLATFORM'
            ? 'A Super Admin is a platform account: it belongs to no organization and has no application module.'
            : `${profile.modules?.length ?? 0}${catalogue.data ? ` of ${catalogue.data.length}` : ''} modules available now (modules), `
              + 'each with the module permissions allowed now (modulePermissions) — the backend checks every request.'}
          action={<><EndpointTag id="me" name="From Who am I" /><EndpointTag id="modules-catalog" name="Catalogue" /></>}
        >
          <ModuleSummary
            modules={profile.modules}
            permissions={profile.modulePermissions}
            catalogue={catalogue.data}
            empty={profile.accountType === 'PLATFORM' ? 'None — platform account.' : 'No module is available to this account now (none assigned, or the account or organization is not ACTIVE).'}
          />
        </Card>
      ) : null}

      <Card title="Onboarding status" action={<EndpointTag id="onboarding-status" name="Onboarding status" />}>
        {status.result && !status.result.ok ? <Problem result={status.result} onRetry={status.reload} /> : state ? (
          <div className="stack">
            <Facts rows={[
              ['Completed', state.onboardingCompleted ? 'yes' : 'no'],
              ['Status', state.onboardingStatus],
              ['Needs tenant setup', state.requiresTenantSetup ? 'yes' : 'no'],
              ['Account type', state.accountType],
              ['Role', state.role],
              ['User status', <StatusBadge key="u" status={state.userStatus} />],
              ['Tenant status', <StatusBadge key="t" status={state.tenantStatus} />],
              ['Package', state.packageCode],
              ['Subscription', <StatusBadge key="p" status={state.subscriptionStatus} />],
            ]} />
            <Raw data={state} />
          </div>
        ) : <Empty title="Reading the onboarding status…" />}
      </Card>
    </div>
  )
}
