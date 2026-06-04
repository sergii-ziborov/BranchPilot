import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
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
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
  UploadCloud,
  X
} from 'lucide-react'
import type {
  ApiResult,
  AssistantId,
  AssistantStatus,
  BranchSummary,
  CommitDetails,
  CommitFileChange,
  CommitSummary,
  DiffHunk,
  DiffLine,
  CreatedPullRequest,
  DiffResult,
  FileChange,
  GitHubCliStatus,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestDiff,
  GitHubPullRequestDiffFile,
  GitConfigSnapshot,
  GitOperationResult,
  ProviderStatus,
  ProjectMemoryFile,
  ProjectMemorySnapshot,
  RecentRepository,
  RepositorySnapshot,
  ReviewFinding,
  ReviewMode,
  ReviewReport,
  ReviewScope,
  ReviewSeverity,
  StashEntry
} from './shared/branchPilot'
import './App.css'

type ViewMode = 'changes' | 'history' | 'merge' | 'branches' | 'config' | 'stash' | 'review' | 'providers' | 'memory'
type DiffMode = 'unstaged' | 'staged'
type PreCommitFinding = ReviewFinding & { mode: ReviewMode }

const api = window.branchPilot
const reviewModes: ReviewMode[] = ['consistency', 'security', 'quality']
const reviewSeverities: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

function App() {
  const [appVersion, setAppVersion] = useState('0.0.0')
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null)
  const [recentRepositories, setRecentRepositories] = useState<RecentRepository[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [assistants, setAssistants] = useState<AssistantStatus[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('unstaged')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [history, setHistory] = useState<CommitSummary[]>([])
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null)
  const [selectedCommitFilePath, setSelectedCommitFilePath] = useState<string | null>(null)
  const [commitFileDiff, setCommitFileDiff] = useState<DiffResult | null>(null)
  const [projectMemory, setProjectMemory] = useState<ProjectMemorySnapshot | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [selectedMemoryFilePath, setSelectedMemoryFilePath] = useState<string | null>(null)
  const [gitConfig, setGitConfig] = useState<GitConfigSnapshot | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('changes')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('Open a repository to begin.')
  const [error, setError] = useState<string | null>(null)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [selectedMergeBranch, setSelectedMergeBranch] = useState('')
  const [stashMessage, setStashMessage] = useState('')
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [localUserName, setLocalUserName] = useState('')
  const [localUserEmail, setLocalUserEmail] = useState('')
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantId>('auto')
  const [githubCliStatus, setGithubCliStatus] = useState<GitHubCliStatus | null>(null)
  const [currentPullRequest, setCurrentPullRequest] = useState<GitHubPullRequest | null>(null)
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([])
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

  useEffect(() => {
    if (!api) {
      setError('BranchPilot desktop runtime is not available. Open the Electron app to use Git features.')
      return
    }

    void api.getVersion().then(setAppVersion)
    void loadRecentRepositories()
    void loadProviders()
    void loadAssistants()
  }, [])

  useEffect(() => {
    if (!snapshot) return

    const firstChange = snapshot.status.changes[0]

    if (!selectedFilePath || !snapshot.status.changes.some((change) => change.path === selectedFilePath)) {
      setSelectedFilePath(firstChange?.path ?? null)
      setDiffMode(firstChange?.staged && !firstChange.unstaged ? 'staged' : 'unstaged')
    }
  }, [selectedFilePath, snapshot])

  useEffect(() => {
    if (!snapshot || !selectedChange) {
      setDiff(null)
      return
    }

    void loadDiff(selectedChange, diffMode)
  }, [diffMode, selectedChange, snapshot])

  useEffect(() => {
    if (!snapshot || viewMode !== 'history') return
    void loadHistory()
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

  useEffect(() => {
    if (!snapshot || viewMode !== 'memory') return
    void loadProjectMemory()
  }, [snapshot?.summary.rootPath, snapshot?.summary.headOid, snapshot?.summary.currentBranch, viewMode])

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
    if (!snapshot || viewMode !== 'history' || !selectedCommitSha) {
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
  const hasRemote = Boolean(snapshot?.summary.remoteName)
  const hasUpstream = Boolean(snapshot?.summary.upstream)
  const canFetch = Boolean(snapshot && hasRemote)
  const canPull = Boolean(snapshot && !snapshot.summary.isDetached && hasUpstream)
  const canPush = Boolean(snapshot && !snapshot.summary.isDetached && hasUpstream)
  const canPublishBranch = Boolean(snapshot && !snapshot.summary.isDetached && !snapshot.summary.upstream && snapshot.summary.remoteName)
  const selectedFileTarget = currentRepoPath && selectedChange ? `${currentRepoPath}/${selectedChange.path}` : null

  async function loadRecentRepositories() {
    if (!api) return
    const result = await api.getRecentRepositories()
    if (result.ok) setRecentRepositories(result.data)
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

    const [currentResult, listResult] = await Promise.all([
      api.getCurrentBranchPullRequest(currentRepoPath),
      api.listGitHubPullRequests(currentRepoPath)
    ])

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

  async function refreshProvidersPanel() {
    void loadProviders()
    const status = await loadGitHubCliStatus()

    if (status?.authenticated && currentRepoPath) {
      await loadGitHubPullRequests()
    } else {
      setCurrentPullRequest(null)
      setPullRequests([])
      setSelectedPullRequestNumber(null)
    }
  }

  async function loadPullRequestDetails(prNumber: number) {
    if (!api || !currentRepoPath) return
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
      api.getGitHubPullRequestChecks(request),
      api.getGitHubPullRequestDiff(request)
    ])

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
    setBusy(true)
    setError(null)

    const result = await api.chooseAndOpenRepository()

    if (result.ok && result.data) {
      applySnapshot(result.data, 'Repository opened.')
    } else if (!result.ok) {
      setError(result.error.message)
    }

    setBusy(false)
  }

  async function openRepository(path: string) {
    if (!api) return
    setBusy(true)
    const result = await api.openRepository(path)
    applySnapshotResult(result, 'Repository opened.')
    setBusy(false)
  }

  async function refreshRepository(message = 'Repository refreshed.') {
    if (!api || !currentRepoPath) return
    setBusy(true)
    const result = await api.refreshRepository(currentRepoPath)
    applySnapshotResult(result, message)
    setBusy(false)
  }

  async function loadDiff(change: FileChange, mode: DiffMode) {
    if (!api || !currentRepoPath) return
    const staged = mode === 'staged' && change.staged
    const result = await api.getDiff({
      repoPath: currentRepoPath,
      filePath: change.path,
      staged
    })

    if (result.ok) {
      setDiff(result.data)
    } else {
      setDiff(null)
      setError(result.error.message)
    }
  }

  async function loadHistory() {
    if (!api || !currentRepoPath) return
    const result = await api.getHistory(currentRepoPath)

    if (result.ok) {
      setHistory(result.data)
      setSelectedCommitSha((currentSha) =>
        currentSha && result.data.some((commit) => commit.sha === currentSha) ? currentSha : result.data[0]?.sha ?? null
      )
    } else {
      setError(result.error.message)
    }
  }

  async function loadProjectMemory(repoPath = currentRepoPath) {
    if (!api || !repoPath) return
    setMemoryLoading(true)
    const result = await api.getProjectMemory(repoPath)

    if (result.ok) {
      setProjectMemory(result.data)
    } else {
      setProjectMemory(null)
      setError(result.error.message)
    }

    setMemoryLoading(false)
  }

  async function scanProjectMemory() {
    if (!api || !currentRepoPath) return
    setMemoryLoading(true)
    setError(null)
    const result = await api.scanProjectMemory(currentRepoPath)

    if (result.ok) {
      setProjectMemory(result.data.snapshot)
      setNotice(`Project Memory scanned ${result.data.scannedFileCount} files in ${result.data.durationMs}ms.`)
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }

    setMemoryLoading(false)
  }

  async function loadCommitDetails(commitSha: string) {
    if (!api || !currentRepoPath) return
    const result = await api.getCommitDetails({ repoPath: currentRepoPath, commitSha })

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
    const result = await api.getCommitFileDiff({ repoPath: currentRepoPath, commitSha, filePath })

    if (result.ok) {
      setSelectedCommitFilePath(filePath)
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

  async function runSnapshotAction(label: string, action: () => Promise<ApiResult<RepositorySnapshot>>): Promise<boolean> {
    setBusy(true)
    setError(null)
    const result = await action()
    applySnapshotResult(result, label)
    setBusy(false)
    return result.ok
  }

  async function runOperationAction(label: string, action: () => Promise<ApiResult<GitOperationResult>>) {
    setBusy(true)
    setError(null)
    const result = await action()

    if (result.ok) {
      setNotice(result.data.message || label)
      setError(null)
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }

    setBusy(false)
  }

  function applySnapshotResult(result: ApiResult<RepositorySnapshot>, successMessage: string) {
    if (result.ok) {
      applySnapshot(result.data, successMessage)
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }
  }

  function applySnapshot(nextSnapshot: RepositorySnapshot, successMessage: string) {
    resetPreCommitReview()
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

  async function stageSelected() {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction('File staged.', () =>
      api.stageFile({ repoPath: currentRepoPath, filePath: selectedChange.path })
    )
  }

  async function unstageSelected() {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction('File unstaged.', () =>
      api.unstageFile({ repoPath: currentRepoPath, filePath: selectedChange.path })
    )
  }

  async function stageSelectedHunk(hunk: DiffHunk) {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction('Hunk staged.', () =>
      api.stageHunk({
        repoPath: currentRepoPath,
        filePath: selectedChange.path,
        patch: hunk.patch
      })
    )
  }

  async function unstageSelectedHunk(hunk: DiffHunk) {
    if (!api || !currentRepoPath || !selectedChange) return
    await runSnapshotAction('Hunk unstaged.', () =>
      api.unstageHunk({
        repoPath: currentRepoPath,
        filePath: selectedChange.path,
        patch: hunk.patch
      })
    )
  }

  async function discardSelected() {
    if (!api || !currentRepoPath || !selectedChange) return
    const confirmed = window.confirm(`Discard local changes in ${selectedChange.path}?`)
    if (!confirmed) return

    const action = selectedChange.untracked ? api.deleteUntrackedFile : api.discardFile

    await runSnapshotAction('File discarded.', () =>
      action({ repoPath: currentRepoPath, filePath: selectedChange.path, confirmed })
    )
  }

  async function commitChanges(): Promise<boolean> {
    if (!api || !currentRepoPath) return false
    const committed = await runSnapshotAction('Commit created.', () =>
      api.commit({
        repoPath: currentRepoPath,
        title: commitTitle,
        description: commitDescription
      })
    )

    if (committed) {
      setCommitTitle('')
      setCommitDescription('')
      resetPreCommitReview()
    }

    return committed
  }

  async function createStash(message = stashMessage.trim() || defaultStashMessage()) {
    if (!api || !currentRepoPath) return
    const created = await runSnapshotAction('Changes stashed.', () =>
      api.createStash({
        repoPath: currentRepoPath,
        message,
        includeUntracked: true
      })
    )

    if (created) {
      setStashMessage('')
      await loadStashes(currentRepoPath)
    }
  }

  async function createQuickStash() {
    if (!counts?.changed) return
    const message = window.prompt('Stash message', defaultStashMessage())

    if (!message) return

    await createStash(message)
  }

  async function applyStash(stash: StashEntry) {
    if (!api || !currentRepoPath) return
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
    const confirmed = window.confirm(`Drop ${stash.ref}? This cannot be undone.`)

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

  async function mergeSelectedBranch() {
    if (!api || !currentRepoPath || !selectedMergeBranch) return
    setBusy(true)
    setError(null)
    const result = await api.mergeBranch({
      repoPath: currentRepoPath,
      branchName: selectedMergeBranch
    })

    if (result.ok) {
      applySnapshot(result.data, result.data.status.merge.operation === 'none' ? 'Merge complete.' : 'Merge has conflicts.')
      setViewMode('merge')
      void loadHistory()
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }

    setBusy(false)
  }

  async function continueMergeOperation() {
    if (!api || !currentRepoPath) return
    const continued = await runSnapshotAction('Operation continued.', () => api.continueMergeOperation(currentRepoPath))

    if (continued) {
      void loadHistory()
    }
  }

  async function generateCommitText() {
    if (!api || !currentRepoPath) return

    if ((commitTitle.trim() || commitDescription.trim()) && !window.confirm('Replace the current commit title and description?')) {
      return
    }

    setBusy(true)
    setError(null)
    const result = await api.generateCommitMessage({
      repoPath: currentRepoPath,
      assistant: selectedAssistant
    })

    if (result.ok) {
      setCommitTitle(result.data.title)
      setCommitDescription(result.data.description)
      setNotice(`Generated with ${assistantLabel(result.data.assistant)}${result.data.truncated ? ' from truncated diff' : ''}.`)
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }

    setBusy(false)
  }

  async function generatePullRequestText() {
    if (!api || !currentRepoPath) return

    if ((prTitle.trim() || prDescription.trim()) && !window.confirm('Replace the current pull request title and description?')) {
      return
    }

    setBusy(true)
    setError(null)
    const result = await api.generatePullRequestText({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      baseBranch: prBaseBranch.trim() || undefined
    })

    if (result.ok) {
      setPrTitle(result.data.title)
      setPrDescription(result.data.description)
      setPrBaseBranch(result.data.baseBranch)
      setCreatedPullRequest(null)
      setNotice(`Generated PR text with ${assistantLabel(result.data.assistant)}${result.data.truncated ? ' from truncated diff' : ''}.`)
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }

    setBusy(false)
  }

  async function createPullRequest() {
    if (!api || !currentRepoPath) return
    setBusy(true)
    setError(null)
    const result = await api.createGitHubPullRequest({
      repoPath: currentRepoPath,
      title: prTitle,
      description: prDescription,
      baseBranch: prBaseBranch.trim() || undefined
    })

    if (result.ok) {
      setCreatedPullRequest(result.data)
      setNotice('Pull request created.')
      void refreshProvidersPanel()
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }

    setBusy(false)
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
    setBusy(true)
    setError(null)
    const result = await api.generateReviewReport({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      mode: reviewMode,
      scope: reviewScope
    })

    if (result.ok) {
      setReviewReport(result.data)
      setNotice(`Review complete with ${assistantLabel(result.data.assistant)}${result.data.truncated ? ' from truncated diff' : ''}.`)
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
      setReviewReport(null)
    }

    setBusy(false)
  }

  async function runPreCommitReview() {
    if (!api || !currentRepoPath || !counts?.staged || preCommitReviewModes.length === 0) return

    setBusy(true)
    setError(null)
    setPreCommitReports([])

    const reports: ReviewReport[] = []

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
        setNotice(result.error.details || result.error.code)
        setPreCommitReports(reports)
        setPreCommitRunningMode(null)
        setBusy(false)
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

    setPreCommitRunningMode(null)
    setBusy(false)
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

  async function createBranch() {
    if (!api || !currentRepoPath || !newBranchName.trim()) return
    await runSnapshotAction('Branch created.', () =>
      api.createBranch({ repoPath: currentRepoPath, branchName: newBranchName })
    )
    setNewBranchName('')
  }

  async function saveLocalGitIdentity() {
    if (!api || !currentRepoPath) return
    setBusy(true)
    setError(null)
    const result = await api.setLocalGitIdentity({
      repoPath: currentRepoPath,
      name: localUserName,
      email: localUserEmail
    })

    if (result.ok) {
      setGitConfig(result.data)
      setNotice('Local Git identity saved.')
    } else {
      setError(result.error.message)
      setNotice(result.error.details || result.error.code)
    }

    setBusy(false)
  }

  async function openRepoInEditor() {
    if (!api || !currentRepoPath) return
    await runOperationAction('Repository opened in editor.', () => api.openInEditor({ targetPath: currentRepoPath }))
  }

  async function openSelectedFileInEditor() {
    if (!api || !selectedFileTarget) return
    await runOperationAction('File opened in editor.', () => api.openInEditor({ targetPath: selectedFileTarget }))
  }

  async function openRepositoryTerminal() {
    if (!api || !currentRepoPath) return
    await runOperationAction('Terminal opened.', () => api.openTerminal(currentRepoPath))
  }

  const navigation = [
    { id: 'changes' as const, label: 'Changes', icon: GitCommitHorizontal },
    { id: 'history' as const, label: 'History', icon: Clock3 },
    { id: 'merge' as const, label: 'Merge', icon: GitMerge },
    { id: 'branches' as const, label: 'Branches', icon: GitBranch },
    { id: 'config' as const, label: 'Git Config', icon: Settings },
    { id: 'stash' as const, label: 'Stash', icon: Save },
    { id: 'review' as const, label: 'Review', icon: ShieldCheck },
    { id: 'providers' as const, label: 'Providers', icon: GitPullRequest },
    { id: 'memory' as const, label: 'Memory', icon: Database }
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
          <span className="section-label">Recent repositories</span>
          {recentRepositories.length === 0 ? (
            <p>No recent repositories.</p>
          ) : (
            recentRepositories.map((repo) => (
              <button type="button" key={repo.path} onClick={() => openRepository(repo.path)}>
                <strong>{repo.name}</strong>
                <span>{repo.path}</span>
              </button>
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
            {error}
          </div>
        )}
        <div className="message">
          {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          {notice}
        </div>

        {!snapshot ? (
          <section className="empty-state">
            <FolderOpen size={42} />
            <h2>Open a local Git repository</h2>
            <p>BranchPilot will read status, diffs, branches, merge state, and local Git configuration.</p>
            <button type="button" onClick={chooseRepository} disabled={!api || busy}>
              Open repository
            </button>
          </section>
        ) : (
          <>
            <section className="stats-grid" aria-label="Repository status">
              <Stat label="Changed files" value={counts?.changed ?? 0} />
              <Stat label="Staged" value={counts?.staged ?? 0} />
              <Stat label="Unstaged" value={counts?.unstaged ?? 0} />
              <Stat label="Conflicts" value={counts?.conflicted ?? 0} />
              <Stat label="Ahead / behind" value={`${snapshot.summary.ahead} / ${snapshot.summary.behind}`} />
              <Stat label="Remote" value={snapshot.summary.upstream ?? snapshot.summary.remoteName ?? 'None'} />
            </section>

            {viewMode === 'changes' && renderChangesView()}
            {viewMode === 'history' && renderHistoryView()}
            {viewMode === 'merge' && renderMergeView()}
            {viewMode === 'branches' && renderBranchesView(snapshot.branches)}
            {viewMode === 'config' && renderConfigView()}
            {viewMode === 'stash' && renderStashView()}
            {viewMode === 'review' && renderReviewView()}
            {viewMode === 'providers' && renderProvidersView()}
            {viewMode === 'memory' && renderMemoryView()}
          </>
        )}
      </section>
    </main>
  )

  function renderChangesView() {
    return (
      <section className="content-grid">
        <div className="changes-panel">
          <div className="panel-heading">
            <div>
              <h2>Changes</h2>
              <p>Real status from system Git.</p>
            </div>
            <div className="panel-actions">
              <button type="button" onClick={createQuickStash} disabled={busy || !counts?.changed}>
                <Save size={17} />
                Stash changes
              </button>
              <button type="button" onClick={() => currentRepoPath && runSnapshotAction('All changes staged.', () => api!.stageAll(currentRepoPath))}>
                <Plus size={17} />
                Stage all
              </button>
              <button type="button" onClick={() => currentRepoPath && runSnapshotAction('All changes unstaged.', () => api!.unstageAll(currentRepoPath))}>
                <X size={17} />
                Unstage all
              </button>
            </div>
          </div>

          <div className="change-list">
            {snapshot?.status.changes.length === 0 ? (
              <div className="quiet-box">Working tree is clean.</div>
            ) : (
              snapshot?.status.changes.map((change) => (
                <div className={selectedFilePath === change.path ? 'change-row selected' : 'change-row'} key={change.path}>
                  <button
                    className="change-select"
                    type="button"
                    onClick={() => {
                      setSelectedFilePath(change.path)
                      setDiffMode(change.staged && !change.unstaged ? 'staged' : 'unstaged')
                    }}
                  >
                    <span className={`file-status status-${change.status}`}>{statusToken(change)}</span>
                    <span className="file-name">{change.path}</span>
                    <span className="file-state">{changeLabel(change)}</span>
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="commit-box">
            <div className="assistant-controls">
              <label htmlFor="assistant-select">Assistant</label>
              <select
                id="assistant-select"
                value={selectedAssistant}
                onChange={(event) => setSelectedAssistant(event.target.value as AssistantId)}
              >
                <option value="auto">Auto</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
              </select>
              <button type="button" onClick={generateCommitText} disabled={busy || !counts?.staged}>
                <Bot size={17} />
                Generate
              </button>
            </div>
            <div className="assistant-detections">
              {assistants.map((assistant) => (
                <span key={assistant.id}>
                  {assistant.label}: {assistant.detected ? 'detected' : 'not found'}
                </span>
              ))}
            </div>
            <label htmlFor="commit-title">Commit title</label>
            <input
              id="commit-title"
              value={commitTitle}
              onChange={(event) => setCommitTitle(event.target.value)}
              placeholder="Summarize staged changes"
            />
            <label htmlFor="commit-description">Description</label>
            <textarea
              id="commit-description"
              value={commitDescription}
              onChange={(event) => setCommitDescription(event.target.value)}
              placeholder="Optional commit body"
            />
            {renderPreCommitReviewPanel()}
            <div className="commit-actions">
              <button type="button" onClick={commitChanges} disabled={busy || !counts?.staged}>
                <GitCommitHorizontal size={17} />
                Commit
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
                disabled={busy || !counts?.staged || !canPush}
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
            </div>
            <div className="panel-actions">
              <button type="button" onClick={stageSelected} disabled={!selectedChange || !selectedChange.unstaged}>
                <Plus size={17} />
                Stage
              </button>
              <button type="button" onClick={unstageSelected} disabled={!selectedChange || !selectedChange.staged}>
                <X size={17} />
                Unstage
              </button>
              <button type="button" onClick={discardSelected} disabled={!selectedChange || (!selectedChange.unstaged && !selectedChange.untracked)}>
                <Trash2 size={17} />
                Discard
              </button>
            </div>
          </div>

          {selectedChange && (
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
          )}

          <DiffPreview
            diff={diff}
            mode={diffMode}
            busy={busy}
            onStageHunk={stageSelectedHunk}
            onUnstageHunk={unstageSelectedHunk}
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
          <button type="button" onClick={runPreCommitReview} disabled={busy || !counts?.staged || preCommitReviewModes.length === 0}>
            {isRunning ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
            {isRunning ? `Reviewing ${reviewModeLabel(preCommitRunningMode!)}` : 'Review staged diff'}
          </button>
        </div>

        {!counts?.staged ? (
          <div className="precommit-empty">Stage files to review the exact diff that will be committed.</div>
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

  function renderHistoryView() {
    return (
      <section className="content-grid history-grid">
        <div className="changes-panel">
          <div className="panel-heading">
            <div>
              <h2>History</h2>
              <p>{history.length} commits on this branch.</p>
            </div>
            <button type="button" onClick={loadHistory} disabled={busy}>
              <RefreshCcw size={17} />
              Refresh
            </button>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <div className="quiet-box">No commits found.</div>
            ) : (
              history.map((commit) => (
                <button
                  className={selectedCommitSha === commit.sha ? 'history-row selected' : 'history-row'}
                  type="button"
                  key={commit.sha}
                  onClick={() => setSelectedCommitSha(commit.sha)}
                >
                  <strong>{commit.subject || '(no subject)'}</strong>
                  <span>
                    {commit.shortSha} · {commit.authorName} · {formatDate(commit.authoredAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="diff-panel">
          <div className="panel-heading">
            <div>
              <h2>{commitDetails?.subject ?? 'Commit details'}</h2>
              <p>
                {commitDetails
                  ? `${commitDetails.shortSha} · ${commitDetails.authorName} · ${formatDate(commitDetails.authoredAt)}`
                  : 'Select a commit'}
              </p>
            </div>
          </div>

          {commitDetails?.body && <div className="commit-body">{commitDetails.body}</div>}

          <div className="commit-file-grid">
            <div className="commit-file-list">
              {commitDetails?.files.length === 0 && <div className="quiet-box">No changed files.</div>}
              {commitDetails?.files.map((file) => (
                <button
                  className={selectedCommitFilePath === file.path ? 'commit-file-row selected' : 'commit-file-row'}
                  type="button"
                  key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}
                  onClick={() => commitDetails && loadCommitFileDiff(commitDetails.sha, file.path)}
                >
                  <span className={`file-status status-${file.status}`}>{commitFileToken(file)}</span>
                  <span className="file-name">{file.path}</span>
                </button>
              ))}
            </div>
            <DiffPreview diff={commitFileDiff} />
          </div>
        </div>
      </section>
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
                  <span>{commits.length}</span>
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
            <InfoRow
              label="Commit signing"
              value={
                gitConfig?.commitSigningSource === 'unset'
                  ? 'Unset'
                  : `${gitConfig?.commitSigningEnabled ? 'Enabled' : 'Disabled'} (${gitConfig?.commitSigningSource})`
              }
            />
          </section>

          <section className="config-card remotes-card">
            <h3>Remotes</h3>
            {gitConfig?.remotes.length === 0 || !gitConfig ? (
              <p className="muted-text">No remotes configured.</p>
            ) : (
              gitConfig.remotes.map((remote) => (
                <div className="remote-row" key={remote.name}>
                  <strong>{remote.name}</strong>
                  <span>fetch: {remote.fetchUrl ?? 'unset'}</span>
                  <span>push: {remote.pushUrl ?? 'unset'}</span>
                </div>
              ))
            )}
          </section>
        </div>
      </section>
    )
  }

  function renderStashView() {
    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Stash</h2>
            <p>Store unfinished tracked and untracked work without committing.</p>
          </div>
          <button type="button" onClick={() => loadStashes()} disabled={busy}>
            <RefreshCcw size={17} />
            Refresh
          </button>
        </div>

        <div className="stash-workspace">
          <section className="stash-create">
            <div>
              <h3>Create stash</h3>
              <p>Includes tracked and untracked changes. Ignored files stay untouched.</p>
            </div>
            <input
              id="stash-message"
              value={stashMessage}
              onChange={(event) => setStashMessage(event.target.value)}
              placeholder={defaultStashMessage()}
            />
            <button type="button" onClick={() => createStash()} disabled={busy || !counts?.changed}>
              <Save size={17} />
              Stash changes
            </button>
          </section>

          <section className="stash-list">
            {stashes.length === 0 ? (
              <div className="quiet-box">No stashes for this repository.</div>
            ) : (
              stashes.map((stash) => (
                <article className="stash-row" key={stash.ref}>
                  <div>
                    <span>{stash.ref} · {stash.createdAtLabel}</span>
                    <strong>{stash.message}</strong>
                    <code>{stash.sha.slice(0, 12)}</code>
                  </div>
                  <div className="stash-actions">
                    <button type="button" onClick={() => applyStash(stash)} disabled={busy}>
                      <ArrowDownToLine size={17} />
                      Apply
                    </button>
                    <button type="button" onClick={() => dropStash(stash)} disabled={busy}>
                      <Trash2 size={17} />
                      Drop
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </div>
      </section>
    )
  }

  function renderMergeView() {
    const hasOperation = mergeState && mergeState.operation !== 'none'
    const mergeCandidates = snapshot?.branches.filter((branch) => !branch.current) ?? []
    const hasDirtyWorktree = Boolean(counts?.changed)
    const canContinueOperation = Boolean(hasOperation && mergeState.files.length === 0)

    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Merge window</h2>
            <p>{hasOperation ? `${mergeState.operation} in progress` : 'No merge, rebase, or cherry-pick operation is active.'}</p>
          </div>
          <div className="panel-actions">
            <button type="button" disabled={!canContinueOperation || busy} onClick={continueMergeOperation}>
              <Check size={17} />
              Continue
            </button>
            <button
              type="button"
              disabled={!hasOperation || busy}
              onClick={() => currentRepoPath && window.confirm('Abort the current Git operation?') && runSnapshotAction('Operation aborted.', () => api!.abortMergeOperation(currentRepoPath))}
            >
              <X size={17} />
              Abort
            </button>
          </div>
        </div>

        {!hasOperation && (
          <section className="merge-start">
            <div>
              <h3>Start merge</h3>
              <p>Merge a local branch into {snapshot?.summary.currentBranch ?? 'the current branch'}.</p>
            </div>
            <select
              value={selectedMergeBranch}
              onChange={(event) => setSelectedMergeBranch(event.target.value)}
              disabled={busy || mergeCandidates.length === 0}
            >
              {mergeCandidates.length === 0 ? (
                <option value="">No branches available</option>
              ) : (
                mergeCandidates.map((branch) => (
                  <option value={branch.name} key={branch.name}>
                    {branch.name}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={mergeSelectedBranch}
              disabled={busy || !selectedMergeBranch || mergeCandidates.length === 0 || hasDirtyWorktree}
            >
              <GitMerge size={17} />
              Merge into {snapshot?.summary.currentBranch ?? 'current'}
            </button>
          </section>
        )}

        {!hasOperation && hasDirtyWorktree && (
          <div className="command-hint">
            Stash or commit local changes before starting a merge.
            <button type="button" onClick={createQuickStash} disabled={busy}>
              <Save size={17} />
              Stash changes
            </button>
          </div>
        )}

        {!hasOperation || mergeState.files.length === 0 ? (
          <div className="quiet-box">Conflict list is empty.</div>
        ) : (
          <div className="conflict-list">
            {mergeState.files.map((file) => (
              <article className="conflict-row" key={file.path}>
                <div>
                  <strong>{file.path}</strong>
                  <span>{file.type}</span>
                </div>
                <div className="panel-actions">
                  <button type="button" onClick={() => api && currentRepoPath && runOperationAction('Opened in editor.', () => api.openInEditor({ targetPath: `${currentRepoPath}/${file.path}` }))}>
                    <Code2 size={17} />
                    Editor
                  </button>
                  <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Accepted ours.', () => api!.acceptOurs({ repoPath: currentRepoPath, filePath: file.path }))}>
                    Ours
                  </button>
                  <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Accepted theirs.', () => api!.acceptTheirs({ repoPath: currentRepoPath, filePath: file.path }))}>
                    Theirs
                  </button>
                  <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Marked resolved.', () => api!.markResolved({ repoPath: currentRepoPath, filePath: file.path }))}>
                    Mark resolved
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    )
  }

  function renderBranchesView(branches: BranchSummary[]) {
    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Branches</h2>
            <p>Create, switch, and safely delete local branches.</p>
          </div>
          <div className="new-branch">
            <input
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="feature/new-work"
            />
            <button type="button" onClick={createBranch} disabled={!newBranchName.trim()}>
              <GitBranch size={17} />
              Create
            </button>
          </div>
        </div>

        <div className="branch-list">
          {branches.map((branch) => (
            <article className={branch.current ? 'branch-row current' : 'branch-row'} key={branch.name}>
              <div>
                <strong>{branch.name}</strong>
                <span>{branch.upstream || 'No upstream'} · {branch.lastCommitAt ? formatDate(branch.lastCommitAt) : 'No commit date'}</span>
              </div>
              <div className="panel-actions">
                {branch.current && !branch.upstream && snapshot?.summary.remoteName && (
                  <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
                    repoPath: currentRepoPath,
                    branch: branch.name,
                    remote: snapshot.summary.remoteName
                  }))}>
                    Publish
                  </button>
                )}
                <button
                  type="button"
                  disabled={branch.current}
                  onClick={() => currentRepoPath && runSnapshotAction('Branch switched.', () => api!.switchBranch({ repoPath: currentRepoPath, branchName: branch.name }))}
                >
                  Switch
                </button>
                <button
                  type="button"
                  disabled={branch.current}
                  onClick={() => currentRepoPath && window.confirm(`Delete local branch ${branch.name}?`) && runSnapshotAction('Branch deleted.', () => api!.deleteBranch({ repoPath: currentRepoPath, branchName: branch.name, force: false }))}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
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
          <button type="button" onClick={runReviewReport} disabled={!snapshot || busy}>
            <ShieldCheck size={17} />
            Run review
          </button>
        </div>

        <div className="review-workspace">
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

          {!snapshot ? (
            <div className="quiet-box">Open a repository before running a review.</div>
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

        <div className="assistant-grid">
          {assistants.map((assistant) => (
            <div className="provider-card" key={assistant.id}>
              <Bot size={20} />
              <strong>{assistant.label}</strong>
              <span>{assistant.detected ? `Detected: ${assistant.executable}` : 'Not detected'}</span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  function renderProvidersView() {
    const githubProvider = providers.find((provider) => provider.id === 'github')
    const canCreatePr = Boolean(
      snapshot &&
      !snapshot.summary.isDetached &&
      prTitle.trim() &&
      githubCliStatus?.authenticated &&
      snapshot.summary.upstream &&
      !currentPullRequest
    )

    return (
      <section className="single-panel">
        <div className="panel-heading">
          <div>
            <h2>Providers</h2>
            <p>GitHub uses the local GitHub CLI bridge first; full provider APIs remain later.</p>
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
            <div className="command-hint">Run <code>gh auth login</code> in Terminal, then refresh this panel.</div>
          )}

          {githubCliStatus?.state === 'missing' && (
            <div className="command-hint">Install GitHub CLI to create pull requests from BranchPilot.</div>
          )}

          {snapshot && !snapshot.summary.upstream && (
            <div className="command-hint">
              Publish the current branch before creating a pull request.
              {canPublishBranch && (
                <button type="button" onClick={() => currentRepoPath && runSnapshotAction('Branch published.', () => api!.publishBranch({
                  repoPath: currentRepoPath,
                  remote: snapshot.summary.remoteName
                }))}>
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
                <button type="button" className="secondary" onClick={() => window.open(currentPullRequest.url, '_blank', 'noopener,noreferrer')}>
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
              <button type="button" onClick={generatePullRequestText} disabled={!snapshot || busy}>
                <Bot size={17} />
                Generate PR text
              </button>
              {currentPullRequest ? (
                <button type="button" onClick={() => window.open(currentPullRequest.url, '_blank', 'noopener,noreferrer')} disabled={busy}>
                  <ExternalLink size={17} />
                  Open current PR
                </button>
              ) : (
                <button type="button" onClick={createPullRequest} disabled={!canCreatePr || busy}>
                  <GitPullRequest size={17} />
                  Create PR
                </button>
              )}
              {createdPullRequest && (
                <button type="button" className="secondary" onClick={() => window.open(createdPullRequest.url, '_blank', 'noopener,noreferrer')}>
                  <ExternalLink size={17} />
                  Open PR
                </button>
              )}
            </div>
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
                <p>{pullRequests.length} recent pull request{pullRequests.length === 1 ? '' : 's'} from GitHub CLI.</p>
              </div>
              <button type="button" className="secondary" onClick={loadGitHubPullRequests} disabled={busy || !githubCliStatus?.authenticated || !snapshot}>
                <RefreshCcw size={17} />
                Refresh PRs
              </button>
            </div>

            {githubCliStatus?.authenticated && pullRequests.length === 0 ? (
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
                            disabled={busy}
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
                            window.open(pullRequest.url, '_blank', 'noopener,noreferrer')
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
                <div className="quiet-box">No checks reported by GitHub CLI.</div>
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
                        <button type="button" className="secondary" onClick={() => window.open(check.link, '_blank', 'noopener,noreferrer')}>
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
                      <span className={`file-status status-${file.status}`}>{diffFileToken(file)}</span>
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DiffPreview({
  diff,
  mode,
  busy = false,
  onStageHunk,
  onUnstageHunk
}: {
  diff: DiffResult | null
  mode?: DiffMode
  busy?: boolean
  onStageHunk?: (hunk: DiffHunk) => void
  onUnstageHunk?: (hunk: DiffHunk) => void
}) {
  if (!diff) {
    return <div className="diff-empty">No diff selected.</div>
  }

  if (diff.binary) {
    return <div className="diff-empty">Binary file preview is not available.</div>
  }

  if (!diff.text.trim()) {
    return <div className="diff-empty">No textual diff for this selection.</div>
  }

  if (diff.tooLarge || diff.files.length === 0) {
    return <RawDiffPreview diff={diff} />
  }

  return (
    <div className="structured-diff">
      {diff.files.map((file) => (
        <section className="diff-file" key={`${file.oldPath ?? 'none'}-${file.newPath}`}>
          <div className="diff-file-heading">
            <strong>{file.newPath}</strong>
            {file.oldPath && file.oldPath !== file.newPath && <span>from {file.oldPath}</span>}
          </div>
          {file.hunks.map((hunk, index) => (
            <article className="diff-hunk" key={`${hunk.header}-${index}`}>
              <div className="diff-hunk-heading">
                <code>{hunk.header}</code>
                {mode === 'unstaged' && onStageHunk && (
                  <button type="button" onClick={() => onStageHunk(hunk)} disabled={busy}>
                    <Plus size={15} />
                    Stage hunk
                  </button>
                )}
                {mode === 'staged' && onUnstageHunk && (
                  <button type="button" onClick={() => onUnstageHunk(hunk)} disabled={busy}>
                    <X size={15} />
                    Unstage hunk
                  </button>
                )}
              </div>
              <div className="diff-lines">
                {hunk.lines.map((line, lineIndex) => (
                  <code className={`diff-line line-${line.type}`} key={`${lineIndex}-${line.type}-${line.content.slice(0, 20)}`}>
                    <span className="line-number">{formatLineNumber(line.oldLineNumber)}</span>
                    <span className="line-number">{formatLineNumber(line.newLineNumber)}</span>
                    <span className="line-marker">{diffLinePrefix(line)}</span>
                    <span className="line-content">{line.content}</span>
                  </code>
                ))}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}

function RawDiffPreview({ diff }: { diff: DiffResult }) {
  return (
    <pre className="diff-preview">
      {diff.tooLarge && <code className="line marker-base">Diff truncated for performance.</code>}
      {diff.text.split('\n').map((line, index) => (
        <code className={`line ${lineClass(line)}`} key={`${index}-${line.slice(0, 20)}`}>
          <span>{linePrefix(line)}</span>
          {line}
        </code>
      ))}
    </pre>
  )
}

function changeLabel(change: FileChange): string {
  const parts = []
  if (change.staged) parts.push('staged')
  if (change.unstaged) parts.push('unstaged')
  if (change.untracked) parts.push('untracked')
  if (change.conflicted) parts.push('conflict')
  return parts.join(' / ') || change.status
}

function statusToken(change: FileChange): string {
  if (change.conflicted) return '!'
  if (change.untracked) return '?'
  if (change.status === 'renamed') return 'R'
  if (change.status === 'deleted') return 'D'
  if (change.status === 'added') return 'A'
  return 'M'
}

function commitFileToken(file: CommitFileChange): string {
  if (file.status === 'renamed') return 'R'
  if (file.status === 'copied') return 'C'
  if (file.status === 'deleted') return 'D'
  if (file.status === 'added') return 'A'
  return 'M'
}

function diffFileToken(file: GitHubPullRequestDiffFile): string {
  if (file.status === 'renamed') return 'R'
  if (file.status === 'deleted') return 'D'
  if (file.status === 'added') return 'A'
  return 'M'
}

function checkBucketClass(bucket: string): string {
  if (bucket === 'pass') return 'pass'
  if (bucket === 'fail') return 'fail'
  if (bucket === 'pending') return 'pending'
  if (bucket === 'skipping') return 'skipping'
  if (bucket === 'cancel') return 'cancel'
  return 'other'
}

function assistantLabel(assistant: Exclude<AssistantId, 'auto'>): string {
  return assistant === 'claude' ? 'Claude Code' : 'Codex'
}

function reviewModeLabel(mode: ReviewMode): string {
  if (mode === 'security') return 'Security'
  if (mode === 'quality') return 'Quality'
  return 'Consistency'
}

function reviewScopeLabel(scope: ReviewScope): string {
  if (scope === 'unstaged') return 'Unstaged'
  if (scope === 'branch') return 'Branch'
  return 'Staged'
}

function groupFindingsBySeverity(findings: ReviewFinding[]): Record<ReviewSeverity, ReviewFinding[]> {
  return {
    critical: findings.filter((finding) => finding.severity === 'critical'),
    high: findings.filter((finding) => finding.severity === 'high'),
    medium: findings.filter((finding) => finding.severity === 'medium'),
    low: findings.filter((finding) => finding.severity === 'low'),
    info: findings.filter((finding) => finding.severity === 'info')
  }
}

function providerStateLabel(state: ProviderStatus['state']): string {
  if (state === 'connected') return 'connected'
  if (state === 'unauthenticated') return 'gh login required'
  if (state === 'missing') return 'gh missing'
  return state
}

function githubStatusLabel(status: GitHubCliStatus): string {
  if (status.state === 'authenticated') {
    return status.username ? `Authenticated as ${status.username}` : 'Authenticated'
  }

  if (status.state === 'unauthenticated') {
    return 'gh auth required'
  }

  return 'gh missing'
}

function memoryFileMeta(file: ProjectMemoryFile): string {
  const parts = [
    (file.language ?? file.extension) || 'file',
    formatBytes(file.sizeBytes),
    `${file.symbolCount} symbols`
  ]

  if (file.importCount > 0) {
    parts.push(`${file.importCount} imports`)
  }

  return parts.join(' · ')
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string): string {
  if (!value) return 'Unknown date'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'marker-add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'marker-remove'
  return 'marker-base'
}

function linePrefix(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return '+'
  if (line.startsWith('-') && !line.startsWith('---')) return '-'
  return ' '
}

function diffLinePrefix(line: DiffLine): string {
  if (line.type === 'add') return '+'
  if (line.type === 'remove') return '-'
  if (line.type === 'meta') return '\\'
  return ' '
}

function formatLineNumber(lineNumber?: number): string {
  return lineNumber ? String(lineNumber) : ''
}

export default App
