import { useState } from 'react'
import { CreateBranchDialog, MergeBranchDialog, SwitchBranchDialog } from './Dialogs'
import { BranchPilotLogo } from './BrandIcons'
import { useController } from '../hooks/AppControllerContext'
import { mergeBranchCandidates } from '../lib/mergeCandidates'
import { useShellMenus } from './shell/useShellMenus'
import { ShellRepositoryMenu } from './shell/ShellRepositoryMenu'
import { ShellBranchMenu } from './shell/ShellBranchMenu'
import { ShellSyncControls } from './shell/ShellSyncControls'
import { ShellToolbar } from './shell/ShellToolbar'

/** GitHub-Desktop-style top bar: repository + branch pickers, sync actions, and view tabs. */
export function AppShellBar({
  onOpenClone,
  onOpenPublishRepository
}: {
  onOpenClone: () => void
  onOpenPublishRepository: () => void
}) {
  const {
    snapshot, busy, currentRepoPath,
    allReposMode, runSnapshotAction
  } = useController()
  const api = window.branchPilot
  const branches = snapshot?.branches ?? []
  const remoteBranches = snapshot?.remoteBranches ?? []
  const mergeCandidates = mergeBranchCandidates(snapshot)
  const currentBranch = snapshot?.summary.currentBranch ?? null
  const [showCreateBranch, setShowCreateBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchBaseRef, setNewBranchBaseRef] = useState('')
  const [createBranchStep, setCreateBranchStep] = useState<'name' | 'options'>('name')
  const [createBranchChangesMode, setCreateBranchChangesMode] = useState<'move' | 'leave'>('move')
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
  const [showMergeInto, setShowMergeInto] = useState(false)
  const {
    headerRef, branchAction, branchActionValue, setBranchActionValue,
    branchMenuOpen, startBranchAction, cancelBranchAction, handleToggle, closeMenu
  } = useShellMenus()
  const hasChanges = (snapshot?.status.counts.changed ?? 0) > 0

  const confirmBranchAction = () => {
    if (!branchAction || !currentRepoPath) return
    const { name, mode } = branchAction
    const value = branchActionValue.trim()
    if (mode === 'rename') {
      if (!value || value === name) return cancelBranchAction()
      void runSnapshotAction('Branch renamed.', () => api!.renameBranch({ repoPath: currentRepoPath, oldBranchName: name, newBranchName: value }))
    } else if (mode === 'describe') {
      void runSnapshotAction('Branch description updated.', () => api!.updateBranchDescription({ repoPath: currentRepoPath, branchName: name, description: value }))
    } else if (mode === 'delete') {
      void runSnapshotAction('Branch deleted.', () => api!.deleteBranch({ repoPath: currentRepoPath, branchName: name, confirmed: true, force: false }))
    }
    cancelBranchAction()
  }

  const mergeIntoBranch = (branchName: string) => {
    if (!currentRepoPath) return
    setShowMergeInto(false)
    void runSnapshotAction('Merge complete.', () => api!.mergeBranch({ repoPath: currentRepoPath, branchName }))
  }

  const openCreateBranch = () => {
    setNewBranchName('')
    setNewBranchBaseRef(currentBranch ?? 'HEAD')
    setCreateBranchStep('name')
    setCreateBranchChangesMode('move')
    setShowCreateBranch(true)
  }

  const cancelCreateBranch = () => {
    setShowCreateBranch(false)
    setNewBranchName('')
    setNewBranchBaseRef('')
    setCreateBranchStep('name')
    setCreateBranchChangesMode('move')
  }

  const submitCreateBranch = async () => {
    const branchName = newBranchName.trim()
    if (!branchName || !currentRepoPath) return
    const created = await runSnapshotAction('Branch created.', () => api!.createBranch({
      repoPath: currentRepoPath,
      branchName,
      baseRef: newBranchBaseRef.trim() || undefined,
      checkout: !hasChanges || createBranchChangesMode === 'move',
      description: ''
    }))
    if (created) {
      cancelCreateBranch()
    }
  }

  const switchBranch = (branchName: string) => {
    if (!currentRepoPath || branchName === currentBranch) return
    if (hasChanges) {
      setPendingSwitch(branchName)
      return
    }
    void runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName }))
  }

  const confirmSwitch = (stashChanges: boolean) => {
    const branchName = pendingSwitch
    if (!branchName || !currentRepoPath) return
    setPendingSwitch(null)
    void runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName, stashChanges }))
  }

  return (
    <>
    <header className="shell-bar" ref={headerRef}>
      <div className="shell-bar-row">
        <span className="shell-brand" title="BranchPilot" aria-label="BranchPilot">
          <BranchPilotLogo size={24} />
        </span>
        <div className="shell-segments">
        <ShellRepositoryMenu onOpenClone={onOpenClone} handleToggle={handleToggle} closeMenu={closeMenu} />

        {!allReposMode && (
        <>
        <ShellBranchMenu
          branchMenuOpen={branchMenuOpen}
          branchAction={branchAction}
          branchActionValue={branchActionValue}
          setBranchActionValue={setBranchActionValue}
          startBranchAction={startBranchAction}
          cancelBranchAction={cancelBranchAction}
          confirmBranchAction={confirmBranchAction}
          openCreateBranch={openCreateBranch}
          switchBranch={switchBranch}
          mergeCandidates={mergeCandidates}
          onOpenMergeInto={() => setShowMergeInto(true)}
          handleToggle={handleToggle}
          closeMenu={closeMenu}
        />

        <ShellSyncControls onOpenPublishRepository={onOpenPublishRepository} handleToggle={handleToggle} closeMenu={closeMenu} />
        </>
        )}
        </div>

        <ShellToolbar handleToggle={handleToggle} closeMenu={closeMenu} />
      </div>
    </header>
    {showCreateBranch && (
      <CreateBranchDialog
        baseBranch={currentBranch}
        branches={branches}
        remoteBranches={remoteBranches}
        value={newBranchName}
        step={createBranchStep}
        baseRef={newBranchBaseRef}
        changesMode={createBranchChangesMode}
        hasChanges={hasChanges}
        changeCount={snapshot?.status.counts.changed ?? 0}
        busy={busy}
        onChange={setNewBranchName}
        onBaseRefChange={setNewBranchBaseRef}
        onChangesModeChange={setCreateBranchChangesMode}
        onBack={() => setCreateBranchStep('name')}
        onNext={() => setCreateBranchStep('options')}
        onCancel={cancelCreateBranch}
        onCreate={submitCreateBranch}
      />
    )}
    {pendingSwitch && (
      <SwitchBranchDialog
        fromBranch={currentBranch ?? 'current branch'}
        toBranch={pendingSwitch}
        busy={busy}
        onCancel={() => setPendingSwitch(null)}
        onSwitch={confirmSwitch}
      />
    )}
    {showMergeInto && (
      <MergeBranchDialog
        currentBranch={currentBranch ?? 'current branch'}
        branches={mergeCandidates}
        busy={busy}
        onCancel={() => setShowMergeInto(false)}
        onMerge={mergeIntoBranch}
      />
    )}
    </>
  )
}
