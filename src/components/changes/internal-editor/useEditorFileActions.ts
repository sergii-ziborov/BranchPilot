import type { Dispatch, SetStateAction } from 'react'
import type {
  ApiResult,
  BranchPilotApi,
  FileChange,
  RepositoryFileEntry,
  RepositorySnapshot
} from '../../../shared/branchPilot'
import type { ConfirmationOptions } from '../../../lib/prompts'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import type { EditorFileMenu } from './editorTypes'

export function buildRepoFilePath(repoPath: string, filePath: string): string {
  const separator = repoPath.includes('\\') ? '\\' : '/'
  const root = repoPath.replace(/[\\/]+$/, '')
  const relativePath = filePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator)
  return `${root}${separator}${relativePath}`
}

export function buildRepoFileDirectory(repoPath: string, filePath: string): string {
  const targetPath = buildRepoFilePath(repoPath, filePath)
  const lastSlash = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'))
  return lastSlash > 0 ? targetPath.slice(0, lastSlash) : repoPath
}

interface UseEditorFileActionsOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedPath: string
  dirty: boolean
  fileMenu: EditorFileMenu | null
  contextMenuChange: FileChange | null | undefined
  setFileMenu: (menu: EditorFileMenu | null) => void
  setNotice: (message: string) => void
  requestConfirmation: (message: string, options?: ConfirmationOptions) => Promise<boolean>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  setFiles: (files: RepositoryFileEntry[]) => void
  setFilesLoading: (loading: boolean) => void
  setFilesError: (error: string | null) => void
  setSelectedPath: Dispatch<SetStateAction<string>>
}

export function useEditorFileActions({
  api,
  currentRepoPath,
  selectedPath,
  dirty,
  fileMenu,
  contextMenuChange,
  setFileMenu,
  setNotice,
  requestConfirmation,
  runSnapshotAction,
  setFiles,
  setFilesLoading,
  setFilesError,
  setSelectedPath
}: UseEditorFileActionsOptions) {
  const stageFileFromMenu = () => {
    const path = fileMenu?.path
    const change = contextMenuChange
    setFileMenu(null)
    if (!path || !change || !currentRepoPath || !api) return
    void runSnapshotAction('File staged.', () => api.stageFile({ repoPath: currentRepoPath, filePath: path }))
  }

  const unstageFileFromMenu = () => {
    const path = fileMenu?.path
    const change = contextMenuChange
    setFileMenu(null)
    if (!path || !change || !currentRepoPath || !api) return
    void runSnapshotAction('File unstaged.', () => api.unstageFile({ repoPath: currentRepoPath, filePath: path }))
  }

  const openInEditorFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openInEditor({ targetPath: buildRepoFilePath(currentRepoPath, path) }).then((result) => {
      setNotice(result.ok ? result.data.message || 'File opened in editor.' : result.error.message)
    })
  }

  const openTerminalFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openTerminal(buildRepoFileDirectory(currentRepoPath, path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Terminal opened.' : result.error.message)
    })
  }

  const showInFileManagerFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.showItemInFolder(buildRepoFilePath(currentRepoPath, path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Shown in file manager.' : result.error.message)
    })
  }

  const copyPathFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath) return
    void navigator.clipboard.writeText(buildRepoFilePath(currentRepoPath, path))
  }

  const copyNameFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path) return
    void navigator.clipboard.writeText(path.split('/').pop() ?? path)
  }

  const reloadEditorFiles = async (preferredPath?: string) => {
    if (!api || !currentRepoPath) return []
    setFilesLoading(true)
    setFilesError(null)
    try {
      const result = await api.listRepositoryFiles(currentRepoPath)
      setFilesLoading(false)
      if (!result.ok) {
        const message = friendlyIpcErrorMessage(result.error.message, 'Failed to load repository files.')
        setFilesError(message)
        setNotice(message)
        return []
      }

      setFiles(result.data)
      setSelectedPath((current) => {
        if (preferredPath && result.data.some((file) => file.path === preferredPath)) return preferredPath
        if (current && result.data.some((file) => file.path === current)) return current
        return result.data[0]?.path || ''
      })
      return result.data
    } catch (error) {
      setFilesLoading(false)
      const message = friendlyIpcErrorMessage(error instanceof Error ? error.message : '', 'Failed to load repository files.')
      setFilesError(message)
      setNotice(message)
      return []
    }
  }

  const renameFileFromMenu = async () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    if (path === selectedPath && dirty) {
      const confirmed = await requestConfirmation('Rename this file and discard unsaved editor edits?', {
        title: 'Rename File',
        confirmLabel: 'Rename file',
        variant: 'danger'
      })
      if (!confirmed) return
    }

    const nextPath = window.prompt('Rename file inside this repository:', path)?.trim().replace(/\\/g, '/')
    if (!nextPath || nextPath === path) return

    const result = await runSnapshotAction('File renamed.', () => api.renameRepositoryFile({
      repoPath: currentRepoPath,
      filePath: path,
      newFilePath: nextPath
    }))
    if (result !== false) {
      await reloadEditorFiles(nextPath)
    }
  }

  const deleteFileFromMenu = async () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    const dirtyWarning = path === selectedPath && dirty ? ' Unsaved editor edits will be discarded.' : ''
    const confirmed = await requestConfirmation(`Delete ${path}?${dirtyWarning}`, {
      title: 'Delete File',
      confirmLabel: 'Delete file',
      variant: 'danger'
    })
    if (!confirmed) return

    const result = await runSnapshotAction('File deleted.', () => api.deleteRepositoryFile({
      repoPath: currentRepoPath,
      filePath: path,
      confirmed: true
    }))
    if (result !== false) {
      await reloadEditorFiles()
    }
  }

  return {
    stageFileFromMenu,
    unstageFileFromMenu,
    openInEditorFromMenu,
    openTerminalFromMenu,
    showInFileManagerFromMenu,
    copyPathFromMenu,
    copyNameFromMenu,
    reloadEditorFiles,
    renameFileFromMenu,
    deleteFileFromMenu
  }
}
