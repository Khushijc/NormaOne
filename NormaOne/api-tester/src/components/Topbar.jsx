import { Menu, Moon, Server, Sun } from 'lucide-react'
import { useApiState } from '../api/apiContext.js'
import { useTheme } from '../theme/themeContext.js'
import SessionControl from './SessionControl.jsx'

/**
 * The top bar. The reference's, holding only what does something.
 *
 * THE BACKEND IS NAMED, NOT PICKED. There is one environment (see config/environments.js), so a
 * dropdown would be a control with one answer. What is worth seeing is where requests actually
 * end up — the proxy target — because "which backend did that 500 come from" is the first
 * question after any surprising answer.
 *
 * THE SESSION IS ON EVERY SURFACE, unlike the reference's school picker, which only made sense on
 * one. It shows who the backend says is signed in — never a token, which lives in HttpOnly cookies.
 */
export default function Topbar({ onMenuClick }) {
  const { theme, toggleTheme } = useTheme()
  const { environment } = useApiState()

  return (
    <header className="topbar">
      <button type="button" className="topbar-menu" onClick={onMenuClick} aria-label="Open navigation">
        <Menu size={20} />
      </button>

      <div className="topbar-actions">
        <span className="env-chip" title={environment.description}>
          <Server size={13} aria-hidden="true" />
          <span className="picker-label">{environment.name}</span>
          <span className="mono">{environment.target}</span>
        </span>
        <SessionControl />
        <button
          type="button"
          className="theme-toggle"
          role="switch"
          aria-checked={theme === 'dark'}
          onClick={toggleTheme}
        >
          <span className="sr-only">Dark mode</span>
          <span className="theme-toggle-knob" aria-hidden="true">
            {theme === 'dark' ? <Moon size={11} /> : <Sun size={11} />}
          </span>
        </button>
      </div>
    </header>
  )
}
