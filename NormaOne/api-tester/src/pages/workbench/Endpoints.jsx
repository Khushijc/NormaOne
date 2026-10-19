import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SquareTerminal, Search } from 'lucide-react'
import EndpointTag from '../../components/EndpointTag.jsx'
import { CopyButton } from '../../components/ResponseView.jsx'
import { Badge, Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { ACCESS_LABEL, ALL_ENDPOINTS, API_CATALOG, LIVE_COUNT } from '../../config/endpoints.js'
import { PROXY_TARGET } from '../../config/environments.js'
import { draftFromEndpoint } from '../../lib/request.js'
import { CONSOLE_PATH } from '../../paths.js'

/**
 * Every endpoint, with what the source says about it: who may call it, what it takes, what comes
 * back and every way it refuses. The catalogue is config/endpoints.js; this is it, readable.
 *
 * "Open in console" starts a request from the entry — path, documented query parameters, example
 * body and the right auth for its access rule — so trying any endpoint is one click from reading
 * about it. Each card has an anchor (#id), which the console's "reference" link lands on.
 */
const ACCESS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'public', label: 'Public' },
  { id: 'token', label: 'Any token' },
  { id: 'ADMIN', label: 'ADMIN' },
  { id: 'SUPER_ADMIN', label: 'SUPER_ADMIN' },
]

const ACCESS_TONE = { public: 'good', token: undefined, ADMIN: 'warn', SUPER_ADMIN: 'bad' }

export default function Endpoints() {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [search, setSearch] = useState('')
  const [access, setAccess] = useState('all')

  // Land on the card the address names, once it has rendered.
  useEffect(() => {
    if (!hash) return
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' })
  }, [hash])

  const needle = search.trim().toLowerCase()
  const matches = (endpoint) => (access === 'all' || endpoint.access === access)
    && (!needle || [endpoint.name, endpoint.path, endpoint.method, endpoint.summary].some((text) => text.toLowerCase().includes(needle)))

  // The flat list, not group.endpoints: only ALL_ENDPOINTS has the optional parts filled in.
  const groups = API_CATALOG
    .map((group) => ({ ...group, shown: ALL_ENDPOINTS.filter((one) => one.groupId === group.id && matches(one)) }))
    .filter((group) => group.shown.length)

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Endpoint reference</h1>
          <p className="muted">
            {LIVE_COUNT} endpoints, read from the controllers, DTOs, services and SecurityConfig. Errors share one shape:
            {' '}<span className="mono">{'{timestamp, status, error, message, path[, fieldErrors]}'}</span>.
          </p>
        </div>
      </div>

      <Card>
        <div className="toolbar">
          <span className="search search-sm">
            <Search size={15} className="search-icon" aria-hidden="true" />
            <input
              className="search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, path or method"
              aria-label="Search endpoints"
            />
          </span>
          <div className="segmented" role="tablist" aria-label="Access">
            {ACCESS_FILTERS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="tab"
                className="segmented-item"
                data-active={access === one.id || undefined}
                onClick={() => setAccess(one.id)}
              >
                {one.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card><Empty title="No endpoint matches" description="Change the search or the access filter." /></Card>
      ) : groups.map((group) => (
        <section key={group.id} className="stack" style={{ gap: 12 }}>
          <h2 className="section-title">
            {group.module} <span className="muted">· {group.controller}</span>
          </h2>
          {group.shown.map((endpoint) => (
            <Card key={endpoint.id}>
              <article id={endpoint.id} className="endpoint-doc">
                <div className="card-head">
                  <div className="stack" style={{ gap: 6 }}>
                    <EndpointTag id={endpoint.id} />
                    <p>{endpoint.summary}</p>
                  </div>
                  <div className="card-head-tools">
                    <Badge tone={ACCESS_TONE[endpoint.access]}>{ACCESS_LABEL[endpoint.access]}</Badge>
                    <CopyButton label="URL" text={`${PROXY_TARGET}${endpoint.path}`} />
                    <Button
                      look="primary"
                      icon={SquareTerminal}
                      onClick={() => navigate(CONSOLE_PATH, { state: { draft: draftFromEndpoint(endpoint) } })}
                    >
                      Open in console
                    </Button>
                  </div>
                </div>

                <dl className="dl">
                  {endpoint.pathParams.length ? (
                    <div>
                      <dt className="dl-term">Path parameters</dt>
                      <dd className="dl-value mono">{endpoint.pathParams.map((one) => `{${one.name}}`).join(', ')}</dd>
                    </div>
                  ) : null}
                  {endpoint.requiredFields.length ? (
                    <div>
                      <dt className="dl-term">Required fields</dt>
                      <dd className="dl-value mono">{endpoint.requiredFields.join(', ')}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="dl-term">Success</dt>
                    <dd className="dl-value">{endpoint.successStatus}</dd>
                  </div>
                  {endpoint.fields ? (
                    <div className="dl-wide">
                      <dt className="dl-term">Fields</dt>
                      <dd className="dl-value">{endpoint.fields}</dd>
                    </div>
                  ) : null}
                  {endpoint.queryParams.length ? (
                    <div className="dl-wide">
                      <dt className="dl-term">Query parameters</dt>
                      <dd className="dl-value">
                        {endpoint.queryParams.map((one) => (
                          <span key={one.key} className="param-line"><span className="mono">{one.key}</span> — {one.description}</span>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                  <div className="dl-wide">
                    <dt className="dl-term">Response</dt>
                    <dd className="dl-value mono">{endpoint.responseFields.join(', ')}</dd>
                  </div>
                  {endpoint.notes ? (
                    <div className="dl-wide">
                      <dt className="dl-term">Note</dt>
                      <dd className="dl-value">{endpoint.notes}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="endpoint-doc-split">
                  {endpoint.body ? (
                    <div>
                      <p className="modal-pane-label">Example body</p>
                      <pre className="modal-json">{endpoint.body}</pre>
                    </div>
                  ) : null}
                  <div>
                    <p className="modal-pane-label">Refusals</p>
                    <table className="kv-table">
                      <tbody>
                        {endpoint.errors.map((error, index) => (
                          <tr key={index}>
                            <th><Badge tone={error.status >= 500 ? 'bad' : error.status === 401 || error.status === 403 ? 'warn' : undefined}>{error.status}</Badge></th>
                            <td>{error.when}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </article>
            </Card>
          ))}
        </section>
      ))}
    </div>
  )
}
