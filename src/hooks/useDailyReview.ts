import { useRef, useState } from 'react'
import type { BranchPilotApi, ContributorStat, ContributorStatsRequest, ContributorStatsWindow, DailyReviewReport, RepositoryScopeRequest } from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { formatDateInputValue } from '../lib/format'

/**
 * Owns Daily Review state and the generate/copy handlers. Shared infrastructure
 * (API bridge, current repo, notice/error sinks, clipboard) is injected.
 */
export function useDailyReview({
  api,
  currentRepoPath,
  reportRepoPaths,
  setNotice,
  setError,
  copyToClipboard
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  reportRepoPaths: string[]
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  copyToClipboard: (text: string, successMessage: string) => Promise<void>
}) {
  const [dailyReview, setDailyReview] = useState<DailyReviewReport | null>(null)
  const [dailyReviewDate, setDailyReviewDate] = useState(() => formatDateInputValue(new Date()))
  const [dailyReviewLoading, setDailyReviewLoading] = useState(false)
  const [contributorStats, setContributorStats] = useState<ContributorStat[]>([])
  const [contributorStatsLoading, setContributorStatsLoading] = useState(false)
  const [contributorWindow, setContributorWindow] = useState<ContributorStatsWindow>('day')
  const contributorStatsRequestIdRef = useRef(0)

  function updateDailyReviewDate(date: string) {
    if (date !== dailyReviewDate) setDailyReview(null)
    setDailyReviewDate(date)
  }

  async function loadContributorStats(scope: string | RepositoryScopeRequest | undefined = currentRepoPath) {
    if (!api || typeof api.getContributorStats !== 'function') return
    const requestId = contributorStatsRequestIdRef.current + 1
    contributorStatsRequestIdRef.current = requestId
    setContributorStatsLoading(true)
    const request: ContributorStatsRequest = typeof scope === 'string'
      ? { repoPath: scope, window: contributorWindow }
      : { ...(scope ?? {}), window: contributorWindow }
    if (contributorWindow === 'day' && dailyReviewDate) request.date = dailyReviewDate
    const result = await api.getContributorStats(request).catch(() => null)
    if (contributorStatsRequestIdRef.current !== requestId) return
    setContributorStats(result?.ok ? result.data : [])
    setContributorStatsLoading(false)
  }

  async function runDailyReview() {
    const repoPaths = normalizeReportRepoPaths(reportRepoPaths.length > 0 ? reportRepoPaths : currentRepoPath ? [currentRepoPath] : [])
    if (!api || repoPaths.length === 0) return
    setDailyReviewLoading(true)
    setError(null)

    try {
      const result = await api.generateDailyReview({
        repoPath: repoPaths[0],
        ...(repoPaths.length > 1 ? { repoPaths } : {}),
        date: dailyReviewDate || undefined
      })

      if (result.ok) {
        setDailyReview(result.data)
      } else {
        setDailyReview(null)
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    } finally {
      setDailyReviewLoading(false)
    }
  }

  async function copyDailyReviewMarkdown() {
    if (!dailyReview) return
    await copyToClipboard(dailyReview.markdown, 'Daily review Markdown copied.')
  }

  return {
    dailyReview,
    setDailyReview,
    dailyReviewDate,
    setDailyReviewDate: updateDailyReviewDate,
    dailyReviewLoading,
    contributorStats,
    contributorStatsLoading,
    contributorWindow,
    setContributorWindow,
    loadContributorStats,
    runDailyReview,
    copyDailyReviewMarkdown
  }
}

function normalizeReportRepoPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized
}
