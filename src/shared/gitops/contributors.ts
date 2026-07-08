export interface CoAuthor {
  name: string
  email: string
  login?: string
  avatarUrl?: string
  profileUrl?: string
  source?: 'repository' | 'github' | 'organization' | 'collaborator' | 'identity'
  organization?: string
}

export interface ContributorStat {
  name: string
  email: string
  /** All commit author emails associated with this contributor identity. */
  emails?: string[]
  login?: string
  avatarUrl?: string
  profileUrl?: string
  commits: number
  /** Share of total commits in the repository, 0..1. */
  share: number
  /** ISO date of this author's most recent commit. */
  lastCommitAt: string
  /** Other author spellings/emails that resolve to this contributor identity. */
  aliases?: ContributorIdentity[]
}

export interface ContributorIdentity {
  name: string
  email: string
  commits: number
  lastCommitAt: string
}

export type ContributorStatsWindow = 'all' | 'year' | 'month' | 'week' | 'day'

export interface RepositoryScopeRequest {
  repoPath?: string
  repoPaths?: string[]
}

export interface ContributorStatsRequest {
  repoPath?: string
  repoPaths?: string[]
  window?: ContributorStatsWindow
  /** YYYY-MM-DD. Used with the `day` window to rank the selected calendar day. */
  date?: string
}

export interface ContributionDay {
  date: string
  count: number
}

export interface ContributionGraph {
  days: ContributionDay[]
  total: number
}

export interface RhythmWeek {
  /** ISO date (Sunday) of the week start. */
  weekStart: string
  commits: number
}

export interface RhythmHotFile {
  path: string
  /** Number of commits in the window that touched this file. */
  commits: number
  added: number
  removed: number
}

/** Local-git "rhythm" analytics: cadence, velocity and churn. */
export interface RepositoryRhythm {
  generatedAt: string
  /** Days of git history scanned (the analysis window). */
  windowDays: number
  // Cadence
  currentStreakDays: number
  longestStreakDays: number
  activeDaysLast30: number
  // Velocity
  commitsThisWeek: number
  commitsLastWeek: number
  avgCommitsPerActiveDay: number
  /** Most recent weeks (oldest → newest) for a sparkline. */
  weeklyCommits: RhythmWeek[]
  // Churn (last 30 days)
  linesAdded30: number
  linesRemoved30: number
  hotFiles: RhythmHotFile[]
}
