import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronDown, ExternalLink, GitPullRequest, KeyRound, RefreshCcw, UploadCloud } from 'lucide-react'
import type {
  ApiResult, AssistantPolicyStatus, BranchPilotApi, CreatedPullRequest,
  GitHubCliStatus, GitHubPullRequest, ProviderStatus, RepositorySnapshot
} from '../../shared/branchPilot'
import { getProviderRemoteSummary } from '../../shared/providerRemote'
import { githubRepositoryBrowserSourceLabel, githubStatusLabel } from '../../lib/githubLabels'
import { providerStateLabel } from '../../lib/dashboardLabels'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'
import { normalizePullRequestBaseBranch, pullRequestBaseBranchOptions, type PullRequestBaseBranchOption } from '../../lib/pullRequestBranches'
import { PlannedProviderWorkflowPanel, ProviderRemoteCard } from '../ProviderRemoteCard'
import { getCreatePullRequestState, getPullRequestBrowseState } from '../../shared/providerPreconditions'
import { BackToChanges } from '../BackToChanges'

export function ProvidersView({
  onBack,
  providers, snapshot, api, currentRepoPath, busy, assistantPolicy, githubCliStatus,
  canGeneratePullRequestText, canPublishBranch,
  createdPullRequest, currentPullRequest, pullRequests, pullRequestsLoading, selectedPullRequestNumber,
  prTitle, setPrTitle, prDescription, setPrDescription, prBaseBranch, setPrBaseBranch,
  checkoutPullRequest, createPullRequest, generatePullRequestText, loadGitHubPullRequests,
  refreshProvidersPanel, connectGitHub, selectPullRequest, openExternalLink, runSnapshotAction,
  onOpenPublishRepository, renderGitHubRepositoryBrowser, renderPullRequestDetailsPanel
}: {
  onBack: () => void
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
  connectGitHub: () => void | Promise<void>
  selectPullRequest: (pullRequest: GitHubPullRequest) => void
  openExternalLink: (url: string | undefined, label?: string) => void
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  onOpenPublishRepository: () => void
  renderGitHubRepositoryBrowser: () => ReactNode
  renderPullRequestDetailsPanel: () => ReactNode
}) {
  const [prBaseBranchMenuOpen, setPrBaseBranchMenuOpen] = useState(false)
  const prBaseBranchMenuRef = useRef<HTMLDivElement>(null)
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
  const needsGitHubAuth = Boolean(githubCliStatus && !githubCliStatus.authenticated)
  const prBaseBranchOptions = pullRequestBaseBranchOptions(snapshot, prBaseBranch, pullRequests)
  const selectedPrBaseBranch = normalizePullRequestBaseBranch(prBaseBranch, snapshot?.summary.remoteName)
  const selectedPrBaseBranchKey = selectedPrBaseBranch.trim().toLowerCase()

  useEffect(() => {
    if (!prBaseBranchMenuOpen) return

    function closePrBaseBranchMenu(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && prBaseBranchMenuRef.current?.contains(target)) return
      setPrBaseBranchMenuOpen(false)
    }

    function closePrBaseBranchMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPrBaseBranchMenuOpen(false)
    }

    document.addEventListener('pointerdown', closePrBaseBranchMenu)
    document.addEventListener('keydown', closePrBaseBranchMenuOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closePrBaseBranchMenu)
      document.removeEventListener('keydown', closePrBaseBranchMenuOnEscape)
    }
  }, [prBaseBranchMenuOpen])

  function selectPrBaseBranch(branch: string) {
    setPrBaseBranch(branch)
    setPrBaseBranchMenuOpen(false)
  }

  return (
    <section className="single-panel providers-page">
      <div className="panel-heading">
        <div className="panel-heading-main">
          <BackToChanges onClick={onBack} />
          <div>
            <h2>Pull requests</h2>
            <p>GitHub uses authenticated gh when available, with Git credentials as a PR creation fallback.</p>
          </div>
        </div>
        <button type="button" onClick={refreshProvidersPanel} disabled={busy}>
          <RefreshCcw size={17} />
          Refresh
        </button>
      </div>

      <div className="providers-pr-layout">
        <aside className="providers-connection-column">
          <section className="providers-connection-panel">
            <div className="panel-heading compact-heading">
              <div>
                <h3>Connection &amp; repository</h3>
                <p>Provider status, current remote, and authenticated GitHub repositories.</p>
              </div>
            </div>

            <div className="assistant-grid provider-status-grid">
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
          </section>
        </aside>

        <div className="providers-workflow-column">
          {showGitHubPullRequestPanel ? (
            <section className="pr-panel">
        <div className="panel-heading">
          <div>
            <h3>GitHub pull request</h3>
            <p>{snapshot ? `${snapshot.summary.currentBranch} → ${selectedPrBaseBranch || 'main'}` : 'Open a repository to create pull requests.'}</p>
          </div>
          <div className="github-auth-actions">
            <span className={`github-status status-${githubProvider?.state ?? 'planned'}`}>
              {githubCliStatus ? githubStatusLabel(githubCliStatus) : 'GitHub auth unknown'}
            </span>
            {needsGitHubAuth && (
              <button type="button" className="secondary" onClick={connectGitHub} disabled={busy}>
                <KeyRound size={16} />
                Connect GitHub
              </button>
            )}
          </div>
        </div>

        {githubCliStatus?.state === 'unauthenticated' && (
          <div className="command-hint warning">
            <span>Connect GitHub with GitHub CLI or Git Credential Manager, then BranchPilot can create and browse pull requests.</span>
            <button type="button" onClick={connectGitHub} disabled={busy}>
              <KeyRound size={16} />
              Connect GitHub
            </button>
          </div>
        )}

        {githubCliStatus?.state === 'missing' && (
          <div className="command-hint warning">
            <span>No GitHub API credential is available. Install GitHub CLI or use Git Credential Manager; GitHub Desktop is optional.</span>
            <button type="button" onClick={connectGitHub} disabled={busy}>
              <KeyRound size={16} />
              Connect GitHub
            </button>
          </div>
        )}

        {snapshot && providerRemote.kind !== 'github' && (
          <div className="command-hint warning">
            <span>
              {providerRemote.kind === 'none'
                ? 'Create a GitHub remote before using pull request workflows.'
                : `${providerRemote.label} remote detected. GitHub pull requests require a GitHub remote.`}
            </span>
            {providerRemote.kind === 'none' && (
              <button type="button" onClick={onOpenPublishRepository} disabled={busy}>
                <UploadCloud size={17} />
                Publish repository
              </button>
            )}
          </div>
        )}

        {snapshot && providerRemote.kind === 'github' && !snapshot.summary.upstream && (
          <div className="command-hint warning">
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

        <div className="pr-workspace">
          <div className="pr-primary-column">
        <section className="branch-composer pr-composer">
          <div className="branch-composer-heading">
            <div>
              <h3>Create pull request</h3>
              <p>{snapshot ? `Open a pull request for ${snapshot.summary.currentBranch}.` : 'Open a repository to create a pull request.'}</p>
            </div>
          </div>
          <div className="pr-form">
          <div className="pr-form-row">
            <div className="pr-field">
              <label htmlFor="pr-base">Base branch</label>
              <div className="pr-base-combobox" ref={prBaseBranchMenuRef}>
                <div className="pr-base-input-row">
                  <input
                    id="pr-base"
                    value={selectedPrBaseBranch}
                    onFocus={() => setPrBaseBranchMenuOpen(true)}
                    onChange={(event) => {
                      setPrBaseBranch(event.target.value)
                      setPrBaseBranchMenuOpen(true)
                    }}
                    placeholder="main, develop, release/2026"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="pr-base-menu-button"
                    aria-label="Show base branches"
                    aria-expanded={prBaseBranchMenuOpen}
                    aria-controls="pr-base-options"
                    onClick={() => setPrBaseBranchMenuOpen((open) => !open)}
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
                {prBaseBranchMenuOpen && (
                  <div className="pr-base-menu" id="pr-base-options" role="listbox" aria-label="Base branches">
                    {prBaseBranchOptions.length > 0 ? prBaseBranchOptions.map((branch) => {
                      const selected = branch.value.toLowerCase() === selectedPrBaseBranchKey

                      return (
                        <button
                          type="button"
                          className={selected ? 'pr-base-option selected' : 'pr-base-option'}
                          key={`${branch.kind}-${branch.value}`}
                          role="option"
                          aria-selected={selected}
                          title={branch.label}
                          onClick={() => selectPrBaseBranch(branch.value)}
                        >
                          <span className="pr-base-option-name">{branch.value}</span>
                          <span className="pr-base-option-kind">{pullRequestBranchKindLabel(branch.kind)}</span>
                          {selected && <Check size={14} />}
                        </button>
                      )
                    }) : (
                      <div className="pr-base-option-empty">No target branches found.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="pr-field">
              <label htmlFor="pr-title">Title</label>
              <input
                id="pr-title"
                value={prTitle}
                onChange={(event) => setPrTitle(event.target.value)}
                placeholder="Summarize branch changes"
              />
            </div>
          </div>
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
            <div className="assistant-policy-note">
              {assistantPolicyBlockedLabel('pull_request_text', assistantPolicy)} {'Open Settings > Assistant to enable PR drafts.'}
            </div>
          )}
          </div>
        </section>

        {createdPullRequest && (
          <div className="created-pr">
            <strong>{createdPullRequest.title}</strong>
            <span>{createdPullRequest.baseBranch} ← {createdPullRequest.headBranch}</span>
            <span>{createdPullRequest.url}</span>
          </div>
        )}

          </div>

          <div className="pr-secondary-column">
        <section className="pr-list-panel">
          <div className="panel-heading compact-heading">
            <div>
              <h3>Pull requests</h3>
              <p>{githubCliStatus?.authenticated ? `${pullRequests.length} recent pull request${pullRequests.length === 1 ? '' : 's'} from ${githubRepositoryBrowserSourceLabel(githubCliStatus)}.` : 'PR list requires connected GitHub auth.'}</p>
            </div>
            <button type="button" className="secondary" onClick={loadGitHubPullRequests} disabled={busy || !browsePrState.enabled}>
              <RefreshCcw size={17} />
              Refresh PRs
            </button>
          </div>

          {pullRequestsLoading && pullRequests.length === 0 ? (
            <div className="quiet-box">Loading pull requests.</div>
          ) : !browsePrState.enabled ? (
            <div className="quiet-box">{browsePrState.reasons.join(' ') || 'Pull request browsing is not available yet.'}</div>
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
          </div>
        </div>
        </section>
      ) : (
        <PlannedProviderWorkflowPanel remote={providerRemote} />
      )}
        </div>
      </div>
    </section>
  )
}

function pullRequestBranchKindLabel(kind: PullRequestBaseBranchOption['kind']): string {
  if (kind === 'selected') return 'Selected'
  if (kind === 'local') return 'Local'
  if (kind === 'remote') return 'Remote'
  return 'Pull request'
}
