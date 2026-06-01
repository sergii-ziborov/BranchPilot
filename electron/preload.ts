import { contextBridge, ipcRenderer } from 'electron'
import type { BranchPilotApi } from '../src/shared/branchPilot.js'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const branchPilot: BranchPilotApi = {
  getVersion: () => invoke('app:version'),
  chooseAndOpenRepository: () => invoke('repository:chooseAndOpen'),
  openRepository: (path) => invoke('repository:open', path),
  getRecentRepositories: () => invoke('repository:recent'),
  refreshRepository: (repoPath) => invoke('repository:refresh', repoPath),
  getDiff: (request) => invoke('repository:diff', request),
  getHistory: (repoPath) => invoke('repository:history', repoPath),
  getCommitDetails: (request) => invoke('repository:commitDetails', request),
  getCommitFileDiff: (request) => invoke('repository:commitFileDiff', request),
  getGitConfig: (repoPath) => invoke('repository:gitConfig', repoPath),
  setLocalGitIdentity: (request) => invoke('repository:setLocalGitIdentity', request),
  stageFile: (request) => invoke('git:stageFile', request),
  unstageFile: (request) => invoke('git:unstageFile', request),
  stageAll: (repoPath) => invoke('git:stageAll', repoPath),
  unstageAll: (repoPath) => invoke('git:unstageAll', repoPath),
  discardFile: (request) => invoke('git:discardFile', request),
  deleteUntrackedFile: (request) => invoke('git:deleteUntrackedFile', request),
  commit: (request) => invoke('git:commit', request),
  fetch: (repoPath) => invoke('git:fetch', repoPath),
  pull: (repoPath) => invoke('git:pull', repoPath),
  push: (repoPath) => invoke('git:push', repoPath),
  publishBranch: (request) => invoke('git:publishBranch', request),
  createBranch: (request) => invoke('git:createBranch', request),
  switchBranch: (request) => invoke('git:switchBranch', request),
  deleteBranch: (request) => invoke('git:deleteBranch', request),
  acceptOurs: (request) => invoke('merge:acceptOurs', request),
  acceptTheirs: (request) => invoke('merge:acceptTheirs', request),
  markResolved: (request) => invoke('merge:markResolved', request),
  abortMergeOperation: (repoPath) => invoke('merge:abort', repoPath),
  openInEditor: (request) => invoke('editor:open', request),
  openTerminal: (targetPath) => invoke('terminal:open', targetPath),
  listProviders: () => invoke('providers:list'),
  listAssistants: () => invoke('assistants:list'),
  generateCommitMessage: (request) => invoke('assistants:generateCommitMessage', request)
}

contextBridge.exposeInMainWorld('branchPilot', branchPilot)
