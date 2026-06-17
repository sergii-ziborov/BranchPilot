import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Drop the macOS traffic-light title-bar inset while the window is in fullscreen
// (the controls are hidden there). The main process pushes the fullscreen state
// over IPC; the media query is a best-effort fallback.
const setFullscreenClass = (isFullscreen: boolean) => {
  document.documentElement.classList.toggle('is-fullscreen', isFullscreen)
}
window.branchPilot?.onFullscreenChange?.(setFullscreenClass)
const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)')
setFullscreenClass(fullscreenQuery.matches)
fullscreenQuery.addEventListener('change', () => setFullscreenClass(fullscreenQuery.matches))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
