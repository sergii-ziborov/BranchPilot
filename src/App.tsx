import type {
  AssistantPolicyMode,
  EditorPreference,
} from './shared/branchPilot'
import { CalendarDays } from 'lucide-react'
import { AssistantPolicyPanel } from './components/AssistantPanels'
import { ConfirmationDialog, TextPromptDialog } from './components/Dialogs'
import { LinkedinIcon } from './components/BrandIcons'
import { useEffect, useState } from 'react'
import { AppShellBar } from './components/AppShellBar'
import { ToolModal } from './components/ToolModal'
import { Toaster } from './components/Toaster'
import { GlobalTooltip } from './components/GlobalTooltip'
import { ConflictBanner } from './components/ConflictBanner'
import { EmptyState } from './components/EmptyState'
import { GitHubRepositoryBrowser, PullRequestDetailsPanel } from './components/ProvidersPanels'
import { CHANGE_LIST_ITEM_HEIGHT, HISTORY_LIST_ITEM_HEIGHT } from './lib/listMetrics'
import { DailyView } from './components/views/DailyView'
import { StashView } from './components/views/StashView'
import { MergeView } from './components/views/MergeView'
import { HistoryView } from './components/views/HistoryView'
import { ReviewView } from './components/views/ReviewView'
import { DashboardView } from './components/views/DashboardView'
import { LinkedInView } from './components/views/LinkedInView'
import { MemoryView } from './components/views/MemoryView'
import { ConfigView } from './components/views/ConfigView'
import { ChangesView } from './components/views/ChangesView'
import { BranchesView } from './components/views/BranchesView'
import { ProvidersView } from './components/views/ProvidersView'
import type { ActivityCategory } from './lib/activityLabels'
import './App.css'
import { useAppController } from './hooks/useAppController'

const api = window.branchPilot
const activityCategories: ActivityCategory[] = ['all', 'git', 'assistant', 'provider', 'memory']
const assistantPolicyModes: AssistantPolicyMode[] = [
  'disabled',
  'review-only',
  'suggest-only',
  'allow-local-commands',
  'allow-file-edits'
]
const editorPreferences: EditorPreference[] = ['auto', 'vscode', 'cursor', 'webstorm', 'rider', 'sublime', 'custom']

function App() {
  const {
    snapshot, viewMode, setViewMode, allReposMode, setAllReposMode, enableAllReposMode, busy, operationLabel, notice, setNotice, error, setError, selectedAssistant, setSelectedAssistant, confirmationRequest, textPromptRequest, textPromptValue, setTextPromptValue, answerConfirmation, answerTextPrompt, currentRepoPath, projectMemory, projectMemoryMcpConfig, projectWiki, setSelectedProjectWikiPageId, selectedProjectWikiPage, wikiLoading, activityLog, activityCategory, setActivityCategory, memoryLoading, selectedMemoryFilePath, setSelectedMemoryFilePath, selectedMemoryFile, selectedMemorySymbols, selectedMemoryImports, filteredActivityEntries, completedWorkItems, loadProjectMemory, generateProjectWiki, scanProjectMemory, copyProjectMemoryText, copyProjectWikiPage, clearActivityLog, assistants, assistantsChecking, assistantPolicy, assistantPolicyLoading, checkAssistants, updateAssistantPolicy, newBranchName, setNewBranchName, newBranchDescription, setNewBranchDescription, branchDraftGoal, setBranchDraftGoal, branchFilter, setBranchFilter, newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef, tagFilter, setTagFilter, newTagName, setNewTagName, newTagMessage, setNewTagMessage, editingBranchName, branchDescriptionDraft, setBranchDescriptionDraft, branchDescriptionGenerating, branchComparison, branchComparisonLoading, canGenerateBranchDraft, branchDraftActionState, createBranchActionState, generateBranchDraft, createBranch, deleteBranch, renameBranch, setBranchUpstream, compareBranch, createTag, deleteTag, createWorktree, openWorktree, removeWorktree, startBranchDescriptionEdit, cancelBranchDescriptionEdit, saveBranchDescription, generateBranchDescription, history, historyLoading, historyFilter, setHistoryFilter, selectedCommitSha, setSelectedCommitSha, commitDetails, selectedCommitFilePath, commitFileDiff, filteredHistory, virtualHistory, loadHistory, loadCommitFileDiff, providers, githubCliStatus, githubAccounts, githubAccountsLoading, githubRepositories, githubRepoOwner, setGithubRepoOwner, githubRepoQuery, setGithubRepoQuery, githubRepoVisibility, setGithubRepoVisibility, githubRepoLimit, setGithubRepoLimit, githubRepoLoading, currentPullRequest, pullRequests, pullRequestsLoading, selectedPullRequestNumber, selectedPullRequestDetails, selectedPullRequestChecks, selectedPullRequestDiff, selectedPullRequestFilePath, setSelectedPullRequestFilePath, pullRequestDetailsLoading, prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, createdPullRequest, canPublishBranch, canGeneratePullRequestText, selectedPullRequestDiffResult, loadGitHubPullRequests, loadPullRequestDetails, loadGitHubAccounts, loadGitHubRepositories, cloneGitHubRepository, refreshProvidersPanel, generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest, recentRepositories, repositoryDashboard, contributionGraph, dashboardLoading, dashboardRepositoryFilter, setDashboardRepositoryFilter, cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName, loadRepositoryDashboard, chooseRepository, openRepository, cloneRepository, refreshRepository, openRepoInEditor, openRepositoryTerminal, gitConfig, editorSettings, editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand, editorSettingsLoading, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail, remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName, saveEditorSettings, loadGitConfig, saveLocalGitIdentity, startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote, dailyReview, dailyReviewDate, setDailyReviewDate, dailyReviewLoading, contributorStats, runDailyReview, copyDailyReviewMarkdown, counts, selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter, diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace, diff, imagePreview, patchScope, setPatchScope, changesActionsMenuRef, filteredChanges, selectedChange, selectedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget, closeChangesActionsMenu, toggleChangeStage, toggleBulkStage, stageSelectedHunk, unstageSelectedHunk, discardSelected, exportPatch, applyPatch, openSelectedFileInEditor, selectedMergeBranch, setSelectedMergeBranch, startMergeOperation, continueMergeOperation, abortCurrentOperation, acceptConflictSide, reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport, canRunAssistantReview, runReviewReport, commitTitle, setCommitTitle, commitDescription, setCommitDescription, commitCoAuthors, setCommitCoAuthors, canGenerateCommitText, commitActionState, commitAndPushActionState, amendCommitActionState, commitChanges, amendLastCommit, generateCommitText, canCreateStash, stashMessage, setStashMessage, stashes, loadStashes, defaultStashMessage, createStash, createQuickStash, applyStash, dropStash, hasRemote, canFetch, canPull, canPush, canGenerateLinkedInProject, linkedinProject, linkedinSkillsText, setLinkedinSkillsText, linkedinRole, setLinkedInRole, linkedinAudience, setLinkedInAudience, linkedinProjectUrl, setLinkedInProjectUrl, linkedinLoading, generateLinkedInProject, updateLinkedInProject, copyLinkedInMarkdown, openExternalLink, runSnapshotAction, runOperationAction, applyCommitOperation, updateSubmodule, openSubmodule, pullGitLfs
  } = useAppController()

  const [changesTool, setChangesTool] = useState<'review' | 'stash' | null>(null)

  useEffect(() => {
    if (viewMode === 'review') setChangesTool('review')
  }, [viewMode])

  return (
    <main className="app-shell">
      <AppShellBar
        snapshot={snapshot} busy={busy} apiReady={Boolean(api)} api={api} currentRepoPath={currentRepoPath}
        viewMode={viewMode} setViewMode={setViewMode} changedCount={counts?.changed ?? 0}
        selectedAssistant={selectedAssistant} setSelectedAssistant={setSelectedAssistant}
        recentRepositories={recentRepositories} openRepository={openRepository} chooseRepository={chooseRepository}
        allReposMode={allReposMode} onSelectAllRepos={enableAllReposMode} onExitAllRepos={() => setAllReposMode(false)}
        hasRemote={hasRemote} canFetch={canFetch} canPull={canPull} canPush={canPush}
        selectedFileTarget={selectedFileTarget} runSnapshotAction={runSnapshotAction}
        refreshRepository={refreshRepository} openRepoInEditor={openRepoInEditor}
        openSelectedFileInEditor={openSelectedFileInEditor} openRepositoryTerminal={openRepositoryTerminal}
      />

      <Toaster notice={notice} busy={busy} operationLabel={operationLabel} error={error} onDismissError={() => setError(null)} />
      <GlobalTooltip />

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

        {!snapshot && !allReposMode ? (
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
                  contributionGraph={contributionGraph}
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
                {!allReposMode && snapshot && (
                  <MemoryView
                    projectMemory={projectMemory}
                    memoryLoading={memoryLoading}
                    loadProjectMemory={loadProjectMemory}
                    scanProjectMemory={scanProjectMemory}
                    activityLog={activityLog}
                    projectMemoryMcpConfig={projectMemoryMcpConfig}
                    copyProjectMemoryText={copyProjectMemoryText}
                    projectWiki={projectWiki}
                    wikiLoading={wikiLoading}
                    generateProjectWiki={generateProjectWiki}
                    selectedProjectWikiPage={selectedProjectWikiPage}
                    setSelectedProjectWikiPageId={setSelectedProjectWikiPageId}
                    copyProjectWikiPage={copyProjectWikiPage}
                    completedWorkItems={completedWorkItems}
                    clearActivityLog={clearActivityLog}
                    activityCategories={activityCategories}
                    activityCategory={activityCategory}
                    setActivityCategory={setActivityCategory}
                    filteredActivityEntries={filteredActivityEntries}
                    selectedMemoryFilePath={selectedMemoryFilePath}
                    setSelectedMemoryFilePath={setSelectedMemoryFilePath}
                    selectedMemoryFile={selectedMemoryFile}
                    selectedMemorySymbols={selectedMemorySymbols}
                    selectedMemoryImports={selectedMemoryImports}
                  />
                )}
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
                filteredChanges={filteredChanges}
                virtualChanges={virtualChanges}
                changesActionsMenuRef={changesActionsMenuRef}
                closeChangesActionsMenu={closeChangesActionsMenu}
                createQuickStash={createQuickStash}
                canCreateStash={canCreateStash}
                patchScope={patchScope}
                setPatchScope={setPatchScope}
                exportPatch={exportPatch}
                applyPatch={applyPatch}
                bulkStageToggleState={bulkStageToggleState}
                toggleBulkStage={toggleBulkStage}
                toggleChangeStage={toggleChangeStage}
                selectedFilePath={selectedFilePath}
                setSelectedFilePath={setSelectedFilePath}
                setDiffMode={setDiffMode}
                commitTitle={commitTitle}
                setCommitTitle={setCommitTitle}
                commitDescription={commitDescription}
                setCommitDescription={setCommitDescription}
                commitCoAuthors={commitCoAuthors}
                setCommitCoAuthors={setCommitCoAuthors}
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
                discardSelected={discardSelected}
                diffMode={diffMode}
                diffDisplayMode={diffDisplayMode}
                setDiffDisplayMode={setDiffDisplayMode}
                diffIgnoreWhitespace={diffIgnoreWhitespace}
                setDiffIgnoreWhitespace={setDiffIgnoreWhitespace}
                diff={diff}
                imagePreview={imagePreview}
                stageSelectedHunk={stageSelectedHunk}
                unstageSelectedHunk={unstageSelectedHunk}
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
                  <ToolModal title="Review" onClose={() => setChangesTool(null)}>
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
                loadHistory={loadHistory}
                busy={busy}
                historyFilter={historyFilter}
                setHistoryFilter={setHistoryFilter}
                virtualHistory={virtualHistory}
                itemHeight={HISTORY_LIST_ITEM_HEIGHT}
                selectedCommitSha={selectedCommitSha}
                setSelectedCommitSha={setSelectedCommitSha}
                commitDetails={commitDetails}
                selectedCommitFilePath={selectedCommitFilePath}
                loadCommitFileDiff={loadCommitFileDiff}
                commitFileDiff={commitFileDiff}
                openExternalLink={openExternalLink}
                applyCommitOperation={applyCommitOperation}
                api={api}
                currentRepoPath={currentRepoPath}
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
                loadGitConfig={loadGitConfig}
                busy={busy}
                localUserName={localUserName}
                setLocalUserName={setLocalUserName}
                localUserEmail={localUserEmail}
                setLocalUserEmail={setLocalUserEmail}
                saveLocalGitIdentity={saveLocalGitIdentity}
                gitConfig={gitConfig}
                editorPreference={editorPreference}
                setEditorPreference={setEditorPreference}
                editorPreferences={editorPreferences}
                editorCustomCommand={editorCustomCommand}
                setEditorCustomCommand={setEditorCustomCommand}
                saveEditorSettings={saveEditorSettings}
                editorSettings={editorSettings}
                editorSettingsLoading={editorSettingsLoading}
                remoteName={remoteName}
                setRemoteName={setRemoteName}
                remoteUrl={remoteUrl}
                setRemoteUrl={setRemoteUrl}
                saveRemote={saveRemote}
                editingRemoteName={editingRemoteName}
                cancelRemoteEdit={cancelRemoteEdit}
                startRemoteEdit={startRemoteEdit}
                removeRemote={removeRemote}
                snapshot={snapshot}
                updateSubmodule={updateSubmodule}
                openSubmodule={openSubmodule}
                runOperationAction={runOperationAction}
                api={api}
                pullGitLfs={pullGitLfs}
              />
            )}
            {viewMode === 'providers' && (
              <ProvidersView
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
                selectPullRequest={selectPullRequest}
                openExternalLink={openExternalLink}
                runSnapshotAction={runSnapshotAction}
                renderGitHubRepositoryBrowser={renderGitHubRepositoryBrowser}
                renderPullRequestDetailsPanel={renderPullRequestDetailsPanel}
              />
            )}
            {(viewMode === 'daily' || viewMode === 'linkedin') && (
              <div className="reports-stack">
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
                  <DailyView
                    dailyReviewDate={dailyReviewDate}
                    setDailyReviewDate={setDailyReviewDate}
                    runDailyReview={runDailyReview}
                    snapshot={snapshot}
                    dailyReviewLoading={dailyReviewLoading}
                    dailyReview={dailyReview}
                    contributorStats={contributorStats}
                    copyDailyReviewMarkdown={copyDailyReviewMarkdown}
                    allReposMode={allReposMode}
                  />
                )}
                {viewMode === 'linkedin' && (
                  <LinkedInView
                generateLinkedInProject={generateLinkedInProject}
                snapshot={snapshot}
                busy={busy}
                linkedinLoading={linkedinLoading}
                canGenerateLinkedInProject={canGenerateLinkedInProject}
                linkedinRole={linkedinRole}
                setLinkedInRole={setLinkedInRole}
                linkedinAudience={linkedinAudience}
                setLinkedInAudience={setLinkedInAudience}
                linkedinProjectUrl={linkedinProjectUrl}
                setLinkedInProjectUrl={setLinkedInProjectUrl}
                assistantPolicy={assistantPolicy}
                linkedinProject={linkedinProject}
                updateLinkedInProject={updateLinkedInProject}
                linkedinSkillsText={linkedinSkillsText}
                setLinkedinSkillsText={setLinkedinSkillsText}
                copyLinkedInMarkdown={copyLinkedInMarkdown}
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
    </main>
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
        githubRepoLimit={githubRepoLimit} setGithubRepoLimit={setGithubRepoLimit} busy={busy}
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

export default App
