import {
  Check,
  FileWarning,
  Loader2,
  X
} from 'lucide-react'
import type {
  AssistantActionKind,
  AssistantPolicyMode,
  EditorPreference,


} from './shared/branchPilot'
import { } from './shared/branchPilot'
import { } from './hooks/useDailyReview'
import { } from './hooks/useLinkedIn'
import { } from './hooks/useStash'
import { } from './hooks/useGitConfig'
import { } from './hooks/useReview'
import { } from './hooks/useProjectMemory'
import { } from './hooks/useHistory'
import { } from './hooks/useBranches'
import { } from './hooks/useAssistants'
import { } from './hooks/useProviders'
import { } from './hooks/useCommit'
import { } from './hooks/useChanges'
import { } from './hooks/useMerge'
import { AssistantPolicyPanel, AssistantReadiness } from './components/AssistantPanels'
import { ConfirmationDialog, TextPromptDialog } from './components/Dialogs'
import { AppSidebar } from './components/AppSidebar'
import { AppTopbar } from './components/AppTopbar'
import { EmptyState } from './components/EmptyState'
import { Stat } from './components/primitives'
import { PreCommitReviewPanel } from './components/PreCommitReviewPanel'
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
import type { } from './lib/viewMode'
import { } from './lib/assistantLabels'
import { } from './lib/progressLabels'
import type { ActivityCategory } from './lib/activityLabels'
import { } from './shared/externalUrl'
import './App.css'
import { } from './hooks/usePrompts'
import { } from './hooks/useRepositoryManagement'
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
    appVersion, snapshot, viewMode, setViewMode, busy, operationLabel, notice, error, setError, selectedAssistant, setSelectedAssistant, confirmationRequest, textPromptRequest, textPromptValue, setTextPromptValue, answerConfirmation, answerTextPrompt, currentRepoPath, projectMemory, projectMemoryMcpConfig, projectWiki, setSelectedProjectWikiPageId, selectedProjectWikiPage, wikiLoading, activityLog, activityCategory, setActivityCategory, memoryLoading, selectedMemoryFilePath, setSelectedMemoryFilePath, selectedMemoryFile, selectedMemorySymbols, selectedMemoryImports, filteredActivityEntries, completedWorkItems, loadProjectMemory, generateProjectWiki, scanProjectMemory, copyProjectMemoryText, copyProjectWikiPage, clearActivityLog, assistants, assistantsChecking, assistantPolicy, assistantPolicyLoading, checkAssistants, updateAssistantPolicy, newBranchName, setNewBranchName, newBranchDescription, setNewBranchDescription, branchDraftGoal, setBranchDraftGoal, branchFilter, setBranchFilter, newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef, tagFilter, setTagFilter, newTagName, setNewTagName, newTagMessage, setNewTagMessage, editingBranchName, branchDescriptionDraft, setBranchDescriptionDraft, branchDescriptionGenerating, branchComparison, branchComparisonLoading, canGenerateBranchDraft, branchDraftActionState, createBranchActionState, branchComposerSummary, generateBranchDraft, createBranch, deleteBranch, renameBranch, setBranchUpstream, compareBranch, createTag, deleteTag, createWorktree, openWorktree, removeWorktree, startBranchDescriptionEdit, cancelBranchDescriptionEdit, saveBranchDescription, generateBranchDescription, history, historyLoading, historyFilter, setHistoryFilter, selectedCommitSha, setSelectedCommitSha, commitDetails, selectedCommitFilePath, commitFileDiff, filteredHistory, virtualHistory, loadHistory, loadCommitFileDiff, providers, githubCliStatus, githubAccounts, githubAccountsLoading, githubRepositories, githubRepoOwner, setGithubRepoOwner, githubRepoQuery, setGithubRepoQuery, githubRepoVisibility, setGithubRepoVisibility, githubRepoLimit, setGithubRepoLimit, githubRepoLoading, currentPullRequest, pullRequests, pullRequestsLoading, selectedPullRequestNumber, selectedPullRequestDetails, selectedPullRequestChecks, selectedPullRequestDiff, selectedPullRequestFilePath, setSelectedPullRequestFilePath, pullRequestDetailsLoading, prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, createdPullRequest, canPublishBranch, canGeneratePullRequestText, selectedPullRequestDiffResult, loadGitHubPullRequests, loadPullRequestDetails, loadGitHubAccounts, loadGitHubRepositories, cloneGitHubRepository, refreshProvidersPanel, generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest, recentRepositories, recentRepositoryFilter, setRecentRepositoryFilter, filteredRecentRepositories, repositoryDashboard, dashboardLoading, dashboardRepositoryFilter, setDashboardRepositoryFilter, cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName, loadRepositoryDashboard, toggleRepositoryPinned, chooseRepository, openRepository, cloneRepository, refreshRepository, openRepoInEditor, openRepositoryTerminal, gitConfig, editorSettings, editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand, editorSettingsLoading, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail, remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName, saveEditorSettings, loadGitConfig, saveLocalGitIdentity, startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote, dailyReview, dailyReviewDate, setDailyReviewDate, dailyReviewLoading, runDailyReview, copyDailyReviewMarkdown, counts, selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter, diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace, diff, patchScope, setPatchScope, changesActionsMenuRef, filteredChanges, selectedChange, selectedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget, closeChangesActionsMenu, toggleChangeStage, toggleBulkStage, stageSelectedHunk, unstageSelectedHunk, discardSelected, exportPatch, applyPatch, openSelectedFileInEditor, openSelectedFileLineInEditor, selectedMergeBranch, setSelectedMergeBranch, startMergeOperation, continueMergeOperation, abortCurrentOperation, acceptConflictSide, reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport, preCommitReviewModes, preCommitReports, preCommitRunningMode, canRunAssistantReview, preCommitFindings, preCommitFindingsBySeverity, runReviewReport, runPreCommitReview, togglePreCommitReviewMode, openPreCommitReviewDetails, commitTitle, setCommitTitle, commitDescription, setCommitDescription, commitCoAuthors, setCommitCoAuthors, canGenerateCommitText, commitActionState, commitAndPushActionState, amendCommitActionState, commitChanges, amendLastCommit, generateCommitText, canCreateStash, stashMessage, setStashMessage, stashes, loadStashes, defaultStashMessage, createStash, createQuickStash, applyStash, dropStash, hasRemote, canFetch, canPull, canPush, canGenerateLinkedInProject, linkedinProject, linkedinHighlightsText, setLinkedinHighlightsText, linkedinTagsText, setLinkedinTagsText, linkedinSkillsText, setLinkedinSkillsText, linkedinRole, setLinkedInRole, linkedinAudience, setLinkedInAudience, linkedinProjectUrl, setLinkedInProjectUrl, linkedinLoading, generateLinkedInProject, updateLinkedInProject, copyLinkedInMarkdown, copyLinkedInTags, openExternalLink, runSnapshotAction, runOperationAction, applyCommitOperation, updateSubmodule, openSubmodule, pullGitLfs
  } = useAppController()

  return (
    <main className="app-shell">
      <AppSidebar
        apiReady={Boolean(api)} busy={busy} snapshot={snapshot} viewMode={viewMode} setViewMode={setViewMode}
        chooseRepository={chooseRepository} filteredRecentRepositories={filteredRecentRepositories}
        recentRepositories={recentRepositories} recentRepositoryFilter={recentRepositoryFilter}
        setRecentRepositoryFilter={setRecentRepositoryFilter} openRepository={openRepository}
        toggleRepositoryPinned={toggleRepositoryPinned} appVersion={appVersion}
      />

      <section className="workspace">
        <AppTopbar
          snapshot={snapshot} hasRemote={hasRemote} busy={busy} selectedFileTarget={selectedFileTarget}
          canFetch={canFetch} canPull={canPull} canPush={canPush} canPublishBranch={canPublishBranch}
          currentRepoPath={currentRepoPath} api={api} runSnapshotAction={runSnapshotAction}
          openRepoInEditor={openRepoInEditor} openSelectedFileInEditor={openSelectedFileInEditor}
          openRepositoryTerminal={openRepositoryTerminal} refreshRepository={refreshRepository}
        />

        {error && (
          <div className="message error">
            <FileWarning size={18} />
            <span className="message-text">{error}</span>
            <button type="button" className="message-dismiss" aria-label="Dismiss error" onClick={() => setError(null)}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className={busy ? 'message busy' : 'message'}>
          {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          <span>{busy && operationLabel ? operationLabel : notice}</span>
        </div>

        {!snapshot ? (
          <EmptyState
            apiReady={Boolean(api)} busy={busy} chooseRepository={chooseRepository}
            cloneRemoteUrl={cloneRemoteUrl} setCloneRemoteUrl={setCloneRemoteUrl}
            cloneTargetName={cloneTargetName} setCloneTargetName={setCloneTargetName}
            cloneRepository={cloneRepository}
          />
        ) : (
          <>
            {viewMode !== 'changes' && (
              <section className="stats-grid" aria-label="Repository status">
                <Stat label="Changed files" value={counts?.changed ?? 0} />
                <Stat label="Staged" value={counts?.staged ?? 0} />
                <Stat label="Unstaged" value={counts?.unstaged ?? 0} />
                <Stat label="Conflicts" value={counts?.conflicted ?? 0} />
                <Stat label="Ahead / behind" value={`${snapshot.summary.ahead} / ${snapshot.summary.behind}`} />
                <Stat label="Remote" value={snapshot.summary.upstream ?? snapshot.summary.remoteName ?? 'None'} />
              </section>
            )}

            {viewMode === 'dashboard' && (
              <DashboardView
                repositoryDashboard={repositoryDashboard}
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
              />
            )}
            {viewMode === 'changes' && (
              <ChangesView
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
                selectedAssistant={selectedAssistant}
                setSelectedAssistant={setSelectedAssistant}
                generateCommitText={generateCommitText}
                canGenerateCommitText={canGenerateCommitText}
                checkAssistants={checkAssistants}
                assistantsChecking={assistantsChecking}
                assistantPolicy={assistantPolicy}
                renderPreCommitReviewPanel={renderPreCommitReviewPanel}
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
                stageSelectedHunk={stageSelectedHunk}
                unstageSelectedHunk={unstageSelectedHunk}
                openSelectedFileLineInEditor={openSelectedFileLineInEditor}
                itemHeight={CHANGE_LIST_ITEM_HEIGHT}
              />
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
            {viewMode === 'branches' && (
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
                selectedAssistant={selectedAssistant}
                setSelectedAssistant={setSelectedAssistant}
                assistantPolicy={assistantPolicy}
                canGenerateBranchDraft={canGenerateBranchDraft}
                branchComposerSummary={branchComposerSummary}
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
                renderAssistantReadiness={renderAssistantReadiness}
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
            {viewMode === 'stash' && (
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
            )}
            {viewMode === 'review' && (
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
                renderAssistantReadiness={renderAssistantReadiness}
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
                renderAssistantReadiness={renderAssistantReadiness}
                renderGitHubRepositoryBrowser={renderGitHubRepositoryBrowser}
                renderPullRequestDetailsPanel={renderPullRequestDetailsPanel}
              />
            )}
            {viewMode === 'memory' && (
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
            {viewMode === 'daily' && (
              <DailyView
                dailyReviewDate={dailyReviewDate}
                setDailyReviewDate={setDailyReviewDate}
                runDailyReview={runDailyReview}
                snapshot={snapshot}
                dailyReviewLoading={dailyReviewLoading}
                dailyReview={dailyReview}
                copyDailyReviewMarkdown={copyDailyReviewMarkdown}
              />
            )}
            {viewMode === 'linkedin' && (
              <LinkedInView
                generateLinkedInProject={generateLinkedInProject}
                snapshot={snapshot}
                busy={busy}
                linkedinLoading={linkedinLoading}
                canGenerateLinkedInProject={canGenerateLinkedInProject}
                selectedAssistant={selectedAssistant}
                setSelectedAssistant={setSelectedAssistant}
                linkedinRole={linkedinRole}
                setLinkedInRole={setLinkedInRole}
                linkedinAudience={linkedinAudience}
                setLinkedInAudience={setLinkedInAudience}
                linkedinProjectUrl={linkedinProjectUrl}
                setLinkedInProjectUrl={setLinkedInProjectUrl}
                assistantPolicy={assistantPolicy}
                linkedinProject={linkedinProject}
                updateLinkedInProject={updateLinkedInProject}
                linkedinHighlightsText={linkedinHighlightsText}
                setLinkedinHighlightsText={setLinkedinHighlightsText}
                linkedinTagsText={linkedinTagsText}
                setLinkedinTagsText={setLinkedinTagsText}
                linkedinSkillsText={linkedinSkillsText}
                setLinkedinSkillsText={setLinkedinSkillsText}
                copyLinkedInTags={copyLinkedInTags}
                copyLinkedInMarkdown={copyLinkedInMarkdown}
                renderAssistantReadiness={renderAssistantReadiness}
              />
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



  function renderPreCommitReviewPanel() {
    return (
      <PreCommitReviewPanel
        preCommitReviewModes={preCommitReviewModes}
        preCommitFindings={preCommitFindings}
        preCommitFindingsBySeverity={preCommitFindingsBySeverity}
        preCommitRunningMode={preCommitRunningMode}
        preCommitReports={preCommitReports}
        togglePreCommitReviewMode={togglePreCommitReviewMode}
        runPreCommitReview={runPreCommitReview}
        openPreCommitReviewDetails={openPreCommitReviewDetails}
        canRunAssistantReview={canRunAssistantReview}
        busy={busy}
        counts={counts}
        assistantPolicy={assistantPolicy}
      />
    )
  }

  function renderAssistantReadiness(action: AssistantActionKind) {
    return <AssistantReadiness action={action} assistants={assistants} selectedAssistant={selectedAssistant} checkAssistants={checkAssistants} assistantsChecking={assistantsChecking} />
  }







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
