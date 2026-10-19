import { useNavigate } from 'react-router-dom'
import { SquareTerminal } from 'lucide-react'
import { useApi, useApiState } from '../api/apiContext.js'
import { CONSOLE_PATH } from '../paths.js'
import ResponseView, { RequestPane } from './ResponseView.jsx'
import { Button, Modal } from './ui/Kit.jsx'

/** How the request authenticated — never the credential itself. */
const AUTH_SENT = {
  session: 'Sent with the session cookies.',
  bearer: 'Sent with a typed Bearer token, without the session cookies.',
  none: 'Sent without the session.',
}

/**
 * The request and the response of one call, in full. The reference's split modal: what was sent
 * on the left, what came back on the right.
 *
 * It opens by itself after anything that changes something — a POST, PUT, PATCH or DELETE —
 * because the answer to "did that work" should not need a second click. Reads stay quiet: they
 * run on page load, and the screen shows its own message when one fails.
 *
 * "Edit in console" carries the request over as a draft, so a call made from a screen can be
 * changed and resent by hand — the quickest way from "that 409 is odd" to trying a variation.
 */
export default function ResponseModal() {
  const { inspect } = useApi()
  const { inspecting } = useApiState()
  const navigate = useNavigate()
  if (!inspecting) return null

  const { result, method, path, action, endpointName, authMode } = inspecting

  const editInConsole = () => {
    inspect(null)
    navigate(CONSOLE_PATH, { state: { fromLog: inspecting.id } })
  }

  return (
    <Modal
      open
      onClose={() => inspect(null)}
      title={action || endpointName || `${method} ${path}`}
      description={AUTH_SENT[authMode] || 'Sent without the session.'}
      endpoint={
        <>
          <span className="endpoint-tag-method" data-method={method}>{method}</span>
          <span className="endpoint-tag-path">{result?.request?.url || path}</span>
        </>
      }
      previewLabel="Response"
      preview={<ResponseView result={result} tabs={['Body', 'Headers']} />}
      footer={
        <>
          <Button icon={SquareTerminal} onClick={editInConsole}>Edit in console</Button>
          <Button look="primary" onClick={() => inspect(null)}>Close</Button>
        </>
      }
    >
      <p className="modal-pane-label">Request</p>
      <RequestPane request={result?.request} />
    </Modal>
  )
}
