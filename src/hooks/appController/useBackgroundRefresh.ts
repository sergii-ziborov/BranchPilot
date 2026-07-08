import { useEffect, useRef } from 'react'
import type { BranchPilotApi, RecentRepository, RepositorySnapshot } from '../../shared/branchPilot'

// Keep every repository live the way GitHub Desktop does: a background scan
// refreshes the active repo's working tree AND every sibling repo's status
// (clean / dirty / ahead / behind) on a timer plus on window focus. Silent (no
// spinner, no activity-log entries) and guarded so an in-flight refresh for a
// repo the user just left can never apply its (phantom) snapshot to the current one.
export function useBackgroundRefresh({
  api,
  currentRepoPath,
  busy,
  setSnapshot,
  setRecentRepositories,
  silentRefreshDashboard
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  busy: boolean
  setSnapshot: (snapshot: RepositorySnapshot) => void
  setRecentRepositories: (repositories: RecentRepository[]) => void
  silentRefreshDashboard: () => void
}) {
  const lastStatusSigRef = useRef('')
  const latestRepoRef = useRef(currentRepoPath)
  const busyRef = useRef(busy)
  useEffect(() => { latestRepoRef.current = currentRepoPath }, [currentRepoPath])
  useEffect(() => { busyRef.current = busy }, [busy])

  async function silentRefresh() {
    const repo = currentRepoPath
    if (!api || !repo || busyRef.current) return
    try {
      const result = await api.refreshRepository(repo)
      if (!result.ok) return
      // Discard stale results if the user switched repositories mid-flight.
      if (repo !== latestRepoRef.current) return
      const { status, summary } = result.data
      const sig = `${repo}|${summary.ahead}|${summary.behind}|${status.changes
        .map((c) => `${c.path}:${c.status}:${c.staged ? 1 : 0}:${c.unstaged ? 1 : 0}`)
        .join(',')}`
      if (sig === lastStatusSigRef.current) return
      lastStatusSigRef.current = sig
      setSnapshot(result.data)
      setRecentRepositories(result.data.recentRepositories)
    } catch {
      /* ignore transient refresh errors */
    }
  }

  function silentScan() {
    if (document.hidden || busyRef.current) return
    void silentRefresh()
    void silentRefreshDashboard()
  }

  useEffect(() => {
    if (!api) return
    const onFocus = () => { if (!document.hidden) silentScan() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    // Periodic background scan (paused while the window is hidden or an op is busy).
    const interval = window.setInterval(silentScan, 10_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(interval)
    }
  }, [api, currentRepoPath])
}
