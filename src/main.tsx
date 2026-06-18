import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Drop the macOS traffic-light title-bar inset while the window is in fullscreen
// (the controls are hidden there). Primary signal is the IPC push from the main
// process; the dimension check and media query are fallbacks so this still works
// even if the main process is running older code.
const setFullscreenClass = (isFullscreen: boolean) => {
  document.documentElement.classList.toggle('is-fullscreen', isFullscreen)
}

// In native fullscreen the web contents fill the whole display; windowed mode
// always loses the macOS menu bar (~24px) plus the title bar, so innerHeight
// stays well below the screen height.
const looksFullscreen = () => window.innerHeight >= window.screen.height - 8

let ipcReportedFullscreen: boolean | null = null
window.branchPilot?.onFullscreenChange?.((isFullscreen) => {
  ipcReportedFullscreen = isFullscreen
  setFullscreenClass(isFullscreen)
})

const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)')
const applyFallback = () => {
  // Defer to the authoritative IPC value once the main process has reported it.
  if (ipcReportedFullscreen !== null) return
  setFullscreenClass(fullscreenQuery.matches || looksFullscreen())
}
applyFallback()
fullscreenQuery.addEventListener('change', applyFallback)
window.addEventListener('resize', applyFallback)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
