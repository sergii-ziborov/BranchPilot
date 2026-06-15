import { app, dialog } from 'electron'
import path from 'node:path'
import type {
  ActivityLogQuery,
  AssistantPolicyUpdate,
  CloneRepositoryRequest,
  CommitDetailsRequest,
  CommitFileDiffRequest,
  DailyReviewRequest,
  DiffRequest,
  ImagePreviewRequest,
  ProjectMemoryScanResult,
  RepositoryPinRequest
} from '../../../src/shared/branchPilot.js'
import { createProjectMemoryMcpConfig } from '../../mcp/config.js'
import { withProjectMemoryRefresh } from '../ipcTypes.js'
import type { createIpcHelpers } from '../ipcHelpers.js'
import type { RegisterIpcHandlersServices } from '../ipcTypes.js'

export function registerRepositoryHandlers(
  helpers: ReturnType<typeof createIpcHelpers>,
  services: RegisterIpcHandlersServices
) {
  const { handle, handleLogged, handleUnwrapped, repoPathArg, requestRepoPath, snapshotRepoPath, chooseCloneParentPath } = helpers
  const { repositoryService, assistantPolicyService, activityLogService, projectMemoryService, projectWikiService, dailyReviewService, projectMemoryDir, projectWikiDir, activityLogDir } = services

  handleUnwrapped('app:version', () => app.getVersion())

  handleLogged('repository:chooseAndOpen', {
    type: 'repository_opened',
    actor: 'user',
    title: 'Repository opened',
    repoPath: snapshotRepoPath,
    metadata: (_args, snapshot) => snapshot ? {
      repository: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      remote: snapshot.summary.remoteName ?? 'none'
    } : undefined
  }, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open repository',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.openRepository(result.filePaths[0]))
  })

  handleLogged('repository:clone', {
    type: 'repository_cloned',
    actor: 'user',
    title: 'Repository cloned',
    repoPath: snapshotRepoPath,
    metadata: ([request], snapshot) => ({
      repository: snapshot?.summary.name ?? request.targetName ?? 'repository',
      target_parent: request.targetParentPath ? path.basename(request.targetParentPath) : 'selected'
    })
  }, async (request: CloneRepositoryRequest) => {
    const targetParentPath = request.targetParentPath ?? await chooseCloneParentPath()

    if (!targetParentPath) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.cloneRepository({
      ...request,
      targetParentPath
    }))
  })

  handleLogged('repository:open', {
    type: 'repository_opened',
    actor: 'user',
    title: 'Repository opened',
    repoPath: (args, snapshot) => snapshotRepoPath(args, snapshot) ?? args[0],
    metadata: (_args, snapshot) => snapshot ? {
      repository: snapshot.summary.name,
      branch: snapshot.summary.currentBranch,
      remote: snapshot.summary.remoteName ?? 'none'
    } : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.openRepository(repoPath))
  )
  handle('repository:recent', () => repositoryService.getRecentRepositories())
  handle('repository:setPinned', (request: RepositoryPinRequest) => repositoryService.setRepositoryPinned(request))
  handle('repository:dashboard', (repoPath?: string) => repositoryService.getRepositoryDashboard(repoPath))
  handleLogged('repository:refresh', {
    type: 'repository_refreshed',
    actor: 'user',
    title: 'Repository refreshed',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => snapshot ? {
      branch: snapshot.summary.currentBranch,
      changed: snapshot.status.counts.changed,
      staged: snapshot.status.counts.staged
    } : undefined
  }, (repoPath: string) => repositoryService.getSnapshot(repoPath))
  handle('repository:diff', (request: DiffRequest) => repositoryService.getDiff(request))
  handle('repository:imagePreview', (request: ImagePreviewRequest) => repositoryService.getImagePreview(request))
  handle('repository:contributionGraph', (repoPath?: string) => repositoryService.getContributionGraph(repoPath))
  handle('repository:contributors', (repoPath: string) => repositoryService.getContributors(repoPath))
  handle('repository:history', (repoPath: string) => repositoryService.getHistory(repoPath))
  handle('repository:commitDetails', (request: CommitDetailsRequest) => repositoryService.getCommitDetails(request))
  handle('repository:commitFileDiff', (request: CommitFileDiffRequest) => repositoryService.getCommitFileDiff(request))
  handle('repository:projectMemory', (repoPath: string) => projectMemoryService.getProjectMemory(repoPath))
  handle('repository:projectWiki', (repoPath: string) => projectWikiService.getProjectWiki(repoPath))
  handleLogged('repository:scanProjectMemory', {
    type: 'project_memory_scanned',
    actor: 'branchpilot',
    title: 'Project Memory scanned',
    repoPath: repoPathArg,
    metadata: (_args, result) => result ? {
      scanned_files: result.scannedFileCount,
      skipped_files: result.skippedFileCount,
      duration_ms: result.durationMs,
      symbols: result.snapshot.symbols.length
    } : undefined
  }, (repoPath: string): Promise<ProjectMemoryScanResult> =>
    projectMemoryService.scanProjectMemory(repoPath)
  )
  handleLogged('repository:generateProjectWiki', {
    type: 'project_wiki_generated',
    actor: 'branchpilot',
    title: 'Project Wiki generated',
    repoPath: repoPathArg,
    metadata: (_args, result) => result ? {
      pages: result.wiki.pages.length,
      scanned_files: result.memory.scannedFileCount,
      source_memory_scanned_at: result.wiki.sourceMemoryScannedAt
    } : undefined
  }, (repoPath: string) =>
    projectWikiService.generateProjectWiki(repoPath)
  )
  handle('repository:projectMemoryMcpConfig', (repoPath: string) =>
    createProjectMemoryMcpConfig({
      memoryDir: projectMemoryDir,
      activityDir: activityLogDir,
      wikiDir: projectWikiDir,
      repoPath,
      serverPath: path.join(__dirname, 'mcp/server.js')
    })
  )
  handle('assistants:getPolicy', (repoPath: string) => assistantPolicyService.getAssistantPolicy(repoPath))
  handleLogged('assistants:setPolicy', {
    type: 'assistant_policy_updated',
    actor: 'user',
    title: 'Assistant policy updated',
    repoPath: requestRepoPath,
    metadata: ([update], status) => ({
      mode: status?.settings.mode ?? update.mode
    })
  }, (update: AssistantPolicyUpdate) =>
    assistantPolicyService.setAssistantPolicy(update)
  )
  handle('activity:list', (query: ActivityLogQuery) => activityLogService.getActivityLog(query))
  handle('activity:clear', (repoPath: string, confirmed: boolean) =>
    activityLogService.clearActivityLog(repoPath, confirmed)
  )
  handleLogged('daily:generate', {
    type: 'daily_review_generated',
    actor: 'branchpilot',
    title: 'Daily review generated',
    repoPath: requestRepoPath,
    metadata: ([request], report) => ({
      date: request.date ?? report?.date ?? '',
      commits: report?.stats.commits ?? 0,
      changed: report?.stats.changed ?? 0,
      activities: report?.stats.activities ?? 0,
      actions: report?.actionItems.length ?? 0
    })
  }, (request: DailyReviewRequest) =>
    dailyReviewService.generateDailyReview(request)
  )
}
