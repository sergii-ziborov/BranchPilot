import { useEffect, useMemo, useRef, useState } from 'react'
import {
  branchPilotErrorText,
  type ApiResult, type BranchPilotApi, type DiffHunk, type FileChange, type GitOperationResult,
  type PatchScope, type RepositoryCounts, type RepositorySnapshot
} from '../shared/branchPilot'
import type { ChangeDiffMode } from '../shared/changeStaging'
import {
  getBulkStageToggleAction, getBulkStageToggleState,
  getChangeStageToggleAction, getChangeStageToggleState, getDefaultChangeDiffMode
} from '../shared/changeStaging'
import { changeLabel } from '../lib/fileChangeLabels'
import { CHANGE_LIST_ITEM_HEIGHT } from '../lib/listMetrics'
import type { RequestConfirmation } from '../lib/prompts'
import { useDiffViewer } from './useDiffViewer'
import { useVirtualList } from './useVirtualList'

type DiffDisplayMode = 'unified' | 'split'
type ChangeSearchMode = 'path' | 'content' | 'all'

const CHANGE_CONTENT_SEARCH_LIMIT = 120

function changeSearchText(change: FileChange): string {
  return [change.path, change.originalPath, change.status, changeLabel(change)]
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

function getChangeIndexKey(snapshot: RepositorySnapshot | null): string {
  if (!snapshot) return ''
  return [
    snapshot.summary.rootPath,
    snapshot.summary.headOid,
    snapshot.status.changes
      .map((change) => `${change.path}:${change.stagedStatus ?? ''}:${change.unstagedStatus ?? ''}:${change.additions ?? ''}:${change.deletions ?? ''}`)
      .sort()
      .join('|')
  ].join('::')
}

function countsFromChanges(changes: FileChange[] | undefined): RepositoryCounts | undefined {
  if (!changes) return undefined
  return changes.reduce<RepositoryCounts>(
    (next, change) => ({
      changed: next.changed + 1,
      staged: next.staged + (change.staged ? 1 : 0),
      unstaged: next.unstaged + (change.unstaged ? 1 : 0),
      untracked: next.untracked + (change.untracked ? 1 : 0),
      conflicted: next.conflicted + (change.conflicted ? 1 : 0)
    }),
    { changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  )
}

/** Owns change selection, diff viewing, staging, and patch operations. */
export function useChanges({
  api,
  currentRepoPath,
  snapshot,
  counts,
  setNotice,
  setError,
  runSnapshotAction,
  runApiAction,
  runOperationAction,
  applySnapshot,
  requestConfirmation
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  counts: RepositoryCounts | undefined
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  runApiAction: <T>(progressLabel: string, action: () => Promise<ApiResult<T>>, onSuccess: (data: T) => void | Promise<void>) => Promise<boolean>
  runOperationAction: (label: string, action: () => Promise<ApiResult<GitOperationResult>>, progressLabel?: string) => Promise<void>
  applySnapshot: (snapshot: RepositorySnapshot, successMessage: string) => void
  requestConfirmation: RequestConfirmation
}) {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [changeFilter, setChangeFilter] = useState('')
  const [changeSearchMode, setChangeSearchMode] = useState<ChangeSearchMode>('path')
  const [diffMode, setDiffMode] = useState<ChangeDiffMode>('unstaged')
  const [diffDisplayMode, setDiffDisplayMode] = useState<DiffDisplayMode>('unified')
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(false)
  const [diffExpanded, setDiffExpanded] = useState(false)
  const [patchScope, setPatchScope] = useState<PatchScope>('working-tree')
  const [changeContentIndex, setChangeContentIndex] = useState<Map<string, string>>(new Map())
  const [changeContentIndexing, setChangeContentIndexing] = useState(false)
  const [stagingPendingPaths, setStagingPendingPaths] = useState<Set<string>>(new Set())
  // Per-file optimistic stage intent, keyed by path so it survives the virtual
  // list unmounting/remounting a row on scroll (a row-local state would be lost,
  // which made unchecked boxes "come back" while the slow git snapshot caught up).
  const [stageOptimistic, setStageOptimistic] = useState<Map<string, boolean>>(new Map())
  const [bulkStagingPending, setBulkStagingPending] = useState(false)
  const [bulkStageOptimisticChecked, setBulkStageOptimisticChecked] = useState<boolean | null>(null)
  const changesActionsMenuRef = useRef<HTMLDetailsElement>(null)
  const changeIndexKey = useMemo(() => getChangeIndexKey(snapshot), [snapshot])

  const filteredChanges = useMemo(() => {
    // Stable alphabetical order so staging/unstaging a file never reorders the
    // list (git status groups staged/unstaged, which made rows jump).
    const changes = [...(snapshot?.status.changes ?? [])].sort((a, b) => a.path.localeCompare(b.path))
    const query = changeFilter.trim().toLowerCase()

    if (!query) return changes

    return changes.filter((change) => {
      const metadataMatches = changeSearchMode !== 'content' && changeSearchText(change).toLowerCase().includes(query)
      const contentMatches = changeSearchMode !== 'path' && (changeContentIndex.get(change.path) ?? '').toLowerCase().includes(query)
      return metadataMatches || contentMatches
    })
  }, [changeContentIndex, changeFilter, changeSearchMode, snapshot])

  const selectedChange = useMemo(
    () => snapshot?.status.changes.find((change) => change.path === selectedFilePath) ?? null,
    [selectedFilePath, snapshot]
  )

  const virtualChanges = useVirtualList(
    filteredChanges,
    CHANGE_LIST_ITEM_HEIGHT,
    `${snapshot?.summary.rootPath ?? ''}|${changeFilter}|${changeSearchMode}|${changeContentIndex.size}`
  )
  const effectiveCounts = countsFromChanges(snapshot?.status.changes) ?? counts
  const bulkStageToggleState = getBulkStageToggleState(effectiveCounts)
  const selectedFileTarget = currentRepoPath && selectedChange ? `${currentRepoPath}/${selectedChange.path}` : null

  // Drop an optimistic stage intent once the snapshot has caught up to it (or the
  // file is gone), so the checkbox stops overriding the real staged state.
  useEffect(() => {
    setStageOptimistic((current) => {
      if (current.size === 0) return current
      const next = new Map(current)
      for (const [path, intended] of current) {
        const change = snapshot?.status.changes.find((candidate) => candidate.path === path)
        if (!change || getChangeStageToggleState(change).checked === intended) {
          next.delete(path)
        }
      }
      return next.size === current.size ? current : next
    })
  }, [snapshot])

  const {
    diff, diffLoading, relatedDiff, imagePreview, diffRequestIdRef,
    selectedDiffStats, selectedRelatedDiffStats, loadDiff
  } = useDiffViewer({
    api, currentRepoPath, snapshot, selectedChange, changeIndexKey, filteredChanges,
    diffMode, setDiffMode, diffIgnoreWhitespace, diffExpanded, setError
  })

  function closeChangesActionsMenu() {
    if (changesActionsMenuRef.current) {
      changesActionsMenuRef.current.open = false
    }
  }

  function setPathStagingPending(path: string, pending: boolean) {
    setStagingPendingPaths((current) => {
      const next = new Set(current)
      if (pending) next.add(path)
      else next.delete(path)
      return next
    })
  }

  async function applyStagingSnapshot(
    action: () => Promise<ApiResult<RepositorySnapshot>>,
    successMessage: string
  ): Promise<boolean> {
    const result = await action()

    if (result.ok) {
      applySnapshot(result.data, successMessage)
      return true
    }

    setError(result.error.message)
    setNotice(branchPilotErrorText(result.error))
    return false
  }

  async function toggleChangeStage(change: FileChange) {
    if (!api || !currentRepoPath) return
    const action = getChangeStageToggleAction(change)

    if (action === 'none') return

    setSelectedFilePath(change.path)
    setPathStagingPending(change.path, true)
    setStageOptimistic((current) => new Map(current).set(change.path, action === 'stage'))

    try {
      if (action === 'unstage') {
        const ok = await applyStagingSnapshot(
          () => api.unstageFile({ repoPath: currentRepoPath, filePath: change.path }),
          'File unstaged.'
        )
        if (ok) setDiffMode('unstaged')
        return
      }

      const ok = await applyStagingSnapshot(
        () => api.stageFile({ repoPath: currentRepoPath, filePath: change.path }),
        'File staged.'
      )
      if (ok) setDiffMode('staged')
    } finally {
      setPathStagingPending(change.path, false)
    }
  }

  async function toggleBulkStage() {
    if (!api || !currentRepoPath || bulkStagingPending) return
    const action = getBulkStageToggleAction(effectiveCounts)
    if (action === 'none') return

    setBulkStagingPending(true)
    setBulkStageOptimisticChecked(action === 'stage_all')
    try {
      if (action === 'stage_all') {
        await applyStagingSnapshot(() => api.stageAll(currentRepoPath), 'All changes staged.')
        return
      }

      if (action === 'unstage_all') {
        await applyStagingSnapshot(() => api.unstageAll(currentRepoPath), 'All changes unstaged.')
      }
    } finally {
      setBulkStagingPending(false)
      setBulkStageOptimisticChecked(null)
    }
  }

  async function stageSelectedHunk(hunk: DiffHunk) {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction(
      'Hunk staged.',
      () => api.stageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch: hunk.patch }),
      'Staging hunk...'
    )
  }

  async function unstageSelectedHunk(hunk: DiffHunk) {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction(
      'Hunk unstaged.',
      () => api.unstageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch: hunk.patch }),
      'Unstaging hunk...'
    )
  }

  async function discardSelectedHunk(hunk: DiffHunk) {
    if (!api || !currentRepoPath || !selectedChange) return
    const confirmed = await requestConfirmation(
      `Discard this hunk in ${selectedChange.path}? This permanently reverts those lines in the working tree.`,
      { title: 'Discard Hunk', confirmLabel: 'Discard hunk', variant: 'danger' }
    )
    if (!confirmed) return

    await runSnapshotAction(
      'Hunk discarded.',
      () => api.discardHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch: hunk.patch }),
      'Discarding hunk...'
    )
  }

  async function discardSelected(change = selectedChange) {
    if (!api || !currentRepoPath || !change) return
    const isUntracked = change.untracked
    const confirmed = await requestConfirmation(
      isUntracked
        ? `Delete untracked file ${change.path}?`
        : `Discard local changes in ${change.path}?`,
      {
        title: isUntracked ? 'Delete Untracked File' : 'Discard File Changes',
        confirmLabel: isUntracked ? 'Delete file' : 'Discard changes',
        variant: 'danger'
      }
    )
    if (!confirmed) return

    const action = isUntracked ? api.deleteUntrackedFile : api.discardFile

    await runSnapshotAction(
      isUntracked ? 'Untracked file deleted.' : 'File discarded.',
      () => action({ repoPath: currentRepoPath, filePath: change.path, confirmed }),
      isUntracked ? 'Deleting file...' : 'Discarding file changes...'
    )
  }

  async function discardSelectedLines(patch: string, stagedSelection = diffMode === 'staged') {
    if (!api || !currentRepoPath || !selectedChange) return
    const confirmed = await requestConfirmation(
      stagedSelection
        ? `Unstage and discard selected lines in ${selectedChange.path}? This permanently removes them from the commit and working tree.`
        : `Discard selected lines in ${selectedChange.path}? This permanently reverts those lines in the working tree.`,
      { title: 'Discard Selected Lines', confirmLabel: 'Discard selected', variant: 'danger' }
    )
    if (!confirmed) return

    await runSnapshotAction(
      'Selected lines discarded.',
      async () => {
        if (stagedSelection) {
          const unstaged = await api.unstageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch })
          if (!unstaged.ok) return unstaged
        }

        return api.discardHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch })
      },
      'Discarding selected lines...'
    )
  }

  async function exportPatch(scope = patchScope) {
    if (!api || !currentRepoPath) return

    await runApiAction('Exporting patch...', () => api.exportPatch({
      repoPath: currentRepoPath,
      scope
    }), (data) => {
      setNotice(data ? `Patch exported: ${data.fileName}` : 'Patch export cancelled.')
    })
  }

  async function applyPatch() {
    if (!api || !currentRepoPath) return

    const confirmed = await requestConfirmation('Apply a patch file to the working tree?', {
      title: 'Apply Patch',
      confirmLabel: 'Apply patch'
    })
    if (!confirmed) return

    await runApiAction('Applying patch...', () => api.applyPatch({
      repoPath: currentRepoPath,
      confirmed
    }), (data) => {
      if (data) {
        applySnapshot(data, 'Patch applied.')
      } else {
        setNotice('Patch apply cancelled.')
      }
    })
  }

  async function openSelectedFileInEditor() {
    if (!api || !selectedFileTarget) return
    await runOperationAction('File opened in editor.', () => api.openInEditor({ targetPath: selectedFileTarget }))
  }

  async function openSelectedFileLineInEditor(line?: number) {
    if (!api || !selectedFileTarget || !line) return
    await runOperationAction(`File opened at line ${line}.`, () => api.openInEditor({ targetPath: selectedFileTarget, line }))
  }

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const menu = changesActionsMenuRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    setChangeContentIndex(new Map())
    setChangeContentIndexing(false)
  }, [changeIndexKey])

  useEffect(() => {
    const query = changeFilter.trim()
    if (!api || !currentRepoPath || !snapshot || !query || changeSearchMode === 'path') {
      setChangeContentIndexing(false)
      return
    }

    const changes = [...snapshot.status.changes]
      .sort((a, b) => a.path.localeCompare(b.path))
      .filter((change) => !changeContentIndex.has(change.path))
      .slice(0, CHANGE_CONTENT_SEARCH_LIMIT)

    if (changes.length === 0) {
      setChangeContentIndexing(false)
      return
    }

    let cancelled = false
    setChangeContentIndexing(true)

    const loadIndex = async () => {
      const entries: [string, string][] = []

      for (const change of changes) {
        if (cancelled) return

        const stagedModes = new Set<boolean>()
        if (change.staged) stagedModes.add(true)
        if (change.unstaged || change.untracked || !change.staged) stagedModes.add(false)

        const chunks: string[] = []
        for (const staged of stagedModes) {
          const result = await api.getDiff({
            repoPath: currentRepoPath,
            filePath: change.path,
            staged,
            ignoreWhitespace: false,
            contextLines: 20
          }).catch(() => null)

          if (cancelled) return
          if (result?.ok) chunks.push(result.data.text)
        }

        entries.push([change.path, chunks.join('\n')])
      }

      if (cancelled) return

      setChangeContentIndex((current) => {
        const next = new Map(current)
        for (const [path, text] of entries) next.set(path, text)
        return next
      })
      setChangeContentIndexing(false)
    }

    void loadIndex()

    return () => {
      cancelled = true
    }
  }, [api, changeFilter, changeIndexKey, changeSearchMode, currentRepoPath, snapshot])

  useEffect(() => {
    if (!snapshot) return

    const filterActive = changeFilter.trim().length > 0
    const visibleChanges = filterActive ? filteredChanges : snapshot.status.changes
    const firstChange = visibleChanges[0]

    if (!selectedFilePath || !visibleChanges.some((change) => change.path === selectedFilePath)) {
      setSelectedFilePath(firstChange?.path ?? null)
      setDiffMode(firstChange ? getDefaultChangeDiffMode(firstChange) : 'unstaged')
    }
  }, [changeFilter, filteredChanges, selectedFilePath, snapshot])

  // Each newly selected file starts collapsed (compact context).
  useEffect(() => {
    setDiffExpanded(false)
  }, [selectedFilePath])

  return {
    selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter,
    changeSearchMode, setChangeSearchMode, changeContentIndexing,
    diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
    diffExpanded, setDiffExpanded,
    diff, diffLoading, relatedDiff, imagePreview, patchScope, setPatchScope, diffRequestIdRef, changesActionsMenuRef,
    filteredChanges, selectedChange, selectedDiffStats, selectedRelatedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget,
    stagingPendingPaths, bulkStagingPending, bulkStageOptimisticChecked, stageOptimistic,
    loadDiff, closeChangesActionsMenu, toggleChangeStage, toggleBulkStage,
    stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelected, discardSelectedLines, exportPatch, applyPatch,
    openSelectedFileInEditor, openSelectedFileLineInEditor
  }
}
