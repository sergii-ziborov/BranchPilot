import { useEffect, useState } from 'react'

export const APP_THEMES: { id: string; label: string; dot: string }[] = [
  { id: 'github-light', label: 'GitHub Light', dot: '#2563eb' },
  { id: 'github-dark', label: 'GitHub Dark', dot: '#2f81f7' },
  { id: 'pure-dark', label: 'Pure Dark', dot: '#050505' },
  { id: 'one-dark-pro', label: 'One Dark Pro', dot: '#61afef' },
  { id: 'dracula', label: 'Dracula', dot: '#bd93f9' },
  { id: 'monokai', label: 'Monokai', dot: '#a6e22e' },
  { id: 'nord', label: 'Nord', dot: '#88c0d0' },
  { id: 'night-owl', label: 'Night Owl', dot: '#82aaff' },
  { id: 'tokyo-night', label: 'Tokyo Night', dot: '#7aa2f7' },
  { id: 'deus-ex', label: 'Deus Ex', dot: '#f2c94c' },
  { id: 'cyberpunk', label: 'Cyberpunk', dot: '#fcee0a' },
  { id: 'matrix', label: 'Matrix', dot: '#00ff6a' },
  { id: 'far-manager', label: 'FAR Manager', dot: '#00a2ff' },
  { id: 'solarized-light', label: 'Solarized Light', dot: '#268bd2' }
]

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
    return saved && APP_THEMES.some((themeOption) => themeOption.id === saved) ? saved : 'github-light'
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
