import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApiResult, BranchPilotApi, DiffHunk, DiffResult, FileChange, GitOperationResult,
  ImagePreview, PatchScope, RepositoryCounts, RepositorySnapshot
} from '../shared/branchPilot'
import type { ChangeDiffMode } from '../shared/changeStaging'
import {
  getAvailableChangeDiffMode, getBulkStageToggleAction, getBulkStageToggleState,
  getChangeStageToggleAction, getDefaultChangeDiffMode
} from '../shared/changeStaging'
import { getDiffStats } from '../shared/diffView'
import { changeLabel } from '../lib/fileChangeLabels'
import { CHANGE_LIST_ITEM_HEIGHT } from '../lib/listMetrics'
import type { RequestConfirmation } from '../lib/prompts'
import { useVirtualList } from './useVirtualList'

type DiffDisplayMode = 'unified' | 'split'
type ChangeSearchMode = 'path' | 'content' | 'all'

const CHANGE_CONTENT_SEARCH_LIMIT = 120
const DEFAULT_DIFF_CONTEXT_LINES = 3
const EXPANDED_DIFF_CONTEXT_LINES = 40

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
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [patchScope, setPatchScope] = useState<PatchScope>('working-tree')
  const [changeContentIndex, setChangeContentIndex] = useState<Map<string, string>>(new Map())
  const [changeContentIndexing, setChangeContentIndexing] = useState(false)
  const diffRequestIdRef = useRef(0)
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

  const selectedDiffStats = useMemo(() => {
    if (!diff || diff.binary || !diff.text.trim()) return null
    return getDiffStats(diff)
  }, [diff])

  const virtualChanges = useVirtualList(
    filteredChanges,
    CHANGE_LIST_ITEM_HEIGHT,
    `${snapshot?.summary.rootPath ?? ''}|${changeFilter}|${changeSearchMode}|${changeContentIndex.size}`
  )
  const bulkStageToggleState = getBulkStageToggleState(counts)
  const selectedFileTarget = currentRepoPath && selectedChange ? `${currentRepoPath}/${selectedChange.path}` : null

  async function loadDiff(change: FileChange, mode: ChangeDiffMode) {
    if (!api || !currentRepoPath) return
    const requestId = diffRequestIdRef.current + 1
    diffRequestIdRef.current = requestId
    const staged = mode === 'staged' && change.staged
    const result = await api.getDiff({
      repoPath: currentRepoPath,
      filePath: change.path,
      staged,
      ignoreWhitespace: diffIgnoreWhitespace,
      contextLines: diffExpanded ? EXPANDED_DIFF_CONTEXT_LINES : DEFAULT_DIFF_CONTEXT_LINES
    })

    if (diffRequestIdRef.current !== requestId) return

    if (result.ok) {
      setDiff(result.data)

      if (result.data.binary && typeof api.getImagePreview === 'function' && /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(change.path)) {
        const preview = await api.getImagePreview({ repoPath: currentRepoPath, filePath: change.path }).catch(() => null)
        if (diffRequestIdRef.current !== requestId) return
        setImagePreview(preview && preview.ok ? preview.data : null)
      } else {
        setImagePreview(null)
      }
    } else {
      setDiff(null)
      setImagePreview(null)
      setError(result.error.message)
    }
  }

  function closeChangesActionsMenu() {
    if (changesActionsMenuRef.current) {
      changesActionsMenuRef.current.open = false
    }
  }

  async function toggleChangeStage(change: FileChange) {
    if (!api || !currentRepoPath) return
    const action = getChangeStageToggleAction(change)

    if (action === 'none') return

    setSelectedFilePath(change.path)

    if (action === 'unstage') {
      await runSnapshotAction(
        'File unstaged.',
        () => api.unstageFile({ repoPath: currentRepoPath, filePath: change.path }),
        'Unstaging file...'
      )
      setDiffMode('unstaged')
      return
    }

    await runSnapshotAction(
      'File staged.',
      () => api.stageFile({ repoPath: currentRepoPath, filePath: change.path }),
      'Staging file...'
    )
    setDiffMode('staged')
  }

  async function toggleBulkStage() {
    if (!api || !currentRepoPath) return
    const action = getBulkStageToggleAction(counts)

    if (action === 'stage_all') {
      await runSnapshotAction('All changes staged.', () => api.stageAll(currentRepoPath), 'Staging all changes...')
      return
    }

    if (action === 'unstage_all') {
      await runSnapshotAction('All changes unstaged.', () => api.unstageAll(currentRepoPath), 'Unstaging all changes...')
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

  async function discardSelectedLines(patch: string) {
    if (!api || !currentRepoPath || !selectedChange) return
    const confirmed = await requestConfirmation(
      `Discard selected lines in ${selectedChange.path}? This permanently reverts those lines in the working tree.`,
      { title: 'Discard Selected Lines', confirmLabel: 'Discard selected', variant: 'danger' }
    )
    if (!confirmed) return

    await runSnapshotAction(
      'Selected lines discarded.',
      () => api.discardHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch }),
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

  useEffect(() => {
    if (!snapshot || !selectedChange) {
      diffRequestIdRef.current += 1
      setDiff(null)
      return
    }

    const availableMode = getAvailableChangeDiffMode(selectedChange, diffMode)

    if (availableMode !== diffMode) {
      setDiffMode(availableMode)
      return
    }

    void loadDiff(selectedChange, availableMode)

  }, [diffIgnoreWhitespace, diffExpanded, diffMode, selectedChange, snapshot])

  // Each newly selected file starts collapsed (compact context).
  useEffect(() => {
    setDiffExpanded(false)
  }, [selectedFilePath])

  return {
    selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter,
    changeSearchMode, setChangeSearchMode, changeContentIndexing,
    diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
    diffExpanded, setDiffExpanded,
    diff, imagePreview, patchScope, setPatchScope, diffRequestIdRef, changesActionsMenuRef,
    filteredChanges, selectedChange, selectedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget,
    loadDiff, closeChangesActionsMenu, toggleChangeStage, toggleBulkStage,
    stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelected, discardSelectedLines, exportPatch, applyPatch,
    openSelectedFileInEditor, openSelectedFileLineInEditor
  }
}
