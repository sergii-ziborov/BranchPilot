export interface VirtualListWindowInput {
  itemCount: number
  itemHeight: number
  viewportHeight: number
  scrollTop: number
  overscan?: number
}

export interface VirtualListWindow {
  startIndex: number
  endIndex: number
  visibleCount: number
  totalHeight: number
  offsetY: number
}

export function getVirtualListWindow(input: VirtualListWindowInput): VirtualListWindow {
  const itemCount = Math.max(0, Math.floor(input.itemCount))
  const itemHeight = positiveNumber(input.itemHeight)
  const viewportHeight = Math.max(0, input.viewportHeight)
  const totalHeight = itemCount * itemHeight
  const scrollTop = clamp(input.scrollTop, 0, totalHeight)
  const overscan = Math.max(0, Math.floor(input.overscan ?? 6))

  if (itemCount === 0 || viewportHeight === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      visibleCount: 0,
      totalHeight,
      offsetY: 0
    }
  }

  const firstVisibleIndex = Math.floor(scrollTop / itemHeight)
  const lastVisibleIndex = Math.ceil((scrollTop + viewportHeight) / itemHeight)
  const startIndex = clampIndex(firstVisibleIndex - overscan, itemCount)
  const endIndex = clampIndex(lastVisibleIndex + overscan, itemCount)

  return {
    startIndex,
    endIndex,
    visibleCount: Math.max(0, endIndex - startIndex),
    totalHeight,
    offsetY: startIndex * itemHeight
  }
}

/**
 * Suffix describing the currently rendered slice of a virtualized list,
 * e.g. " · showing 1-20". Empty when the whole list is visible.
 */
export function virtualRangeLabel(window: VirtualListWindow, total: number): string {
  if (total === 0 || window.visibleCount >= total) return ''

  return ` · showing ${window.startIndex + 1}-${window.endIndex}`
}

function positiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max)
}

function clampIndex(value: number, itemCount: number): number {
  return Math.min(Math.max(value, 0), itemCount)
}
