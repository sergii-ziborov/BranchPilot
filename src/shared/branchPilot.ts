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

export interface ProjectMemoryRepository {
  id: string
  rootPath: string
  name: string
  currentBranch: string
  remoteName?: string
  remoteUrl?: string
}

export interface ProjectMemoryStackHint {
  id: string
  label: string
  source: string
}

export type ProjectMemorySymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'component'
  | 'constant'
  | 'type'
  | 'interface'
  | 'export'

export interface ProjectMemoryFile {
  path: string
  extension: string
  sizeBytes: number
  language?: string
  symbolCount: number
  importCount: number
}

export interface ProjectMemorySymbol {
  id: string
  name: string
  kind: ProjectMemorySymbolKind
  path: string
  line: number
  exported: boolean
  parentName?: string
}

export interface ProjectMemoryImport {
  path: string
  source: string
  specifiers: string[]
  line: number
}

export interface ProjectMemorySnapshot {
  version: 1
  scannedAt: string
  repository: ProjectMemoryRepository
  files: ProjectMemoryFile[]
  symbols: ProjectMemorySymbol[]
  imports: ProjectMemoryImport[]
  stackHints: ProjectMemoryStackHint[]
  recentCommits: CommitSummary[]
}

export interface ProjectMemoryScanResult {
  snapshot: ProjectMemorySnapshot
  durationMs: number
  scannedFileCount: number
  skippedFileCount: number
}

export interface ProjectMemoryMcpConfig {
  memoryDir: string
  activityDir: string
  wikiDir: string
  serverPath: string
  repoPath: string
  codexCommand: string
  codexToml: string
  serverExists: boolean
}

export type ProjectWikiPageId =
  | 'overview'
  | 'module_map'
  | 'important_symbols'
  | 'workflows'
  | 'assistant_policy'
  | 'recent_timeline'

export interface ProjectWikiPage {
  id: ProjectWikiPageId
  title: string
  summary: string
  markdown: string
}

export interface ProjectWikiSnapshot {
  version: 1
  generatedAt: string
  sourceMemoryScannedAt: string
  repository: ProjectMemoryRepository
  pages: ProjectWikiPage[]
}

export interface ProjectWikiGenerationResult {
  wiki: ProjectWikiSnapshot
  memory: ProjectMemoryScanResult
}

export type AssistantPolicyMode =
  | 'disabled'
  | 'review-only'
  | 'suggest-only'
  | 'allow-local-commands'
  | 'allow-file-edits'

export type AssistantActionKind = 'commit_message' | 'pull_request_text' | 'review_report' | 'branch_draft'

export interface AssistantPolicySettings {
  repoPath: string
  mode: AssistantPolicyMode
  updatedAt: string
}

export interface AssistantPolicyStatus {
  settings: AssistantPolicySettings
  allowedActions: AssistantActionKind[]
  lockedModes: AssistantPolicyMode[]
}

export interface AssistantPolicyUpdate {
  repoPath: string
  mode: AssistantPolicyMode
}

export type ActivityLogEventType =
  | 'repository_opened'
  | 'repository_cloned'
  | 'repository_refreshed'
  | 'project_memory_scanned'
  | 'project_wiki_generated'
  | 'assistant_policy_updated'
  | 'assistant_action_blocked'
  | 'commit_created'
  | 'commit_amended'
  | 'commit_reverted'
  | 'commit_cherry_picked'
  | 'branch_created'
  | 'branch_description_updated'
  | 'branch_switched'
  | 'branch_deleted'
  | 'remote_added'
  | 'remote_updated'
  | 'remote_removed'
  | 'tag_created'
  | 'tag_deleted'
  | 'worktree_created'
  | 'worktree_removed'
  | 'submodule_updated'
  | 'git_lfs_pulled'
  | 'patch_exported'
  | 'patch_applied'
  | 'git_fetched'
  | 'git_pulled'
  | 'git_pushed'
  | 'branch_published'
  | 'stash_created'
  | 'stash_applied'
  | 'stash_dropped'
  | 'merge_started'
  | 'merge_continued'
  | 'merge_aborted'
  | 'merge_resolved'
  | 'assistant_commit_generated'
  | 'assistant_branch_generated'
  | 'assistant_pr_generated'
  | 'assistant_review_generated'
  | 'daily_review_generated'
  | 'github_pr_created'
  | 'github_pr_checked_out'
  | 'github_pr_details_loaded'

export type ActivityLogActor = 'user' | 'branchpilot' | 'assistant' | 'provider'
export type ActivityLogStatus = 'success' | 'failure'
export type ActivityLogMetadataValue = string | number | boolean | null
export type ActivityLogMetadata = Record<string, ActivityLogMetadataValue>

export interface ActivityLogEntry {
  id: string
  repoPath: string
  type: ActivityLogEventType
  actor: ActivityLogActor
  status: ActivityLogStatus
  title: string
  createdAt: string
  metadata: ActivityLogMetadata
}

export interface ActivityLogQuery {
  repoPath: string
  types?: ActivityLogEventType[]
  actor?: ActivityLogActor
  status?: ActivityLogStatus
  limit?: number
}

export interface ActivityLogSnapshot {
  repoPath: string
  entries: ActivityLogEntry[]
  totalCount: number
}

export type DailyReviewSectionId = 'summary' | 'commits' | 'worktree' | 'sync' | 'activity' | 'next_actions'
export type DailyReviewActionPriority = 'high' | 'normal'

export interface DailyReviewRequest {
  repoPath: string
  date?: string
}

export interface DailyReviewStats {
  commits: number
  activities: number
  changed: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  ahead: number
  behind: number
}

export interface DailyReviewSection {
  id: DailyReviewSectionId
  title: string
  items: string[]
}

export interface DailyReviewActionItem {
  title: string
  details: string
  priority: DailyReviewActionPriority
}

export interface DailyReviewReport {
  repoPath: string
  repositoryName: string
  branch: string
  date: string
  generatedAt: string
  stats: DailyReviewStats
  sections: DailyReviewSection[]
  actionItems: DailyReviewActionItem[]
  markdown: string
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
  containingBranches: string[]
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

export interface RemoteUpsertRequest {
  repoPath: string
  name: string
  url: string
}

export interface RemoteRemoveRequest {
  repoPath: string
  name: string
  confirmed: boolean
}

export type GitDefaultBranchSource = 'remote' | 'local' | 'current' | 'unknown'

export interface GitConfigSnapshot {
  localUserName?: string
  localUserEmail?: string
  globalUserName?: string
  globalUserEmail?: string
  effectiveUserName?: string
  effectiveUserEmail?: string
  defaultBranch?: string
  defaultBranchSource: GitDefaultBranchSource
  defaultBranchRemote?: string
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

export interface ConfirmedCommitRequest extends CommitRequest {
  confirmed: boolean
}

export interface ConfirmedCommitReferenceRequest {
  repoPath: string
  commitSha: string
  confirmed: boolean
}

export type PatchScope = 'working-tree' | 'staged'

export interface ExportPatchRequest {
  repoPath: string
  scope: PatchScope
  outputPath?: string
}

export interface ExportedPatch {
  path: string
  fileName: string
  scope: PatchScope
  bytes: number
}

export interface ApplyPatchRequest {
  repoPath: string
  patchPath?: string
  confirmed: boolean
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

export interface MergeBranchRequest {
  repoPath: string
  branchName: string
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

export interface BranchDraftGenerationRequest {
  repoPath: string
  assistant: AssistantId
  goal?: string
}

export interface BranchDescriptionGenerationRequest {
  repoPath: string
  assistant: AssistantId
  branchName: string
}

export interface GeneratedBranchDraft {
  branchName: string
  description: string
  assistant: InstalledAssistantId
  truncated: boolean
}

export interface GeneratedBranchDescription {
  branchName: string
  description: string
  assistant: InstalledAssistantId
  truncated: boolean
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
  description?: string
}

export interface UpdateBranchDescriptionRequest {
  repoPath: string
  branchName: string
  description: string
}

export interface DeleteBranchRequest extends BranchActionRequest {
  confirmed: boolean
  force: boolean
}

export interface CreateTagRequest {
  repoPath: string
  tagName: string
  message?: string
}

export interface DeleteTagRequest {
  repoPath: string
  tagName: string
  confirmed: boolean
}

export interface CreateWorktreeRequest {
  repoPath: string
  branchName: string
  baseRef?: string
  targetPath?: string
}

export interface RemoveWorktreeRequest {
  repoPath: string
  targetPath: string
  confirmed: boolean
  force?: boolean
}

export interface UpdateSubmoduleRequest {
  repoPath: string
  path?: string
  init: boolean
  recursive: boolean
}

export interface EditorOpenRequest {
  targetPath: string
  line?: number
}

export type GitHubCliState = 'missing' | 'unauthenticated' | 'authenticated'
export type GitHubAuthProvider = 'none' | 'gh' | 'git-credential'

export interface GitHubCliStatus {
  state: GitHubCliState
  installed: boolean
  authenticated: boolean
  ghAuthenticated: boolean
  gitCredentialAuthenticated: boolean
  authProvider: GitHubAuthProvider
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

export interface GitHubPullRequest {
  number: number
  title: string
  url: string
  state: string
  headBranch: string
  baseBranch: string
  draft: boolean
}

export interface GitHubPullRequestAuthor {
  login: string
  name?: string
  url?: string
}

export interface GitHubPullRequestDetails extends GitHubPullRequest {
  body: string
  author?: GitHubPullRequestAuthor
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
  changedFiles: number
}

export interface GitHubPullRequestCheck {
  name: string
  state: string
  bucket: string
  workflow?: string
  description?: string
  link?: string
  startedAt?: string
  completedAt?: string
}

export interface GitHubPullRequestDiffFile extends DiffFile {
  path: string
  text: string
  status: FileChangeStatus
  additions: number
  deletions: number
}

export interface GitHubPullRequestDiff {
  prNumber: number
  text: string
  files: GitHubPullRequestDiffFile[]
}

export interface PullRequestDetailsRequest {
  repoPath: string
  prNumber: number
}

export interface CheckoutPullRequestRequest {
  repoPath: string
  prNumber: number
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
  state: 'missing' | 'detected' | 'ready' | 'unavailable'
  executable?: string
  message: string
  checkedAt?: string
}

export interface BranchPilotApi {
  getVersion: () => Promise<string>
  chooseAndOpenRepository: () => Promise<ApiResult<RepositorySnapshot | null>>
  cloneRepository: (request: CloneRepositoryRequest) => Promise<ApiResult<RepositorySnapshot | null>>
  openRepository: (path: string) => Promise<ApiResult<RepositorySnapshot>>
  getRecentRepositories: () => Promise<ApiResult<RecentRepository[]>>
  setRepositoryPinned: (request: RepositoryPinRequest) => Promise<ApiResult<RecentRepository[]>>
  getRepositoryDashboard: (repoPath?: string) => Promise<ApiResult<RepositoryDashboardSnapshot>>
  refreshRepository: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  getDiff: (request: DiffRequest) => Promise<ApiResult<DiffResult>>
  getHistory: (repoPath: string) => Promise<ApiResult<CommitSummary[]>>
  getCommitDetails: (request: CommitDetailsRequest) => Promise<ApiResult<CommitDetails>>
  getCommitFileDiff: (request: CommitFileDiffRequest) => Promise<ApiResult<DiffResult>>
  getProjectMemory: (repoPath: string) => Promise<ApiResult<ProjectMemorySnapshot | null>>
  scanProjectMemory: (repoPath: string) => Promise<ApiResult<ProjectMemoryScanResult>>
  getProjectMemoryMcpConfig: (repoPath: string) => Promise<ApiResult<ProjectMemoryMcpConfig>>
  getProjectWiki: (repoPath: string) => Promise<ApiResult<ProjectWikiSnapshot | null>>
  generateProjectWiki: (repoPath: string) => Promise<ApiResult<ProjectWikiGenerationResult>>
  getAssistantPolicy: (repoPath: string) => Promise<ApiResult<AssistantPolicyStatus>>
  setAssistantPolicy: (update: AssistantPolicyUpdate) => Promise<ApiResult<AssistantPolicyStatus>>
  getActivityLog: (query: ActivityLogQuery) => Promise<ApiResult<ActivityLogSnapshot>>
  clearActivityLog: (repoPath: string, confirmed: boolean) => Promise<ApiResult<ActivityLogSnapshot>>
  generateDailyReview: (request: DailyReviewRequest) => Promise<ApiResult<DailyReviewReport>>
  getGitConfig: (repoPath: string) => Promise<ApiResult<GitConfigSnapshot>>
  setLocalGitIdentity: (request: GitIdentityUpdate) => Promise<ApiResult<GitConfigSnapshot>>
  addRemote: (request: RemoteUpsertRequest) => Promise<ApiResult<GitConfigSnapshot>>
  setRemoteUrl: (request: RemoteUpsertRequest) => Promise<ApiResult<GitConfigSnapshot>>
  removeRemote: (request: RemoteRemoveRequest) => Promise<ApiResult<GitConfigSnapshot>>
  stageFile: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  unstageFile: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  stageHunk: (request: HunkActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  unstageHunk: (request: HunkActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  stageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  unstageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  discardFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  deleteUntrackedFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  commit: (request: CommitRequest) => Promise<ApiResult<RepositorySnapshot>>
  amendCommit: (request: ConfirmedCommitRequest) => Promise<ApiResult<RepositorySnapshot>>
  revertCommit: (request: ConfirmedCommitReferenceRequest) => Promise<ApiResult<RepositorySnapshot>>
  cherryPickCommit: (request: ConfirmedCommitReferenceRequest) => Promise<ApiResult<RepositorySnapshot>>
  listStashes: (repoPath: string) => Promise<ApiResult<StashEntry[]>>
  createStash: (request: CreateStashRequest) => Promise<ApiResult<RepositorySnapshot>>
  applyStash: (request: StashActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  dropStash: (request: ConfirmedStashActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  fetch: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  pull: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  push: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  publishBranch: (request: PublishBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  createBranch: (request: BranchActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  updateBranchDescription: (request: UpdateBranchDescriptionRequest) => Promise<ApiResult<RepositorySnapshot>>
  compareBranch: (request: BranchCompareRequest) => Promise<ApiResult<BranchComparison>>
  switchBranch: (request: BranchActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  deleteBranch: (request: DeleteBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  createTag: (request: CreateTagRequest) => Promise<ApiResult<RepositorySnapshot>>
  deleteTag: (request: DeleteTagRequest) => Promise<ApiResult<RepositorySnapshot>>
  listWorktrees: (repoPath: string) => Promise<ApiResult<WorktreeSummary[]>>
  createWorktree: (request: CreateWorktreeRequest) => Promise<ApiResult<RepositorySnapshot | null>>
  removeWorktree: (request: RemoveWorktreeRequest) => Promise<ApiResult<RepositorySnapshot>>
  listSubmodules: (repoPath: string) => Promise<ApiResult<SubmoduleSummary[]>>
  updateSubmodule: (request: UpdateSubmoduleRequest) => Promise<ApiResult<RepositorySnapshot>>
  getGitLfsSummary: (repoPath: string) => Promise<ApiResult<GitLfsSummary>>
  pullGitLfs: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  exportPatch: (request: ExportPatchRequest) => Promise<ApiResult<ExportedPatch | null>>
  applyPatch: (request: ApplyPatchRequest) => Promise<ApiResult<RepositorySnapshot | null>>
  acceptOurs: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  acceptTheirs: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  markResolved: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  mergeBranch: (request: MergeBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  continueMergeOperation: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  abortMergeOperation: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  openInEditor: (request: EditorOpenRequest) => Promise<ApiResult<GitOperationResult>>
  openTerminal: (targetPath: string) => Promise<ApiResult<GitOperationResult>>
  listProviders: () => Promise<ApiResult<ProviderStatus[]>>
  listAssistants: () => Promise<ApiResult<AssistantStatus[]>>
  checkAssistants: () => Promise<ApiResult<AssistantStatus[]>>
  generateCommitMessage: (request: CommitMessageGenerationRequest) => Promise<ApiResult<GeneratedCommitMessage>>
  generateBranchDraft: (request: BranchDraftGenerationRequest) => Promise<ApiResult<GeneratedBranchDraft>>
  generateBranchDescription: (request: BranchDescriptionGenerationRequest) => Promise<ApiResult<GeneratedBranchDescription>>
  getGitHubCliStatus: (repoPath?: string) => Promise<ApiResult<GitHubCliStatus>>
  generatePullRequestText: (request: PullRequestTextGenerationRequest) => Promise<ApiResult<GeneratedPullRequestText>>
  createGitHubPullRequest: (request: CreatePullRequestRequest) => Promise<ApiResult<CreatedPullRequest>>
  getCurrentBranchPullRequest: (repoPath: string) => Promise<ApiResult<GitHubPullRequest | null>>
  listGitHubPullRequests: (repoPath: string) => Promise<ApiResult<GitHubPullRequest[]>>
  getGitHubPullRequestDetails: (request: PullRequestDetailsRequest) => Promise<ApiResult<GitHubPullRequestDetails>>
  getGitHubPullRequestChecks: (request: PullRequestDetailsRequest) => Promise<ApiResult<GitHubPullRequestCheck[]>>
  getGitHubPullRequestDiff: (request: PullRequestDetailsRequest) => Promise<ApiResult<GitHubPullRequestDiff>>
  checkoutGitHubPullRequest: (request: CheckoutPullRequestRequest) => Promise<ApiResult<RepositorySnapshot>>
  generateReviewReport: (request: ReviewReportRequest) => Promise<ApiResult<ReviewReport>>
}
