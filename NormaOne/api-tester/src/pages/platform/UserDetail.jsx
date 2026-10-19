import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { UserFacts } from '../../components/UserParts.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { detailPath, screenPath } from '../../paths.js'

/**
 * Super admin › Users › one user — READ ONLY. One endpoint: open.
 *
 * Nothing on this page changes the user, because nothing in the Super Admin API can: profile, role
 * and status belong to their organization's administrators. An administrator's or a Super Admin's id
 * answers 404 here; administrators are on their own screen. The console is the place to send a
 * mutation anyway and see the 404/405 the backend answers.
 */
export default function UserDetail() {
  const { userId } = useParams()
  const read = useRead('sa-get-user', { pathParams: { userId }, label: 'Open a user' })
  const user = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="SUPER_ADMIN" /></Card></div>
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('platform', 'users', 'users')}><ChevronLeft size={13} /> Users</Link>
          <h1 className="page-title">{user?.name || 'A user'}</h1>
          <p className="muted mono">{userId}</p>
        </div>
        <span className="toolbar-spacer" />
        {user?.organization?.id ? (
          <Link className="btn" to={detailPath('platform', 'tenants', 'tenants', user.organization.id)}>Their organization</Link>
        ) : null}
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <Card title="The user" action={<EndpointTag id="sa-get-user" name="Open" pathParams={{ userId }} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : user ? (
          <div className="stack">
            <UserFacts user={user} />
            <Raw data={user} />
          </div>
        ) : <Empty title="Reading the user…" />}
      </Card>

      {user ? (
        <p className="banner">
          Read only. A regular user is managed by their organization's administrators; the Super Admin API has no
          route that changes one — <span className="mono">PATCH /api/super-admin/users/{'{id}'}/status</span> answers 404
          and any other method on the user answers 405.
        </p>
      ) : null}
    </div>
  )
}
