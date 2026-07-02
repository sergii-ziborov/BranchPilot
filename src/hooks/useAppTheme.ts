import { useEffect, useState } from 'react'
import { APP_THEMES, DEFAULT_APP_THEME, isAppThemeId } from '../styles/themes/registry'

export { APP_THEMES }

const THEME_KEY = 'bp-theme'

function normalizeThemeId(id: string | null) {
  if (!id) return DEFAULT_APP_THEME
  return isAppThemeId(id) ? id : DEFAULT_APP_THEME
}

function applyTheme(id: string) {
  const normalized = normalizeThemeId(id)
  const root = document.documentElement
  if (normalized === 'github-light') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', normalized)
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
    return normalizeThemeId(saved)
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
