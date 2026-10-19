import { useEffect, useMemo, useState } from 'react'
import { ThemeContext } from './themeContext.js'

const read = () => {
  try {
    const saved = localStorage.getItem('extej-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* private mode / blocked storage — fall through to the system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(read)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('extej-theme', theme)
    } catch {
      /* not persisting is acceptable */
    }
  }, [theme])

  const value = useMemo(
    () => ({ theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }),
    [theme],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
