import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'

const AGENT_PANEL_STORAGE_KEY = 'branchpilot:changes-agent-panel-height'
const DEFAULT_AGENT_PANEL_HEIGHT = 320
const MIN_AGENT_PANEL_HEIGHT = 180
const MAX_AGENT_PANEL_HEIGHT = 900
const MAX_AGENT_PANEL_HEIGHT_RATIO = 0.7

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampPanelHeight(height: number, containerHeight?: number): number {
  const maxForContainer = containerHeight && containerHeight > 0
    ? Math.max(MIN_AGENT_PANEL_HEIGHT, containerHeight * MAX_AGENT_PANEL_HEIGHT_RATIO)
    : MAX_AGENT_PANEL_HEIGHT

  return Math.round(clamp(height, MIN_AGENT_PANEL_HEIGHT, Math.min(MAX_AGENT_PANEL_HEIGHT, maxForContainer)))
}

function readStoredPanelHeight(): number {
  try {
    const rawHeight = window.localStorage.getItem(AGENT_PANEL_STORAGE_KEY)
    if (rawHeight === null) return DEFAULT_AGENT_PANEL_HEIGHT

    const stored = Number(rawHeight)
    if (Number.isFinite(stored)) return clampPanelHeight(stored)
  } catch {
    /* ignore unavailable storage */
  }

  return DEFAULT_AGENT_PANEL_HEIGHT
}

interface UseAgentPanelResizeResult {
  containerRef: RefObject<HTMLDivElement | null>
  agentPanelHeight: number
  agentPanelStyle: CSSProperties
  startAgentPanelResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleAgentPanelResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  minAgentPanelHeight: number
  maxAgentPanelHeight: number
}

export function useAgentPanelResize(): UseAgentPanelResizeResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [agentPanelHeight, setAgentPanelHeight] = useState(readStoredPanelHeight)

  const agentPanelStyle = {
    '--changes-agent-panel-height': `${agentPanelHeight}px`
  } as CSSProperties

  useEffect(() => {
    const clampToContainer = () => {
      const container = containerRef.current
      if (!container) return
      setAgentPanelHeight((height) => clampPanelHeight(height, container.getBoundingClientRect().height))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToContainer)
    })
    window.addEventListener('resize', clampToContainer)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToContainer)
    }
  }, [])

  const persistPanelHeight = (height: number) => {
    try {
      window.localStorage.setItem(AGENT_PANEL_STORAGE_KEY, String(height))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const nudgePanel = (delta: number) => {
    const container = containerRef.current
    const containerHeight = container?.getBoundingClientRect().height
    setAgentPanelHeight((height) => {
      const nextHeight = clampPanelHeight(height + delta, containerHeight)
      persistPanelHeight(nextHeight)
      return nextHeight
    })
  }

  const startAgentPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    const startY = event.clientY
    const startHeight = agentPanelHeight
    const containerHeight = containerRef.current?.getBoundingClientRect().height
    let latestHeight = startHeight
    document.body.classList.add('is-resizing-agent-panel')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = clampPanelHeight(startHeight + (moveEvent.clientY - startY), containerHeight)
      latestHeight = nextHeight
      setAgentPanelHeight(nextHeight)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-agent-panel')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistPanelHeight(latestHeight)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const handleAgentPanelResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      nudgePanel(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      nudgePanel(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setAgentPanelHeight(MIN_AGENT_PANEL_HEIGHT)
      persistPanelHeight(MIN_AGENT_PANEL_HEIGHT)
    } else if (event.key === 'End') {
      event.preventDefault()
      const container = containerRef.current
      const nextHeight = clampPanelHeight(MAX_AGENT_PANEL_HEIGHT, container?.getBoundingClientRect().height)
      setAgentPanelHeight(nextHeight)
      persistPanelHeight(nextHeight)
    }
  }

  return {
    containerRef,
    agentPanelHeight,
    agentPanelStyle,
    startAgentPanelResize,
    handleAgentPanelResizeKeyDown,
    minAgentPanelHeight: MIN_AGENT_PANEL_HEIGHT,
    maxAgentPanelHeight: MAX_AGENT_PANEL_HEIGHT
  }
}
