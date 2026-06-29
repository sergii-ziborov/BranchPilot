import type {
  ActivityLogQuery,
  ActivityLogSnapshot,
  ApiResult,
  ApplyPatchRequest,
  AssistantPolicyStatus,
  AssistantPolicyUpdate,
  BranchActionRequest,
  BranchCompareRequest,
  BranchComparison,
  BranchDescriptionGenerationRequest,
  BranchDraftGenerationRequest,
  CloneRepositoryRequest,
  CommitCard,
  CommitDetails,
  CommitDetailsRequest,
  CommitFileDiffRequest,
  CommitMessageGenerationRequest,
  CommitRequest,
  CommitSummary,
  ConfirmedCommitReferenceRequest,
  ConfirmedCommitRequest,
  ConfirmedFileActionRequest,
  ConfirmedStashActionRequest,
  CreatePullRequestRequest,
  CreateStashRequest,
  CreateTagRequest,
  CreateWorktreeRequest,
  DailyReviewReport,
  DailyReviewRequest,
  DeleteBranchRequest,
  DeleteTagRequest,
  DiffFile,
  CoAuthor,
  ContributionGraph,
  ContributorStat,
  ContributorStatsRequest,
  RepositoryRhythm,
  DiffContextRequest,
  DiffContextResult,
  DiffRequest,
  DiffResult,
  ImagePreview,
  ImagePreviewRequest,
  EditorOpenRequest,
  EditorSettings,
  EditorSettingsUpdate,
  TerminalSettings,
  TerminalSettingsUpdate,
  ExportPatchRequest,
  ExportedPatch,
  FileActionRequest,
  FileChangeStatus,
  ForcePushRequest,
  GeneratedBranchDescription,
  GeneratedBranchDraft,
  GeneratedCommitMessage,
  GeneratedLinkedInProject,
  GeneratedRepositoryStarter,
  GeneratedPullRequestText,
  GitConfigSnapshot,
  GitHubCliStatus,
  GitIdentityUpdate,
  GitLfsSummary,
  GitOperationResult,
  HunkActionRequest,
  InstalledAssistantId,
  LinkedInProjectGenerationRequest,
  MergeBranchRequest,
  ProjectMemoryMcpConfig,
  ProjectMemoryScanResult,
  ProjectMemorySnapshot,
  ProjectWikiGenerationResult,
  ProjectWikiSnapshot,
  PublishBranchRequest,
  PullRequestTextGenerationRequest,
  RecentRepository,
  RepositoryBrowserRequest,
  RepositoryBrowserSnapshot,
  RepositoryStarterGenerationRequest,
  RemoteRemoveRequest,
  RemoteUpsertRequest,
  RemoveWorktreeRequest,
  RenameBranchRequest,
  RepositoryDashboardSnapshot,
  RepositoryPinRequest,
  RepositoryScopeRequest,
  RepositorySnapshot,
  ReviewReport,
  ReviewReportRequest,
  SetBranchUpstreamRequest,
  StashActionRequest,
  StashEntry,
  SubmoduleSummary,
  UpdateBranchDescriptionRequest,
  UpdateSubmoduleRequest,
  WorktreeSummary
} from './branchPilot.js'

export interface CreatedPullRequest {
  url: string
  title: string
  baseBranch: string
  headBranch: string
}

export interface ChromeThemeRequest {
  backgroundColor: string
  symbolColor: string
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

export interface ListGitHubRepositoriesRequest {
  owner?: string
  query?: string
  visibility?: 'all' | 'public' | 'private' | 'internal'
  limit?: number
}

export interface GitHubRepositorySummary {
  name: string
  nameWithOwner: string
  owner: string
  description: string
  visibility: string
  isPrivate: boolean
  isFork: boolean
  isArchived: boolean
  url: string
  sshUrl: string
  defaultBranch: string
  updatedAt: string
  pushedAt: string
}

export interface GitHubAccountSummary {
  login: string
  label: string
  type: 'user' | 'organization'
  url: string
  emails?: string[]
  avatarUrl?: string
}

export interface GitHubCoAuthorSearchRequest {
  repoPath?: string
  query: string
  limit?: number
}

export type GitHubRepositoryVisibility = 'public' | 'private'
export type GitHubRemoteProtocol = 'https' | 'ssh'

export interface CreateGitHubRepositoryRequest {
  repoPath: string
  owner: string
  name: string
  description: string
  visibility: GitHubRepositoryVisibility
  remoteName?: string
  remoteProtocol?: GitHubRemoteProtocol
  gitUserName?: string
  gitUserEmail?: string
  readme?: string
  gitignore?: string
  commitStarterFiles?: boolean
  push?: boolean
  confirmed: boolean
}

export interface CreatedGitHubRepository {
  name: string
  nameWithOwner: string
  owner: string
  url: string
  sshUrl: string
  remoteName: string
  remoteUrl: string
  defaultBranch: string
  pushed: boolean
  starterFilesWritten: string[]
  snapshot: RepositorySnapshot
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
  onMenuAction: (callback: (action: string) => void) => () => void
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void
  setChromeTheme: (request: ChromeThemeRequest) => Promise<void>
  getVersion: () => Promise<string>
  chooseAndOpenRepository: () => Promise<ApiResult<RepositorySnapshot | null>>
  cloneRepository: (request: CloneRepositoryRequest) => Promise<ApiResult<RepositorySnapshot | null>>
  initializeRepository: (path: string) => Promise<ApiResult<RepositorySnapshot>>
  openRepository: (path: string) => Promise<ApiResult<RepositorySnapshot>>
  browseRepositoryDirectory: (request?: RepositoryBrowserRequest) => Promise<ApiResult<RepositoryBrowserSnapshot>>
  getRecentRepositories: () => Promise<ApiResult<RecentRepository[]>>
  setRepositoryPinned: (request: RepositoryPinRequest) => Promise<ApiResult<RecentRepository[]>>
  getRepositoryDashboard: (repoPath?: string) => Promise<ApiResult<RepositoryDashboardSnapshot>>
  refreshRepository: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  getDiff: (request: DiffRequest) => Promise<ApiResult<DiffResult>>
  getDiffContext: (request: DiffContextRequest) => Promise<ApiResult<DiffContextResult>>
  getImagePreview: (request: ImagePreviewRequest) => Promise<ApiResult<ImagePreview>>
  getContributionGraph: (request?: string | RepositoryScopeRequest) => Promise<ApiResult<ContributionGraph>>
  getRepositoryRhythm: (repoPath?: string) => Promise<ApiResult<RepositoryRhythm>>
  getContributorStats: (request?: string | ContributorStatsRequest) => Promise<ApiResult<ContributorStat[]>>
  getContributors: (repoPath: string) => Promise<ApiResult<CoAuthor[]>>
  getGitHubContributors: (repoPath: string) => Promise<ApiResult<CoAuthor[]>>
  getHistory: (repoPath: string) => Promise<ApiResult<CommitSummary[]>>
  getCommitCard: (request: CommitDetailsRequest) => Promise<ApiResult<CommitCard>>
  getCommitDetails: (request: CommitDetailsRequest) => Promise<ApiResult<CommitDetails>>
  getCommitFileDiff: (request: CommitFileDiffRequest) => Promise<ApiResult<DiffResult>>
  getProjectMemory: (repoPath: string) => Promise<ApiResult<ProjectMemorySnapshot | null>>
  scanProjectMemory: (repoPath: string) => Promise<ApiResult<ProjectMemoryScanResult>>
  getProjectMemoryMcpConfig: (repoPath: string) => Promise<ApiResult<ProjectMemoryMcpConfig>>
  getProjectWiki: (repoPath: string) => Promise<ApiResult<ProjectWikiSnapshot | null>>
  generateProjectWiki: (repoPath: string) => Promise<ApiResult<ProjectWikiGenerationResult>>
  getAssistantPolicy: (repoPath: string) => Promise<ApiResult<AssistantPolicyStatus>>
  setAssistantPolicy: (update: AssistantPolicyUpdate) => Promise<ApiResult<AssistantPolicyStatus>>
  getEditorSettings: () => Promise<ApiResult<EditorSettings>>
  setEditorSettings: (update: EditorSettingsUpdate) => Promise<ApiResult<EditorSettings>>
  getTerminalSettings: () => Promise<ApiResult<TerminalSettings>>
  setTerminalSettings: (update: TerminalSettingsUpdate) => Promise<ApiResult<TerminalSettings>>
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
  discardHunk: (request: HunkActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  stageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  unstageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  discardFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  deleteUntrackedFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  commit: (request: CommitRequest) => Promise<ApiResult<RepositorySnapshot>>
  amendCommit: (request: ConfirmedCommitRequest) => Promise<ApiResult<RepositorySnapshot>>
  revertCommit: (request: ConfirmedCommitReferenceRequest) => Promise<ApiResult<RepositorySnapshot>>
  cherryPickCommit: (request: ConfirmedCommitReferenceRequest) => Promise<ApiResult<RepositorySnapshot>>
  resetToCommit: (request: ConfirmedCommitReferenceRequest) => Promise<ApiResult<RepositorySnapshot>>
  listStashes: (repoPath: string) => Promise<ApiResult<StashEntry[]>>
  createStash: (request: CreateStashRequest) => Promise<ApiResult<RepositorySnapshot>>
  applyStash: (request: StashActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  dropStash: (request: ConfirmedStashActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  fetch: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  pull: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  push: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  forcePush: (request: ForcePushRequest) => Promise<ApiResult<RepositorySnapshot>>
  publishBranch: (request: PublishBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  createBranch: (request: BranchActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  renameBranch: (request: RenameBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  setBranchUpstream: (request: SetBranchUpstreamRequest) => Promise<ApiResult<RepositorySnapshot>>
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
  rebaseBranch: (request: MergeBranchRequest) => Promise<ApiResult<RepositorySnapshot>>
  continueMergeOperation: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  abortMergeOperation: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  openInEditor: (request: EditorOpenRequest) => Promise<ApiResult<GitOperationResult>>
  openTerminal: (targetPath: string) => Promise<ApiResult<GitOperationResult>>
  openFolderInFileManager: (targetPath: string) => Promise<ApiResult<GitOperationResult>>
  showItemInFolder: (targetPath: string) => Promise<ApiResult<GitOperationResult>>
  listProviders: () => Promise<ApiResult<ProviderStatus[]>>
  listAssistants: () => Promise<ApiResult<AssistantStatus[]>>
  checkAssistants: () => Promise<ApiResult<AssistantStatus[]>>
  generateCommitMessage: (request: CommitMessageGenerationRequest) => Promise<ApiResult<GeneratedCommitMessage>>
  generateBranchDraft: (request: BranchDraftGenerationRequest) => Promise<ApiResult<GeneratedBranchDraft>>
  generateBranchDescription: (request: BranchDescriptionGenerationRequest) => Promise<ApiResult<GeneratedBranchDescription>>
  generateLinkedInProject: (request: LinkedInProjectGenerationRequest) => Promise<ApiResult<GeneratedLinkedInProject>>
  generateRepositoryStarter: (request: RepositoryStarterGenerationRequest) => Promise<ApiResult<GeneratedRepositoryStarter>>
  getGitHubCliStatus: (repoPath?: string) => Promise<ApiResult<GitHubCliStatus>>
  connectGitHub: (repoPath?: string) => Promise<ApiResult<GitHubCliStatus>>
  generatePullRequestText: (request: PullRequestTextGenerationRequest) => Promise<ApiResult<GeneratedPullRequestText>>
  createGitHubPullRequest: (request: CreatePullRequestRequest) => Promise<ApiResult<CreatedPullRequest>>
  createGitHubRepository: (request: CreateGitHubRepositoryRequest) => Promise<ApiResult<CreatedGitHubRepository>>
  getCurrentBranchPullRequest: (repoPath: string) => Promise<ApiResult<GitHubPullRequest | null>>
  listGitHubPullRequests: (repoPath: string) => Promise<ApiResult<GitHubPullRequest[]>>
  listGitHubAccounts: () => Promise<ApiResult<GitHubAccountSummary[]>>
  searchGitHubCoAuthors: (request: GitHubCoAuthorSearchRequest) => Promise<ApiResult<CoAuthor[]>>
  listGitHubRepositories: (request: ListGitHubRepositoriesRequest) => Promise<ApiResult<GitHubRepositorySummary[]>>
  getGitHubPullRequestDetails: (request: PullRequestDetailsRequest) => Promise<ApiResult<GitHubPullRequestDetails>>
  getGitHubPullRequestChecks: (request: PullRequestDetailsRequest) => Promise<ApiResult<GitHubPullRequestCheck[]>>
  getGitHubPullRequestDiff: (request: PullRequestDetailsRequest) => Promise<ApiResult<GitHubPullRequestDiff>>
  checkoutGitHubPullRequest: (request: CheckoutPullRequestRequest) => Promise<ApiResult<RepositorySnapshot>>
  generateReviewReport: (request: ReviewReportRequest) => Promise<ApiResult<ReviewReport>>
}
