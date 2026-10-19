import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { NotificationManager } from '../../components/NotificationParts.jsx'
import { platformNotificationScope } from '../../components/notificationScopes.js'
import { Card, Empty } from '../../components/ui/Kit.jsx'
import { screenPath } from '../../paths.js'

/**
 * Super admin › Notifications › one. The organization comes from ?tenant= in the address; a
 * notification of another organization answers 404 through this one's route.
 */
export default function NotificationDetail() {
  const { notificationId } = useParams()
  const [params] = useSearchParams()
  const tenantId = params.get('tenant') || ''
  const back = `${screenPath('platform', 'notifications', 'notifications')}${tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''}`

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={back}><ChevronLeft size={13} /> Notifications</Link>
          <h1 className="page-title">A notification</h1>
          <p className="muted mono">{notificationId}{tenantId ? ` · organization ${tenantId}` : ''}</p>
        </div>
      </div>
      {tenantId
        ? <NotificationManager scope={platformNotificationScope(tenantId)} notificationId={notificationId} />
        : <Card><Empty title="Which organization?" description="Open the notification from its organization's list, so the address carries ?tenant=." /></Card>}
    </div>
  )
}
