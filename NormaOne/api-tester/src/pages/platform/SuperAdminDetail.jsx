import { Link, useLocation, useParams } from 'react-router-dom'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useApiState } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { InvitationNotice, ResendInvitation } from '../../components/Invitation.jsx'
import { NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { StatusChange, UserFacts } from '../../components/UserParts.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { screenPath } from '../../paths.js'

/**
 * Super admin › Super Admins › one account — read it, resend a pending invitation, and remove
 * (DEACTIVATED) or restore its platform access, confirmed first. Your own account cannot be changed
 * here, and the backend refuses to leave the platform without an active Super Admin.
 */
export default function SuperAdminDetail() {
  const { superAdminId } = useParams()
  const { state: arrival } = useLocation()
  const { account } = useApiState()
  const read = useRead('sa-get-super-admin', { pathParams: { superAdminId }, label: 'Open a Super Admin' })
  const target = read.data
  const yourself = account.me?.userId && account.me.userId === superAdminId

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('platform', 'super-admins', 'super-admins')}><ChevronLeft size={13} /> Super Admins</Link>
          <h1 className="page-title">{target?.name || 'A Super Admin'}</h1>
          <p className="muted mono">{superAdminId}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <InvitationNotice info={arrival?.invitation} />

      <Card title="The account" action={<EndpointTag id="sa-get-super-admin" name="Open" pathParams={{ superAdminId }} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : target ? (
          <div className="stack">
            <UserFacts user={target} />
            <Raw data={target} />
          </div>
        ) : <Empty title="Reading the account…" />}
      </Card>

      {target?.status === 'INVITED' ? (
        <Card title="Invitation" description="Pending: the account has not set its permanent password yet.">
          <ResendInvitation endpointId="sa-resend-super-admin" pathParams={{ superAdminId }} onDone={read.reload} />
        </Card>
      ) : null}

      {target ? (
        <Card title="Platform access" description="Removing access is DEACTIVATED: the account is signed out and disabled in Cognito; the record and its history are kept and it can be restored.">
          {yourself
            ? <p className="banner" data-tone="warn">This is your own account: another Super Admin changes its status, never you.</p>
            : <StatusChange key={target.status} user={target} endpointId="sa-super-admin-status" pathParams={{ superAdminId }} onDone={read.reload} />}
        </Card>
      ) : null}
    </div>
  )
}
