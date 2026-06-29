import { useEffect, useMemo, useRef, useState } from 'react'
import type { BranchPilotApi, CommitDetails, CommitSummary, DiffResult, RepositorySnapshot } from '../shared/branchPilot'
import { formatDate } from '../lib/format'
import { HISTORY_LIST_ITEM_HEIGHT } from '../lib/listMetrics'
import type { ViewMode } from '../lib/viewMode'
import { useVirtualList } from './useVirtualList'

type HistorySearchMode = 'commit' | 'files' | 'all'

const HISTORY_FILE_SEARCH_LIMIT = 200

function commitSearchText(commit: CommitSummary): string {
  return [
    commit.sha,
    commit.shortSha,
    commit.subject,
    commit.authorName,
    commit.authorEmail,
    formatDate(commit.authoredAt)
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

function commitFileSearchText(details: CommitDetails): string {
  return details.files
    .flatMap((file) => [file.path, file.originalPath, file.status, file.rawStatus])
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

/** Owns commit history, selection, and per-commit detail/diff loading. */
export function useHistory({
  api,
  currentRepoPath,
  snapshot,
  viewMode,
  setError
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  viewMode: ViewMode
  setError: (message: string | null) => void
}) {
  const [history, setHistory] = useState<CommitSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('')
  const [historySearchMode, setHistorySearchMode] = useState<HistorySearchMode>('commit')
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null)
  const [commitDetailsLoading, setCommitDetailsLoading] = useState(false)
  const [selectedCommitFilePath, setSelectedCommitFilePath] = useState<string | null>(null)
  const [commitFileDiff, setCommitFileDiff] = useState<DiffResult | null>(null)
  const [commitFileDiffLoading, setCommitFileDiffLoading] = useState(false)
  const [historyFileIndex, setHistoryFileIndex] = useState<Map<string, string>>(new Map())
  const [historyFileIndexing, setHistoryFileIndexing] = useState(false)
  const commitDetailsRequestIdRef = useRef(0)
  const commitFileDiffRequestIdRef = useRef(0)

  const filteredHistory = useMemo(() => {
    const query = historyFilter.trim().toLowerCase()

    if (!query) return history

    return history.filter((commit) => {
      const commitMatches = historySearchMode !== 'files' && commitSearchText(commit).toLowerCase().includes(query)
      const fileMatches = historySearchMode !== 'commit' && (historyFileIndex.get(commit.sha) ?? '').toLowerCase().includes(query)
      return commitMatches || fileMatches
    })
  }, [history, historyFileIndex, historyFilter, historySearchMode])

  const virtualHistory = useVirtualList(
    filteredHistory,
    HISTORY_LIST_ITEM_HEIGHT,
    `${snapshot?.summary.rootPath ?? ''}|${historyFilter}|${historySearchMode}|${historyFileIndex.size}`
  )

  async function loadHistory() {
    if (!api || !currentRepoPath) return
    setHistoryLoading(true)
    try {
      const result = await api.getHistory(currentRepoPath)

      if (result.ok) {
        setHistory(result.data)
        setSelectedCommitSha((currentSha) =>
          currentSha && result.data.some((commit) => commit.sha === currentSha) ? currentSha : result.data[0]?.sha ?? null
        )
      } else {
        setError(result.error.message)
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadCommitFileDiff(commitSha: string, filePath: string) {
    if (!api || !currentRepoPath) return
    const requestId = commitFileDiffRequestIdRef.current + 1
    commitFileDiffRequestIdRef.current = requestId
    setSelectedCommitFilePath(filePath)
    setCommitFileDiffLoading(true)

    try {
      const result = await api.getCommitFileDiff({ repoPath: currentRepoPath, commitSha, filePath })

      if (commitFileDiffRequestIdRef.current !== requestId) return

      if (result.ok) {
        setCommitFileDiff(result.data)
      } else {
        setCommitFileDiff(null)
        setError(result.error.message)
      }
    } catch (error) {
      if (commitFileDiffRequestIdRef.current === requestId) {
        setCommitFileDiff(null)
        setError(error instanceof Error ? error.message : 'Failed to load commit file diff.')
      }
    } finally {
      if (commitFileDiffRequestIdRef.current === requestId) {
        setCommitFileDiffLoading(false)
      }
    }
  }

  async function loadCommitDetails(commitSha: string) {
    if (!api || !currentRepoPath) return
    const requestId = commitDetailsRequestIdRef.current + 1
    commitDetailsRequestIdRef.current = requestId
    setCommitDetailsLoading(true)

    try {
      const result = await api.getCommitDetails({ repoPath: currentRepoPath, commitSha })

      if (commitDetailsRequestIdRef.current !== requestId) return

      if (result.ok) {
        setCommitDetails(result.data)
        const firstFile = result.data.files[0]
        setSelectedCommitFilePath(firstFile?.path ?? null)

        if (firstFile) {
          void loadCommitFileDiff(result.data.sha, firstFile.path)
        } else {
          setCommitFileDiff(null)
          setCommitFileDiffLoading(false)
        }
      } else {
        setError(result.error.message)
      }
    } catch (error) {
      if (commitDetailsRequestIdRef.current === requestId) {
        setError(error instanceof Error ? error.message : 'Failed to load commit details.')
      }
    } finally {
      if (commitDetailsRequestIdRef.current === requestId) {
        setCommitDetailsLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!snapshot || viewMode !== 'history') return
    void loadHistory()
     
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

  useEffect(() => {
    setHistoryFileIndex(new Map())
    setHistoryFileIndexing(false)
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid])

  useEffect(() => {
    const query = historyFilter.trim()
    if (!api || !currentRepoPath || viewMode !== 'history' || !query || historySearchMode === 'commit') {
      setHistoryFileIndexing(false)
      return
    }

    const commits = history
      .filter((commit) => !historyFileIndex.has(commit.sha))
      .slice(0, HISTORY_FILE_SEARCH_LIMIT)

    if (commits.length === 0) {
      setHistoryFileIndexing(false)
      return
    }

    let cancelled = false
    setHistoryFileIndexing(true)

    const loadFileIndex = async () => {
      const entries: [string, string][] = []

      for (const commit of commits) {
        if (cancelled) return

        const result = await api.getCommitDetails({ repoPath: currentRepoPath, commitSha: commit.sha }).catch(() => null)
        if (cancelled) return
        if (result?.ok) entries.push([commit.sha, commitFileSearchText(result.data)])
      }

      if (cancelled) return

      setHistoryFileIndex((current) => {
        const next = new Map(current)
        for (const [sha, text] of entries) next.set(sha, text)
        return next
      })
      setHistoryFileIndexing(false)
    }

    void loadFileIndex()

    return () => {
      cancelled = true
    }
  }, [api, currentRepoPath, history, historyFilter, historySearchMode, snapshot?.summary.rootPath, viewMode])

  useEffect(() => {
    if (viewMode !== 'history') return

    const filterActive = historyFilter.trim().length > 0
    const visibleHistory = filterActive ? filteredHistory : history
    const firstCommit = visibleHistory[0]

    if (!selectedCommitSha || !visibleHistory.some((commit) => commit.sha === selectedCommitSha)) {
      setSelectedCommitSha(firstCommit?.sha ?? null)
    }
  }, [filteredHistory, history, historyFilter, selectedCommitSha, viewMode])

  useEffect(() => {
    if (!snapshot || viewMode !== 'history' || !selectedCommitSha) {
      commitDetailsRequestIdRef.current += 1
      commitFileDiffRequestIdRef.current += 1
      setCommitDetails(null)
      setCommitFileDiff(null)
      setCommitDetailsLoading(false)
      setCommitFileDiffLoading(false)
      return
    }

    void loadCommitDetails(selectedCommitSha)
     
  }, [selectedCommitSha, snapshot?.summary.rootPath, viewMode])

  return {
    history,
    historyLoading,
    historyFilter,
    setHistoryFilter,
    historySearchMode,
    setHistorySearchMode,
    historyFileIndexing,
    selectedCommitSha,
    setSelectedCommitSha,
    commitDetails,
    commitDetailsLoading,
    selectedCommitFilePath,
    commitFileDiff,
    commitFileDiffLoading,
    filteredHistory,
    virtualHistory,
    loadHistory,
    loadCommitDetails,
    loadCommitFileDiff
  }
}
