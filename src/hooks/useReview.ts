import { useMemo, useState } from 'react'
import type {
  ApiResult, AssistantId, AssistantPolicyStatus, BranchPilotApi,
  RepositoryCounts, ReviewFinding, ReviewMode, ReviewReport, ReviewScope
} from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { assistantLabel, assistantPolicyAllows, assistantPolicyBlockedLabel } from '../lib/assistantLabels'
import { groupFindingsBySeverity, reviewModes } from '../lib/reviewLabels'
import type { ViewMode } from '../lib/viewMode'

type PreCommitFinding = ReviewFinding & { mode: ReviewMode }

/** Owns review + pre-commit review state and the run/toggle/reset handlers. */
export function useReview({
  api,
  currentRepoPath,
  counts,
  assistantPolicy,
  selectedAssistant,
  setNotice,
  setError,
  runApiAction,
  runBusyOperation,
  setViewMode
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  counts: RepositoryCounts | undefined
  assistantPolicy: AssistantPolicyStatus | null
  selectedAssistant: AssistantId
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  runApiAction: <T>(progressLabel: string, action: () => Promise<ApiResult<T>>, onSuccess: (data: T) => void | Promise<void>) => Promise<boolean>
  runBusyOperation: <T>(label: string, action: () => Promise<T>) => Promise<T>
  setViewMode: (mode: ViewMode) => void
}) {
  const [reviewMode, setReviewMode] = useState<ReviewMode>('consistency')
  const [reviewScope, setReviewScope] = useState<ReviewScope>('staged')
  const [reviewReport, setReviewReport] = useState<ReviewReport | null>(null)
  const [preCommitReviewModes, setPreCommitReviewModes] = useState<ReviewMode[]>(reviewModes)
  const [preCommitReports, setPreCommitReports] = useState<ReviewReport[]>([])
  const [preCommitRunningMode, setPreCommitRunningMode] = useState<ReviewMode | null>(null)

  const canRunAssistantReview = assistantPolicyAllows(assistantPolicy, 'review_report')

  const preCommitFindings = useMemo<PreCommitFinding[]>(
    () =>
      preCommitReports.flatMap((report) =>
        report.findings.map((finding) => ({
          ...finding,
          mode: report.mode
        }))
      ),
    [preCommitReports]
  )

  const preCommitFindingsBySeverity = useMemo(() => groupFindingsBySeverity(preCommitFindings), [preCommitFindings])

  function resetPreCommitReview() {
    setPreCommitReports([])
    setPreCommitRunningMode(null)
  }

  async function runReviewReport() {
    if (!api || !currentRepoPath) return
    if (!canRunAssistantReview) {
      setNotice(assistantPolicyBlockedLabel('review_report', assistantPolicy))
      return
    }

    const completed = await runApiAction('Running review...', () => api.generateReviewReport({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      mode: reviewMode,
      scope: reviewScope
    }), (data) => {
      setReviewReport(data)
      setNotice(`Review complete with ${assistantLabel(data.assistant)}${data.truncated ? ' from truncated diff' : ''}.`)
    })

    if (!completed) {
      setReviewReport(null)
    }
  }

  async function runPreCommitReview() {
    if (!api || !currentRepoPath || !counts?.staged || preCommitReviewModes.length === 0) return
    if (!canRunAssistantReview) {
      setNotice(assistantPolicyBlockedLabel('review_report', assistantPolicy))
      return
    }

    setPreCommitReports([])

    const reports: ReviewReport[] = []

    await runBusyOperation('Running pre-commit review...', async () => {
      try {
        for (const mode of preCommitReviewModes) {
          setPreCommitRunningMode(mode)
          const result = await api.generateReviewReport({
            repoPath: currentRepoPath,
            assistant: selectedAssistant,
            mode,
            scope: 'staged'
          })

          if (!result.ok) {
            setError(result.error.message)
            setNotice(branchPilotErrorText(result.error))
            setPreCommitReports(reports)
            return
          }

          reports.push(result.data)
          setPreCommitReports([...reports])
        }

        const lastReport = reports.at(-1)

        if (lastReport) {
          setReviewMode(lastReport.mode)
          setReviewScope('staged')
          setReviewReport(lastReport)
          setNotice(`Pre-commit review complete with ${assistantLabel(lastReport.assistant)}${lastReport.truncated ? ' from truncated diff' : ''}.`)
        }
      } finally {
        setPreCommitRunningMode(null)
      }
    })
  }

  function togglePreCommitReviewMode(mode: ReviewMode) {
    setPreCommitReviewModes((currentModes) => {
      const nextModes = currentModes.includes(mode)
        ? currentModes.filter((currentMode) => currentMode !== mode)
        : reviewModes.filter((candidate) => candidate === mode || currentModes.includes(candidate))

      return nextModes
    })
    resetPreCommitReview()
  }

  function openPreCommitReviewDetails() {
    const lastReport = preCommitReports.at(-1)

    if (lastReport) {
      setReviewMode(lastReport.mode)
      setReviewScope('staged')
      setReviewReport(lastReport)
    }

    setViewMode('review')
  }

  return {
    reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport, setReviewReport,
    preCommitReviewModes, preCommitReports, preCommitRunningMode, canRunAssistantReview,
    preCommitFindings, preCommitFindingsBySeverity,
    resetPreCommitReview, runReviewReport, runPreCommitReview, togglePreCommitReviewMode, openPreCommitReviewDetails
  }
}
