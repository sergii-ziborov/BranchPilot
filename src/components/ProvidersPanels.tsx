import { useMemo, useState } from 'react'
import { ArrowDownToLine, ExternalLink, ListFilter, Loader2, RefreshCcw, Search, UsersRound } from 'lucide-react'
import type {
  DiffResult, GitHubAccountSummary, GitHubCliStatus, GitHubPullRequestCheck,
  GitHubPullRequestDetails, GitHubPullRequestDiff, GitHubRepositorySummary
} from '../shared/branchPilot'
import {
  checkBucketClass, githubAccountOptionLabel, githubRepositoryBrowserSourceLabel, githubRepositoryMeta
} from '../lib/githubLabels'
import { fileStatusToken } from '../lib/fileChangeLabels'
import { formatDate } from '../lib/format'
import {
  filterVisibleGitHubRepositories,
  type GitHubRepositoryOwnerScopeFilter,
  type GitHubRepositoryVisibilityFilter
} from '../lib/githubRepositoryFilters'
import { InfoRow } from './primitives'
import { DiffPreview } from './DiffView'
import { StatusPill } from './StatusPill'

type RepoVisibility = GitHubRepositoryVisibilityFilter
type RepoOwnerScope = GitHubRepositoryOwnerScopeFilter

/** Authenticated GitHub repository browser with clone actions. */
export function GitHubRepositoryBrowser({
  githubCliStatus,
  githubRepositories,
  githubAccounts,
  githubAccountsLoading,
  githubRepoLoading,
  githubRepoOwner,
  setGithubRepoOwner,
  githubRepoQuery,
  setGithubRepoQuery,
  githubRepoVisibility,
  setGithubRepoVisibility,
  githubRepoLimit,
  busy,
  loadGitHubAccounts,
  loadGitHubRepositories,
  cloneGitHubRepository,
  openExternalLink
}: {
  githubCliStatus: GitHubCliStatus | null
  githubRepositories: GitHubRepositorySummary[]
  githubAccounts: GitHubAccountSummary[]
  githubAccountsLoading: boolean
  githubRepoLoading: boolean
  githubRepoOwner: string
  setGithubRepoOwner: (value: string) => void
  githubRepoQuery: string
  setGithubRepoQuery: (value: string) => void
  githubRepoVisibility: RepoVisibility
  setGithubRepoVisibility: (value: RepoVisibility) => void
  githubRepoLimit: string
  busy: boolean
  loadGitHubAccounts: () => void | Promise<void>
  loadGitHubRepositories: () => void | Promise<void>
  cloneGitHubRepository: (repository: GitHubRepositorySummary, protocol: 'https' | 'ssh') => void | Promise<void>
  openExternalLink: (url: string | undefined, label?: string) => void
}) {
  const repoBrowserReady = Boolean(githubCliStatus?.authenticated)
  const [ownerScope, setOwnerScope] = useState<RepoOwnerScope>('all')
  const ownerTypeByLogin = useMemo(() => Object.fromEntries(
    githubAccounts.map((account) => [account.login.toLowerCase(), account.type])
  ), [githubAccounts])
  const currentOwnerAccount = githubAccounts.find((account) => account.login.toLowerCase() === githubRepoOwner.trim().toLowerCase())
  const effectiveOwner = ownerScope === 'all' || currentOwnerAccount?.type === ownerScope ? githubRepoOwner : ''
  const ownerOptions = useMemo(() => (
    ownerScope === 'all' ? githubAccounts : githubAccounts.filter((account) => account.type === ownerScope)
  ), [githubAccounts, ownerScope])
  const filteredRepositories = useMemo(() => filterVisibleGitHubRepositories(githubRepositories, {
    owner: effectiveOwner,
    ownerScope,
    ownerTypeByLogin,
    query: githubRepoQuery,
    visibility: githubRepoVisibility,
    limit: githubRepoLimit
  }), [effectiveOwner, githubRepositories, githubRepoLimit, githubRepoQuery, githubRepoVisibility, ownerScope, ownerTypeByLogin])
  const repositoryCountLabel = githubRepositories.length === filteredRepositories.length
    ? `${githubRepositories.length} repositories loaded`
    : `${filteredRepositories.length} of ${githubRepositories.length} repositories shown`
  const activeFilterCount = [
    effectiveOwner.trim(),
    ownerScope !== 'all' ? ownerScope : '',
    githubRepoVisibility !== 'all' ? githubRepoVisibility : ''
  ].filter(Boolean).length
  const showInternalVisibility = githubRepoVisibility === 'internal' || githubRepositories.some((repository) => repository.visibility.toLowerCase() === 'internal')
  const updateOwnerScope = (nextScope: RepoOwnerScope) => {
    setOwnerScope(nextScope)
    if (nextScope !== 'all' && currentOwnerAccount && currentOwnerAccount.type !== nextScope) {
      setGithubRepoOwner('')
    }
  }

  return (
    <section className="github-repo-browser">
      <div className="panel-heading compact-heading">
        <div>
          <h3>GitHub repositories</h3>
          <p>{repoBrowserReady ? `${repositoryCountLabel} from ${githubRepositoryBrowserSourceLabel(githubCliStatus)} · ${githubAccounts.length} accounts available.` : 'Repository list requires connected GitHub auth.'}</p>
        </div>
      </div>

      {!repoBrowserReady && (
        <div className="command-hint">Connect GitHub with GitHub CLI or Git Credential Manager, then load repositories.</div>
      )}

      <form
        className="github-repo-controls"
        onSubmit={(event) => {
          event.preventDefault()
          void loadGitHubRepositories()
        }}
      >
        <label className="github-repo-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={githubRepoQuery}
            onChange={(event) => setGithubRepoQuery(event.target.value)}
            onInput={(event) => setGithubRepoQuery(event.currentTarget.value)}
            placeholder="Search repositories by name, owner, or description"
            aria-label="Search GitHub repositories"
            autoComplete="off"
            disabled={busy || githubRepoLoading}
          />
        </label>
        <details className="github-repo-filter-menu">
          <summary title="Filter repositories" aria-label="Filter repositories">
            <ListFilter size={16} />
            <span>Filters</span>
            {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
          </summary>
          <div className="github-repo-filter-panel">
            <label>
              <span className="github-filter-label">Owner/org</span>
              <select
                value={effectiveOwner}
                onChange={(event) => setGithubRepoOwner(event.target.value)}
                disabled={busy || githubRepoLoading}
              >
                <option value="">All owners and organizations</option>
                {ownerOptions.map((account) => (
                  <option key={account.login} value={account.login}>
                    {githubAccountOptionLabel(account)}
                  </option>
                ))}
              </select>
            </label>

            <div className="github-filter-group">
              <span className="github-filter-label">Account type</span>
              <div className="github-filter-segment">
                <button type="button" className={ownerScope === 'all' ? 'active' : ''} onClick={() => updateOwnerScope('all')}>All</button>
                <button type="button" className={ownerScope === 'user' ? 'active' : ''} onClick={() => updateOwnerScope('user')}>User</button>
                <button type="button" className={ownerScope === 'organization' ? 'active' : ''} onClick={() => updateOwnerScope('organization')}>Organization</button>
              </div>
            </div>

            <div className="github-filter-group">
              <span className="github-filter-label">Visibility</span>
              <div className={showInternalVisibility ? 'github-filter-segment four' : 'github-filter-segment'}>
                <button type="button" className={githubRepoVisibility === 'all' ? 'active' : ''} onClick={() => setGithubRepoVisibility('all')}>All</button>
                <button type="button" className={githubRepoVisibility === 'private' ? 'active' : ''} onClick={() => setGithubRepoVisibility('private')}>Private</button>
                <button type="button" className={githubRepoVisibility === 'public' ? 'active' : ''} onClick={() => setGithubRepoVisibility('public')}>Public</button>
                {showInternalVisibility && (
                  <button type="button" className={githubRepoVisibility === 'internal' ? 'active' : ''} onClick={() => setGithubRepoVisibility('internal')}>Internal</button>
                )}
              </div>
            </div>
          </div>
        </details>
        <div className="github-repo-refresh-actions">
          <button
            type="button"
            className="icon-button github-refresh-button"
            onClick={() => void loadGitHubAccounts()}
            disabled={busy || githubAccountsLoading}
            title="Reload GitHub accounts and organizations"
            aria-label="Reload GitHub accounts and organizations"
          >
            {githubAccountsLoading ? <Loader2 className="spin" size={17} /> : <UsersRound size={17} />}
          </button>
          <button
            type="button"
            className="icon-button github-refresh-button"
            onClick={loadGitHubRepositories}
            disabled={busy || githubRepoLoading}
            title="Reload repository list"
            aria-label="Reload repository list"
          >
            {githubRepoLoading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
          </button>
        </div>
      </form>

      {!repoBrowserReady ? (
        <div className="quiet-box">BranchPilot can browse repositories through authenticated GitHub CLI or an available Git credential.</div>
      ) : githubRepoLoading ? (
        <div className="quiet-box">Loading GitHub repositories.</div>
      ) : githubRepositories.length === 0 ? (
        <div className="quiet-box">No repositories loaded yet.</div>
      ) : filteredRepositories.length === 0 ? (
        <div className="quiet-box">No repositories match the current filters.</div>
      ) : (
        <div className="github-repo-list">
          {filteredRepositories.map((repository) => (
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
                <button type="button" onClick={() => void cloneGitHubRepository(repository, 'ssh')} disabled={busy}>
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

/** Details, checks, and diff for the selected pull request. */
export function PullRequestDetailsPanel({
  selectedPullRequestDetails,
  selectedPullRequestChecks,
  selectedPullRequestDiff,
  selectedPullRequestNumber,
  selectedPullRequestFilePath,
  setSelectedPullRequestFilePath,
  pullRequestDetailsLoading,
  selectedPullRequestDiffResult,
  busy,
  githubCliStatus,
  loadPullRequestDetails,
  openExternalLink
}: {
  selectedPullRequestDetails: GitHubPullRequestDetails | null
  selectedPullRequestChecks: GitHubPullRequestCheck[]
  selectedPullRequestDiff: GitHubPullRequestDiff | null
  selectedPullRequestNumber: number | null
  selectedPullRequestFilePath: string | null
  setSelectedPullRequestFilePath: (path: string) => void
  pullRequestDetailsLoading: boolean
  selectedPullRequestDiffResult: DiffResult | null
  busy: boolean
  githubCliStatus: GitHubCliStatus | null
  loadPullRequestDetails: (prNumber: number) => void | Promise<void>
  openExternalLink: (url: string | undefined, label?: string) => void
}) {
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
              ? `${details.baseBranch} â† ${details.headBranch} Â· ${details.state}${details.draft ? ' Â· draft' : ''}`
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
              <StatusPill tone="success" label={`${passedChecks} pass`} />
              <StatusPill tone="danger" label={`${failedChecks} fail`} />
              <StatusPill tone="warn" label={`${pendingChecks} pending`} />
              <StatusPill tone="neutral" label={`${checks.length} total`} />
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
