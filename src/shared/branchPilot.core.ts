import type {
  CommitFileChange
} from './branchPilot.gitops.js'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BranchPilotError }

export interface BranchPilotError {
  code: string
  message: string
  details?: string
}

export function branchPilotErrorText(error: BranchPilotError): string {
  return error.details || error.code
}

export interface RepositorySummary {
  rootPath: string
  name: string
  currentBranch: string
  headOid?: string
  upstream?: string
  ahead: number
  behind: number
  remoteName?: string
  remoteUrl?: string
  isDetached: boolean
  gitUserName?: string
  gitUserEmail?: string
}

export type FileChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'ignored'
  | 'unknown'

export interface FileChange {
  path: string
  originalPath?: string
  status: FileChangeStatus
  stagedStatus?: string
  unstagedStatus?: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
  additions?: number
  deletions?: number
}

export interface RepositoryCounts {
  changed: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

export type InProgressOperation = 'none' | 'merge' | 'rebase' | 'cherry-pick'

export interface ConflictFile {
  path: string
  type: string
  ours: boolean
  theirs: boolean
}

export interface MergeState {
  operation: InProgressOperation
  files: ConflictFile[]
}

export interface RepositoryStatus {
  summary: RepositorySummary
  changes: FileChange[]
  counts: RepositoryCounts
  merge: MergeState
}

export interface RepositorySnapshot {
  summary: RepositorySummary
  status: RepositoryStatus
  branches: BranchSummary[]
  remoteBranches: RemoteBranchSummary[]
  tags: TagSummary[]
  worktrees: WorktreeSummary[]
  submodules: SubmoduleSummary[]
  lfs: GitLfsSummary
  recentRepositories: RecentRepository[]
}

export interface RecentRepository {
  path: string
  name: string
  lastOpenedAt: string
  pinned: boolean
}

export interface RepositoryPinRequest {
  repoPath: string
  pinned: boolean
}

export interface CloneRepositoryRequest {
  remoteUrl: string
  targetParentPath?: string
  targetName?: string
}

export type DashboardRepositoryState = 'clean' | 'dirty' | 'conflicted' | 'unavailable'

export interface DashboardRepositorySummary {
  path: string
  name: string
  pinned: boolean
  active: boolean
  state: DashboardRepositoryState
  currentBranch?: string
  upstream?: string
  remoteName?: string
  ahead: number
  behind: number
  changed: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  mergeOperation: InProgressOperation
  lastOpenedAt?: string
  error?: string
}

export interface DashboardStaleBranch {
  repoPath: string
  repoName: string
  name: string
  lastCommitAt: string
  daysSinceCommit: number
}

export interface RepositoryDashboardTotals {
  repositories: number
  dirty: number
  conflicted: number
  unavailable: number
  ahead: number
  behind: number
  staleBranches: number
}

export interface RepositoryDashboardSnapshot {
  generatedAt: string
  staleBranchThresholdDays: number
  repositories: DashboardRepositorySummary[]
  staleBranches: DashboardStaleBranch[]
  totals: RepositoryDashboardTotals
}

export interface BranchSummary {
  name: string
  current: boolean
  upstream?: string
  description?: string
  lastCommit?: string
  lastCommitAt?: string
}

export interface RemoteBranchSummary {
  name: string
  remote: string
  branchName: string
  lastCommit?: string
  lastCommitAt?: string
}

export interface BranchCompareRequest {
  repoPath: string
  targetBranch: string
  baseBranch?: string
}

export interface BranchComparison {
  baseBranch: string
  targetBranch: string
  baseOnlyCommits: number
  targetOnlyCommits: number
  files: CommitFileChange[]
  summaryText: string
  tooLarge: boolean
}

export interface TagSummary {
  name: string
  targetSha: string
  targetShortSha: string
  createdAt?: string
  subject?: string
}

export interface WorktreeSummary {
  path: string
  branch?: string
  head?: string
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
  current: boolean
  reason?: string
}

export type SubmoduleStatus = 'initialized' | 'uninitialized' | 'modified' | 'conflicted' | 'unknown'

export interface SubmoduleSummary {
  path: string
  absolutePath: string
  url?: string
  branch?: string
  head?: string
  status: SubmoduleStatus
  description?: string
}

export type GitLfsFileStatus = 'present' | 'pointer' | 'unknown'

export interface GitLfsPattern {
  pattern: string
  sourcePath: string
  line: number
}

export interface GitLfsFile {
  path: string
  oid?: string
  status: GitLfsFileStatus
}

export interface GitLfsSummary {
  installed: boolean
  version?: string
  trackedPatterns: GitLfsPattern[]
  files: GitLfsFile[]
  fileCount: number
  message: string
}

export interface CommitSummary {
  sha: string
  shortSha: string
  subject: string
  authorName: string
  authorEmail: string
  authoredAt: string
}

