import { BranchesView } from '../../views/BranchesView'
import { useController } from '../../../hooks/AppControllerContext'

const api = window.branchPilot

export function BranchesRoute() {
  const {
    snapshot,
    currentRepoPath,
    busy,
    branchFilter,
    setBranchFilter,
    tagFilter,
    setTagFilter,
    branchDraftGoal,
    setBranchDraftGoal,
    newBranchName,
    setNewBranchName,
    newBranchDescription,
    setNewBranchDescription,
    assistantPolicy,
    canGenerateBranchDraft,
    branchDraftActionState,
    createBranchActionState,
    generateBranchDraft,
    createBranch,
    editingBranchName,
    branchDescriptionDraft,
    setBranchDescriptionDraft,
    branchDescriptionGenerating,
    startBranchDescriptionEdit,
    cancelBranchDescriptionEdit,
    saveBranchDescription,
    generateBranchDescription,
    renameBranch,
    setBranchUpstream,
    compareBranch,
    deleteBranch,
    branchComparison,
    branchComparisonLoading,
    newWorktreeBranchName,
    setNewWorktreeBranchName,
    newWorktreeBaseRef,
    setNewWorktreeBaseRef,
    createWorktree,
    openWorktree,
    removeWorktree,
    newTagName,
    setNewTagName,
    newTagMessage,
    setNewTagMessage,
    createTag,
    deleteTag,
    runSnapshotAction,
    runOperationAction
  } = useController()

  if (!snapshot) return null

  return (
    <BranchesView
      branches={snapshot.branches}
      remoteBranches={snapshot.remoteBranches ?? []}
      tags={snapshot.tags}
      worktrees={snapshot.worktrees}
      snapshot={snapshot}
      api={api}
      currentRepoPath={currentRepoPath}
      busy={busy}
      branchFilter={branchFilter}
      setBranchFilter={setBranchFilter}
      tagFilter={tagFilter}
      setTagFilter={setTagFilter}
      branchDraftGoal={branchDraftGoal}
      setBranchDraftGoal={setBranchDraftGoal}
      newBranchName={newBranchName}
      setNewBranchName={setNewBranchName}
      newBranchDescription={newBranchDescription}
      setNewBranchDescription={setNewBranchDescription}
      assistantPolicy={assistantPolicy}
      canGenerateBranchDraft={canGenerateBranchDraft}
      branchDraftActionState={branchDraftActionState}
      createBranchActionState={createBranchActionState}
      generateBranchDraft={generateBranchDraft}
      createBranch={createBranch}
      editingBranchName={editingBranchName}
      branchDescriptionDraft={branchDescriptionDraft}
      setBranchDescriptionDraft={setBranchDescriptionDraft}
      branchDescriptionGenerating={branchDescriptionGenerating}
      startBranchDescriptionEdit={startBranchDescriptionEdit}
      cancelBranchDescriptionEdit={cancelBranchDescriptionEdit}
      saveBranchDescription={saveBranchDescription}
      generateBranchDescription={generateBranchDescription}
      renameBranch={renameBranch}
      setBranchUpstream={setBranchUpstream}
      compareBranch={compareBranch}
      deleteBranch={deleteBranch}
      branchComparison={branchComparison}
      branchComparisonLoading={branchComparisonLoading}
      newWorktreeBranchName={newWorktreeBranchName}
      setNewWorktreeBranchName={setNewWorktreeBranchName}
      newWorktreeBaseRef={newWorktreeBaseRef}
      setNewWorktreeBaseRef={setNewWorktreeBaseRef}
      createWorktree={createWorktree}
      openWorktree={openWorktree}
      removeWorktree={removeWorktree}
      newTagName={newTagName}
      setNewTagName={setNewTagName}
      newTagMessage={newTagMessage}
      setNewTagMessage={setNewTagMessage}
      createTag={createTag}
      deleteTag={deleteTag}
      runSnapshotAction={runSnapshotAction}
      runOperationAction={runOperationAction}
    />
  )
}
