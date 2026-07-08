import { createRequire } from 'node:module'
import type { CommandRunner } from './commandRunner.js'
import type {
  GitHubPullRequestCheck,
  GitMonitorSettings
} from '../../src/shared/branchPilot.js'
import {
  getCurrentBranchPullRequest,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDetails
} from '../providers/githubCliService.js'

const require = createRequire(import.meta.url)
const { Notification } = require('electron') as typeof import('electron')

const MIN_INTERVAL_SECONDS = 20

type PullRequestState = 'open' | 'merged' | 'closed'
type ChecksBucket = 'pass' | 'fail' | 'pending' | 'none'
type ReviewState = 'approved' | 'changes-requested' | 'review-required' | 'none'

interface PullRequestSnapshot {
  prNumber: number
  state: PullRequestState
  checksBucket: ChecksBucket
  reviewDecision: ReviewState
}

export interface GitMonitorDependencies {
  commandRunner: CommandRunner
  /** Focus/restore the main window when the user clicks a notification. */
  focusWindow: () => void
}

/**
 * Background monitor that polls the active repository's current-branch pull
 * request and raises native desktop notifications on meaningful transitions
 * (merged/closed, checks passed/failed, review approved/changes-requested).
 *
 * Default OFF — driven entirely by GitMonitorSettings. A poll never overlaps
 * another, and every error is swallowed so a flaky network call can neither
 * crash the app nor spam the user.
 */
export class GitMonitorService {
  private settings: GitMonitorSettings | null = null
  private repoPath: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private readonly snapshots = new Map<number, PullRequestSnapshot>()

  constructor(private readonly deps: GitMonitorDependencies) {}

  /** Replace the monitor settings (from settingsStore) and (re)arm the timer. */
  applySettings(settings: GitMonitorSettings): void {
    this.settings = settings
    this.restart()
  }

  /** Point the monitor at the repository the user just opened/refreshed. */
  setActiveRepo(repoPath: string | null | undefined): void {
    const next = typeof repoPath === 'string' && repoPath.trim().length > 0 ? repoPath : null
    if (next === this.repoPath) return
    this.repoPath = next
    // Different repos can reuse PR numbers — start fresh so the first poll of
    // the new repo seeds silently instead of firing a bogus transition.
    this.snapshots.clear()
    this.restart()
  }

  start(): void {
    this.restart()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private restart(): void {
    this.stop()
    const settings = this.settings
    if (!settings || !settings.enabled || !this.repoPath) return

    const intervalMs = Math.max(MIN_INTERVAL_SECONDS, settings.intervalSeconds) * 1000
    this.timer = setInterval(() => {
      void this.poll()
    }, intervalMs)
    // Kick an immediate poll so the current state is captured (silently) right
    // away rather than one full interval later.
    void this.poll()
  }

  private async poll(): Promise<void> {
    const settings = this.settings
    const repoPath = this.repoPath
    if (this.polling || !settings || !settings.enabled || !repoPath) return

    this.polling = true
    try {
      const snapshot = await this.fetchSnapshot(repoPath)
      if (!snapshot) return

      const previous = this.snapshots.get(snapshot.prNumber)
      this.snapshots.set(snapshot.prNumber, snapshot)
      // First time we see this PR: seed silently so opening the app never
      // replays stale transitions.
      if (!previous) return

      this.emitTransitions(previous, snapshot, settings)
    } catch {
      // A failed poll must never crash or spam — swallow everything.
    } finally {
      this.polling = false
    }
  }

  private async fetchSnapshot(repoPath: string): Promise<PullRequestSnapshot | null> {
    const runner = this.deps.commandRunner
    const pullRequest = await getCurrentBranchPullRequest(runner, repoPath)
    if (!pullRequest) return null

    const prNumber = pullRequest.number
    let state = normalizePullRequestState(pullRequest.state)
    let reviewDecision: ReviewState = 'none'

    try {
      const details = await getGitHubPullRequestDetails(runner, { repoPath, prNumber })
      // Details are authoritative for state and are the only source of review info.
      state = normalizePullRequestState(details.state)
      reviewDecision = normalizeReviewDecision(details.reviewDecision)
    } catch {
      // Details are best-effort — fall back to the summary state.
    }

    let checksBucket: ChecksBucket = 'none'
    try {
      checksBucket = aggregateChecks(await getGitHubPullRequestChecks(runner, { repoPath, prNumber }))
    } catch {
      // Checks are best-effort — leave as 'none' when unavailable.
    }

    return { prNumber, state, checksBucket, reviewDecision }
  }

  private emitTransitions(
    previous: PullRequestSnapshot,
    next: PullRequestSnapshot,
    settings: GitMonitorSettings
  ): void {
    const n = next.prNumber

    // open -> merged / open -> closed
    if (settings.notifyMerged && previous.state === 'open' && next.state !== 'open') {
      if (next.state === 'merged') {
        this.notify(`PR #${n} merged`, `Pull request #${n} was merged.`)
      } else {
        this.notify(`PR #${n} closed`, `Pull request #${n} was closed without merging.`)
      }
    }

    // checks pending -> pass / fail
    if (
      settings.notifyChecks &&
      previous.checksBucket === 'pending' &&
      (next.checksBucket === 'pass' || next.checksBucket === 'fail')
    ) {
      const passed = next.checksBucket === 'pass'
      this.notify(
        `Checks ${passed ? 'passed' : 'failed'} on PR #${n}`,
        passed ? `All checks passed on pull request #${n}.` : `Checks failed on pull request #${n}.`
      )
    }

    // review -> approved / changes-requested
    if (settings.notifyReviews && next.reviewDecision !== previous.reviewDecision) {
      if (next.reviewDecision === 'approved') {
        this.notify(`PR #${n} approved`, `Pull request #${n} was approved.`)
      } else if (next.reviewDecision === 'changes-requested') {
        this.notify(`PR #${n} changes requested`, `Changes were requested on pull request #${n}.`)
      }
    }
  }

  private notify(title: string, body: string): void {
    try {
      if (!Notification.isSupported()) return
      const notification = new Notification({ title, body })
      notification.on('click', () => {
        try {
          this.deps.focusWindow()
        } catch {
          // Focusing is best-effort.
        }
      })
      notification.show()
    } catch {
      // Never let a notification failure escape.
    }
  }
}

function normalizePullRequestState(raw: string | undefined): PullRequestState {
  switch ((raw ?? '').toUpperCase()) {
    case 'MERGED':
      return 'merged'
    case 'CLOSED':
      return 'closed'
    default:
      return 'open'
  }
}

function normalizeReviewDecision(raw: string | undefined): ReviewState {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'REVIEW_REQUIRED':
      return 'review-required'
    default:
      return 'none'
  }
}

function aggregateChecks(checks: GitHubPullRequestCheck[]): ChecksBucket {
  if (checks.length === 0) return 'none'

  let pending = false
  for (const check of checks) {
    const bucket = (check.bucket ?? '').toLowerCase()
    if (bucket === 'fail' || bucket === 'cancel') return 'fail'
    if (bucket === 'pending') pending = true
  }

  return pending ? 'pending' : 'pass'
}
