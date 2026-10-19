import { Component } from 'react'

/**
 * Catches a screen that throws, so one broken screen stays one broken screen.
 *
 * WHY THIS EXISTS. Three times now a screen has read a field off null and taken the entire app
 * down with it — white page, nothing in the shell, the only clue in the browser console. Every
 * one was a one-line mistake: a guard on `loading` instead of on the data, an early return lost
 * in an edit. The mistakes will keep happening; the blank page does not have to.
 *
 * WHAT IT DOES NOT DO. It does not fix anything, and it is not a reason to be careless — a
 * caught error is still a bug. What it buys is that the sidebar, the navbar and every other
 * screen keep working, and the error is on the page instead of only in the console.
 *
 * A CLASS COMPONENT ON PURPOSE. `componentDidCatch` has no hook equivalent; this is the one
 * place React still requires one.
 *
 * KEYED ON THE ROUTE where it is used, so navigating away clears the error. Without that, one
 * throw would leave the boundary showing its panel for every screen you visited afterwards.
 */
export default class ScreenBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Still logged, because the stack is what actually gets it fixed and the panel below only
    // has room for the message.
    console.error('A screen threw and was caught by ScreenBoundary:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="page stack">
        <div className="page-head">
          <h1 className="page-title">This screen failed</h1>
          <p className="muted">
            The rest of the app still works — pick another screen from the side panel.
          </p>
        </div>
        <section className="card">
          <div className="resp">
            <div className="resp-head">
              <span className="resp-status" data-ok="false">{error.name || 'Error'}</span>
              <span className="toolbar-spacer" />
              <span>caught before it could blank the page</span>
            </div>
            <pre className="resp-body">{error.message}</pre>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            This is a bug in the screen, not something you did. The full stack is in the
            browser console.
          </p>
        </section>
      </div>
    )
  }
}
