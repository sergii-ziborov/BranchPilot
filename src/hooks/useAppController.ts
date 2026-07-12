import { useEffect, useState } from 'react'
import type { ApiResult, RepositorySnapshot } from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { useDailyReview } from './useDailyReview'
import { useLinkedIn } from './useLinkedIn'
import { useStash } from './useStash'
import { useGitConfig } from './useGitConfig'
import { useReview } from './useReview'
import { useProjectMemory } from './useProjectMemory'
import { useHistory } from './useHistory'
import { useBranches } from './useBranches'
import { useAssistants } from './useAssistants'
import { useProviders } from './useProviders'
import { useCommit } from './useCommit'
import { useChanges } from './useChanges'
import { useMerge } from './useMerge'
import type { ViewMode } from '../lib/viewMode'
import { assistantPolicyAllows } from '../lib/assistantLabels'
import { progressLabelFromSuccess } from '../lib/progressLabels'
import { usePrompts } from './usePrompts'
import { useReportRepoPaths } from './useReportRepoPaths'
import { useRepositoryManagement } from './useRepositoryManagement'
import { preferredMemoryFilePath } from '../lib/projectMemorySignals'
import { useAssistantSelection } from './appController/useAssistantSelection'
import { useAppFeedback } from './appController/useAppFeedback'
import { useOperationRunner } from './appController/useOperationRunner'
import { useBackgroundRefresh } from './appController/useBackgroundRefresh'
import { useRepoActions } from './appController/useRepoActions'
import { useMenuActions } from './appController/useMenuActions'

const api = window.branchPilot

export function useAppController() {
  const [appVersion, setAppVersion] = useState('0.0.0')
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof localStorage === 'undefined') return 'changes'
    const saved = localStorage.getItem('bp-view') as ViewMode | null
    return saved ?? 'changes'
  })
  const [allReposMode, setAllReposMode] = useState(false)
  const { setSelectedReportRepoPathsState, ...reportRepoPathsApi } = useReportRepoPaths()
  const { selectedReportRepoPaths } = reportRepoPathsApi
  const { notice, setNotice, error, setError, copyToClipboard, openExternalLink } = useAppFeedback()
  const {
    busy, setBusy, operationLabel, setOperationLabel,
    runBusyOperation, runApiAction, runOperationAction
  } = useOperationRunner({ setNotice, setError })
  const { selectedAssistant, setSelectedAssistant } = useAssistantSelection()
  const promptsApi = usePrompts()
  const { requestConfirmation, requestTextInput } = promptsApi

  // Remember the active view across reloads.
  useEffect(() => {
    try { localStorage.setItem('bp-view', viewMode) } catch { /* ignore */ }
  }, [viewMode])

  useEffect(() => {
    if (!api) {
      setError('BranchPilot desktop runtime is not available. Open the Electron app to use Git features.')
      return
    }

    void api.getVersion().then(setAppVersion)
    void loadRecentRepositories()
    void loadProviders()
    void loadAssistants()
    void loadEditorSettings()

    // Reopen the last repository so a reload doesn't drop back to the empty state.
    try {
      const lastRepo = localStorage.getItem('bp-repo')
      if (lastRepo) void openRepository(lastRepo)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!snapshot || (viewMode !== 'dashboard' && viewMode !== 'memory' && viewMode !== 'wiki' && viewMode !== 'mcp')) return
    void loadProjectMemory()
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

  useEffect(() => {
    setDailyReview(null)
    setNewWorktreeBranchName('')
    setStashMessage('')
    cancelRemoteEdit()
    cancelBranchDescriptionEdit()
  }, [snapshot?.summary.rootPath])

  useEffect(() => {
    setNewWorktreeBaseRef(snapshot?.summary.currentBranch && !snapshot.summary.isDetached ? snapshot.summary.currentBranch : 'HEAD')
  }, [snapshot?.summary.rootPath, snapshot?.summary.currentBranch, snapshot?.summary.isDetached])

  useEffect(() => {
    if (!snapshot) {
      setAssistantPolicy(null)
      return
    }

    void loadAssistantPolicy(snapshot.summary.rootPath)
  }, [snapshot?.summary.rootPath])

  const currentRepoPath = snapshot?.summary.rootPath
  const {
    projectMemory, projectMemoryMcpConfig, projectWiki, selectedProjectWikiPageId, setSelectedProjectWikiPageId,
    selectedProjectWikiPage, wikiLoading, activityLog, activityCategory, setActivityCategory, memoryLoading,
    selectedMemoryFilePath, setSelectedMemoryFilePath, selectedMemoryFile, selectedMemorySymbols, selectedMemoryImports,
    filteredActivityEntries, completedWorkItems,
    loadProjectMemory, generateProjectWiki, scanProjectMemory, copyProjectMemoryText, copyProjectWikiPage,
    saveProjectWikiPage, pullProjectWikiFromGitHub, pushProjectWikiToGitHub, clearActivityLog
  } = useProjectMemory({ api, currentRepoPath, setNotice, setError, copyToClipboard, requestConfirmation })
  const assistantsApi = useAssistants({ api, currentRepoPath, viewMode, selectedAssistant, setSelectedAssistant, setNotice, setError, loadProjectMemory })
  const { assistantPolicy, setAssistantPolicy, loadAssistants, loadAssistantPolicy } = assistantsApi
  const branchesApi = useBranches({ api, currentRepoPath, snapshot, selectedAssistant, assistantPolicy, setNotice, setError, runApiAction, runSnapshotAction, runBusyOperation, applySnapshot, requestConfirmation, requestTextInput, setViewMode })
  const { setNewWorktreeBranchName, setNewWorktreeBaseRef, cancelBranchDescriptionEdit, setBranchComparison } = branchesApi
  const {
    history, historyLoading, historyFilter, setHistoryFilter, historySearchMode, setHistorySearchMode, historyFileIndexing,
    selectedCommitSha, setSelectedCommitSha,
    commitDetails, commitDetailsLoading, selectedCommitFilePath, commitFileDiff, commitFileDiffLoading, filteredHistory, virtualHistory,
    loadHistory, loadCommitFileDiff
  } = useHistory({ api, currentRepoPath, snapshot, viewMode, setError })
  const {
    providers, githubCliStatus, githubAccounts, githubAccountsLoading,
    githubRepositories, githubRepoOwner, setGithubRepoOwner, githubRepoQuery, setGithubRepoQuery,
    githubRepoVisibility, setGithubRepoVisibility, githubRepoLimit, setGithubRepoLimit, githubRepoLoading,
    currentPullRequest, pullRequests, pullRequestsLoading,
    selectedPullRequestNumber, selectedPullRequestDetails, selectedPullRequestChecks,
    selectedPullRequestDiff, selectedPullRequestFilePath, setSelectedPullRequestFilePath, pullRequestDetailsLoading,
    prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, createdPullRequest,
    canPublishBranch, canGeneratePullRequestText, selectedPullRequestDiffResult,
    loadProviders, loadGitHubPullRequests, loadPullRequestDetails, loadGitHubAccounts, loadGitHubRepositories, cloneGitHubRepository, refreshProvidersPanel, refreshProviderStatusOnly, connectGitHub,
    generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest
  } = useProviders({ api, currentRepoPath, snapshot, viewMode, selectedAssistant, assistantPolicy, setNotice, setError, runApiAction, runBusyOperation, runSnapshotAction, applySnapshot, requestConfirmation, setViewMode, loadHistory })
  const { silentRefreshDashboard, ...repositoryManagementApi } = useRepositoryManagement({
    api, currentRepoPath, allReposMode, viewMode, reportRepoPaths: selectedReportRepoPaths, setViewMode, snapshot,
    runBusyOperation, applySnapshot, applySnapshotResult,
    setNotice, setError, refreshProviderStatusOnly
  })
  const {
    recentRepositories, setRecentRepositories, loadRecentRepositories,
    chooseRepository, openCloneDialog, openRepository, refreshRepository, openRepoInEditor, openRepositoryTerminal
  } = repositoryManagementApi
  const recentRepositoryPathsKey = recentRepositories.map((repo) => repo.path).join('\n')
  const effectiveReportRepoPaths = selectedReportRepoPaths.length > 0
    ? selectedReportRepoPaths
    : allReposMode
      ? recentRepositories.map((repo) => repo.path)
      : currentRepoPath
        ? [currentRepoPath]
        : []

  useEffect(() => {
    const available = new Set([
      ...recentRepositories.map((repo) => repo.path.toLowerCase()),
      ...(currentRepoPath ? [currentRepoPath.toLowerCase()] : [])
    ])
    if (available.size === 0) return

    const next = selectedReportRepoPaths.filter((repoPath) => available.has(repoPath.toLowerCase()))
    if (next.length !== selectedReportRepoPaths.length) {
      setSelectedReportRepoPathsState(next)
    }
  }, [recentRepositoryPathsKey, currentRepoPath])

  useEffect(() => {
    if (!projectMemory) {
      setSelectedMemoryFilePath(null)
      return
    }

    if (!selectedMemoryFilePath || !projectMemory.files.some((file) => file.path === selectedMemoryFilePath)) {
      setSelectedMemoryFilePath(preferredMemoryFilePath(projectMemory))
    }
  }, [projectMemory, selectedMemoryFilePath])

  useEffect(() => {
    if (!projectWiki) return

    if (!projectWiki.pages.some((page) => page.id === selectedProjectWikiPageId)) {
      setSelectedProjectWikiPageId(projectWiki.pages[0]?.id ?? 'overview')
    }
  }, [projectWiki, selectedProjectWikiPageId])

  useEffect(() => {
    if (!snapshot) return
    void loadGitConfig()
  }, [snapshot?.summary.rootPath])

  const {
    gitConfig, editorSettings, editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand,
    editorSettingsLoading, terminalSettings, terminalPreference, setTerminalPreference, terminalCustomCommand, setTerminalCustomCommand,
    saveTerminalSettings, gitBackendSettings, gitBackendPreference, saveGitBackendSettings,
    gitMonitorSettings, saveGitMonitorSettings,
    localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
    remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName,
    loadEditorSettings, saveEditorSettings, loadGitConfig, saveLocalGitIdentity,
    startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote
  } = useGitConfig({ api, currentRepoPath, setNotice, setError, runBusyOperation, runApiAction, requestConfirmation, applySnapshotResult })
  const { loadContributorStats, ...dailyReviewApi } = useDailyReview({ api, currentRepoPath, reportRepoPaths: effectiveReportRepoPaths, setNotice, setError, copyToClipboard })
  const { setDailyReview, dailyReviewDate, contributorWindow } = dailyReviewApi

  // Refresh the contributor leaderboard when the Reports views are open (the
  // Dashboard leaderboard + the daily review both consume it). In All-repositories
  // mode it aggregates across every recent repository.
  useEffect(() => {
    if (viewMode !== 'daily' && viewMode !== 'dashboard') return
    const scope = selectedReportRepoPaths.length > 0
      ? { repoPaths: selectedReportRepoPaths }
      : allReposMode
        ? undefined
        : currentRepoPath
    void loadContributorStats(scope)
  }, [snapshot?.summary.rootPath, viewMode, allReposMode, contributorWindow, dailyReviewDate, selectedReportRepoPaths.join('\n'), recentRepositoryPathsKey])

  useEffect(() => {
    if (viewMode !== 'daily' && viewMode !== 'dashboard') return
    if (!githubCliStatus?.authenticated || githubAccounts.length > 0 || githubAccountsLoading) return
    void loadGitHubAccounts(githubCliStatus, true)
  }, [viewMode, githubCliStatus?.authenticated, githubAccounts.length, githubAccountsLoading])

  // "All repositories" report scope: keep only the cross-repo / portfolio views.
  function enableAllReposMode() {
    setAllReposMode(true)
    if (viewMode !== 'dashboard' && viewMode !== 'daily' && viewMode !== 'linkedin') {
      setViewMode('dashboard')
    }
  }

  const counts = snapshot?.status.counts
  const {
    selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter,
    changeSearchMode, setChangeSearchMode, changeContentIndexing,
    diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
    diffExpanded, setDiffExpanded,
    diff, diffLoading, relatedDiff, imagePreview, patchScope, setPatchScope, changesActionsMenuRef,
    filteredChanges, selectedChange, selectedDiffStats, selectedRelatedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget,
    stagingPendingPaths, bulkStagingPending, bulkStageOptimisticChecked, stageOptimistic,
    closeChangesActionsMenu, toggleChangeStage, toggleBulkStage,
    stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelected, discardSelectedLines, exportPatch, applyPatch,
    openSelectedFileInEditor, openSelectedFileLineInEditor
  } = useChanges({ api, currentRepoPath, snapshot, counts, setNotice, setError, runSnapshotAction, runApiAction, runOperationAction, applySnapshot, requestConfirmation })
  const mergeApi = useMerge({ api, currentRepoPath, snapshot, setNotice, setError, runBusyOperation, runSnapshotAction, applySnapshot, requestConfirmation, setViewMode, loadHistory })
  const {
    reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport,
    preCommitReviewModes, preCommitReports, preCommitRunningMode, canRunAssistantReview, preCommitFindings, preCommitFindingsBySeverity,
    resetPreCommitReview, runReviewReport, runPreCommitReview, togglePreCommitReviewMode, openPreCommitReviewDetails
  } = useReview({ api, currentRepoPath, counts, assistantPolicy, selectedAssistant, setNotice, setError, runApiAction, runBusyOperation, setViewMode, selectedFilePath })
  const commitApi = useCommit({ api, currentRepoPath, snapshot, selectedAssistant, assistantPolicy, setNotice, runApiAction, runSnapshotAction, resetPreCommitReview, requestConfirmation })
  const mergeState = snapshot?.status.merge
  const canCreateStash = Boolean(snapshot && counts?.changed && mergeState?.operation === 'none')
  const {
    stashMessage, setStashMessage, stashes, loadStashes, defaultStashMessage,
    createStash, createQuickStash, applyStash, dropStash
  } = useStash({ api, currentRepoPath, snapshot, canCreateStash, setNotice, setError, runSnapshotAction, requestConfirmation, requestTextInput, resetPreCommitReview, setSnapshot, setRecentRepositories })

  // Keep the stash list fresh on the Changes view so the "Stashed changes" bar
  // (GitHub-Desktop style) only appears when a stash actually exists.
  useEffect(() => {
    if (!snapshot || (viewMode !== 'changes' && viewMode !== 'review')) return
    void loadStashes()
  }, [snapshot?.summary.rootPath, snapshot?.summary.currentBranch, viewMode])

  const hasRemote = Boolean(snapshot?.summary.remoteName)
  const hasUpstream = Boolean(snapshot?.summary.upstream)
  const canFetch = Boolean(snapshot && hasRemote)
  const canPull = Boolean(snapshot && !snapshot.summary.isDetached && hasUpstream)
  const canPush = Boolean(snapshot && !snapshot.summary.isDetached && hasUpstream)
  const canGenerateLinkedInProject = assistantPolicyAllows(assistantPolicy, 'linkedin_project')
  const linkedInApi = useLinkedIn({ api, currentRepoPath, selectedAssistant, assistantPolicy, canGenerateLinkedInProject, setNotice, setError, setBusy, copyToClipboard, loadProjectMemory })

  async function runSnapshotAction(
    label: string,
    action: () => Promise<ApiResult<RepositorySnapshot>>,
    progressLabel = progressLabelFromSuccess(label)
  ): Promise<boolean> {
    return runBusyOperation(progressLabel, async () => {
      const result = await action()
      applySnapshotResult(result, label)
      return result.ok
    })
  }

  function applySnapshotResult(result: ApiResult<RepositorySnapshot>, successMessage: string) {
    if (result.ok) {
      applySnapshot(result.data, successMessage)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }
  }

  function applySnapshot(nextSnapshot: RepositorySnapshot, successMessage: string) {
    resetPreCommitReview()
    setBranchComparison(null)
    setSnapshot(nextSnapshot)
    setRecentRepositories(nextSnapshot.recentRepositories)
    setNotice(successMessage)
    setError(null)
    void silentRefreshDashboard()

    if (viewMode === 'dashboard' || viewMode === 'memory' || viewMode === 'wiki' || viewMode === 'mcp') {
      void loadProjectMemory(nextSnapshot.summary.rootPath)
    }
  }

  useBackgroundRefresh({ api, currentRepoPath, busy, setSnapshot, setRecentRepositories, silentRefreshDashboard })

  const { applyCommitOperation, updateSubmodule, openSubmodule, pullGitLfs } = useRepoActions({
    api, currentRepoPath, snapshot, history, commitDetails,
    setNotice, setViewMode, requestConfirmation,
    runApiAction, runSnapshotAction, applySnapshot, loadHistory
  })

  useMenuActions({
    api, currentRepoPath, canFetch, canPull, canPush, setViewMode, runSnapshotAction,
    chooseRepository, openCloneDialog, refreshRepository, openRepoInEditor, openRepositoryTerminal
  })

  return {
    ...reportRepoPathsApi,
    appVersion,
    setAppVersion,
    snapshot,
    setSnapshot,
    viewMode,
    setViewMode,
    allReposMode,
    setAllReposMode,
    enableAllReposMode,
    busy,
    setBusy,
    operationLabel,
    setOperationLabel,
    notice,
    setNotice,
    error,
    setError,
    selectedAssistant,
    setSelectedAssistant,
    ...promptsApi,
    currentRepoPath,
    projectMemory, projectMemoryMcpConfig, projectWiki, selectedProjectWikiPageId, setSelectedProjectWikiPageId,
    selectedProjectWikiPage, wikiLoading, activityLog, activityCategory, setActivityCategory, memoryLoading,
    selectedMemoryFilePath, setSelectedMemoryFilePath, selectedMemoryFile, selectedMemorySymbols, selectedMemoryImports,
    filteredActivityEntries, completedWorkItems,
    loadProjectMemory, generateProjectWiki, scanProjectMemory, copyProjectMemoryText, copyProjectWikiPage,
    saveProjectWikiPage, pullProjectWikiFromGitHub, pushProjectWikiToGitHub, clearActivityLog,
    ...assistantsApi,
    ...branchesApi,
    history, historyLoading, historyFilter, setHistoryFilter, historySearchMode, setHistorySearchMode, historyFileIndexing,
    selectedCommitSha, setSelectedCommitSha,
    commitDetails, commitDetailsLoading, selectedCommitFilePath, commitFileDiff, commitFileDiffLoading, filteredHistory, virtualHistory,
    loadHistory, loadCommitFileDiff,
    providers, githubCliStatus, githubAccounts, githubAccountsLoading,
    githubRepositories, githubRepoOwner, setGithubRepoOwner, githubRepoQuery, setGithubRepoQuery,
    githubRepoVisibility, setGithubRepoVisibility, githubRepoLimit, setGithubRepoLimit, githubRepoLoading,
    currentPullRequest, pullRequests, pullRequestsLoading,
    selectedPullRequestNumber, selectedPullRequestDetails, selectedPullRequestChecks,
    selectedPullRequestDiff, selectedPullRequestFilePath, setSelectedPullRequestFilePath, pullRequestDetailsLoading,
    prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, createdPullRequest,
    canPublishBranch, canGeneratePullRequestText, selectedPullRequestDiffResult,
    loadProviders, loadGitHubPullRequests, loadPullRequestDetails, loadGitHubAccounts, loadGitHubRepositories,
    cloneGitHubRepository, refreshProvidersPanel, refreshProviderStatusOnly, connectGitHub,
    generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest,
    ...repositoryManagementApi,
    gitConfig, editorSettings, editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand,
    editorSettingsLoading, terminalSettings, terminalPreference, setTerminalPreference, terminalCustomCommand, setTerminalCustomCommand,
    saveTerminalSettings, gitBackendSettings, gitBackendPreference, saveGitBackendSettings,
    gitMonitorSettings, saveGitMonitorSettings,
    localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
    remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName,
    loadEditorSettings, saveEditorSettings, loadGitConfig, saveLocalGitIdentity,
    startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote,
    ...dailyReviewApi,
    counts,
    selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter,
    changeSearchMode, setChangeSearchMode, changeContentIndexing,
    diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
    diffExpanded, setDiffExpanded,
    diff, diffLoading, relatedDiff, imagePreview, patchScope, setPatchScope, changesActionsMenuRef,
    filteredChanges, selectedChange, selectedDiffStats, selectedRelatedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget,
    stagingPendingPaths, bulkStagingPending, bulkStageOptimisticChecked, stageOptimistic,
    closeChangesActionsMenu, toggleChangeStage, toggleBulkStage,
    stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelected, discardSelectedLines, exportPatch, applyPatch,
    openSelectedFileInEditor, openSelectedFileLineInEditor,
    ...mergeApi,
    reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport,
    preCommitReviewModes, preCommitReports, preCommitRunningMode, canRunAssistantReview, preCommitFindings, preCommitFindingsBySeverity,
    resetPreCommitReview, runReviewReport, runPreCommitReview, togglePreCommitReviewMode, openPreCommitReviewDetails,
    ...commitApi,
    mergeState,
    canCreateStash,
    stashMessage, setStashMessage, stashes, loadStashes, defaultStashMessage,
    createStash, createQuickStash, applyStash, dropStash,
    hasRemote,
    hasUpstream,
    canFetch,
    canPull,
    canPush,
    canGenerateLinkedInProject,
    ...linkedInApi,
    copyToClipboard,
    openExternalLink,
    runBusyOperation,
    runApiAction,
    runSnapshotAction,
    runOperationAction,
    applySnapshotResult,
    applySnapshot,
    applyCommitOperation,
    updateSubmodule,
    openSubmodule,
    pullGitLfs
  }
}
