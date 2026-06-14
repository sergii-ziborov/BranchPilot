import { useEffect, useState } from 'react'
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
import { useRepositoryManagement } from './useRepositoryManagement'

const api = window.branchPilot

export function useAppController() {
  const [appVersion, setAppVersion] = useState('0.0.0')
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('changes')
  const [busy, setBusy] = useState(false)
  const [operationLabel, setOperationLabel] = useState<string | null>(null)
  const [notice, setNotice] = useState('Open a repository to begin.')
  const [error, setError] = useState<string | null>(null)
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantId>('auto')
  const {
    confirmationRequest, textPromptRequest, textPromptValue, setTextPromptValue,
    requestConfirmation, answerConfirmation, requestTextInput, answerTextPrompt
  } = usePrompts()
















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
  }, [])








  useEffect(() => {
    if (!snapshot || viewMode !== 'memory') return
    void loadProjectMemory()
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

  useEffect(() => {
    setDailyReview(null)
    setLinkedInProject(null)
    setLinkedinHighlightsText('')
    setLinkedinTagsText('')
    setLinkedinSkillsText('')
    setLinkedInRole('')
    setLinkedInAudience('LinkedIn project section')
    setLinkedInProjectUrl('')
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
    loadProjectMemory, generateProjectWiki, scanProjectMemory, copyProjectMemoryText, copyProjectWikiPage, clearActivityLog
  } = useProjectMemory({ api, currentRepoPath, setNotice, setError, copyToClipboard, requestConfirmation })
  const {
    assistants, assistantsChecking, assistantPolicy, setAssistantPolicy, assistantPolicyLoading,
    loadAssistants, checkAssistants, loadAssistantPolicy, updateAssistantPolicy
  } = useAssistants({ api, currentRepoPath, viewMode, setNotice, setError, loadProjectMemory })
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
    history, historyLoading, historyFilter, setHistoryFilter, selectedCommitSha, setSelectedCommitSha,
    commitDetails, selectedCommitFilePath, commitFileDiff, filteredHistory, virtualHistory,
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
    loadProviders, loadGitHubPullRequests, loadPullRequestDetails, loadGitHubAccounts, loadGitHubRepositories, cloneGitHubRepository, refreshProvidersPanel, refreshProviderStatusOnly,
    generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest
  } = useProviders({ api, currentRepoPath, snapshot, viewMode, selectedAssistant, assistantPolicy, setNotice, setError, runApiAction, runBusyOperation, runSnapshotAction, applySnapshot, requestConfirmation, setViewMode, loadHistory })
  const {
    recentRepositories, setRecentRepositories, recentRepositoryFilter, setRecentRepositoryFilter,
    filteredRecentRepositories, repositoryDashboard, dashboardLoading,
    dashboardRepositoryFilter, setDashboardRepositoryFilter,
    cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName,
    loadRecentRepositories, loadRepositoryDashboard, toggleRepositoryPinned,
    chooseRepository, openRepository, cloneRepository, refreshRepository,
    openRepoInEditor, openRepositoryTerminal
  } = useRepositoryManagement({
    api, currentRepoPath, viewMode, snapshot,
    runBusyOperation, runOperationAction, applySnapshot, applySnapshotResult,
    setNotice, setError, refreshProviderStatusOnly
  })

  useEffect(() => {
    if (!projectMemory) {
      setSelectedMemoryFilePath(null)
      return
    }

    if (!selectedMemoryFilePath || !projectMemory.files.some((file) => file.path === selectedMemoryFilePath)) {
      setSelectedMemoryFilePath(projectMemory.files[0]?.path ?? null)
    }
  }, [projectMemory, selectedMemoryFilePath])

  useEffect(() => {
    if (!projectWiki) return

    if (!projectWiki.pages.some((page) => page.id === selectedProjectWikiPageId)) {
      setSelectedProjectWikiPageId(projectWiki.pages[0]?.id ?? 'overview')
    }
  }, [projectWiki, selectedProjectWikiPageId])


  useEffect(() => {
    if (!snapshot || viewMode !== 'config') return
    void loadGitConfig()
  }, [snapshot?.summary.rootPath, viewMode])




  const {
    gitConfig, editorSettings, editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand,
    editorSettingsLoading, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
    remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName,
    loadEditorSettings, saveEditorSettings, loadGitConfig, saveLocalGitIdentity,
    startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote
  } = useGitConfig({ api, currentRepoPath, setNotice, setError, runBusyOperation, runApiAction, requestConfirmation, applySnapshotResult })
  const {
    dailyReview, setDailyReview, dailyReviewDate, setDailyReviewDate,
    dailyReviewLoading, runDailyReview, copyDailyReviewMarkdown
  } = useDailyReview({ api, currentRepoPath, setNotice, setError, copyToClipboard })
  const counts = snapshot?.status.counts
  const {
    selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter,
    diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
    diff, imagePreview, patchScope, setPatchScope, changesActionsMenuRef,
    filteredChanges, selectedChange, selectedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget,
    closeChangesActionsMenu, toggleChangeStage, toggleBulkStage,
    stageSelectedHunk, unstageSelectedHunk, discardSelected, exportPatch, applyPatch,
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
  } = useReview({ api, currentRepoPath, counts, assistantPolicy, selectedAssistant, setNotice, setError, runApiAction, runBusyOperation, setViewMode })
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
    linkedinProjectUrl, setLinkedInProjectUrl, linkedinLoading,
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

    if (viewMode === 'stash') {
      void loadStashes(nextSnapshot.summary.rootPath)
    }

    if (viewMode === 'memory') {
      void loadProjectMemory(nextSnapshot.summary.rootPath)
    }
  }

  async function applyCommitOperation(kind: 'revert' | 'cherry-pick') {
    if (!api || !currentRepoPath || !commitDetails) return

    const confirmed = await requestConfirmation(
      kind === 'revert'
        ? `Revert ${commitDetails.shortSha}? This creates a new commit that reverses the selected commit.`
        : `Cherry-pick ${commitDetails.shortSha} onto ${snapshot?.summary.currentBranch ?? 'the current branch'}?`,
      kind === 'revert'
        ? { title: 'Revert Commit', confirmLabel: 'Revert commit', variant: 'danger' }
        : { title: 'Cherry-Pick Commit', confirmLabel: 'Cherry-pick' }
    )
    if (!confirmed) return

    const request = {
      repoPath: currentRepoPath,
      commitSha: commitDetails.sha,
      confirmed
    }

    await runApiAction(
      kind === 'revert' ? 'Reverting commit...' : 'Cherry-picking commit...',
      () => kind === 'revert' ? api.revertCommit(request) : api.cherryPickCommit(request),
      (data) => {
        const hasConflicts = data.status.merge.operation !== 'none' || data.status.counts.conflicted > 0
        const conflictLabel = kind === 'revert' ? 'Revert has conflicts.' : 'Cherry-pick has conflicts.'
        const cleanLabel = kind === 'revert' ? 'Commit reverted.' : 'Commit cherry-picked.'
        applySnapshot(data, hasConflicts ? conflictLabel : cleanLabel)
        void loadHistory()

        if (hasConflicts) {
          setViewMode('merge')
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



  return {
    appVersion, setAppVersion, snapshot, setSnapshot, viewMode, setViewMode, busy, setBusy, operationLabel, setOperationLabel, notice, setNotice, error, setError, selectedAssistant, setSelectedAssistant, confirmationRequest, textPromptRequest, textPromptValue, setTextPromptValue, requestConfirmation, answerConfirmation, requestTextInput, answerTextPrompt, currentRepoPath, projectMemory, projectMemoryMcpConfig, projectWiki, selectedProjectWikiPageId, setSelectedProjectWikiPageId, selectedProjectWikiPage, wikiLoading, activityLog, activityCategory, setActivityCategory, memoryLoading, selectedMemoryFilePath, setSelectedMemoryFilePath, selectedMemoryFile, selectedMemorySymbols, selectedMemoryImports, filteredActivityEntries, completedWorkItems, loadProjectMemory, generateProjectWiki, scanProjectMemory, copyProjectMemoryText, copyProjectWikiPage, clearActivityLog, assistants, assistantsChecking, assistantPolicy, setAssistantPolicy, assistantPolicyLoading, loadAssistants, checkAssistants, loadAssistantPolicy, updateAssistantPolicy, newBranchName, setNewBranchName, newBranchDescription, setNewBranchDescription, branchDraftGoal, setBranchDraftGoal, branchFilter, setBranchFilter, newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef, tagFilter, setTagFilter, newTagName, setNewTagName, newTagMessage, setNewTagMessage, editingBranchName, branchDescriptionDraft, setBranchDescriptionDraft, branchDescriptionGenerating, branchComparison, setBranchComparison, branchComparisonLoading, canGenerateBranchDraft, branchDraftActionState, createBranchActionState, branchComposerSummary, generateBranchDraft, createBranch, deleteBranch, renameBranch, setBranchUpstream, compareBranch, createTag, deleteTag, createWorktree, openWorktree, removeWorktree, startBranchDescriptionEdit, cancelBranchDescriptionEdit, saveBranchDescription, generateBranchDescription, history, historyLoading, historyFilter, setHistoryFilter, selectedCommitSha, setSelectedCommitSha, commitDetails, selectedCommitFilePath, commitFileDiff, filteredHistory, virtualHistory, loadHistory, loadCommitFileDiff, providers, githubCliStatus, githubAccounts, githubAccountsLoading, githubRepositories, githubRepoOwner, setGithubRepoOwner, githubRepoQuery, setGithubRepoQuery, githubRepoVisibility, setGithubRepoVisibility, githubRepoLimit, setGithubRepoLimit, githubRepoLoading, currentPullRequest, pullRequests, pullRequestsLoading, selectedPullRequestNumber, selectedPullRequestDetails, selectedPullRequestChecks, selectedPullRequestDiff, selectedPullRequestFilePath, setSelectedPullRequestFilePath, pullRequestDetailsLoading, prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, createdPullRequest, canPublishBranch, canGeneratePullRequestText, selectedPullRequestDiffResult, loadProviders, loadGitHubPullRequests, loadPullRequestDetails, loadGitHubAccounts, loadGitHubRepositories, cloneGitHubRepository, refreshProvidersPanel, refreshProviderStatusOnly, generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest, recentRepositories, setRecentRepositories, recentRepositoryFilter, setRecentRepositoryFilter, filteredRecentRepositories, repositoryDashboard, dashboardLoading, dashboardRepositoryFilter, setDashboardRepositoryFilter, cloneRemoteUrl, setCloneRemoteUrl, cloneTargetName, setCloneTargetName, loadRecentRepositories, loadRepositoryDashboard, toggleRepositoryPinned, chooseRepository, openRepository, cloneRepository, refreshRepository, openRepoInEditor, openRepositoryTerminal, gitConfig, editorSettings, editorPreference, setEditorPreference, editorCustomCommand, setEditorCustomCommand, editorSettingsLoading, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail, remoteName, setRemoteName, remoteUrl, setRemoteUrl, editingRemoteName, loadEditorSettings, saveEditorSettings, loadGitConfig, saveLocalGitIdentity, startRemoteEdit, cancelRemoteEdit, saveRemote, removeRemote, dailyReview, setDailyReview, dailyReviewDate, setDailyReviewDate, dailyReviewLoading, runDailyReview, copyDailyReviewMarkdown, counts, selectedFilePath, setSelectedFilePath, changeFilter, setChangeFilter, diffMode, setDiffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace, diff, imagePreview, patchScope, setPatchScope, changesActionsMenuRef, filteredChanges, selectedChange, selectedDiffStats, virtualChanges, bulkStageToggleState, selectedFileTarget, closeChangesActionsMenu, toggleChangeStage, toggleBulkStage, stageSelectedHunk, unstageSelectedHunk, discardSelected, exportPatch, applyPatch, openSelectedFileInEditor, openSelectedFileLineInEditor, selectedMergeBranch, setSelectedMergeBranch, startMergeOperation, continueMergeOperation, abortCurrentOperation, acceptConflictSide, reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport, preCommitReviewModes, preCommitReports, preCommitRunningMode, canRunAssistantReview, preCommitFindings, preCommitFindingsBySeverity, resetPreCommitReview, runReviewReport, runPreCommitReview, togglePreCommitReviewMode, openPreCommitReviewDetails, commitTitle, setCommitTitle, commitDescription, setCommitDescription, commitCoAuthors, setCommitCoAuthors, canGenerateCommitText, commitActionState, commitAndPushActionState, amendCommitActionState, commitChanges, amendLastCommit, generateCommitText, mergeState, canCreateStash, stashMessage, setStashMessage, stashes, loadStashes, defaultStashMessage, createStash, createQuickStash, applyStash, dropStash, hasRemote, hasUpstream, canFetch, canPull, canPush, canGenerateLinkedInProject, linkedinProject, setLinkedInProject, linkedinHighlightsText, setLinkedinHighlightsText, linkedinTagsText, setLinkedinTagsText, linkedinSkillsText, setLinkedinSkillsText, linkedinRole, setLinkedInRole, linkedinAudience, setLinkedInAudience, linkedinProjectUrl, setLinkedInProjectUrl, linkedinLoading, generateLinkedInProject, updateLinkedInProject, copyLinkedInMarkdown, copyLinkedInTags, copyToClipboard, openExternalLink, runBusyOperation, runApiAction, runSnapshotAction, runOperationAction, applySnapshotResult, applySnapshot, applyCommitOperation, updateSubmodule, openSubmodule, pullGitLfs
  }
}
