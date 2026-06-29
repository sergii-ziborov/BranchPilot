export interface CommitHoverAnchor {
  x: number
  y: number
}

export interface CommitHoverViewport {
  width: number
  height: number
}

export interface CommitHoverPlacement {
  left: number
  top: number
  width: number
  placement: 'below' | 'above'
}

const CARD_WIDTH = 340
const CARD_HEIGHT = 260
const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 12

export function commitHoverPlacement(
  anchor: CommitHoverAnchor,
  viewport: CommitHoverViewport
): CommitHoverPlacement {
  const width = Math.min(CARD_WIDTH, Math.max(0, viewport.width - VIEWPORT_MARGIN * 2))
  const preferredLeft = anchor.x - width / 2
  const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, viewport.width - width - VIEWPORT_MARGIN))
  const belowTop = anchor.y + ANCHOR_GAP
  const aboveTop = anchor.y - CARD_HEIGHT - ANCHOR_GAP
  const fitsBelow = belowTop + CARD_HEIGHT <= viewport.height - VIEWPORT_MARGIN
  const fitsAbove = aboveTop >= VIEWPORT_MARGIN

  if (fitsBelow || !fitsAbove) {
    return {
      left,
      top: Math.max(VIEWPORT_MARGIN, Math.min(belowTop, viewport.height - CARD_HEIGHT - VIEWPORT_MARGIN)),
      width,
      placement: 'below'
    }
  }

  return {
    left,
    top: Math.max(VIEWPORT_MARGIN, aboveTop),
    width,
    placement: 'above'
  }
}
