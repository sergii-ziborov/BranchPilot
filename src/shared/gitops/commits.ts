import type {
  CommitSummary,
  FileChangeStatus
} from '../branchPilot.core.js'

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

export type CommitSearchTextRequest = CommitDetailsRequest

export interface CommitSearchTextResult {
  commitSha: string
  filesText: string
  changesText: string
  truncated: boolean
}

export interface CommitFileDiffRequest extends CommitDetailsRequest {
  filePath: string
}

export type CommitFileContentRequest = CommitFileDiffRequest

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
