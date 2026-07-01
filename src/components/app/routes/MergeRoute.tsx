import { MergeView } from '../../views/MergeView'
import { useController } from '../../../hooks/AppControllerContext'

const api = window.branchPilot

export function MergeRoute() {
  const {
    snapshot,
    busy,
    selectedMergeBranch,
    setSelectedMergeBranch,
    startMergeOperation,
    continueMergeOperation,
    abortCurrentOperation,
    createQuickStash,
    canCreateStash,
    acceptConflictSide,
    runOperationAction,
    runSnapshotAction,
    currentRepoPath
  } = useController()

  return (
    <MergeView
      snapshot={snapshot}
      busy={busy}
      selectedMergeBranch={selectedMergeBranch}
      setSelectedMergeBranch={setSelectedMergeBranch}
      startMergeOperation={startMergeOperation}
      continueMergeOperation={continueMergeOperation}
      abortCurrentOperation={abortCurrentOperation}
      createQuickStash={createQuickStash}
      canCreateStash={canCreateStash}
      acceptConflictSide={acceptConflictSide}
      runOperationAction={runOperationAction}
      runSnapshotAction={runSnapshotAction}
      api={api}
      currentRepoPath={currentRepoPath}
    />
  )
}
