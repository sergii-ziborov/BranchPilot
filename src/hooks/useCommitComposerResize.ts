import {
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import {
  COMMIT_COMPOSER_MAX_HEIGHT,
  COMMIT_COMPOSER_MIN_HEIGHT,
  COMMIT_COMPOSER_STORAGE_KEY,
  clampCommitComposerHeight,
  readStoredCommitComposerHeight
} from '../lib/commitComposerHeight'

const COMMIT_COMPOSER_PANEL_RESERVED_HEIGHT = 210

export function useCommitComposerResize(panelRef: RefObject<HTMLElement | null>) {
  const [commitComposerHeight, setCommitComposerHeight] = useState(readStoredCommitComposerHeight)

  const commitComposerStyle = {
    '--commit-composer-height': `${commitComposerHeight}px`
  } as CSSProperties

  const clampCommitComposerHeightForPanel = (value: number) => {
    const panelHeight = panelRef.current?.clientHeight ?? 0
    if (panelHeight <= 0) return clampCommitComposerHeight(value)

    const maxForPanel = Math.max(
      COMMIT_COMPOSER_MIN_HEIGHT,
      Math.min(COMMIT_COMPOSER_MAX_HEIGHT, panelHeight - COMMIT_COMPOSER_PANEL_RESERVED_HEIGHT)
    )
    return Math.min(clampCommitComposerHeight(value), maxForPanel)
  }

  const persistCommitComposerHeight = (height: number) => {
    try {
      window.localStorage.setItem(COMMIT_COMPOSER_STORAGE_KEY, String(height))
    } catch {
      // Best-effort UI preference only.
    }
  }

  const nudgeCommitComposerHeight = (delta: number) => {
    setCommitComposerHeight((currentHeight) => {
      const nextHeight = clampCommitComposerHeightForPanel(currentHeight + delta)
      persistCommitComposerHeight(nextHeight)
      return nextHeight
    })
  }

  const startCommitComposerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing-commit-composer')

    const startY = event.clientY
    const startHeight = commitComposerHeight
    let latestHeight = startHeight

    const resize = (clientY: number) => {
      latestHeight = clampCommitComposerHeightForPanel(startHeight + startY - clientY)
      setCommitComposerHeight(latestHeight)
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      resize(moveEvent.clientY)
    }

    const stopResize = () => {
      document.body.classList.remove('is-resizing-commit-composer')
      persistCommitComposerHeight(latestHeight)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const handleCommitComposerResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      nudgeCommitComposerHeight(16)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      nudgeCommitComposerHeight(-16)
    } else if (event.key === 'Home') {
      event.preventDefault()
      nudgeCommitComposerHeight(COMMIT_COMPOSER_MIN_HEIGHT - commitComposerHeight)
    } else if (event.key === 'End') {
      event.preventDefault()
      nudgeCommitComposerHeight(COMMIT_COMPOSER_MAX_HEIGHT - commitComposerHeight)
    }
  }

  return {
    commitComposerHeight,
    commitComposerStyle,
    startCommitComposerResize,
    handleCommitComposerResizeKeyDown,
    minCommitComposerHeight: COMMIT_COMPOSER_MIN_HEIGHT,
    maxCommitComposerHeight: COMMIT_COMPOSER_MAX_HEIGHT
  }
}
