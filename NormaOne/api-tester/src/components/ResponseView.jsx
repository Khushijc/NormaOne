import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { PROXY_TARGET } from '../config/environments.js'
import { copyText, toCurl } from '../lib/clipboard.js'
import { maskSecret } from '../lib/httpClient.js'
import { formatBytes } from '../lib/forms.js'
import { describeParts, pretty } from '../lib/json.js'
import { hintFor, outcomeOf } from '../lib/outcome.js'
import { Badge } from './ui/Kit.jsx'
import Segmented from './ui/Segmented.jsx'

/**
 * One response, in full: status, time, size, body, headers, and the request that produced it.
 *
 * Used by the console and by the pop-up every write opens, so a response reads the same wherever it
 * came from. It never assumes JSON: a text body is shown as text, an empty one says so, and a
 * failure with no HTTP answer at all says which kind of failure it was (see lib/outcome.js).
 */
const TABS = ['Body', 'Headers', 'Request']

export default function ResponseView({ result, tabs = TABS }) {
  const [tab, setTab] = useState(tabs[0])
  if (!result) return null

  const outcome = outcomeOf(result)
  const hint = hintFor(result)
  const fieldErrors = result.bodyJson?.fieldErrors

  return (
    <div className="resp-view">
      <div className="resp-head">
        <span className="resp-status" data-ok={result.ok ? 'true' : 'false'}>
          {result.status ? `${result.status} ${result.statusText || ''}`.trim() : outcome.label}
        </span>
        <Badge tone={outcome.tone}>{outcome.label}</Badge>
        {result.status ? <span>{Math.round(result.durationMs)} ms</span> : null}
        {result.status ? <span>{formatBytes(result.sizeBytes)}</span> : null}
        <span className="toolbar-spacer" />
        <CopyButton label="URL" text={() => result.request?.url ? new URL(result.request.url, PROXY_TARGET).href : ''} />
        <CopyButton label="cURL" text={() => toCurl(result.request, PROXY_TARGET)} />
        {result.bodyText ? <CopyButton label="Body" text={() => pretty(result.bodyText)} /> : null}
      </div>

      {result.error ? (
        <div className="banner" data-tone={result.error.kind === 'frontend' ? 'warn' : 'bad'}>
          <div>
            <strong>{originLabel(result)} — {result.error.title}</strong>
            <pre className="banner-pre">{result.error.message}</pre>
            {result.error.hint ? <p>{result.error.hint}</p> : null}
          </div>
        </div>
      ) : null}

      {result.status && hint && !result.ok ? (
        <p className="banner" data-tone={outcome.kind === 'auth' ? 'warn' : undefined}>
          <span><strong>Backend answered {result.status}.</strong> {hint}</span>
        </p>
      ) : null}

      {fieldErrors && typeof fieldErrors === 'object' ? (
        <table className="kv-table">
          <tbody>
            {Object.entries(fieldErrors).map(([field, message]) => (
              <tr key={field}><th className="mono">{field}</th><td>{String(message)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {tabs.length > 1 ? (
        <Segmented options={tabs} value={tab} onChange={setTab} label="Response details" />
      ) : null}

      {tab === 'Body' ? <BodyPane result={result} /> : null}
      {tab === 'Headers' ? <HeaderTable headers={result.headers} empty="No response headers — there was no HTTP answer." /> : null}
      {tab === 'Request' ? <RequestPane request={result.request} /> : null}
    </div>
  )
}

function originLabel(result) {
  if (result.error?.kind === 'frontend') return 'Frontend'
  if (result.status) return `Backend (${result.status})`
  return 'Network'
}

function BodyPane({ result }) {
  if (!result.status) return <pre className="modal-json" data-empty="true">No response body — nothing came back.</pre>
  if (!result.bodyText) {
    return <pre className="modal-json" data-empty="true">Empty body{result.status === 204 ? ' (204 No Content)' : ''}.</pre>
  }
  const contentType = result.headers?.['content-type'] || ''
  return (
    <>
      {result.jsonParseError && contentType.includes('json') ? (
        <p className="muted warn-text">Declared as JSON but does not parse: {result.jsonParseError}</p>
      ) : null}
      {!result.bodyJson && !contentType.includes('json') ? (
        <p className="muted">Not JSON ({contentType || 'no content type'}) — shown exactly as received.</p>
      ) : null}
      <pre className="modal-json resp-json">{result.bodyJson ? JSON.stringify(result.bodyJson, null, 2) : result.bodyText}</pre>
    </>
  )
}

export function RequestPane({ request }) {
  if (!request) return null
  const headers = Object.fromEntries(Object.entries(request.headers || {}).map(([key, value]) => [
    key,
    key.toLowerCase() === 'authorization' ? value.replace(/^(Bearer\s+)(.+)$/i, (_, p, t) => p + maskSecret(t)) : value,
  ]))
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="modal-endpoint" style={{ margin: 0 }}>
        <span className="endpoint-tag-method" data-method={request.method}>{request.method}</span>
        <span className="endpoint-tag-path">{request.url}</span>
      </div>
      <HeaderTable headers={headers} empty="No headers were sent." />
      <pre className="modal-json" data-empty={request.body ? 'false' : 'true'}>
        {request.formParts ? describeParts(request.formParts)
          : request.body ? pretty(request.body) : 'This request sent no body.'}
      </pre>
    </div>
  )
}

export function HeaderTable({ headers, empty }) {
  const rows = Object.entries(headers || {})
  if (!rows.length) return <p className="muted">{empty}</p>
  return (
    <table className="kv-table">
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key}><th className="mono">{key}</th><td className="mono">{value}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

/** Copies on click and says so for a moment, so a silent click is never mistaken for a dead one. */
export function CopyButton({ label, text }) {
  const [state, setState] = useState(null)
  const onClick = async () => {
    const done = await copyText(typeof text === 'function' ? text() : text)
    setState(done ? 'ok' : 'fail')
    setTimeout(() => setState(null), 1400)
  }
  return (
    <button type="button" className="ghost-btn ghost-btn-sm" onClick={onClick} title={`Copy ${label}`}>
      {state === 'ok' ? <Check size={12} /> : <Copy size={12} />}
      {state === 'fail' ? 'Copy failed' : label}
    </button>
  )
}
