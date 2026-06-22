import path from 'node:path'
import { createRequire } from 'node:module'
import type {
  ActivityLogActor, ActivityLogEventType, ActivityLogMetadata, ApiResult,
  AssistantActionKind, CreateWorktreeRequest, ExportPatchRequest, RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import { isBranchPilotIpcChannel, type BranchPilotIpcChannel } from '../../src/shared/ipcChannels.js'
import { toBranchPilotError } from '../lib/errors.js'
import type { ActivityLogAppendInput, ActivityLogService } from '../lib/activityLogService.js'
import type { AssistantPolicyService } from '../lib/assistantPolicyService.js'

const require = createRequire(import.meta.url)
const { dialog, ipcMain } = require('electron') as typeof import('electron')

export interface ActivityDescriptor<Args extends unknown[], T> {
  type: ActivityLogEventType
  actor: ActivityLogActor
  title: string
  repoPath: (args: Args, data?: T) => string | undefined
  metadata?: (args: Args, data?: T) => ActivityLogMetadata | undefined
}

export function createIpcHelpers({ assistantPolicyService, activityLogService }: {
  assistantPolicyService: AssistantPolicyService
  activityLogService: ActivityLogService
}) {
  function assertKnownIpcChannel(channel: BranchPilotIpcChannel): void {
    if (!isBranchPilotIpcChannel(channel)) {
      throw new Error(`Unknown BranchPilot IPC channel: ${channel}`)
    }
  }

  function handleUnwrapped<Args extends unknown[], T>(channel: BranchPilotIpcChannel, callback: (...args: Args) => Promise<T> | T) {
    assertKnownIpcChannel(channel)
    ipcMain.handle(channel, async (_event, ...args): Promise<T> => callback(...(args as Args)))
  }

  function handle<Args extends unknown[], T>(channel: BranchPilotIpcChannel, callback: (...args: Args) => Promise<T> | T) {
    assertKnownIpcChannel(channel)
    ipcMain.handle(channel, async (_event, ...args): Promise<ApiResult<T>> => {
      try {
        return {
          ok: true,
          data: await callback(...(args as Args))
        }
      } catch (error) {
        return {
          ok: false,
          error: toBranchPilotError(error)
        }
      }
    })
  }


  function handleLogged<Args extends unknown[], T>(
    channel: BranchPilotIpcChannel,
    descriptor: ActivityDescriptor<Args, T>,
    callback: (...args: Args) => Promise<T> | T
  ) {
    assertKnownIpcChannel(channel)
    ipcMain.handle(channel, async (_event, ...rawArgs): Promise<ApiResult<T>> => {
      const args = rawArgs as Args

      try {
        const data = await callback(...args)
        await recordActivity({
          repoPath: descriptor.repoPath(args, data),
          type: descriptor.type,
          actor: descriptor.actor,
          status: 'success',
          title: descriptor.title,
          metadata: descriptor.metadata?.(args, data)
        })

        return {
          ok: true,
          data
        }
      } catch (error) {
        const branchPilotError = toBranchPilotError(error)
        await recordActivity({
          repoPath: descriptor.repoPath(args),
          type: descriptor.type,
          actor: descriptor.actor,
          status: 'failure',
          title: descriptor.title,
          metadata: {
            ...(descriptor.metadata?.(args) ?? {}),
            error_code: branchPilotError.code,
            error_message: branchPilotError.message
          }
        })

        return {
          ok: false,
          error: branchPilotError
        }
      }
    })
  }

  function handleAssistantAction<Args extends [{ repoPath: string }], T>(
    channel: BranchPilotIpcChannel,
    action: AssistantActionKind,
    descriptor: ActivityDescriptor<Args, T>,
    callback: (...args: Args) => Promise<T> | T
  ) {
    assertKnownIpcChannel(channel)
    ipcMain.handle(channel, async (_event, ...rawArgs): Promise<ApiResult<T>> => {
      const args = rawArgs as Args
      const repoPath = descriptor.repoPath(args)

      try {
        if (repoPath) {
          await assistantPolicyService.assertActionAllowed(repoPath, action)
        }

        const data = await callback(...args)
        await recordActivity({
          repoPath,
          type: descriptor.type,
          actor: descriptor.actor,
          status: 'success',
          title: descriptor.title,
          metadata: descriptor.metadata?.(args, data)
        })

        return {
          ok: true,
          data
        }
      } catch (error) {
        const branchPilotError = toBranchPilotError(error)

        if (branchPilotError.code === 'assistant_policy_blocked') {
          const policy = repoPath ? await assistantPolicyService.getAssistantPolicy(repoPath).catch(() => undefined) : undefined
          await recordActivity({
            repoPath,
            type: 'assistant_action_blocked',
            actor: 'assistant',
            status: 'failure',
            title: 'Assistant action blocked',
            metadata: {
              action,
              policy_mode: policy?.settings.mode ?? 'unknown',
              error_code: branchPilotError.code,
              error_message: branchPilotError.message
            }
          })
        } else {
          await recordActivity({
            repoPath,
            type: descriptor.type,
            actor: descriptor.actor,
            status: 'failure',
            title: descriptor.title,
            metadata: {
              ...(descriptor.metadata?.(args) ?? {}),
              error_code: branchPilotError.code,
              error_message: branchPilotError.message
            }
          })
        }

        return {
          ok: false,
          error: branchPilotError
        }
      }
    })
  }

  async function recordActivity(input: Omit<ActivityLogAppendInput, 'repoPath'> & { repoPath?: string }) {
    if (!input.repoPath) {
      return
    }

    try {
      await activityLogService.append({
        ...input,
        repoPath: input.repoPath
      })
    } catch (error) {
      console.error('Activity Log write failed', error)
    }
  }

  function repoPathArg(args: [string]): string {
    return args[0]
  }

  function requestRepoPath<T extends { repoPath: string }>(args: [T]): string {
    return args[0].repoPath
  }

  function snapshotRepoPath(_args: unknown[], snapshot?: RepositorySnapshot | null): string | undefined {
    return snapshot?.summary.rootPath
  }

  async function choosePatchOutputPath(request: ExportPatchRequest): Promise<string | undefined> {
    const repoName = path.basename(request.repoPath)
    const scopeLabel = request.scope === 'staged' ? 'staged' : 'working-tree'
    const result = await dialog.showSaveDialog({
      title: 'Export patch',
      defaultPath: `${repoName}-${scopeLabel}.patch`,
      filters: [
        { name: 'Patch files', extensions: ['patch', 'diff'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })

    return result.canceled ? undefined : result.filePath
  }

  async function choosePatchInputPath(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({
      title: 'Apply patch',
      properties: ['openFile'],
      filters: [
        { name: 'Patch files', extensions: ['patch', 'diff'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })

    return result.canceled ? undefined : result.filePaths[0]
  }

  async function chooseWorktreeTargetPath(request: CreateWorktreeRequest): Promise<string | undefined> {
    const repoName = path.basename(request.repoPath)
    const branchSlug = request.branchName
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'worktree'
    const result = await dialog.showSaveDialog({
      title: 'Create worktree folder',
      defaultPath: path.join(path.dirname(request.repoPath), `${repoName}-${branchSlug}`),
      buttonLabel: 'Use folder'
    })

    return result.canceled ? undefined : result.filePath
  }

  async function chooseCloneParentPath(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({
      title: 'Clone repository into folder',
      buttonLabel: 'Clone here',
      properties: ['openDirectory', 'createDirectory']
    })

    return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0]
  }

  return {
    handleUnwrapped, handle, handleLogged, handleAssistantAction, recordActivity,
    repoPathArg, requestRepoPath, snapshotRepoPath,
    choosePatchOutputPath, choosePatchInputPath, chooseWorktreeTargetPath, chooseCloneParentPath
  }
}
