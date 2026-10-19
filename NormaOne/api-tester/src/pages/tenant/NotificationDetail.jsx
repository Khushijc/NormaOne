import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { NotificationManager } from '../../components/NotificationParts.jsx'
import { tenantNotificationScope } from '../../components/notificationScopes.js'
import { screenPath } from '../../paths.js'

/**
 * Tenant admin › Notifications › one — read states, edit, attachment, archive. The id comes from the
 * address, so a reload or a link lands on the current record; another tenant's id answers 404.
 */
export default function NotificationDetail() {
  const { notificationId } = useParams()
  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('tenant', 'notifications', 'notifications')}><ChevronLeft size={13} /> Notifications</Link>
          <h1 className="page-title">A notification</h1>
          <p className="muted mono">{notificationId}</p>
        </div>
      </div>
      <NotificationManager scope={tenantNotificationScope} notificationId={notificationId} />
    </div>
  )
}
