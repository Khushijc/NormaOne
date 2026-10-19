import { Button, Modal } from './ui/Kit.jsx'

/**
 * "Are you sure?" before a destructive or irreversible request: removing access, deactivating or
 * archiving a plan, rejecting or approving a request. The request is sent only from the confirm
 * button; closing, Escape or Cancel sends nothing. `children` holds anything the decision needs
 * (a reason, a note, an acknowledgement) and `disabled` keeps the confirm button off until it is given.
 */
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', look = 'danger', busy, disabled,
  onConfirm, onCancel, endpoint, error, children }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      endpoint={endpoint}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button look={look} busy={busy} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        {error ? <p className="banner" data-tone="bad">{error}</p> : null}
        {children}
      </div>
    </Modal>
  )
}
