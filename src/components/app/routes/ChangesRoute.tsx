import type { Dispatch, SetStateAction } from 'react'
import { ChangesView } from '../../views/ChangesView'
import { ReviewView } from '../../views/ReviewView'
import { StashView } from '../../views/StashView'
import { ToolModal } from '../../ToolModal'
import { useController } from '../../../hooks/AppControllerContext'
import { CHANGE_LIST_ITEM_HEIGHT } from '../../../lib/listMetrics'
import type { ChangesTool } from '../changesTool'
import { AssistantPolicyPanelHost } from '../hosts/AssistantPolicyPanelHost'

const api = window.branchPilot

interface ChangesRouteProps {
  changesTool: ChangesTool
  setChangesTool: Dispatch<SetStateAction<ChangesTool>>
}

export function ChangesRoute({ changesTool, setChangesTool }: ChangesRouteProps) {
  const {
    snapshot,
    counts,
    busy,
    operationLabel,
    changeFilter,
    setChangeFilter,
    changeSearchMode,
    setChangeSearchMode,
    changeContentIndexing,
    filteredChanges,
    virtualChanges,
    changesActionsMenuRef,
    closeChangesActionsMenu,
    createQuickStash,
    canCreateStash,
    exportPatch,
    applyPatch,
    bulkStageToggleState,
    stagingPendingPaths,
    bulkStagingPending,
    bulkStageOptimisticChecked,
    stageOptimistic,
    toggleBulkStage,
    toggleChangeStage,
    selectedFilePath,
    setSelectedFilePath,
    setDiffMode,
    setViewMode,
    commitTitle,
    setCommitTitle,
    commitDescription,
    setCommitDescription,
    commitCoAuthors,
    setCommitCoAuthors,
    gitConfig,
    localUserName,
    setLocalUserName,
    localUserEmail,
    setLocalUserEmail,
    githubAccounts,
    githubCliStatus,
    assistantPolicy,
    selectedAssistant,
    setNotice,
    requestConfirmation,
    generateCommitText,
    canGenerateCommitText,
    commitActionState,
    commitAndPushActionState,
    amendCommitActionState,
    commitChanges,
    amendLastCommit,
    currentRepoPath,
    runSnapshotAction,
    selectedChange,
    selectedDiffStats,
    selectedRelatedDiffStats,
    discardSelected,
    diffMode,
    diffDisplayMode,
    setDiffDisplayMode,
    diffIgnoreWhitespace,
    setDiffIgnoreWhitespace,
    diffExpanded,
    setDiffExpanded,
    diff,
    diffLoading,
    relatedDiff,
    imagePreview,
    stageSelectedHunk,
    unstageSelectedHunk,
    discardSelectedHunk,
    discardSelectedLines,
    loadStashes,
    stashMessage,
    setStashMessage,
    defaultStashMessage,
    createStash,
    stashes,
    applyStash,
    dropStash,
    reviewReport,
    canRunAssistantReview,
    runReviewReport,
    reviewMode,
    setReviewMode,
    reviewScope,
    setReviewScope,
    setSelectedAssistant,
    assistants,
    assistantsChecking,
    checkAssistants
  } = useController()

  return (
    <>
      <ChangesView
        onOpenReview={() => setChangesTool('review')}
        onOpenStash={() => {
          setChangesTool('stash')
          void loadStashes()
        }}
        stashCount={stashes.length}
        snapshot={snapshot}
        counts={counts}
        busy={busy}
        operationLabel={operationLabel}
        changeFilter={changeFilter}
        setChangeFilter={setChangeFilter}
        changeSearchMode={changeSearchMode}
        setChangeSearchMode={setChangeSearchMode}
        changeContentIndexing={changeContentIndexing}
        filteredChanges={filteredChanges}
        virtualChanges={virtualChanges}
        changesActionsMenuRef={changesActionsMenuRef}
        closeChangesActionsMenu={closeChangesActionsMenu}
        createQuickStash={createQuickStash}
        canCreateStash={canCreateStash}
        exportPatch={exportPatch}
        applyPatch={applyPatch}
        bulkStageToggleState={bulkStageToggleState}
        stagingPendingPaths={stagingPendingPaths}
        bulkStagingPending={bulkStagingPending}
        bulkStageOptimisticChecked={bulkStageOptimisticChecked}
        stageOptimistic={stageOptimistic}
        toggleBulkStage={toggleBulkStage}
        toggleChangeStage={toggleChangeStage}
        selectedFilePath={selectedFilePath}
        setSelectedFilePath={setSelectedFilePath}
        setDiffMode={setDiffMode}
        setViewMode={setViewMode}
        commitTitle={commitTitle}
        setCommitTitle={setCommitTitle}
        commitDescription={commitDescription}
        setCommitDescription={setCommitDescription}
        commitCoAuthors={commitCoAuthors}
        setCommitCoAuthors={setCommitCoAuthors}
        gitConfig={gitConfig}
        localUserName={localUserName}
        setLocalUserName={setLocalUserName}
        localUserEmail={localUserEmail}
        setLocalUserEmail={setLocalUserEmail}
        githubAccounts={githubAccounts}
        githubCliStatus={githubCliStatus}
        assistantPolicy={assistantPolicy}
        selectedAssistant={selectedAssistant}
        setNotice={setNotice}
        requestConfirmation={requestConfirmation}
        generateCommitText={generateCommitText}
        canGenerateCommitText={canGenerateCommitText}
        commitActionState={commitActionState}
        commitAndPushActionState={commitAndPushActionState}
        amendCommitActionState={amendCommitActionState}
        commitChanges={commitChanges}
        amendLastCommit={amendLastCommit}
        currentRepoPath={currentRepoPath}
        runSnapshotAction={runSnapshotAction}
        api={api}
        selectedChange={selectedChange}
        selectedDiffStats={selectedDiffStats}
        selectedRelatedDiffStats={selectedRelatedDiffStats}
        discardSelected={discardSelected}
        diffMode={diffMode}
        diffDisplayMode={diffDisplayMode}
        setDiffDisplayMode={setDiffDisplayMode}
        diffIgnoreWhitespace={diffIgnoreWhitespace}
        setDiffIgnoreWhitespace={setDiffIgnoreWhitespace}
        diffExpanded={diffExpanded}
        setDiffExpanded={setDiffExpanded}
        diff={diff}
        diffLoading={diffLoading}
        relatedDiff={relatedDiff}
        imagePreview={imagePreview}
        stageSelectedHunk={stageSelectedHunk}
        unstageSelectedHunk={unstageSelectedHunk}
        discardSelectedHunk={discardSelectedHunk}
        discardSelectedLines={discardSelectedLines}
        itemHeight={CHANGE_LIST_ITEM_HEIGHT}
      />
      {changesTool === 'stash' && (
        <ToolModal title="Stashes" onClose={() => setChangesTool(null)}>
          <StashView
            loadStashes={loadStashes}
            busy={busy}
            stashMessage={stashMessage}
            setStashMessage={setStashMessage}
            defaultStashMessage={defaultStashMessage}
            createStash={createStash}
            canCreateStash={canCreateStash}
            stashes={stashes}
            applyStash={applyStash}
            dropStash={dropStash}
          />
        </ToolModal>
      )}
      {changesTool === 'review' && (
        <ToolModal title="Review" className="review-modal" onClose={() => setChangesTool(null)}>
          <ReviewView
            reviewReport={reviewReport}
            snapshot={snapshot}
            busy={busy}
            canRunAssistantReview={canRunAssistantReview}
            runReviewReport={runReviewReport}
            reviewMode={reviewMode}
            setReviewMode={setReviewMode}
            reviewScope={reviewScope}
            setReviewScope={setReviewScope}
            selectedAssistant={selectedAssistant}
            setSelectedAssistant={setSelectedAssistant}
            assistantPolicy={assistantPolicy}
            assistants={assistants}
            assistantsChecking={assistantsChecking}
            checkAssistants={checkAssistants}
            selectedFilePath={selectedFilePath}
            renderAssistantPolicyPanel={() => <AssistantPolicyPanelHost />}
          />
        </ToolModal>
      )}
    </>
  )
}
