import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRunSummary, BranchPilotApi } from '../../../shared/branchPilot'
import { summarizeAgentSession } from './agentSessionSummaryData'

const AGENT_SESSION_RUN_LIMIT = 20

interface UseAgentSessionSummaryOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
}

/**
 * Owns the "Session summary" expander for the local-agent panel: tracks when the
 * session started (hook mount), lazily fetches the repo's stored runs, and folds
 * them into a client-side rollup. No extra agent run is spent — it reuses the
 * runs persisted by `getAgentRuns`.
 */
export function useAgentSessionSummary({ api, currentRepoPath }: UseAgentSessionSummaryOptions) {
  const [sessionStart] = useState(() => Date.now())
  const requestIdRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!api || !currentRepoPath) {
      setError('Open a repository to see this session\'s agent runs.')
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)

    try {
      const result = await api.getAgentRuns(currentRepoPath, AGENT_SESSION_RUN_LIMIT)
      if (requestIdRef.current !== requestId) return

      if (result.ok) {
        setRuns(result.data)
      } else {
        setError(result.error.message)
      }
    } catch {
      if (requestIdRef.current !== requestId) return
      setError('Could not load this session\'s agent runs.')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [api, currentRepoPath])

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current
      if (next) void load()
      return next
    })
  }, [load])

  // Switching repositories resets the panel; loaded runs no longer apply.
  useEffect(() => {
    setOpen(false)
    setRuns([])
    setError(null)
  }, [currentRepoPath])

  const summary = useMemo(() => summarizeAgentSession(runs, sessionStart), [runs, sessionStart])

  return {
    agentSessionSummaryOpen: open,
    toggleAgentSessionSummary: toggle,
    refreshAgentSessionSummary: load,
    agentSessionSummary: summary,
    agentSessionSummaryLoading: loading,
    agentSessionSummaryError: error
  }
}
