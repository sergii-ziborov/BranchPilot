import type { ReactNode } from 'react'
import { Bot, ExternalLink, GitPullRequest, RefreshCcw, UploadCloud } from 'lucide-react'
import type {
  ApiResult, AssistantActionKind, AssistantPolicyStatus, BranchPilotApi, CreatedPullRequest,
  GitHubCliStatus, GitHubPullRequest, ProviderStatus, RepositorySnapshot
} from '../../shared/branchPilot'
import { getProviderRemoteSummary } from '../../shared/providerRemote'
import { githubRepositoryBrowserSourceLabel, githubStatusLabel } from '../../lib/githubLabels'
import { providerStateLabel } from '../../lib/dashboardLabels'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'
import { ActionBlockers } from '../ActionBlockers'
import { PlannedProviderWorkflowPanel, ProviderRemoteCard } from '../ProviderRemoteCard'
import { getCreatePullRequestState, getPullRequestBrowseState } from '../../shared/providerPreconditions'

export function ProvidersView({
  providers, snapshot, api, currentRepoPath, busy, assistantPolicy, githubCliStatus,
  canGeneratePullRequestText, canPublishBranch,
  createdPullRequest, currentPullRequest, pullRequests, pullRequestsLoading, selectedPullRequestNumber,
  prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch,
  checkoutPullRequest, createPullRequest, generatePullRequestText, loadGitHubPullRequests,
  refreshProvidersPanel, selectPullRequest, openExternalLink, runSnapshotAction,
  renderAssistantReadiness, renderGitHubRepositoryBrowser, renderPullRequestDetailsPanel
}: {
  providers: ProviderStatus[]
  snapshot: RepositorySnapshot | null
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  busy: boolean
  assistantPolicy: AssistantPolicyStatus | null
  githubCliStatus: GitHubCliStatus | null
  canGeneratePullRequestText: boolean
  canPublishBranch: boolean
  createdPullRequest: CreatedPullRequest | null
  currentPullRequest: GitHubPullRequest | null
  pullRequests: GitHubPullRequest[]
  pullRequestsLoading: boolean
  selectedPullRequestNumber: number | null
  prTitle: string
  setPrTitle: (value: string) => void
  prDescription: string
  setPrDescription: (value: string) => void
  prBaseBranch: string
  setPrBaseBranch: (value: string) => void
  checkoutPullRequest: (pullRequest: GitHubPullRequest) => void | Promise<void>
  createPullRequest: () => void | Promise<void>
  generatePullRequestText: () => void | Promise<void>
  loadGitHubPullRequests: () => void | Promise<void>
  refreshProvidersPanel: () => void | Promise<void>
  selectPullRequest: (pullRequest: GitHubPullRequest) => void
  openExternalLink: (url: string | undefined, label?: string) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  renderAssistantReadiness: (action: AssistantActionKind) => ReactNode
  renderGitHubRepositoryBrowser: () => ReactNode
  renderPullRequestDetailsPanel: () => ReactNode
}) {
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
      <details className="pr-collapse">
        <summary>Connection &amp; repository</summary>
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
      </details>

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
              <button className="icon-button" type="button" title="Pull request details" aria-label="Pull request details" onClick={() => selectPullRequest(currentPullRequest)} disabled={busy}>
                <GitPullRequest size={17} />
              </button>
              <button className="icon-button secondary" type="button" title="Open pull request" aria-label="Open pull request" onClick={() => openExternalLink(currentPullRequest.url, 'Pull request link')}>
                <ExternalLink size={17} />
              </button>
            </div>
          </article>
        )}

        <section className="branch-composer pr-composer">
          <div className="branch-composer-heading">
            <div>
              <h3>Create pull request</h3>
              <p>{snapshot ? `Open a pull request for ${snapshot.summary.currentBranch}.` : 'Open a repository to create a pull request.'}</p>
            </div>
          </div>
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
        </section>

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
                          className="icon-button"
                          type="button"
                          title="Checkout pull request"
                          aria-label="Checkout pull request"
                          onClick={(event) => {
                            event.stopPropagation()
                            void checkoutPullRequest(pullRequest)
                          }}
                          disabled={busy || !githubCliStatus?.authenticated}
                        >
                          <GitPullRequest size={17} />
                        </button>
                      )}
                      {isSelected && <span className="pr-current-badge selected-badge">Selected</span>}
                      <button
                        className="icon-button secondary"
                        type="button"
                        title="Open pull request"
                        aria-label="Open pull request"
                        onClick={(event) => {
                          event.stopPropagation()
                          openExternalLink(pullRequest.url, 'Pull request link')
                        }}
                      >
                        <ExternalLink size={17} />
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
