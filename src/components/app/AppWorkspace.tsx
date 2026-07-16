import type { Dispatch, SetStateAction } from 'react'
import { ConflictBanner } from '../ConflictBanner'
import { EmptyState, RepositoryLoadingState } from '../EmptyState'
import { useController } from '../../hooks/AppControllerContext'
import { MainViewRouter } from './MainViewRouter'
import type { ChangesTool } from './changesTool'

const api = window.branchPilot

interface AppWorkspaceProps {
  changesTool: ChangesTool
  setChangesTool: Dispatch<SetStateAction<ChangesTool>>
  showRepositoryLoading: boolean
  onOpenPublishRepository: () => void
}

export function AppWorkspace({
  changesTool,
  setChangesTool,
  showRepositoryLoading,
  onOpenPublishRepository
}: AppWorkspaceProps) {
  const {
    snapshot,
    viewMode,
    setViewMode,
    allReposMode,
    busy,
    operationLabel,
    counts,
    abortCurrentOperation,
    chooseRepository,
    cloneRemoteUrl,
    setCloneRemoteUrl,
    cloneTargetName,
    setCloneTargetName,
    cloneRepository
  } = useController()

  return (
    <section className="workspace">
      {snapshot && snapshot.status.merge.operation !== 'none' && viewMode !== 'merge' && (
        <ConflictBanner
          operation={snapshot.status.merge.operation}
          conflictedCount={counts?.conflicted ?? 0}
          busy={busy}
          onResolve={() => setViewMode('merge')}
          onAbort={abortCurrentOperation}
        />
      )}
      {!showRepositoryLoading && !snapshot && !allReposMode && busy ? (
        <RepositoryLoadingState operationLabel={operationLabel} />
      ) : !snapshot && !allReposMode ? (
        <EmptyState
          apiReady={Boolean(api)}
          busy={busy}
          chooseRepository={chooseRepository}
          cloneRemoteUrl={cloneRemoteUrl}
          setCloneRemoteUrl={setCloneRemoteUrl}
          cloneTargetName={cloneTargetName}
          setCloneTargetName={setCloneTargetName}
          cloneRepository={cloneRepository}
        />
      ) : (
        <MainViewRouter
          changesTool={changesTool}
          setChangesTool={setChangesTool}
          onOpenPublishRepository={onOpenPublishRepository}
        />
      )}
    </section>
  )
}
