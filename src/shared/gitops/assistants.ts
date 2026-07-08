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

export type CodexAgentSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'
export type CodexAgentReasoning = 'light' | 'medium' | 'high' | 'extra-high'

export interface CodexAgentImageAttachment {
  name: string
  mimeType: string
  dataUrl: string
}

export type CodexAgentAttachmentKind = 'image' | 'text'

export interface CodexAgentAttachment {
  kind: CodexAgentAttachmentKind
  name: string
  mimeType: string
  dataUrl?: string
  text?: string
  sizeBytes?: number
}

export interface CodexAgentDiagnostic {
  lineNumber: number
  column: number
  message: string
  source: string
}

export interface CodexAgentRequest {
  repoPath: string
  assistant: AssistantId
  prompt: string
  filePath?: string
  fileText?: string
  diagnostics?: CodexAgentDiagnostic[]
  sandbox: CodexAgentSandbox
  reasoning: CodexAgentReasoning
  attachments?: CodexAgentAttachment[]
  images?: CodexAgentImageAttachment[]
  runId?: string
}

export interface CodexAgentEvent {
  type: string
  text: string
}

export interface CodexAgentStreamBatch {
  runId: string
  events: CodexAgentEvent[]
}

export interface CodexAgentResult {
  assistant: InstalledAssistantId
  modelLabel?: string
  output: string
  events: CodexAgentEvent[]
  sandbox: CodexAgentSandbox
  reasoning: CodexAgentReasoning
  imageCount: number
  attachmentCount?: number
  durationMs: number
  generatedAt: string
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
