import { Building2, GitBranch, UserRound } from 'lucide-react'
import type { GitConfigSnapshot, GitHubAccountSummary, GitHubCliStatus } from '../../../shared/branchPilot'
import { SelectableChipGroup } from '../../SelectableChipGroup'
import { isSameEmail, sanitizeRepositoryName } from './publishRepositoryHelpers'
import type { OwnerKind } from './publishRepositoryHelpers'

export function PublishDestinationCard({
  githubStatus,
  gitConfig,
  accounts,
  ownerAccounts,
  organizationAccounts,
  ownerKind,
  setOwnerKind,
  owner,
  setOwner,
  name,
  setName,
  repoNameSuggestions,
  description,
  setDescription,
  visibility,
  setVisibility,
  remoteProtocol,
  setRemoteProtocol,
  remoteName,
  setRemoteName,
  currentBranch,
  commitAuthorPreview,
  gitIdentityEmailOptions,
  gitUserName,
  setGitUserName,
  gitUserEmail,
  setGitUserEmail
}: {
  githubStatus: GitHubCliStatus | null
  gitConfig: GitConfigSnapshot | null
  accounts: GitHubAccountSummary[]
  ownerAccounts: GitHubAccountSummary[]
  organizationAccounts: GitHubAccountSummary[]
  ownerKind: OwnerKind
  setOwnerKind: (kind: OwnerKind) => void
  owner: string
  setOwner: (owner: string) => void
  name: string
  setName: (name: string) => void
  repoNameSuggestions: string[]
  description: string
  setDescription: (description: string) => void
  visibility: 'private' | 'public'
  setVisibility: (visibility: 'private' | 'public') => void
  remoteProtocol: 'https' | 'ssh'
  setRemoteProtocol: (protocol: 'https' | 'ssh') => void
  remoteName: string
  setRemoteName: (remoteName: string) => void
  currentBranch: string
  commitAuthorPreview: string
  gitIdentityEmailOptions: string[]
  gitUserName: string
  setGitUserName: (name: string) => void
  gitUserEmail: string
  setGitUserEmail: (email: string) => void
}) {
  return (
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
          <input value={currentBranch} readOnly />
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
  )
}
