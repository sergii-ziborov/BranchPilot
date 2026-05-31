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

export interface DiffRequest {
  repoPath: string
  filePath: string
  staged: boolean
}

export interface DiffResult {
  filePath: string
  staged: boolean
  text: string
  binary: boolean
  tooLarge: boolean
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

export interface ProviderStatus {
  id: 'github' | 'gitlab' | 'bitbucket'
  label: string
  state: 'planned' | 'available' | 'connected'
}

export interface AssistantStatus {
  id: 'claude' | 'codex'
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
  stageFile: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  unstageFile: (request: FileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  stageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  unstageAll: (repoPath: string) => Promise<ApiResult<RepositorySnapshot>>
  discardFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  deleteUntrackedFile: (request: ConfirmedFileActionRequest) => Promise<ApiResult<RepositorySnapshot>>
  commit: (request: CommitRequest) => Promise<ApiResult<RepositorySnapshot>>
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
}
