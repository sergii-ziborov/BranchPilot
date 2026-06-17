import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Drop the macOS traffic-light title-bar inset while the window is in fullscreen
// (the controls are hidden there). Renderer-side so it applies without an
// Electron restart; the main process also toggles this class on native events.
const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)')
const applyFullscreenClass = () => {
  document.documentElement.classList.toggle('is-fullscreen', fullscreenQuery.matches)
}
applyFullscreenClass()
fullscreenQuery.addEventListener('change', applyFullscreenClass)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
