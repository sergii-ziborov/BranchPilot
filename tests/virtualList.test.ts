import { describe, expect, it } from 'vitest'
import { getVirtualListWindow, virtualRangeLabel } from '../src/shared/virtualList'

describe('virtual list window', () => {
  it('renders only the visible range plus overscan', () => {
    expect(getVirtualListWindow({
      itemCount: 1000,
      itemHeight: 50,
      viewportHeight: 250,
      scrollTop: 500,
      overscan: 2
    })).toEqual({
      startIndex: 8,
      endIndex: 17,
      visibleCount: 9,
      totalHeight: 50_000,
      offsetY: 400
    })
  })

  it('clamps negative scroll and start overscan to the beginning', () => {
    expect(getVirtualListWindow({
      itemCount: 20,
      itemHeight: 40,
      viewportHeight: 120,
      scrollTop: -100,
      overscan: 4
    })).toMatchObject({
      startIndex: 0,
      endIndex: 7,
      offsetY: 0
    })
  })

  it('clamps oversized scroll and end overscan to the item count', () => {
    expect(getVirtualListWindow({
      itemCount: 20,
      itemHeight: 40,
      viewportHeight: 120,
      scrollTop: 10_000,
      overscan: 4
    })).toMatchObject({
      startIndex: 16,
      endIndex: 20,
      visibleCount: 4,
      totalHeight: 800
    })
  })

  it('returns an empty window for empty or zero-height lists', () => {
    expect(getVirtualListWindow({
      itemCount: 0,
      itemHeight: 40,
      viewportHeight: 120,
      scrollTop: 0
    })).toMatchObject({
      startIndex: 0,
      endIndex: 0,
      visibleCount: 0,
      totalHeight: 0
    })

    expect(getVirtualListWindow({
      itemCount: 12,
      itemHeight: 40,
      viewportHeight: 0,
      scrollTop: 0
    })).toMatchObject({
      startIndex: 0,
      endIndex: 0,
      visibleCount: 0,
      totalHeight: 480
    })
  })
})

describe('virtualRangeLabel', () => {
  it('is empty when nothing is windowed', () => {
    expect(virtualRangeLabel({ startIndex: 0, endIndex: 0, visibleCount: 0, totalHeight: 0, offsetY: 0 }, 0)).toBe('')
  })

  it('is empty when the whole list is visible', () => {
    expect(virtualRangeLabel({ startIndex: 0, endIndex: 10, visibleCount: 10, totalHeight: 400, offsetY: 0 }, 10)).toBe('')
  })

  it('describes the rendered 1-based slice when the list is partially shown', () => {
    expect(virtualRangeLabel({ startIndex: 8, endIndex: 17, visibleCount: 9, totalHeight: 50_000, offsetY: 400 }, 1000))
      .toBe(' · showing 9-17')
  })
})
