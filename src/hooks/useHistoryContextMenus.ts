import { useEffect, useState } from 'react'
import type { BranchPilotApi, CommitSummary } from '../shared/branchPilot'

type CommitOperationKind = 'revert' | 'cherry-pick' | 'reset' | 'reset-hard'

interface UseHistoryContextMenusOptions {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  setSelectedCommitSha: (sha: string) => void
  applyCommitOperation: (kind: CommitOperationKind, commitSha?: string) => void | Promise<void>
}

export function useHistoryContextMenus({
  api,
  currentRepoPath,
  setSelectedCommitSha,
  applyCommitOperation
}: UseHistoryContextMenusOptions) {
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [commitMenu, setCommitMenu] = useState<{ x: number; y: number; commit: CommitSummary } | null>(null)

  useEffect(() => {
    if (!fileMenu && !commitMenu) return

    const close = () => {
      setFileMenu(null)
      setCommitMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [fileMenu, commitMenu])

  const openInEditorFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath || !api) return
    void api.openInEditor({ targetPath: `${currentRepoPath}/${path}` })
  }

  const copyPathFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path || !currentRepoPath) return
    void navigator.clipboard.writeText(`${currentRepoPath}/${path}`)
  }

  const copyNameFromMenu = () => {
    const path = fileMenu?.path
    setFileMenu(null)
    if (!path) return
    void navigator.clipboard.writeText(path.split('/').pop() ?? path)
  }

  const copyCommitShaFromMenu = () => {
    const commit = commitMenu?.commit
    setCommitMenu(null)
    if (!commit) return
    void navigator.clipboard.writeText(commit.sha)
  }

  const copyCommitSubjectFromMenu = () => {
    const commit = commitMenu?.commit
    setCommitMenu(null)
    if (!commit) return
    void navigator.clipboard.writeText(commit.subject || commit.sha)
  }

  const applyCommitOperationFromMenu = (kind: CommitOperationKind) => {
    const commit = commitMenu?.commit
    setCommitMenu(null)
    if (!commit) return
    setSelectedCommitSha(commit.sha)
    void applyCommitOperation(kind, commit.sha)
  }

  return {
    fileMenu,
    setFileMenu,
    commitMenu,
    setCommitMenu,
    openInEditorFromMenu,
    copyPathFromMenu,
    copyNameFromMenu,
    copyCommitShaFromMenu,
    copyCommitSubjectFromMenu,
    applyCommitOperationFromMenu
  }
}
