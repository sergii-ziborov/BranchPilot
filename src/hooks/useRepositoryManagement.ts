import { useEffect, useMemo, useRef, useState } from 'react'
import { branchPilotErrorText } from '../shared/branchPilot'
import type {
  ApiResult, BranchPilotApi, ContributionGraph, GitOperationResult, RecentRepository,
  RepositoryDashboardSnapshot, RepositorySnapshot
} from '../shared/branchPilot'
import type { ViewMode } from '../lib/viewMode'

interface UseRepositoryManagementDeps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
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
    api, currentRepoPath, viewMode, snapshot,
    runBusyOperation, runOperationAction, applySnapshot, applySnapshotResult,
    setNotice, setError, refreshProviderStatusOnly
  } = deps

  const [repositoryDashboard, setRepositoryDashboard] = useState<RepositoryDashboardSnapshot | null>(null)
  const [contributionGraph, setContributionGraph] = useState<ContributionGraph | null>(null)
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

    if (snapshot) {
      void refreshProviderStatusOnly()
    }
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

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
    // Dashboard scan and contribution graph are independent: run them concurrently.
    const dashboardPromise = api.getRepositoryDashboard(currentRepoPath)
    const graphPromise = typeof api.getContributionGraph === 'function'
      ? api.getContributionGraph(currentRepoPath).catch(() => null)
      : Promise.resolve(null)

    const result = await dashboardPromise

    if (dashboardRequestIdRef.current !== requestId) return

    if (result.ok) {
      setRepositoryDashboard(result.data)
    } else {
      setError(result.error.message)
    }

    setDashboardLoading(false)

    const graph = await graphPromise
    if (dashboardRequestIdRef.current === requestId) {
      setContributionGraph(graph && graph.ok ? graph.data : null)
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
    filteredRecentRepositories, repositoryDashboard, contributionGraph, dashboardLoading,
    dashboardRepositoryFilter, setDashboardRepositoryFilter,
    cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName,
    loadRecentRepositories, loadRepositoryDashboard, toggleRepositoryPinned,
    chooseRepository, openRepository, cloneRepository, refreshRepository,
    openRepoInEditor, openRepositoryTerminal
  }
}
