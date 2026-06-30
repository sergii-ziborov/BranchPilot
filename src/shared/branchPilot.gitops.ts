export type {
  CreatePullRequestRequest,
  EditorOpenRequest,
  EditorPreference,
  EditorSettings,
  EditorSettingsUpdate,
  GitHubAuthProvider,
  GitHubCliState,
  GitHubCliStatus,
  TerminalPreference,
  TerminalSettings,
  TerminalSettingsUpdate
} from './branchPilot.integrations.js'

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

/** Lightweight commit summary for a hover card (GitLens-style), one fast git call. */
export interface CommitCard {
  sha: string
  shortSha: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  authoredAt: string
  avatarUrl?: string
  filesChanged: number
  insertions: number
  deletions: number
  tags: string[]
  branches: string[]
}

export interface CommitDetailsRequest {
  repoPath: string
  commitSha: string
}

export interface CommitFileDiffRequest extends CommitDetailsRequest {
  filePath: string
}

export interface CommitFileContentRequest extends CommitFileDiffRequest {}

export interface CommitFileCompareRequest extends CommitFileDiffRequest {
  compareCommitSha: string
}

export interface CommitFileContentResult {
  commitSha: string
  filePath: string
  text: string
  binary: boolean
  tooLarge: boolean
}

export interface RepositoryFileEntry {
  path: string
}

export interface RepositoryFileContentRequest {
  repoPath: string
  filePath: string
}

export interface RepositoryFileContentResult {
  filePath: string
  text: string
  binary: boolean
  tooLarge: boolean
}

export interface RepositoryFileChunkRequest extends RepositoryFileContentRequest {
  offset: number
  maxBytes?: number
}

export interface RepositoryFileChunkResult {
  filePath: string
  text: string
  binary: boolean
  byteSize: number
  startOffset: number
  endOffset: number
  hasMore: boolean
}

export interface RepositoryFileWriteRequest extends RepositoryFileContentRequest {
  text: string
}

export interface RepositoryFileBytesResult {
  filePath: string
  base64: string
  byteSize: number
  tooLarge: boolean
  maxBytes: number
}

export interface RepositoryFileBytesWriteRequest extends RepositoryFileContentRequest {
  base64: string
}

export interface RepositoryFileRenameRequest extends RepositoryFileContentRequest {
  newFilePath: string
}

export interface RepositoryFileDeleteRequest extends RepositoryFileContentRequest {
  confirmed: boolean
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
  /** Lines of unchanged context around each hunk. Large value ≈ show the whole file. */
  contextLines?: number
}

export interface DiffContextRequest {
  repoPath: string
  filePath: string
  staged: boolean
  lineStart: number
  maxLines: number
}

export interface CssColorEditRequest {
  repoPath: string
  filePath: string
  lineNumber: number
  columnStart: number
  oldValue: string
  newValue: string
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

export interface DiffContextResult {
  filePath: string
  staged: boolean
  lineStart: number
  lineEnd: number
  totalLines: number
  lines: DiffLine[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
}

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

export interface ImagePreviewRequest {
  repoPath: string
  filePath: string
  /** When set, preview the image from this commit instead of the working tree. */
  commitSha?: string
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

export type InstalledAssistantId = 'claude' | 'codex'
export type AssistantModelId =
  | 'claude:opus'
  | 'claude:sonnet'
  | 'claude:haiku'
  | 'codex:gpt-5'
  | 'codex:gpt-5-codex'
  | 'codex:gpt-5-mini'
export type AssistantId = 'auto' | InstalledAssistantId | AssistantModelId

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
  customPrompt?: string
}

export interface RepositoryStarterGenerationRequest {
  repoPath: string
  assistant: AssistantId
  repositoryName?: string
}

export interface FileBeautifyRequest {
  repoPath: string
  assistant: AssistantId
  filePath: string
  text: string
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

export interface GeneratedRepositoryStarter {
  description: string
  readme: string
  gitignore: string
  assistant: InstalledAssistantId
  truncated: boolean
}

export interface BeautifiedFile {
  content: string
  assistant: InstalledAssistantId
  truncated: boolean
}

export type ReviewMode = 'consistency' | 'security' | 'quality' | 'knip' | 'depcheck' | 'osv' | 'gitleaks'
export type ReviewScope = 'selected' | 'staged' | 'unstaged' | 'branch'
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
  filePaths?: string[]
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
  baseRef?: string
  description?: string
  checkout?: boolean
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

export interface ForcePushRequest {
  repoPath: string
  confirmed: boolean
}

export interface UpdateSubmoduleRequest {
  repoPath: string
  path?: string
  init: boolean
  recursive: boolean
}


