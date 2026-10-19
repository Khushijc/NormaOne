import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BookOpen, FilePlus, Save, Send } from 'lucide-react'
import { useApi, useApiState } from '../../api/apiContext.js'
import JsonEditor from '../../components/JsonEditor.jsx'
import KeyValueEditor from '../../components/KeyValueEditor.jsx'
import ResponseView from '../../components/ResponseView.jsx'
import { Badge, Button, Card, Empty, Field, Input, Modal } from '../../components/ui/Kit.jsx'
import { ACCESS_LABEL, ALL_ENDPOINTS, API_CATALOG, findEndpoint } from '../../config/endpoints.js'
import { PROXY_TARGET } from '../../config/environments.js'
import { buildRequest } from '../../lib/httpClient.js'
import { describeExpiry, describeToken } from '../../lib/jwt.js'
import { frontendRefusal } from '../../lib/outcome.js'
import {
  blankDraft, draftFromEndpoint, draftFromLogEntry, matchEndpoint, METHODS, newId, resolveAuth, splitUrl,
  syncPathParams, validateDraft,
} from '../../lib/request.js'
import { store } from '../../lib/store.js'
import { screenPath } from '../../paths.js'

/**
 * Any request, by hand — the request builder the reference's README kept three UI primitives for.
 *
 * WHY IT EXISTS BESIDE THE SCREENS. The screens exercise each endpoint the way it is meant to be
 * used; this sends what the screens never would: an unknown field, a role the API refuses, a page
 * size of 500, a path id belonging to another tenant. Those refusals are most of what is worth
 * testing in an API, and a form that only lets you send valid input cannot reach them.
 *
 * WHAT IT WILL NOT SEND is anything the page can already tell is broken — invalid JSON, an empty
 * path parameter, an empty typed token — because the 400 that comes back would look like the backend's
 * answer when it is really the page's mistake. Those are reported as "Not sent", in a different
 * colour, with nothing in the network tab.
 *
 * The draft survives a reload (localStorage, credentials scrubbed). Ctrl+Enter sends.
 */
export default function Console() {
  const location = useLocation()
  // A fresh console for each "open this in the console" — but not for a plain sidebar click,
  // which should come back to whatever was being worked on, response included.
  return <ConsoleBody key={location.state ? location.key : 'console'} />
}

function initialDraft(state, log, saved) {
  if (state?.draft) return { ...blankDraft(), ...state.draft }
  if (state?.fromLog) {
    const entry = log.find((one) => one.id === state.fromLog)
    if (entry) return draftFromLogEntry(entry)
  }
  if (state?.savedId) {
    const one = saved.find((request) => request.id === state.savedId)
    if (one) return { ...blankDraft(), ...one, savedId: one.id, pathParams: syncPathParams(one.path, one.pathParams) }
  }
  const stored = store.loadDraft()
  if (stored?.method && typeof stored.path === 'string') return { ...blankDraft(), ...stored }
  return draftFromEndpoint(findEndpoint('me'))
}

const TABS = ['Params', 'Headers', 'Auth', 'Body']

function ConsoleBody() {
  const { send, saveRequest } = useApi()
  const { account, environment, log, saved } = useApiState()
  const location = useLocation()

  const [draft, setDraft] = useState(() => initialDraft(location.state, log, saved))
  const [urlError, setUrlError] = useState(null)
  const [tab, setTab] = useState(() => (draft.body && draft.method !== 'GET' ? 'Body' : 'Params'))
  const [problems, setProblems] = useState([])
  const [result, setResult] = useState(null)
  const [sending, setSending] = useState(false)
  const [naming, setNaming] = useState(false)

  useEffect(() => { store.saveDraft(draft) }, [draft])

  const matched = matchEndpoint(ALL_ENDPOINTS, draft.method, draft.path)
  const prepared = useMemo(
    () => buildRequest({ ...draft, auth: resolveAuth(draft) }, environment, {}),
    [draft, environment],
  )

  const set = (patch) => {
    setDraft((was) => ({ ...was, ...patch }))
    setProblems([])
  }

  const setPath = (path) => set({ path, pathParams: syncPathParams(path, draft.pathParams) })

  /** On leaving the URL box: a pasted full URL or a typed ?query is split into its parts. */
  const tidyUrl = () => {
    if (!draft.path.includes('?') && !/^[a-z]+:\/\//i.test(draft.path)) {
      setUrlError(draft.path.startsWith('/') ? null : 'The path must start with "/".')
      return
    }
    const split = splitUrl(draft.path)
    if (split.error) {
      setUrlError(split.error)
      return
    }
    setUrlError(null)
    set({
      path: split.path,
      pathParams: syncPathParams(split.path, draft.pathParams),
      queryParams: [...draft.queryParams, ...split.queryParams],
    })
  }

  const submit = async () => {
    const found = validateDraft(draft)
    if (urlError) found.unshift({ field: 'url', message: urlError })
    setProblems(found)
    if (found.length) {
      setResult(frontendRefusal(prepared, found))
      return
    }
    setSending(true)
    const answer = await send({ ...draft, endpointId: matched?.id || null }, {
      label: matched ? `${matched.name} (console)` : `${draft.method} ${draft.path}`,
    })
    setSending(false)
    setResult(answer)
  }

  // Ctrl+Enter (or Cmd+Enter) sends from anywhere on the page, the way most request tools do.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        document.getElementById('console-send')?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const startFrom = (id) => {
    const endpoint = findEndpoint(id)
    if (!endpoint) return
    setDraft(draftFromEndpoint(endpoint))
    setUrlError(null)
    setProblems([])
    setResult(null)
    setTab(endpoint.bodyAllowed ? 'Body' : 'Params')
  }

  const enabledQuery = draft.queryParams.filter((row) => row.enabled !== false && row.key).length
  const enabledHeaders = draft.headers.filter((row) => row.enabled !== false && row.key).length
  const count = { Params: draft.pathParams.length + enabledQuery, Headers: enabledHeaders }
  const problemIn = (field) => problems.some((one) => one.field === field)

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Request console</h1>
          <p className="muted">
            Any request to the backend, built by hand. Ctrl+Enter sends.
            {draft.savedId ? ` Editing a saved request: “${draft.name}”.` : ''}
          </p>
        </div>
        <span className="toolbar-spacer" />
        <Button icon={FilePlus} onClick={() => { setDraft(blankDraft()); setResult(null); setProblems([]); setUrlError(null) }}>
          New
        </Button>
        <Button icon={Save} onClick={() => setNaming(true)}>{draft.savedId ? 'Save…' : 'Save as…'}</Button>
      </div>

      <Card>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <label className="select">
            <span className="sr-only">Start from an endpoint</span>
            <select
              className="select-input"
              value=""
              onChange={(event) => startFrom(event.target.value)}
              aria-label="Start from an endpoint"
            >
              <option value="">Start from an endpoint…</option>
              {API_CATALOG.map((group) => (
                <optgroup key={group.id} label={group.module}>
                  {group.endpoints.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.method} {endpoint.path} — {endpoint.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <span className="toolbar-spacer" />
          {matched ? (
            <span className="console-match">
              <Badge tone="brand">{matched.name}</Badge>
              <Badge tone={matched.access === 'public' ? 'good' : 'warn'}>{ACCESS_LABEL[matched.access]}</Badge>
              <span className="muted">expects {matched.successStatus}</span>
              <Link className="picker-plain" to={`${screenPath('workbench', 'endpoints', 'endpoints')}#${matched.id}`}>
                <BookOpen size={12} /> reference
              </Link>
            </span>
          ) : (
            <span className="muted">Not an endpoint in the catalogue — it will still be sent.</span>
          )}
        </div>

        <div className="url-bar" data-invalid={problemIn('url') || urlError ? 'true' : undefined}>
          <label className="select url-method">
            <span className="sr-only">Method</span>
            <select
              className="select-input"
              data-method={draft.method}
              value={draft.method}
              onChange={(event) => set({ method: event.target.value })}
            >
              {METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
            </select>
          </label>
          <input
            className="input mono url-input"
            value={draft.path}
            onChange={(event) => setPath(event.target.value)}
            onBlur={tidyUrl}
            placeholder="/api/users/me"
            aria-label="URL"
            aria-invalid={urlError ? 'true' : undefined}
            spellCheck={false}
          />
          <Button id="console-send" look="primary" icon={Send} busy={sending} onClick={submit}>Send</Button>
        </div>
        {urlError ? <p className="field-error">{urlError}</p> : null}
        <p className="will-send mono" title="The request exactly as it will leave the page, and where the proxy forwards it">
          <span className="endpoint-tag-method" data-method={prepared.method}>{prepared.method}</span>
          {PROXY_TARGET}{prepared.path}
          <span className="muted"> · {Object.keys(prepared.headers).length} header{Object.keys(prepared.headers).length === 1 ? '' : 's'}
            {prepared.authType === 'bearer' ? ', typed Bearer token' : prepared.authType === 'session' ? ', session cookies' : ', no credentials'}
            {prepared.body ? `, ${prepared.body.length} chars of body` : ''}</span>
        </p>

        {problems.length ? (
          <ul className="problem-list">
            {problems.map((one, index) => <li key={index}>{one.message}</li>)}
          </ul>
        ) : null}

        <div className="segmented console-tabs" role="tablist" aria-label="Request parts">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className="segmented-item"
              data-active={tab === name || undefined}
              data-problem={problemIn(name === 'Params' ? 'pathParams' : name.toLowerCase()) || (name === 'Params' && problemIn('queryParams')) || undefined}
              onClick={() => setTab(name)}
            >
              {name}
              {count[name] ? <span className="module-nav-count">{count[name]}</span> : null}
            </button>
          ))}
        </div>

        <div className="console-pane">
          {tab === 'Params' ? (
            <div className="stack" style={{ gap: 14 }}>
              {draft.pathParams.length ? (
                <div className="field-grid">
                  {draft.pathParams.map((param, index) => (
                    <Field
                      key={param.name}
                      label={`{${param.name}}`}
                      required
                      hint={matched?.pathParams.find((one) => one.name === param.name)?.description}
                      error={problemIn('pathParams') && !param.value.trim() ? 'Required — it is part of the path.' : null}
                    >
                      <Input
                        className="input mono"
                        value={param.value}
                        error={problemIn('pathParams') && !param.value.trim()}
                        onChange={(event) => set({
                          pathParams: draft.pathParams.map((one, i) => (i === index ? { ...one, value: event.target.value } : one)),
                        })}
                      />
                    </Field>
                  ))}
                </div>
              ) : (
                <p className="muted">No path parameters. Write one as <span className="mono">{'{name}'}</span> in the URL.</p>
              )}
              <div className="field-split">Query parameters</div>
              <KeyValueEditor
                rows={draft.queryParams}
                onChange={(queryParams) => set({ queryParams })}
                hints={Object.fromEntries((matched?.queryParams || []).map((one) => [one.key, one.description]))}
                addLabel="Add parameter"
              />
            </div>
          ) : null}

          {tab === 'Headers' ? (
            <div className="stack" style={{ gap: 10 }}>
              <KeyValueEditor rows={draft.headers} onChange={(headers) => set({ headers })} addLabel="Add header" />
              <p className="muted">
                Authorization is set on the Auth tab. One typed here as well wins, and is never saved.
              </p>
            </div>
          ) : null}

          {tab === 'Auth' ? (
            <AuthPane draft={draft} set={set} account={account} endpoint={matched} />
          ) : null}

          {tab === 'Body' ? (
            <JsonEditor
              value={draft.body}
              onChange={(body) => set({ body })}
              disabled={['GET', 'HEAD'].includes(draft.method)}
              disabledNote={`${draft.method} sends no body. Switch the method to POST, PUT, PATCH or DELETE to write one.`}
            />
          ) : null}
        </div>
      </Card>

      <Card title="Response">
        {sending ? (
          <Empty title="Waiting for the backend…" description={`${prepared.method} ${PROXY_TARGET}${prepared.path}`} />
        ) : result ? (
          <ResponseView result={result} />
        ) : (
          <Empty
            title="Nothing sent yet"
            description="Send the request above. The status, body, headers and timing appear here, and every call also goes to History."
          />
        )}
      </Card>

      {/* Mounted only while open, so the name box starts from the draft each time it opens. */}
      {naming ? <SaveModal
        draft={draft}
        onClose={() => setNaming(false)}
        onSave={(name, asNew) => {
          // Keep the id on the draft, so a second Save updates this entry rather than adding another.
          const id = !asNew && draft.savedId ? draft.savedId : newId()
          const request = { ...draft, name, id, endpointId: matched?.id || null }
          delete request.savedId
          saveRequest(request)
          setNaming(false)
          set({ name, savedId: id })
        }}
        saved={saved}
      /> : null}
    </div>
  )
}

/**
 * How the request authenticates. The session is the browser's HttpOnly cookies — sent or not, never
 * read. A typed Bearer token is for a one-off request as some other account; it lives in this form
 * and is removed before the draft or a saved request is written anywhere.
 */
function AuthPane({ draft, set, account, endpoint }) {
  const type = draft.auth?.type === 'active' ? 'session' : (draft.auth?.type || 'session')
  const typed = type === 'bearer' && draft.auth?.token ? describeToken(draft.auth.token) : null
  const choose = (next) => set({ auth: next === 'bearer' ? { type: 'bearer', token: draft.auth?.token || '' } : { type: next } })
  const signedIn = account.session?.authenticated

  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="check">
        <input type="radio" name="auth" checked={type === 'session'} onChange={() => choose('session')} />
        <span>
          <strong>Session</strong>{' '}
          <span className="muted">
            {signedIn
              ? `— the browser sends its session cookies (${account.me?.email || account.session.email}). The page never sees the token.`
              : '— no session: sign in first, or this answers 401.'}
          </span>
        </span>
      </label>
      <label className="check">
        <input type="radio" name="auth" checked={type === 'none'} onChange={() => choose('none')} />
        <span><strong>No auth</strong> <span className="muted">— no cookies and no Authorization header. A protected endpoint answers 401.</span></span>
      </label>
      <label className="check">
        <input type="radio" name="auth" checked={type === 'bearer'} onChange={() => choose('bearer')} />
        <span><strong>Bearer token</strong> <span className="muted">— typed here, sent without the session cookies, never saved.</span></span>
      </label>
      {type === 'bearer' ? (
        <>
          <textarea
            className="textarea mono"
            rows={3}
            value={draft.auth.token || ''}
            onChange={(event) => set({ auth: { type: 'bearer', token: event.target.value } })}
            placeholder="eyJraWQiOi…  (from a non-browser login: X-Token-Delivery: body)"
            spellCheck={false}
            aria-label="Bearer token"
          />
          {typed ? (
            <p className={typed.valid && !typed.expired ? 'muted' : 'field-error'}>
              {typed.valid ? `${(typed.kind || 'jwt').toUpperCase()} token for ${typed.email || typed.subject} — ${describeExpiry(typed)}` : typed.problem}
            </p>
          ) : null}
        </>
      ) : null}
      {endpoint?.access === 'public' && type === 'bearer' ? (
        <p className="banner" data-tone="warn">
          {endpoint.path} is public, and a Bearer token sent to it is still validated: an expired one turns this
          into a 401. The session cookie, by contrast, is ignored there.
        </p>
      ) : null}
      {endpoint && endpoint.access !== 'public' ? (
        <p className="muted">Needs: {ACCESS_LABEL[endpoint.access]}.</p>
      ) : null}
    </div>
  )
}

function SaveModal({ draft, onClose, onSave, saved }) {
  const [name, setName] = useState(draft.name || `${draft.method} ${draft.path}`)
  const existing = draft.savedId ? saved.find((one) => one.id === draft.savedId) : null

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Save request' : 'Save as a new request'}
      description="Kept in this browser. The Authorization header and any typed token are removed before saving."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {existing ? <Button disabled={!name.trim()} onClick={() => onSave(name.trim(), true)}>Save as new</Button> : null}
          <Button look="primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), false)}>
            {existing ? 'Save changes' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </Field>
    </Modal>
  )
}
