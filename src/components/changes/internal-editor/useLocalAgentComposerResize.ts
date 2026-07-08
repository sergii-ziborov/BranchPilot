import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'

const AGENT_COMPOSER_STORAGE_KEY = 'branchpilot:changes-agent-composer-width'
const DEFAULT_AGENT_COMPOSER_WIDTH = 360
const MIN_AGENT_COMPOSER_WIDTH = 240
const MAX_AGENT_COMPOSER_WIDTH = 720
const MIN_AGENT_OUTPUT_WIDTH = 300
const AGENT_COMPOSER_SPLITTER_WIDTH = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampComposerWidth(width: number, containerWidth?: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(MIN_AGENT_COMPOSER_WIDTH, containerWidth - AGENT_COMPOSER_SPLITTER_WIDTH - MIN_AGENT_OUTPUT_WIDTH)
    : MAX_AGENT_COMPOSER_WIDTH

  return Math.round(clamp(width, MIN_AGENT_COMPOSER_WIDTH, Math.min(MAX_AGENT_COMPOSER_WIDTH, maxForContainer)))
}

function readStoredComposerWidth(): number {
  try {
    const rawWidth = window.localStorage.getItem(AGENT_COMPOSER_STORAGE_KEY)
    if (rawWidth === null) return DEFAULT_AGENT_COMPOSER_WIDTH

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampComposerWidth(stored)
  } catch {
    /* ignore unavailable storage */
  }

  return DEFAULT_AGENT_COMPOSER_WIDTH
}

export function useLocalAgentComposerResize() {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [composerWidth, setComposerWidth] = useState(readStoredComposerWidth)

  const composerStyle = {
    '--changes-agent-composer-width': `${composerWidth}px`
  } as CSSProperties

  useEffect(() => {
    const clampToBody = () => {
      const body = bodyRef.current
      if (!body) return
      setComposerWidth((width) => clampComposerWidth(width, body.getBoundingClientRect().width))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToBody)
    })
    window.addEventListener('resize', clampToBody)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToBody)
    }
  }, [])

  const persistComposerWidth = (width: number) => {
    try {
      window.localStorage.setItem(AGENT_COMPOSER_STORAGE_KEY, String(width))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const resizeComposer = (clientX: number) => {
    const body = bodyRef.current
    if (!body) return composerWidth

    const rect = body.getBoundingClientRect()
    const nextWidth = clampComposerWidth(clientX - rect.left, rect.width)
    setComposerWidth(nextWidth)
    return nextWidth
  }

  const nudgeComposer = (delta: number) => {
    const body = bodyRef.current
    const containerWidth = body?.getBoundingClientRect().width
    setComposerWidth((width) => {
      const nextWidth = clampComposerWidth(width + delta, containerWidth)
      persistComposerWidth(nextWidth)
      return nextWidth
    })
  }

  const startComposerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizeComposer(event.clientX)
    document.body.classList.add('is-resizing-agent-composer')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizeComposer(moveEvent.clientX)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-agent-composer')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistComposerWidth(latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const handleComposerResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgeComposer(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgeComposer(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setComposerWidth(MIN_AGENT_COMPOSER_WIDTH)
      persistComposerWidth(MIN_AGENT_COMPOSER_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const body = bodyRef.current
      const nextWidth = clampComposerWidth(MAX_AGENT_COMPOSER_WIDTH, body?.getBoundingClientRect().width)
      setComposerWidth(nextWidth)
      persistComposerWidth(nextWidth)
    }
  }

  return {
    bodyRef,
    composerWidth,
    composerStyle,
    startComposerResize,
    handleComposerResizeKeyDown,
    minComposerWidth: MIN_AGENT_COMPOSER_WIDTH,
    maxComposerWidth: MAX_AGENT_COMPOSER_WIDTH
  }
}
