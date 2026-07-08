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
