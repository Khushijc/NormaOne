import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CopyPlus, Download, SquareTerminal, Trash2, Upload } from 'lucide-react'
import { useApi, useApiState } from '../../api/apiContext.js'
import { Badge, Button, Card, Empty } from '../../components/ui/Kit.jsx'
import { exportSaved, newId, parseImport } from '../../lib/request.js'
import { CONSOLE_PATH } from '../../paths.js'

/**
 * Requests saved from the console, kept in this browser.
 *
 * Opening one loads it into the console, where Save updates it in place. Duplicate makes an
 * editable copy, which is how a variation — the same call with a role the API refuses — is kept
 * next to the original.
 *
 * Export writes them to a JSON file and Import reads one back, so a set can be shared or moved to
 * another browser. Nothing exported carries a credential: the Authorization header and any typed
 * token were removed when each request was saved, and every request follows the importer's own
 * top-bar token.
 */
export default function Saved() {
  const { saveRequest, deleteRequest, importRequests } = useApi()
  const { saved } = useApiState()
  const navigate = useNavigate()
  const file = useRef(null)
  const [notice, setNotice] = useState(null)

  const download = () => {
    const blob = new Blob([exportSaved(saved)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `normaone-saved-requests-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const upload = async (event) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    const parsed = parseImport(await chosen.text())
    if (parsed.error) {
      setNotice({ tone: 'bad', text: `${chosen.name}: ${parsed.error}` })
      return
    }
    importRequests(parsed.requests)
    setNotice({ tone: 'good', text: `Imported ${parsed.requests.length} request${parsed.requests.length === 1 ? '' : 's'} from ${chosen.name}.` })
  }

  return (
    <div className="page stack">
      <div className="page-head toolbar">
        <div>
          <h1 className="page-title">Saved requests</h1>
          <p className="muted">{saved.length} saved in this browser. Save one from the console.</p>
        </div>
        <span className="toolbar-spacer" />
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={upload} />
        <Button icon={Upload} onClick={() => file.current?.click()}>Import</Button>
        <Button icon={Download} disabled={!saved.length} onClick={download}>Export</Button>
      </div>

      {notice ? <p className="banner" data-tone={notice.tone}>{notice.text}</p> : null}

      <Card>
        {saved.length === 0 ? (
          <Empty
            title="Nothing saved yet"
            description="Build a request in the console and press Save as…, or import an exported file."
            action={<Button icon={SquareTerminal} onClick={() => navigate(CONSOLE_PATH)}>Open the console</Button>}
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Request</th>
                  <th>Auth</th>
                  <th>Saved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {saved.map((request) => (
                  <tr key={request.id}>
                    <td>{request.name || '—'}</td>
                    <td>
                      <span className="endpoint-tag">
                        <span className="endpoint-tag-method" data-method={request.method}>{request.method}</span>
                        <span className="endpoint-tag-path">{request.path}</span>
                      </span>
                    </td>
                    <td><Badge>{request.auth?.type === 'none' ? 'none' : request.auth?.type === 'bearer' ? 'typed (blank)' : 'top bar'}</Badge></td>
                    <td className="muted">{request.savedAt ? new Date(request.savedAt).toLocaleString() : '—'}</td>
                    <td>
                      <div className="btn-row">
                        <Button icon={SquareTerminal} onClick={() => navigate(CONSOLE_PATH, { state: { savedId: request.id } })}>Open</Button>
                        <Button
                          icon={CopyPlus}
                          onClick={() => saveRequest({ ...request, id: newId(), name: `${request.name || 'Request'} (copy)` })}
                        >
                          Duplicate
                        </Button>
                        <Button look="danger" icon={Trash2} onClick={() => deleteRequest(request.id)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
