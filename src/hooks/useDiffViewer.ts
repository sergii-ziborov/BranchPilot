import { useEffect, useMemo, useRef, useState } from 'react'
import type { BranchPilotApi, DiffResult, FileChange, ImagePreview, RepositorySnapshot } from '../shared/branchPilot'
import type { ChangeDiffMode } from '../shared/changeStaging'
import { getAvailableChangeDiffMode, getDefaultChangeDiffMode } from '../shared/changeStaging'
import { getDiffStats } from '../shared/diffView'

export interface DiffCacheEntry {
  diff: DiffResult
  relatedDiff: DiffResult | null
  imagePreview: ImagePreview | null
}

const DEFAULT_DIFF_CONTEXT_LINES = 3
const EXPANDED_DIFF_CONTEXT_LINES = 20
const IMAGE_PREVIEW_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i
// How many of the first visible changes to warm in the background, and how long to
// wait when requestIdleCallback is unavailable before falling back to a plain timer.
const DIFF_PREFETCH_LIMIT = 10
const DIFF_PREFETCH_TIMEOUT_MS = 2000
const DIFF_PREFETCH_FALLBACK_MS = 250

function getRelatedDiffMode(change: FileChange, mode: ChangeDiffMode): ChangeDiffMode | null {
  if (!change.staged || (!change.unstaged && !change.untracked)) return null
  return mode === 'staged' ? 'unstaged' : 'staged'
}

/** The exact cache key + staged flag the click path uses, so prefetch and click agree. */
function buildDiffCacheKey(
  change: FileChange, mode: ChangeDiffMode, ignoreWhitespace: boolean, expanded: boolean
): { cacheKey: string; staged: boolean } {
  const staged = mode === 'staged' && change.staged
  const cacheKey = `${change.path}|${staged ? 'S' : 'U'}|${ignoreWhitespace ? 'W' : 'w'}|${expanded ? 'E' : 'e'}`
  return { cacheKey, staged }
}

/**
 * Owns the viewed diff (plus its related/staged diff and image preview), a per-snapshot
 * diff cache for instant re-clicks, and a background prefetch that warms the first N
 * visible changes so the first click on any of them is instant.
 */
export function useDiffViewer({
  api,
  currentRepoPath,
  snapshot,
  selectedChange,
  changeIndexKey,
  filteredChanges,
  diffMode,
  setDiffMode,
  diffIgnoreWhitespace,
  diffExpanded,
  setError
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  selectedChange: FileChange | null
  changeIndexKey: string
  filteredChanges: FileChange[]
  diffMode: ChangeDiffMode
  setDiffMode: (mode: ChangeDiffMode) => void
  diffIgnoreWhitespace: boolean
  diffExpanded: boolean
  setError: (message: string | null) => void
}) {
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [relatedDiff, setRelatedDiff] = useState<DiffResult | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const diffRequestIdRef = useRef(0)
  // Diff cache: instant re-clicks within one snapshot. Invalidated whenever the
  // snapshot's change set changes (any stage/unstage/edit) so a stale diff never shows.
  const diffCacheRef = useRef<Map<string, DiffCacheEntry>>(new Map())
  const diffCacheKeyRef = useRef(changeIndexKey)

  const selectedDiffStats = useMemo(() => {
    if (!diff || diff.binary || !diff.text.trim()) return null
    return getDiffStats(diff)
  }, [diff])
  const selectedRelatedDiffStats = useMemo(() => {
    if (!relatedDiff || relatedDiff.binary || !relatedDiff.text.trim()) return null
    return getDiffStats(relatedDiff)
  }, [relatedDiff])

  // Drop the cache whenever the working tree changed, so no stale diff survives.
  function ensureCacheForSnapshot() {
    if (diffCacheKeyRef.current !== changeIndexKey) {
      diffCacheRef.current.clear()
      diffCacheKeyRef.current = changeIndexKey
    }
  }

  async function loadDiff(change: FileChange, mode: ChangeDiffMode) {
    if (!api || !currentRepoPath) return
    const requestId = diffRequestIdRef.current + 1
    diffRequestIdRef.current = requestId

    ensureCacheForSnapshot()

    const { cacheKey, staged } = buildDiffCacheKey(change, mode, diffIgnoreWhitespace, diffExpanded)
    const cached = diffCacheRef.current.get(cacheKey)
    if (cached) {
      setDiff(cached.diff)
      setRelatedDiff(cached.relatedDiff)
      setImagePreview(cached.imagePreview)
      return
    }

    const diffRequest = {
      repoPath: currentRepoPath,
      filePath: change.path,
      ignoreWhitespace: diffIgnoreWhitespace,
      contextLines: diffExpanded ? EXPANDED_DIFF_CONTEXT_LINES : DEFAULT_DIFF_CONTEXT_LINES
    }
    const relatedMode = getRelatedDiffMode(change, mode)
    const relatedStaged = relatedMode === 'staged'

    // Cache missed: an actual fetch follows, so raise the curtain now. The finally
    // clears it only when this request is still the newest, so a stale response
    // can't hide a curtain that a newer load just raised.
    setDiffLoading(true)
    try {
      const relatedPromise = relatedMode
        ? api.getDiff({ ...diffRequest, staged: relatedStaged }).catch(() => null)
        : Promise.resolve(null)
      const result = await api.getDiff({ ...diffRequest, staged })

      if (diffRequestIdRef.current !== requestId) return

      if (result.ok) {
        setDiff(result.data)
        let resolvedImagePreview: ImagePreview | null = null

        if (result.data.binary && typeof api.getImagePreview === 'function' && IMAGE_PREVIEW_PATTERN.test(change.path)) {
          const preview = await api.getImagePreview({ repoPath: currentRepoPath, filePath: change.path }).catch(() => null)
          if (diffRequestIdRef.current !== requestId) return
          resolvedImagePreview = preview && preview.ok ? preview.data : null
          setImagePreview(resolvedImagePreview)
        } else {
          setImagePreview(null)
        }

        const relatedResult = await relatedPromise
        if (diffRequestIdRef.current !== requestId) return
        const resolvedRelatedDiff = relatedResult?.ok && relatedResult.data.text.trim() ? relatedResult.data : null
        setRelatedDiff(resolvedRelatedDiff)

        // Only cache once still the current snapshot, so a mid-flight stage can't poison it.
        if (diffCacheKeyRef.current === changeIndexKey) {
          diffCacheRef.current.set(cacheKey, {
            diff: result.data,
            relatedDiff: resolvedRelatedDiff,
            imagePreview: resolvedImagePreview
          })
        }
      } else {
        setDiff(null)
        setRelatedDiff(null)
        setImagePreview(null)
        setError(result.error.message)
      }
    } finally {
      // Guard so a stale request can't clear a curtain a newer load just raised.
      if (diffRequestIdRef.current === requestId) setDiffLoading(false)
    }
  }

  // Warm the cache for one change WITHOUT touching the visible diff/selection. Mirrors
  // loadDiff's fetch + cache exactly (same key, same getDiff calls, same image/related
  // handling) so a later click on this file resolves from cache instantly. Uses the
  // collapsed context because selecting a new file always resets diffExpanded to false,
  // so that is the key a first click will look up. Best-effort: swallows every failure.
  async function cacheDiffFor(change: FileChange, mode: ChangeDiffMode) {
    if (!api || !currentRepoPath) return
    const { cacheKey, staged } = buildDiffCacheKey(change, mode, diffIgnoreWhitespace, false)
    if (diffCacheRef.current.has(cacheKey)) return

    const diffRequest = {
      repoPath: currentRepoPath,
      filePath: change.path,
      ignoreWhitespace: diffIgnoreWhitespace,
      contextLines: DEFAULT_DIFF_CONTEXT_LINES
    }
    const relatedMode = getRelatedDiffMode(change, mode)
    const relatedPromise = relatedMode
      ? api.getDiff({ ...diffRequest, staged: relatedMode === 'staged' }).catch(() => null)
      : Promise.resolve(null)
    const result = await api.getDiff({ ...diffRequest, staged }).catch(() => null)
    if (!result || !result.ok) {
      await relatedPromise
      return
    }

    let resolvedImagePreview: ImagePreview | null = null
    if (result.data.binary && typeof api.getImagePreview === 'function' && IMAGE_PREVIEW_PATTERN.test(change.path)) {
      const preview = await api.getImagePreview({ repoPath: currentRepoPath, filePath: change.path }).catch(() => null)
      resolvedImagePreview = preview && preview.ok ? preview.data : null
    }
    const relatedResult = await relatedPromise
    const resolvedRelatedDiff = relatedResult?.ok && relatedResult.data.text.trim() ? relatedResult.data : null

    // Only cache while still the current snapshot, so a mid-flight stage can't poison it.
    if (diffCacheKeyRef.current === changeIndexKey) {
      diffCacheRef.current.set(cacheKey, {
        diff: result.data,
        relatedDiff: resolvedRelatedDiff,
        imagePreview: resolvedImagePreview
      })
    }
  }

  // Load the diff for the current selection whenever it (or a view toggle) changes.
  useEffect(() => {
    if (!snapshot || !selectedChange) {
      diffRequestIdRef.current += 1
      setDiff(null)
      setRelatedDiff(null)
      return
    }

    const availableMode = getAvailableChangeDiffMode(selectedChange, diffMode)

    if (availableMode !== diffMode) {
      setDiffMode(availableMode)
      return
    }

    void loadDiff(selectedChange, availableMode)

  }, [diffIgnoreWhitespace, diffExpanded, diffMode, selectedChange, snapshot])

  // Background prefetch: after a snapshot (or the visible list / whitespace mode) changes,
  // when the browser is idle, warm the diffs of the first N visible changes that are not
  // already cached. Sequential (one git spawn at a time), capped at N, and cancelled the
  // moment the snapshot changes — it never touches the visible diff, selection, or loading
  // state, so it can only ever make a later click faster. Errors are swallowed by cacheDiffFor.
  useEffect(() => {
    if (!api || !currentRepoPath || filteredChanges.length === 0) return

    ensureCacheForSnapshot()
    const snapshotKey = changeIndexKey
    let cancelled = false

    const run = async () => {
      const targets = filteredChanges.slice(0, DIFF_PREFETCH_LIMIT)
      for (const change of targets) {
        // Stop as soon as this effect is torn down or the snapshot has moved on.
        if (cancelled || snapshotKey !== diffCacheKeyRef.current) return
        await cacheDiffFor(change, getDefaultChangeDiffMode(change)).catch(() => {})
      }
    }

    let idleHandle: number | null = null
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => { void run() }, { timeout: DIFF_PREFETCH_TIMEOUT_MS })
    } else {
      timeoutHandle = setTimeout(() => { void run() }, DIFF_PREFETCH_FALLBACK_MS)
    }

    return () => {
      cancelled = true
      if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle)
      }
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
    }
  }, [api, currentRepoPath, filteredChanges, changeIndexKey, diffIgnoreWhitespace])

  return {
    diff, diffLoading, relatedDiff, imagePreview, diffRequestIdRef,
    selectedDiffStats, selectedRelatedDiffStats, loadDiff
  }
}
