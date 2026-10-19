import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, MailCheck, MailOpen, RefreshCw } from 'lucide-react'
import { useApi } from '../../api/apiContext.js'
import { useRead } from '../../api/useRead.js'
import EndpointTag from '../../components/EndpointTag.jsx'
import { AttachmentDownload, AudienceBadge, NotificationBody, ReadBadge } from '../../components/NotificationParts.jsx'
import { senderOf } from '../../components/notificationScopes.js'
import { Facts, NoToken, Problem, Raw } from '../../components/Screen.jsx'
import { Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { refusalOf, when } from '../../lib/forms.js'
import { screenPath } from '../../paths.js'

/**
 * Account › Notifications › one. Opening it does not mark it read — the backend keeps GET free of
 * side effects — so the page says so and offers the button. A notification this member may not see
 * (another organization's, archived, not addressed to them, or a broadcast from before they joined)
 * answers 404.
 */
export default function InboxDetail() {
  const { notificationId } = useParams()
  const { call } = useApi()
  const pathParams = { notificationId }
  const read = useRead('notif-get', { pathParams, label: 'Open a notification' })
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const n = read.data

  if (read.missingToken) {
    return <div className="page stack"><Card><NoToken needs="a member of an organization (ADMIN or USER)" /></Card></div>
  }

  const mark = async (value) => {
    setBusy(true)
    const result = await call('notif-read-status', { pathParams, body: { read: value }, label: value ? 'Mark read' : 'Mark unread' })
    setBusy(false)
    setRefusal(refusalOf(result).message)
    if (result.ok) read.reload()
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <Link className="back" to={screenPath('account', 'notifications', 'inbox')}><ChevronLeft size={13} /> Notifications</Link>
          <h1 className="page-title">{n?.subject || 'A notification'}</h1>
          <p className="muted">{n ? `${senderOf(n.createdByRole)} · ${when(n.createdAt)}` : notificationId}</p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={RefreshCw} busy={read.loading} onClick={read.reload}>Refresh</Button>
      </div>

      <Card action={<EndpointTag id="notif-get" name="Open" pathParams={pathParams} />}>
        {read.result && !read.result.ok ? <Problem result={read.result} onRetry={read.reload} /> : n ? (
          <div className="stack">
            <NotificationBody subject={n.subject} body={n.body} />
            <Facts rows={[
              ['Your state', <ReadBadge key="r" read={n.readStatus} />],
              ['Read at', when(n.readAt)],
              ['From', senderOf(n.createdByRole)],
              ['To', <AudienceBadge key="a" audience={n.audience} />],
              ['Received', when(n.createdAt)],
            ]} />
            <Raw data={n} />
          </div>
        ) : <Empty title="Reading the notification…" />}
      </Card>

      {n ? (
        <>
          <Card title="Attachment">
            <AttachmentDownload attachment={n.attachment} endpointId="notif-attachment" pathParams={pathParams} />
          </Card>
          <Card title="Read state" description="Yours only. Opening this page did not change it.">
            <div className="stack">
              {refusal ? <p className="banner" data-tone="bad">{refusal}</p> : null}
              <div className="toolbar">
                <ReadBadge read={n.readStatus} />
                <span className="toolbar-spacer" />
                <EndpointTag id="notif-read-status" name="Read state" pathParams={pathParams} />
                {n.readStatus
                  ? <Button icon={MailOpen} busy={busy} onClick={() => mark(false)}>Mark unread</Button>
                  : <Button look="primary" icon={MailCheck} busy={busy} onClick={() => mark(true)}>Mark read</Button>}
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
