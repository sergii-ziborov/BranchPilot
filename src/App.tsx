import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  Code2,
  Database,
  ExternalLink,
  FileWarning,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  LayoutDashboard,
  Loader2,
  RefreshCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Terminal,
  UploadCloud,
  X
} from 'lucide-react'
import type {
  ApiResult,
  AssistantActionKind,
  AssistantId,
  AssistantPolicyMode,
  DiffHunk,
  EditorPreference,

  CreatedPullRequest,
  DiffResult,
  FileChange,
  GitHubAccountSummary,
  GitHubCliStatus,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubRepositorySummary,

  GitOperationResult,
  ProviderStatus,
  PatchScope,
  RecentRepository,

  RepositorySnapshot,
  RepositoryDashboardSnapshot,
  ReviewSeverity,
  SubmoduleSummary,
} from './shared/branchPilot'
import { branchPilotErrorText } from './shared/branchPilot'
import {
  getAvailableChangeDiffMode,
  getBulkStageToggleAction,
  getBulkStageToggleState,
  getChangeStageToggleAction,
  getDefaultChangeDiffMode,
  type ChangeDiffMode
} from './shared/changeStaging'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from './shared/commitPreconditions'
import { getDiffStats } from './shared/diffView'
import { DiffPreview } from './components/DiffView'
import { InfoRow, Stat } from './components/primitives'
import { useVirtualList } from './hooks/useVirtualList'
import { useDailyReview } from './hooks/useDailyReview'
import { useLinkedIn } from './hooks/useLinkedIn'
import { useStash } from './hooks/useStash'
import { useGitConfig } from './hooks/useGitConfig'
import { useReview } from './hooks/useReview'
import { useProjectMemory } from './hooks/useProjectMemory'
import { useHistory } from './hooks/useHistory'
import { useBranches } from './hooks/useBranches'
import { useAssistants } from './hooks/useAssistants'
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
import type { ViewMode } from './lib/viewMode'
import { changeLabel, fileStatusToken } from './lib/fileChangeLabels'
import { formatDate } from './lib/format'
import { reviewModeLabel, reviewModes } from './lib/reviewLabels'
import { assistantActionLabel, assistantLabel, assistantPolicyAllows, assistantPolicyBlockedLabel, assistantPolicyModeLabel, assistantReadinessSummary } from './lib/assistantLabels'
import { checkBucketClass, githubAccountOptionLabel, githubRepositoryBrowserSourceLabel, githubRepositoryMeta } from './lib/githubLabels'
import { progressLabelFromSuccess } from './lib/progressLabels'
import type { ActivityCategory } from './lib/activityLabels'
import { isSafeExternalUrl } from './shared/externalUrl'
import './App.css'

type DiffMode = ChangeDiffMode
type DiffDisplayMode = 'unified' | 'split'
type ConfirmationVariant = 'default' | 'danger'

interface ConfirmationOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmationVariant
}


interface ConfirmationRequest extends Required<ConfirmationOptions> {
  id: number
  message: string
  resolve: (confirmed: boolean) => void
}

interface TextPromptOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  defaultValue?: string
  placeholder?: string
}

interface TextPromptRequest extends Required<TextPromptOptions> {
  id: number
  message: string
  resolve: (value: string | null) => void
}

const api = window.branchPilot
const reviewSeverities: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info']
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
  const [appVersion, setAppVersion] = useState('0.0.0')
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null)
  const [repositoryDashboard, setRepositoryDashboard] = useState<RepositoryDashboardSnapshot | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardRepositoryFilter, setDashboardRepositoryFilter] = useState('')
  const [cloneRemoteUrl, setCloneRemoteUrl] = useState('')
  const [cloneTargetName, setCloneTargetName] = useState('')
  const [recentRepositories, setRecentRepositories] = useState<RecentRepository[]>([])
  const [recentRepositoryFilter, setRecentRepositoryFilter] = useState('')
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [changeFilter, setChangeFilter] = useState('')
  const [diffMode, setDiffMode] = useState<DiffMode>('unstaged')
  const [diffDisplayMode, setDiffDisplayMode] = useState<DiffDisplayMode>('unified')
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(false)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [busy, setBusy] = useState(false)
  const [operationLabel, setOperationLabel] = useState<string | null>(null)
  const [notice, setNotice] = useState('Open a repository to begin.')
  const [error, setError] = useState<string | null>(null)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [commitCoAuthors, setCommitCoAuthors] = useState('')
  const [patchScope, setPatchScope] = useState<PatchScope>('working-tree')
  const [selectedMergeBranch, setSelectedMergeBranch] = useState('')
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantId>('auto')
  const [githubCliStatus, setGithubCliStatus] = useState<GitHubCliStatus | null>(null)
  const [githubAccounts, setGithubAccounts] = useState<GitHubAccountSummary[]>([])
  const [githubAccountsLoading, setGithubAccountsLoading] = useState(false)
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepositorySummary[]>([])
  const [githubRepoOwner, setGithubRepoOwner] = useState('')
  const [githubRepoQuery, setGithubRepoQuery] = useState('')
  const [githubRepoVisibility, setGithubRepoVisibility] = useState<'all' | 'public' | 'private' | 'internal'>('all')
  const [githubRepoLimit, setGithubRepoLimit] = useState('30')
  const [githubRepoLoading, setGithubRepoLoading] = useState(false)
  const [currentPullRequest, setCurrentPullRequest] = useState<GitHubPullRequest | null>(null)
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([])
  const [pullRequestsLoading, setPullRequestsLoading] = useState(false)
  const [selectedPullRequestNumber, setSelectedPullRequestNumber] = useState<number | null>(null)
  const [selectedPullRequestDetails, setSelectedPullRequestDetails] = useState<GitHubPullRequestDetails | null>(null)
  const [selectedPullRequestChecks, setSelectedPullRequestChecks] = useState<GitHubPullRequestCheck[]>([])
  const [selectedPullRequestDiff, setSelectedPullRequestDiff] = useState<GitHubPullRequestDiff | null>(null)
  const [selectedPullRequestFilePath, setSelectedPullRequestFilePath] = useState<string | null>(null)
  const [pullRequestDetailsLoading, setPullRequestDetailsLoading] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prDescription, setPrDescription] = useState('')
  const [prBaseBranch, setPrBaseBranch] = useState('')
  const [createdPullRequest, setCreatedPullRequest] = useState<CreatedPullRequest | null>(null)
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null)
  const [textPromptRequest, setTextPromptRequest] = useState<TextPromptRequest | null>(null)
  const [textPromptValue, setTextPromptValue] = useState('')
  const confirmationIdRef = useRef(0)
  const changesActionsMenuRef = useRef<HTMLDetailsElement>(null)
  const diffRequestIdRef = useRef(0)
  const pullRequestDetailsRequestIdRef = useRef(0)
  const dashboardRequestIdRef = useRef(0)

  const filteredChanges = useMemo(() => {
    const changes = snapshot?.status.changes ?? []
    const query = changeFilter.trim().toLowerCase()

    if (!query) return changes

    return changes.filter((change) =>
      [change.path, change.originalPath, change.status, changeLabel(change)]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query))
    )
  }, [changeFilter, snapshot])


  const filteredRecentRepositories = useMemo(() => {
    const query = recentRepositoryFilter.trim().toLowerCase()

    if (!query) return recentRepositories

    return recentRepositories.filter((repo) =>
      [
        repo.name,
        repo.path,
        repo.pinned ? 'pinned favorite starred repository' : 'recent repository'
      ].some((value) => value.toLowerCase().includes(query))
    )
  }, [recentRepositories, recentRepositoryFilter])

  const selectedChange = useMemo(
    () => snapshot?.status.changes.find((change) => change.path === selectedFilePath) ?? null,
    [selectedFilePath, snapshot]
  )



  const selectedPullRequestFile = useMemo(
    () => selectedPullRequestDiff?.files.find((file) => file.path === selectedPullRequestFilePath) ?? null,
    [selectedPullRequestDiff, selectedPullRequestFilePath]
  )

  const selectedPullRequestDiffResult = useMemo<DiffResult | null>(() => {
    if (!selectedPullRequestFile) return null

    return {
      filePath: selectedPullRequestFile.path,
      staged: false,
      text: selectedPullRequestFile.text,
      binary: selectedPullRequestFile.hunks.length === 0 && /Binary files/i.test(selectedPullRequestFile.text),
      tooLarge: false,
      files: [selectedPullRequestFile]
    }
  }, [selectedPullRequestFile])

  const selectedDiffStats = useMemo(() => {
    if (!diff || diff.binary || !diff.text.trim()) return null
    return getDiffStats(diff)
  }, [diff])
  const virtualChanges = useVirtualList(filteredChanges, CHANGE_LIST_ITEM_HEIGHT, `${snapshot?.summary.rootPath ?? ''}|${changeFilter}`)






  function requestConfirmation(message: string, options: ConfirmationOptions = {}): Promise<boolean> {
    if (confirmationRequest) return Promise.resolve(false)

    return new Promise((resolve) => {
      confirmationIdRef.current += 1
      setConfirmationRequest({
        id: confirmationIdRef.current,
        title: options.title ?? 'Confirm action',
        message,
        confirmLabel: options.confirmLabel ?? 'Confirm',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        variant: options.variant ?? 'default',
        resolve
      })
    })
  }

  function answerConfirmation(confirmed: boolean) {
    if (!confirmationRequest) return
    const request = confirmationRequest
    setConfirmationRequest(null)
    request.resolve(confirmed)
  }

  function requestTextInput(message: string, options: TextPromptOptions = {}): Promise<string | null> {
    if (textPromptRequest || confirmationRequest) return Promise.resolve(null)

    return new Promise((resolve) => {
      confirmationIdRef.current += 1
      setTextPromptValue(options.defaultValue ?? '')
      setTextPromptRequest({
        id: confirmationIdRef.current,
        title: options.title ?? 'Enter value',
        message,
        confirmLabel: options.confirmLabel ?? 'Save',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        defaultValue: options.defaultValue ?? '',
        placeholder: options.placeholder ?? '',
        resolve
      })
    })
  }

  function answerTextPrompt(submitted: boolean) {
    if (!textPromptRequest) return
    const request = textPromptRequest
    setTextPromptRequest(null)
    request.resolve(submitted ? textPromptValue : null)
  }

  function closeChangesActionsMenu() {
    if (changesActionsMenuRef.current) {
      changesActionsMenuRef.current.open = false
    }
  }

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
    if (!confirmationRequest) return

    const request = confirmationRequest
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setConfirmationRequest(null)
      request.resolve(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmationRequest])

  useEffect(() => {
    if (!textPromptRequest) return

    const request = textPromptRequest
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setTextPromptRequest(null)
      request.resolve(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [textPromptRequest])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const menu = changesActionsMenuRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    if (!snapshot) return

    const filterActive = changeFilter.trim().length > 0
    const visibleChanges = filterActive ? filteredChanges : snapshot.status.changes
    const firstChange = visibleChanges[0]

    if (!selectedFilePath || !visibleChanges.some((change) => change.path === selectedFilePath)) {
      setSelectedFilePath(firstChange?.path ?? null)
      setDiffMode(firstChange ? getDefaultChangeDiffMode(firstChange) : 'unstaged')
    }
  }, [changeFilter, filteredChanges, selectedFilePath, snapshot])

  useEffect(() => {
    if (!snapshot || !selectedChange) {
      diffRequestIdRef.current += 1
      setDiff(null)
      return
    }

    const availableMode = getAvailableChangeDiffMode(selectedChange, diffMode)

    if (availableMode !== diffMode) {
      setDiffMode(availableMode)
      return
    }

    void loadDiff(selectedChange, availableMode)
  }, [diffIgnoreWhitespace, diffMode, selectedChange, snapshot])


  useEffect(() => {
    if (!api || viewMode !== 'dashboard') return
    void loadRepositoryDashboard()

    if (snapshot) {
      void refreshProviderStatusOnly()
    }
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])


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
    setCurrentPullRequest(null)
    setPullRequests([])
    setSelectedPullRequestNumber(null)
    setSelectedPullRequestDetails(null)
    setSelectedPullRequestChecks([])
    setSelectedPullRequestDiff(null)
    setSelectedPullRequestFilePath(null)
    setPrTitle('')
    setPrDescription('')
    setPrBaseBranch('')
    setCreatedPullRequest(null)
  }, [snapshot?.summary.rootPath])

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

  useEffect(() => {
    if (!snapshot) return

    const mergeCandidates = snapshot.branches.filter((branch) => !branch.current)

    if (!selectedMergeBranch || !mergeCandidates.some((branch) => branch.name === selectedMergeBranch)) {
      setSelectedMergeBranch(mergeCandidates[0]?.name ?? '')
    }
  }, [selectedMergeBranch, snapshot])

  useEffect(() => {
    if (!snapshot || viewMode !== 'stash') return
    void loadStashes()
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, viewMode])

  useEffect(() => {
    if (viewMode !== 'providers') return
    void refreshProvidersPanel()
  }, [snapshot?.summary.rootPath, viewMode])

  useEffect(() => {
    if (viewMode !== 'providers' || !selectedPullRequestNumber || !githubCliStatus?.authenticated) {
      pullRequestDetailsRequestIdRef.current += 1
      setPullRequestDetailsLoading(false)
      setSelectedPullRequestDetails(null)
      setSelectedPullRequestChecks([])
      setSelectedPullRequestDiff(null)
      setSelectedPullRequestFilePath(null)
      return
    }

    void loadPullRequestDetails(selectedPullRequestNumber)
  }, [githubCliStatus?.authenticated, selectedPullRequestNumber, snapshot?.summary.rootPath, viewMode])

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
    reviewMode, setReviewMode, reviewScope, setReviewScope, reviewReport,
    preCommitReviewModes, preCommitReports, preCommitRunningMode, canRunAssistantReview, preCommitFindings, preCommitFindingsBySeverity,
    resetPreCommitReview, runReviewReport, runPreCommitReview, togglePreCommitReviewMode, openPreCommitReviewDetails
  } = useReview({ api, currentRepoPath, counts, assistantPolicy, selectedAssistant, setNotice, setError, runApiAction, runBusyOperation, setViewMode })
  const mergeState = snapshot?.status.merge
  const canCreateStash = Boolean(snapshot && counts?.changed && mergeState?.operation === 'none')
  const {
    stashMessage, setStashMessage, stashes, loadStashes, defaultStashMessage,
    createStash, createQuickStash, applyStash, dropStash
  } = useStash({ api, currentRepoPath, snapshot, canCreateStash, setNotice, setError, runSnapshotAction, requestConfirmation, requestTextInput, resetPreCommitReview, setSnapshot, setRecentRepositories })
  const bulkStageToggleState = getBulkStageToggleState(counts)
  const hasRemote = Boolean(snapshot?.summary.remoteName)
  const hasUpstream = Boolean(snapshot?.summary.upstream)
  const canFetch = Boolean(snapshot && hasRemote)
  const canPull = Boolean(snapshot && !snapshot.summary.isDetached && hasUpstream)
  const canPush = Boolean(snapshot && !snapshot.summary.isDetached && hasUpstream)
  const canPublishBranch = Boolean(snapshot && !snapshot.summary.isDetached && !snapshot.summary.upstream && snapshot.summary.remoteName)
  const selectedFileTarget = currentRepoPath && selectedChange ? `${currentRepoPath}/${selectedChange.path}` : null
  const canGenerateCommitText = assistantPolicyAllows(assistantPolicy, 'commit_message')
  const canGeneratePullRequestText = assistantPolicyAllows(assistantPolicy, 'pull_request_text')
  const canGenerateLinkedInProject = assistantPolicyAllows(assistantPolicy, 'linkedin_project')
  const {
    linkedinProject, setLinkedInProject, linkedinHighlightsText, setLinkedinHighlightsText,
    linkedinTagsText, setLinkedinTagsText, linkedinSkillsText, setLinkedinSkillsText,
    linkedinRole, setLinkedInRole, linkedinAudience, setLinkedInAudience,
    linkedinProjectUrl, setLinkedInProjectUrl, linkedinLoading,
    generateLinkedInProject, updateLinkedInProject, copyLinkedInMarkdown, copyLinkedInTags
  } = useLinkedIn({ api, currentRepoPath, selectedAssistant, assistantPolicy, canGenerateLinkedInProject, setNotice, setError, setBusy, copyToClipboard, loadProjectMemory })
  const commitActionState = getCommitActionState({ snapshot, title: commitTitle })
  const commitAndPushActionState = getCommitAndPushActionState({ snapshot, title: commitTitle })
  const amendCommitActionState = getAmendCommitActionState({ snapshot, title: commitTitle })

  async function loadRecentRepositories() {
    if (!api) return
    const result = await api.getRecentRepositories()
    if (result.ok) setRecentRepositories(result.data)
  }

  async function loadRepositoryDashboard() {
    if (!api) return

    const requestId = dashboardRequestIdRef.current + 1
    dashboardRequestIdRef.current = requestId
    setDashboardLoading(true)
    const result = await api.getRepositoryDashboard(currentRepoPath)

    if (dashboardRequestIdRef.current !== requestId) return

    if (result.ok) {
      setRepositoryDashboard(result.data)
    } else {
      setError(result.error.message)
    }

    setDashboardLoading(false)
  }

  async function toggleRepositoryPinned(repo: RecentRepository) {
    if (!api) return

    const result = await api.setRepositoryPinned({
      repoPath: repo.path,
      pinned: !repo.pinned
    })

    if (result.ok) {
      setRecentRepositories(result.data)
      if (viewMode === 'dashboard') {
        void loadRepositoryDashboard()
      }
    } else {
      setError(result.error.message)
    }
  }

  async function loadProviders() {
    if (!api) return
    const result = await api.listProviders()
    if (result.ok) setProviders(result.data)
  }

  async function loadGitHubCliStatus(): Promise<GitHubCliStatus | null> {
    if (!api) return null
    const result = await api.getGitHubCliStatus(currentRepoPath)

    if (result.ok) {
      setGithubCliStatus(result.data)
      return result.data
    } else {
      setError(result.error.message)
      return null
    }
  }

  async function loadGitHubPullRequests() {
    if (!api || !currentRepoPath) {
      setCurrentPullRequest(null)
      setPullRequests([])
      setSelectedPullRequestNumber(null)
      return
    }

    setPullRequestsLoading(true)
    const [currentResult, listResult] = await Promise.all([
      api.getCurrentBranchPullRequest(currentRepoPath),
      api.listGitHubPullRequests(currentRepoPath)
    ])
    setPullRequestsLoading(false)

    if (currentResult.ok) {
      setCurrentPullRequest(currentResult.data)
    } else {
      setCurrentPullRequest(null)
      setError(currentResult.error.message)
    }

    if (listResult.ok) {
      setPullRequests(listResult.data)
      setSelectedPullRequestNumber((currentNumber) => {
        if (currentNumber && listResult.data.some((pullRequest) => pullRequest.number === currentNumber)) {
          return currentNumber
        }

        return currentResult.ok && currentResult.data
          ? currentResult.data.number
          : listResult.data[0]?.number ?? null
      })
    } else {
      setPullRequests([])
      setSelectedPullRequestNumber(null)
      setError(listResult.error.message)
    }
  }

  async function loadGitHubAccounts(statusOverride?: GitHubCliStatus | null) {
    if (!api) return

    setGithubAccountsLoading(true)
    setError(null)
    const status = statusOverride ?? githubCliStatus ?? await loadGitHubCliStatus()

    if (!status?.authenticated) {
      setGithubAccounts([])
      setNotice('Run gh auth login or sign in with GitHub Desktop before loading GitHub accounts.')
      setGithubAccountsLoading(false)
      return
    }

    const result = await api.listGitHubAccounts()

    if (result.ok) {
      setGithubAccounts(result.data)
      setGithubRepoOwner((currentOwner) => currentOwner || result.data[0]?.login || '')
      setNotice(`Loaded ${result.data.length} GitHub account${result.data.length === 1 ? '' : 's'}.`)
    } else {
      setGithubAccounts([])
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setGithubAccountsLoading(false)
  }

  async function loadGitHubRepositories() {
    if (!api) return

    setGithubRepoLoading(true)
    setError(null)
    const status = githubCliStatus ?? await loadGitHubCliStatus()

    if (!status?.authenticated) {
      setGithubRepositories([])
      setNotice('Run gh auth login or sign in with GitHub Desktop before browsing repositories.')
      setGithubRepoLoading(false)
      return
    }

    const result = await api.listGitHubRepositories({
      owner: githubRepoOwner.trim() || undefined,
      query: githubRepoQuery.trim() || undefined,
      visibility: githubRepoVisibility,
      limit: Math.min(100, Math.max(1, Number.parseInt(githubRepoLimit, 10) || 30))
    })

    if (result.ok) {
      setGithubRepositories(result.data)
      setNotice(`Loaded ${result.data.length} GitHub repositor${result.data.length === 1 ? 'y' : 'ies'}.`)
    } else {
      setGithubRepositories([])
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setGithubRepoLoading(false)
  }

  async function cloneGitHubRepository(repository: GitHubRepositorySummary, protocol: 'https' | 'ssh') {
    if (!api) return
    const remoteUrl = protocol === 'ssh' ? repository.sshUrl : repository.url

    if (!remoteUrl) {
      setNotice(`${protocol.toUpperCase()} clone URL is not available for ${repository.nameWithOwner}.`)
      return
    }

    await runBusyOperation(`Cloning ${repository.nameWithOwner}...`, async () => {
      const result = await api.cloneRepository({
        remoteUrl,
        targetName: repository.name
      })

      if (result.ok && result.data) {
        applySnapshot(result.data, `${repository.nameWithOwner} cloned.`)
        setViewMode('changes')
      } else if (result.ok) {
        setNotice('Clone canceled.')
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  async function refreshProvidersPanel() {
    void loadProviders()
    const status = await loadGitHubCliStatus()

    if (status?.authenticated) {
      await loadGitHubAccounts(status)
    } else {
      setGithubAccounts([])
    }

    if (status?.authenticated && currentRepoPath) {
      await loadGitHubPullRequests()
    } else {
      setCurrentPullRequest(null)
      setPullRequests([])
      setSelectedPullRequestNumber(null)
    }
  }

  async function refreshProviderStatusOnly() {
    void loadProviders()
    await loadGitHubCliStatus()
  }

  async function loadPullRequestDetails(prNumber: number) {
    if (!api || !currentRepoPath) return
    const requestId = pullRequestDetailsRequestIdRef.current + 1
    pullRequestDetailsRequestIdRef.current = requestId
    setPullRequestDetailsLoading(true)
    setError(null)
    setSelectedPullRequestDetails((currentDetails) => currentDetails?.number === prNumber ? currentDetails : null)
    setSelectedPullRequestChecks([])
    setSelectedPullRequestDiff((currentDiff) => currentDiff?.prNumber === prNumber ? currentDiff : null)
    setSelectedPullRequestFilePath((currentPath) =>
      selectedPullRequestDiff?.prNumber === prNumber ? currentPath : null
    )

    const request = {
      repoPath: currentRepoPath,
      prNumber
    }
    const [detailsResult, checksResult, diffResult] = await Promise.all([
      api.getGitHubPullRequestDetails(request),
      githubCliStatus?.ghAuthenticated ? api.getGitHubPullRequestChecks(request) : Promise.resolve<ApiResult<GitHubPullRequestCheck[]>>({ ok: true, data: [] }),
      api.getGitHubPullRequestDiff(request)
    ])

    if (pullRequestDetailsRequestIdRef.current !== requestId) return

    if (detailsResult.ok) {
      setSelectedPullRequestDetails(detailsResult.data)
    } else {
      setSelectedPullRequestDetails(null)
      setError(detailsResult.error.message)
    }

    if (checksResult.ok) {
      setSelectedPullRequestChecks(checksResult.data)
    } else {
      setSelectedPullRequestChecks([])
      setError(checksResult.error.message)
    }

    if (diffResult.ok) {
      setSelectedPullRequestDiff(diffResult.data)
      setSelectedPullRequestFilePath((currentPath) =>
        currentPath && diffResult.data.files.some((file) => file.path === currentPath)
          ? currentPath
          : diffResult.data.files[0]?.path ?? null
      )
    } else {
      setSelectedPullRequestDiff(null)
      setSelectedPullRequestFilePath(null)
      setError(diffResult.error.message)
    }

    setPullRequestDetailsLoading(false)
  }

  async function chooseRepository() {
    if (!api) return
    await runBusyOperation('Opening repository...', async () => {
      const result = await api.chooseAndOpenRepository()

      if (result.ok && result.data) {
        applySnapshot(result.data, 'Repository opened.')
      } else if (!result.ok) {
        setError(result.error.message)
      }
    })
  }

  async function openRepository(path: string): Promise<boolean> {
    if (!api) return false
    return runBusyOperation('Opening repository...', async () => {
      const result = await api.openRepository(path)
      applySnapshotResult(result, 'Repository opened.')
      return result.ok
    })
  }

  async function cloneRepository() {
    if (!api) return
    const remoteUrl = cloneRemoteUrl.trim()

    if (!remoteUrl) {
      setNotice('Clone blocked: add a repository URL.')
      return
    }

    await runBusyOperation('Cloning repository...', async () => {
      const result = await api.cloneRepository({
        remoteUrl,
        targetName: cloneTargetName.trim() || undefined
      })

      if (result.ok && result.data) {
        setCloneRemoteUrl('')
        setCloneTargetName('')
        applySnapshot(result.data, 'Repository cloned.')
      } else if (!result.ok) {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  async function refreshRepository(message = 'Repository refreshed.') {
    if (!api || !currentRepoPath) return
    await runBusyOperation('Refreshing repository...', async () => {
      const result = await api.refreshRepository(currentRepoPath)
      applySnapshotResult(result, message)
    })
  }

  async function loadDiff(change: FileChange, mode: DiffMode) {
    if (!api || !currentRepoPath) return
    const requestId = diffRequestIdRef.current + 1
    diffRequestIdRef.current = requestId
    const staged = mode === 'staged' && change.staged
    const result = await api.getDiff({
      repoPath: currentRepoPath,
      filePath: change.path,
      staged,
      ignoreWhitespace: diffIgnoreWhitespace
    })

    if (diffRequestIdRef.current !== requestId) return

    if (result.ok) {
      setDiff(result.data)
    } else {
      setDiff(null)
      setError(result.error.message)
    }
  }

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

  async function toggleChangeStage(change: FileChange) {
    if (!api || !currentRepoPath) return
    const action = getChangeStageToggleAction(change)

    if (action === 'none') return

    setSelectedFilePath(change.path)

    if (action === 'unstage') {
      await runSnapshotAction(
        'File unstaged.',
        () => api.unstageFile({ repoPath: currentRepoPath, filePath: change.path }),
        'Unstaging file...'
      )
      setDiffMode('unstaged')
      return
    }

    await runSnapshotAction(
      'File staged.',
      () => api.stageFile({ repoPath: currentRepoPath, filePath: change.path }),
      'Staging file...'
    )
    setDiffMode('staged')
  }

  async function toggleBulkStage() {
    if (!api || !currentRepoPath) return
    const action = getBulkStageToggleAction(counts)

    if (action === 'stage_all') {
      await runSnapshotAction('All changes staged.', () => api.stageAll(currentRepoPath), 'Staging all changes...')
      return
    }

    if (action === 'unstage_all') {
      await runSnapshotAction('All changes unstaged.', () => api.unstageAll(currentRepoPath), 'Unstaging all changes...')
    }
  }

  async function stageSelectedHunk(hunk: DiffHunk) {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction(
      'Hunk staged.',
      () =>
        api.stageHunk({
          repoPath: currentRepoPath,
          filePath: selectedChange.path,
          patch: hunk.patch
        }),
      'Staging hunk...'
    )
  }

  async function unstageSelectedHunk(hunk: DiffHunk) {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction(
      'Hunk unstaged.',
      () =>
        api.unstageHunk({
          repoPath: currentRepoPath,
          filePath: selectedChange.path,
          patch: hunk.patch
        }),
      'Unstaging hunk...'
    )
  }

  async function discardSelected() {
    if (!api || !currentRepoPath || !selectedChange) return
    const isUntracked = selectedChange.untracked
    const confirmed = await requestConfirmation(
      isUntracked
        ? `Delete untracked file ${selectedChange.path}?`
        : `Discard local changes in ${selectedChange.path}?`,
      {
        title: isUntracked ? 'Delete Untracked File' : 'Discard File Changes',
        confirmLabel: isUntracked ? 'Delete file' : 'Discard changes',
        variant: 'danger'
      }
    )
    if (!confirmed) return

    const action = isUntracked ? api.deleteUntrackedFile : api.discardFile

    await runSnapshotAction(
      isUntracked ? 'Untracked file deleted.' : 'File discarded.',
      () => action({ repoPath: currentRepoPath, filePath: selectedChange.path, confirmed }),
      isUntracked ? 'Deleting file...' : 'Discarding file changes...'
    )
  }

  async function commitChanges(): Promise<boolean> {
    if (!api || !currentRepoPath) return false
    if (!commitActionState.enabled) {
      setNotice(`Commit blocked: ${commitActionState.reasons.join(' ')}`)
      return false
    }

    const committed = await runSnapshotAction(
      'Commit created.',
      () =>
        api.commit({
          repoPath: currentRepoPath,
          title: commitTitle,
          description: commitDescription,
          coAuthors: commitCoAuthors
        }),
      'Creating commit...'
    )

    if (committed) {
      setCommitTitle('')
      setCommitDescription('')
      setCommitCoAuthors('')
      resetPreCommitReview()
    }

    return committed
  }

  async function amendLastCommit(): Promise<boolean> {
    if (!api || !currentRepoPath) return false
    if (!amendCommitActionState.enabled) {
      setNotice(`Amend blocked: ${amendCommitActionState.reasons.join(' ')}`)
      return false
    }

    const confirmed = await requestConfirmation('Amend the last commit? This rewrites the current branch HEAD.', {
      title: 'Amend Commit',
      confirmLabel: 'Amend commit',
      variant: 'danger'
    })
    if (!confirmed) return false

    const amended = await runSnapshotAction(
      'Commit amended.',
      () =>
        api.amendCommit({
          repoPath: currentRepoPath,
          title: commitTitle,
          description: commitDescription,
          coAuthors: commitCoAuthors,
          confirmed
        }),
      'Amending commit...'
    )

    if (amended) {
      setCommitTitle('')
      setCommitDescription('')
      setCommitCoAuthors('')
      resetPreCommitReview()
    }

    return amended
  }

  async function exportPatch() {
    if (!api || !currentRepoPath) return

    await runApiAction('Exporting patch...', () => api.exportPatch({
      repoPath: currentRepoPath,
      scope: patchScope
    }), (data) => {
      setNotice(data ? `Patch exported: ${data.fileName}` : 'Patch export cancelled.')
    })
  }

  async function applyPatch() {
    if (!api || !currentRepoPath) return

    const confirmed = await requestConfirmation('Apply a patch file to the working tree?', {
      title: 'Apply Patch',
      confirmLabel: 'Apply patch'
    })
    if (!confirmed) return

    await runApiAction('Applying patch...', () => api.applyPatch({
      repoPath: currentRepoPath,
      confirmed
    }), (data) => {
      if (data) {
        applySnapshot(data, 'Patch applied.')
      } else {
        setNotice('Patch apply cancelled.')
      }
    })
  }

  async function startMergeOperation(kind: 'merge' | 'rebase') {
    if (!api || !currentRepoPath || !selectedMergeBranch) return

    const currentBranch = snapshot?.summary.currentBranch ?? 'the current branch'
    const confirmed = await requestConfirmation(
      kind === 'merge'
        ? `Merge ${selectedMergeBranch} into ${currentBranch}?`
        : `Rebase ${currentBranch} onto ${selectedMergeBranch}? This rewrites the commits of ${currentBranch}.`,
      {
        title: kind === 'merge' ? 'Merge Branch' : 'Rebase Branch',
        confirmLabel: kind === 'merge' ? 'Merge' : 'Rebase',
        variant: kind === 'merge' ? 'default' : 'danger'
      }
    )
    if (!confirmed) return

    await runBusyOperation(kind === 'merge' ? 'Merging branch...' : 'Rebasing branch...', async () => {
      const result = kind === 'merge'
        ? await api.mergeBranch({ repoPath: currentRepoPath, branchName: selectedMergeBranch })
        : await api.rebaseBranch({ repoPath: currentRepoPath, branchName: selectedMergeBranch })

      if (result.ok) {
        const cleanLabel = kind === 'merge' ? 'Merge complete.' : 'Rebase complete.'
        const conflictLabel = kind === 'merge' ? 'Merge has conflicts.' : 'Rebase has conflicts.'
        applySnapshot(result.data, result.data.status.merge.operation === 'none' ? cleanLabel : conflictLabel)
        setViewMode('merge')
        void loadHistory()
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  async function continueMergeOperation() {
    if (!api || !currentRepoPath) return
    const continued = await runSnapshotAction('Operation continued.', () => api.continueMergeOperation(currentRepoPath))

    if (continued) {
      void loadHistory()
    }
  }

  async function abortCurrentOperation() {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation('Abort the current Git operation?', {
      title: 'Abort Git Operation',
      confirmLabel: 'Abort operation',
      variant: 'danger'
    })
    if (!confirmed) return

    await runSnapshotAction('Operation aborted.', () => api.abortMergeOperation(currentRepoPath))
  }

  async function acceptConflictSide(filePath: string, side: 'ours' | 'theirs') {
    if (!api || !currentRepoPath) return
    // During a rebase, Git swaps the meaning: "ours" is the branch being rebased onto.
    const rebaseHint = mergeState?.operation === 'rebase'
      ? ` During a rebase, "${side}" means ${side === 'ours' ? 'the base branch you are rebasing onto' : 'the commits being replayed'}.`
      : ''
    const confirmed = await requestConfirmation(
      `Resolve ${filePath} by keeping ${side === 'ours' ? 'our' : 'their'} version? The other side's changes in this file are discarded.${rebaseHint}`,
      {
        title: side === 'ours' ? 'Accept Ours' : 'Accept Theirs',
        confirmLabel: side === 'ours' ? 'Keep ours' : 'Keep theirs',
        variant: 'danger'
      }
    )
    if (!confirmed) return

    await runSnapshotAction(
      side === 'ours' ? 'Accepted ours.' : 'Accepted theirs.',
      () => side === 'ours'
        ? api.acceptOurs({ repoPath: currentRepoPath, filePath })
        : api.acceptTheirs({ repoPath: currentRepoPath, filePath })
    )
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

  async function generateCommitText() {
    if (!api || !currentRepoPath) return
    if (!canGenerateCommitText) {
      setNotice(assistantPolicyBlockedLabel('commit_message', assistantPolicy))
      return
    }

    if (
      (commitTitle.trim() || commitDescription.trim()) &&
      !(await requestConfirmation('Replace the current commit title and description?', {
        title: 'Replace Commit Text',
        confirmLabel: 'Replace text'
      }))
    ) {
      return
    }

    await runApiAction('Generating commit text...', () => api.generateCommitMessage({
      repoPath: currentRepoPath,
      assistant: selectedAssistant
    }), (data) => {
      setCommitTitle(data.title)
      setCommitDescription(data.description)
      setNotice(`Generated with ${assistantLabel(data.assistant)}${data.truncated ? ' from truncated diff' : ''}.`)
    })
  }

  async function generatePullRequestText() {
    if (!api || !currentRepoPath) return
    if (!canGeneratePullRequestText) {
      setNotice(assistantPolicyBlockedLabel('pull_request_text', assistantPolicy))
      return
    }

    if (
      (prTitle.trim() || prDescription.trim()) &&
      !(await requestConfirmation('Replace the current pull request title and description?', {
        title: 'Replace Pull Request Text',
        confirmLabel: 'Replace text'
      }))
    ) {
      return
    }

    await runApiAction('Generating pull request text...', () => api.generatePullRequestText({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      baseBranch: prBaseBranch.trim() || undefined
    }), (data) => {
      setPrTitle(data.title)
      setPrDescription(data.description)
      setPrBaseBranch(data.baseBranch)
      setCreatedPullRequest(null)
      setNotice(`Generated PR text with ${assistantLabel(data.assistant)}${data.truncated ? ' from truncated diff' : ''}.`)
    })
  }

  async function createPullRequest() {
    if (!api || !currentRepoPath) return
    await runBusyOperation('Creating pull request...', async () => {
      const result = await api.createGitHubPullRequest({
        repoPath: currentRepoPath,
        title: prTitle,
        description: prDescription,
        baseBranch: prBaseBranch.trim() || undefined
      })

      if (result.ok) {
        setCreatedPullRequest(result.data)
        setNotice('Pull request created.')
        // Keep busy until the panel reflects the new PR; otherwise the Create
        // button re-enables while the stale list still shows no PR.
        await refreshProvidersPanel()
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  async function checkoutPullRequest(pullRequest: GitHubPullRequest) {
    if (!api || !currentRepoPath) return

    const checkedOut = await runSnapshotAction(`Checked out PR #${pullRequest.number}.`, () =>
      api.checkoutGitHubPullRequest({
        repoPath: currentRepoPath,
        prNumber: pullRequest.number
      })
    )

    if (checkedOut) {
      setViewMode('changes')
      setCreatedPullRequest(null)
      void loadHistory()
      void refreshProvidersPanel()
    }
  }

  function selectPullRequest(pullRequest: GitHubPullRequest) {
    setSelectedPullRequestNumber(pullRequest.number)
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

  async function openRepoInEditor() {
    if (!api || !currentRepoPath) return
    await runOperationAction('Repository opened in editor.', () => api.openInEditor({ targetPath: currentRepoPath }))
  }

  async function openSelectedFileInEditor() {
    if (!api || !selectedFileTarget) return
    await runOperationAction('File opened in editor.', () => api.openInEditor({ targetPath: selectedFileTarget }))
  }

  async function openSelectedFileLineInEditor(line?: number) {
    if (!api || !selectedFileTarget || !line) return
    await runOperationAction(`File opened at line ${line}.`, () => api.openInEditor({
      targetPath: selectedFileTarget,
      line
    }))
  }

  async function openRepositoryTerminal() {
    if (!api || !currentRepoPath) return
    await runOperationAction('Terminal opened.', () => api.openTerminal(currentRepoPath))
  }

  const navigation = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'changes' as const, label: 'Changes', icon: GitCommitHorizontal },
    { id: 'history' as const, label: 'History', icon: Clock3 },
    { id: 'merge' as const, label: 'Merge', icon: GitMerge },
    { id: 'branches' as const, label: 'Branches', icon: GitBranch },
    { id: 'config' as const, label: 'Git Config', icon: Settings },
    { id: 'stash' as const, label: 'Stash', icon: Save },
    { id: 'review' as const, label: 'Review', icon: ShieldCheck },
    { id: 'providers' as const, label: 'Providers', icon: GitPullRequest },
    { id: 'memory' as const, label: 'Memory', icon: Database },
    { id: 'daily' as const, label: 'Daily', icon: CalendarDays },
    { id: 'linkedin' as const, label: 'LinkedIn', icon: Star }
  ]

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">BP</div>
          <div>
            <strong>BranchPilot</strong>
            <span>Local-first Git client</span>
          </div>
        </div>

        <button className="repo-picker" type="button" onClick={chooseRepository} disabled={!api || busy}>
          <FolderOpen size={18} />
          <span>{snapshot?.summary.name ?? 'Open repository'}</span>
        </button>

        <nav className="nav-list" aria-label="Primary">
          {navigation.map((item) => (
            <button
              className={viewMode === item.id ? 'active' : ''}
              type="button"
              key={item.id}
              onClick={() => setViewMode(item.id)}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="recent-list">
          <div className="recent-list-heading">
            <span className="section-label">Recent repositories</span>
            <span>{filteredRecentRepositories.length} / {recentRepositories.length}</span>
          </div>
          {recentRepositories.length > 0 && (
            <div className="recent-filter">
              <label htmlFor="recent-repository-filter">
                <Search size={14} />
                <input
                  id="recent-repository-filter"
                  value={recentRepositoryFilter}
                  onChange={(event) => setRecentRepositoryFilter(event.target.value)}
                  placeholder="Search repos"
                />
              </label>
              {recentRepositoryFilter && (
                <button type="button" aria-label="Clear repository search" onClick={() => setRecentRepositoryFilter('')}>
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {recentRepositories.length === 0 ? (
            <p>No recent repositories.</p>
          ) : filteredRecentRepositories.length === 0 ? (
            <p>No repositories match this search.</p>
          ) : (
            filteredRecentRepositories.map((repo) => (
              <article className={repo.pinned ? 'recent-repo-row pinned' : 'recent-repo-row'} key={repo.path}>
                <button className="recent-repo-open" type="button" onClick={() => openRepository(repo.path)}>
                  <strong>{repo.name}</strong>
                  <span>{repo.path}</span>
                </button>
                <button
                  className={repo.pinned ? 'recent-pin-button pinned' : 'recent-pin-button'}
                  type="button"
                  aria-label={repo.pinned ? `Unpin ${repo.name}` : `Pin ${repo.name}`}
                  title={repo.pinned ? 'Unpin repository' : 'Pin repository'}
                  onClick={() => toggleRepositoryPinned(repo)}
                  disabled={!api || busy}
                >
                  <Star size={16} fill={repo.pinned ? 'currentColor' : 'none'} />
                </button>
              </article>
            ))
          )}
        </div>

        <div className="runtime-status">
          <span>
            <Check size={15} />
            v{appVersion}
          </span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Repository workspace</p>
            <h1>{snapshot?.summary.currentBranch ?? 'No repository selected'}</h1>
            <p className="repo-path">{snapshot?.summary.rootPath ?? 'Open a Git repository to inspect real changes.'}</p>
            {snapshot && (
              <div className="repo-meta" aria-label="Repository sync state">
                <span>{snapshot.summary.isDetached ? 'Detached HEAD' : snapshot.summary.upstream ?? 'No upstream'}</span>
                <span>{hasRemote ? `Remote: ${snapshot.summary.remoteName}` : 'No remote'}</span>
                <span>{snapshot.summary.ahead} ahead</span>
                <span>{snapshot.summary.behind} behind</span>
              </div>
            )}
          </div>
          <div className="toolbar" aria-label="Repository actions">
            <button type="button" onClick={openRepoInEditor} disabled={!snapshot || busy}>
              <Code2 size={17} />
              Open repo
            </button>
            <button type="button" onClick={openSelectedFileInEditor} disabled={!selectedFileTarget || busy}>
              <Code2 size={17} />
              Open file
            </button>
            <button type="button" onClick={openRepositoryTerminal} disabled={!snapshot || busy}>
              <Terminal size={17} />
              Terminal
            </button>
            <button type="button" onClick={() => refreshRepository()} disabled={!snapshot || busy}>
              <RefreshCcw size={17} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => currentRepoPath && runSnapshotAction('Fetch complete.', () => api!.fetch(currentRepoPath))}
              disabled={!canFetch || busy}
            >
              <ArrowDownToLine size={17} />
              Fetch
            </button>
            <button
              type="button"
              onClick={() => currentRepoPath && runSnapshotAction('Pull complete.', () => api!.pull(currentRepoPath))}
              disabled={!canPull || busy}
            >
              <ArrowDownToLine size={17} />
              Pull
            </button>
            <button
              type="button"
              onClick={() => currentRepoPath && runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))}
              disabled={!canPush || busy}
            >
              <ArrowUpFromLine size={17} />
              Push
            </button>
            {canPublishBranch && (
              <button
                type="button"
                onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
                  repoPath: currentRepoPath,
                  remote: snapshot.summary.remoteName
                }))}
                disabled={!snapshot || busy}
              >
                <UploadCloud size={17} />
                Publish branch
              </button>
            )}
          </div>
        </header>

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
          <section className="empty-state">
            <FolderOpen size={42} />
            <h2>Open a local Git repository</h2>
            <p>BranchPilot will read status, diffs, branches, merge state, and local Git configuration.</p>
            <button type="button" onClick={chooseRepository} disabled={!api || busy}>
              <FolderOpen size={17} />
              Open repository
            </button>
            <div className="clone-panel">
              <div>
                <strong>Clone repository</strong>
                <span>Use system Git and your existing credentials.</span>
              </div>
              <input
                aria-label="Clone repository URL"
                value={cloneRemoteUrl}
                onChange={(event) => setCloneRemoteUrl(event.target.value)}
                placeholder="https://github.com/owner/repo.git"
                disabled={!api || busy}
              />
              <input
                aria-label="Clone folder name"
                value={cloneTargetName}
                onChange={(event) => setCloneTargetName(event.target.value)}
                placeholder="Optional folder name"
                disabled={!api || busy}
              />
              <button type="button" onClick={cloneRepository} disabled={!api || busy || !cloneRemoteUrl.trim()}>
                <ArrowDownToLine size={17} />
                Clone
              </button>
            </div>
          </section>
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
        <div className="confirmation-backdrop" role="presentation">
          <section
            className={`confirmation-dialog ${confirmationRequest.variant === 'danger' ? 'danger' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`confirmation-title-${confirmationRequest.id}`}
          >
            <div>
              <h2 id={`confirmation-title-${confirmationRequest.id}`}>{confirmationRequest.title}</h2>
              <p>{confirmationRequest.message}</p>
            </div>
            <div className="confirmation-actions">
              <button type="button" className="secondary" onClick={() => answerConfirmation(false)}>
                {confirmationRequest.cancelLabel}
              </button>
              <button
                type="button"
                className={confirmationRequest.variant === 'danger' ? 'danger-button' : ''}
                onClick={() => answerConfirmation(true)}
              >
                {confirmationRequest.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
      {textPromptRequest && (
        <div className="confirmation-backdrop" role="presentation">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`confirmation-title-${textPromptRequest.id}`}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault()
                answerTextPrompt(true)
              }}
            >
              <div>
                <h2 id={`confirmation-title-${textPromptRequest.id}`}>{textPromptRequest.title}</h2>
                <p>{textPromptRequest.message}</p>
                <input
                  className="text-prompt-input"
                  autoFocus
                  value={textPromptValue}
                  placeholder={textPromptRequest.placeholder}
                  onChange={(event) => setTextPromptValue(event.target.value)}
                  onFocus={(event) => event.target.select()}
                />
              </div>
              <div className="confirmation-actions">
                <button type="button" className="secondary" onClick={() => answerTextPrompt(false)}>
                  {textPromptRequest.cancelLabel}
                </button>
                <button type="submit" disabled={!textPromptValue.trim()}>
                  {textPromptRequest.confirmLabel}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  )



  function renderPreCommitReviewPanel() {
    const selectedModeLabels = preCommitReviewModes.map(reviewModeLabel).join(', ')
    const displayedFindings = preCommitFindings.slice(0, 5)
    const hiddenFindingCount = Math.max(0, preCommitFindings.length - displayedFindings.length)
    const hasHighRiskFindings = preCommitFindingsBySeverity.critical.length > 0 || preCommitFindingsBySeverity.high.length > 0
    const isRunning = Boolean(preCommitRunningMode)

    return (
      <section className={`precommit-review ${hasHighRiskFindings ? 'has-risk' : ''}`}>
        <div className="precommit-heading">
          <div>
            <h3>Pre-commit review</h3>
            <p>Optional staged diff review before committing.</p>
          </div>
          <span>Staged only</span>
        </div>

        <div className="precommit-controls">
          <div className="segmented precommit-modes" aria-label="Pre-commit review modes">
            {reviewModes.map((mode) => (
              <button
                aria-pressed={preCommitReviewModes.includes(mode)}
                className={preCommitReviewModes.includes(mode) ? 'active' : ''}
                type="button"
                key={mode}
                onClick={() => togglePreCommitReviewMode(mode)}
                disabled={busy}
              >
                {reviewModeLabel(mode)}
              </button>
            ))}
          </div>
          <button type="button" onClick={runPreCommitReview} disabled={busy || !counts?.staged || preCommitReviewModes.length === 0 || !canRunAssistantReview}>
            {isRunning ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
            {isRunning ? `Reviewing ${reviewModeLabel(preCommitRunningMode!)}` : 'Review staged diff'}
          </button>
        </div>

        {!counts?.staged ? (
          <div className="precommit-empty">Stage files to review the exact diff that will be committed.</div>
        ) : !canRunAssistantReview ? (
          <div className="precommit-empty">{assistantPolicyBlockedLabel('review_report', assistantPolicy)}</div>
        ) : preCommitReviewModes.length === 0 ? (
          <div className="precommit-empty">Select at least one review mode.</div>
        ) : isRunning && preCommitReports.length === 0 ? (
          <div className="precommit-empty">Running {reviewModeLabel(preCommitRunningMode!)} review for {selectedModeLabels}.</div>
        ) : preCommitReports.length === 0 ? (
          <div className="precommit-empty">Review staged diff before committing. Commit stays available either way.</div>
        ) : (
          <div className="precommit-results">
            <div className="precommit-summary">
              <strong>{preCommitFindings.length === 0 ? 'No actionable findings in staged diff.' : `${preCommitFindings.length} findings in staged diff.`}</strong>
              <span>{preCommitReports.length} mode{preCommitReports.length === 1 ? '' : 's'} reviewed{preCommitReports.some((report) => report.truncated) ? ' / truncated' : ''}</span>
            </div>

            <div className="severity-strip precommit-severity">
              {reviewSeverities.map((severity) => (
                <div className={`severity-count severity-${severity}`} key={severity}>
                  <span>{severity}</span>
                  <strong>{preCommitFindingsBySeverity[severity].length}</strong>
                </div>
              ))}
            </div>

            {hasHighRiskFindings && (
              <div className="precommit-warning">High-risk findings found. Commit is still available.</div>
            )}

            {displayedFindings.length > 0 && (
              <div className="precommit-finding-list">
                {displayedFindings.map((finding, index) => (
                  <article className={`finding-card compact severity-${finding.severity}`} key={`${finding.mode}-${finding.severity}-${finding.title}-${index}`}>
                    <div className="finding-heading">
                      <span>{finding.severity}</span>
                      <strong>{finding.title}</strong>
                    </div>
                    <code>{reviewModeLabel(finding.mode)}{finding.filePath ? ` / ${finding.filePath}${finding.line ? `:${finding.line}` : ''}` : ''}</code>
                    <p>{finding.details}</p>
                  </article>
                ))}
                {hiddenFindingCount > 0 && <div className="precommit-empty">{hiddenFindingCount} more findings in the full review.</div>}
              </div>
            )}

            <button type="button" className="secondary precommit-details" onClick={openPreCommitReviewDetails}>
              <ExternalLink size={17} />
              Open full review
            </button>
          </div>
        )}
      </section>
    )
  }

  function renderAssistantReadiness(action: AssistantActionKind) {
    const summary = assistantReadinessSummary(assistants, selectedAssistant)

    return (
      <div className={`assistant-readiness state-${summary.state}`}>
        <div>
          <span>{assistantActionLabel(action)}</span>
          <strong>{summary.title}</strong>
          <p>{summary.message}</p>
        </div>
        <button type="button" onClick={checkAssistants} disabled={assistantsChecking}>
          {assistantsChecking ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
          {assistantsChecking ? 'Checking' : 'Check'}
        </button>
      </div>
    )
  }







  function renderAssistantPolicyPanel() {
    const mode = assistantPolicy?.settings.mode ?? 'suggest-only'
    const lockedModes = assistantPolicy?.lockedModes ?? ['allow-local-commands', 'allow-file-edits']
    const actions: AssistantActionKind[] = ['commit_message', 'branch_draft', 'pull_request_text', 'linkedin_project', 'review_report']

    return (
      <section className="assistant-policy-panel">
        <div className="assistant-policy-heading">
          <div>
            <h3>Assistant policy</h3>
            <p>Per-repository permissions for Claude Code and Codex.</p>
          </div>
          <span>{assistantPolicyLoading ? 'Loading' : assistantPolicyModeLabel(mode)}</span>
        </div>

        <div className="segmented assistant-policy-modes" aria-label="Assistant policy modes">
          {assistantPolicyModes.map((candidateMode) => {
            const locked = lockedModes.includes(candidateMode)

            return (
              <button
                aria-pressed={mode === candidateMode}
                className={`${mode === candidateMode ? 'active' : ''} ${locked ? 'locked' : ''}`.trim()}
                disabled={!snapshot || assistantPolicyLoading || locked}
                key={candidateMode}
                onClick={() => updateAssistantPolicy(candidateMode)}
                type="button"
              >
                {assistantPolicyModeLabel(candidateMode)}
                {locked ? ' · future' : ''}
              </button>
            )
          })}
        </div>

        <div className="assistant-policy-actions">
          {actions.map((action) => {
            const allowed = assistantPolicyAllows(assistantPolicy, action)

            return (
              <div className={allowed ? 'allowed' : 'blocked'} key={action}>
                {allowed ? <Check size={15} /> : <X size={15} />}
                <span>{assistantActionLabel(action)}</span>
              </div>
            )
          })}
        </div>

        <div className="assistant-policy-copy">
          Assistants receive explicit local context only. BranchPilot v1 does not grant file write access, shell write access, auto-apply, or silent approval expansion.
          Destructive Git operations still require their own confirmations.
        </div>

        {assistantPolicy?.settings.updatedAt && (
          <div className="assistant-policy-updated">Updated {formatDate(assistantPolicy.settings.updatedAt)}</div>
        )}
      </section>
    )
  }




  function renderGitHubRepositoryBrowser() {
    const repoBrowserReady = Boolean(githubCliStatus?.authenticated)

    return (
      <section className="github-repo-browser">
        <div className="panel-heading compact-heading">
          <div>
            <h3>GitHub repositories</h3>
            <p>{repoBrowserReady ? `${githubRepositories.length} repositories loaded from ${githubRepositoryBrowserSourceLabel(githubCliStatus)} · ${githubAccounts.length} accounts available.` : 'Repository list requires GitHub CLI or GitHub Desktop auth.'}</p>
          </div>
          <div className="pr-actions">
            <button type="button" className="secondary" onClick={() => void loadGitHubAccounts()} disabled={busy || githubAccountsLoading}>
              {githubAccountsLoading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
              Load accounts
            </button>
            <button type="button" className="secondary" onClick={loadGitHubRepositories} disabled={busy || githubRepoLoading}>
              {githubRepoLoading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
              Load repositories
            </button>
          </div>
        </div>

        {!repoBrowserReady && (
          <div className="command-hint">Run <code>gh auth login</code> or sign in with GitHub Desktop, then load repositories.</div>
        )}

        <form
          className="github-repo-controls"
          onSubmit={(event) => {
            event.preventDefault()
            void loadGitHubRepositories()
          }}
        >
          <label>
            <span>Owner/org</span>
            <input
              list="github-account-options"
              value={githubRepoOwner}
              onChange={(event) => setGithubRepoOwner(event.target.value)}
              placeholder={githubCliStatus?.username ?? 'default account'}
              disabled={busy || githubRepoLoading}
            />
            <datalist id="github-account-options">
              {githubAccounts.map((account) => (
                <option key={account.login} value={account.login}>
                  {githubAccountOptionLabel(account)}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            <span>Search</span>
            <input
              value={githubRepoQuery}
              onChange={(event) => setGithubRepoQuery(event.target.value)}
              placeholder="name or description"
              disabled={busy || githubRepoLoading}
            />
          </label>
          <label>
            <span>Visibility</span>
            <select
              value={githubRepoVisibility}
              onChange={(event) => setGithubRepoVisibility(event.target.value as typeof githubRepoVisibility)}
              disabled={busy || githubRepoLoading}
            >
              <option value="all">All</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
            </select>
          </label>
          <label>
            <span>Limit</span>
            <input
              type="number"
              min={1}
              max={100}
              value={githubRepoLimit}
              onChange={(event) => setGithubRepoLimit(event.target.value)}
              disabled={busy || githubRepoLoading}
            />
          </label>
        </form>

        {!repoBrowserReady ? (
          <div className="quiet-box">BranchPilot can browse repositories through authenticated GitHub CLI or an available GitHub Desktop credential.</div>
        ) : githubRepoLoading ? (
          <div className="quiet-box">Loading GitHub repositories.</div>
        ) : githubRepositories.length === 0 ? (
          <div className="quiet-box">No repositories loaded yet.</div>
        ) : (
          <div className="github-repo-list">
            {githubRepositories.map((repository) => (
              <article className="github-repo-row" key={repository.nameWithOwner}>
                <div>
                  <strong>{repository.nameWithOwner}</strong>
                  <span>{githubRepositoryMeta(repository)}</span>
                  {repository.description && <p>{repository.description}</p>}
                </div>
                <div className="pr-actions">
                  <button type="button" className="secondary" onClick={() => openExternalLink(repository.url, 'GitHub repository link')}>
                    <ExternalLink size={15} />
                    Open
                  </button>
                  <button type="button" onClick={() => void cloneGitHubRepository(repository, 'https')} disabled={busy}>
                    <ArrowDownToLine size={15} />
                    Clone HTTPS
                  </button>
                  <button type="button" onClick={() => void cloneGitHubRepository(repository, 'ssh')} disabled={busy || !repository.sshUrl}>
                    <ArrowDownToLine size={15} />
                    Clone SSH
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    )
  }

  function renderPullRequestDetailsPanel() {
    const details = selectedPullRequestDetails
    const checks = selectedPullRequestChecks
    const diffFiles = selectedPullRequestDiff?.files ?? []
    const passedChecks = checks.filter((check) => check.bucket === 'pass').length
    const failedChecks = checks.filter((check) => check.bucket === 'fail').length
    const pendingChecks = checks.filter((check) => check.bucket === 'pending').length

    return (
      <section className="pr-details-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h3>{details ? `#${details.number} ${details.title}` : 'Pull request details'}</h3>
            <p>
              {details
                ? `${details.baseBranch} ← ${details.headBranch} · ${details.state}${details.draft ? ' · draft' : ''}`
                : selectedPullRequestNumber
                  ? `Loading PR #${selectedPullRequestNumber}`
                  : 'Select a pull request to inspect details, checks, and diff.'}
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (selectedPullRequestNumber) {
                void loadPullRequestDetails(selectedPullRequestNumber)
              }
            }}
            disabled={busy || pullRequestDetailsLoading || !selectedPullRequestNumber}
          >
            {pullRequestDetailsLoading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
            Refresh details
          </button>
        </div>

        {!selectedPullRequestNumber ? (
          <div className="quiet-box">Select a pull request from the list.</div>
        ) : pullRequestDetailsLoading && !details ? (
          <div className="quiet-box">Loading pull request details.</div>
        ) : details ? (
          <>
            <div className="pr-details-meta">
              <InfoRow label="Author" value={details.author?.login ?? 'Unknown'} />
              <InfoRow label="Updated" value={formatDate(details.updatedAt)} />
              <InfoRow label="Changed files" value={String(details.changedFiles)} />
              <InfoRow label="Additions / deletions" value={`+${details.additions} / -${details.deletions}`} />
            </div>

            {!githubCliStatus?.ghAuthenticated && (
              <div className="command-hint">Checks require <code>gh auth login</code>. Details, diff, and checkout use the current GitHub/Git credentials.</div>
            )}

            <div className="pr-body">
              {details.body.trim() ? details.body : 'No pull request description.'}
            </div>

            <section className="pr-checks-panel">
              <div className="pr-check-summary">
                <span className="check-bucket bucket-pass">{passedChecks} pass</span>
                <span className="check-bucket bucket-fail">{failedChecks} fail</span>
                <span className="check-bucket bucket-pending">{pendingChecks} pending</span>
                <span className="check-bucket bucket-other">{checks.length} total</span>
              </div>
              {checks.length === 0 ? (
                <div className="quiet-box">{githubCliStatus?.ghAuthenticated ? 'No checks reported by GitHub CLI.' : 'Checks require gh auth login.'}</div>
              ) : (
                <div className="pr-check-list">
                  {checks.map((check) => (
                    <article className="pr-check-row" key={`${check.workflow ?? 'workflow'}-${check.name}`}>
                      <span className={`check-bucket bucket-${checkBucketClass(check.bucket)}`}>{check.bucket || check.state}</span>
                      <div>
                        <strong>{check.name}</strong>
                        <span>{check.workflow ?? check.description ?? check.state}</span>
                      </div>
                      {check.link && (
                        <button type="button" className="secondary" onClick={() => openExternalLink(check.link, 'Check link')}>
                          <ExternalLink size={15} />
                          Open
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="pr-diff-panel">
              <div className="pr-file-list">
                {diffFiles.length === 0 ? (
                  <div className="quiet-box">No diff files returned.</div>
                ) : (
                  diffFiles.map((file) => (
                    <button
                      className={selectedPullRequestFilePath === file.path ? 'pr-file-row selected' : 'pr-file-row'}
                      type="button"
                      key={`${file.status}-${file.path}`}
                      onClick={() => setSelectedPullRequestFilePath(file.path)}
                    >
                      <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                      <span className="file-name">{file.path}</span>
                      <span className="file-state">+{file.additions} / -{file.deletions}</span>
                    </button>
                  ))
                )}
              </div>
              <DiffPreview diff={selectedPullRequestDiffResult} />
            </section>
          </>
        ) : (
          <div className="quiet-box">Pull request details are not available.</div>
        )}
      </section>
    )
  }

}

export default App
