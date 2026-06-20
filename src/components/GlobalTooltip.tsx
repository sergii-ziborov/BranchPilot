import { useEffect, useState } from 'react'

const SHOW_DELAY_MS = 450

interface TipState {
  text: string
  x: number
  y: number
  above: boolean
}

/**
 * App-wide styled tooltip. Reads `data-tooltip` or native `title` from any element,
 * suppressing the plain browser tooltip and rendering a fixed-position bubble that is
 * never clipped by scroll containers. No JSX changes needed — existing titles upgrade.
 */
export function GlobalTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let active: Element | null = null

    const tooltipText = (el: Element) =>
      el.getAttribute('data-tooltip') ?? el.getAttribute('data-native-title')

    const reveal = (el: Element) => {
      const text = tooltipText(el)
      if (!text) return
      const rect = el.getBoundingClientRect()
      // Keep the (center-anchored, max 280px wide) bubble fully on screen.
      const margin = 150
      const x = Math.min(Math.max(rect.left + rect.width / 2, margin), window.innerWidth - margin)
      // Flip above the element when there isn't room below (e.g. bottom-row buttons).
      const below = rect.bottom + 46 < window.innerHeight
      const y = below ? rect.bottom + 8 : rect.top - 8
      setTip({ text, x, y, above: !below })
    }

    const restoreTitle = (el: Element) => {
      const saved = el.getAttribute('data-native-title')
      if (saved !== null) {
        el.setAttribute('title', saved)
        el.removeAttribute('data-native-title')
      }
    }

    const hide = () => {
      if (active) restoreTitle(active)
      active = null
      if (timer) clearTimeout(timer)
      setTip(null)
    }

    const onEnter = (event: Event) => {
      const el = (event.target as Element | null)?.closest?.('[data-tooltip], [title]')
      if (!el || el === active) return
      if (active) restoreTitle(active)
      active = el

      // Suppress the native browser tooltip while ours is shown.
      const nativeTitle = el.getAttribute('title')
      if (nativeTitle !== null) {
        el.setAttribute('data-native-title', nativeTitle)
        el.removeAttribute('title')
      }

      if (timer) clearTimeout(timer)
      timer = setTimeout(() => reveal(el), SHOW_DELAY_MS)
    }

    const onLeave = (event: Event) => {
      const el = (event.target as Element | null)?.closest?.('[data-tooltip], [title], [data-native-title]')
      if (el && el === active) hide()
    }

    document.addEventListener('mouseover', onEnter)
    document.addEventListener('mouseout', onLeave)
    document.addEventListener('focusin', onEnter)
    document.addEventListener('focusout', onLeave)
    document.addEventListener('click', hide, true)
    window.addEventListener('blur', hide)

    return () => {
      if (timer) clearTimeout(timer)
      if (active) restoreTitle(active)
      document.removeEventListener('mouseover', onEnter)
      document.removeEventListener('mouseout', onLeave)
      document.removeEventListener('focusin', onEnter)
      document.removeEventListener('focusout', onLeave)
      document.removeEventListener('click', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  if (!tip) return null

  return (
    <div
      className={tip.above ? 'app-tooltip app-tooltip-above' : 'app-tooltip'}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  )
}
