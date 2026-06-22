import type {
  ActivityLogEntry,
  CommitSummary,
  DailyReviewActionItem,
  DailyReviewReport,
  DailyReviewRequest,
  DailyReviewSection,
  FileChange,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import { BranchPilotUserError } from './errors.js'
import { normalizeNativePath } from './platformExecutables.js'
import type { ActivityLogService } from './activityLogService.js'
import type { RepositoryService } from './repositoryService.js'

const ACTIVITY_LIMIT = 200
const DISPLAY_FILE_LIMIT = 8

export class DailyReviewService {
  constructor(
    private readonly repositoryService: RepositoryService,
    private readonly activityLogService: ActivityLogService
  ) {}

  async generateDailyReview(request: DailyReviewRequest): Promise<DailyReviewReport> {
    const repoPath = normalizeRepoPath(request.repoPath)
    const date = normalizeDateKey(request.date)
    const generatedAt = new Date().toISOString()
    const snapshot = await this.repositoryService.getSnapshot(repoPath)
    const commits = (await this.repositoryService.getHistory(snapshot.summary.rootPath))
      .filter((commit) => toLocalDateKey(commit.authoredAt) === date)
    const activities = (await this.activityLogService.getActivityLog({
      repoPath: snapshot.summary.rootPath,
      limit: ACTIVITY_LIMIT
    })).entries.filter((entry) => toLocalDateKey(entry.createdAt) === date)
    const actionItems = buildActionItems(snapshot)
    const sections = buildSections(snapshot, commits, activities, actionItems, generatedAt)

    const reportBase = {
      repoPath: snapshot.summary.rootPath,
      repositoryName: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      date,
      generatedAt,
      stats: {
        commits: commits.length,
        activities: activities.length,
        changed: snapshot.status.counts.changed,
        staged: snapshot.status.counts.staged,
        unstaged: snapshot.status.counts.unstaged,
        untracked: snapshot.status.counts.untracked,
        conflicted: snapshot.status.counts.conflicted,
        ahead: snapshot.summary.ahead,
        behind: snapshot.summary.behind
      },
      sections,
      actionItems
    }

    return {
      ...reportBase,
      markdown: formatMarkdown(reportBase)
    }
  }
}

function buildSections(
  snapshot: RepositorySnapshot,
  commits: CommitSummary[],
  activities: ActivityLogEntry[],
  actionItems: DailyReviewActionItem[],
  generatedAt: string
): DailyReviewSection[] {
  return [
    {
      id: 'summary',
      title: 'Summary',
      items: [
        `Repository: ${snapshot.summary.name}`,
        `Branch: ${snapshot.summary.currentBranch}${snapshot.summary.isDetached ? ' (detached HEAD)' : ''}`,
        `Generated: ${formatDateTime(generatedAt)}`,
        `Worktree: ${snapshot.status.counts.changed === 0 ? 'clean' : `${snapshot.status.counts.changed} changed file${plural(snapshot.status.counts.changed)}`}`
      ]
    },
    {
      id: 'commits',
      title: 'Commits',
      items: commits.length > 0
        ? commits.map((commit) => `${commit.shortSha} ${commit.subject || '(no subject)'} - ${formatTime(commit.authoredAt)}`)
        : ['No commits recorded for this date.']
    },
    {
      id: 'worktree',
      title: 'Current Worktree',
      items: buildWorktreeItems(snapshot)
    },
    {
      id: 'sync',
      title: 'Branch And Sync',
      items: buildSyncItems(snapshot)
    },
    {
      id: 'activity',
      title: 'Activity',
      items: activities.length > 0
        ? activities.slice(0, 12).map(formatActivityEntry)
        : ['No BranchPilot activity recorded for this date.']
    },
    {
      id: 'next_actions',
      title: 'Suggested Next Actions',
      items: actionItems.length > 0
        ? actionItems.map((item) => `${item.priority === 'high' ? 'High' : 'Normal'}: ${item.title} - ${item.details}`)
        : ['No immediate local actions detected.']
    }
  ]
}

function buildWorktreeItems(snapshot: RepositorySnapshot): string[] {
  const changes = snapshot.status.changes

  if (changes.length === 0) {
    return ['Clean worktree.']
  }

  const items = [
    `${snapshot.status.counts.staged} staged, ${snapshot.status.counts.unstaged} unstaged, ${snapshot.status.counts.untracked} untracked, ${snapshot.status.counts.conflicted} conflicted.`
  ]
  const conflicted = changes.filter((change) => change.conflicted)
  const staged = changes.filter((change) => change.staged && !change.conflicted)
  const unstaged = changes.filter((change) => (change.unstaged || change.untracked) && !change.conflicted)

  appendFileGroup(items, 'Conflicted', conflicted)
  appendFileGroup(items, 'Staged', staged)
  appendFileGroup(items, 'Unstaged/untracked', unstaged)

  return items
}

function buildSyncItems(snapshot: RepositorySnapshot): string[] {
  const items = [
    snapshot.summary.upstream
      ? `Upstream: ${snapshot.summary.upstream}`
      : snapshot.summary.remoteName
        ? `No upstream configured. Remote: ${snapshot.summary.remoteName}`
        : 'No remote configured.',
    `${snapshot.summary.ahead} ahead, ${snapshot.summary.behind} behind.`
  ]

  if (snapshot.summary.isDetached) {
    items.push('Detached HEAD: switch to a branch before syncing or creating pull requests.')
  }

  if (snapshot.status.merge.operation !== 'none') {
    items.push(`${snapshot.status.merge.operation} operation is in progress.`)
  }

  return items
}

function buildActionItems(snapshot: RepositorySnapshot): DailyReviewActionItem[] {
  const items: DailyReviewActionItem[] = []
  const { counts } = snapshot.status

  if (counts.conflicted > 0 || snapshot.status.merge.operation !== 'none') {
    items.push({
      title: 'Resolve active conflicts',
      details: `${counts.conflicted} conflicted file${plural(counts.conflicted)} in the current operation.`,
      priority: 'high'
    })
  }

  if (snapshot.summary.behind > 0) {
    items.push({
      title: 'Review remote changes',
      details: `Branch is ${snapshot.summary.behind} commit${plural(snapshot.summary.behind)} behind upstream.`,
      priority: 'high'
    })
  }

  if (!snapshot.summary.isDetached && snapshot.summary.remoteName && !snapshot.summary.upstream) {
    items.push({
      title: 'Publish branch',
      details: 'Set an upstream before normal push/pull and pull request creation.',
      priority: 'normal'
    })
  }

  if (counts.staged > 0) {
    items.push({
      title: 'Commit staged changes',
      details: `${counts.staged} staged file${plural(counts.staged)} ready for commit.`,
      priority: 'normal'
    })
  }

  if (counts.unstaged > 0 || counts.untracked > 0) {
    items.push({
      title: 'Review local changes',
      details: `${counts.unstaged + counts.untracked} unstaged or untracked file${plural(counts.unstaged + counts.untracked)} need a decision.`,
      priority: 'normal'
    })
  }

  if (snapshot.summary.ahead > 0) {
    items.push({
      title: 'Push local commits',
      details: `Branch is ${snapshot.summary.ahead} commit${plural(snapshot.summary.ahead)} ahead of upstream.`,
      priority: 'normal'
    })
  }

  return items
}

function appendFileGroup(items: string[], label: string, changes: FileChange[]) {
  if (changes.length === 0) {
    return
  }

  const displayed = changes.slice(0, DISPLAY_FILE_LIMIT).map((change) => change.path)
  const hiddenCount = changes.length - displayed.length

  items.push(`${label}: ${displayed.join(', ')}${hiddenCount > 0 ? `, and ${hiddenCount} more` : ''}.`)
}

function formatActivityEntry(entry: ActivityLogEntry): string {
  const metadata = formatMetadata(entry)
  return `${formatTime(entry.createdAt)} ${activityTypeLabel(entry.type)} (${entry.status})${metadata ? ` - ${metadata}` : ''}`
}

function formatMetadata(entry: ActivityLogEntry): string {
  return Object.entries(entry.metadata)
    .filter(([, value]) => value !== '' && value !== null)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ')
}

function formatMarkdown(report: Omit<DailyReviewReport, 'markdown'>): string {
  const lines = [
    `# Daily Review - ${report.repositoryName} - ${report.date}`,
    '',
    `Generated: ${formatDateTime(report.generatedAt)}`,
    `Branch: ${report.branch}`,
    '',
    `Stats: ${report.stats.commits} commits, ${report.stats.changed} changed files, ${report.stats.ahead}/${report.stats.behind} ahead/behind, ${report.stats.activities} activities.`,
    ''
  ]

  for (const section of report.sections) {
    lines.push(`## ${section.title}`)
    lines.push(...section.items.map((item) => `- ${item}`))
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function normalizeRepoPath(repoPath: string): string {
  const normalized = repoPath.trim()

  if (!normalized) {
    throw new BranchPilotUserError('invalid_repository_path', 'Repository path is required.')
  }

  return normalizeNativePath(normalized)
}

function normalizeDateKey(date: string | undefined): string {
  if (!date) {
    return toLocalDateKey(new Date())
  }

  const trimmed = date.trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BranchPilotUserError('invalid_daily_review_date', 'Daily review date must use YYYY-MM-DD format.')
  }

  if (toLocalDateKey(new Date(`${trimmed}T00:00:00`)) !== trimmed) {
    throw new BranchPilotUserError('invalid_daily_review_date', 'Daily review date must be a valid calendar date.')
  }

  return trimmed
}

function toLocalDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Invalid date'
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: 'short'
  }).format(new Date(value))
}

function activityTypeLabel(type: ActivityLogEntry['type']): string {
  return type
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}
