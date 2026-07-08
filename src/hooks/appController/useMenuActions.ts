import { useEffect, useRef } from 'react'
import type { ApiResult, BranchPilotApi, RepositorySnapshot } from '../../shared/branchPilot'
import type { ViewMode } from '../../lib/viewMode'

/** Native application menu (GitHub-Desktop-style) dispatches actions here. */
export function useMenuActions({
  api,
  currentRepoPath,
  canFetch,
  canPull,
  canPush,
  setViewMode,
  runSnapshotAction,
  chooseRepository,
  openCloneDialog,
  refreshRepository,
  openRepoInEditor,
  openRepositoryTerminal
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  canFetch: boolean
  canPull: boolean
  canPush: boolean
  setViewMode: (mode: ViewMode) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  chooseRepository: () => void | Promise<void>
  openCloneDialog: () => void
  refreshRepository: () => void | Promise<void>
  openRepoInEditor: () => void | Promise<void>
  openRepositoryTerminal: () => void | Promise<void>
}) {
  const menuActionRef = useRef<(action: string) => void>(() => {})
  const handleMenuAction = (action: string) => {
    switch (action) {
      case 'open-repository':
        void chooseRepository()
        break
      case 'clone-repository':
        openCloneDialog()
        break
      case 'refresh': void refreshRepository(); break
      case 'open-in-editor': void openRepoInEditor(); break
      case 'open-in-terminal': void openRepositoryTerminal(); break
      case 'fetch': if (currentRepoPath && canFetch) void runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath)); break
      case 'pull': if (currentRepoPath && canPull) void runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath)); break
      case 'push': if (currentRepoPath && canPush) void runSnapshotAction('Push complete.', () => api!.push(currentRepoPath)); break
      case 'view-changes': setViewMode('changes'); break
      case 'view-history': setViewMode('history'); break
      case 'view-dashboard': setViewMode('dashboard'); break
      case 'new-branch':
      case 'view-branches': setViewMode('branches'); break
      case 'view-merge': setViewMode('merge'); break
      case 'view-review': setViewMode('review'); break
      case 'view-providers': setViewMode('providers'); break
      case 'view-daily': setViewMode('daily'); break
      case 'view-linkedin': setViewMode('linkedin'); break
      case 'view-config': setViewMode('config'); break
    }
  }

  useEffect(() => {
    menuActionRef.current = handleMenuAction
  })

  useEffect(() => {
    if (!api?.onMenuAction) return
    return api.onMenuAction((action) => menuActionRef.current(action))
  }, [])
}
