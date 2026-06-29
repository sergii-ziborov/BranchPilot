import { useEffect, useMemo, useState } from 'react'
import { Bot, Building2, GitBranch, Loader2, RefreshCw, UploadCloud, UserRound, Wand2 } from 'lucide-react'
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
import { SelectableChipGroup } from '../SelectableChipGroup'

type OwnerKind = GitHubAccountSummary['type']

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
        <div className="publish-card publish-settings-card">
          <div className="publish-card-heading publish-card-heading-compact">
            <div>
              <h3>Destination</h3>
              <p>Choose where GitHub should create the remote repository.</p>
            </div>
          </div>

          <div className="publish-status">
            <GitBranch size={18} />
            <div>
              <strong>{githubStatus?.authenticated ? `Signed in${githubStatus.username ? ` as ${githubStatus.username}` : ''}` : 'GitHub auth required'}</strong>
              <span>{githubStatus?.message ?? 'Checking GitHub authentication.'}</span>
            </div>
          </div>

          <div className="publish-segmented" aria-label="Owner type">
            <button type="button" className={ownerKind === 'user' ? 'active' : ''} onClick={() => setOwnerKind('user')}>
              <UserRound size={15} />
              User
            </button>
            <button type="button" className={ownerKind === 'organization' ? 'active' : ''} onClick={() => setOwnerKind('organization')}>
              <Building2 size={15} />
              Organization
            </button>
          </div>

          <label>
            <span>{ownerKind === 'user' ? 'GitHub account' : 'Organization'}</span>
            {ownerAccounts.length > 0 ? (
              <select value={owner} onChange={(event) => setOwner(event.target.value)}>
                {ownerAccounts.map((account) => (
                  <option key={account.login} value={account.login}>{account.login} - {account.label}</option>
                ))}
              </select>
            ) : (
              <input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder={ownerKind === 'user' ? 'GitHub username' : 'GitHub organization'}
              />
            )}
          </label>

          {ownerKind === 'organization' && accounts.length > 0 && organizationAccounts.length === 0 && (
            <div className="publish-inline-note">No organizations were returned for the authenticated account.</div>
          )}

          <label>
            <span>Repository name</span>
            <input value={name} onChange={(event) => setName(sanitizeRepositoryName(event.target.value))} placeholder="repository-name" />
          </label>

          <SelectableChipGroup
            options={repoNameSuggestions}
            selected={name}
            onSelect={setName}
            variant="name-suggestions"
            ariaLabel="Repository name suggestions"
          />

          <label>
            <span>Description</span>
            <textarea className="publish-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short GitHub repository description" />
          </label>

          <div className="publish-two-col">
            <label>
              <span>Visibility</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'private' | 'public')}>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>
            <label>
              <span>Protocol</span>
              <select value={remoteProtocol} onChange={(event) => setRemoteProtocol(event.target.value as 'https' | 'ssh')}>
                <option value="https">HTTPS</option>
                <option value="ssh">SSH</option>
              </select>
            </label>
          </div>

          <div className="publish-two-col">
            <label>
              <span>Remote name</span>
              <input value={remoteName} onChange={(event) => setRemoteName(event.target.value)} placeholder="origin" />
            </label>
            <label>
              <span>Current branch</span>
              <input value={snapshot?.summary.currentBranch ?? ''} readOnly />
            </label>
          </div>

          <div className="publish-identity-block">
            <strong>Commit author</strong>
            <p>Used for the optional README/.gitignore starter commit. Pick the GitHub email intentionally.</p>
            <div className="publish-commit-as">
              <UserRound size={16} />
              <div>
                <span>Starter commit will be authored as</span>
                <strong>{commitAuthorPreview}</strong>
              </div>
            </div>
            {gitIdentityEmailOptions.length > 0 && (
              <SelectableChipGroup
                options={gitIdentityEmailOptions}
                selected={gitIdentityEmailOptions.find((email) => isSameEmail(gitUserEmail, email)) ?? ''}
                onSelect={setGitUserEmail}
                variant="email-options"
                ariaLabel="Known GitHub and Git config emails"
                titleFor={(email) => `Use ${email} as the starter commit author`}
              />
            )}
            <div className="publish-two-col">
              <label>
                <span>Name</span>
                <input value={gitUserName} onChange={(event) => setGitUserName(event.target.value)} placeholder={gitConfig?.globalUserName ?? 'Name'} />
              </label>
              <label>
                <span>Custom email</span>
                <input value={gitUserEmail} onChange={(event) => setGitUserEmail(event.target.value)} placeholder={gitConfig?.globalUserEmail ?? 'email@example.com'} />
              </label>
            </div>
          </div>
        </div>

        <div className="publish-card publish-starter-card">
          <div className="publish-card-heading">
            <div>
              <h3>Starter files</h3>
              <p>Draft README.md, .gitignore, and description before BranchPilot writes anything.</p>
            </div>
            <div className="publish-starter-actions">
              <button type="button" className="secondary" onClick={draftStarterLocally} disabled={submitting}>
                <Wand2 size={16} />
                Draft locally
              </button>
              <button
                type="button"
                onClick={generateStarter}
                disabled={!api || !repoPath || generating || submitting || !canGenerateStarter}
                title={generateStarterTitle}
              >
                {generating ? <Loader2 className="spin" size={16} /> : <Bot size={16} />}
                Generate with AI
              </button>
            </div>
          </div>

          {!canGenerateStarter && (
            <div className="assistant-policy-note">{starterBlockedText}</div>
          )}

          <label className="publish-check">
            <input type="checkbox" checked={includeReadme} onChange={(event) => setIncludeReadme(event.target.checked)} />
            <span>Write README.md if missing</span>
          </label>
          <textarea className="publish-readme" value={readme} onChange={(event) => setReadme(event.target.value)} placeholder="# README.md" />

          <label className="publish-check">
            <input type="checkbox" checked={includeGitignore} onChange={(event) => setIncludeGitignore(event.target.checked)} />
            <span>Write .gitignore if missing</span>
          </label>
          <textarea className="publish-gitignore" value={gitignore} onChange={(event) => setGitignore(event.target.value)} placeholder={'node_modules/\ndist/'} />

          <div className="publish-options">
            <label className="publish-check">
              <input type="checkbox" checked={commitStarterFiles} onChange={(event) => setCommitStarterFiles(event.target.checked)} />
              <span>Commit generated starter files</span>
            </label>
            <label className="publish-check">
              <input type="checkbox" checked={pushAfterCreate} onChange={(event) => setPushAfterCreate(event.target.checked)} />
              <span>Push current branch after creating remote</span>
            </label>
          </div>
        </div>
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

function sanitizeRepositoryName(value: string): string {
  return value
    .trim()
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 100)
}

function buildRepositoryNameSuggestions(defaultName: string): string[] {
  const compact = sanitizeRepositoryName(defaultName.replace(/[\s_]+/g, '-'))
  const lower = sanitizeRepositoryName(compact.toLowerCase())
  const dotted = sanitizeRepositoryName(lower.replaceAll('-', '.'))
  return uniqueStrings([compact, lower, dotted]).filter(Boolean).slice(0, 3)
}

function titleFromRepositoryName(repositoryName: string): string {
  const words = repositoryName
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Repository'
}

function buildLocalReadme(title: string, description: string): string {
  return `# ${title}

${description}

## Development

Install dependencies and run the project using the commands defined by this repository.

## Repository

This repository was published from BranchPilot.
`
}

function buildLocalGitignore(snapshot: RepositorySnapshot | null): string {
  const paths = snapshot?.status.changes.map((change) => change.path).join('\n') ?? ''
  const patterns = [
    'node_modules/',
    'dist/',
    'build/',
    '.env',
    '.env.local',
    '*.log'
  ]

  if (/\.py\b|pyproject\.toml|requirements\.txt/i.test(paths)) {
    patterns.push('__pycache__/', '*.py[cod]', '.venv/')
  }

  if (/\.rs\b|Cargo\.toml/i.test(paths)) {
    patterns.push('target/')
  }

  return uniqueStrings(patterns).join('\n') + '\n'
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function normalizeEmailInput(value: string | undefined): string {
  return value?.trim() ?? ''
}

function isSameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function createRepositoryBlockedReason({
  apiReady,
  repoPath,
  authenticated,
  authMessage,
  owner,
  name
}: {
  apiReady: boolean
  repoPath?: string
  authenticated: boolean
  authMessage?: string
  owner: string
  name: string
}): string {
  if (!apiReady) return 'BranchPilot API is not available.'
  if (!repoPath) return 'Open a local Git repository first.'
  if (!authenticated) return authMessage || 'Sign in to GitHub with gh or Git credentials first.'
  if (!owner.trim()) return 'Choose a GitHub user or organization.'
  if (!name.trim()) return 'Enter a repository name.'
  return ''
}
