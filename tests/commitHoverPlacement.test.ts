import { describe, expect, it } from 'vitest'
import { commitHoverPlacement } from '../src/lib/commitHoverPlacement'

describe('commit hover placement', () => {
  it('places the card below the commit point when there is room', () => {
    const placement = commitHoverPlacement({ x: 120, y: 120 }, { width: 900, height: 700 })

    expect(placement.placement).toBe('below')
    expect(placement.top).toBeGreaterThan(120)
    expect(placement.left).toBe(8)
  })

  it('flips above the commit point near the bottom edge', () => {
    const placement = commitHoverPlacement({ x: 420, y: 650 }, { width: 900, height: 700 })

    expect(placement.placement).toBe('above')
    expect(placement.top).toBeLessThan(650)
    expect(placement.left).toBe(250)
  })

  it('keeps the card inside the viewport horizontally', () => {
    const leftEdge = commitHoverPlacement({ x: 4, y: 120 }, { width: 900, height: 700 })
    const rightEdge = commitHoverPlacement({ x: 890, y: 120 }, { width: 900, height: 700 })

    expect(leftEdge.left).toBe(8)
    expect(rightEdge.left + rightEdge.width).toBe(892)
  })
})
