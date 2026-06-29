import { CalendarDays } from 'lucide-react'
import { AssistantPolicyPanel } from './components/AssistantPanels'
import { ConfirmationDialog, TextPromptDialog } from './components/Dialogs'
import { LinkedinIcon } from './components/BrandIcons'
import { useEffect, useState } from 'react'
import { AboutBranchPilotModal } from './components/AboutBranchPilotModal'
import { AppShellBar } from './components/AppShellBar'
import { BackToChanges } from './components/BackToChanges'
import { ToolModal } from './components/ToolModal'
import { Toaster } from './components/Toaster'
import { GlobalTooltip } from './components/GlobalTooltip'
import { ConflictBanner } from './components/ConflictBanner'
import { EmptyState, RepositoryLoadingState } from './components/EmptyState'
import { GitHubRepositoryBrowser, PullRequestDetailsPanel } from './components/ProvidersPanels'
import { assistantPolicyModes, editorPreferences, terminalPreferences } from './lib/appOptions'
import { CHANGE_LIST_ITEM_HEIGHT, HISTORY_LIST_ITEM_HEIGHT } from './lib/listMetrics'
import { DailyView, ReportScopeMenu } from './components/views/DailyView'
import { StashView } from './components/views/StashView'
import { MergeView } from './components/views/MergeView'
import { HistoryView } from './components/views/HistoryView'
import { ReviewView } from './components/views/ReviewView'
import { DashboardView } from './components/views/DashboardView'
import { LinkedInView } from './components/views/LinkedInView'
import { ConfigView } from './components/views/ConfigView'
import { ChangesView } from './components/views/ChangesView'
import { BranchesView } from './components/views/BranchesView'
import { ProvidersView } from './components/views/ProvidersView'
import { PublishRepositoryView } from './components/views/PublishRepositoryView'
import { RepositoryPickerModal } from './components/RepositoryPickerModal'
import './App.css'
import { useAppController } from './hooks/useAppController'
import { AppControllerProvider } from './hooks/AppControllerContext'

const api = window.branchPilot

function App() {
  const controller = useAppController()
  const {
    snapshot, viewMode, setViewMode, allReposMode, busy, operationLabel, notice, setNotice, error, setError, selectedAssistant, setSelectedAssistant, confirmationRequest, textPromptRequest, textPromptValue, setTextPromptValue, answerConfirmation, answerTextPrompt, currentRepoPath, assistants, assistantsChecking, assistantPolicy, assistantPolicyLoading, checkAssistants, updateAssistantPolicy, newBranchName, setNewBranchName, newBranchDescription, setNewBranchDescription, branchDraftGoal, setBranchDraftGoal, branchFilter, setBranchFilter, newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef, tagFilter, setTagFilter, newTagName, setNewTagName, newTagMessage, setNewTagMessage, editingBranchName, branchDescriptionDraft, setBranchDescriptionDraft, branchDescriptionGenerating, branchComparison, branchComparisonLoading, canGenerateBranchDraft, branchDraftActionState, createBranchActionState, generateBranchDraft, createBranch, deleteBranch, renameBranch, setBranchUpstream, compareBranch, createTag, deleteTag, createWorktree, openWorktree, removeWorktree, startBranchDescriptionEdit, cancelBranchDescriptionEdit, saveBranchDescription, generateBranchDescription, history, historyLoading, historyFilter, setHistoryFilter, historySearchMode, setHistorySearchMode, historyFileIndexing, selectedCommitSha, setSelectedCommitSha, commitDetails, commitDetailsLoading, selectedCommitFilePath, commitFileDiff, commitFileDiffLoading, filteredHistory, virtualHistory, loadCommitFileDiff, providers, githubCliStatus, githubAccounts, githubAccountsLoading, githubRepositories, githubRepoOwner, setGithubRepoOwner, githubRepoQuery, setGithubRepoQuery, githubRepoVisibility, setGithubRepoVisibility, githubRepoLimit, githubRepoLoading, currentPullRequest, pullRequests, pullRequestsLoading, selectedPullRequestNumber, selectedPullRequestDetails, selectedPullRequestChecks, selectedPullRequestDiff, selectedPullRequestFilePath, setSelectedPullRequestFilePath, pullRequestDetailsLoading, prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, createdPullRequest, canPublishBranch, canGeneratePullRequestText, selectedPullRequestDiffResult, loadGitHubPullRequests, loadPullRequestDetails, loadGitHubAccounts, loadGitHubRepositories, cloneGitHubRepository, refreshProvidersPanel, generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest, recentRepositories, repositoryDashboard, contributionGraph, repositoryRhythm, dashboardLoading, dashboardRepositoryFilter, setDashboardRepositoryFilter, repositoryPickerOpen, setRepositoryPickerOpen, cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName, loadRepositoryDashboard, chooseRepository, openRepository, initializeRepository, cloneRepository, dailyReview, dailyReviewDate, setDailyReviewDate, dailyReviewLoading, contributorStats, runDailyReview, copyDailyReviewMarkdown, counts, selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter, changeSearchMode, setChangeSearchMode, changeContentIndexing, diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace, diffExpanded, setDiffExpanded, diff, relatedDiff, imagePreview, changesActionsMenuRef, filteredChanges, selectedChange, selectedDiffStats, selectedRelatedDiffStats, virtualChanges, bulkStageToggleState, stagingPendingPaths, bulkStagingPending, bulkStageOptimisticChecked, closeChangesActionsMenu, toggleChangeStage, toggleBulkStage, stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelected, exportPatch, applyPatch, selectedMergeBranch, setSelectedMergeBranch, startMergeOperation, continueMergeOperation, abortCurrentOperation, acceptConflictSide, reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport, canRunAssistantReview, runReviewReport, commitTitle, setCommitTitle, commitDescription, setCommitDescription, commitCoAuthors, setCommitCoAuthors, canGenerateCommitText, commitActionState, commitAndPushActionState, amendCommitActionState, commitChanges, amendLastCommit, generateCommitText, canCreateStash, stashMessage, setStashMessage, stashes, loadStashes, defaultStashMessage, createStash, createQuickStash, applyStash, dropStash, canGenerateLinkedInProject, linkedinProject, linkedinSkillsText, setLinkedinSkillsText, linkedinLoading, generateLinkedInProject, updateLinkedInProject, openExternalLink, runSnapshotAction, runOperationAction, applySnapshot, applyCommitOperation
  } = controller
  const {
    appVersion, connectGitHub, contributorWindow, setContributorWindow, selectedReportRepoPaths, updateReportRepoPaths, discardSelectedLines,
    gitConfig, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
    linkedinHighlightsText, setLinkedinHighlightsText, linkedinTagsText, setLinkedinTagsText,
    linkedinRole, setLinkedInRole, linkedinAudience, setLinkedInAudience,
    linkedinProjectUrl, setLinkedInProjectUrl, linkedinCustomPrompt, setLinkedInCustomPrompt,
    resetLinkedInPrompt, copyLinkedInMarkdown, copyLinkedInTags
  } = controller

  const [changesTool, setChangesTool] = useState<'review' | 'stash' | null>(null)
  const [showClone, setShowClone] = useState(false)
  const [showPublishRepository, setShowPublishRepository] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const showRepositoryLoading = busy && isRepositoryTransitionOperation(operationLabel)

  useEffect(() => {
    if (!api?.onMenuAction) return
    return api.onMenuAction((action) => {
      if (action === 'show-about') setShowAbout(true)
    })
  }, [])

  // Populate the user's GitHub repositories when the Clone dialog opens.
  useEffect(() => {
    if (!showClone) return
    void loadGitHubAccounts()
    void loadGitHubRepositories()
  }, [showClone])

  // Close the Clone dialog once a repository is actually opened (clone done).
  useEffect(() => {
    if (showClone && snapshot) setShowClone(false)
  }, [snapshot?.summary.rootPath])

  // Reports hosts the contribution heatmap; (re)load its data when Reports opens
  // OR the active repository changes while Reports is open.
  useEffect(() => {
    if (viewMode === 'daily') void loadRepositoryDashboard()
  }, [viewMode, snapshot?.summary.rootPath])

  useEffect(() => {
    if (viewMode === 'review') setChangesTool('review')
  }, [viewMode])

  return (
    <AppControllerProvider value={controller}>
    <main className="app-shell">
      <AppShellBar onOpenClone={() => setShowClone(true)} onOpenPublishRepository={() => setShowPublishRepository(true)} />

      <Toaster notice={notice} busy={busy} operationLabel={operationLabel} error={error} onDismissError={() => setError(null)} />
      <GlobalTooltip />
      {showRepositoryLoading && (
        <div className="repository-transition-overlay" role="presentation">
          <RepositoryLoadingState operationLabel={operationLabel} />
        </div>
      )}

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
              apiReady={Boolean(api)} busy={busy} chooseRepository={chooseRepository}
              cloneRemoteUrl={cloneRemoteUrl} setCloneRemoteUrl={setCloneRemoteUrl}
              cloneTargetName={cloneTargetName} setCloneTargetName={setCloneTargetName}
              cloneRepository={cloneRepository}
            />
        ) : (
          <>
            {viewMode === 'dashboard' && (
              <div className="dashboard-stack">
                <DashboardView
                  repositoryDashboard={repositoryDashboard}
                  repositoryRhythm={repositoryRhythm}
                  contributorStats={contributorStats}
                  dashboardRepositoryFilter={dashboardRepositoryFilter}
                  setDashboardRepositoryFilter={setDashboardRepositoryFilter}
                  currentPullRequest={currentPullRequest}
                  githubCliStatus={githubCliStatus}
                  pullRequests={pullRequests}
                  dashboardLoading={dashboardLoading}
                  busy={busy}
                  loadRepositoryDashboard={loadRepositoryDashboard}
                  openRepository={openRepository}
                  setViewMode={setViewMode}
                  openExternalLink={openExternalLink}
                  allReposMode={allReposMode}
                />
              </div>
            )}
            {(viewMode === 'changes' || viewMode === 'review') && (
              <>
                <ChangesView
                onOpenReview={() => setChangesTool('review')}
                onOpenStash={() => { setChangesTool('stash'); void loadStashes() }}
                stashCount={stashes.length}
                snapshot={snapshot}
                counts={counts}
                busy={busy}
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
                setNotice={setNotice}
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
                      renderAssistantPolicyPanel={renderAssistantPolicyPanel}
                    />
                  </ToolModal>
                )}
              </>
            )}
            {viewMode === 'history' && (
              <HistoryView
                snapshot={snapshot}
                history={history}
                filteredHistory={filteredHistory}
                historyLoading={historyLoading}
                busy={busy}
                historyFilter={historyFilter}
                setHistoryFilter={setHistoryFilter}
                historySearchMode={historySearchMode}
                setHistorySearchMode={setHistorySearchMode}
                historyFileIndexing={historyFileIndexing}
                virtualHistory={virtualHistory}
                itemHeight={HISTORY_LIST_ITEM_HEIGHT}
                selectedCommitSha={selectedCommitSha}
                setSelectedCommitSha={setSelectedCommitSha}
                commitDetails={commitDetails}
                commitDetailsLoading={commitDetailsLoading}
                selectedCommitFilePath={selectedCommitFilePath}
                loadCommitFileDiff={loadCommitFileDiff}
                commitFileDiff={commitFileDiff}
                commitFileDiffLoading={commitFileDiffLoading}
                openExternalLink={openExternalLink}
                applyCommitOperation={applyCommitOperation}
                api={api}
                currentRepoPath={currentRepoPath}
                setViewMode={setViewMode}
                changedCount={counts?.changed ?? 0}
              />
            )}
            {viewMode === 'merge' && (
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
            )}
            {viewMode === 'branches' && snapshot && (
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
            )}
            {viewMode === 'config' && (
              <ConfigView
                onBack={() => setViewMode('changes')}
                editorPreferences={editorPreferences}
                terminalPreferences={terminalPreferences}
              />
            )}
            {viewMode === 'providers' && (
              <ProvidersView
                onBack={() => setViewMode('changes')}
                providers={providers}
                snapshot={snapshot}
                api={api}
                currentRepoPath={currentRepoPath}
                busy={busy}
                assistantPolicy={assistantPolicy}
                githubCliStatus={githubCliStatus}
                canGeneratePullRequestText={canGeneratePullRequestText}
                canPublishBranch={canPublishBranch}
                createdPullRequest={createdPullRequest}
                currentPullRequest={currentPullRequest}
                pullRequests={pullRequests}
                pullRequestsLoading={pullRequestsLoading}
                selectedPullRequestNumber={selectedPullRequestNumber}
                prTitle={prTitle}
                setPrTitle={setPrTitle}
                prDescription={prDescription}
                setPrDescription={setPrDescription}
                prBaseBranch={prBaseBranch}
                setPrBaseBranch={setPrBaseBranch}
                checkoutPullRequest={checkoutPullRequest}
                createPullRequest={createPullRequest}
                generatePullRequestText={generatePullRequestText}
                loadGitHubPullRequests={loadGitHubPullRequests}
                refreshProvidersPanel={refreshProvidersPanel}
                connectGitHub={connectGitHub}
                selectPullRequest={selectPullRequest}
                openExternalLink={openExternalLink}
                runSnapshotAction={runSnapshotAction}
                onOpenPublishRepository={() => setShowPublishRepository(true)}
                renderGitHubRepositoryBrowser={renderGitHubRepositoryBrowser}
                renderPullRequestDetailsPanel={renderPullRequestDetailsPanel}
              />
            )}
            {(viewMode === 'daily' || viewMode === 'linkedin') && (
              <div className="reports-stack">
                <div className="reports-topbar">
                <BackToChanges onClick={() => setViewMode('changes')} />
                <div className="reports-switch" role="tablist" aria-label="Reports">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'daily'}
                    className={viewMode === 'daily' ? 'active' : ''}
                    onClick={() => setViewMode('daily')}
                  >
                    <CalendarDays size={15} />
                    Daily review
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'linkedin'}
                    className={viewMode === 'linkedin' ? 'active' : ''}
                    onClick={() => setViewMode('linkedin')}
                  >
                    <LinkedinIcon size={15} />
                    LinkedIn
                  </button>
                </div>
                {viewMode === 'daily' && (
                  <div className="reports-scope-controls">
                    <ReportScopeMenu
                      snapshot={snapshot}
                      recentRepositories={recentRepositories}
                      selectedReportRepoPaths={selectedReportRepoPaths}
                      updateReportRepoPaths={updateReportRepoPaths}
                      allReposMode={allReposMode}
                      currentRepoPath={currentRepoPath}
                    />
                  </div>
                )}
                </div>
                {viewMode === 'daily' && (
                  <DailyView
                    dailyReviewDate={dailyReviewDate}
                    setDailyReviewDate={setDailyReviewDate}
                    runDailyReview={runDailyReview}
                    dailyReviewLoading={dailyReviewLoading}
                    dailyReview={dailyReview}
                    contributionGraph={contributionGraph}
                    contributorStats={contributorStats}
                    githubAccounts={githubAccounts}
                    contributorWindow={contributorWindow}
                    setContributorWindow={setContributorWindow}
                    copyDailyReviewMarkdown={copyDailyReviewMarkdown}
                    recentRepositories={recentRepositories}
                    selectedReportRepoPaths={selectedReportRepoPaths}
                    allReposMode={allReposMode}
                    currentRepoPath={currentRepoPath}
                    openExternalLink={openExternalLink}
                  />
                )}
                {viewMode === 'linkedin' && (
                  <LinkedInView
                generateLinkedInProject={generateLinkedInProject}
                snapshot={snapshot}
                busy={busy}
                linkedinLoading={linkedinLoading}
                canGenerateLinkedInProject={canGenerateLinkedInProject}
                linkedinProject={linkedinProject}
                updateLinkedInProject={updateLinkedInProject}
                linkedinHighlightsText={linkedinHighlightsText}
                setLinkedinHighlightsText={setLinkedinHighlightsText}
                linkedinTagsText={linkedinTagsText}
                setLinkedinTagsText={setLinkedinTagsText}
                linkedinSkillsText={linkedinSkillsText}
                setLinkedinSkillsText={setLinkedinSkillsText}
                linkedinRole={linkedinRole}
                setLinkedInRole={setLinkedInRole}
                linkedinAudience={linkedinAudience}
                setLinkedInAudience={setLinkedInAudience}
                linkedinProjectUrl={linkedinProjectUrl}
                setLinkedInProjectUrl={setLinkedInProjectUrl}
                linkedinCustomPrompt={linkedinCustomPrompt}
                setLinkedInCustomPrompt={setLinkedInCustomPrompt}
                resetLinkedInPrompt={resetLinkedInPrompt}
                copyLinkedInMarkdown={copyLinkedInMarkdown}
                copyLinkedInTags={copyLinkedInTags}
                  />
                )}
              </div>
            )}
          </>
        )}
      </section>
      {confirmationRequest && (
        <ConfirmationDialog request={confirmationRequest} onAnswer={answerConfirmation} />
      )}
      {textPromptRequest && (
        <TextPromptDialog request={textPromptRequest} value={textPromptValue} onChange={setTextPromptValue} onAnswer={answerTextPrompt} />
      )}
      {repositoryPickerOpen && (
        <RepositoryPickerModal
          api={api}
          busy={busy}
          currentRepoPath={currentRepoPath}
          recentRepositories={recentRepositories}
          openRepository={openRepository}
          initializeRepository={initializeRepository}
          onClose={() => setRepositoryPickerOpen(false)}
        />
      )}
      {showClone && (
        <ToolModal title="Clone repository" onClose={() => setShowClone(false)}>
          <section className="single-panel clone-modal-body">
            <form
              className="clone-url-row"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!cloneRemoteUrl.trim()) return
                await cloneRepository()
                setShowClone(false)
              }}
            >
              <input
                aria-label="Clone repository URL"
                value={cloneRemoteUrl}
                onChange={(event) => setCloneRemoteUrl(event.target.value)}
                placeholder="https://github.com/owner/repo.git"
                disabled={!api || busy}
                autoFocus
              />
              <input
                aria-label="Clone folder name"
                value={cloneTargetName}
                onChange={(event) => setCloneTargetName(event.target.value)}
                placeholder="Optional folder name"
                disabled={!api || busy}
              />
              <button type="submit" className="clone-url-button" disabled={!api || busy || !cloneRemoteUrl.trim()}>
                Clone URL
              </button>
            </form>
            <div className="clone-browse-label">Or pick one of your GitHub repositories</div>
            {renderGitHubRepositoryBrowser()}
          </section>
        </ToolModal>
      )}
      {showPublishRepository && (
        <ToolModal title="Publish repository" className="publish-modal" onClose={() => setShowPublishRepository(false)}>
          <PublishRepositoryView
            api={api}
            snapshot={snapshot}
            selectedAssistant={selectedAssistant}
            assistantPolicy={assistantPolicy}
            setNotice={setNotice}
            setError={setError}
            onClose={() => setShowPublishRepository(false)}
            onPublished={(nextSnapshot, message) => {
              applySnapshot(nextSnapshot, message)
              setViewMode('changes')
            }}
          />
        </ToolModal>
      )}
      {showAbout && (
        <AboutBranchPilotModal appVersion={appVersion} onClose={() => setShowAbout(false)} />
      )}
    </main>
    </AppControllerProvider>
  )










  function renderAssistantPolicyPanel() {
    return <AssistantPolicyPanel assistantPolicy={assistantPolicy} assistantPolicyLoading={assistantPolicyLoading} assistantPolicyModes={assistantPolicyModes} snapshot={snapshot} updateAssistantPolicy={updateAssistantPolicy} />
  }




  function renderGitHubRepositoryBrowser() {
    return (
      <GitHubRepositoryBrowser
        githubCliStatus={githubCliStatus} githubRepositories={githubRepositories} githubAccounts={githubAccounts}
        githubAccountsLoading={githubAccountsLoading} githubRepoLoading={githubRepoLoading}
        githubRepoOwner={githubRepoOwner} setGithubRepoOwner={setGithubRepoOwner}
        githubRepoQuery={githubRepoQuery} setGithubRepoQuery={setGithubRepoQuery}
        githubRepoVisibility={githubRepoVisibility} setGithubRepoVisibility={setGithubRepoVisibility}
        githubRepoLimit={githubRepoLimit} busy={busy}
        loadGitHubAccounts={loadGitHubAccounts} loadGitHubRepositories={loadGitHubRepositories}
        cloneGitHubRepository={cloneGitHubRepository} openExternalLink={openExternalLink}
      />
    )
  }

  function renderPullRequestDetailsPanel() {
    return (
      <PullRequestDetailsPanel
        selectedPullRequestDetails={selectedPullRequestDetails} selectedPullRequestChecks={selectedPullRequestChecks}
        selectedPullRequestDiff={selectedPullRequestDiff} selectedPullRequestNumber={selectedPullRequestNumber}
        selectedPullRequestFilePath={selectedPullRequestFilePath} setSelectedPullRequestFilePath={setSelectedPullRequestFilePath}
        pullRequestDetailsLoading={pullRequestDetailsLoading} selectedPullRequestDiffResult={selectedPullRequestDiffResult}
        busy={busy} githubCliStatus={githubCliStatus} loadPullRequestDetails={loadPullRequestDetails} openExternalLink={openExternalLink}
      />
    )
  }

}

function isRepositoryTransitionOperation(operationLabel: string | null): boolean {
  if (!operationLabel) return false
  return (
    operationLabel === 'Opening repository...' ||
    operationLabel === 'Opening worktree...' ||
    operationLabel === 'Opening submodule...' ||
    operationLabel.startsWith('Cloning ')
  )
}

export default App
