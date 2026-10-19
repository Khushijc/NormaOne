import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, SquareTerminal, Trash2 } from 'lucide-react'
import { useApi, useApiState } from '../../api/apiContext.js'
import { formatBytes } from '../../lib/forms.js'
import { Badge, Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { outcomeOf } from '../../lib/outcome.js'
import { CONSOLE_PATH } from '../../paths.js'

/**
 * Every call this tab has made, newest first — from the screens and the console alike.
 *
 * It is the reference's activity log given a screen of its own. In memory, like the reference's:
 * a log of responses holds personal data and the Authorization headers that produced it, which is
 * not something to leave in browser storage. The last 100 calls are kept until the tab closes.
 *
 * View opens the full request and response; Open in console makes it an editable draft, which is
 * how a call is repeated with one thing changed and the two answers compared here.
 */
const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'success', label: 'Success', test: (kind) => kind === 'success' },
  { id: 'auth', label: '401 / 403', test: (kind) => kind === 'auth' },
  { id: 'client', label: 'Other 4xx', test: (kind) => kind === 'client' },
  { id: 'server', label: '5xx & network', test: (kind) => kind === 'server' || kind === 'network' },
]

export default function History() {
  const { inspect, clearLog } = useApi()
  const { log } = useApiState()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')

  const test = FILTERS.find((one) => one.id === filter).test
  const rows = log.filter((entry) => test(outcomeOf(entry.result)?.kind))

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">History</h1>
          <p className="muted">{log.length} call{log.length === 1 ? '' : 's'} in this tab, newest first. Kept in memory only.</p>
        </div>
        <span className="toolbar-spacer" />
        <Button look="danger" icon={Trash2} disabled={!log.length} onClick={clearLog}>Clear</Button>
      </div>

      <Card>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <div className="segmented" role="tablist" aria-label="Outcome">
            {FILTERS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="tab"
                className="segmented-item"
                data-active={filter === one.id || undefined}
                onClick={() => setFilter(one.id)}
              >
                {one.label}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty
            title={log.length ? 'No call matches' : 'No calls yet'}
            description={log.length ? 'Pick another filter.' : 'Every request made from a screen or the console is listed here.'}
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Request</th>
                  <th>Status</th>
                  <th className="num">Time</th>
                  <th className="num">Size</th>
                  <th>Auth</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const outcome = outcomeOf(entry.result)
                  return (
                    <tr key={entry.id}>
                      <td className="muted">{new Date(entry.at).toLocaleTimeString()}</td>
                      <td>{entry.action}</td>
                      <td>
                        <span className="endpoint-tag">
                          <span className="endpoint-tag-method" data-method={entry.method}>{entry.method}</span>
                          <span className="endpoint-tag-path">{entry.path}</span>
                        </span>
                      </td>
                      <td><Badge tone={outcome.tone}>{entry.status || outcome.label}</Badge></td>
                      <td className="num">{Math.round(entry.durationMs)} ms</td>
                      <td className="num">{entry.status ? formatBytes(entry.sizeBytes) : '—'}</td>
                      <td className="muted">{entry.authMode === 'session' ? 'session' : entry.authMode === 'bearer' ? 'typed token' : 'none'}</td>
                      <td>
                        <div className="btn-row">
                          <Button icon={Eye} onClick={() => inspect(entry)}>View</Button>
                          <Button icon={SquareTerminal} onClick={() => navigate(CONSOLE_PATH, { state: { fromLog: entry.id } })}>
                            Open in console
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
