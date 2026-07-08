import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'

const PREVIEW_SPLITTER_WIDTH = 10
const PREVIEW_SIDEBAR_STORAGE_KEY = 'branchpilot:history-preview-sidebar-width'
const PREVIEW_PRIMARY_STORAGE_KEY = 'branchpilot:history-preview-primary-width'
const PREVIEW_SIDEBAR_DEFAULT_WIDTH = 390
export const PREVIEW_SIDEBAR_MIN_WIDTH = 280
export const PREVIEW_SIDEBAR_MAX_WIDTH = 720
const PREVIEW_MAIN_MIN_WIDTH = 650
const PREVIEW_PRIMARY_DEFAULT_WIDTH = 690
const PREVIEW_PRIMARY_MIN_WIDTH = 320
const PREVIEW_PRIMARY_MAX_WIDTH = 980
const PREVIEW_COMPARE_MIN_WIDTH = 320

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampResizableWidth(width: number, containerWidth: number | undefined, min: number, max: number, detailMin: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(min, containerWidth - PREVIEW_SPLITTER_WIDTH - detailMin)
    : max

  return Math.round(clamp(width, min, Math.min(max, maxForContainer)))
}

function readStoredWidth(storageKey: string, fallback: number, min: number, max: number, detailMin: number): number {
  try {
    const rawWidth = window.localStorage.getItem(storageKey)
    if (rawWidth === null) return fallback

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampResizableWidth(stored, undefined, min, max, detailMin)
  } catch {
    /* ignore unavailable storage */
  }

  return fallback
}

function persistWidth(storageKey: string, width: number) {
  try {
    window.localStorage.setItem(storageKey, String(width))
  } catch {
    /* ignore unavailable storage */
  }
}

export function useHistoryPreviewPanes() {
  const workspaceRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => (
    readStoredWidth(PREVIEW_SIDEBAR_STORAGE_KEY, PREVIEW_SIDEBAR_DEFAULT_WIDTH, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
  ))
  const [primaryPaneWidth, setPrimaryPaneWidth] = useState(() => (
    readStoredWidth(PREVIEW_PRIMARY_STORAGE_KEY, PREVIEW_PRIMARY_DEFAULT_WIDTH, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
  ))

  const workspaceStyle = {
    '--history-preview-sidebar-width': `${sidebarWidth}px`
  } as CSSProperties
  const stageStyle = {
    '--history-preview-primary-width': `${primaryPaneWidth}px`
  } as CSSProperties

  const resizeSidebar = (clientX: number) => {
    const workspace = workspaceRef.current
    if (!workspace) return sidebarWidth

    const rect = workspace.getBoundingClientRect()
    const nextWidth = clampResizableWidth(clientX - rect.left, rect.width, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
    setSidebarWidth(nextWidth)
    return nextWidth
  }

  const resizePrimaryPane = (clientX: number) => {
    const stage = stageRef.current
    if (!stage) return primaryPaneWidth

    const rect = stage.getBoundingClientRect()
    const nextWidth = clampResizableWidth(clientX - rect.left, rect.width, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
    setPrimaryPaneWidth(nextWidth)
    return nextWidth
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizeSidebar(event.clientX)
    document.body.classList.add('is-resizing-history-preview-sidebar')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizeSidebar(moveEvent.clientX)
    }
    const stopResize = () => {
      document.body.classList.remove('is-resizing-history-preview-sidebar')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const startPrimaryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizePrimaryPane(event.clientX)
    document.body.classList.add('is-resizing-history-preview-primary')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizePrimaryPane(moveEvent.clientX)
    }
    const stopResize = () => {
      document.body.classList.remove('is-resizing-history-preview-primary')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const nudgeSidebar = (delta: number) => {
    const width = workspaceRef.current?.getBoundingClientRect().width
    setSidebarWidth((current) => {
      const nextWidth = clampResizableWidth(current + delta, width, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, nextWidth)
      return nextWidth
    })
  }

  const nudgePrimaryPane = (delta: number) => {
    const width = stageRef.current?.getBoundingClientRect().width
    setPrimaryPaneWidth((current) => {
      const nextWidth = clampResizableWidth(current + delta, width, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, nextWidth)
      return nextWidth
    })
  }

  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(PREVIEW_SIDEBAR_MIN_WIDTH)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, PREVIEW_SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const width = workspaceRef.current?.getBoundingClientRect().width
      const nextWidth = clampResizableWidth(PREVIEW_SIDEBAR_MAX_WIDTH, width, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
      setSidebarWidth(nextWidth)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, nextWidth)
    }
  }

  const handlePrimaryResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgePrimaryPane(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgePrimaryPane(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPrimaryPaneWidth(PREVIEW_PRIMARY_MIN_WIDTH)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, PREVIEW_PRIMARY_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const width = stageRef.current?.getBoundingClientRect().width
      const nextWidth = clampResizableWidth(PREVIEW_PRIMARY_MAX_WIDTH, width, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
      setPrimaryPaneWidth(nextWidth)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, nextWidth)
    }
  }

  useEffect(() => {
    const clampToLayout = () => {
      const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width
      const stageWidth = stageRef.current?.getBoundingClientRect().width
      setSidebarWidth((width) => clampResizableWidth(width, workspaceWidth, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH))
      setPrimaryPaneWidth((width) => clampResizableWidth(width, stageWidth, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToLayout)
    })
    window.addEventListener('resize', clampToLayout)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToLayout)
    }
  }, [])

  return {
    workspaceRef,
    stageRef,
    sidebarWidth,
    primaryPaneWidth,
    workspaceStyle,
    stageStyle,
    startSidebarResize,
    startPrimaryResize,
    handleSidebarResizeKeyDown,
    handlePrimaryResizeKeyDown
  }
}
