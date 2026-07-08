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
  mode?: 'mixed' | 'hard'
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
