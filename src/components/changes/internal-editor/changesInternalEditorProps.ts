import type { ApiResult, AssistantId, AssistantStatus, BranchPilotApi, RepositorySnapshot } from '../../../shared/branchPilot'
import type { ConfirmationOptions } from '../../../lib/prompts'

export interface ChangesInternalEditorProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  initialFilePath: string | null
  selectedAssistant: AssistantId
  assistants: AssistantStatus[]
  assistantsChecking: boolean
  checkAssistants: () => void | Promise<void>
  onBack: () => void
  setNotice: (message: string) => void
  requestConfirmation: (message: string, options?: ConfirmationOptions) => Promise<boolean>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
}
