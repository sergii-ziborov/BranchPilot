import type { RefObject } from 'react'
import type {
  ApiResult,
  AssistantPolicyStatus,
  BranchPilotApi,
  GitConfigSnapshot,
  GitHubAccountSummary,
  GitHubCliStatus,
  RepositorySnapshot
} from '../../shared/branchPilot'
import type { ViewMode } from '../../lib/viewMode'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from '../../shared/commitPreconditions'

export interface CommitComposerProps {
  panelRef: RefObject<HTMLDivElement | null>
  snapshot: RepositorySnapshot | null
  busy: boolean
  stagingBusy: boolean
  commitTitle: string
  setCommitTitle: (value: string) => void
  commitDescription: string
  setCommitDescription: (value: string) => void
  commitCoAuthors: string
  setCommitCoAuthors: (value: string) => void
  gitConfig: GitConfigSnapshot | null
  localUserName: string
  setLocalUserName: (value: string) => void
  localUserEmail: string
  setLocalUserEmail: (value: string) => void
  githubAccounts: GitHubAccountSummary[]
  githubCliStatus: GitHubCliStatus | null
  assistantPolicy: AssistantPolicyStatus | null
  setNotice: (message: string) => void
  onOpenReview: () => void
  generateCommitText: () => void | Promise<void>
  canGenerateCommitText: boolean
  commitActionState: ReturnType<typeof getCommitActionState>
  commitAndPushActionState: ReturnType<typeof getCommitAndPushActionState>
  amendCommitActionState: ReturnType<typeof getAmendCommitActionState>
  commitChanges: () => Promise<boolean>
  amendLastCommit: () => void | Promise<boolean>
  currentRepoPath: string | undefined
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  api: BranchPilotApi | undefined
  setViewMode: (mode: ViewMode) => void
}
