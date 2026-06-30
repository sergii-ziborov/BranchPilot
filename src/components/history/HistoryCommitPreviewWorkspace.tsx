import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent
} from 'react'
import { ArrowLeft, ChevronDown, Search } from 'lucide-react'
import type {
  BranchPilotApi,
  CommitDetails,
  CommitFileContentResult,
  CommitSummary,
  RepositorySnapshot
} from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { SignalStatus } from '../SignalStatus'
import {
  HistoryFilePreview,
  historyPreviewLines,
  type HistoryFileLineState,
  type HistoryFilePreviewModel
} from './HistoryFilePreview'

interface HistoryCommitPreviewWorkspaceProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  history: CommitSummary[]
  commitDetails: CommitDetails
  preview: HistoryFilePreviewModel
  onBack: () => void
  openCommitFilePreview: (filePath: string) => void
}

interface CompareBranchCandidate {
  value: string
  label: string
  kind: 'Local branch' | 'Remote branch'
}

const PREVIEW_SPLITTER_WIDTH = 10
const PREVIEW_SIDEBAR_STORAGE_KEY = 'branchpilot:history-preview-sidebar-width'
const PREVIEW_PRIMARY_STORAGE_KEY = 'branchpilot:history-preview-primary-width'
const PREVIEW_SIDEBAR_DEFAULT_WIDTH = 390
const PREVIEW_SIDEBAR_MIN_WIDTH = 280
const PREVIEW_SIDEBAR_MAX_WIDTH = 720
const PREVIEW_MAIN_MIN_WIDTH = 650
const PREVIEW_PRIMARY_DEFAULT_WIDTH = 690
const PREVIEW_PRIMARY_MIN_WIDTH = 320
const PREVIEW_PRIMARY_MAX_WIDTH = 980
const PREVIEW_COMPARE_MIN_WIDTH = 320

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampResizableWidth(width: number, containerWidth: number | undefined, min: number, max: number, detailMin: number): number {
  const maxForContainer = containerWidth && containerWidth > 0
    ? Math.max(min, containerWidth - PREVIEW_SPLITTER_WIDTH - detailMin)
    : max

  return Math.round(clamp(width, min, Math.min(max, maxForContainer)))
}

function readStoredWidth(storageKey: string, fallback: number, min: number, max: number, detailMin: number): number {
  try {
    const rawWidth = window.localStorage.getItem(storageKey)
    if (rawWidth === null) return fallback

    const stored = Number(rawWidth)
    if (Number.isFinite(stored)) return clampResizableWidth(stored, undefined, min, max, detailMin)
  } catch {
    /* ignore unavailable storage */
  }

  return fallback
}

function persistWidth(storageKey: string, width: number) {
  try {
    window.localStorage.setItem(storageKey, String(width))
  } catch {
    /* ignore unavailable storage */
  }
}

function commitSearchText(commit: CommitSummary): string {
  return `${commit.shortSha} ${commit.sha} ${commit.subject} ${commit.authorName} ${commit.authorEmail} ${commit.authoredAt}`.toLowerCase()
}

function compareTextLines(
  primaryContent: CommitFileContentResult | null | undefined,
  compareContent: CommitFileContentResult | null | undefined
): { primaryStates: HistoryFileLineState[]; compareStates: HistoryFileLineState[]; firstChangedIndex: number | null } {
  if (!primaryContent || !compareContent || primaryContent.binary || compareContent.binary) {
    return { primaryStates: [], compareStates: [], firstChangedIndex: null }
  }

  const primaryLines = historyPreviewLines(primaryContent.text)
  const compareLines = historyPreviewLines(compareContent.text)
  const primaryStates: HistoryFileLineState[] = primaryLines.map(() => 'same')
  const compareStates: HistoryFileLineState[] = compareLines.map(() => 'same')
  const lineCount = Math.max(primaryLines.length, compareLines.length)
  let firstChangedIndex: number | null = null

  for (let index = 0; index < lineCount; index += 1) {
    const primaryLine = primaryLines[index]
    const compareLine = compareLines[index]

    if (primaryLine === compareLine) continue
    if (firstChangedIndex === null) firstChangedIndex = index

    if (primaryLine === undefined) {
      compareStates[index] = 'added'
    } else if (compareLine === undefined) {
      primaryStates[index] = 'removed'
    } else {
      primaryStates[index] = 'changed'
      compareStates[index] = 'changed'
    }
  }

  return { primaryStates, compareStates, firstChangedIndex }
}

export function HistoryCommitPreviewWorkspace({
  api,
  currentRepoPath,
  snapshot,
  history,
  commitDetails,
  preview,
  onBack,
  openCommitFilePreview
}: HistoryCommitPreviewWorkspaceProps) {
  const workspaceRef = useRef<HTMLElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const comparePickerRef = useRef<HTMLDivElement | null>(null)
  const compareDetailsRequestRef = useRef(0)
  const compareFileRequestRef = useRef(0)
  const primaryCodeRef = useRef<HTMLPreElement | null>(null)
  const compareCodeRef = useRef<HTMLPreElement | null>(null)
  const syncingPreviewScrollRef = useRef(false)
  const [syncedCodeWidth, setSyncedCodeWidth] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(() => (
    readStoredWidth(PREVIEW_SIDEBAR_STORAGE_KEY, PREVIEW_SIDEBAR_DEFAULT_WIDTH, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
  ))
  const [primaryPaneWidth, setPrimaryPaneWidth] = useState(() => (
    readStoredWidth(PREVIEW_PRIMARY_STORAGE_KEY, PREVIEW_PRIMARY_DEFAULT_WIDTH, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
  ))
  const [fileQuery, setFileQuery] = useState('')
  const [compareQuery, setCompareQuery] = useState('')
  const [comparePickerOpen, setComparePickerOpen] = useState(false)
  const [compareSha, setCompareSha] = useState('')
  const [compareDetails, setCompareDetails] = useState<CommitDetails | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareFileContent, setCompareFileContent] = useState<CommitFileContentResult | null>(null)
  const [compareFileLoading, setCompareFileLoading] = useState(false)
  const [compareFileError, setCompareFileError] = useState<string | null>(null)

  const workspaceStyle = {
    '--history-preview-sidebar-width': `${sidebarWidth}px`
  } as CSSProperties
  const stageStyle = {
    '--history-preview-primary-width': `${primaryPaneWidth}px`,
    '--history-preview-code-width': syncedCodeWidth > 0 ? `${syncedCodeWidth}px` : '100%'
  } as CSSProperties
  const compareFilePaths = useMemo(
    () => new Set((compareDetails?.files ?? []).map((file) => file.path)),
    [compareDetails]
  )
  const intersectingFiles = useMemo(
    () => (compareSha && compareDetails
      ? commitDetails.files.filter((file) => compareFilePaths.has(file.path))
      : commitDetails.files),
    [commitDetails.files, compareDetails, compareFilePaths, compareSha]
  )
  const fileQueryText = fileQuery.trim().toLowerCase()
  const visibleFiles = useMemo(() => (
    fileQueryText
      ? intersectingFiles.filter((file) => `${file.path} ${file.originalPath ?? ''} ${file.status}`.toLowerCase().includes(fileQueryText))
      : intersectingFiles
  ), [fileQueryText, intersectingFiles])
  const compareQueryText = compareQuery.trim().toLowerCase()
  const allCompareBranchCandidates = useMemo<CompareBranchCandidate[]>(() => {
    const local = (snapshot?.branches ?? [])
      .filter((branch) => !branch.current)
      .map((branch) => ({ value: branch.name, label: branch.name, kind: 'Local branch' as const }))
    const localNames = new Set(local.map((branch) => branch.value.toLowerCase()))
    const remote = (snapshot?.remoteBranches ?? [])
      .filter((branch) => branch.branchName && branch.branchName !== 'HEAD')
      .filter((branch) => !localNames.has(branch.branchName.toLowerCase()))
      .map((branch) => ({ value: branch.name, label: branch.name, kind: 'Remote branch' as const }))

    return [...local, ...remote]
      .sort((left, right) => left.value.localeCompare(right.value, undefined, { sensitivity: 'base', numeric: true }))
  }, [snapshot?.branches, snapshot?.remoteBranches])
  const compareBranchCandidates = useMemo(() => {
    return allCompareBranchCandidates
      .filter((branch) => !compareQueryText || `${branch.value} ${branch.kind}`.toLowerCase().includes(compareQueryText))
      .slice(0, 40)
  }, [allCompareBranchCandidates, compareQueryText])
  const compareCandidates = useMemo(() => history
    .filter((commit) => commit.sha !== commitDetails.sha)
    .filter((commit) => !compareQueryText || commitSearchText(commit).includes(compareQueryText))
    .slice(0, 80), [compareQueryText, commitDetails.sha, history])
  const selectedCompareSummary = history.find((commit) => commit.sha === compareSha) ?? null
  const selectedCompareBranch = allCompareBranchCandidates.find((branch) => branch.value === compareSha) ?? null
  const selectedFileChangedInCompare = Boolean(compareSha && compareFilePaths.has(preview.filePath))
  const compareLineState = useMemo(
    () => compareTextLines(preview.content, compareFileContent),
    [compareFileContent, preview.content]
  )
  const compareTargetLabel = selectedCompareSummary?.shortSha ?? selectedCompareBranch?.label ?? (compareSha ? compareSha.slice(0, 16) : 'Full file at this commit')
  const compareTargetDetail = selectedCompareSummary?.subject ?? selectedCompareBranch?.kind ?? (compareSha ? 'Git revision' : 'Selected commit')
  const comparePreview = useMemo<HistoryFilePreviewModel | null>(() => {
    if (!compareSha) return null

    return {
      commitSha: compareSha,
      shortSha: compareTargetLabel,
      filePath: preview.filePath,
      loading: compareFileLoading,
      error: compareFileError,
      content: compareFileContent
    }
  }, [compareFileContent, compareFileError, compareFileLoading, compareSha, compareTargetLabel, preview.filePath])

  const resizeSidebar = (clientX: number) => {
    const workspace = workspaceRef.current
    if (!workspace) return sidebarWidth

    const rect = workspace.getBoundingClientRect()
    const nextWidth = clampResizableWidth(clientX - rect.left, rect.width, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
    setSidebarWidth(nextWidth)
    return nextWidth
  }

  const resizePrimaryPane = (clientX: number) => {
    const stage = stageRef.current
    if (!stage) return primaryPaneWidth

    const rect = stage.getBoundingClientRect()
    const nextWidth = clampResizableWidth(clientX - rect.left, rect.width, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
    setPrimaryPaneWidth(nextWidth)
    return nextWidth
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizeSidebar(event.clientX)
    document.body.classList.add('is-resizing-history-preview-sidebar')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizeSidebar(moveEvent.clientX)
    }
    const stopResize = () => {
      document.body.classList.remove('is-resizing-history-preview-sidebar')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const startPrimaryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    let latestWidth = resizePrimaryPane(event.clientX)
    document.body.classList.add('is-resizing-history-preview-primary')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = resizePrimaryPane(moveEvent.clientX)
    }
    const stopResize = () => {
      document.body.classList.remove('is-resizing-history-preview-primary')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, latestWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const nudgeSidebar = (delta: number) => {
    const width = workspaceRef.current?.getBoundingClientRect().width
    setSidebarWidth((current) => {
      const nextWidth = clampResizableWidth(current + delta, width, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, nextWidth)
      return nextWidth
    })
  }

  const nudgePrimaryPane = (delta: number) => {
    const width = stageRef.current?.getBoundingClientRect().width
    setPrimaryPaneWidth((current) => {
      const nextWidth = clampResizableWidth(current + delta, width, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, nextWidth)
      return nextWidth
    })
  }

  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgeSidebar(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(PREVIEW_SIDEBAR_MIN_WIDTH)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, PREVIEW_SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const width = workspaceRef.current?.getBoundingClientRect().width
      const nextWidth = clampResizableWidth(PREVIEW_SIDEBAR_MAX_WIDTH, width, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH)
      setSidebarWidth(nextWidth)
      persistWidth(PREVIEW_SIDEBAR_STORAGE_KEY, nextWidth)
    }
  }

  const handlePrimaryResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nudgePrimaryPane(event.shiftKey ? -72 : -24)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      nudgePrimaryPane(event.shiftKey ? 72 : 24)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPrimaryPaneWidth(PREVIEW_PRIMARY_MIN_WIDTH)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, PREVIEW_PRIMARY_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      const width = stageRef.current?.getBoundingClientRect().width
      const nextWidth = clampResizableWidth(PREVIEW_PRIMARY_MAX_WIDTH, width, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH)
      setPrimaryPaneWidth(nextWidth)
      persistWidth(PREVIEW_PRIMARY_STORAGE_KEY, nextWidth)
    }
  }

  const chooseCompareTarget = (value: string) => {
    setCompareSha(value)
    setCompareQuery('')
    setComparePickerOpen(false)
  }

  const syncPreviewScroll = (source: 'primary' | 'compare') => (event: ReactUIEvent<HTMLPreElement>) => {
    if (!compareSha || syncingPreviewScrollRef.current) return
    const target = source === 'primary' ? compareCodeRef.current : primaryCodeRef.current
    if (!target) return

    syncingPreviewScrollRef.current = true
    target.scrollTop = event.currentTarget.scrollTop
    target.scrollLeft = event.currentTarget.scrollLeft
    window.requestAnimationFrame(() => {
      syncingPreviewScrollRef.current = false
    })
  }

  const syncPreviewCodeWidth = () => {
    if (!compareSha) {
      setSyncedCodeWidth(0)
      return
    }

    const measureCodeWidth = (element: HTMLPreElement | null): number => {
      if (!element) return 0

      let maxWidth = element.clientWidth
      const rows = element.querySelectorAll<HTMLElement>('.history-file-code-line')
      rows.forEach((row) => {
        const source = row.querySelector<HTMLElement>('.history-file-line-source')
        maxWidth = Math.max(maxWidth, 58 + (source?.scrollWidth ?? row.scrollWidth))
      })
      return Math.ceil(maxWidth)
    }

    const nextWidth = Math.max(
      measureCodeWidth(primaryCodeRef.current),
      measureCodeWidth(compareCodeRef.current)
    )

    setSyncedCodeWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current))
  }

  useEffect(() => {
    const clampToLayout = () => {
      const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width
      const stageWidth = stageRef.current?.getBoundingClientRect().width
      setSidebarWidth((width) => clampResizableWidth(width, workspaceWidth, PREVIEW_SIDEBAR_MIN_WIDTH, PREVIEW_SIDEBAR_MAX_WIDTH, PREVIEW_MAIN_MIN_WIDTH))
      setPrimaryPaneWidth((width) => clampResizableWidth(width, stageWidth, PREVIEW_PRIMARY_MIN_WIDTH, PREVIEW_PRIMARY_MAX_WIDTH, PREVIEW_COMPARE_MIN_WIDTH))
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(clampToLayout)
    })
    window.addEventListener('resize', clampToLayout)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', clampToLayout)
    }
  }, [])

  useEffect(() => {
    if (!comparePickerOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !comparePickerRef.current?.contains(target)) setComparePickerOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setComparePickerOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [comparePickerOpen])

  useEffect(() => {
    if (primaryCodeRef.current) {
      primaryCodeRef.current.scrollTop = 0
      primaryCodeRef.current.scrollLeft = 0
    }
    if (compareCodeRef.current) {
      compareCodeRef.current.scrollTop = 0
      compareCodeRef.current.scrollLeft = 0
    }
    setSyncedCodeWidth(0)
  }, [compareSha, preview.filePath])

  useEffect(() => {
    if (!compareSha) {
      setSyncedCodeWidth(0)
      return
    }

    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        syncPreviewCodeWidth()

        if (primaryCodeRef.current && compareCodeRef.current) {
          compareCodeRef.current.scrollTop = primaryCodeRef.current.scrollTop
          compareCodeRef.current.scrollLeft = primaryCodeRef.current.scrollLeft
        }
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [
    compareFileContent?.binary,
    compareFileContent?.text,
    compareSha,
    preview.content?.binary,
    preview.content?.text,
    preview.filePath
  ])

  useEffect(() => {
    if (!compareSha) return

    let frame = 0
    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(syncPreviewCodeWidth)
    }

    scheduleSync()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleSync)
      return () => {
        if (frame) window.cancelAnimationFrame(frame)
        window.removeEventListener('resize', scheduleSync)
      }
    }

    const observer = new ResizeObserver(scheduleSync)
    if (stageRef.current) observer.observe(stageRef.current)
    if (primaryCodeRef.current) observer.observe(primaryCodeRef.current)
    if (compareCodeRef.current) observer.observe(compareCodeRef.current)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [compareSha, primaryPaneWidth, sidebarWidth, preview.filePath])

  useEffect(() => {
    if (!compareSha || !compareDetails || compareLoading || compareError) return
    if (intersectingFiles.length === 0 || compareFilePaths.has(preview.filePath)) return

    openCommitFilePreview(intersectingFiles[0].path)
  }, [
    compareDetails,
    compareError,
    compareFilePaths,
    compareLoading,
    compareSha,
    intersectingFiles,
    openCommitFilePreview,
    preview.filePath
  ])

  useEffect(() => {
    if (!compareSha || compareLineState.firstChangedIndex === null) return

    const frame = window.requestAnimationFrame(() => {
      const centerPreviewOnChangedLine = (element: HTMLPreElement | null) => {
        if (!element) return

        const lineHeight = 22
        const nextScrollTop = Math.max(0, (compareLineState.firstChangedIndex ?? 0) * lineHeight - element.clientHeight / 2)
        element.scrollTop = nextScrollTop
        element.scrollLeft = 0
      }

      centerPreviewOnChangedLine(primaryCodeRef.current)
      centerPreviewOnChangedLine(compareCodeRef.current)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [compareLineState.firstChangedIndex, compareSha, preview.filePath])

  useEffect(() => {
    const requestId = compareDetailsRequestRef.current + 1
    compareDetailsRequestRef.current = requestId
    setCompareDetails(null)
    setCompareError(null)

    if (!compareSha || !api || !currentRepoPath) {
      setCompareLoading(false)
      return
    }

    setCompareLoading(true)
    void api
      .getCommitDetails({ repoPath: currentRepoPath, commitSha: compareSha })
      .then((result) => {
        if (compareDetailsRequestRef.current !== requestId) return
        setCompareLoading(false)
        if (result.ok) {
          setCompareDetails(result.data)
          return
        }
        setCompareError(result.error.message || result.error.details || 'Failed to load compare commit.')
      })
      .catch((error) => {
        if (compareDetailsRequestRef.current !== requestId) return
        setCompareLoading(false)
        setCompareError(error instanceof Error ? error.message : 'Failed to load compare commit.')
      })
  }, [api, compareSha, currentRepoPath])

  useEffect(() => {
    const requestId = compareFileRequestRef.current + 1
    compareFileRequestRef.current = requestId
    setCompareFileContent(null)
    setCompareFileError(null)

    if (!compareSha || !api || !currentRepoPath) {
      setCompareFileLoading(false)
      return
    }

    setCompareFileLoading(true)
    void api
      .getCommitFileContent({ repoPath: currentRepoPath, commitSha: compareSha, filePath: preview.filePath })
      .then((result) => {
        if (compareFileRequestRef.current !== requestId) return
        setCompareFileLoading(false)
        if (result.ok) {
          setCompareFileContent(result.data)
          return
        }
        setCompareFileError(result.error.message || result.error.details || 'This file does not exist at the compare target.')
      })
      .catch((error) => {
        if (compareFileRequestRef.current !== requestId) return
        setCompareFileLoading(false)
        setCompareFileError(error instanceof Error ? error.message : 'This file does not exist at the compare target.')
      })
  }, [api, compareSha, currentRepoPath, preview.filePath])

  return (
    <section className={compareSha ? 'history-preview-workspace compare-mode' : 'history-preview-workspace'} ref={workspaceRef} style={workspaceStyle}>
      <aside className="history-preview-sidebar">
        <button type="button" className="secondary history-preview-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to history
        </button>
        <div className="history-preview-sidebar-title">
          <span>{compareSha ? 'Changed in both targets' : `Changes in ${commitDetails.shortSha}`}</span>
          <strong>{compareSha && compareLoading ? '...' : `${intersectingFiles.length} files`}</strong>
        </div>
        <label className="history-preview-search">
          <Search size={15} />
          <input
            value={fileQuery}
            onChange={(event) => setFileQuery(event.target.value)}
            placeholder={compareSha ? 'Search shared changed files' : 'Search changed files'}
          />
        </label>
        <div className="history-preview-file-list">
          {compareSha && compareLoading ? (
            <SignalStatus
              className="history-preview-list-curtain"
              label="Loading compare target"
              detail={compareTargetLabel}
            />
          ) : compareSha && compareError ? (
            <div className="quiet-box danger-text">{compareError}</div>
          ) : visibleFiles.length === 0 ? (
            <div className="quiet-box">
              {compareSha && !fileQueryText ? 'No changed files intersect with this compare target.' : 'No files match this search.'}
            </div>
          ) : visibleFiles.map((file) => {
            const fileTypeIcon = fileTypeIconForPath(file.path)
            const intersects = compareFilePaths.has(file.path)

            return (
              <button
                type="button"
                className={[
                  'history-preview-file-row',
                  preview.filePath === file.path ? 'selected' : '',
                  intersects ? 'intersects' : ''
                ].filter(Boolean).join(' ')}
                key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}
                onClick={() => openCommitFilePreview(file.path)}
                title={file.path}
              >
                <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
                  {fileTypeIcon.label}
                </span>
                <span className="file-name">{file.path}</span>
                {intersects && <span className="history-preview-intersection">compare</span>}
              </button>
            )
          })}
        </div>
      </aside>

      <div
        className="history-preview-splitter"
        role="separator"
        aria-label="Resize commit files and preview"
        aria-orientation="vertical"
        aria-valuemin={PREVIEW_SIDEBAR_MIN_WIDTH}
        aria-valuemax={PREVIEW_SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onKeyDown={handleSidebarResizeKeyDown}
      >
        <span />
      </div>

      <div className="history-preview-main">
        <header className="history-preview-header">
          <div>
            <h3>{commitDetails.subject || 'Commit preview'}</h3>
            <p>
              {commitDetails.shortSha} | {commitDetails.authorName} | {formatDate(commitDetails.authoredAt)}
            </p>
          </div>
          <div className="history-preview-compare" ref={comparePickerRef}>
            <div className={comparePickerOpen ? 'history-compare-combobox open' : 'history-compare-combobox'}>
              <Search size={14} />
              <input
                value={compareQuery}
                onFocus={() => setComparePickerOpen(true)}
                onChange={(event) => {
                  setCompareQuery(event.target.value)
                  setComparePickerOpen(true)
                }}
                placeholder="Search branch or commit to compare"
              />
              <button
                type="button"
                title={compareTargetDetail}
                onClick={() => setComparePickerOpen((open) => !open)}
              >
                <span>{compareTargetLabel}</span>
                <ChevronDown size={14} />
              </button>
            </div>
            {comparePickerOpen && (
              <div className="history-compare-menu" role="listbox">
                <button
                  type="button"
                  className={!compareSha ? 'selected' : ''}
                  onClick={() => chooseCompareTarget('')}
                >
                  <strong>Full file at this commit</strong>
                  <span>Selected commit</span>
                </button>
                {compareBranchCandidates.length > 0 && <div className="history-compare-menu-group">Branches</div>}
                {compareBranchCandidates.map((branch) => (
                  <button
                    type="button"
                    key={`${branch.kind}-${branch.value}`}
                    className={compareSha === branch.value ? 'selected' : ''}
                    onClick={() => chooseCompareTarget(branch.value)}
                  >
                    <strong>{branch.label}</strong>
                    <span>{branch.kind}</span>
                  </button>
                ))}
                {compareCandidates.length > 0 && <div className="history-compare-menu-group">Commits</div>}
                {compareCandidates.map((commit) => (
                  <button
                    type="button"
                    key={commit.sha}
                    className={compareSha === commit.sha ? 'selected' : ''}
                    onClick={() => chooseCompareTarget(commit.sha)}
                  >
                    <strong>{commit.shortSha} - {commit.subject || '(no subject)'}</strong>
                    <span>{commit.authorName} | {formatDate(commit.authoredAt)}</span>
                  </button>
                ))}
                {compareBranchCandidates.length === 0 && compareCandidates.length === 0 && (
                  <div className="history-compare-menu-empty">No branch or commit matches this search.</div>
                )}
              </div>
            )}
          </div>
        </header>

        {compareSha && (
          <div className="history-preview-compare-status">
            {compareLoading ? (
              <span>Loading compare target...</span>
            ) : compareError ? (
              <span className="danger-text">{compareError}</span>
            ) : (
              <span>
                Comparing against {compareTargetLabel}
                {selectedFileChangedInCompare ? ' | this file changed in both targets' : ' | choose a shared changed file'}
              </span>
            )}
          </div>
        )}

        <div
          className={compareSha ? 'history-preview-stage compare-mode' : 'history-preview-stage'}
          ref={stageRef}
          style={stageStyle}
        >
          <section className="history-preview-pane">
            <HistoryFilePreview
              preview={preview}
              onBack={onBack}
              onCopyContent={() => preview.content && !preview.content.binary && navigator.clipboard.writeText(preview.content.text)}
              onCopyPath={() => navigator.clipboard.writeText(preview.filePath)}
              onCopySha={() => navigator.clipboard.writeText(preview.commitSha)}
              showBack={false}
              codeRef={primaryCodeRef}
              onCodeScroll={syncPreviewScroll('primary')}
              lineStates={compareSha ? compareLineState.primaryStates : undefined}
            />
          </section>

          {compareSha && (
            <>
              <div
                className="history-preview-stage-splitter"
                role="separator"
                aria-label="Resize selected and compare file previews"
                aria-orientation="vertical"
                aria-valuemin={PREVIEW_PRIMARY_MIN_WIDTH}
                aria-valuemax={PREVIEW_PRIMARY_MAX_WIDTH}
                aria-valuenow={primaryPaneWidth}
                tabIndex={0}
                onPointerDown={startPrimaryResize}
                onKeyDown={handlePrimaryResizeKeyDown}
              >
                <span />
              </div>
              <section className="history-preview-pane history-preview-compare-pane">
                {comparePreview ? (
                  <HistoryFilePreview
                    preview={comparePreview}
                    onBack={onBack}
                    onCopyContent={() => compareFileContent && !compareFileContent.binary && navigator.clipboard.writeText(compareFileContent.text)}
                    onCopyPath={() => navigator.clipboard.writeText(preview.filePath)}
                    onCopySha={() => navigator.clipboard.writeText(compareSha)}
                    showBack={false}
                    subtitle={`${compareTargetLabel} at compare target`}
                    codeRef={compareCodeRef}
                    onCodeScroll={syncPreviewScroll('compare')}
                    lineStates={compareLineState.compareStates}
                  />
                ) : null}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
