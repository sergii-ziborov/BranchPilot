import { describe, expect, it } from 'vitest'
import { getVirtualListWindow } from '../src/shared/virtualList'

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
