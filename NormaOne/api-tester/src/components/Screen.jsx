import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Eye, KeySquare, RefreshCw } from 'lucide-react'
import { useApi, useApiState } from '../api/apiContext.js'
import { STATUS_TONE } from '../config/enums.js'
import { hintFor, outcomeOf } from '../lib/outcome.js'
import { screenPath } from '../paths.js'
import { Badge, Button, Empty } from './ui/Kit.jsx'

/**
 * The pieces every screen is built from, beyond the reference's Kit: what a failed read looks
 * like, what "no token" looks like, a record as labelled values, and the raw JSON behind it.
 */

/** A read that failed, saying who decided — backend, network or the page — and what to do. */
export function Problem({ result, onRetry }) {
  const { inspect } = useApi()
  const { log } = useApiState()
  const outcome = outcomeOf(result)
  const entry = log.find((one) => one.result === result)
  const title = result.status
    ? `${result.status} ${result.bodyJson?.error || result.statusText || ''}`.trim()
    : result.error?.title || 'No reply'
  const message = result.bodyJson?.message || result.error?.message || result.bodyText || 'Nothing came back.'

  return (
    <Empty
      title={title}
      description={
        <>
          <span className="problem-origin">
            <Badge tone={outcome.tone}>{result.status ? 'Backend' : 'Network'}</Badge> {message}
          </span>
          {hintFor(result) || result.error?.hint ? (
            <span className="problem-hint">{hintFor(result) || result.error.hint}</span>
          ) : null}
        </>
      }
      action={
        <div className="btn-row">
          {onRetry ? <Button icon={RefreshCw} onClick={onRetry}>Try again</Button> : null}
          {entry ? <Button icon={Eye} onClick={() => inspect(entry)}>View the call</Button> : null}
        </div>
      }
    />
  )
}

/** What a protected screen shows without a session, instead of firing a call that can only 401. */
export function NoToken({ needs }) {
  return (
    <Empty
      title="Not signed in"
      description={`This screen needs ${needs}. Sign in: the backend keeps the session in HttpOnly cookies, so there is nothing to paste.`}
      action={
        <Link className="btn" data-look="primary" to={screenPath('account', 'auth', 'auth')}>
          <KeySquare size={13} /> Sign in
        </Link>
      }
    />
  )
}

/** A record as labelled values. `rows` is [label, value] pairs; a nullish value shows a dash. */
export function Facts({ rows }) {
  return (
    <dl className="dl">
      {rows.filter(Boolean).map(([label, value, wide]) => (
        <div key={label} className={wide ? 'dl-wide' : undefined}>
          <dt className="dl-term">{label}</dt>
          <dd className="dl-value" data-empty={value == null || value === '' ? 'true' : undefined}>
            {value == null || value === '' ? null : value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The response as it came, behind a disclosure — what the facts above were read from. */
export function Raw({ data, label = 'Raw response' }) {
  if (data == null) return null
  return (
    <details className="raw">
      <summary>{label}</summary>
      <pre className="resp-body">{JSON.stringify(data, null, 2)}</pre>
    </details>
  )
}

export function StatusBadge({ status }) {
  if (!status) return null
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>
}

/** "Page 2 of 5 · 93 total" and the two buttons, for a PageResponse. */
export function Pager({ data, onPage }) {
  if (!data) return null
  const last = Math.max(data.totalPages, 1) - 1
  return (
    <div className="toolbar" style={{ marginTop: 14 }}>
      <span className="muted">Page {data.page + 1} of {last + 1} · {data.totalElements} total</span>
      <span className="toolbar-spacer" />
      <div className="pager">
        <Button icon={ChevronLeft} disabled={data.page <= 0} onClick={() => onPage(data.page - 1)}>Previous</Button>
        <Button disabled={data.page >= last} onClick={() => onPage(data.page + 1)}>Next <ChevronRight size={13} /></Button>
      </div>
    </div>
  )
}
