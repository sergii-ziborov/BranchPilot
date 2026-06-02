export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BranchPilotError }

export interface BranchPilotError {
  code: string
  message: string
  details?: string
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
  recentRepositories: RecentRepository[]
}

export interface RecentRepository {
  path: string
  name: string
  lastOpenedAt: string
}

export interface BranchSummary {
  name: string
  current: boolean
  upstream?: string
  lastCommit?: string
  lastCommitAt?: string
}

export interface CommitSummary {
  sha: string
  shortSha: string
  subject: string
  authorName: string
  authorEmail: string
  authoredAt: string
}

export interface CommitFileChange {
  path: string
  originalPath?: string
  status: FileChangeStatus
  rawStatus: string
}

export interface CommitDetails extends CommitSummary {
  body: string
  files: CommitFileChange[]
}

export interface CommitDetailsRequest {
  repoPath: string
  commitSha: string
}

export interface CommitFileDiffRequest extends CommitDetailsRequest {
  filePath: string
}

export interface RemoteSummary {
  name: string
  fetchUrl?: string
  pushUrl?: string
}

export interface GitConfigSnapshot {
  localUserName?: string
  localUserEmail?: string
  globalUserName?: string
  globalUserEmail?: string
  effectiveUserName?: string
  effectiveUserEmail?: string
  commitSigningEnabled?: boolean
  commitSigningSource: 'local' | 'global' | 'unset'
  remotes: RemoteSummary[]
}

export interface GitIdentityUpdate {
  repoPath: string
  name: string
  email: string
}

export interface DiffRequest {
  repoPath: string
  filePath: string
  staged: boolean
}

export type DiffLineType = 'context' | 'add' | 'remove' | 'meta'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
  patch: string
}

export interface DiffFile {
  oldPath?: string
  newPath: string
  hunks: DiffHunk[]
}

export interface DiffResult {
  filePath: string
  staged: boolean
  text: string
  binary: boolean
  tooLarge: boolean
  files: DiffFile[]
}

export interface HunkActionRequest {
  repoPath: string
  filePath: string
  patch: string
}

export interface FileActionRequest {
  repoPath: string
  filePath: string
}

export interface ConfirmedFileActionRequest extends FileActionRequest {
  confirmed: boolean
}

export interface CommitRequest {
  repoPath: string
  title: string
  description: string
}

export interface StashEntry {
  ref: string
  sha: string
  message: string
  createdAtLabel: string
}

export interface CreateStashRequest {
  repoPath: string
  message: string
  includeUntracked: boolean
}

export interface StashActionRequest {
  repoPath: string
  stashRef: string
}

export interface ConfirmedStashActionRequest extends StashActionRequest {
  confirmed: boolean
}

export type AssistantId = 'auto' | 'claude' | 'codex'
export type InstalledAssistantId = Exclude<AssistantId, 'auto'>

export interface CommitMessageGenerationRequest {
  repoPath: string
  assistant: AssistantId
}

export interface GeneratedCommitMessage {
  title: string
  description: string
  assistant: InstalledAssistantId
  truncated: boolean
}

export interface PullRequestTextGenerationRequest {
  repoPath: string
  assistant: AssistantId
  baseBranch?: string
}

export interface GeneratedPullRequestText {
  title: string
  description: string
  assistant: InstalledAssistantId
  truncated: boolean
  baseBranch: string
  headBranch: string
  commitCount: number
}

export type ReviewMode = 'consistency' | 'security' | 'quality'
export type ReviewScope = 'staged' | 'unstaged' | 'branch'
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface ReviewFinding {
  severity: ReviewSeverity
  title: string
  details: string
  filePath?: string
  line?: number
  recommendation?: string
}

export interface ReviewReport {
  summary: string
  findings: ReviewFinding[]
  mode: ReviewMode
  scope: ReviewScope
  assistant: InstalledAssistantId
  truncated: boolean
}

export interface ReviewReportRequest {
  repoPath: string
  assistant: AssistantId
  mode: ReviewMode
  scope: ReviewScope
}

export interface GitOperationResult {
  message: string
  stdout?: string
  stderr?: string
}

export interface PublishBranchRequest {
  repoPath: string
  remote?: string
  branch?: string
}

export interface BranchActionRequest {
  repoPath: string
  branchName: string
}

export interface DeleteBranchRequest extends BranchActionRequest {
  force: boolean
}

export interface EditorOpenRequest {
  targetPath: string
  line?: number
}

export type GitHubCliState = 'missing' | 'unauthenticated' | 'authenticated'

export interface GitHubCliStatus {
  state: GitHubCliState
  installed: boolean
  authenticated: boolean
  executable?: string
  username?: string
  message: string
}

export interface CreatePullRequestRequest {
  repoPath: string
  title: string
  description: string
  baseBranch?: string
  headBranch?: string
}

export interface CreatedPullRequest {
  url: string
  title: string
  baseBranch: string
  headBranch: string
}

export interface ProviderStatus {
  id: 'github' | 'gitlab' | 'bitbucket'
  label: string
  state: 'planned' | 'available' | 'connected' | 'missing' | 'unauthenticated'
}

export interface AssistantStatus {
  id: InstalledAssistantId
  label: string
  detected: boolean
  executable?: string
}

export interface BranchPilotApi {
  getVersion: () => Promise<string>
  chooseAndOpenRepository: () => Promise<ApiResult<RepositorySnapshot | null>>
  openRepository: (path: string) => Promise<ApiResult<RepositorySnapshot>>
  getRecentRepositories: () => Promise<ApiResult<RecentRepository[]>>
  refreshRepository: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  getDiff: (request: DiffRequest) => Promise<ApiResult<DiffResult>>
  getHistory: (repoPath: string) => Promise<ApiResult<CommitSummary[]>>
  getCommitDetails: (request: CommitDetailsRequest) => Promise<ApiResult<CommitDetails>>
  getCommitFileDiff: (request: CommitFileDiffRequest) => Promise<ApiResult<DiffResult>>
  getGitConfig: (repoPath: string) => Promise<ApiResult<GitConfigSnapshot>>
  setLocalGitIdentity: (request: GitIdentityUpdate) => Promise<ApiResult<GitConfigSnapshot>>
  stageFile: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  unstageFile: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  stageHunk: (request: HunkActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  unstageHunk: (request: HunkActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  stageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  unstageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  discardFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  deleteUntrackedFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  commit: (request: CommitRequest) => Promise<ApiResult<RepositorySnapshot>>
  listStashes: (repoPath: string) => Promise<ApiResult<StashEntry[]>>
  createStash: (request: CreateStashRequest) => Promise<ApiResult<RepositorySnapshot>>
  applyStash: (request: StashActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  dropStash: (request: ConfirmedStashActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  fetch: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  pull: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  push: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  publishBranch: (request: PublishBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  createBranch: (request: BranchActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  switchBranch: (request: BranchActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  deleteBranch: (request: DeleteBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  acceptOurs: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  acceptTheirs: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  markResolved: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  abortMergeOperation: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  openInEditor: (request: EditorOpenRequest) => Promise<ApiResult<GitOperationResult>>
  openTerminal: (targetPath: string) => Promise<ApiResult<GitOperationResult>>
  listProviders: () => Promise<ApiResult<ProviderStatus[]>>
  listAssistants: () => Promise<ApiResult<AssistantStatus[]>>
  generateCommitMessage: (request: CommitMessageGenerationRequest) => Promise<ApiResult<GeneratedCommitMessage>>
  getGitHubCliStatus: (repoPath?: string) => Promise<ApiResult<GitHubCliStatus>>
  generatePullRequestText: (request: PullRequestTextGenerationRequest) => Promise<ApiResult<GeneratedPullRequestText>>
  createGitHubPullRequest: (request: CreatePullRequestRequest) => Promise<ApiResult<CreatedPullRequest>>
  generateReviewReport: (request: ReviewReportRequest) => Promise<ApiResult<ReviewReport>>
}
