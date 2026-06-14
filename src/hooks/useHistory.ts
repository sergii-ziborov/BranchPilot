import { useEffect, useMemo, useRef, useState } from 'react'
import type { BranchPilotApi, CommitDetails, CommitSummary, DiffResult, RepositorySnapshot } from '../shared/branchPilot'
import { formatDate } from '../lib/format'
import { HISTORY_LIST_ITEM_HEIGHT } from '../lib/listMetrics'
import type { ViewMode } from '../lib/viewMode'
import { useVirtualList } from './useVirtualList'

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
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null)
  const [selectedCommitFilePath, setSelectedCommitFilePath] = useState<string | null>(null)
  const [commitFileDiff, setCommitFileDiff] = useState<DiffResult | null>(null)
  const commitDetailsRequestIdRef = useRef(0)
  const commitFileDiffRequestIdRef = useRef(0)

  const filteredHistory = useMemo(() => {
    const query = historyFilter.trim().toLowerCase()

    if (!query) return history

    return history.filter((commit) =>
      [
        commit.sha,
        commit.shortSha,
        commit.subject,
        commit.authorName,
        commit.authorEmail,
        formatDate(commit.authoredAt)
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query))
    )
  }, [history, historyFilter])

  const virtualHistory = useVirtualList(filteredHistory, HISTORY_LIST_ITEM_HEIGHT, `${snapshot?.summary.rootPath ?? ''}|${historyFilter}`)

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
    const result = await api.getCommitFileDiff({ repoPath: currentRepoPath, commitSha, filePath })

    if (commitFileDiffRequestIdRef.current !== requestId) return

    if (result.ok) {
      setCommitFileDiff(result.data)
    } else {
      setCommitFileDiff(null)
      setError(result.error.message)
    }
  }

  async function loadCommitDetails(commitSha: string) {
    if (!api || !currentRepoPath) return
    const requestId = commitDetailsRequestIdRef.current + 1
    commitDetailsRequestIdRef.current = requestId
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
      }
    } else {
      setError(result.error.message)
    }
  }

  useEffect(() => {
    if (!snapshot || viewMode !== 'history') return
    void loadHistory()
     
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

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
      return
    }

    void loadCommitDetails(selectedCommitSha)
     
  }, [selectedCommitSha, snapshot?.summary.rootPath, viewMode])

  return {
    history,
    historyLoading,
    historyFilter,
    setHistoryFilter,
    selectedCommitSha,
    setSelectedCommitSha,
    commitDetails,
    selectedCommitFilePath,
    commitFileDiff,
    filteredHistory,
    virtualHistory,
    loadHistory,
    loadCommitDetails,
    loadCommitFileDiff
  }
}
