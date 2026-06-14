import type { RepositorySnapshot } from '../../src/shared/branchPilot.js'
import type { ActivityLogService } from '../lib/activityLogService.js'
import type { AssistantPolicyService } from '../lib/assistantPolicyService.js'
import type { CommandRunner } from '../lib/commandRunner.js'
import type { DailyReviewService } from '../lib/dailyReviewService.js'
import type { ExternalEditorService } from '../lib/editorService.js'
import type { ProjectMemoryService } from '../lib/projectMemoryService.js'
import type { ProjectWikiService } from '../lib/projectWikiService.js'
import type { RepositoryService } from '../lib/repositoryService.js'
import type { SettingsStore } from '../lib/settingsStore.js'

export interface RegisterIpcHandlersServices {
  repositoryService: RepositoryService
  editorService: ExternalEditorService
  assistantPolicyService: AssistantPolicyService
  activityLogService: ActivityLogService
  projectMemoryService: ProjectMemoryService
  projectWikiService: ProjectWikiService
  dailyReviewService: DailyReviewService
  settingsStore: SettingsStore
  commandRunner: CommandRunner
  projectMemoryDir: string
  projectWikiDir: string
  activityLogDir: string
}

export function withProjectMemoryRefresh(snapshot: RepositorySnapshot): RepositorySnapshot {
  return snapshot
}
