import { useEffect, useState } from 'react'
import { APP_THEMES, DEFAULT_APP_THEME, isAppThemeId } from '../styles/themes/registry'

export { APP_THEMES }

const THEME_KEY = 'bp-theme'

function applyTheme(id: string) {
  const root = document.documentElement
  if (id === 'github-light') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', id)
}

function syncChromeTheme() {
  const api = window.branchPilot
  if (!api?.setChromeTheme) return

  requestAnimationFrame(() => {
    const style = getComputedStyle(document.documentElement)
    const backgroundColor = style.getPropertyValue('--app-grad-top').trim() || '#f8fafc'
    const symbolColor = style.getPropertyValue('--text-strong').trim() || '#0f172a'
    void api.setChromeTheme({ backgroundColor, symbolColor })
  })
}

export function useAppTheme(): [string, (id: string) => void] {
  const [theme, setTheme] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null
    return saved && isAppThemeId(saved) ? saved : DEFAULT_APP_THEME
  })

  useEffect(() => {
    applyTheme(theme)
    syncChromeTheme()
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore unavailable storage */
    }
  }, [theme])

  return [theme, setTheme]
}
