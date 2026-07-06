import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApiResult,
  AssistantId,
  GitOperationResult,
  RepositorySnapshot,
  SubmoduleSummary,
} from '../shared/branchPilot'
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
import { isSafeExternalUrl } from '../shared/externalUrl'
import { usePrompts } from './usePrompts'
import { useReportRepoPaths } from './useReportRepoPaths'
import { useRepositoryManagement } from './useRepositoryManagement'
import { preferredMemoryFilePath } from '../lib/projectMemorySignals'

const api = window.branchPilot
const ASSISTANT_PREFERENCE_KEY = 'bp-assistant'
const ASSISTANT_IDS = new Set<AssistantId>([
  'auto',
  'claude',
  'codex',
  'claude:opus',
  'claude:sonnet',
  'claude:haiku',
  'codex:gpt-5',
  'codex:gpt-5-codex',
  'codex:gpt-5-mini'
])

export function useAppController() {
  const [appVersion, setAppVersion] = useState('0.0.0')
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof localStorage === 'undefined') return 'changes'
    const saved = localStorage.getItem('bp-view') as ViewMode | null
    return saved ?? 'changes'
  })
  const [allReposMode, setAllReposMode] = useState(false)
  const { selectedReportRepoPaths, setSelectedReportRepoPathsState, updateReportRepoPaths } = useReportRepoPaths()
  const [busy, setBusy] = useState(false)
  const [operationLabel, setOperationLabel] = useState<string | null>(null)
  const [notice, setNotice] = useState('Open a repository to begin.')
  const [error, setError] = useState<string | null>(null)
  const [selectedAssistant, setSelectedAssistantState] = useState<AssistantId>(readSelectedAssistantPreference)
  const setSelectedAssistant = useCallback((assistant: AssistantId) => {
    setSelectedAssistantState(assistant)
    try { localStorage.setItem(ASSISTANT_PREFERENCE_KEY, assistant) } catch { /* ignore */ }
  }, [])
  const {
    confirmationRequest, textPromptRequest, textPromptValue, setTextPromptValue,
    requestConfirmation, answerConfirmation, requestTextInput, answerTextPrompt
  } = usePrompts()
















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
  const {
    assistants, assistantsChecking, assistantPolicy, setAssistantPolicy, assistantPolicyLoading,
    loadAssistants, checkAssistants, loadAssistantPolicy, updateAssistantPolicy
  } = useAssistants({ api, currentRepoPath, viewMode, selectedAssistant, setSelectedAssistant, setNotice, setError, loadProjectMemory })
  const {
    newBranchName, setNewBranchName, newBranchDescription, setNewBranchDescription,
    branchDraftGoal, setBranchDraftGoal, branchFilter, setBranchFilter,
    newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef,
    tagFilter, setTagFilter, newTagName, setNewTagName, newTagMessage, setNewTagMessage,
    editingBranchName, branchDescriptionDraft, setBranchDescriptionDraft, branchDescriptionGenerating,
    branchComparison, setBranchComparison, branchComparisonLoading,
    canGenerateBranchDraft, branchDraftActionState, createBranchActionState, branchComposerSummary,
    generateBranchDraft, createBranch, deleteBranch, renameBranch, setBranchUpstream, compareBranch,
    createTag, deleteTag, createWorktree, openWorktree, removeWorktree,
    startBranchDescriptionEdit, cancelBranchDescriptionEdit, saveBranchDescription, generateBranchDescription
  } = useBranches({ api, currentRepoPath, snapshot, selectedAssistant, assistantPolicy, setNotice, setError, runApiAction, runSnapshotAction, runBusyOperation, applySnapshot, requestConfirmation, requestTextInput, setViewMode })
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
  const {
    recentRepositories, setRecentRepositories, recentRepositoryFilter, setRecentRepositoryFilter,
    filteredRecentRepositories, repositoryDashboard, contributionGraph, repositoryRhythm, dashboardLoading, contributionGraphLoading,
    dashboardRepositoryFilter, setDashboardRepositoryFilter, repositoryPickerOpen, setRepositoryPickerOpen,
    cloneDialogOpen, setCloneDialogOpen,
    cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName,
    loadRecentRepositories, loadRepositoryDashboard, silentRefreshDashboard, toggleRepositoryPinned,
    chooseRepository, openCloneDialog, openRepository, initializeRepository, cloneRepository, refreshRepository,
    openRepoInEditor, openRepositoryTerminal
  } = useRepositoryManagement({
    api, currentRepoPath, allReposMode, viewMode, reportRepoPaths: selectedReportRepoPaths, setViewMode, snapshot,
    runBusyOperation, applySnapshot, applySnapshotResult,
    setNotice, setError, refreshProviderStatusOnly
  })
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
    saveTerminalSettings, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
    remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName,
    loadEditorSettings, saveEditorSettings, loadGitConfig, saveLocalGitIdentity,
    startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote
  } = useGitConfig({ api, currentRepoPath, setNotice, setError, runBusyOperation, runApiAction, requestConfirmation, applySnapshotResult })
  const {
    dailyReview, setDailyReview, dailyReviewDate, setDailyReviewDate,
    dailyReviewLoading, contributorStats, contributorStatsLoading, contributorWindow, setContributorWindow,
    loadContributorStats, runDailyReview, copyDailyReviewMarkdown
  } = useDailyReview({ api, currentRepoPath, reportRepoPaths: effectiveReportRepoPaths, setNotice, setError, copyToClipboard })

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
    diff, relatedDiff, imagePreview, patchScope, setPatchScope, changesActionsMenuRef,
    filteredChanges, selectedChange, selectedDiffStats, selectedRelatedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget,
    stagingPendingPaths, bulkStagingPending, bulkStageOptimisticChecked,
    closeChangesActionsMenu, toggleChangeStage, toggleBulkStage,
    stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelected, discardSelectedLines, exportPatch, applyPatch,
    openSelectedFileInEditor, openSelectedFileLineInEditor
  } = useChanges({ api, currentRepoPath, snapshot, counts, setNotice, setError, runSnapshotAction, runApiAction, runOperationAction, applySnapshot, requestConfirmation })
  const {
    selectedMergeBranch, setSelectedMergeBranch, startMergeOperation,
    continueMergeOperation, abortCurrentOperation, acceptConflictSide
  } = useMerge({ api, currentRepoPath, snapshot, setNotice, setError, runBusyOperation, runSnapshotAction, applySnapshot, requestConfirmation, setViewMode, loadHistory })
  const {
    reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport,
    preCommitReviewModes, preCommitReports, preCommitRunningMode, canRunAssistantReview, preCommitFindings, preCommitFindingsBySeverity,
    resetPreCommitReview, runReviewReport, runPreCommitReview, togglePreCommitReviewMode, openPreCommitReviewDetails
  } = useReview({ api, currentRepoPath, counts, assistantPolicy, selectedAssistant, setNotice, setError, runApiAction, runBusyOperation, setViewMode, selectedFilePath })
  const {
    commitTitle, setCommitTitle, commitDescription, setCommitDescription, commitCoAuthors, setCommitCoAuthors,
    canGenerateCommitText, commitActionState, commitAndPushActionState, amendCommitActionState,
    commitChanges, amendLastCommit, generateCommitText
  } = useCommit({ api, currentRepoPath, snapshot, selectedAssistant, assistantPolicy, setNotice, runApiAction, runSnapshotAction, resetPreCommitReview, requestConfirmation })
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
  const {
    linkedinProject, setLinkedInProject, linkedinHighlightsText, setLinkedinHighlightsText,
    linkedinTagsText, setLinkedinTagsText, linkedinSkillsText, setLinkedinSkillsText,
    linkedinRole, setLinkedInRole, linkedinAudience, setLinkedInAudience,
    linkedinProjectUrl, setLinkedInProjectUrl, linkedinCustomPrompt, setLinkedInCustomPrompt, resetLinkedInPrompt, linkedinLoading,
    generateLinkedInProject, updateLinkedInProject, copyLinkedInMarkdown, copyLinkedInTags
  } = useLinkedIn({ api, currentRepoPath, selectedAssistant, assistantPolicy, canGenerateLinkedInProject, setNotice, setError, setBusy, copyToClipboard, loadProjectMemory })

  async function copyToClipboard(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(successMessage)
    } catch {
      setError('Clipboard is not available in this runtime.')
    }
  }

  function openExternalLink(url: string | undefined, label = 'External link') {
    if (!url || !isSafeExternalUrl(url)) {
      setError(`${label} was blocked because it is not a safe HTTPS URL.`)
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function runBusyOperation<T>(label: string, action: () => Promise<T>): Promise<T> {
    setBusy(true)
    setOperationLabel(label)
    setError(null)

    try {
      return await action()
    } finally {
      setBusy(false)
      setOperationLabel(null)
    }
  }

  async function runApiAction<T>(
    progressLabel: string,
    action: () => Promise<ApiResult<T>>,
    onSuccess: (data: T) => void | Promise<void>
  ): Promise<boolean> {
    return runBusyOperation(progressLabel, async () => {
      const result = await action()

      if (result.ok) {
        await onSuccess(result.data)
        return true
      }

      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
      return false
    })
  }

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

  async function runOperationAction(
    label: string,
    action: () => Promise<ApiResult<GitOperationResult>>,
    progressLabel = progressLabelFromSuccess(label)
  ) {
    await runBusyOperation(progressLabel, async () => {
      const result = await action()

      if (result.ok) {
        setNotice(result.data.message || label)
        setError(null)
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
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

  // Keep every repository live the way GitHub Desktop does: a background scan
  // refreshes the active repo's working tree AND every sibling repo's status
  // (clean / dirty / ahead / behind) on a timer plus on window focus. Silent (no
  // spinner, no activity-log entries) and guarded so an in-flight refresh for a
  // repo the user just left can never apply its (phantom) snapshot to the current one.
  const lastStatusSigRef = useRef('')
  const latestRepoRef = useRef(currentRepoPath)
  const busyRef = useRef(busy)
  useEffect(() => { latestRepoRef.current = currentRepoPath }, [currentRepoPath])
  useEffect(() => { busyRef.current = busy }, [busy])

  async function silentRefresh() {
    const repo = currentRepoPath
    if (!api || !repo || busyRef.current) return
    try {
      const result = await api.refreshRepository(repo)
      if (!result.ok) return
      // Discard stale results if the user switched repositories mid-flight.
      if (repo !== latestRepoRef.current) return
      const { status, summary } = result.data
      const sig = `${repo}|${summary.ahead}|${summary.behind}|${status.changes
        .map((c) => `${c.path}:${c.status}:${c.staged ? 1 : 0}:${c.unstaged ? 1 : 0}`)
        .join(',')}`
      if (sig === lastStatusSigRef.current) return
      lastStatusSigRef.current = sig
      setSnapshot(result.data)
      setRecentRepositories(result.data.recentRepositories)
    } catch {
      /* ignore transient refresh errors */
    }
  }

  function silentScan() {
    if (document.hidden || busyRef.current) return
    void silentRefresh()
    void silentRefreshDashboard()
  }

  useEffect(() => {
    if (!api) return
    const onFocus = () => { if (!document.hidden) silentScan() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    // Periodic background scan (paused while the window is hidden or an op is busy).
    const interval = window.setInterval(silentScan, 10_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(interval)
    }
  }, [api, currentRepoPath])

  async function applyCommitOperation(kind: 'revert' | 'cherry-pick' | 'reset' | 'reset-hard', commitSha = commitDetails?.sha) {
    if (!api || !currentRepoPath || !commitSha) return
    const targetCommit = commitDetails?.sha === commitSha ? commitDetails : history.find((commit) => commit.sha === commitSha)
    const shortSha = targetCommit?.shortSha ?? commitSha.slice(0, 7)
    const branchName = snapshot?.summary.currentBranch ?? 'the current branch'
    const isCurrentHead = snapshot?.summary.headOid === commitSha
    const resetMode: 'mixed' | 'hard' = kind === 'reset-hard' ? 'hard' : 'mixed'
    const isReset = kind === 'reset' || kind === 'reset-hard'

    if (isReset && isCurrentHead) {
      setNotice(`Branch is already at ${shortSha}. Pick an older commit to move later commits into Changes.`)
      return
    }

    const confirmed = await requestConfirmation(
      isReset
        ? resetMode === 'hard'
          ? `Reset ${branchName} to ${shortSha} and discard later commits plus working tree changes? This cannot be undone by BranchPilot.`
          : `Reset ${branchName} to ${shortSha}? This moves the branch pointer to that commit and keeps later commits as unstaged changes.`
        : kind === 'revert'
          ? `Revert ${shortSha}? This creates a new commit that reverses the selected commit.`
          : `Cherry-pick ${shortSha} onto ${branchName}?`,
      isReset
        ? { title: resetMode === 'hard' ? 'Reset Branch and Discard Changes' : 'Reset Branch', confirmLabel: resetMode === 'hard' ? 'Discard and reset' : 'Reset to commit', variant: 'danger' }
        : kind === 'revert'
          ? { title: 'Revert Commit', confirmLabel: 'Revert commit', variant: 'danger' }
          : { title: 'Cherry-Pick Commit', confirmLabel: 'Cherry-pick' }
    )
    if (!confirmed) return

    const request = {
      repoPath: currentRepoPath,
      commitSha,
      confirmed,
      mode: resetMode
    }

    await runApiAction(
      isReset ? 'Resetting branch...' : kind === 'revert' ? 'Reverting commit...' : 'Cherry-picking commit...',
      () => isReset ? api.resetToCommit(request) : kind === 'revert' ? api.revertCommit(request) : api.cherryPickCommit(request),
      (data) => {
        const hasConflicts = data.status.merge.operation !== 'none' || data.status.counts.conflicted > 0
        const conflictLabel = kind === 'revert' ? 'Revert has conflicts.' : 'Cherry-pick has conflicts.'
        const cleanLabel = isReset
          ? resetMode === 'hard'
            ? 'Branch reset. Later changes discarded.'
            : data.status.counts.changed > 0 ? 'Branch reset. Changes restored as unstaged.' : 'Branch reset.'
          : kind === 'revert' ? 'Commit reverted.' : 'Commit cherry-picked.'
        applySnapshot(data, hasConflicts ? conflictLabel : cleanLabel)
        void loadHistory()

        if (hasConflicts) {
          setViewMode('merge')
        } else if (kind === 'reset' && data.status.counts.changed > 0) {
          setViewMode('changes')
        }
      }
    )
  }

  async function updateSubmodule(submodule?: SubmoduleSummary) {
    if (!api || !currentRepoPath) return

    await runSnapshotAction(submodule ? 'Submodule updated.' : 'Submodules updated.', () =>
      api.updateSubmodule({
        repoPath: currentRepoPath,
        path: submodule?.path,
        init: true,
        recursive: true
      })
    )
  }

  async function openSubmodule(submodule: SubmoduleSummary) {
    if (!api) return

    await runApiAction('Opening submodule...', () => api.openRepository(submodule.absolutePath), (data) => {
      applySnapshot(data, 'Submodule opened.')
      setViewMode('changes')
    })
  }

  async function pullGitLfs() {
    if (!api || !currentRepoPath) return

    await runSnapshotAction('Git LFS objects pulled.', () =>
      api.pullGitLfs(currentRepoPath)
    )
  }

  // Native application menu (GitHub-Desktop-style) dispatches actions here.
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

  return {
    discardSelectedLines,
    selectedReportRepoPaths,
    updateReportRepoPaths,
    contributorWindow,
    setContributorWindow,
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
    confirmationRequest,
    textPromptRequest,
    textPromptValue,
    setTextPromptValue,
    requestConfirmation,
    answerConfirmation,
    requestTextInput,
    answerTextPrompt,
    currentRepoPath,
    projectMemory,
    projectMemoryMcpConfig,
    projectWiki,
    selectedProjectWikiPageId,
    setSelectedProjectWikiPageId,
    selectedProjectWikiPage,
    wikiLoading,
    activityLog,
    activityCategory,
    setActivityCategory,
    memoryLoading,
    selectedMemoryFilePath,
    setSelectedMemoryFilePath,
    selectedMemoryFile,
    selectedMemorySymbols,
    selectedMemoryImports,
    filteredActivityEntries,
    completedWorkItems,
    loadProjectMemory,
    generateProjectWiki,
    scanProjectMemory,
    copyProjectMemoryText,
    copyProjectWikiPage,
    saveProjectWikiPage,
    pullProjectWikiFromGitHub,
    pushProjectWikiToGitHub,
    clearActivityLog,
    assistants,
    assistantsChecking,
    assistantPolicy,
    setAssistantPolicy,
    assistantPolicyLoading,
    loadAssistants,
    checkAssistants,
    loadAssistantPolicy,
    updateAssistantPolicy,
    newBranchName,
    setNewBranchName,
    newBranchDescription,
    setNewBranchDescription,
    branchDraftGoal,
    setBranchDraftGoal,
    branchFilter,
    setBranchFilter,
    newWorktreeBranchName,
    setNewWorktreeBranchName,
    newWorktreeBaseRef,
    setNewWorktreeBaseRef,
    tagFilter,
    setTagFilter,
    newTagName,
    setNewTagName,
    newTagMessage,
    setNewTagMessage,
    editingBranchName,
    branchDescriptionDraft,
    setBranchDescriptionDraft,
    branchDescriptionGenerating,
    branchComparison,
    setBranchComparison,
    branchComparisonLoading,
    canGenerateBranchDraft,
    branchDraftActionState,
    createBranchActionState,
    branchComposerSummary,
    generateBranchDraft,
    createBranch,
    deleteBranch,
    renameBranch,
    setBranchUpstream,
    compareBranch,
    createTag,
    deleteTag,
    createWorktree,
    openWorktree,
    removeWorktree,
    startBranchDescriptionEdit,
    cancelBranchDescriptionEdit,
    saveBranchDescription,
    generateBranchDescription,
    history,
    historyLoading,
    historyFilter,
    setHistoryFilter,
    historySearchMode,
    setHistorySearchMode,
    historyFileIndexing,
    selectedCommitSha,
    setSelectedCommitSha,
    commitDetails,
    commitDetailsLoading,
    selectedCommitFilePath,
    commitFileDiff,
    commitFileDiffLoading,
    filteredHistory,
    virtualHistory,
    loadHistory,
    loadCommitFileDiff,
    providers,
    githubCliStatus,
    githubAccounts,
    githubAccountsLoading,
    githubRepositories,
    githubRepoOwner,
    setGithubRepoOwner,
    githubRepoQuery,
    setGithubRepoQuery,
    githubRepoVisibility,
    setGithubRepoVisibility,
    githubRepoLimit,
    setGithubRepoLimit,
    githubRepoLoading,
    currentPullRequest,
    pullRequests,
    pullRequestsLoading,
    selectedPullRequestNumber,
    selectedPullRequestDetails,
    selectedPullRequestChecks,
    selectedPullRequestDiff,
    selectedPullRequestFilePath,
    setSelectedPullRequestFilePath,
    pullRequestDetailsLoading,
    prTitle,
    setPrTitle,
    prDescription,
    setPrDescription,
    prBaseBranch,
    setPrBaseBranch,
    createdPullRequest,
    canPublishBranch,
    canGeneratePullRequestText,
    selectedPullRequestDiffResult,
    loadProviders,
    loadGitHubPullRequests,
    loadPullRequestDetails,
    loadGitHubAccounts,
    loadGitHubRepositories,
    cloneGitHubRepository,
    refreshProvidersPanel,
    refreshProviderStatusOnly,
    connectGitHub,
    generatePullRequestText,
    createPullRequest,
    checkoutPullRequest,
    selectPullRequest,
    recentRepositories,
    setRecentRepositories,
    recentRepositoryFilter,
    setRecentRepositoryFilter,
    filteredRecentRepositories,
    repositoryDashboard,
    contributionGraph,
    repositoryRhythm,
    dashboardLoading,
    contributionGraphLoading,
    dashboardRepositoryFilter,
    setDashboardRepositoryFilter,
    repositoryPickerOpen,
    setRepositoryPickerOpen,
    cloneDialogOpen,
    setCloneDialogOpen,
    cloneRemoteUrl,
    setCloneRemoteUrl,
    cloneTargetName,
    setCloneTargetName,
    loadRecentRepositories,
    loadRepositoryDashboard,
    toggleRepositoryPinned,
    chooseRepository,
    openCloneDialog,
    openRepository,
    initializeRepository,
    cloneRepository,
    refreshRepository,
    openRepoInEditor,
    openRepositoryTerminal,
    gitConfig,
    editorSettings,
    editorPreference,
    setEditorPreference,
    editorCustomCommand,
    setEditorCustomCommand,
    editorSettingsLoading,
    terminalSettings,
    terminalPreference,
    setTerminalPreference,
    terminalCustomCommand,
    setTerminalCustomCommand,
    saveTerminalSettings,
    localUserName,
    setLocalUserName,
    localUserEmail,
    setLocalUserEmail,
    remoteName,
    setRemoteName,
    remoteUrl,
    setRemoteUrl,
    editingRemoteName,
    loadEditorSettings,
    saveEditorSettings,
    loadGitConfig,
    saveLocalGitIdentity,
    startRemoteEdit,
    cancelRemoteEdit,
    saveRemote,
    removeRemote,
    dailyReview,
    setDailyReview,
    dailyReviewDate,
    setDailyReviewDate,
    dailyReviewLoading,
    contributorStats,
    contributorStatsLoading,
    runDailyReview,
    copyDailyReviewMarkdown,
    counts,
    selectedFilePath,
    setSelectedFilePath,
    changeFilter,
    setChangeFilter,
    changeSearchMode,
    setChangeSearchMode,
    changeContentIndexing,
    diffMode,
    setDiffMode,
    diffDisplayMode,
    setDiffDisplayMode,
    diffIgnoreWhitespace,
    setDiffIgnoreWhitespace,
    diffExpanded,
    setDiffExpanded,
    diff,
    relatedDiff,
    imagePreview,
    patchScope,
    setPatchScope,
    changesActionsMenuRef,
    filteredChanges,
    selectedChange,
    selectedDiffStats,
    selectedRelatedDiffStats,
    virtualChanges,
    bulkStageToggleState,
    selectedFileTarget,
    stagingPendingPaths,
    bulkStagingPending,
    bulkStageOptimisticChecked,
    closeChangesActionsMenu,
    toggleChangeStage,
    toggleBulkStage,
    stageSelectedHunk,
    unstageSelectedHunk,
    discardSelectedHunk,
    discardSelected,
    exportPatch,
    applyPatch,
    openSelectedFileInEditor,
    openSelectedFileLineInEditor,
    selectedMergeBranch,
    setSelectedMergeBranch,
    startMergeOperation,
    continueMergeOperation,
    abortCurrentOperation,
    acceptConflictSide,
    reviewMode,
    setReviewMode,
    reviewScope,
    setReviewScope,
    reviewReport,
    preCommitReviewModes,
    preCommitReports,
    preCommitRunningMode,
    canRunAssistantReview,
    preCommitFindings,
    preCommitFindingsBySeverity,
    resetPreCommitReview,
    runReviewReport,
    runPreCommitReview,
    togglePreCommitReviewMode,
    openPreCommitReviewDetails,
    commitTitle,
    setCommitTitle,
    commitDescription,
    setCommitDescription,
    commitCoAuthors,
    setCommitCoAuthors,
    canGenerateCommitText,
    commitActionState,
    commitAndPushActionState,
    amendCommitActionState,
    commitChanges,
    amendLastCommit,
    generateCommitText,
    mergeState,
    canCreateStash,
    stashMessage,
    setStashMessage,
    stashes,
    loadStashes,
    defaultStashMessage,
    createStash,
    createQuickStash,
    applyStash,
    dropStash,
    hasRemote,
    hasUpstream,
    canFetch,
    canPull,
    canPush,
    canGenerateLinkedInProject,
    linkedinProject,
    setLinkedInProject,
    linkedinHighlightsText,
    setLinkedinHighlightsText,
    linkedinTagsText,
    setLinkedinTagsText,
    linkedinSkillsText,
    setLinkedinSkillsText,
    linkedinRole,
    setLinkedInRole,
    linkedinAudience,
    setLinkedInAudience,
    linkedinProjectUrl,
    setLinkedInProjectUrl,
    linkedinCustomPrompt,
    setLinkedInCustomPrompt,
    resetLinkedInPrompt,
    linkedinLoading,
    generateLinkedInProject,
    updateLinkedInProject,
    copyLinkedInMarkdown,
    copyLinkedInTags,
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

function readSelectedAssistantPreference(): AssistantId {
  try {
    const saved = localStorage.getItem(ASSISTANT_PREFERENCE_KEY)
    return saved && ASSISTANT_IDS.has(saved as AssistantId)
      ? saved as AssistantId
      : 'auto'
  } catch {
    return 'auto'
  }
}
