import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { BranchPilotApi, CommitCard } from '../../shared/branchPilot'
import type { CommitHoverCardAnchor } from '../CommitHoverCard'
import { hitHistoryGraphNode, type HistoryGraphModel } from '../../lib/historyGraph'

interface UseHistoryHoverCardOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  graphModel: HistoryGraphModel
  itemHeight: number
  historyGraphWidth: number
}

/**
 * Commit dots: hover hit-test against the graph model to show a GitLens-style card.
 */
export function useHistoryHoverCard({
  api,
  currentRepoPath,
  graphModel,
  itemHeight,
  historyGraphWidth
}: UseHistoryHoverCardOptions) {
  const [hoverCardAnchor, setHoverCardAnchor] = useState<CommitHoverCardAnchor | null>(null)
  const [hoverCard, setHoverCard] = useState<CommitCard | null>(null)
  const [hoverAvatarBroken, setHoverAvatarBroken] = useState(false)
  const hoverCardCacheRef = useRef(new Map<string, CommitCard>())
  const hoverShowTimerRef = useRef<number | null>(null)
  const hoverHideTimerRef = useRef<number | null>(null)
  const hoverPendingShaRef = useRef<string | null>(null)
  const hoverActiveShaRef = useRef<string | null>(null)
  const hoverOverCardRef = useRef(false)

  const hideHoverCard = () => {
    if (hoverShowTimerRef.current) window.clearTimeout(hoverShowTimerRef.current)
    if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current)
    hoverShowTimerRef.current = null
    hoverHideTimerRef.current = null
    hoverPendingShaRef.current = null
    hoverActiveShaRef.current = null
    setHoverCardAnchor(null)
    setHoverCard(null)
    setHoverAvatarBroken(false)
  }

  const scheduleHideHoverCard = () => {
    if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current)
    hoverHideTimerRef.current = window.setTimeout(() => {
      if (!hoverOverCardRef.current) hideHoverCard()
    }, 220)
  }

  const loadHoverCard = (sha: string) => {
    const cached = hoverCardCacheRef.current.get(sha)
    if (cached) {
      setHoverCard(cached)
      return
    }
    if (!api || !currentRepoPath || typeof api.getCommitCard !== 'function') return
    void api
      .getCommitCard({ repoPath: currentRepoPath, commitSha: sha })
      .then((result) => {
        if (!result.ok) return
        hoverCardCacheRef.current.set(sha, result.data)
        if (hoverActiveShaRef.current === sha) setHoverCard(result.data)
      })
      .catch(() => {})
  }

  const handleGraphPointerMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    const rect = container.getBoundingClientRect()
    const contentX = event.clientX - rect.left + container.scrollLeft
    const contentY = event.clientY - rect.top + container.scrollTop

    const missed = () => {
      hoverPendingShaRef.current = null
      if (hoverShowTimerRef.current) {
        window.clearTimeout(hoverShowTimerRef.current)
        hoverShowTimerRef.current = null
      }
      if (hoverCardAnchor) scheduleHideHoverCard()
    }

    if (contentX > historyGraphWidth + 6) {
      missed()
      return
    }
    const node = hitHistoryGraphNode(graphModel, itemHeight, contentX, contentY)
    if (!node?.sha) {
      missed()
      return
    }
    if (hoverCardAnchor?.sha === node.sha || hoverPendingShaRef.current === node.sha) return

    if (hoverHideTimerRef.current) {
      window.clearTimeout(hoverHideTimerRef.current)
      hoverHideTimerRef.current = null
    }
    if (hoverShowTimerRef.current) window.clearTimeout(hoverShowTimerRef.current)
    const sha = node.sha
    const anchorX = event.clientX
    const anchorY = event.clientY
    hoverPendingShaRef.current = sha
    hoverShowTimerRef.current = window.setTimeout(() => {
      hoverPendingShaRef.current = null
      hoverActiveShaRef.current = sha
      setHoverAvatarBroken(false)
      setHoverCardAnchor({ sha, x: anchorX, y: anchorY })
      setHoverCard(hoverCardCacheRef.current.get(sha) ?? null)
      loadHoverCard(sha)
    }, 280)
  }

  const handleHoverCardMouseEnter = () => {
    hoverOverCardRef.current = true
    if (hoverHideTimerRef.current) {
      window.clearTimeout(hoverHideTimerRef.current)
      hoverHideTimerRef.current = null
    }
  }

  const handleHoverCardMouseLeave = () => {
    hoverOverCardRef.current = false
    hideHoverCard()
  }

  useEffect(() => () => {
    if (hoverShowTimerRef.current) window.clearTimeout(hoverShowTimerRef.current)
    if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current)
  }, [])

  return {
    hoverCardAnchor,
    hoverCard,
    hoverAvatarBroken,
    setHoverAvatarBroken,
    hideHoverCard,
    scheduleHideHoverCard,
    handleGraphPointerMove,
    handleHoverCardMouseEnter,
    handleHoverCardMouseLeave
  }
}
