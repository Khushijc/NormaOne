import { NoToken } from '../../components/Screen.jsx'
import { NotificationList } from '../../components/NotificationParts.jsx'
import { tenantNotificationScope } from '../../components/notificationScopes.js'
import { useRead } from '../../api/useRead.js'
import { Card } from '../../components/ui/Kit.jsx'

/**
 * Tenant admin › Notifications — send, list and open the organization's notifications (an ACTIVE
 * ADMIN of an ACTIVE tenant). The tenant is the caller's own: no id is sent, and a tenantId typed into a
 * body would be ignored. Notifications the platform sent are listed too, read only.
 */
export default function Notifications() {
  // Only to know whether a session exists; NotificationList reads the page itself.
  const probe = useRead('tenant-notif-list', { query: { page: 0, size: 1 }, label: 'List notifications', skip: true })
  if (probe.missingToken) {
    return <div className="page stack"><Card><NoToken needs="an ADMIN of an ACTIVE tenant" /></Card></div>
  }
  return (
    <div className="page stack">
      <div className="page-head">
        <h1 className="page-title">Notifications</h1>
        <p className="muted">Messages to your organization's members: chosen people, or everyone.</p>
      </div>
      <Card>
        <NotificationList scope={tenantNotificationScope} />
      </Card>
    </div>
  )
}
