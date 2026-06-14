import path from 'node:path'
import type {
  ApplyPatchRequest,
  BranchActionRequest,
  BranchCompareRequest,
  CommitRequest,
  ConfirmedCommitReferenceRequest,
  ConfirmedCommitRequest,
  ConfirmedFileActionRequest,
  ConfirmedStashActionRequest,
  CreateStashRequest,
  CreateTagRequest,
  CreateWorktreeRequest,
  DeleteBranchRequest,
  DeleteTagRequest,
  ExportPatchRequest,
  FileActionRequest,
  GitIdentityUpdate,
  HunkActionRequest,
  MergeBranchRequest,
  PublishBranchRequest,
  RemoteRemoveRequest,
  RemoteUpsertRequest,
  RemoveWorktreeRequest,
  RenameBranchRequest,
  SetBranchUpstreamRequest,
  StashActionRequest,
  UpdateBranchDescriptionRequest,
  UpdateSubmoduleRequest
} from '../../src/shared/branchPilot.js'
import { withProjectMemoryRefresh } from '../ipcTypes.js'
import type { createIpcHelpers } from '../ipcHelpers.js'
import type { RegisterIpcHandlersServices } from '../ipcTypes.js'

export function registerGitHandlers(
  helpers: ReturnType<typeof createIpcHelpers>,
  services: RegisterIpcHandlersServices
) {
  const { handle, handleLogged, repoPathArg, requestRepoPath, choosePatchOutputPath, choosePatchInputPath, chooseWorktreeTargetPath } = helpers
  const { repositoryService } = services

  handle('repository:gitConfig', (repoPath: string) => repositoryService.getGitConfig(repoPath))
  handle('repository:setLocalGitIdentity', (request: GitIdentityUpdate) => repositoryService.setLocalGitIdentity(request))
  handleLogged('git:addRemote', {
    type: 'remote_added',
    actor: 'user',
    title: 'Remote added',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      remote: request.name
    })
  }, (request: RemoteUpsertRequest) =>
    repositoryService.addRemote(request)
  )
  handleLogged('git:setRemoteUrl', {
    type: 'remote_updated',
    actor: 'user',
    title: 'Remote updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      remote: request.name
    })
  }, (request: RemoteUpsertRequest) =>
    repositoryService.setRemoteUrl(request)
  )
  handleLogged('git:removeRemote', {
    type: 'remote_removed',
    actor: 'user',
    title: 'Remote removed',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      remote: request.name
    })
  }, (request: RemoteRemoveRequest) =>
    repositoryService.removeRemote(request)
  )

  handle('git:stageFile', (request: FileActionRequest) => repositoryService.stageFile(request))
  handle('git:unstageFile', (request: FileActionRequest) => repositoryService.unstageFile(request))
  handle('git:stageHunk', (request: HunkActionRequest) => repositoryService.stageHunk(request))
  handle('git:unstageHunk', (request: HunkActionRequest) => repositoryService.unstageHunk(request))
  handle('git:stageAll', (repoPath: string) => repositoryService.stageAll(repoPath))
  handle('git:unstageAll', (repoPath: string) => repositoryService.unstageAll(repoPath))
  handle('git:discardFile', (request: ConfirmedFileActionRequest) => repositoryService.discardFile(request))
  handle('git:deleteUntrackedFile', (request: ConfirmedFileActionRequest) =>
    repositoryService.deleteUntrackedFile(request)
  )
  handleLogged('git:commit', {
    type: 'commit_created',
    actor: 'user',
    title: 'Commit created',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      title_length: request.title.trim().length,
      description_length: request.description.trim().length,
      branch: snapshot?.summary.currentBranch ?? 'unknown'
    })
  }, async (request: CommitRequest) =>
    withProjectMemoryRefresh(await repositoryService.commit(request))
  )
  handleLogged('git:amendCommit', {
    type: 'commit_amended',
    actor: 'user',
    title: 'Commit amended',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      title_length: request.title.trim().length,
      description_length: request.description.trim().length,
      branch: snapshot?.summary.currentBranch ?? 'unknown'
    })
  }, async (request: ConfirmedCommitRequest) =>
    withProjectMemoryRefresh(await repositoryService.amendCommit(request))
  )
  handleLogged('git:revertCommit', {
    type: 'commit_reverted',
    actor: 'user',
    title: 'Commit reverted',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      commit: request.commitSha.slice(0, 12),
      branch: snapshot?.summary.currentBranch ?? 'unknown',
      conflicts: snapshot?.status.counts.conflicted ?? 0
    })
  }, async (request: ConfirmedCommitReferenceRequest) =>
    withProjectMemoryRefresh(await repositoryService.revertCommit(request))
  )
  handleLogged('git:cherryPickCommit', {
    type: 'commit_cherry_picked',
    actor: 'user',
    title: 'Commit cherry-picked',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      commit: request.commitSha.slice(0, 12),
      branch: snapshot?.summary.currentBranch ?? 'unknown',
      conflicts: snapshot?.status.counts.conflicted ?? 0
    })
  }, async (request: ConfirmedCommitReferenceRequest) =>
    withProjectMemoryRefresh(await repositoryService.cherryPickCommit(request))
  )
  handle('stash:list', (repoPath: string) => repositoryService.listStashes(repoPath))
  handleLogged('stash:create', {
    type: 'stash_created',
    actor: 'user',
    title: 'Stash created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      message_length: request.message.trim().length,
      include_untracked: request.includeUntracked
    })
  }, (request: CreateStashRequest) => repositoryService.createStash(request))
  handleLogged('stash:apply', {
    type: 'stash_applied',
    actor: 'user',
    title: 'Stash applied',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ stash_ref: request.stashRef })
  }, (request: StashActionRequest) => repositoryService.applyStash(request))
  handleLogged('stash:drop', {
    type: 'stash_dropped',
    actor: 'user',
    title: 'Stash dropped',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ stash_ref: request.stashRef })
  }, (request: ConfirmedStashActionRequest) => repositoryService.dropStash(request))
  handleLogged('git:fetch', {
    type: 'git_fetched',
    actor: 'user',
    title: 'Fetched remote',
    repoPath: repoPathArg
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.fetch(repoPath))
  )
  handleLogged('git:pull', {
    type: 'git_pulled',
    actor: 'user',
    title: 'Pulled branch',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => snapshot ? ({ branch: snapshot.summary.currentBranch }) : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.pull(repoPath))
  )
  handleLogged('git:push', {
    type: 'git_pushed',
    actor: 'user',
    title: 'Pushed branch',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => snapshot ? ({ branch: snapshot.summary.currentBranch }) : undefined
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.push(repoPath))
  )
  handleLogged('git:publishBranch', {
    type: 'branch_published',
    actor: 'user',
    title: 'Branch published',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      branch: request.branch ?? snapshot?.summary.currentBranch ?? 'current',
      remote: request.remote ?? snapshot?.summary.remoteName ?? 'origin'
    })
  }, async (request: PublishBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.publishBranch(request))
  )
  handleLogged('git:createBranch', {
    type: 'branch_created',
    actor: 'user',
    title: 'Branch created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ branch: request.branchName })
  }, async (request: BranchActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.createBranch(request.repoPath, request.branchName, request.description))
  )
  handleLogged('git:renameBranch', {
    type: 'branch_renamed',
    actor: 'user',
    title: 'Branch renamed',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      old_branch: request.oldBranchName,
      new_branch: request.newBranchName
    })
  }, async (request: RenameBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.renameBranch(request.repoPath, request.oldBranchName, request.newBranchName))
  )
  handleLogged('git:setBranchUpstream', {
    type: 'branch_upstream_updated',
    actor: 'user',
    title: 'Branch upstream updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      branch: request.branchName,
      upstream: request.upstream
    })
  }, async (request: SetBranchUpstreamRequest) =>
    withProjectMemoryRefresh(await repositoryService.setBranchUpstream(request.repoPath, request.branchName, request.upstream))
  )
  handleLogged('git:updateBranchDescription', {
    type: 'branch_description_updated',
    actor: 'user',
    title: 'Branch description updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      branch: request.branchName,
      description_length: request.description.trim().length
    })
  }, async (request: UpdateBranchDescriptionRequest) =>
    withProjectMemoryRefresh(await repositoryService.updateBranchDescription(request.repoPath, request.branchName, request.description))
  )
  handle('git:compareBranch', (request: BranchCompareRequest) =>
    repositoryService.compareBranch(request)
  )
  handleLogged('git:switchBranch', {
    type: 'branch_switched',
    actor: 'user',
    title: 'Branch switched',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ branch: request.branchName })
  }, async (request: BranchActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.switchBranch(request.repoPath, request.branchName))
  )
  handleLogged('git:deleteBranch', {
    type: 'branch_deleted',
    actor: 'user',
    title: 'Branch deleted',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ branch: request.branchName, force: request.force })
  }, async (request: DeleteBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.deleteBranch(request.repoPath, request.branchName, request.force, request.confirmed))
  )
  handleLogged('git:createTag', {
    type: 'tag_created',
    actor: 'user',
    title: 'Tag created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      tag: request.tagName,
      annotated: Boolean(request.message?.trim())
    })
  }, async (request: CreateTagRequest) =>
    withProjectMemoryRefresh(await repositoryService.createTag(request))
  )
  handleLogged('git:deleteTag', {
    type: 'tag_deleted',
    actor: 'user',
    title: 'Tag deleted',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ tag: request.tagName })
  }, async (request: DeleteTagRequest) =>
    withProjectMemoryRefresh(await repositoryService.deleteTag(request))
  )
  handle('git:listWorktrees', async (repoPath: string) =>
    repositoryService.listWorktrees(repoPath)
  )
  handleLogged('git:createWorktree', {
    type: 'worktree_created',
    actor: 'user',
    title: 'Worktree created',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      branch: request.branchName,
      base: request.baseRef ?? 'current',
      target: request.targetPath ? path.basename(request.targetPath) : 'selected'
    })
  }, async (request: CreateWorktreeRequest) => {
    const targetPath = request.targetPath ?? await chooseWorktreeTargetPath(request)

    if (!targetPath) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.createWorktree({
      ...request,
      targetPath
    }))
  })
  handleLogged('git:removeWorktree', {
    type: 'worktree_removed',
    actor: 'user',
    title: 'Worktree removed',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      target: path.basename(request.targetPath),
      force: Boolean(request.force)
    })
  }, async (request: RemoveWorktreeRequest) =>
    withProjectMemoryRefresh(await repositoryService.removeWorktree(request))
  )
  handle('git:listSubmodules', async (repoPath: string) =>
    repositoryService.listSubmodules(repoPath)
  )
  handleLogged('git:updateSubmodule', {
    type: 'submodule_updated',
    actor: 'user',
    title: 'Submodule updated',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({
      path: request.path ?? 'all',
      init: request.init,
      recursive: request.recursive
    })
  }, async (request: UpdateSubmoduleRequest) =>
    withProjectMemoryRefresh(await repositoryService.updateSubmodule(request))
  )
  handle('git:lfsSummary', async (repoPath: string) =>
    repositoryService.getGitLfsSummary(repoPath)
  )
  handleLogged('git:lfsPull', {
    type: 'git_lfs_pulled',
    actor: 'user',
    title: 'Git LFS objects pulled',
    repoPath: repoPathArg,
    metadata: (_args, snapshot) => ({
      patterns: snapshot?.lfs.trackedPatterns.length ?? 0,
      files: snapshot?.lfs.fileCount ?? 0
    })
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.pullGitLfs(repoPath))
  )
  handleLogged('git:exportPatch', {
    type: 'patch_exported',
    actor: 'user',
    title: 'Patch exported',
    repoPath: requestRepoPath,
    metadata: ([request], patch) => ({
      scope: request.scope,
      bytes: patch?.bytes ?? 0,
      file: patch?.fileName ?? 'cancelled'
    })
  }, async (request: ExportPatchRequest) => {
    const outputPath = request.outputPath ?? await choosePatchOutputPath(request)

    if (!outputPath) {
      return null
    }

    return repositoryService.exportPatch({
      ...request,
      outputPath
    })
  })
  handleLogged('git:applyPatch', {
    type: 'patch_applied',
    actor: 'user',
    title: 'Patch applied',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      file: request.patchPath ? path.basename(request.patchPath) : 'selected',
      changed: snapshot?.status.counts.changed ?? 0
    })
  }, async (request: ApplyPatchRequest) => {
    const patchPath = request.patchPath ?? await choosePatchInputPath()

    if (!patchPath) {
      return null
    }

    return withProjectMemoryRefresh(await repositoryService.applyPatch({
      ...request,
      patchPath
    }))
  })

  handleLogged('merge:acceptOurs', {
    type: 'merge_resolved',
    actor: 'user',
    title: 'Accepted ours',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ file: request.filePath, resolution: 'ours' })
  }, async (request: FileActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.acceptOurs(request))
  )
  handleLogged('merge:acceptTheirs', {
    type: 'merge_resolved',
    actor: 'user',
    title: 'Accepted theirs',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ file: request.filePath, resolution: 'theirs' })
  }, async (request: FileActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.acceptTheirs(request))
  )
  handleLogged('merge:markResolved', {
    type: 'merge_resolved',
    actor: 'user',
    title: 'Marked resolved',
    repoPath: requestRepoPath,
    metadata: ([request]) => ({ file: request.filePath, resolution: 'manual' })
  }, async (request: FileActionRequest) =>
    withProjectMemoryRefresh(await repositoryService.markResolved(request))
  )
  handleLogged('merge:start', {
    type: 'merge_started',
    actor: 'user',
    title: 'Merge started',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      branch: request.branchName,
      operation: snapshot?.status.merge.operation ?? 'none',
      conflicts: snapshot?.status.merge.files.length ?? 0
    })
  }, async (request: MergeBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.mergeBranch(request))
  )
  handleLogged('rebase:start', {
    type: 'rebase_started',
    actor: 'user',
    title: 'Rebase started',
    repoPath: requestRepoPath,
    metadata: ([request], snapshot) => ({
      branch: request.branchName,
      operation: snapshot?.status.merge.operation ?? 'none',
      conflicts: snapshot?.status.merge.files.length ?? 0
    })
  }, async (request: MergeBranchRequest) =>
    withProjectMemoryRefresh(await repositoryService.rebaseBranch(request))
  )
  handleLogged('merge:continue', {
    type: 'merge_continued',
    actor: 'user',
    title: 'Merge continued',
    repoPath: repoPathArg
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.continueMergeOperation(repoPath))
  )
  handleLogged('merge:abort', {
    type: 'merge_aborted',
    actor: 'user',
    title: 'Merge aborted',
    repoPath: repoPathArg
  }, async (repoPath: string) =>
    withProjectMemoryRefresh(await repositoryService.abortMergeOperation(repoPath))
  )

}
