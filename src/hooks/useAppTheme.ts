import { useEffect, useState } from 'react'

export const APP_THEMES: { id: string; label: string; dot: string; description: string }[] = [
  { id: 'github-light', label: 'GitHub Light', dot: '#2563eb', description: 'Clean light' },
  { id: 'github-dark', label: 'GitHub Dark', dot: '#2f81f7', description: 'Clean dark' },
  { id: 'cisco-light', label: 'Cisco Light', dot: '#049fd9', description: 'Network lab light' },
  { id: 'cisco-dark', label: 'Cisco Dark', dot: '#00bceb', description: 'Network lab dark' },
  { id: 'cyberboard', label: 'Cyberboard', dot: '#7c3aed', description: 'BranchPilot cyberboard' },
  { id: 'cyberpunk', label: 'Cyberpunk', dot: '#fcee0a', description: 'Chrome neon' },
  { id: 'deus-ex', label: 'Deus Ex', dot: '#f2c94c', description: 'Amber HUD' },
  { id: 'matrix', label: 'Matrix', dot: '#00ff6a', description: 'Code rain' },
  { id: 'far-manager', label: 'FAR Manager', dot: '#00a2ff', description: 'Pascal console' }
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
