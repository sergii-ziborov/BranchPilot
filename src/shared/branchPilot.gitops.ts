import type {
  CommitSummary,
  FileChangeStatus
} from './branchPilot.core.js'

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
  ignoreWhitespace?: boolean
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

export interface CoAuthor {
  name: string
  email: string
}

export interface ContributionDay {
  date: string
  count: number
}

export interface ContributionGraph {
  days: ContributionDay[]
  total: number
}

export interface ImagePreviewRequest {
  repoPath: string
  filePath: string
}

export interface ImagePreview {
  dataUrl: string
  mimeType: string
  byteSize: number
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
  coAuthors?: string
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

export interface LinkedInProjectGenerationRequest {
  repoPath: string
  assistant: AssistantId
  role?: string
  audience?: string
  projectUrl?: string
}

export interface GeneratedLinkedInProject {
  projectName: string
  headline: string
  role: string
  startDate: string
  endDate: string
  description: string
  highlights: string[]
  tags: string[]
  skills: string[]
  urlSuggestion: string
  markdown: string
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
  stashChanges?: boolean
}

export interface UpdateBranchDescriptionRequest {
  repoPath: string
  branchName: string
  description: string
}

export interface RenameBranchRequest {
  repoPath: string
  oldBranchName: string
  newBranchName: string
}

export interface SetBranchUpstreamRequest {
  repoPath: string
  branchName: string
  upstream: string
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

export type EditorPreference = 'auto' | 'vscode' | 'cursor' | 'webstorm' | 'rider' | 'sublime' | 'custom'

export interface EditorSettings {
  preference: EditorPreference
  customCommand?: string
  updatedAt?: string
}

export interface EditorSettingsUpdate {
  preference: EditorPreference
  customCommand?: string
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


