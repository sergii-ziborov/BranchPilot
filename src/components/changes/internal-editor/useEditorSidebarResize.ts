import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import {
  EDITOR_SIDEBAR_MAX_WIDTH,
  EDITOR_SIDEBAR_MIN_WIDTH,
  EDITOR_SIDEBAR_STORAGE_KEY
} from './editorViewConstants'
import {
  clampEditorSidebarWidth,
  readStoredEditorSidebarWidth
} from './editorViewHelpers'

interface UseEditorSidebarResizeArgs {
  editorRef: RefObject<HTMLElement | null>
}

interface UseEditorSidebarResizeResult {
  sidebarWidth: number
  editorStyle: CSSProperties
  startSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleSidebarResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

export function useEditorSidebarResize({ editorRef }: UseEditorSidebarResizeArgs): UseEditorSidebarResizeResult {
  const [sidebarWidth, setSidebarWidth] = useState(readStoredEditorSidebarWidth)

  const persistSidebarWidth = (width: number) => {
    try {
      window.localStorage.setItem(EDITOR_SIDEBAR_STORAGE_KEY, String(width))
    } catch {
      /* ignore unavailable storage */
    }
  }

  const resizeSidebar = (clientX: number) => {
    const editor = editorRef.current
    if (!editor) return sidebarWidth

    const rect = editor.getBoundingClientRect()
    const nextWidth = clampEditorSidebarWidth(clientX - rect.left, rect.width)
    setSidebarWidth(nextWidth)
    return nextWidth
  }

  const nudgeSidebar = (delta: number) => {
    const editor = editorRef.current
    const containerWidth = editor?.getBoundingClientRect().width
    setSidebarWidth((width) => {
      const nextWidth = clampEditorSidebarWidth(width + delta, containerWidth)
      persistSidebarWidth(nextWidth)
      return nextWidth
    })
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizeSidebar(event.clientX)
    document.body.classList.add('is-resizing-editor-sidebar')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizeSidebar(moveEvent.clientX)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-editor-sidebar')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistSidebarWidth(latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
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
      setSidebarWidth(EDITOR_SIDEBAR_MIN_WIDTH)
      persistSidebarWidth(EDITOR_SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const editor = editorRef.current
      const nextWidth = clampEditorSidebarWidth(EDITOR_SIDEBAR_MAX_WIDTH, editor?.getBoundingClientRect().width)
      setSidebarWidth(nextWidth)
      persistSidebarWidth(nextWidth)
    }
  }

  useEffect(() => {
    const clampToEditor = () => {
      const editor = editorRef.current
      if (!editor) return
      setSidebarWidth((width) => clampEditorSidebarWidth(width, editor.getBoundingClientRect().width))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToEditor)
    })
    window.addEventListener('resize', clampToEditor)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToEditor)
    }
  }, [editorRef])

  const editorStyle = {
    '--changes-editor-sidebar-width': `${sidebarWidth}px`
  } as CSSProperties

  return { sidebarWidth, editorStyle, startSidebarResize, handleSidebarResizeKeyDown }
}
