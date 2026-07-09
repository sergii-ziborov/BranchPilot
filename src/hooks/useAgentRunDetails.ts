import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentRunRecord } from '../shared/branchPilot'

export interface AgentRunDetailsState {
  /** Run id of the currently expanded activity entry, if any. */
  expandedId: string | null
  /** Loaded record for the expanded run, or null while loading/unavailable. */
  record: AgentRunRecord | null
  loading: boolean
  error: string | null
  /** Expand the given run, or collapse it if it is already expanded. */
  toggle: (runId: string) => void
}

/**
 * Tracks which agent-run activity entry is expanded and lazily loads its full
 * record via `getAgentRunDetail`. Only one run is expanded at a time; switching
 * repositories collapses the panel.
 */
export function useAgentRunDetails(currentRepoPath: string | null | undefined): AgentRunDetailsState {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [record, setRecord] = useState<AgentRunRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const toggle = useCallback((runId: string) => {
    setExpandedId((current) => (current === runId ? null : runId))
  }, [])

  useEffect(() => {
    setExpandedId(null)
  }, [currentRepoPath])

  useEffect(() => {
    const api = window.branchPilot

    if (!expandedId || !api || !currentRepoPath) {
      setRecord(null)
      setError(null)
      setLoading(false)
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    setRecord(null)

    void api.getAgentRunDetail({ repoPath: currentRepoPath, id: expandedId }).then((result) => {
      if (requestIdRef.current !== requestId) return

      if (result.ok) {
        setRecord(result.data)
        setError(result.data ? null : 'These run details are no longer available.')
      } else {
        setError(result.error.message)
      }

      setLoading(false)
    })
  }, [expandedId, currentRepoPath])

  return { expandedId, record, loading, error, toggle }
}
