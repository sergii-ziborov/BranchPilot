import { useState } from 'react'
import type { BranchPilotApi, ContributorStat, ContributorStatsWindow, DailyReviewReport } from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { formatDateInputValue } from '../lib/format'

/**
 * Owns Daily Review state and the generate/copy handlers. Shared infrastructure
 * (API bridge, current repo, notice/error sinks, clipboard) is injected.
 */
export function useDailyReview({
  api,
  currentRepoPath,
  setNotice,
  setError,
  copyToClipboard
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  copyToClipboard: (text: string, successMessage: string) => Promise<void>
}) {
  const [dailyReview, setDailyReview] = useState<DailyReviewReport | null>(null)
  const [dailyReviewDate, setDailyReviewDate] = useState(() => formatDateInputValue(new Date()))
  const [dailyReviewLoading, setDailyReviewLoading] = useState(false)
  const [contributorStats, setContributorStats] = useState<ContributorStat[]>([])
  const [contributorWindow, setContributorWindow] = useState<ContributorStatsWindow>('all')

  async function loadContributorStats(repoPath: string | undefined = currentRepoPath) {
    if (!api || typeof api.getContributorStats !== 'function') return
    const result = await api.getContributorStats({
      ...(repoPath ? { repoPath } : {}),
      window: contributorWindow
    }).catch(() => null)
    setContributorStats(result?.ok ? result.data : [])
  }

  async function runDailyReview() {
    if (!api || !currentRepoPath) return
    setDailyReviewLoading(true)
    setError(null)

    try {
      const result = await api.generateDailyReview({
        repoPath: currentRepoPath,
        date: dailyReviewDate || undefined
      })

      if (result.ok) {
        setDailyReview(result.data)
        setNotice(`Daily review generated for ${result.data.date}.`)
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
    setDailyReviewDate,
    dailyReviewLoading,
    contributorStats,
    contributorWindow,
    setContributorWindow,
    loadContributorStats,
    runDailyReview,
    copyDailyReviewMarkdown
  }
}
