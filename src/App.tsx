import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileWarning,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  LayoutDashboard,
  ListFilter,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Terminal,
  Trash2,
  UploadCloud,
  X
} from 'lucide-react'
import type {
  ActivityLogEventType,
  ActivityLogSnapshot,
  ApiResult,
  AssistantActionKind,
  AssistantId,
  AssistantPolicyMode,
  AssistantPolicyStatus,
  AssistantStatus,
  BranchComparison,
  BranchSummary,
  CommitDetails,
  CommitSummary,
  DiffHunk,
  EditorPreference,
  EditorSettings,
  CreatedPullRequest,
  DailyReviewReport,
  DiffResult,
  FileChange,
  GitHubAccountSummary,
  GitHubCliStatus,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubRepositorySummary,
  GeneratedLinkedInProject,
  GitConfigSnapshot,
  GitOperationResult,
  ProviderStatus,
  ProjectMemoryMcpConfig,
  ProjectMemorySnapshot,
  ProjectWikiPage,
  ProjectWikiPageId,
  ProjectWikiSnapshot,
  PatchScope,
  RecentRepository,
  RemoteBranchSummary,
  RemoteSummary,
  RepositorySnapshot,
  RepositoryDashboardSnapshot,
  ReviewFinding,
  ReviewMode,
  ReviewReport,
  ReviewScope,
  ReviewSeverity,
  StashEntry,
  SubmoduleSummary,
  TagSummary,
  WorktreeSummary
} from './shared/branchPilot'
import { branchPilotErrorText } from './shared/branchPilot'
import { getBranchComposerSummary, getBranchDraftActionState, getCreateBranchActionState } from './shared/branchPreconditions'
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
import { ActionBlockers } from './components/ActionBlockers'
import { PlannedProviderWorkflowPanel, ProviderRemoteCard } from './components/ProviderRemoteCard'
import { BulkStageCheckbox, StageCheckbox } from './components/StageCheckbox'
import { useVirtualList } from './hooks/useVirtualList'
import { DailyView } from './components/views/DailyView'
import { StashView } from './components/views/StashView'
import { MergeView } from './components/views/MergeView'
import { HistoryView } from './components/views/HistoryView'
import { changeLabel, fileStatusToken, statusToken } from './lib/fileChangeLabels'
import { formatDate, formatDateInputValue } from './lib/format'
import { groupFindingsBySeverity, reviewModeLabel, reviewScopeLabel } from './lib/reviewLabels'
import { gitDefaultBranchLabel, gitSigningLabel } from './lib/gitConfigLabels'
import { assistantActionLabel, assistantLabel, assistantPolicyAllows, assistantPolicyBlockedLabel, assistantPolicyModeLabel, assistantReadinessSummary, assistantStatusLabel } from './lib/assistantLabels'
import { dashboardRepoMeta, dashboardStateLabel, matchesDashboardRepository, matchesDashboardStaleBranch, providerStateLabel } from './lib/dashboardLabels'
import { checkBucketClass, githubAccountOptionLabel, githubRepositoryBrowserSourceLabel, githubRepositoryMeta, githubStatusLabel } from './lib/githubLabels'
import { activityCategoryLabel, activityEntryCategory, activityMetadataLabel, activityTypeLabel, completedWorkSource, completedWorkSourceLabel } from './lib/activityLabels'
import { gitLfsFileLabel, submoduleStatusLabel, worktreeSummaryLabel } from './lib/gitEntityLabels'
import { memoryFileMeta } from './lib/memoryLabels'
import { editorPreferenceLabel } from './lib/editorLabels'
import { progressLabelFromSuccess } from './lib/progressLabels'
import type { ActivityCategory, CompletedWorkSource } from './lib/activityLabels'
import { isSafeExternalUrl } from './shared/externalUrl'
import { getProviderRemoteSummary } from './shared/providerRemote'
import { getCreatePullRequestState, getPullRequestBrowseState } from './shared/providerPreconditions'
import { virtualRangeLabel } from './shared/virtualList'
import './App.css'

type ViewMode = 'dashboard' | 'changes' | 'history' | 'merge' | 'branches' | 'config' | 'stash' | 'review' | 'providers' | 'memory' | 'daily' | 'linkedin'
type DiffMode = ChangeDiffMode
type DiffDisplayMode = 'unified' | 'split'
type PreCommitFinding = ReviewFinding & { mode: ReviewMode }
type ConfirmationVariant = 'default' | 'danger'

interface ConfirmationOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmationVariant
}

interface CompletedWorkItem {
  id: string
  title: string
  meta: string
  createdAt: string
  source: CompletedWorkSource
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
const reviewModes: ReviewMode[] = ['consistency', 'security', 'quality']
const reviewSeverities: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info']
const activityCategories: ActivityCategory[] = ['all', 'git', 'assistant', 'provider', 'memory']
const completedActivityTypes = new Set<ActivityLogEventType>([
  'github_pr_created',
  'daily_review_generated',
  'assistant_linkedin_generated',
  'merge_continued',
  'patch_applied',
  'branch_published'
])
const assistantPolicyModes: AssistantPolicyMode[] = [
  'disabled',
  'review-only',
  'suggest-only',
  'allow-local-commands',
  'allow-file-edits'
]
const editorPreferences: EditorPreference[] = ['auto', 'vscode', 'cursor', 'webstorm', 'rider', 'sublime', 'custom']
const CHANGE_LIST_ITEM_HEIGHT = 42
const HISTORY_LIST_ITEM_HEIGHT = 64

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
  const [assistants, setAssistants] = useState<AssistantStatus[]>([])
  const [assistantsChecking, setAssistantsChecking] = useState(false)
  const [assistantPolicy, setAssistantPolicy] = useState<AssistantPolicyStatus | null>(null)
  const [assistantPolicyLoading, setAssistantPolicyLoading] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [changeFilter, setChangeFilter] = useState('')
  const [diffMode, setDiffMode] = useState<DiffMode>('unstaged')
  const [diffDisplayMode, setDiffDisplayMode] = useState<DiffDisplayMode>('unified')
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(false)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [history, setHistory] = useState<CommitSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('')
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null)
  const [selectedCommitFilePath, setSelectedCommitFilePath] = useState<string | null>(null)
  const [commitFileDiff, setCommitFileDiff] = useState<DiffResult | null>(null)
  const [projectMemory, setProjectMemory] = useState<ProjectMemorySnapshot | null>(null)
  const [projectMemoryMcpConfig, setProjectMemoryMcpConfig] = useState<ProjectMemoryMcpConfig | null>(null)
  const [projectWiki, setProjectWiki] = useState<ProjectWikiSnapshot | null>(null)
  const [selectedProjectWikiPageId, setSelectedProjectWikiPageId] = useState<ProjectWikiPageId>('overview')
  const [wikiLoading, setWikiLoading] = useState(false)
  const [activityLog, setActivityLog] = useState<ActivityLogSnapshot | null>(null)
  const [activityCategory, setActivityCategory] = useState<ActivityCategory>('all')
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [selectedMemoryFilePath, setSelectedMemoryFilePath] = useState<string | null>(null)
  const [dailyReview, setDailyReview] = useState<DailyReviewReport | null>(null)
  const [dailyReviewDate, setDailyReviewDate] = useState(() => formatDateInputValue(new Date()))
  const [dailyReviewLoading, setDailyReviewLoading] = useState(false)
  const [linkedinProject, setLinkedInProject] = useState<GeneratedLinkedInProject | null>(null)
  // Raw text drafts for the list editors; parsing on change would swallow Enter/comma keystrokes.
  const [linkedinHighlightsText, setLinkedinHighlightsText] = useState('')
  const [linkedinTagsText, setLinkedinTagsText] = useState('')
  const [linkedinSkillsText, setLinkedinSkillsText] = useState('')
  const [linkedinRole, setLinkedInRole] = useState('')
  const [linkedinAudience, setLinkedInAudience] = useState('LinkedIn project section')
  const [linkedinProjectUrl, setLinkedInProjectUrl] = useState('')
  const [linkedinLoading, setLinkedInLoading] = useState(false)
  const [gitConfig, setGitConfig] = useState<GitConfigSnapshot | null>(null)
  const [editorSettings, setEditorSettings] = useState<EditorSettings | null>(null)
  const [editorPreference, setEditorPreference] = useState<EditorPreference>('auto')
  const [editorCustomCommand, setEditorCustomCommand] = useState('')
  const [editorSettingsLoading, setEditorSettingsLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [busy, setBusy] = useState(false)
  const [operationLabel, setOperationLabel] = useState<string | null>(null)
  const [notice, setNotice] = useState('Open a repository to begin.')
  const [error, setError] = useState<string | null>(null)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [commitCoAuthors, setCommitCoAuthors] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchDescription, setNewBranchDescription] = useState('')
  const [branchDraftGoal, setBranchDraftGoal] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [newWorktreeBranchName, setNewWorktreeBranchName] = useState('')
  const [newWorktreeBaseRef, setNewWorktreeBaseRef] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [newTagMessage, setNewTagMessage] = useState('')
  const [patchScope, setPatchScope] = useState<PatchScope>('working-tree')
  const [editingBranchName, setEditingBranchName] = useState<string | null>(null)
  const [branchDescriptionDraft, setBranchDescriptionDraft] = useState('')
  const [branchDescriptionGenerating, setBranchDescriptionGenerating] = useState<string | null>(null)
  const [branchComparison, setBranchComparison] = useState<BranchComparison | null>(null)
  const [branchComparisonLoading, setBranchComparisonLoading] = useState<string | null>(null)
  const [selectedMergeBranch, setSelectedMergeBranch] = useState('')
  const [stashMessage, setStashMessage] = useState('')
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [localUserName, setLocalUserName] = useState('')
  const [localUserEmail, setLocalUserEmail] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [editingRemoteName, setEditingRemoteName] = useState<string | null>(null)
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
  const [reviewMode, setReviewMode] = useState<ReviewMode>('consistency')
  const [reviewScope, setReviewScope] = useState<ReviewScope>('staged')
  const [reviewReport, setReviewReport] = useState<ReviewReport | null>(null)
  const [preCommitReviewModes, setPreCommitReviewModes] = useState<ReviewMode[]>(reviewModes)
  const [preCommitReports, setPreCommitReports] = useState<ReviewReport[]>([])
  const [preCommitRunningMode, setPreCommitRunningMode] = useState<ReviewMode | null>(null)
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null)
  const [textPromptRequest, setTextPromptRequest] = useState<TextPromptRequest | null>(null)
  const [textPromptValue, setTextPromptValue] = useState('')
  const confirmationIdRef = useRef(0)
  const changesActionsMenuRef = useRef<HTMLDetailsElement>(null)
  const diffRequestIdRef = useRef(0)
  const pullRequestDetailsRequestIdRef = useRef(0)
  const commitDetailsRequestIdRef = useRef(0)
  const commitFileDiffRequestIdRef = useRef(0)
  const projectMemoryRequestIdRef = useRef(0)
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

  const filteredHistory = useMemo(() => {
    const query = historyFilter.trim().toLowerCase()

    if (!query) return history

    return history.filter((commit) =>
      [
        commit.sha,
        commit.shortSha,
        commit.subject,
        commit.authorName,
        commit.authorEmail,
        formatDate(commit.authoredAt)
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query))
    )
  }, [history, historyFilter])

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

  const preCommitFindings = useMemo<PreCommitFinding[]>(
    () =>
      preCommitReports.flatMap((report) =>
        report.findings.map((finding) => ({
          ...finding,
          mode: report.mode
        }))
      ),
    [preCommitReports]
  )

  const preCommitFindingsBySeverity = useMemo(() => groupFindingsBySeverity(preCommitFindings), [preCommitFindings])

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
  const virtualHistory = useVirtualList(filteredHistory, HISTORY_LIST_ITEM_HEIGHT, `${snapshot?.summary.rootPath ?? ''}|${historyFilter}`)

  const selectedMemoryFile = useMemo(
    () => projectMemory?.files.find((file) => file.path === selectedMemoryFilePath) ?? null,
    [projectMemory, selectedMemoryFilePath]
  )

  const selectedMemorySymbols = useMemo(
    () => projectMemory?.symbols.filter((symbol) => symbol.path === selectedMemoryFilePath) ?? [],
    [projectMemory, selectedMemoryFilePath]
  )

  const selectedMemoryImports = useMemo(
    () => projectMemory?.imports.filter((entry) => entry.path === selectedMemoryFilePath) ?? [],
    [projectMemory, selectedMemoryFilePath]
  )
  const selectedProjectWikiPage = useMemo(
    () => projectWiki?.pages.find((page) => page.id === selectedProjectWikiPageId) ?? projectWiki?.pages[0] ?? null,
    [projectWiki, selectedProjectWikiPageId]
  )

  const filteredActivityEntries = useMemo(
    () => (activityLog?.entries ?? []).filter((entry) => activityCategory === 'all' || activityEntryCategory(entry) === activityCategory),
    [activityCategory, activityLog]
  )

  const completedWorkItems = useMemo<CompletedWorkItem[]>(() => {
    const commitItems = (projectMemory?.recentCommits ?? []).slice(0, 12).map((commit) => ({
      id: `commit-${commit.sha}`,
      title: commit.subject || '(no subject)',
      meta: `${commit.shortSha} · ${commit.authorName} · ${formatDate(commit.authoredAt)}`,
      createdAt: commit.authoredAt,
      source: 'commit' as const
    }))

    const operationItems = (activityLog?.entries ?? [])
      .filter((entry) => entry.status === 'success' && completedActivityTypes.has(entry.type))
      .slice(0, 12)
      .map((entry) => ({
        id: `activity-${entry.id}`,
        title: activityTypeLabel(entry.type),
        meta: `${entry.actor} · ${formatDate(entry.createdAt)}${activityMetadataLabel(entry) ? ` · ${activityMetadataLabel(entry)}` : ''}`,
        createdAt: entry.createdAt,
        source: completedWorkSource(entry.type)
      }))

    return [...commitItems, ...operationItems]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 12)
  }, [activityLog, projectMemory])

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
    if (!snapshot || viewMode !== 'history') return
    void loadHistory()
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

  useEffect(() => {
    if (!api || viewMode !== 'dashboard') return
    void loadRepositoryDashboard()

    if (snapshot) {
      void refreshProviderStatusOnly()
    }
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

  useEffect(() => {
    if (viewMode !== 'history') return

    const filterActive = historyFilter.trim().length > 0
    const visibleHistory = filterActive ? filteredHistory : history
    const firstCommit = visibleHistory[0]

    if (!selectedCommitSha || !visibleHistory.some((commit) => commit.sha === selectedCommitSha)) {
      setSelectedCommitSha(firstCommit?.sha ?? null)
    }
  }, [filteredHistory, history, historyFilter, selectedCommitSha, viewMode])

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
    setEditingRemoteName(null)
    setRemoteName('')
    setRemoteUrl('')
    setEditingBranchName(null)
    setBranchDescriptionDraft('')
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
    if (!snapshot || viewMode !== 'history' || !selectedCommitSha) {
      commitDetailsRequestIdRef.current += 1
      commitFileDiffRequestIdRef.current += 1
      setCommitDetails(null)
      setCommitFileDiff(null)
      return
    }

    void loadCommitDetails(selectedCommitSha)
  }, [selectedCommitSha, snapshot?.summary.rootPath, viewMode])

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

  const currentRepoPath = snapshot?.summary.rootPath
  const counts = snapshot?.status.counts
  const mergeState = snapshot?.status.merge
  const canCreateStash = Boolean(snapshot && counts?.changed && mergeState?.operation === 'none')
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
  const canRunAssistantReview = assistantPolicyAllows(assistantPolicy, 'review_report')
  const canGenerateBranchDraft = assistantPolicyAllows(assistantPolicy, 'branch_draft')
  const canGenerateLinkedInProject = assistantPolicyAllows(assistantPolicy, 'linkedin_project')
  const commitActionState = getCommitActionState({ snapshot, title: commitTitle })
  const commitAndPushActionState = getCommitAndPushActionState({ snapshot, title: commitTitle })
  const amendCommitActionState = getAmendCommitActionState({ snapshot, title: commitTitle })
  const branchDraftActionState = getBranchDraftActionState({
    snapshot,
    intent: branchDraftGoal,
    assistantAllowed: canGenerateBranchDraft
  })
  const createBranchActionState = getCreateBranchActionState({
    snapshot,
    branchName: newBranchName
  })
  const branchComposerSummary = getBranchComposerSummary({
    snapshot,
    intent: branchDraftGoal,
    assistantAllowed: canGenerateBranchDraft,
    branchName: newBranchName,
    description: newBranchDescription
  })

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

  async function loadStashes(repoPath = currentRepoPath) {
    if (!api || !repoPath) return
    const result = await api.listStashes(repoPath)

    if (result.ok) {
      setStashes(result.data)
    } else {
      setError(result.error.message)
    }
  }

  async function loadAssistants() {
    if (!api) return
    const result = await api.listAssistants()
    if (result.ok) setAssistants(result.data)
  }

  async function checkAssistants() {
    if (!api) return
    setAssistantsChecking(true)
    setError(null)
    const result = await api.checkAssistants()

    if (result.ok) {
      setAssistants(result.data)
      const ready = result.data.filter((assistant) => assistant.state === 'ready').length
      setNotice(`${ready} of ${result.data.length} assistant CLIs are ready.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setAssistantsChecking(false)
  }

  async function loadAssistantPolicy(repoPath = currentRepoPath) {
    if (!api || !repoPath) return
    setAssistantPolicyLoading(true)
    const result = await api.getAssistantPolicy(repoPath)

    if (result.ok) {
      setAssistantPolicy(result.data)
    } else {
      setAssistantPolicy(null)
      setError(result.error.message)
    }

    setAssistantPolicyLoading(false)
  }

  async function updateAssistantPolicy(mode: AssistantPolicyMode) {
    if (!api || !currentRepoPath) return
    setAssistantPolicyLoading(true)
    setError(null)
    const result = await api.setAssistantPolicy({
      repoPath: currentRepoPath,
      mode
    })

    if (result.ok) {
      setAssistantPolicy(result.data)
      setNotice(`Assistant policy set to ${assistantPolicyModeLabel(result.data.settings.mode)}.`)
      if (viewMode === 'memory') {
        void loadProjectMemory(currentRepoPath)
      }
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setAssistantPolicyLoading(false)
  }

  async function loadEditorSettings() {
    if (!api) return
    setEditorSettingsLoading(true)
    const result = await api.getEditorSettings()

    if (result.ok) {
      setEditorSettings(result.data)
      setEditorPreference(result.data.preference)
      setEditorCustomCommand(result.data.customCommand ?? '')
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setEditorSettingsLoading(false)
  }

  async function saveEditorSettings() {
    if (!api) return
    setEditorSettingsLoading(true)
    setError(null)
    const result = await api.setEditorSettings({
      preference: editorPreference,
      customCommand: editorCustomCommand.trim()
    })

    if (result.ok) {
      setEditorSettings(result.data)
      setEditorPreference(result.data.preference)
      setEditorCustomCommand(result.data.customCommand ?? '')
      setNotice(`Default editor set to ${editorPreferenceLabel(result.data.preference)}.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setEditorSettingsLoading(false)
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

  async function loadHistory() {
    if (!api || !currentRepoPath) return
    setHistoryLoading(true)
    try {
      const result = await api.getHistory(currentRepoPath)

      if (result.ok) {
        setHistory(result.data)
        setSelectedCommitSha((currentSha) =>
          currentSha && result.data.some((commit) => commit.sha === currentSha) ? currentSha : result.data[0]?.sha ?? null
        )
      } else {
        setError(result.error.message)
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadProjectMemory(repoPath = currentRepoPath) {
    if (!api || !repoPath) return
    const requestId = projectMemoryRequestIdRef.current + 1
    projectMemoryRequestIdRef.current = requestId
    setMemoryLoading(true)
    const [memoryResult, mcpConfigResult, wikiResult, activityResult] = await Promise.all([
      api.getProjectMemory(repoPath),
      api.getProjectMemoryMcpConfig(repoPath),
      api.getProjectWiki(repoPath),
      api.getActivityLog({ repoPath, limit: 120 })
    ])

    if (projectMemoryRequestIdRef.current !== requestId) return

    if (memoryResult.ok) {
      setProjectMemory(memoryResult.data)
    } else {
      setProjectMemory(null)
      setError(memoryResult.error.message)
    }

    if (mcpConfigResult.ok) {
      setProjectMemoryMcpConfig(mcpConfigResult.data)
    } else {
      setProjectMemoryMcpConfig(null)
      setError(mcpConfigResult.error.message)
    }

    if (wikiResult.ok) {
      setProjectWiki(wikiResult.data)
    } else {
      setProjectWiki(null)
      setError(wikiResult.error.message)
    }

    if (activityResult.ok) {
      setActivityLog(activityResult.data)
    } else {
      setActivityLog(null)
      setError(activityResult.error.message)
    }

    setMemoryLoading(false)
  }

  async function generateProjectWiki() {
    if (!api || !currentRepoPath) return
    setWikiLoading(true)
    setError(null)
    const result = await api.generateProjectWiki(currentRepoPath)

    if (result.ok) {
      setProjectMemory(result.data.memory.snapshot)
      setProjectWiki(result.data.wiki)
      setSelectedProjectWikiPageId(result.data.wiki.pages[0]?.id ?? 'overview')
      setNotice(`Project Wiki generated with ${result.data.wiki.pages.length} pages.`)
      void loadProjectMemory(currentRepoPath)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setWikiLoading(false)
  }

  async function scanProjectMemory() {
    if (!api || !currentRepoPath) return
    setMemoryLoading(true)
    setError(null)
    const result = await api.scanProjectMemory(currentRepoPath)

    if (result.ok) {
      setProjectMemory(result.data.snapshot)
      setNotice(`Project Memory scanned ${result.data.scannedFileCount} files in ${result.data.durationMs}ms.`)
      await loadProjectMemory(currentRepoPath)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setMemoryLoading(false)
  }

  async function copyToClipboard(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(successMessage)
    } catch {
      setError('Clipboard is not available in this runtime.')
    }
  }

  async function copyProjectMemoryText(text: string, label: string) {
    await copyToClipboard(text, `${label} copied.`)
  }

  async function copyProjectWikiPage(page: ProjectWikiPage | null) {
    if (!page) return
    await copyProjectMemoryText(page.markdown, `${page.title} wiki page`)
  }

  function openExternalLink(url: string | undefined, label = 'External link') {
    if (!url || !isSafeExternalUrl(url)) {
      setError(`${label} was blocked because it is not a safe HTTPS URL.`)
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function clearActivityLog() {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation('Clear BranchPilot activity for this repository? This cannot be undone.', {
      title: 'Clear Activity Log',
      confirmLabel: 'Clear log',
      variant: 'danger'
    })

    if (!confirmed) return

    setMemoryLoading(true)
    const result = await api.clearActivityLog(currentRepoPath, confirmed)

    if (result.ok) {
      setActivityLog(result.data)
      setNotice('Activity Log cleared.')
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setMemoryLoading(false)
  }

  async function runDailyReview() {
    if (!api || !currentRepoPath) return
    setDailyReviewLoading(true)
    setError(null)

    try {
      const result = await api.generateDailyReview({
        repoPath: currentRepoPath,
        date: dailyReviewDate || undefined
      })

      if (result.ok) {
        setDailyReview(result.data)
        setNotice(`Daily review generated for ${result.data.date}.`)
      } else {
        setDailyReview(null)
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    } finally {
      setDailyReviewLoading(false)
    }
  }

  async function copyDailyReviewMarkdown() {
    if (!dailyReview) return
    await copyToClipboard(dailyReview.markdown, 'Daily review Markdown copied.')
  }

  async function generateLinkedInProject() {
    if (!api || !currentRepoPath) return

    if (!canGenerateLinkedInProject) {
      setNotice(assistantPolicyBlockedLabel('linkedin_project', assistantPolicy))
      return
    }

    setLinkedInLoading(true)
    setBusy(true)
    setError(null)
    try {
      const result = await api.generateLinkedInProject({
        repoPath: currentRepoPath,
        assistant: selectedAssistant,
        role: linkedinRole,
        audience: linkedinAudience,
        projectUrl: linkedinProjectUrl
      })

      if (result.ok) {
        setLinkedInProject(result.data)
        setLinkedinHighlightsText(result.data.highlights.join('\n'))
        setLinkedinTagsText(result.data.tags.join(', '))
        setLinkedinSkillsText(result.data.skills.join(', '))
        setNotice(`LinkedIn project generated with ${assistantLabel(result.data.assistant)}.`)
        if (result.data.truncated) {
          setError('LinkedIn context was truncated for assistant limits.')
        }
        void loadProjectMemory()
      } else {
        // Keep the current draft so a failed regeneration does not wipe user edits.
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    } finally {
      setBusy(false)
      setLinkedInLoading(false)
    }
  }

  function updateLinkedInProject(update: Partial<GeneratedLinkedInProject>) {
    setLinkedInProject((current) => current ? { ...current, ...update } : current)
  }

  async function copyLinkedInMarkdown() {
    if (!linkedinProject) return
    await copyToClipboard(linkedinProject.markdown, 'LinkedIn project Markdown copied.')
  }

  async function copyLinkedInTags() {
    if (!linkedinProject) return
    await copyToClipboard(
      linkedinProject.tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' '),
      'LinkedIn tags copied.'
    )
  }

  async function loadCommitDetails(commitSha: string) {
    if (!api || !currentRepoPath) return
    const requestId = commitDetailsRequestIdRef.current + 1
    commitDetailsRequestIdRef.current = requestId
    const result = await api.getCommitDetails({ repoPath: currentRepoPath, commitSha })

    if (commitDetailsRequestIdRef.current !== requestId) return

    if (result.ok) {
      setCommitDetails(result.data)
      const firstFile = result.data.files[0]
      setSelectedCommitFilePath(firstFile?.path ?? null)

      if (firstFile) {
        void loadCommitFileDiff(result.data.sha, firstFile.path)
      } else {
        setCommitFileDiff(null)
      }
    } else {
      setError(result.error.message)
    }
  }

  async function loadCommitFileDiff(commitSha: string, filePath: string) {
    if (!api || !currentRepoPath) return
    const requestId = commitFileDiffRequestIdRef.current + 1
    commitFileDiffRequestIdRef.current = requestId
    setSelectedCommitFilePath(filePath)
    const result = await api.getCommitFileDiff({ repoPath: currentRepoPath, commitSha, filePath })

    if (commitFileDiffRequestIdRef.current !== requestId) return

    if (result.ok) {
      setCommitFileDiff(result.data)
    } else {
      setCommitFileDiff(null)
      setError(result.error.message)
    }
  }

  async function loadGitConfig() {
    if (!api || !currentRepoPath) return
    const result = await api.getGitConfig(currentRepoPath)

    if (result.ok) {
      setGitConfig(result.data)
      setLocalUserName(result.data.localUserName ?? result.data.globalUserName ?? '')
      setLocalUserEmail(result.data.localUserEmail ?? result.data.globalUserEmail ?? '')
    } else {
      setError(result.error.message)
    }
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

  function resetPreCommitReview() {
    setPreCommitReports([])
    setPreCommitRunningMode(null)
  }

  function defaultStashMessage(): string {
    const branch = snapshot?.summary.currentBranch || 'detached'
    const timestamp = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date())

    return `WIP on ${branch} at ${timestamp}`
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

  async function createStash(message = stashMessage.trim() || defaultStashMessage()) {
    if (!api || !currentRepoPath) return
    if (!canCreateStash) {
      setNotice('Stash blocked: open a repository with local changes and no active merge operation.')
      return
    }

    const created = await runSnapshotAction(
      'Changes stashed.',
      () =>
        api.createStash({
          repoPath: currentRepoPath,
          message,
          includeUntracked: true
        }),
      'Stashing changes...'
    )

    if (created) {
      setStashMessage('')
      await loadStashes(currentRepoPath)
    }
  }

  async function createQuickStash() {
    if (!canCreateStash) {
      setNotice('Stash blocked: open a repository with local changes and no active merge operation.')
      return
    }

    const message = (await requestTextInput('Stash all local changes with this message.', {
      title: 'Quick Stash',
      confirmLabel: 'Stash changes',
      defaultValue: defaultStashMessage()
    }))?.trim()

    if (!message) return

    await createStash(message)
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

  async function applyStash(stash: StashEntry) {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation(
      `Apply ${stash.ref} to the working tree? Restoring a stash can produce conflicts with current changes.`,
      {
        title: 'Apply Stash',
        confirmLabel: 'Apply stash'
      }
    )
    if (!confirmed) return

    const applied = await runSnapshotAction('Stash applied.', () =>
      api.applyStash({
        repoPath: currentRepoPath,
        stashRef: stash.ref
      })
    )

    if (applied) {
      await loadStashes(currentRepoPath)
    } else {
      const refreshed = await api.refreshRepository(currentRepoPath)

      if (refreshed.ok) {
        resetPreCommitReview()
        setSnapshot(refreshed.data)
        setRecentRepositories(refreshed.data.recentRepositories)
      }

      await loadStashes(currentRepoPath)
    }
  }

  async function dropStash(stash: StashEntry) {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation(`Drop ${stash.ref}? This cannot be undone.`, {
      title: 'Drop Stash',
      confirmLabel: 'Drop stash',
      variant: 'danger'
    })

    if (!confirmed) return

    const dropped = await runSnapshotAction('Stash dropped.', () =>
      api.dropStash({
        repoPath: currentRepoPath,
        stashRef: stash.ref,
        confirmed
      })
    )

    if (dropped) {
      await loadStashes(currentRepoPath)
    }
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

  async function runReviewReport() {
    if (!api || !currentRepoPath) return
    if (!canRunAssistantReview) {
      setNotice(assistantPolicyBlockedLabel('review_report', assistantPolicy))
      return
    }

    const completed = await runApiAction('Running review...', () => api.generateReviewReport({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      mode: reviewMode,
      scope: reviewScope
    }), (data) => {
      setReviewReport(data)
      setNotice(`Review complete with ${assistantLabel(data.assistant)}${data.truncated ? ' from truncated diff' : ''}.`)
    })

    if (!completed) {
      setReviewReport(null)
    }
  }

  async function runPreCommitReview() {
    if (!api || !currentRepoPath || !counts?.staged || preCommitReviewModes.length === 0) return
    if (!canRunAssistantReview) {
      setNotice(assistantPolicyBlockedLabel('review_report', assistantPolicy))
      return
    }

    setPreCommitReports([])

    const reports: ReviewReport[] = []

    await runBusyOperation('Running pre-commit review...', async () => {
      try {
        for (const mode of preCommitReviewModes) {
          setPreCommitRunningMode(mode)
          const result = await api.generateReviewReport({
            repoPath: currentRepoPath,
            assistant: selectedAssistant,
            mode,
            scope: 'staged'
          })

          if (!result.ok) {
            setError(result.error.message)
            setNotice(branchPilotErrorText(result.error))
            setPreCommitReports(reports)
            return
          }

          reports.push(result.data)
          setPreCommitReports([...reports])
        }

        const lastReport = reports.at(-1)

        if (lastReport) {
          setReviewMode(lastReport.mode)
          setReviewScope('staged')
          setReviewReport(lastReport)
          setNotice(`Pre-commit review complete with ${assistantLabel(lastReport.assistant)}${lastReport.truncated ? ' from truncated diff' : ''}.`)
        }
      } finally {
        setPreCommitRunningMode(null)
      }
    })
  }

  function togglePreCommitReviewMode(mode: ReviewMode) {
    setPreCommitReviewModes((currentModes) => {
      const nextModes = currentModes.includes(mode)
        ? currentModes.filter((currentMode) => currentMode !== mode)
        : reviewModes.filter((candidate) => candidate === mode || currentModes.includes(candidate))

      return nextModes
    })
    resetPreCommitReview()
  }

  function openPreCommitReviewDetails() {
    const lastReport = preCommitReports.at(-1)

    if (lastReport) {
      setReviewMode(lastReport.mode)
      setReviewScope('staged')
      setReviewReport(lastReport)
    }

    setViewMode('review')
  }

  async function generateBranchDraft() {
    if (!api || !currentRepoPath) return
    if (!branchDraftActionState.enabled) {
      setNotice(`Branch draft blocked: ${branchDraftActionState.reasons.join(' ')}`)
      return
    }

    if (
      (newBranchName.trim() || newBranchDescription.trim()) &&
      !(await requestConfirmation('Replace the current branch name and description?', {
        title: 'Replace Branch Draft',
        confirmLabel: 'Replace draft'
      }))
    ) {
      return
    }

    await runApiAction('Generating branch draft...', () => api.generateBranchDraft({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      goal: branchDraftGoal.trim() || undefined
    }), (data) => {
      setNewBranchName(data.branchName)
      setNewBranchDescription(data.description)
      setNotice(`Generated branch draft with ${assistantLabel(data.assistant)}${data.truncated ? ' from truncated context' : ''}.`)
    })
  }

  async function createBranch() {
    if (!api || !currentRepoPath) return
    if (!createBranchActionState.enabled) {
      setNotice(`Create branch blocked: ${createBranchActionState.reasons.join(' ')}`)
      return
    }

    const created = await runSnapshotAction('Branch created.', () =>
      api.createBranch({
        repoPath: currentRepoPath,
        branchName: newBranchName,
        description: newBranchDescription
      })
    )

    if (created) {
      setNewBranchName('')
      setNewBranchDescription('')
      setBranchDraftGoal('')
    }
  }

  async function deleteBranch(branch: BranchSummary) {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation(`Delete local branch ${branch.name}?`, {
      title: 'Delete Branch',
      confirmLabel: 'Delete branch',
      variant: 'danger'
    })
    if (!confirmed) return

    const result = await runBusyOperation('Deleting branch...', () =>
      api.deleteBranch({
        repoPath: currentRepoPath,
        branchName: branch.name,
        confirmed,
        force: false
      })
    )

    if (result.ok) {
      applySnapshot(result.data, 'Branch deleted.')
      return
    }

    if (result.error.code !== 'git_branch_not_merged') {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
      return
    }

    const forceConfirmed = await requestConfirmation(
      `${branch.name} is not fully merged. Force delete it? Commits that exist only on this branch are lost.`,
      {
        title: 'Force Delete Branch',
        confirmLabel: 'Force delete',
        variant: 'danger'
      }
    )

    if (!forceConfirmed) {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
      return
    }

    await runSnapshotAction('Branch force deleted.', () =>
      api.deleteBranch({
        repoPath: currentRepoPath,
        branchName: branch.name,
        confirmed: true,
        force: true
      })
    )
  }

  async function renameBranch(branch: BranchSummary) {
    if (!api || !currentRepoPath) return
    const nextName = (await requestTextInput(`Rename local branch ${branch.name}.`, {
      title: 'Rename Branch',
      confirmLabel: 'Rename',
      defaultValue: branch.name
    }))?.trim()

    if (!nextName) return

    if (nextName === branch.name) {
      setNotice('Rename blocked: choose a different branch name.')
      return
    }

    await runSnapshotAction('Branch renamed.', () =>
      api.renameBranch({
        repoPath: currentRepoPath,
        oldBranchName: branch.name,
        newBranchName: nextName
      })
    )
  }

  async function setBranchUpstream(branch: BranchSummary) {
    if (!api || !currentRepoPath || !snapshot?.summary.remoteName) return
    const defaultUpstream = `${snapshot.summary.remoteName}/${branch.name}`
    const upstream = (await requestTextInput(`Track a remote branch for ${branch.name}.`, {
      title: 'Set Upstream',
      confirmLabel: 'Set upstream',
      defaultValue: defaultUpstream
    }))?.trim()

    if (!upstream) return

    await runSnapshotAction('Branch upstream updated.', () =>
      api.setBranchUpstream({
        repoPath: currentRepoPath,
        branchName: branch.name,
        upstream
      })
    )
  }

  async function compareBranch(branch: BranchSummary) {
    if (!api || !currentRepoPath || branch.current) return

    setBranchComparisonLoading(branch.name)
    setError(null)

    const result = await api.compareBranch({
      repoPath: currentRepoPath,
      targetBranch: branch.name
    })

    if (result.ok) {
      setBranchComparison(result.data)
      setNotice(`Compared ${result.data.targetBranch} against ${result.data.baseBranch}.`)
    } else {
      setBranchComparison(null)
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setBranchComparisonLoading(null)
  }

  async function createTag() {
    if (!api || !currentRepoPath) return

    const tagName = newTagName.trim()
    if (!tagName) {
      setNotice('Create tag blocked: add a tag name.')
      return
    }

    const created = await runSnapshotAction('Tag created.', () =>
      api.createTag({
        repoPath: currentRepoPath,
        tagName,
        message: newTagMessage
      })
    )

    if (created) {
      setNewTagName('')
      setNewTagMessage('')
    }
  }

  async function deleteTag(tag: TagSummary) {
    if (!api || !currentRepoPath) return

    const confirmed = await requestConfirmation(`Delete local tag ${tag.name}?`, {
      title: 'Delete Tag',
      confirmLabel: 'Delete tag',
      variant: 'danger'
    })
    if (!confirmed) return

    await runSnapshotAction('Tag deleted.', () =>
      api.deleteTag({
        repoPath: currentRepoPath,
        tagName: tag.name,
        confirmed
      })
    )
  }

  async function createWorktree() {
    if (!api || !currentRepoPath) return

    const branchName = newWorktreeBranchName.trim()
    if (!branchName) {
      setNotice('Create worktree blocked: add a new branch name.')
      return
    }

    await runApiAction('Creating worktree...', () => api.createWorktree({
      repoPath: currentRepoPath,
      branchName,
      baseRef: newWorktreeBaseRef.trim() || undefined
    }), (data) => {
      if (data) {
        applySnapshot(data, 'Worktree created.')
        setNewWorktreeBranchName('')
      } else {
        setNotice('Worktree creation cancelled.')
      }
    })
  }

  async function openWorktree(worktree: WorktreeSummary) {
    if (!api) return

    await runApiAction('Opening worktree...', () => api.openRepository(worktree.path), (data) => {
      applySnapshot(data, 'Worktree opened.')
      setViewMode('changes')
    })
  }

  async function removeWorktree(worktree: WorktreeSummary) {
    if (!api || !currentRepoPath) return

    const label = worktree.branch ?? worktree.path
    const confirmed = await requestConfirmation(`Remove linked worktree ${label}? Git will refuse if it contains uncommitted changes.`, {
      title: 'Remove Worktree',
      confirmLabel: 'Remove worktree',
      variant: 'danger'
    })
    if (!confirmed) return

    await runSnapshotAction('Worktree removed.', () =>
      api.removeWorktree({
        repoPath: currentRepoPath,
        targetPath: worktree.path,
        confirmed
      })
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

  function startBranchDescriptionEdit(branch: BranchSummary) {
    setEditingBranchName(branch.name)
    setBranchDescriptionDraft(branch.description ?? '')
  }

  function cancelBranchDescriptionEdit() {
    setEditingBranchName(null)
    setBranchDescriptionDraft('')
  }

  async function saveBranchDescription(branchName: string) {
    if (!api || !currentRepoPath) return

    const saved = await runSnapshotAction('Branch description saved.', () =>
      api.updateBranchDescription({
        repoPath: currentRepoPath,
        branchName,
        description: branchDescriptionDraft
      })
    )

    if (saved) {
      cancelBranchDescriptionEdit()
    }
  }

  async function generateBranchDescription(branch: BranchSummary) {
    if (!api || !currentRepoPath || branchDescriptionGenerating) return
    if (!canGenerateBranchDraft) {
      setNotice(assistantPolicyBlockedLabel('branch_draft', assistantPolicy))
      return
    }

    setBranchDescriptionGenerating(branch.name)
    setError(null)
    const result = await api.generateBranchDescription({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      branchName: branch.name
    })

    if (result.ok) {
      setEditingBranchName(branch.name)
      setBranchDescriptionDraft(result.data.description)
      setNotice(`Generated branch description with ${assistantLabel(result.data.assistant)}${result.data.truncated ? ' from truncated context' : ''}. Review and save it.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setBranchDescriptionGenerating(null)
  }

  async function saveLocalGitIdentity() {
    if (!api || !currentRepoPath) return
    await runBusyOperation('Saving Git identity...', async () => {
      const result = await api.setLocalGitIdentity({
        repoPath: currentRepoPath,
        name: localUserName.trim(),
        email: localUserEmail.trim()
      })

      if (result.ok) {
        setGitConfig(result.data)
        setNotice('Local Git identity saved.')
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
  }

  function startRemoteEdit(remote: RemoteSummary) {
    setEditingRemoteName(remote.name)
    setRemoteName(remote.name)
    setRemoteUrl(remote.fetchUrl ?? remote.pushUrl ?? '')
  }

  function cancelRemoteEdit() {
    setEditingRemoteName(null)
    setRemoteName('')
    setRemoteUrl('')
  }

  async function saveRemote() {
    if (!api || !currentRepoPath) return

    const name = (editingRemoteName ?? remoteName).trim()
    const url = remoteUrl.trim()

    if (!name || !url) {
      setNotice('Remote blocked: add a name and URL.')
      return
    }

    const label = editingRemoteName ? 'Remote updated.' : 'Remote added.'

    await runApiAction(
      editingRemoteName ? 'Updating remote...' : 'Adding remote...',
      () => editingRemoteName
        ? api.setRemoteUrl({ repoPath: currentRepoPath, name, url })
        : api.addRemote({ repoPath: currentRepoPath, name, url }),
      async (data) => {
        setGitConfig(data)
        cancelRemoteEdit()
        const snapshotResult = await api.refreshRepository(currentRepoPath)
        applySnapshotResult(snapshotResult, label)
        if (!snapshotResult.ok) {
          setNotice(label)
        }
      }
    )
  }

  async function removeRemote(remote: RemoteSummary) {
    if (!api || !currentRepoPath) return

    const confirmed = await requestConfirmation(`Remove remote ${remote.name}?`, {
      title: 'Remove Remote',
      confirmLabel: 'Remove remote',
      variant: 'danger'
    })

    if (!confirmed) return

    await runApiAction('Removing remote...', () => api.removeRemote({
      repoPath: currentRepoPath,
      name: remote.name,
      confirmed
    }), async (data) => {
      setGitConfig(data)
      if (editingRemoteName === remote.name) {
        cancelRemoteEdit()
      }
      const snapshotResult = await api.refreshRepository(currentRepoPath)
      applySnapshotResult(snapshotResult, 'Remote removed.')
      if (!snapshotResult.ok) {
        setNotice('Remote removed.')
      }
    })
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

            {viewMode === 'dashboard' && renderDashboardView()}
            {viewMode === 'changes' && renderChangesView()}
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
            {viewMode === 'branches' && renderBranchesView(snapshot.branches, snapshot.remoteBranches ?? [], snapshot.tags, snapshot.worktrees)}
            {viewMode === 'config' && renderConfigView()}
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
            {viewMode === 'review' && renderReviewView()}
            {viewMode === 'providers' && renderProvidersView()}
            {viewMode === 'memory' && renderMemoryView()}
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
            {viewMode === 'linkedin' && renderLinkedInView()}
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

  function renderDashboardView() {
    const dashboard = repositoryDashboard
    const repositories = dashboard?.repositories ?? []
    const dashboardQuery = dashboardRepositoryFilter.trim().toLowerCase()
    const filteredRepositories = dashboardQuery
      ? repositories.filter((repo) => matchesDashboardRepository(repo, dashboardQuery))
      : repositories
    const attentionRepositories = filteredRepositories.filter((repo) => repo.state !== 'clean' || repo.ahead > 0 || repo.behind > 0)
    const conflictedRepositories = filteredRepositories.filter((repo) => repo.state === 'conflicted')
    const staleBranches = (dashboard?.staleBranches ?? []).filter((branch) =>
      !dashboardQuery || matchesDashboardStaleBranch(branch, dashboardQuery)
    )
    const currentPrSummary = currentPullRequest
      ? `#${currentPullRequest.number} · ${currentPullRequest.state}${currentPullRequest.draft ? ' · draft' : ''}`
      : githubCliStatus?.ghAuthenticated
        ? 'Open Providers to load pull requests.'
        : 'GitHub CLI auth is needed for PR attention.'

    return (
      <section className="single-panel dashboard-panel">
        <div className="panel-heading">
          <div>
            <h2>Dashboard</h2>
            <p>
              {dashboard
                ? `${dashboard.totals.repositories} repositories scanned · generated ${formatDate(dashboard.generatedAt)}`
                : 'Scan recent repositories for worktree, sync, conflict, PR, and stale branch signals.'}
            </p>
          </div>
          <button type="button" onClick={loadRepositoryDashboard} disabled={dashboardLoading || busy}>
            {dashboardLoading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
            Refresh
          </button>
        </div>

        {dashboardLoading && !dashboard ? (
          <div className="quiet-box">Scanning recent repositories.</div>
        ) : !dashboard ? (
          <div className="quiet-box">Dashboard is not loaded yet.</div>
        ) : (
          <>
            <div className="dashboard-stat-grid" aria-label="Dashboard totals">
              <Stat label="Dirty repos" value={dashboard.totals.dirty} />
              <Stat label="Conflicts" value={dashboard.totals.conflicted} />
              <Stat label="Ahead / behind" value={`${dashboard.totals.ahead} / ${dashboard.totals.behind}`} />
              <Stat label="Stale branches" value={dashboard.totals.staleBranches} />
            </div>

            <div className="dashboard-filter-bar">
              <label className="list-filter-input" htmlFor="dashboard-repository-filter">
                <Search size={16} />
                <input
                  id="dashboard-repository-filter"
                  value={dashboardRepositoryFilter}
                  onChange={(event) => setDashboardRepositoryFilter(event.target.value)}
                  placeholder="Search repositories, branches, remotes"
                />
              </label>
              <span>
                {filteredRepositories.length} / {repositories.length} repos
                {dashboardQuery ? ` · ${staleBranches.length} stale branches` : ''}
              </span>
              {dashboardRepositoryFilter && (
                <button type="button" className="secondary" onClick={() => setDashboardRepositoryFilter('')}>
                  <X size={15} />
                  Clear
                </button>
              )}
            </div>

            <div className="dashboard-workspace">
              <section className="dashboard-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h3>Repository attention</h3>
                    <p>Dirty, conflicted, ahead, behind, and unavailable repositories.</p>
                  </div>
                  <span>{attentionRepositories.length}</span>
                </div>
                {attentionRepositories.length === 0 ? (
                  <div className="quiet-box">No repository needs attention.</div>
                ) : (
                  <div className="dashboard-repo-list">
                    {attentionRepositories.map((repo) => (
                      <article className={`dashboard-repo-row state-${repo.state}`} key={repo.path}>
                        <div>
                          <strong>{repo.name}</strong>
                          <span>{dashboardRepoMeta(repo)}</span>
                          <p>{repo.error ?? repo.path}</p>
                        </div>
                        <div className="dashboard-repo-metrics">
                          <span>{dashboardStateLabel(repo)}</span>
                          <span>{repo.changed} changed</span>
                          <span>{repo.ahead} / {repo.behind}</span>
                        </div>
                        <button type="button" className="secondary" onClick={() => openRepository(repo.path)} disabled={busy || repo.state === 'unavailable'}>
                          <FolderOpen size={16} />
                          Open
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="dashboard-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h3>PR/MR attention</h3>
                    <p>Current branch pull request signal from the GitHub CLI bridge.</p>
                  </div>
                  <GitPullRequest size={18} />
                </div>
                <article className="dashboard-callout">
                  <strong>{currentPullRequest?.title ?? 'Current branch PR'}</strong>
                  <span>{currentPrSummary}</span>
                  {pullRequests.length > 0 && <p>{pullRequests.length} recent GitHub pull request{pullRequests.length === 1 ? '' : 's'} loaded.</p>}
                  <div className="panel-actions">
                    <button type="button" onClick={() => setViewMode('providers')} disabled={busy}>
                      <GitPullRequest size={16} />
                      Providers
                    </button>
                    {currentPullRequest && (
                      <button type="button" className="secondary" onClick={() => openExternalLink(currentPullRequest.url, 'Pull request link')}>
                        <ExternalLink size={16} />
                        Open PR
                      </button>
                    )}
                  </div>
                </article>
              </section>

              <section className="dashboard-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h3>Conflicts</h3>
                    <p>Merge, rebase, cherry-pick, and conflicted-file signals.</p>
                  </div>
                  <span>{conflictedRepositories.length}</span>
                </div>
                {conflictedRepositories.length === 0 ? (
                  <div className="quiet-box">No conflicts detected.</div>
                ) : (
                  <div className="dashboard-repo-list">
                    {conflictedRepositories.map((repo) => (
                      <article className="dashboard-compact-row" key={repo.path}>
                        <div>
                          <strong>{repo.name}</strong>
                          <span>{repo.mergeOperation} · {repo.conflicted} conflicted files</span>
                        </div>
                        <button type="button" className="secondary" disabled={busy} onClick={async () => {
                          if (await openRepository(repo.path)) {
                            setViewMode('merge')
                          }
                        }}>
                          <GitMerge size={16} />
                          Merge
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="dashboard-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h3>Stale branches</h3>
                    <p>Local branches older than {dashboard.staleBranchThresholdDays} days.</p>
                  </div>
                  <span>{staleBranches.length}</span>
                </div>
                {staleBranches.length === 0 ? (
                  <div className="quiet-box">No stale local branches detected.</div>
                ) : (
                  <div className="dashboard-repo-list">
                    {staleBranches.slice(0, 10).map((branch) => (
                      <article className="dashboard-compact-row" key={`${branch.repoPath}-${branch.name}`}>
                        <div>
                          <strong>{branch.name}</strong>
                          <span>{branch.repoName} · {branch.daysSinceCommit} days · {formatDate(branch.lastCommitAt)}</span>
                        </div>
                        <button type="button" className="secondary" onClick={() => openRepository(branch.repoPath)} disabled={busy}>
                          <FolderOpen size={16} />
                          Open
                        </button>
                      </article>
                    ))}
                    {staleBranches.length > 10 && (
                      <div className="quiet-box">Showing 10 of {staleBranches.length} stale branches.</div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </section>
    )
  }

  function renderChangesView() {
    const totalChanges = snapshot?.status.changes.length ?? 0
    const visibleRange = virtualRangeLabel(virtualChanges.window, filteredChanges.length)
    const visibleSummary = changeFilter
      ? `${filteredChanges.length} of ${totalChanges}`
      : `${totalChanges}`

    return (
      <section className="content-grid changes-workflow-grid">
        <div className="changes-panel changes-panel-compact">
          <div className="changes-topbar">
            <h2>
              Changes
              <span>{counts?.changed ?? 0}</span>
            </h2>
          </div>

          <div className="change-filter-bar change-filter-bar-compact">
            <details className="changes-actions-menu" ref={changesActionsMenuRef}>
              <summary>
                <ListFilter size={16} />
                Actions
              </summary>
              <div className="changes-actions-popover">
                <button
                  type="button"
                  onClick={() => {
                    closeChangesActionsMenu()
                    void createQuickStash()
                  }}
                  disabled={busy || !canCreateStash}
                >
                  <Save size={15} />
                  Stash changes
                </button>
                <label>
                  Patch scope
                  <select
                    aria-label="Patch export scope"
                    value={patchScope}
                    onChange={(event) => setPatchScope(event.target.value as PatchScope)}
                    disabled={busy}
                  >
                    <option value="working-tree">Working tree</option>
                    <option value="staged">Staged</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    closeChangesActionsMenu()
                    void exportPatch()
                  }}
                  disabled={busy || !snapshot}
                >
                  <Copy size={15} />
                  Export patch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeChangesActionsMenu()
                    void applyPatch()
                  }}
                  disabled={busy || !snapshot || snapshot.status.merge.operation !== 'none'}
                >
                  <ArrowDownToLine size={15} />
                  Apply patch
                </button>
              </div>
            </details>
            <label className="change-filter-input" htmlFor="change-filter">
              <Search size={16} />
              <input
                id="change-filter"
                value={changeFilter}
                onChange={(event) => setChangeFilter(event.target.value)}
                placeholder="Search changed files"
              />
            </label>
            <span>{visibleSummary}{visibleRange}</span>
            {changeFilter && (
              <button type="button" className="secondary" onClick={() => setChangeFilter('')}>
                <X size={15} />
                Clear
              </button>
            )}
          </div>

          <div className="change-list-header">
            <BulkStageCheckbox
              state={bulkStageToggleState}
              disabled={busy}
              changedCount={totalChanges}
              onToggle={toggleBulkStage}
            />
          </div>

          <div className="change-list virtual-list-viewport" ref={virtualChanges.containerRef} onScroll={virtualChanges.onScroll}>
            {snapshot?.status.changes.length === 0 ? (
              <div className="quiet-box">Working tree is clean.</div>
            ) : filteredChanges.length === 0 ? (
              <div className="quiet-box">No changed files match this search.</div>
            ) : (
              <div className="virtual-list-spacer" style={{ height: virtualChanges.window.totalHeight }}>
                {virtualChanges.items.map(({ item: change, index }) => (
                  <div
                    className="virtual-list-item"
                    key={change.path}
                    style={{ transform: `translateY(${index * CHANGE_LIST_ITEM_HEIGHT}px)` }}
                  >
                    <div className={selectedFilePath === change.path ? 'change-row selected' : 'change-row'}>
                      <StageCheckbox
                        change={change}
                        disabled={busy || change.conflicted}
                        onToggle={toggleChangeStage}
                      />
                      <button
                        className="change-select"
                        type="button"
                        title={`${change.path} · ${changeLabel(change)}`}
                        aria-label={`${change.path}, ${changeLabel(change)}`}
                        onClick={() => {
                          setSelectedFilePath(change.path)
                          setDiffMode(getDefaultChangeDiffMode(change))
                        }}
                      >
                        <span className="file-name">{change.path}</span>
                        <span className={`file-status status-${change.status}`}>{statusToken(change)}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="commit-box">
            <input
              id="commit-title"
              aria-label="Commit title"
              value={commitTitle}
              onChange={(event) => setCommitTitle(event.target.value)}
              placeholder="Summary (required)"
            />
            <textarea
              id="commit-description"
              aria-label="Commit description"
              value={commitDescription}
              onChange={(event) => setCommitDescription(event.target.value)}
              placeholder="Description"
            />
            <textarea
              id="commit-coauthors"
              className="commit-coauthors"
              aria-label="Commit co-authors"
              value={commitCoAuthors}
              onChange={(event) => setCommitCoAuthors(event.target.value)}
              placeholder="Co-authors: Name <email>, one per line"
            />
            <div className="commit-assistant-row">
              <select
                id="assistant-select"
                aria-label="Commit text assistant"
                value={selectedAssistant}
                onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
              >
                <option value="auto">Auto</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
              </select>
              <button type="button" onClick={generateCommitText} disabled={busy || !counts?.staged || !canGenerateCommitText}>
                <Bot size={17} />
                Generate text
              </button>
              <button type="button" className="secondary" onClick={checkAssistants} disabled={assistantsChecking}>
                {assistantsChecking ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
                Check
              </button>
            </div>
            {!canGenerateCommitText && (
              <div className="assistant-policy-note">{assistantPolicyBlockedLabel('commit_message', assistantPolicy)}</div>
            )}
            {renderPreCommitReviewPanel()}
            {commitActionState.reasons.length > 0 && (
              <ActionBlockers
                title="Commit blocked"
                reasons={commitActionState.reasons}
              />
            )}
            {commitActionState.enabled && !commitAndPushActionState.enabled && commitAndPushActionState.reasons.length > 0 && (
              <ActionBlockers
                title="Commit & push blocked"
                reasons={commitAndPushActionState.reasons}
              />
            )}
            <div className="commit-actions">
              <button type="button" onClick={commitChanges} disabled={busy || !commitActionState.enabled}>
                <GitCommitHorizontal size={17} />
                Commit
              </button>
              <button type="button" className="danger-button" onClick={amendLastCommit} disabled={busy || !amendCommitActionState.enabled}>
                <Pencil size={17} />
                Amend last
              </button>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  const committed = await commitChanges()
                  if (committed && currentRepoPath) {
                    await runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))
                  }
                }}
                disabled={busy || !commitAndPushActionState.enabled}
              >
                <UploadCloud size={17} />
                Commit & push
              </button>
            </div>
          </div>
        </div>

        <div className="diff-panel">
          <div className="panel-heading">
            <div>
              <h2>Diff</h2>
              <p>{selectedChange?.path ?? 'Select a changed file'}</p>
              {selectedDiffStats && (
                <div className="diff-stats" aria-label="Selected file diff stats">
                  <span className="additions">+{selectedDiffStats.additions}</span>
                  <span className="deletions">-{selectedDiffStats.deletions}</span>
                </div>
              )}
            </div>
            <div className="panel-actions">
              <button
                className="danger-button"
                type="button"
                onClick={discardSelected}
                disabled={busy || !selectedChange || (!selectedChange.unstaged && !selectedChange.untracked)}
              >
                <Trash2 size={17} />
                {selectedChange?.untracked ? 'Delete' : 'Discard'}
              </button>
            </div>
          </div>

          {selectedChange && (
            <div className="diff-options">
              <div className="segmented">
                <button
                  className={diffMode === 'unstaged' ? 'active' : ''}
                  type="button"
                  onClick={() => setDiffMode('unstaged')}
                  disabled={!selectedChange.unstaged && !selectedChange.untracked}
                >
                  Unstaged
                </button>
                <button
                  className={diffMode === 'staged' ? 'active' : ''}
                  type="button"
                  onClick={() => setDiffMode('staged')}
                  disabled={!selectedChange.staged}
                >
                  Staged
                </button>
              </div>
              <label className="diff-whitespace-toggle">
                <input
                  type="checkbox"
                  checked={diffIgnoreWhitespace}
                  onChange={(event) => setDiffIgnoreWhitespace(event.target.checked)}
                />
                Ignore whitespace
              </label>
              <div className="segmented diff-display-toggle" aria-label="Diff display mode">
                <button
                  className={diffDisplayMode === 'unified' ? 'active' : ''}
                  type="button"
                  onClick={() => setDiffDisplayMode('unified')}
                >
                  Unified
                </button>
                <button
                  className={diffDisplayMode === 'split' ? 'active' : ''}
                  type="button"
                  onClick={() => setDiffDisplayMode('split')}
                >
                  Split
                </button>
              </div>
            </div>
          )}

          <DiffPreview
            diff={diff}
            mode={diffMode}
            displayMode={diffDisplayMode}
            busy={busy}
            onStageHunk={stageSelectedHunk}
            onUnstageHunk={unstageSelectedHunk}
            onOpenLine={openSelectedFileLineInEditor}
          />
        </div>
      </section>
    )
  }

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


  function renderMemoryView() {
    const files = projectMemory?.files ?? []
    const symbols = projectMemory?.symbols ?? []
    const commits = projectMemory?.recentCommits ?? []

    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Project Memory</h2>
            <p>Local project context index for assistant workflows.</p>
          </div>
          <div className="panel-actions">
            <button type="button" onClick={() => loadProjectMemory()} disabled={memoryLoading}>
              <RefreshCcw size={17} />
              Reload
            </button>
            <button type="button" onClick={scanProjectMemory} disabled={memoryLoading}>
              {memoryLoading ? <Loader2 className="spin" size={17} /> : <Database size={17} />}
              Rescan
            </button>
          </div>
        </div>

        {!projectMemory ? (
          <div className="quiet-box">
            {memoryLoading ? 'Scanning Project Memory.' : 'No Project Memory snapshot yet.'}
          </div>
        ) : (
          <div className="memory-workspace">
            <section className="memory-summary-grid">
              <Stat label="Indexed files" value={files.length} />
              <Stat label="Symbols" value={symbols.length} />
              <Stat label="Imports" value={projectMemory.imports.length} />
              <Stat label="Recent commits" value={commits.length} />
              <Stat label="Activity events" value={activityLog?.totalCount ?? 0} />
            </section>

            <section className="memory-meta">
              <InfoRow label="Last scan" value={formatDate(projectMemory.scannedAt)} />
              <InfoRow label="Branch" value={projectMemory.repository.currentBranch} />
              <InfoRow label="Remote" value={projectMemory.repository.remoteName ?? 'None'} />
              <InfoRow label="Repository ID" value={projectMemory.repository.id} />
            </section>

            <section className="memory-stack">
              {projectMemory.stackHints.length === 0 ? (
                <div className="quiet-box">No stack hints detected.</div>
              ) : (
                projectMemory.stackHints.map((hint) => (
                  <span key={hint.id} title={hint.source}>{hint.label}</span>
                ))
              )}
            </section>

            {projectMemoryMcpConfig && (
              <section className="memory-mcp-card">
                <div className="memory-section-heading">
                  <div>
                    <h3>Codex MCP setup</h3>
                    <span>{projectMemoryMcpConfig.serverExists ? 'Server build found' : 'Run npm run build before connecting'}</span>
                  </div>
                </div>
                <InfoRow label="Memory dir" value={projectMemoryMcpConfig.memoryDir} />
                <InfoRow label="Activity dir" value={projectMemoryMcpConfig.activityDir} />
                <InfoRow label="Wiki dir" value={projectMemoryMcpConfig.wikiDir} />
                <InfoRow label="Server path" value={projectMemoryMcpConfig.serverPath} />
                <div className="memory-mcp-snippet">
                  <div className="memory-section-heading compact">
                    <h3>CLI command</h3>
                    <button type="button" onClick={() => copyProjectMemoryText(projectMemoryMcpConfig.codexCommand, 'Codex MCP command')}>
                      <Copy size={15} />
                      Copy
                    </button>
                  </div>
                  <pre><code>{projectMemoryMcpConfig.codexCommand}</code></pre>
                </div>
                <div className="memory-mcp-snippet">
                  <div className="memory-section-heading compact">
                    <h3>config.toml</h3>
                    <button type="button" onClick={() => copyProjectMemoryText(projectMemoryMcpConfig.codexToml, 'Codex MCP TOML')}>
                      <Copy size={15} />
                      Copy
                    </button>
                  </div>
                  <pre><code>{projectMemoryMcpConfig.codexToml}</code></pre>
                </div>
              </section>
            )}

            <section className="project-wiki-card">
              <div className="memory-section-heading">
                <div>
                  <h3>Project Wiki</h3>
                  <span>
                    {projectWiki
                      ? `${projectWiki.pages.length} pages · generated ${formatDate(projectWiki.generatedAt)}`
                      : 'Generate a local private wiki from Project Memory'}
                  </span>
                </div>
                <div className="panel-actions">
                  <button type="button" onClick={() => loadProjectMemory()} disabled={memoryLoading || wikiLoading}>
                    <RefreshCcw size={15} />
                    Reload
                  </button>
                  <button type="button" onClick={generateProjectWiki} disabled={memoryLoading || wikiLoading}>
                    {wikiLoading ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
                    Generate wiki
                  </button>
                </div>
              </div>

              {!projectWiki ? (
                <div className="quiet-box">
                  {wikiLoading ? 'Generating Project Wiki.' : 'No Project Wiki generated yet.'}
                </div>
              ) : (
                <>
                  <section className="memory-meta">
                    <InfoRow label="Generated" value={formatDate(projectWiki.generatedAt)} />
                    <InfoRow label="Source scan" value={formatDate(projectWiki.sourceMemoryScannedAt)} />
                    <InfoRow label="Repository" value={projectWiki.repository.name} />
                    <InfoRow label="Branch" value={projectWiki.repository.currentBranch} />
                  </section>

                  <div className="project-wiki-grid">
                    <div className="project-wiki-pages">
                      {projectWiki.pages.map((page) => (
                        <button
                          className={selectedProjectWikiPage?.id === page.id ? 'project-wiki-page selected' : 'project-wiki-page'}
                          type="button"
                          key={page.id}
                          onClick={() => setSelectedProjectWikiPageId(page.id)}
                        >
                          <strong>{page.title}</strong>
                          <span>{page.summary}</span>
                        </button>
                      ))}
                    </div>

                    <div className="project-wiki-preview">
                      <div className="memory-section-heading compact">
                        <h3>{selectedProjectWikiPage?.title ?? 'Wiki page'}</h3>
                        <button type="button" disabled={!selectedProjectWikiPage} onClick={() => copyProjectWikiPage(selectedProjectWikiPage)}>
                          <Copy size={15} />
                          Copy Markdown
                        </button>
                      </div>
                      <pre><code>{selectedProjectWikiPage?.markdown ?? 'Select a wiki page.'}</code></pre>
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="memory-activity-card completed-work-card">
              <div className="memory-section-heading">
                <div>
                  <h3>Completed Work</h3>
                  <span>{completedWorkItems.length} finished work item{completedWorkItems.length === 1 ? '' : 's'} from Git history and completed operations</span>
                </div>
              </div>
              <div className="completed-work-list">
                {completedWorkItems.length === 0 ? (
                  <div className="quiet-box">Generate Project Memory or make a commit to build completed work history.</div>
                ) : (
                  completedWorkItems.map((item) => (
                    <article className={`completed-work-row source-${item.source}`} key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.meta}</span>
                      </div>
                      <em>{completedWorkSourceLabel(item.source)}</em>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="memory-activity-card">
              <div className="memory-section-heading">
                <div>
                  <h3>Raw Activity Events</h3>
                  <span>{activityLog?.totalCount ?? 0} technical events stored locally</span>
                </div>
                <div className="panel-actions">
                  <button type="button" onClick={() => loadProjectMemory()} disabled={memoryLoading}>
                    <RefreshCcw size={15} />
                    Reload
                  </button>
                  <button className="danger-button" type="button" onClick={clearActivityLog} disabled={memoryLoading || !activityLog?.totalCount}>
                    <Trash2 size={15} />
                    Clear
                  </button>
                </div>
              </div>
              <div className="segmented memory-activity-filters" aria-label="Activity filters">
                {activityCategories.map((category) => (
                  <button
                    className={activityCategory === category ? 'active' : ''}
                    type="button"
                    key={category}
                    onClick={() => setActivityCategory(category)}
                  >
                    {activityCategoryLabel(category)}
                  </button>
                ))}
              </div>
              <div className="memory-activity-list">
                {filteredActivityEntries.length === 0 ? (
                  <div className="quiet-box">No activity for this filter.</div>
                ) : (
                  <>
                    {filteredActivityEntries.slice(0, 40).map((entry) => (
                      <article className={`activity-row activity-${entry.status}`} key={entry.id}>
                        <div>
                          <strong>{activityTypeLabel(entry.type)}</strong>
                          <span>{entry.actor} · {entry.status} · {formatDate(entry.createdAt)}</span>
                        </div>
                        <code>{activityMetadataLabel(entry)}</code>
                      </article>
                    ))}
                    {filteredActivityEntries.length > 40 && (
                      <div className="quiet-box">Showing 40 of {filteredActivityEntries.length} loaded events.</div>
                    )}
                  </>
                )}
              </div>
            </section>

            <section className="memory-grid">
              <div className="memory-list">
                <div className="memory-section-heading">
                  <h3>Files</h3>
                  <span>{files.length}</span>
                </div>
                {files.length === 0 ? (
                  <div className="quiet-box">No indexed files.</div>
                ) : (
                  files.slice(0, 250).map((file) => (
                    <button
                      className={selectedMemoryFilePath === file.path ? 'memory-file-row selected' : 'memory-file-row'}
                      type="button"
                      key={file.path}
                      onClick={() => setSelectedMemoryFilePath(file.path)}
                    >
                      <strong>{file.path}</strong>
                      <span>{memoryFileMeta(file)}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="memory-details">
                <div className="memory-section-heading">
                  <h3>{selectedMemoryFile?.path ?? 'File outline'}</h3>
                  <span>{selectedMemorySymbols.length} symbols</span>
                </div>

                {!selectedMemoryFile ? (
                  <div className="quiet-box">Select an indexed file.</div>
                ) : (
                  <>
                    <div className="memory-outline">
                      {selectedMemorySymbols.length === 0 ? (
                        <div className="quiet-box">No symbols detected in this file.</div>
                      ) : (
                        selectedMemorySymbols.map((symbol) => (
                          <article className="memory-symbol-row" key={symbol.id}>
                            <span>{symbol.kind}</span>
                            <strong>{symbol.parentName ? `${symbol.parentName}.${symbol.name}` : symbol.name}</strong>
                            <code>{symbol.exported ? 'exported' : 'local'} · line {symbol.line}</code>
                          </article>
                        ))
                      )}
                    </div>

                    <div className="memory-section-heading compact">
                      <h3>Imports</h3>
                      <span>{selectedMemoryImports.length}</span>
                    </div>
                    <div className="memory-imports">
                      {selectedMemoryImports.length === 0 ? (
                        <div className="quiet-box">No imports detected.</div>
                      ) : (
                        selectedMemoryImports.map((entry) => (
                          <code key={`${entry.path}-${entry.line}-${entry.source}`}>
                            {entry.source}{entry.specifiers.length > 0 ? ` · ${entry.specifiers.join(', ')}` : ''} · line {entry.line}
                          </code>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="memory-list recent-memory-commits">
                <div className="memory-section-heading">
                  <h3>Recent commits</h3>
                  <span>{commits.length > 12 ? `12 of ${commits.length}` : commits.length}</span>
                </div>
                {commits.length === 0 ? (
                  <div className="quiet-box">No commits indexed.</div>
                ) : (
                  commits.slice(0, 12).map((commit) => (
                    <article className="memory-commit-row" key={commit.sha}>
                      <strong>{commit.subject || '(no subject)'}</strong>
                      <span>{commit.shortSha} · {formatDate(commit.authoredAt)}</span>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    )
  }

  function renderConfigView() {
    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Git Config</h2>
            <p>Inspect effective Git identity and update repository-local commit identity.</p>
          </div>
          <button type="button" onClick={loadGitConfig} disabled={busy}>
            <RefreshCcw size={17} />
            Reload
          </button>
        </div>

        <div className="config-grid">
          <section className="config-card">
            <h3>Local identity</h3>
            <label htmlFor="local-user-name">Name</label>
            <input
              id="local-user-name"
              value={localUserName}
              onChange={(event) => setLocalUserName(event.target.value)}
              placeholder="Repository user.name"
            />
            <label htmlFor="local-user-email">Email</label>
            <input
              id="local-user-email"
              value={localUserEmail}
              onChange={(event) => setLocalUserEmail(event.target.value)}
              placeholder="Repository user.email"
            />
            <button type="button" onClick={saveLocalGitIdentity} disabled={busy || !localUserName.trim() || !localUserEmail.trim()}>
              <Save size={17} />
              Save local identity
            </button>
          </section>

          <section className="config-card">
            <h3>Effective identity</h3>
            <InfoRow label="Name" value={gitConfig?.effectiveUserName ?? 'Unset'} />
            <InfoRow label="Email" value={gitConfig?.effectiveUserEmail ?? 'Unset'} />
            <InfoRow label="Global name" value={gitConfig?.globalUserName ?? 'Unset'} />
            <InfoRow label="Global email" value={gitConfig?.globalUserEmail ?? 'Unset'} />
            <InfoRow label="Default branch" value={gitDefaultBranchLabel(gitConfig)} />
            <InfoRow label="Commit signing" value={gitSigningLabel(gitConfig)} />
          </section>

          <section className="config-card">
            <h3>Editor</h3>
            <label htmlFor="editor-preference">Default editor</label>
            <select
              id="editor-preference"
              value={editorPreference}
              onChange={(event) => setEditorPreference(event.target.value as EditorPreference)}
              disabled={editorSettingsLoading || busy}
            >
              {editorPreferences.map((preference) => (
                <option value={preference} key={preference}>
                  {editorPreferenceLabel(preference)}
                </option>
              ))}
            </select>
            <label htmlFor="editor-custom-command">Custom command</label>
            <input
              id="editor-custom-command"
              value={editorCustomCommand}
              onChange={(event) => setEditorCustomCommand(event.target.value)}
              placeholder="code --goto %TARGET_PATH%"
              disabled={editorPreference !== 'custom' || editorSettingsLoading || busy}
            />
            <p className="muted-text">Use <code>%TARGET_PATH%</code> where BranchPilot should place the repository or file path.</p>
            <button
              type="button"
              onClick={saveEditorSettings}
              disabled={editorSettingsLoading || busy || (editorPreference === 'custom' && !editorCustomCommand.trim())}
            >
              <Save size={17} />
              Save editor settings
            </button>
            {editorSettings?.updatedAt && (
              <p className="muted-text">Updated {formatDate(editorSettings.updatedAt)}</p>
            )}
          </section>

          <section className="config-card remotes-card">
            <div className="config-card-heading">
              <div>
                <h3>Remotes</h3>
                <p>Add, update, or remove repository remotes.</p>
              </div>
            </div>
            <div className="remote-composer">
              <label htmlFor="remote-name">
                Name
                <input
                  id="remote-name"
                  value={remoteName}
                  onChange={(event) => setRemoteName(event.target.value)}
                  placeholder="origin"
                  disabled={busy || Boolean(editingRemoteName)}
                />
              </label>
              <label htmlFor="remote-url">
                URL
                <input
                  id="remote-url"
                  value={remoteUrl}
                  onChange={(event) => setRemoteUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                  disabled={busy}
                />
              </label>
              <button type="button" onClick={saveRemote} disabled={busy || !remoteName.trim() || !remoteUrl.trim()}>
                {editingRemoteName ? <Save size={16} /> : <Plus size={16} />}
                {editingRemoteName ? 'Save' : 'Add'}
              </button>
              {editingRemoteName && (
                <button className="secondary-button" type="button" onClick={cancelRemoteEdit} disabled={busy}>
                  <X size={16} />
                  Cancel
                </button>
              )}
            </div>
            {gitConfig?.remotes.length === 0 || !gitConfig ? (
              <p className="muted-text">No remotes configured.</p>
            ) : (
              gitConfig.remotes.map((remote) => (
                <div className="remote-row" key={remote.name}>
                  <div className="remote-row-details">
                    <strong>{remote.name}</strong>
                    <span>fetch: {remote.fetchUrl ?? 'unset'}</span>
                    <span>push: {remote.pushUrl ?? 'unset'}</span>
                  </div>
                  <div className="remote-row-actions">
                    <button className="secondary-button" type="button" onClick={() => startRemoteEdit(remote)} disabled={busy}>
                      <Pencil size={16} />
                      Edit
                    </button>
                    <button className="danger-button" type="button" onClick={() => removeRemote(remote)} disabled={busy}>
                      <Trash2 size={16} />
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="config-card submodules-card">
            <div className="config-card-heading">
              <div>
                <h3>Submodules</h3>
                <p>Initialize and update configured Git submodules.</p>
              </div>
              <button type="button" onClick={() => updateSubmodule()} disabled={busy || !snapshot?.submodules.length}>
                <RefreshCcw size={16} />
                Update all
              </button>
            </div>
            {!snapshot?.submodules.length ? (
              <p className="muted-text">No submodules configured.</p>
            ) : (
              <div className="submodule-list">
                {snapshot.submodules.map((submodule) => (
                  <article className={`submodule-row status-${submodule.status}`} key={submodule.path}>
                    <div>
                      <strong>{submodule.path}</strong>
                      <span>{submoduleStatusLabel(submodule)}</span>
                      <code>{submodule.url ?? 'No URL configured'}</code>
                      {submodule.branch && <span>branch: {submodule.branch}</span>}
                    </div>
                    <div className="panel-actions">
                      <button type="button" onClick={() => updateSubmodule(submodule)} disabled={busy}>
                        <RefreshCcw size={16} />
                        {submodule.status === 'uninitialized' ? 'Init' : 'Update'}
                      </button>
                      <button type="button" onClick={() => openSubmodule(submodule)} disabled={busy || submodule.status === 'uninitialized'}>
                        <FolderOpen size={16} />
                        Open
                      </button>
                      <button type="button" onClick={() => runOperationAction('Submodule opened in editor.', () => api!.openInEditor({ targetPath: submodule.absolutePath }))} disabled={busy || submodule.status === 'uninitialized'}>
                        <Code2 size={16} />
                        Editor
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="config-card lfs-card">
            <div className="config-card-heading">
              <div>
                <h3>Git LFS</h3>
                <p>{snapshot?.lfs.message ?? 'Open a repository to inspect Git LFS.'}</p>
              </div>
              <button type="button" onClick={pullGitLfs} disabled={busy || !snapshot?.lfs.installed}>
                <Database size={16} />
                Pull LFS
              </button>
            </div>

            <div className="lfs-summary-grid">
              <InfoRow label="Installed" value={snapshot?.lfs.installed ? 'Yes' : 'No'} />
              <InfoRow label="Version" value={snapshot?.lfs.version ?? 'Unavailable'} />
              <InfoRow label="Patterns" value={String(snapshot?.lfs.trackedPatterns.length ?? 0)} />
              <InfoRow label="Known files" value={String(snapshot?.lfs.fileCount ?? 0)} />
            </div>

            <div className="lfs-columns">
              <section>
                <h4>Tracked patterns</h4>
                {!snapshot?.lfs.trackedPatterns.length ? (
                  <p className="muted-text">No LFS patterns found in tracked .gitattributes files.</p>
                ) : (
                  <div className="lfs-list">
                    {snapshot.lfs.trackedPatterns.map((pattern) => (
                      <div className="lfs-row" key={`${pattern.sourcePath}-${pattern.line}-${pattern.pattern}`}>
                        <strong>{pattern.pattern}</strong>
                        <span>{pattern.sourcePath}:{pattern.line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4>LFS files</h4>
                {!snapshot?.lfs.files.length ? (
                  <p className="muted-text">{snapshot?.lfs.installed ? 'No LFS files reported by git lfs.' : 'Install git-lfs to list LFS files.'}</p>
                ) : (
                  <div className="lfs-list">
                    {snapshot.lfs.files.map((file) => (
                      <div className="lfs-row" key={`${file.oid ?? file.status}-${file.path}`}>
                        <strong>{file.path}</strong>
                        <span>{gitLfsFileLabel(file.status, file.oid)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      </section>
    )
  }



  function renderBranchesView(
    branches: BranchSummary[],
    remoteBranches: RemoteBranchSummary[],
    tags: TagSummary[],
    worktrees: WorktreeSummary[]
  ) {
    const branchQuery = branchFilter.trim().toLowerCase()
    const filteredBranches = branchQuery
      ? branches.filter((branch) =>
        [
          branch.name,
          branch.upstream,
          branch.description,
          branch.current ? 'current branch' : 'local branch'
        ]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(branchQuery))
      )
      : branches
    const filteredRemoteBranches = branchQuery
      ? remoteBranches.filter((branch) =>
        [
          branch.name,
          branch.remote,
          branch.branchName,
          branch.lastCommit
        ]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(branchQuery))
      )
      : remoteBranches
    const tagQuery = tagFilter.trim().toLowerCase()
    const filteredTags = tagQuery
      ? tags.filter((tag) =>
        [tag.name, tag.targetSha, tag.targetShortSha, tag.subject]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(tagQuery))
      )
      : tags

    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Branches</h2>
            <p>Create, describe, switch, and safely delete local branches. Inspect fetched remote branches without mutating them.</p>
          </div>
        </div>

        <section className="branch-composer">
          <div className="branch-composer-heading">
            <div>
              <h3>New branch</h3>
              <p>Draft a branch name from local context, then create it with an optional Git branch description.</p>
            </div>
            <span>{snapshot?.summary.currentBranch ?? 'No repository'}</span>
          </div>

          <div className="branch-composer-grid">
            <label htmlFor="branch-draft-goal">Intent</label>
            <textarea
              id="branch-draft-goal"
              value={branchDraftGoal}
              onChange={(event) => setBranchDraftGoal(event.target.value)}
              placeholder="What are you about to work on?"
            />

            <label htmlFor="branch-name">Branch name</label>
            <input
              id="branch-name"
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="feature/new-work"
            />

            <label htmlFor="branch-description">Branch description</label>
            <textarea
              id="branch-description"
              value={newBranchDescription}
              onChange={(event) => setNewBranchDescription(event.target.value)}
              placeholder="Optional local Git branch description"
            />
          </div>

          <div className="branch-composer-summary" aria-label="Branch draft readiness">
            {branchComposerSummary.map((item) => (
              <div className={`branch-summary-item tone-${item.tone}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="branch-composer-actions">
            <select
              aria-label="Branch draft assistant"
              value={selectedAssistant}
              onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
            >
              <option value="auto">Auto</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
            <button type="button" onClick={generateBranchDraft} disabled={busy || !branchDraftActionState.enabled}>
              <Bot size={17} />
              Generate draft
            </button>
            <button type="button" onClick={createBranch} disabled={busy || !createBranchActionState.enabled}>
              <GitBranch size={17} />
              Create branch
            </button>
          </div>

          {!canGenerateBranchDraft && (
            <div className="assistant-policy-note">{assistantPolicyBlockedLabel('branch_draft', assistantPolicy)}</div>
          )}
          {renderAssistantReadiness('branch_draft')}
          <ActionBlockers
            title={branchDraftActionState.enabled ? 'Ready to generate branch draft' : 'Branch draft blocked'}
            reasons={branchDraftActionState.reasons}
          />
          <ActionBlockers
            title={createBranchActionState.enabled ? 'Ready to create branch' : 'Create branch blocked'}
            reasons={createBranchActionState.reasons}
          />
        </section>

        <div className="list-filter-bar">
          <label className="list-filter-input" htmlFor="branch-filter">
            <Search size={16} />
            <input
              id="branch-filter"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              placeholder="Search branches"
            />
          </label>
          <span>{filteredBranches.length + filteredRemoteBranches.length} / {branches.length + remoteBranches.length}</span>
          {branchFilter && (
            <button type="button" className="secondary" onClick={() => setBranchFilter('')}>
              <X size={15} />
              Clear
            </button>
          )}
        </div>

        <div className="branch-list">
          {branches.length === 0 ? (
            <div className="quiet-box">No local branches.</div>
          ) : filteredBranches.length === 0 ? (
            <div className="quiet-box">No branches match this search.</div>
          ) : filteredBranches.map((branch) => {
            const isEditingDescription = editingBranchName === branch.name
            const isGeneratingDescription = branchDescriptionGenerating === branch.name

            return (
              <article className={branch.current ? 'branch-row current' : 'branch-row'} key={branch.name}>
                <div>
                  <strong>{branch.name}</strong>
                  <span>{branch.upstream || 'No upstream'} · {branch.lastCommitAt ? formatDate(branch.lastCommitAt) : 'No commit date'}</span>
                  {isEditingDescription ? (
                    <div className="branch-description-editor">
                      <textarea
                        aria-label={`Description for ${branch.name}`}
                        value={branchDescriptionDraft}
                        onChange={(event) => setBranchDescriptionDraft(event.target.value)}
                        placeholder="Describe the purpose of this branch"
                      />
                      <div className="branch-description-actions">
                        <button type="button" onClick={() => generateBranchDescription(branch)} disabled={busy || isGeneratingDescription || !canGenerateBranchDraft}>
                          <Bot size={16} />
                          {isGeneratingDescription ? 'Generating' : 'Generate'}
                        </button>
                        <button type="button" onClick={() => saveBranchDescription(branch.name)} disabled={busy}>
                          <Save size={16} />
                          Save
                        </button>
                        <button type="button" className="secondary" onClick={cancelBranchDescriptionEdit} disabled={busy}>
                          <X size={16} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={branch.description ? undefined : 'branch-description-empty'}>
                      {branch.description || 'No local branch description.'}
                    </p>
                  )}
                </div>
                <div className="panel-actions">
                  <button
                    type="button"
                    onClick={() => startBranchDescriptionEdit(branch)}
                    disabled={busy || isEditingDescription}
                  >
                    <Pencil size={16} />
                    Edit description
                  </button>
                  <button
                    type="button"
                    onClick={() => renameBranch(branch)}
                    disabled={busy || isEditingDescription}
                  >
                    <GitBranch size={16} />
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => generateBranchDescription(branch)}
                    disabled={busy || isGeneratingDescription || !canGenerateBranchDraft}
                  >
                    <Bot size={16} />
                    {isGeneratingDescription ? 'Generating' : 'Generate description'}
                  </button>
                  {branch.current && !branch.upstream && snapshot?.summary.remoteName && (
                    <button type="button" disabled={busy} onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
                      repoPath: currentRepoPath,
                      branch: branch.name,
                      remote: snapshot.summary.remoteName
                    }))}>
                      <UploadCloud size={16} />
                      Publish
                    </button>
                  )}
                  {!branch.upstream && snapshot?.summary.remoteName && (
                    <button type="button" onClick={() => setBranchUpstream(branch)} disabled={busy || isEditingDescription}>
                      <UploadCloud size={16} />
                      Track
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || branch.current || isEditingDescription || Boolean(branchComparisonLoading)}
                    onClick={() => compareBranch(branch)}
                  >
                    {branchComparisonLoading === branch.name ? <Loader2 className="spin" size={16} /> : <GitCommitHorizontal size={16} />}
                    Compare
                  </button>
                  <button
                    type="button"
                    disabled={busy || branch.current || isEditingDescription}
                    onClick={() => currentRepoPath && runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName: branch.name }))}
                  >
                    <GitBranch size={16} />
                    Switch
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={busy || branch.current || isEditingDescription}
                    onClick={() => deleteBranch(branch)}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        <section className="remote-branch-panel">
          <div className="branch-section-heading">
            <div>
              <h3>Remote branches</h3>
              <p>Read-only remote tracking refs from the last fetch.</p>
            </div>
            <span>{filteredRemoteBranches.length} / {remoteBranches.length}</span>
          </div>

          <div className="remote-branch-list">
            {remoteBranches.length === 0 ? (
              <div className="quiet-box">No fetched remote branches.</div>
            ) : filteredRemoteBranches.length === 0 ? (
              <div className="quiet-box">No remote branches match this search.</div>
            ) : (
              filteredRemoteBranches.map((branch) => (
                <article className="remote-branch-row" key={branch.name}>
                  <div>
                    <strong>{branch.branchName}</strong>
                    <span>{branch.name} · {branch.lastCommitAt ? formatDate(branch.lastCommitAt) : 'No commit date'}</span>
                  </div>
                  <code>{branch.remote}</code>
                </article>
              ))
            )}
          </div>
        </section>

        {branchComparison && (
          <section className="branch-compare-panel">
            <div className="branch-compare-heading">
              <div>
                <h3>{branchComparison.targetBranch}</h3>
                <p>Compared against {branchComparison.baseBranch}</p>
              </div>
              <span>
                {branchComparison.targetOnlyCommits} ahead · {branchComparison.baseOnlyCommits} behind · {branchComparison.files.length} files
              </span>
            </div>
            {branchComparison.summaryText ? (
              <pre><code>{branchComparison.summaryText}</code></pre>
            ) : (
              <div className="quiet-box">No file changes between these branches.</div>
            )}
            {branchComparison.tooLarge && <div className="command-hint">Compare summary was truncated for performance.</div>}
            {branchComparison.files.length > 0 && (
              <div className="branch-compare-files">
                {branchComparison.files.slice(0, 24).map((file) => (
                  <div className="commit-file-row" key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}>
                    <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                    <span className="file-name">{file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</span>
                  </div>
                ))}
                {branchComparison.files.length > 24 && (
                  <div className="quiet-box">{branchComparison.files.length - 24} more changed files.</div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="worktree-panel">
          <div className="panel-heading">
            <div>
              <h3>Worktrees</h3>
              <p>Create a linked worktree for safe branch experiments without disturbing this checkout.</p>
            </div>
            <span>{worktrees.length} worktree{worktrees.length === 1 ? '' : 's'}</span>
          </div>

          <div className="worktree-composer">
            <label htmlFor="worktree-branch">New branch</label>
            <input
              id="worktree-branch"
              value={newWorktreeBranchName}
              onChange={(event) => setNewWorktreeBranchName(event.target.value)}
              placeholder="experiment/safe-change"
            />
            <label htmlFor="worktree-base">Base ref</label>
            <input
              id="worktree-base"
              list="worktree-base-refs"
              value={newWorktreeBaseRef}
              onChange={(event) => setNewWorktreeBaseRef(event.target.value)}
              placeholder={snapshot?.summary.currentBranch ?? 'HEAD'}
            />
            <datalist id="worktree-base-refs">
              {branches.map((branch) => (
                <option value={branch.name} key={branch.name} />
              ))}
              {remoteBranches.map((branch) => (
                <option value={branch.name} key={`remote-${branch.name}`} />
              ))}
            </datalist>
            <div className="worktree-composer-actions">
              <button type="button" onClick={createWorktree} disabled={busy || !newWorktreeBranchName.trim()}>
                <FolderOpen size={17} />
                Create worktree
              </button>
            </div>
          </div>

          <div className="worktree-list">
            {worktrees.length === 0 ? (
              <div className="quiet-box">No linked worktrees.</div>
            ) : (
              worktrees.map((worktree) => (
                <article className={worktree.current ? 'worktree-row current' : 'worktree-row'} key={worktree.path}>
                  <div>
                    <strong>{worktree.branch ?? 'Detached HEAD'}</strong>
                    <span>{worktreeSummaryLabel(worktree)}</span>
                    <code>{worktree.path}</code>
                    {worktree.reason && <p>{worktree.reason}</p>}
                  </div>
                  <div className="panel-actions">
                    <button type="button" onClick={() => openWorktree(worktree)} disabled={busy || worktree.current}>
                      <FolderOpen size={16} />
                      Open
                    </button>
                    <button type="button" onClick={() => runOperationAction('Worktree opened in editor.', () => api!.openInEditor({ targetPath: worktree.path }))} disabled={busy}>
                      <Code2 size={16} />
                      Editor
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => removeWorktree(worktree)}
                      disabled={busy || worktree.current}
                    >
                      <Trash2 size={16} />
                      Remove
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="tag-panel">
          <div className="panel-heading">
            <div>
              <h3>Tags</h3>
              <p>Create lightweight or annotated local tags at the current HEAD.</p>
            </div>
            <span>{tags.length} tag{tags.length === 1 ? '' : 's'}</span>
          </div>

          <div className="tag-composer">
            <label htmlFor="tag-name">Tag name</label>
            <input
              id="tag-name"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              placeholder="v1.0.0"
            />
            <label htmlFor="tag-message">Annotation</label>
            <textarea
              id="tag-message"
              value={newTagMessage}
              onChange={(event) => setNewTagMessage(event.target.value)}
              placeholder="Optional annotated tag message"
            />
            <div className="tag-composer-actions">
              <button type="button" onClick={createTag} disabled={busy || !newTagName.trim()}>
                <Plus size={17} />
                Create tag
              </button>
            </div>
          </div>

          <div className="list-filter-bar">
            <label className="list-filter-input" htmlFor="tag-filter">
              <Search size={16} />
              <input
                id="tag-filter"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                placeholder="Search tags"
              />
            </label>
            <span>{filteredTags.length} / {tags.length}</span>
            {tagFilter && (
              <button type="button" className="secondary" onClick={() => setTagFilter('')}>
                <X size={15} />
                Clear
              </button>
            )}
          </div>

          <div className="tag-list">
            {tags.length === 0 ? (
              <div className="quiet-box">No local tags.</div>
            ) : filteredTags.length === 0 ? (
              <div className="quiet-box">No tags match this search.</div>
            ) : (
              filteredTags.map((tag) => (
                <article className="tag-row" key={tag.name}>
                  <div>
                    <strong>{tag.name}</strong>
                    <span>{tag.targetShortSha}{tag.createdAt ? ` · ${formatDate(tag.createdAt)}` : ''}</span>
                    {tag.subject && <p>{tag.subject}</p>}
                  </div>
                  <div className="panel-actions">
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => deleteTag(tag)}
                      disabled={busy}
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
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

  function renderReviewView() {
    const findings = reviewReport?.findings ?? []
    const findingsBySeverity = groupFindingsBySeverity(findings)

    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Review modes</h2>
            <p>Run local assistant reviews on staged, unstaged, or branch changes.</p>
          </div>
          <button type="button" onClick={runReviewReport} disabled={!snapshot || busy || !canRunAssistantReview}>
            <ShieldCheck size={17} />
            Run review
          </button>
        </div>

        <div className="review-workspace">
          {renderAssistantPolicyPanel()}

          <section className="review-controls">
            <div className="control-group">
              <span>Mode</span>
              <div className="segmented">
                {(['consistency', 'security', 'quality'] as ReviewMode[]).map((mode) => (
                  <button
                    className={reviewMode === mode ? 'active' : ''}
                    type="button"
                    key={mode}
                    onClick={() => setReviewMode(mode)}
                  >
                    {reviewModeLabel(mode)}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <span>Scope</span>
              <div className="segmented">
                {(['staged', 'unstaged', 'branch'] as ReviewScope[]).map((scope) => (
                  <button
                    className={reviewScope === scope ? 'active' : ''}
                    type="button"
                    key={scope}
                    onClick={() => setReviewScope(scope)}
                  >
                    {reviewScopeLabel(scope)}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <label htmlFor="review-assistant">Assistant</label>
              <select
                id="review-assistant"
                value={selectedAssistant}
                onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
              >
                <option value="auto">Auto</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
              </select>
            </div>
          </section>
          {renderAssistantReadiness('review_report')}

          {!snapshot ? (
            <div className="quiet-box">Open a repository before running a review.</div>
          ) : !canRunAssistantReview ? (
            <div className="review-empty">
              <ShieldCheck size={24} />
              <strong>Assistant reviews blocked</strong>
              <span>{assistantPolicyBlockedLabel('review_report', assistantPolicy)}</span>
            </div>
          ) : !reviewReport ? (
            <div className="review-empty">
              <ShieldCheck size={24} />
              <strong>{reviewModeLabel(reviewMode)} review</strong>
              <span>{reviewScopeLabel(reviewScope)} changes will be sent as explicit context to the selected local assistant.</span>
            </div>
          ) : (
            <section className="review-results">
              <div className="review-summary">
                <div>
                  <span>{reviewModeLabel(reviewReport.mode)} / {reviewScopeLabel(reviewReport.scope)}</span>
                  <strong>{reviewReport.summary}</strong>
                </div>
                <span>{reviewReport.findings.length} findings{reviewReport.truncated ? ' / truncated' : ''}</span>
              </div>

              <div className="severity-strip">
                {(['critical', 'high', 'medium', 'low', 'info'] as ReviewSeverity[]).map((severity) => (
                  <div className={`severity-count severity-${severity}`} key={severity}>
                    <span>{severity}</span>
                    <strong>{findingsBySeverity[severity].length}</strong>
                  </div>
                ))}
              </div>

              {findings.length === 0 ? (
                <div className="quiet-box">No actionable findings for this review.</div>
              ) : (
                <div className="finding-list">
                  {findings.map((finding, index) => (
                    <article className={`finding-card severity-${finding.severity}`} key={`${finding.severity}-${finding.title}-${index}`}>
                      <div className="finding-heading">
                        <span>{finding.severity}</span>
                        <strong>{finding.title}</strong>
                      </div>
                      {(finding.filePath || finding.line) && (
                        <code>{finding.filePath ?? 'Unknown file'}{finding.line ? `:${finding.line}` : ''}</code>
                      )}
                      <p>{finding.details}</p>
                      {finding.recommendation && <p className="finding-recommendation">{finding.recommendation}</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="assistant-health-heading">
          <div>
            <h3>Assistant health</h3>
            <p>PATH detection is fast. Health check verifies that the CLI can actually generate JSON for BranchPilot.</p>
          </div>
          <button type="button" onClick={checkAssistants} disabled={assistantsChecking}>
            {assistantsChecking ? <Loader2 className="spin" size={17} /> : <Bot size={17} />}
            {assistantsChecking ? 'Checking' : 'Check assistants'}
          </button>
        </div>

        <div className="assistant-grid">
          {assistants.map((assistant) => (
            <div className={`provider-card assistant-card state-${assistant.state}`} key={assistant.id}>
              <Bot size={20} />
              <strong>{assistant.label}</strong>
              <span>{assistantStatusLabel(assistant)}</span>
              <code>{assistant.executable ?? assistant.id}</code>
              <p>{assistant.message}</p>
              {assistant.checkedAt && <span>Checked {formatDate(assistant.checkedAt)}</span>}
            </div>
          ))}
        </div>
      </section>
    )
  }


  function renderProvidersView() {
    const githubProvider = providers.find((provider) => provider.id === 'github')
    const providerRemote = getProviderRemoteSummary(snapshot?.summary.remoteUrl)
    const showGitHubPullRequestPanel = providerRemote.kind !== 'gitlab' && providerRemote.kind !== 'bitbucket'
    const createPrState = getCreatePullRequestState({
      snapshot,
      githubStatus: githubCliStatus,
      title: prTitle,
      currentPullRequestExists: Boolean(currentPullRequest)
    })
    const browsePrState = getPullRequestBrowseState(snapshot, githubCliStatus)

    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Providers</h2>
            <p>GitHub uses authenticated gh when available, with GitHub Desktop credentials as a PR creation fallback.</p>
          </div>
          <button type="button" onClick={refreshProvidersPanel} disabled={busy}>
            <RefreshCcw size={17} />
            Refresh
          </button>
        </div>
        <div className="assistant-grid">
          {providers.map((provider) => (
            <div className="provider-card" key={provider.id}>
              <GitPullRequest size={20} />
              <strong>{provider.label}</strong>
              <span>{providerStateLabel(provider.state)}</span>
            </div>
          ))}
        </div>

        <ProviderRemoteCard
          remote={providerRemote}
          remoteName={snapshot?.summary.remoteName}
          remoteUrl={snapshot?.summary.remoteUrl}
          hasRepository={Boolean(snapshot)}
        />

        {renderGitHubRepositoryBrowser()}

        {showGitHubPullRequestPanel ? (
          <section className="pr-panel">
          <div className="panel-heading">
            <div>
              <h3>GitHub pull request</h3>
              <p>{snapshot ? `${snapshot.summary.currentBranch} → ${prBaseBranch || 'main'}` : 'Open a repository to create pull requests.'}</p>
            </div>
            <span className={`github-status status-${githubProvider?.state ?? 'planned'}`}>
              {githubCliStatus ? githubStatusLabel(githubCliStatus) : 'GitHub CLI unknown'}
            </span>
          </div>

          {githubCliStatus?.state === 'unauthenticated' && (
            <div className="command-hint">Run <code>gh auth login</code> or sign in with GitHub Desktop, then refresh this panel.</div>
          )}

          {githubCliStatus?.state === 'missing' && (
            <div className="command-hint">Install GitHub CLI or sign in with GitHub Desktop to create pull requests from BranchPilot.</div>
          )}

          {githubCliStatus?.authProvider === 'git-credential' && (
            <div className="command-hint">Using GitHub Desktop credential for PR creation, list, details, diff, and checkout. Run <code>gh auth login</code> to enable checks.</div>
          )}

          {snapshot && providerRemote.kind !== 'github' && (
            <div className="command-hint">
              {providerRemote.kind === 'none'
                ? 'Add a GitHub remote before using GitHub pull request workflows.'
                : `${providerRemote.label} remote detected. GitHub pull request workflows require a GitHub remote.`}
            </div>
          )}

          {snapshot && !snapshot.summary.upstream && (
            <div className="command-hint">
              Publish the current branch before creating a pull request.
              {canPublishBranch && (
                <button type="button" disabled={busy} onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
                  repoPath: currentRepoPath,
                  remote: snapshot.summary.remoteName
                }))}>
                  <UploadCloud size={17} />
                  Publish branch
                </button>
              )}
            </div>
          )}

          {currentPullRequest && (
            <article className="current-pr">
              <div>
                <span className="pr-number">#{currentPullRequest.number}</span>
                <strong>{currentPullRequest.title}</strong>
                <span>
                  {currentPullRequest.baseBranch} ← {currentPullRequest.headBranch} · {currentPullRequest.state}
                  {currentPullRequest.draft ? ' · draft' : ''}
                </span>
              </div>
              <div className="pr-actions">
                <button type="button" onClick={() => selectPullRequest(currentPullRequest)} disabled={busy}>
                  <GitPullRequest size={17} />
                  Details
                </button>
                <button type="button" className="secondary" onClick={() => openExternalLink(currentPullRequest.url, 'Pull request link')}>
                  <ExternalLink size={17} />
                  Open PR
                </button>
              </div>
            </article>
          )}

          <div className="pr-form">
            <label htmlFor="pr-base">Base branch</label>
            <input
              id="pr-base"
              value={prBaseBranch}
              onChange={(event) => setPrBaseBranch(event.target.value)}
              placeholder="main"
            />
            <label htmlFor="pr-title">Title</label>
            <input
              id="pr-title"
              value={prTitle}
              onChange={(event) => setPrTitle(event.target.value)}
              placeholder="Summarize branch changes"
            />
            <label htmlFor="pr-description">Description</label>
            <textarea
              id="pr-description"
              value={prDescription}
              onChange={(event) => setPrDescription(event.target.value)}
              placeholder="Describe changes, testing, and risk"
            />
            <div className="commit-actions">
              <button type="button" onClick={generatePullRequestText} disabled={!snapshot || busy || !canGeneratePullRequestText}>
                <Bot size={17} />
                Generate PR text
              </button>
              {currentPullRequest ? (
                <button type="button" onClick={() => openExternalLink(currentPullRequest.url, 'Pull request link')} disabled={busy}>
                  <ExternalLink size={17} />
                  Open current PR
                </button>
              ) : (
                <button type="button" onClick={createPullRequest} disabled={!createPrState.enabled || busy}>
                  <GitPullRequest size={17} />
                  Create PR
                </button>
              )}
              {createdPullRequest && (
                <button type="button" className="secondary" onClick={() => openExternalLink(createdPullRequest.url, 'Created pull request link')}>
                  <ExternalLink size={17} />
                  Open PR
                </button>
              )}
            </div>
            {!canGeneratePullRequestText && (
              <div className="assistant-policy-note">{assistantPolicyBlockedLabel('pull_request_text', assistantPolicy)}</div>
            )}
            {renderAssistantReadiness('pull_request_text')}
            <ActionBlockers
              title={createPrState.enabled ? 'Ready to create PR' : 'Create PR blocked'}
              reasons={createPrState.reasons}
            />
          </div>

          {createdPullRequest && (
            <div className="created-pr">
              <strong>{createdPullRequest.title}</strong>
              <span>{createdPullRequest.baseBranch} ← {createdPullRequest.headBranch}</span>
              <span>{createdPullRequest.url}</span>
            </div>
          )}

          <section className="pr-list-panel">
            <div className="panel-heading compact-heading">
              <div>
                <h3>Pull requests</h3>
                <p>{githubCliStatus?.authenticated ? `${pullRequests.length} recent pull request${pullRequests.length === 1 ? '' : 's'} from ${githubRepositoryBrowserSourceLabel(githubCliStatus)}.` : 'PR list requires GitHub CLI or GitHub Desktop auth.'}</p>
              </div>
              <button type="button" className="secondary" onClick={loadGitHubPullRequests} disabled={busy || !browsePrState.enabled}>
                <RefreshCcw size={17} />
                Refresh PRs
              </button>
            </div>
            <ActionBlockers
              title={browsePrState.enabled ? 'Ready to browse PRs' : 'PR browsing blocked'}
              reasons={browsePrState.reasons}
            />

            {pullRequestsLoading && pullRequests.length === 0 ? (
              <div className="quiet-box">Loading pull requests.</div>
            ) : !browsePrState.enabled ? (
              <div className="quiet-box">Authenticate GitHub with gh or GitHub Desktop to browse pull requests in BranchPilot.</div>
            ) : pullRequests.length === 0 ? (
              <div className="quiet-box">No open pull requests found.</div>
            ) : (
              <div className="pr-list">
                {pullRequests.map((pullRequest) => {
                  const isCurrent = currentPullRequest?.number === pullRequest.number ||
                    pullRequest.headBranch === snapshot?.summary.currentBranch
                  const isSelected = selectedPullRequestNumber === pullRequest.number

                  return (
                    <article
                      className={[
                        'pr-row',
                        isCurrent ? 'current' : '',
                        isSelected ? 'selected' : ''
                      ].filter(Boolean).join(' ')}
                      key={pullRequest.number}
                      onClick={() => selectPullRequest(pullRequest)}
                      onKeyDown={(event) => {
                        // Only react to keys on the row itself, not on nested Checkout/Open buttons.
                        if (event.target !== event.currentTarget) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectPullRequest(pullRequest)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div>
                        <span className="pr-number">#{pullRequest.number}</span>
                        <strong>{pullRequest.title}</strong>
                        <span>
                          {pullRequest.baseBranch} ← {pullRequest.headBranch} · {pullRequest.state}
                          {pullRequest.draft ? ' · draft' : ''}
                        </span>
                      </div>
                      <div className="pr-actions">
                        {isCurrent ? (
                          <span className="pr-current-badge">Current branch</span>
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              void checkoutPullRequest(pullRequest)
                            }}
                            disabled={busy || !githubCliStatus?.authenticated}
                          >
                            <GitPullRequest size={17} />
                            Checkout
                          </button>
                        )}
                        {isSelected && <span className="pr-current-badge selected-badge">Selected</span>}
                        <button
                          type="button"
                          className="secondary"
                          onClick={(event) => {
                            event.stopPropagation()
                            openExternalLink(pullRequest.url, 'Pull request link')
                          }}
                        >
                          <ExternalLink size={17} />
                          Open
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {renderPullRequestDetailsPanel()}
          </section>
        ) : (
          <PlannedProviderWorkflowPanel remote={providerRemote} />
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

  function renderLinkedInView() {
    return (
      <section className="single-panel linkedin-panel">
        <div className="panel-heading">
          <div>
            <h2>LinkedIn Project</h2>
            <p>Generate editable LinkedIn project fields from repository context.</p>
          </div>
          <button type="button" onClick={generateLinkedInProject} disabled={!snapshot || busy || linkedinLoading || !canGenerateLinkedInProject}>
            {linkedinLoading ? <Loader2 className="spin" size={17} /> : <Star size={17} />}
            Generate
          </button>
        </div>

        <div className="linkedin-workspace">
          <section className="linkedin-controls">
            <label htmlFor="linkedin-assistant">Assistant</label>
            <select
              id="linkedin-assistant"
              value={selectedAssistant}
              onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
              disabled={busy}
            >
              <option value="auto">Auto</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>

            <label htmlFor="linkedin-role">Preferred role</label>
            <input
              id="linkedin-role"
              value={linkedinRole}
              onChange={(event) => setLinkedInRole(event.target.value)}
              placeholder="Creator, maintainer, desktop app developer"
            />

            <label htmlFor="linkedin-audience">Audience</label>
            <input
              id="linkedin-audience"
              value={linkedinAudience}
              onChange={(event) => setLinkedInAudience(event.target.value)}
              placeholder="LinkedIn project section"
            />

            <label htmlFor="linkedin-url">Project URL</label>
            <input
              id="linkedin-url"
              value={linkedinProjectUrl}
              onChange={(event) => setLinkedInProjectUrl(event.target.value)}
              placeholder={snapshot?.summary.remoteUrl ?? 'Optional'}
            />

            {!canGenerateLinkedInProject && (
              <div className="assistant-policy-note">{assistantPolicyBlockedLabel('linkedin_project', assistantPolicy)}</div>
            )}
            {renderAssistantReadiness('linkedin_project')}
          </section>

          {!linkedinProject ? (
            <section className="review-empty linkedin-empty">
              <Star size={24} />
              <strong>{linkedinLoading ? 'Generating LinkedIn project' : 'No LinkedIn draft yet'}</strong>
              <span>{snapshot ? 'Generate a project entry from commits, tracked files, README, package metadata, and repository dates.' : 'Open a repository before generating LinkedIn content.'}</span>
            </section>
          ) : (
            <section className="linkedin-draft">
              <div className="linkedin-field-grid">
                <label>
                  Project name
                  <input
                    value={linkedinProject.projectName}
                    onChange={(event) => updateLinkedInProject({ projectName: event.target.value })}
                  />
                </label>
                <label>
                  Headline
                  <input
                    value={linkedinProject.headline}
                    onChange={(event) => updateLinkedInProject({ headline: event.target.value })}
                  />
                </label>
                <label>
                  Role
                  <input
                    value={linkedinProject.role}
                    onChange={(event) => updateLinkedInProject({ role: event.target.value })}
                  />
                </label>
                <label>
                  Start date
                  <input
                    value={linkedinProject.startDate}
                    onChange={(event) => updateLinkedInProject({ startDate: event.target.value })}
                  />
                </label>
                <label>
                  End date
                  <input
                    value={linkedinProject.endDate}
                    onChange={(event) => updateLinkedInProject({ endDate: event.target.value })}
                  />
                </label>
                <label>
                  Project URL
                  <input
                    value={linkedinProject.urlSuggestion}
                    onChange={(event) => updateLinkedInProject({ urlSuggestion: event.target.value })}
                  />
                </label>
              </div>

              <label>
                Description
                <textarea
                  value={linkedinProject.description}
                  onChange={(event) => updateLinkedInProject({ description: event.target.value })}
                />
              </label>

              <label>
                Highlights
                <textarea
                  value={linkedinHighlightsText}
                  onChange={(event) => {
                    setLinkedinHighlightsText(event.target.value)
                    updateLinkedInProject({
                      highlights: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean)
                    })
                  }}
                />
              </label>

              <div className="linkedin-field-grid">
                <label>
                  Tags
                  <textarea
                    value={linkedinTagsText}
                    onChange={(event) => {
                      setLinkedinTagsText(event.target.value)
                      updateLinkedInProject({
                        tags: event.target.value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
                      })
                    }}
                  />
                </label>
                <label>
                  Skills
                  <textarea
                    value={linkedinSkillsText}
                    onChange={(event) => {
                      setLinkedinSkillsText(event.target.value)
                      updateLinkedInProject({
                        skills: event.target.value.split(',').map((skill) => skill.trim()).filter(Boolean)
                      })
                    }}
                  />
                </label>
              </div>

              <section className="daily-section">
                <div className="daily-section-heading">
                  <strong>LinkedIn Markdown</strong>
                  <div className="panel-actions">
                    <button type="button" onClick={copyLinkedInTags}>
                      <Copy size={15} />
                      Tags
                    </button>
                    <button type="button" onClick={copyLinkedInMarkdown}>
                      <Copy size={15} />
                      Markdown
                    </button>
                  </div>
                </div>
                <textarea
                  className="linkedin-markdown-editor"
                  value={linkedinProject.markdown}
                  onChange={(event) => updateLinkedInProject({ markdown: event.target.value })}
                />
              </section>
            </section>
          )}
        </div>
      </section>
    )
  }
}

export default App
