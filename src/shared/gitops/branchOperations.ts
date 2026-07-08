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
