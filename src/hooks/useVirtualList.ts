import { useEffect, useMemo, useRef, useState } from 'react'
import { getVirtualListWindow } from '../shared/virtualList'

const VIRTUAL_LIST_OVERSCAN = 8
const VIRTUAL_LIST_FALLBACK_HEIGHT = 520

/**
 * Windowing hook for long lists: tracks viewport height and scroll position and
 * returns only the visible slice (plus overscan) computed by getVirtualListWindow.
 */
export function useVirtualList<T>(items: T[], itemHeight: number, resetKey = '') {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(VIRTUAL_LIST_FALLBACK_HEIGHT)
  const scrollFrameRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
  }, [])

  useEffect(() => {
    const element = containerElement

    if (!element) return

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || VIRTUAL_LIST_FALLBACK_HEIGHT)
    }

    updateViewportHeight()

    const resizeObserver = new ResizeObserver(updateViewportHeight)
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [containerElement])

  useEffect(() => {
    if (containerElement) {
      containerElement.scrollTop = 0
    }
    setScrollTop(0)
  }, [containerElement, resetKey])

  useEffect(() => {
    // Snapshot refreshes keep the user's scroll position; only clamp when the list shrinks.
    const maxScrollTop = Math.max(0, items.length * itemHeight - viewportHeight)

    setScrollTop((current) => {
      if (current <= maxScrollTop) return current
      if (containerElement) {
        containerElement.scrollTop = maxScrollTop
      }
      return maxScrollTop
    })
  }, [containerElement, itemHeight, items.length, viewportHeight])

  const window = useMemo(
    () => getVirtualListWindow({
      itemCount: items.length,
      itemHeight,
      viewportHeight,
      scrollTop,
      overscan: VIRTUAL_LIST_OVERSCAN
    }),
    [itemHeight, items.length, scrollTop, viewportHeight]
  )
  const visibleItems = useMemo(
    () => items.slice(window.startIndex, window.endIndex).map((item, offset) => ({
      item,
      index: window.startIndex + offset
    })),
    [items, window.endIndex, window.startIndex]
  )

  return {
    containerRef: setContainerElement,
    window,
    items: visibleItems,
    // Coalesce scroll events into one state update per animation frame so a fast
    // scroll doesn't re-render the parent (and any open diff panel) on every tick.
    onScroll: (event: { currentTarget: HTMLDivElement }) => {
      pendingScrollTopRef.current = event.currentTarget.scrollTop

      if (scrollFrameRef.current !== null) return

      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        setScrollTop((current) => (current === pendingScrollTopRef.current ? current : pendingScrollTopRef.current))
      })
    }
  }
}
