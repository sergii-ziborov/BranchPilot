import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'

const WORKFLOW_SPLIT_STORAGE_KEY = 'branchpilot:changes-pane-width'
const DEFAULT_WORKFLOW_PANE_WIDTH = 430
const MIN_WORKFLOW_PANE_WIDTH = 320
const MAX_WORKFLOW_PANE_WIDTH = 760
const MIN_WORKFLOW_DETAIL_WIDTH = 520
const WORKFLOW_SPLITTER_WIDTH = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampPaneWidth(width: number, containerWidth?: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(MIN_WORKFLOW_PANE_WIDTH, containerWidth - WORKFLOW_SPLITTER_WIDTH - MIN_WORKFLOW_DETAIL_WIDTH)
    : MAX_WORKFLOW_PANE_WIDTH

  return Math.round(clamp(width, MIN_WORKFLOW_PANE_WIDTH, Math.min(MAX_WORKFLOW_PANE_WIDTH, maxForContainer)))
}

function readStoredPaneWidth(): number {
  try {
    const rawWidth = window.localStorage.getItem(WORKFLOW_SPLIT_STORAGE_KEY)
    if (rawWidth === null) return DEFAULT_WORKFLOW_PANE_WIDTH

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampPaneWidth(stored)
  } catch {
    /* ignore unavailable storage */
  }

  return DEFAULT_WORKFLOW_PANE_WIDTH
}

export function useWorkflowPaneResize() {
  const gridRef = useRef<HTMLElement | null>(null)
  const [paneWidth, setPaneWidth] = useState(readStoredPaneWidth)

  const splitStyle = {
    '--changes-pane-width': `${paneWidth}px`,
    '--changes-pane-min-width': `${MIN_WORKFLOW_PANE_WIDTH}px`,
    '--diff-pane-min-width': `${MIN_WORKFLOW_DETAIL_WIDTH}px`
  } as CSSProperties

  useEffect(() => {
    const clampToGrid = () => {
      const grid = gridRef.current
      if (!grid) return
      setPaneWidth((width) => clampPaneWidth(width, grid.getBoundingClientRect().width))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToGrid)
    })
    window.addEventListener('resize', clampToGrid)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToGrid)
    }
  }, [])

  const persistPaneWidth = (width: number) => {
    try {
      window.localStorage.setItem(WORKFLOW_SPLIT_STORAGE_KEY, String(width))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const resizePane = (clientX: number) => {
    const grid = gridRef.current
    if (!grid) return paneWidth

    const rect = grid.getBoundingClientRect()
    const nextWidth = clampPaneWidth(clientX - rect.left, rect.width)
    setPaneWidth(nextWidth)
    return nextWidth
  }

  const nudgePane = (delta: number) => {
    const grid = gridRef.current
    const containerWidth = grid?.getBoundingClientRect().width
    setPaneWidth((width) => {
      const nextWidth = clampPaneWidth(width + delta, containerWidth)
      persistPaneWidth(nextWidth)
      return nextWidth
    })
  }

  const startPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizePane(event.clientX)
    document.body.classList.add('is-resizing-changes')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizePane(moveEvent.clientX)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-changes')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistPaneWidth(latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const handleSplitKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgePane(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgePane(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPaneWidth(MIN_WORKFLOW_PANE_WIDTH)
      persistPaneWidth(MIN_WORKFLOW_PANE_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const grid = gridRef.current
      const nextWidth = clampPaneWidth(MAX_WORKFLOW_PANE_WIDTH, grid?.getBoundingClientRect().width)
      setPaneWidth(nextWidth)
      persistPaneWidth(nextWidth)
    }
  }

  return {
    gridRef,
    paneWidth,
    splitStyle,
    startPaneResize,
    handleSplitKeyDown,
    minPaneWidth: MIN_WORKFLOW_PANE_WIDTH,
    maxPaneWidth: MAX_WORKFLOW_PANE_WIDTH
  }
}
