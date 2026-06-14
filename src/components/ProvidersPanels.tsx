import { ArrowDownToLine, ExternalLink, Loader2, RefreshCcw } from 'lucide-react'
import type {
  DiffResult, GitHubAccountSummary, GitHubCliStatus, GitHubPullRequestCheck,
  GitHubPullRequestDetails, GitHubPullRequestDiff, GitHubRepositorySummary
} from '../shared/branchPilot'
import {
  checkBucketClass, githubAccountOptionLabel, githubRepositoryBrowserSourceLabel, githubRepositoryMeta
} from '../lib/githubLabels'
import { fileStatusToken } from '../lib/fileChangeLabels'
import { formatDate } from '../lib/format'
import { InfoRow } from './primitives'
import { DiffPreview } from './DiffView'

type RepoVisibility = 'all' | 'public' | 'private' | 'internal'

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
  setGithubRepoLimit,
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
  setGithubRepoLimit: (value: string) => void
  busy: boolean
  loadGitHubAccounts: () => void | Promise<void>
  loadGitHubRepositories: () => void | Promise<void>
  cloneGitHubRepository: (repository: GitHubRepositorySummary, protocol: 'https' | 'ssh') => void | Promise<void>
  openExternalLink: (url: string | undefined, label?: string) => void
}) {
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
            onChange={(event) => setGithubRepoVisibility(event.target.value as RepoVisibility)}
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
