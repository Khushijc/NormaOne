import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, MailCheck, MailOpen, Paperclip, RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { AudienceBadge, ReadBadge } from '../../components/NotificationParts.jsx'
import { senderOf } from '../../components/notificationScopes.js'
import { NoToken, Pager, Problem } from '../../components/Screen.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'
import Segmented from '../../components/ui/Segmented.jsx'
import { when } from '../../lib/forms.js'
import { detailPath } from '../../paths.js'

/**
 * Account › Notifications — the signed-in member's inbox (ADMIN or USER; a Super Admin has none).
 *
 * What is listed is the backend's decision: notifications that name this member, and their
 * organization's broadcasts sent on or after they joined. Each row carries only this member's own
 * read state — the recipient list never reaches a member. Opening one does not mark it read; the
 * button does, and only for this member.
 */
const FILTERS = ['ALL', 'UNREAD', 'READ']
const path = (id) => detailPath('account', 'notifications', 'inbox', id)

export default function Inbox() {
  const { call } = useApi()
  const [filter, setFilter] = useState('ALL')
  const [page, setPage] = useState(0)
  const [toggling, setToggling] = useState(null)
  const query = { filter, page, size: 20 }
  const read = useRead('notif-inbox', { query, label: 'My notifications' })
  const unread = useRead('notif-unread-count', { label: 'Unread count' })

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="a member of an organization (ADMIN or USER)" /></Card></div>
  }

  const toggle = async (n) => {
    setToggling(n.id)
    await call('notif-read-status', { pathParams: { notificationId: n.id }, body: { read: !n.readStatus }, quiet: true,
      label: n.readStatus ? 'Mark unread' : 'Mark read' })
    setToggling(null)
    read.reload()
    unread.reload()
  }
  const rows = read.data?.content ?? []
  const count = unread.data?.unreadCount

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="muted">{count == null ? 'Your messages from your organization and the platform.' : `${count} unread`}</p>
        </div>
        <span className="toolbar-spacer" />
        <EndpointTag id="notif-unread-count" name="Unread count" />
        <Button icon={RefreshCw} busy={read.loading} onClick={() => { read.reload(); unread.reload() }}>Refresh</Button>
      </div>

      <Card>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <Segmented label="Which" options={FILTERS} value={filter} onChange={(next) => { setFilter(next); setPage(0) }} />
          <span className="toolbar-spacer" />
          <EndpointTag id="notif-inbox" name="The inbox, as filtered" query={query} />
        </div>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : rows.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Subject</th><th>From</th><th>To</th><th>State</th><th>Received</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((n) => (
                    <tr key={n.id} data-unread={n.readStatus ? undefined : 'true'}>
                      <td className="inbox-subject">{n.attachment ? <Paperclip size={12} aria-label="Has an attachment" /> : null} {n.subject}</td>
                      <td>{senderOf(n.createdByRole)}</td>
                      <td><AudienceBadge audience={n.audience} /></td>
                      <td><ReadBadge read={n.readStatus} /></td>
                      <td className="muted">{when(n.createdAt)}</td>
                      <td>
                        <div className="btn-row">
                          <Button icon={n.readStatus ? MailOpen : MailCheck} busy={toggling === n.id} onClick={() => toggle(n)}>
                            {n.readStatus ? 'Mark unread' : 'Mark read'}
                          </Button>
                          <Link className="btn" to={path(n.id)}>Open <ChevronRight size={13} /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager data={read.data} onPage={setPage} />
          </>
        ) : (
          <Empty
            title={read.loading ? 'Reading your notifications…' : filter === 'ALL' ? 'No notifications yet' : `No ${filter.toLowerCase()} notifications`}
            description={read.loading ? null : 'Notifications your administrators send you, or your whole organization, appear here.'}
          />
        )}
      </Card>
    </div>
  )
}
