import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, UploadCloud } from 'lucide-react'
import type {
  AssistantId,
  AssistantPolicyStatus,
  BranchPilotApi,
  GitConfigSnapshot,
  GitHubAccountSummary,
  GitHubCliStatus,
  RepositorySnapshot
} from '../../shared/branchPilot'
import { branchPilotErrorText } from '../../shared/branchPilot'
import { assistantPolicyAllows, assistantPolicyBlockedLabel } from '../../lib/assistantLabels'
import { PublishDestinationCard } from './publish/PublishDestinationCard'
import { PublishStarterCard } from './publish/PublishStarterCard'
import {
  buildLocalGitignore,
  buildLocalReadme,
  buildRepositoryNameSuggestions,
  createRepositoryBlockedReason,
  normalizeEmailInput,
  sanitizeRepositoryName,
  titleFromRepositoryName,
  uniqueStrings
} from './publish/publishRepositoryHelpers'
import type { OwnerKind } from './publish/publishRepositoryHelpers'

export function PublishRepositoryView({
  api,
  snapshot,
  selectedAssistant,
  assistantPolicy,
  onClose,
  onPublished,
  setNotice,
  setError
}: {
  api: BranchPilotApi | undefined
  snapshot: RepositorySnapshot | null
  selectedAssistant: AssistantId
  assistantPolicy: AssistantPolicyStatus | null
  onClose: () => void
  onPublished: (snapshot: RepositorySnapshot, message: string) => void
  setNotice: (message: string) => void
  setError: (message: string | null) => void
}) {
  const repoPath = snapshot?.summary.rootPath
  const defaultName = useMemo(() => sanitizeRepositoryName(snapshot?.summary.name ?? ''), [snapshot?.summary.name])
  const [accounts, setAccounts] = useState<GitHubAccountSummary[]>([])
  const [githubStatus, setGithubStatus] = useState<GitHubCliStatus | null>(null)
  const [gitConfig, setGitConfig] = useState<GitConfigSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [ownerKind, setOwnerKind] = useState<OwnerKind>('user')
  const [owner, setOwner] = useState('')
  const [name, setName] = useState(defaultName)
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [description, setDescription] = useState('')
  const [remoteName, setRemoteName] = useState('origin')
  const [remoteProtocol, setRemoteProtocol] = useState<'https' | 'ssh'>('https')
  const [gitUserName, setGitUserName] = useState('')
  const [gitUserEmail, setGitUserEmail] = useState('')
  const [readme, setReadme] = useState('')
  const [gitignore, setGitignore] = useState('')
  const [includeReadme, setIncludeReadme] = useState(true)
  const [includeGitignore, setIncludeGitignore] = useState(true)
  const [commitStarterFiles, setCommitStarterFiles] = useState(true)
  const [pushAfterCreate, setPushAfterCreate] = useState(true)
  const userAccounts = useMemo(() => accounts.filter((account) => account.type === 'user'), [accounts])
  const organizationAccounts = useMemo(() => accounts.filter((account) => account.type === 'organization'), [accounts])
  const ownerAccounts = ownerKind === 'user' ? userAccounts : organizationAccounts
  const authenticatedUserAccount = useMemo(
    () => userAccounts.find((account) => account.login === githubStatus?.username) ?? userAccounts[0],
    [githubStatus?.username, userAccounts]
  )
  const commitAuthorAccount = useMemo(
    () => ownerKind === 'user'
      ? userAccounts.find((account) => account.login === owner) ?? authenticatedUserAccount
      : authenticatedUserAccount,
    [authenticatedUserAccount, owner, ownerKind, userAccounts]
  )
  const gitIdentityEmailOptions = useMemo(() => uniqueStrings([
    ...(commitAuthorAccount?.emails ?? []),
    gitConfig?.localUserEmail ?? '',
    gitConfig?.globalUserEmail ?? ''
  ].map(normalizeEmailInput)).filter(Boolean), [commitAuthorAccount, gitConfig?.globalUserEmail, gitConfig?.localUserEmail])
  const commitAuthorPreview = gitUserName.trim() && gitUserEmail.trim()
    ? `${gitUserName.trim()} <${gitUserEmail.trim()}>`
    : 'Choose a commit author email'
  const repoNameSuggestions = useMemo(() => buildRepositoryNameSuggestions(defaultName), [defaultName])
  const canGenerateStarter = assistantPolicyAllows(assistantPolicy, 'repository_starter')
  const starterBlockedText = canGenerateStarter ? '' : assistantPolicyBlockedLabel('repository_starter', assistantPolicy)
  const generateStarterTitle = canGenerateStarter
    ? 'Generate description, README.md, and .gitignore with the selected assistant'
    : starterBlockedText
  const createBlockedReason = createRepositoryBlockedReason({
    apiReady: Boolean(api),
    repoPath,
    authenticated: githubStatus?.authenticated ?? false,
    authMessage: githubStatus?.message,
    owner,
    name
  })
  const canSubmit = Boolean(!createBlockedReason && !submitting)

  useEffect(() => {
    setName(defaultName)
  }, [defaultName])

  useEffect(() => {
    if (ownerAccounts.length > 0) {
      setOwner((currentOwner) => ownerAccounts.some((account) => account.login === currentOwner)
        ? currentOwner
        : ownerAccounts[0].login)
      return
    }

    if (ownerKind === 'user' && githubStatus?.username) {
      setOwner((currentOwner) => currentOwner || githubStatus.username || '')
    } else if (ownerKind === 'organization' && accounts.length > 0) {
      setOwner('')
    }
  }, [accounts.length, githubStatus?.username, ownerAccounts, ownerKind])

  useEffect(() => {
    if (!gitUserEmail.trim() && gitIdentityEmailOptions.length > 0) {
      setGitUserEmail(gitIdentityEmailOptions[0])
    }
  }, [gitIdentityEmailOptions, gitUserEmail])

  useEffect(() => {
    if (!api || !repoPath) return
    const branchPilotApi = api
    const repositoryPath = repoPath
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [statusResult, configResult] = await Promise.all([
        branchPilotApi.getGitHubCliStatus(repositoryPath),
        branchPilotApi.getGitConfig(repositoryPath)
      ])

      if (cancelled) return

      if (statusResult.ok) {
        setGithubStatus(statusResult.data)

        if (statusResult.data.authenticated) {
          const accountsResult = await branchPilotApi.listGitHubAccounts()

          if (!cancelled) {
            if (accountsResult.ok) {
              applyAccounts(accountsResult.data, statusResult.data.username)
            } else {
              setError(accountsResult.error.message)
              setNotice(branchPilotErrorText(accountsResult.error))
            }
          }
        } else {
          setNotice(statusResult.data.message)
        }
      } else {
        setError(statusResult.error.message)
        setNotice(branchPilotErrorText(statusResult.error))
      }

      if (configResult.ok) {
        setGitConfig(configResult.data)
        setGitUserName(configResult.data.localUserName ?? configResult.data.globalUserName ?? '')
        setGitUserEmail(configResult.data.localUserEmail ?? configResult.data.globalUserEmail ?? '')
      }

      if (!cancelled) setLoading(false)
    }

    void load()

    return () => { cancelled = true }
  }, [api, repoPath])

  function applyAccounts(nextAccounts: GitHubAccountSummary[], username?: string) {
    setAccounts(nextAccounts)
    const user = nextAccounts.find((account) => account.type === 'user')?.login || username || ''
    setOwner((currentOwner) => currentOwner || user)
  }

  async function reloadAccounts() {
    if (!api || !repoPath) return
    setLoading(true)
    setError(null)
    const statusResult = await api.getGitHubCliStatus(repoPath)

    if (statusResult.ok) {
      setGithubStatus(statusResult.data)

      if (statusResult.data.authenticated) {
        const accountsResult = await api.listGitHubAccounts()

        if (accountsResult.ok) {
          applyAccounts(accountsResult.data, statusResult.data.username)
          setNotice(`Loaded ${accountsResult.data.length} GitHub account${accountsResult.data.length === 1 ? '' : 's'}.`)
        } else {
          setError(accountsResult.error.message)
          setNotice(branchPilotErrorText(accountsResult.error))
        }
      } else {
        setNotice(statusResult.data.message)
      }
    } else {
      setError(statusResult.error.message)
      setNotice(branchPilotErrorText(statusResult.error))
    }

    setLoading(false)
  }

  async function generateStarter() {
    if (!api || !repoPath || !canGenerateStarter) return
    setGenerating(true)
    setError(null)
    const result = await api.generateRepositoryStarter({
      repoPath,
      assistant: selectedAssistant,
      repositoryName: name.trim() || defaultName
    })

    if (result.ok) {
      setDescription(result.data.description)
      setReadme(result.data.readme)
      setGitignore(result.data.gitignore)
      setIncludeReadme(Boolean(result.data.readme.trim()))
      setIncludeGitignore(Boolean(result.data.gitignore.trim()))
      setNotice(`Starter content generated with ${result.data.assistant}.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setGenerating(false)
  }

  function draftStarterLocally() {
    const repoName = name.trim() || defaultName || 'repository'
    const title = titleFromRepositoryName(repoName)
    const nextDescription = description.trim() || `${title} source repository.`

    setDescription(nextDescription)
    setReadme(buildLocalReadme(title, nextDescription))
    setGitignore(buildLocalGitignore(snapshot))
    setIncludeReadme(true)
    setIncludeGitignore(true)
    setNotice('Starter files drafted locally.')
  }

  async function createRepository() {
    if (!api || !repoPath || !canSubmit) return
    setSubmitting(true)
    setError(null)

    const result = await api.createGitHubRepository({
      repoPath,
      owner: owner.trim(),
      name: name.trim(),
      description: description.trim(),
      visibility,
      remoteName: remoteName.trim() || 'origin',
      remoteProtocol,
      gitUserName: gitUserName.trim(),
      gitUserEmail: gitUserEmail.trim(),
      readme: includeReadme ? readme : '',
      gitignore: includeGitignore ? gitignore : '',
      commitStarterFiles,
      push: pushAfterCreate,
      confirmed: true
    })

    if (result.ok) {
      onPublished(result.data.snapshot, `${result.data.nameWithOwner} created${result.data.pushed ? ' and pushed' : ''}.`)
      onClose()
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setSubmitting(false)
  }

  return (
    <section className="publish-panel">
      <div className="publish-heading">
        <div>
          <h3>Create GitHub repository</h3>
          <p>{repoPath ? `Publish ${snapshot?.summary.name ?? 'this repository'} from the current local Git folder.` : 'Open a repository first.'}</p>
        </div>
        <button type="button" className="secondary" onClick={reloadAccounts} disabled={loading || submitting || !api || !repoPath}>
          {loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          Accounts
        </button>
      </div>

      <div className="publish-grid">
        <PublishDestinationCard
          githubStatus={githubStatus}
          gitConfig={gitConfig}
          accounts={accounts}
          ownerAccounts={ownerAccounts}
          organizationAccounts={organizationAccounts}
          ownerKind={ownerKind}
          setOwnerKind={setOwnerKind}
          owner={owner}
          setOwner={setOwner}
          name={name}
          setName={setName}
          repoNameSuggestions={repoNameSuggestions}
          description={description}
          setDescription={setDescription}
          visibility={visibility}
          setVisibility={setVisibility}
          remoteProtocol={remoteProtocol}
          setRemoteProtocol={setRemoteProtocol}
          remoteName={remoteName}
          setRemoteName={setRemoteName}
          currentBranch={snapshot?.summary.currentBranch ?? ''}
          commitAuthorPreview={commitAuthorPreview}
          gitIdentityEmailOptions={gitIdentityEmailOptions}
          gitUserName={gitUserName}
          setGitUserName={setGitUserName}
          gitUserEmail={gitUserEmail}
          setGitUserEmail={setGitUserEmail}
        />

        <PublishStarterCard
          generating={generating}
          submitting={submitting}
          canGenerateStarter={canGenerateStarter}
          starterBlockedText={starterBlockedText}
          generateStarterTitle={generateStarterTitle}
          generateDisabled={!api || !repoPath || generating || submitting || !canGenerateStarter}
          onDraftLocally={draftStarterLocally}
          onGenerate={generateStarter}
          includeReadme={includeReadme}
          setIncludeReadme={setIncludeReadme}
          readme={readme}
          setReadme={setReadme}
          includeGitignore={includeGitignore}
          setIncludeGitignore={setIncludeGitignore}
          gitignore={gitignore}
          setGitignore={setGitignore}
          commitStarterFiles={commitStarterFiles}
          setCommitStarterFiles={setCommitStarterFiles}
          pushAfterCreate={pushAfterCreate}
          setPushAfterCreate={setPushAfterCreate}
        />
      </div>

      <div className="publish-actions">
        <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Cancel</button>
        <button
          type="button"
          onClick={createRepository}
          disabled={!canSubmit}
          title={createBlockedReason || 'Create the GitHub repository, add the remote, and push this branch'}
        >
          {submitting ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}
          Create repository
        </button>
      </div>
    </section>
  )
}
