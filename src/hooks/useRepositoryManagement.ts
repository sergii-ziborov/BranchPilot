import { useEffect, useMemo, useRef, useState } from 'react'
import { branchPilotErrorText } from '../shared/branchPilot'
import type {
  ApiResult, BranchPilotApi, ContributionGraph, GitOperationResult, RecentRepository,
  RepositoryDashboardSnapshot, RepositoryRhythm, RepositorySnapshot
} from '../shared/branchPilot'
import type { ViewMode } from '../lib/viewMode'

interface UseRepositoryManagementDeps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  allReposMode: boolean
  viewMode: ViewMode
  snapshot: RepositorySnapshot | null
  runBusyOperation: <T>(label: string, action: () => Promise<T>) => Promise<T>
  runOperationAction: (label: string, action: () => Promise<ApiResult<GitOperationResult>>, progressLabel?: string) => Promise<void>
  applySnapshot: (nextSnapshot: RepositorySnapshot, successMessage: string) => void
  applySnapshotResult: (result: ApiResult<RepositorySnapshot>, successMessage: string) => void
  setNotice: (value: string) => void
  setError: (value: string | null) => void
  refreshProviderStatusOnly: () => void | Promise<void>
}

/** Repository lifecycle: recent list, dashboard, open/clone/refresh, editor & terminal launch. */
export function useRepositoryManagement(deps: UseRepositoryManagementDeps) {
  const {
    api, currentRepoPath, allReposMode, viewMode, snapshot,
    runBusyOperation, runOperationAction, applySnapshot, applySnapshotResult,
    setNotice, setError, refreshProviderStatusOnly
  } = deps

  // In "All repositories" mode the dashboard and heatmap aggregate across every
  // recent repository (no single-repo scope).
  const dashboardScopePath = allReposMode ? undefined : currentRepoPath

  const [repositoryDashboard, setRepositoryDashboard] = useState<RepositoryDashboardSnapshot | null>(null)
  const [contributionGraph, setContributionGraph] = useState<ContributionGraph | null>(null)
  const [repositoryRhythm, setRepositoryRhythm] = useState<RepositoryRhythm | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardRepositoryFilter, setDashboardRepositoryFilter] = useState('')
  const [cloneRemoteUrl, setCloneRemoteUrl] = useState('')
  const [cloneTargetName, setCloneTargetName] = useState('')
  const [recentRepositories, setRecentRepositories] = useState<RecentRepository[]>([])
  const [recentRepositoryFilter, setRecentRepositoryFilter] = useState('')
  const dashboardRequestIdRef = useRef(0)

  const filteredRecentRepositories = useMemo(() => {
    const query = recentRepositoryFilter.trim().toLowerCase()

    if (!query) return recentRepositories

    return recentRepositories.filter((repo) =>
      [
        repo.name,
        repo.path,
        repo.pinned ? 'pinned favorite starred repository' : 'recent repository'
      ].some((value) => value.toLowerCase().includes(query))
    )
  }, [recentRepositories, recentRepositoryFilter])

  useEffect(() => {
    if (!api || viewMode !== 'dashboard') return
    void loadRepositoryDashboard()

    if (snapshot && !allReposMode) {
      void refreshProviderStatusOnly()
    }
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode, allReposMode])

  // Keep the repo-switcher badges populated even when the dashboard view is closed:
  // load the multi-repo status quietly whenever the API or active repo becomes ready.
  useEffect(() => {
    if (!api) return
    void silentRefreshDashboard()
  }, [api, currentRepoPath])

  async function loadRecentRepositories() {
    if (!api) return
    const result = await api.getRecentRepositories()
    if (result.ok) setRecentRepositories(result.data)
  }

  async function loadRepositoryDashboard() {
    if (!api) return

    const requestId = dashboardRequestIdRef.current + 1
    dashboardRequestIdRef.current = requestId
    setDashboardLoading(true)
    // Dashboard scan, contribution graph and rhythm are independent: run concurrently.
    const dashboardPromise = api.getRepositoryDashboard(dashboardScopePath)
    const graphPromise = typeof api.getContributionGraph === 'function'
      ? api.getContributionGraph(dashboardScopePath).catch(() => null)
      : Promise.resolve(null)
    const rhythmPromise = typeof api.getRepositoryRhythm === 'function'
      ? api.getRepositoryRhythm(dashboardScopePath).catch(() => null)
      : Promise.resolve(null)

    const result = await dashboardPromise

    if (dashboardRequestIdRef.current !== requestId) return

    if (result.ok) {
      setRepositoryDashboard(result.data)
    } else {
      setError(result.error.message)
    }

    setDashboardLoading(false)

    const [graph, rhythm] = await Promise.all([graphPromise, rhythmPromise])
    if (dashboardRequestIdRef.current === requestId) {
      setContributionGraph(graph && graph.ok ? graph.data : null)
      setRepositoryRhythm(rhythm && rhythm.ok ? rhythm.data : null)
    }
  }

  // Background-friendly dashboard scan: refreshes every repo's working-tree state
  // (clean / dirty / ahead / behind) without flipping the loading spinner, so the
  // repository switcher badges update live the way GitHub Desktop's sidebar does.
  async function silentRefreshDashboard() {
    if (!api) return
    const requestId = dashboardRequestIdRef.current + 1
    dashboardRequestIdRef.current = requestId
    try {
      const result = await api.getRepositoryDashboard(dashboardScopePath)
      if (dashboardRequestIdRef.current !== requestId) return
      if (result.ok) setRepositoryDashboard(result.data)
    } catch {
      /* ignore transient scan errors */
    }
  }

  async function toggleRepositoryPinned(repo: RecentRepository) {
    if (!api) return

    const result = await api.setRepositoryPinned({
      repoPath: repo.path,
      pinned: !repo.pinned
    })

    if (result.ok) {
      setRecentRepositories(result.data)
      if (viewMode === 'dashboard') {
        void loadRepositoryDashboard()
      }
    } else {
      setError(result.error.message)
    }
  }

  async function chooseRepository() {
    if (!api) return
    await runBusyOperation('Opening repository...', async () => {
      const result = await api.chooseAndOpenRepository()

      if (result.ok && result.data) {
        applySnapshot(result.data, 'Repository opened.')
      } else if (!result.ok) {
        setError(result.error.message)
      }
    })
  }

  async function openRepository(path: string): Promise<boolean> {
    if (!api) return false
    return runBusyOperation('Opening repository...', async () => {
      const result = await api.openRepository(path)
      applySnapshotResult(result, 'Repository opened.')
      if (result.ok) {
        try { localStorage.setItem('bp-repo', path) } catch { /* ignore */ }
      }
      return result.ok
    })
  }

  async function cloneRepository() {
    if (!api) return
    const remoteUrl = cloneRemoteUrl.trim()

    if (!remoteUrl) {
      setNotice('Clone blocked: add a repository URL.')
      return
    }

    await runBusyOperation('Cloning repository...', async () => {
      const result = await api.cloneRepository({
        remoteUrl,
        targetName: cloneTargetName.trim() || undefined
      })

      if (result.ok && result.data) {
        setCloneRemoteUrl('')
        setCloneTargetName('')
        applySnapshot(result.data, 'Repository cloned.')
      } else if (!result.ok) {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  async function refreshRepository(message = 'Repository refreshed.') {
    if (!api || !currentRepoPath) return
    await runBusyOperation('Refreshing repository...', async () => {
      const result = await api.refreshRepository(currentRepoPath)
      applySnapshotResult(result, message)
    })
  }

  async function openRepoInEditor() {
    if (!api || !currentRepoPath) return
    await runOperationAction('Repository opened in editor.', () => api.openInEditor({ targetPath: currentRepoPath }))
  }

  async function openRepositoryTerminal() {
    if (!api || !currentRepoPath) return
    await runOperationAction('Terminal opened.', () => api.openTerminal(currentRepoPath))
  }

  return {
    recentRepositories, setRecentRepositories, recentRepositoryFilter, setRecentRepositoryFilter,
    filteredRecentRepositories, repositoryDashboard, contributionGraph, repositoryRhythm, dashboardLoading,
    dashboardRepositoryFilter, setDashboardRepositoryFilter,
    cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName,
    loadRecentRepositories, loadRepositoryDashboard, silentRefreshDashboard, toggleRepositoryPinned,
    chooseRepository, openRepository, cloneRepository, refreshRepository,
    openRepoInEditor, openRepositoryTerminal
  }
}
