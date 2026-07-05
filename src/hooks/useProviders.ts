import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApiResult, AssistantId, AssistantPolicyStatus, BranchPilotApi, CreatedPullRequest, DiffResult,
  GitHubAccountSummary, GitHubCliStatus, GitHubPullRequest, GitHubPullRequestCheck,
  GitHubPullRequestDetails, GitHubPullRequestDiff, GitHubRepositorySummary, ProviderStatus, RepositorySnapshot
} from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { assistantLabel, assistantPolicyAllows, assistantPolicyBlockedLabel } from '../lib/assistantLabels'
import { defaultPullRequestBaseBranch, normalizePullRequestBaseBranch } from '../lib/pullRequestBranches'
import type { RequestConfirmation } from '../lib/prompts'
import type { ViewMode } from '../lib/viewMode'

/** Owns provider/GitHub status, repository browser, and pull-request workflows. */
export function useProviders({
  api,
  currentRepoPath,
  snapshot,
  viewMode,
  selectedAssistant,
  assistantPolicy,
  setNotice,
  setError,
  runApiAction,
  runBusyOperation,
  runSnapshotAction,
  applySnapshot,
  requestConfirmation,
  setViewMode,
  loadHistory
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  viewMode: ViewMode
  selectedAssistant: AssistantId
  assistantPolicy: AssistantPolicyStatus | null
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  runApiAction: <T>(progressLabel: string, action: () => Promise<ApiResult<T>>, onSuccess: (data: T) => void | Promise<void>) => Promise<boolean>
  runBusyOperation: <T>(label: string, action: () => Promise<T>) => Promise<T>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  applySnapshot: (snapshot: RepositorySnapshot, successMessage: string) => void
  requestConfirmation: RequestConfirmation
  setViewMode: (mode: ViewMode) => void
  loadHistory: () => void | Promise<void>
}) {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [githubCliStatus, setGithubCliStatus] = useState<GitHubCliStatus | null>(null)
  const [githubAccounts, setGithubAccounts] = useState<GitHubAccountSummary[]>([])
  const [githubAccountsLoading, setGithubAccountsLoading] = useState(false)
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepositorySummary[]>([])
  const [githubRepoOwner, setGithubRepoOwner] = useState('')
  const [githubRepoQuery, setGithubRepoQuery] = useState('')
  const [githubRepoVisibility, setGithubRepoVisibility] = useState<'all' | 'public' | 'private' | 'internal'>('all')
  const [githubRepoLimit, setGithubRepoLimit] = useState('500')
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
  const pullRequestDetailsRequestIdRef = useRef(0)
  const prComposerSourceRef = useRef<number | null>(null)

  const canPublishBranch = Boolean(snapshot && !snapshot.summary.isDetached && !snapshot.summary.upstream && snapshot.summary.remoteName)
  const canGeneratePullRequestText = assistantPolicyAllows(assistantPolicy, 'pull_request_text')

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

  async function loadGitHubAccounts(statusOverride?: GitHubCliStatus | null, quiet = false) {
    await fetchGitHubAccounts(statusOverride, quiet)
  }

  async function fetchGitHubAccounts(statusOverride?: GitHubCliStatus | null, quiet = false): Promise<GitHubAccountSummary[]> {
    if (!api) return []

    setGithubAccountsLoading(true)
    setError(null)
    const status = statusOverride ?? (githubCliStatus?.authenticated ? githubCliStatus : await loadGitHubCliStatus())

    if (!status?.authenticated) {
      setGithubAccounts([])
      if (!quiet) {
        setNotice('Connect GitHub before loading accounts.')
      }
      setGithubAccountsLoading(false)
      return []
    }

    const result = await api.listGitHubAccounts()

    if (result.ok) {
      setGithubAccounts(result.data)
      if (!quiet) {
        setNotice(`Loaded ${result.data.length} GitHub account${result.data.length === 1 ? '' : 's'}.`)
      }
      setGithubAccountsLoading(false)
      return result.data
    } else {
      setGithubAccounts([])
      setError(result.error.message)
      if (!quiet) {
        setNotice(branchPilotErrorText(result.error))
      }
    }

    setGithubAccountsLoading(false)
    return []
  }

  async function loadGitHubRepositories() {
    if (!api) return

    setGithubRepoLoading(true)
    setError(null)
    const status = githubCliStatus?.authenticated ? githubCliStatus : await loadGitHubCliStatus()

    if (!status?.authenticated) {
      setGithubRepositories([])
      setNotice('Connect GitHub before browsing repositories.')
      setGithubRepoLoading(false)
      return
    }

    const limit = Math.min(500, Math.max(1, Number.parseInt(githubRepoLimit, 10) || 500))
    const owner = githubRepoOwner.trim() || undefined
    const request = {
      owner,
      query: githubRepoQuery.trim() || undefined,
      visibility: githubRepoVisibility,
      limit
    }
    const accountsForAllOwners = owner
      ? []
      : githubAccounts.length > 0
        ? githubAccounts
        : await fetchGitHubAccounts(status, true)

    const results = await Promise.all([
      api.listGitHubRepositories(request),
      ...(!owner && accountsForAllOwners.length > 0
        ? accountsForAllOwners.map((account) => api.listGitHubRepositories({ ...request, owner: account.login }))
        : [])
    ])
    const result = results[0]

    if (result.ok) {
      const repositoriesByName = new Map<string, GitHubRepositorySummary>()

      for (const currentResult of results) {
        if (!currentResult.ok) continue

        for (const repository of currentResult.data) {
          repositoriesByName.set(repository.nameWithOwner.toLowerCase(), repository)
        }
      }

      const repositories = Array.from(repositoriesByName.values())
        .sort((left, right) => Date.parse(right.pushedAt || right.updatedAt) - Date.parse(left.pushedAt || left.updatedAt))
        .slice(0, limit)

      setGithubRepositories(repositories)
      setNotice(`Loaded ${repositories.length} GitHub repositor${repositories.length === 1 ? 'y' : 'ies'}.`)
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
        try { localStorage.setItem('bp-repo', result.data.summary.rootPath) } catch { /* ignore */ }
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

  useEffect(() => {
    if (!api) return
    void loadGitHubCliStatus()
  }, [api, currentRepoPath])

  async function connectGitHub() {
    if (!api) return

    await runBusyOperation('Connecting GitHub...', async () => {
      setError(null)
      const result = await api.connectGitHub(currentRepoPath)

      if (result.ok) {
        setGithubCliStatus(result.data)
        setNotice(result.data.username ? `GitHub connected as ${result.data.username}.` : 'GitHub connected.')
        await refreshProvidersPanel()
      } else {
        setError(result.error.message)
        setNotice(branchPilotErrorText(result.error))
      }
    })
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
      baseBranch: normalizePullRequestBaseBranch(prBaseBranch, snapshot?.summary.remoteName).trim() || undefined
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
        baseBranch: normalizePullRequestBaseBranch(prBaseBranch, snapshot?.summary.remoteName).trim() || undefined
      })

      if (result.ok) {
        setCreatedPullRequest(result.data)
        setNotice('Pull request created.')
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
    prComposerSourceRef.current = null
    setCreatedPullRequest(null)
     
  }, [snapshot?.summary.rootPath])

  useEffect(() => {
    setPrBaseBranch((currentBaseBranch) => {
      const trimmed = normalizePullRequestBaseBranch(currentBaseBranch, snapshot?.summary.remoteName).trim()

      if (trimmed && trimmed !== snapshot?.summary.currentBranch) {
        return trimmed
      }

      return defaultPullRequestBaseBranch(snapshot)
    })
  }, [snapshot])

  useEffect(() => {
    if (!selectedPullRequestDetails) return
    const sourceChanged = prComposerSourceRef.current !== selectedPullRequestDetails.number
    prComposerSourceRef.current = selectedPullRequestDetails.number

    setPrTitle((currentTitle) => (
      sourceChanged || !currentTitle.trim() ? selectedPullRequestDetails.title : currentTitle
    ))
    setPrDescription((currentDescription) => (
      sourceChanged || !currentDescription.trim() ? selectedPullRequestDetails.body : currentDescription
    ))
    setPrBaseBranch((currentBaseBranch) => (
      sourceChanged || !currentBaseBranch.trim() ? selectedPullRequestDetails.baseBranch : currentBaseBranch
    ))
  }, [selectedPullRequestDetails])

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

  return {
    providers,
    githubCliStatus,
    githubAccounts, githubAccountsLoading,
    githubRepositories, githubRepoOwner, setGithubRepoOwner, githubRepoQuery, setGithubRepoQuery,
    githubRepoVisibility, setGithubRepoVisibility, githubRepoLimit, setGithubRepoLimit, githubRepoLoading,
    currentPullRequest, pullRequests, pullRequestsLoading,
    selectedPullRequestNumber, selectedPullRequestDetails, selectedPullRequestChecks,
    selectedPullRequestDiff, selectedPullRequestFilePath, setSelectedPullRequestFilePath, pullRequestDetailsLoading,
    prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch, createdPullRequest,
    canPublishBranch, canGeneratePullRequestText,
    selectedPullRequestFile, selectedPullRequestDiffResult,
    loadProviders, loadGitHubCliStatus, loadGitHubPullRequests, loadGitHubAccounts, loadGitHubRepositories,
    cloneGitHubRepository, refreshProvidersPanel, refreshProviderStatusOnly, connectGitHub, loadPullRequestDetails,
    generatePullRequestText, createPullRequest, checkoutPullRequest, selectPullRequest
  }
}
