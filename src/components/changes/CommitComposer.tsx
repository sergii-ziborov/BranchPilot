import { useEffect, useRef, useState } from 'react'
import { Bot, Check, GitCommitHorizontal, Pencil, RefreshCw, Settings, ShieldCheck, UploadCloud, Users } from 'lucide-react'
import type { CoAuthor, GitHubAccountSummary } from '../../shared/branchPilot'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'
import { useCommitComposerResize } from '../../hooks/useCommitComposerResize'
import {
  buildCoAuthorSuggestions,
  buildCommitIdentityOptions,
  buildIdentityCoAuthors,
  coAuthorButtonLabel,
  coAuthorMeta,
  commitIdentityAvatarUrl,
  filterOwnCoAuthorSuggestions,
  isCoAuthorSelected,
  loadCachedGitHubAccounts,
  loadRememberedIdentities,
  mergeGitHubAccounts,
  rememberIdentity,
  removeCoAuthor,
  saveCachedGitHubAccounts,
  type RememberedIdentity
} from '../../lib/commitIdentity'
import { CommitIdentityAvatar } from '../CommitIdentityAvatar'
import { IconButton } from '../IconButton'
import type { CommitComposerProps } from './CommitComposer.types'

function actionTooltip(
  actionLabel: string,
  blockedLabel: string,
  state: { enabled: boolean; reasons: string[] },
  busy: boolean,
  stagingBusy: boolean
): string {
  if (busy) return 'Another repository operation is running.'
  if (stagingBusy) return 'Staging is still updating. Wait for the staged files to settle.'
  if (state.enabled) return actionLabel
  return `${blockedLabel}: ${state.reasons.join(' ')}`
}

export function CommitComposer({
  panelRef,
  snapshot,
  busy,
  stagingBusy,
  commitTitle,
  setCommitTitle,
  commitDescription,
  setCommitDescription,
  commitCoAuthors,
  setCommitCoAuthors,
  gitConfig,
  localUserName,
  setLocalUserName,
  localUserEmail,
  setLocalUserEmail,
  githubAccounts,
  githubCliStatus,
  assistantPolicy,
  setNotice,
  onOpenReview,
  generateCommitText,
  canGenerateCommitText,
  commitActionState,
  commitAndPushActionState,
  amendCommitActionState,
  commitChanges,
  amendLastCommit,
  currentRepoPath,
  runSnapshotAction,
  api,
  setViewMode
}: CommitComposerProps) {
  const {
    commitComposerHeight,
    commitComposerStyle,
    startCommitComposerResize,
    handleCommitComposerResizeKeyDown,
    minCommitComposerHeight,
    maxCommitComposerHeight
  } = useCommitComposerResize(panelRef)
  const [showCoAuthors, setShowCoAuthors] = useState(false)
  const coAuthorsVisible = showCoAuthors
  const [repositoryAccessCoAuthors, setRepositoryAccessCoAuthors] = useState<CoAuthor[]>([])
  const [githubCoAuthors, setGithubCoAuthors] = useState<CoAuthor[]>([])
  const [coAuthorAccounts, setCoAuthorAccounts] = useState<GitHubAccountSummary[]>(() => loadCachedGitHubAccounts())
  const [githubCoAuthorsLoading, setGithubCoAuthorsLoading] = useState(false)
  const [coAuthorFilter, setCoAuthorFilter] = useState('')
  const [commitIdentitySaving, setCommitIdentitySaving] = useState(false)
  const [commitIdentityAccountsLoading, setCommitIdentityAccountsLoading] = useState(false)
  const [coAuthorAccountsAttempted, setCoAuthorAccountsAttempted] = useState(() => loadCachedGitHubAccounts().length > 0)
  const [rememberedIdentities, setRememberedIdentities] = useState<RememberedIdentity[]>(() => loadRememberedIdentities())
  const commitIdentityMenuRef = useRef<HTMLDetailsElement>(null)
  const accountSummaries = mergeGitHubAccounts(githubAccounts, coAuthorAccounts)
  const identityCoAuthors = buildIdentityCoAuthors(localUserName, localUserEmail, accountSummaries)

  useEffect(() => {
    const name = snapshot?.summary.gitUserName
    const email = snapshot?.summary.gitUserEmail
    if (name && email) setRememberedIdentities(rememberIdentity(name, email))
  }, [snapshot?.summary.gitUserName, snapshot?.summary.gitUserEmail])

  useEffect(() => {
    if (githubAccounts.length === 0) return
    const mergedAccounts = mergeGitHubAccounts(coAuthorAccounts, githubAccounts)
    setCoAuthorAccounts(mergedAccounts)
    saveCachedGitHubAccounts(mergedAccounts)
    setCoAuthorAccountsAttempted(true)
  }, [githubAccounts])

  useEffect(() => {
    if (!coAuthorsVisible || !currentRepoPath || !api) return
    let cancelled = false
    const load = async () => {
      const merged = new Map<string, CoAuthor>()

      if (typeof api.getGitHubContributors === 'function') {
        const result = await api.getGitHubContributors(currentRepoPath).catch(() => null)
        if (result?.ok) {
          for (const contributor of result.data) {
            merged.set(contributor.email.toLowerCase(), contributor)
          }
        }
      }

      if (!cancelled) setRepositoryAccessCoAuthors([...merged.values()])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [coAuthorsVisible, currentRepoPath, api])

  useEffect(() => {
    const query = coAuthorFilter.trim()

    if (!coAuthorsVisible || !currentRepoPath || !api) {
      setGithubCoAuthors([])
      setGithubCoAuthorsLoading(false)
      return
    }

    if (query.length < 2) {
      setGithubCoAuthors([])
      setGithubCoAuthorsLoading(false)
      return
    }

    let cancelled = false
    setGithubCoAuthorsLoading(true)

    const timeout = window.setTimeout(() => {
      void api.searchGitHubCoAuthors({ repoPath: currentRepoPath, query, limit: 100 })
        .then((result) => {
          if (!cancelled) setGithubCoAuthors(result.ok ? result.data : [])
        })
        .catch(() => {
          if (!cancelled) setGithubCoAuthors([])
        })
        .finally(() => {
          if (!cancelled) setGithubCoAuthorsLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [api, coAuthorFilter, coAuthorsVisible, currentRepoPath])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const identityMenu = commitIdentityMenuRef.current
      if (identityMenu?.open && event.target instanceof Node && !identityMenu.contains(event.target)) {
        identityMenu.open = false
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const loadCommitIdentityAccounts = async (force = false) => {
    if (!api || commitIdentityAccountsLoading) return
    if (!force && (coAuthorAccountsAttempted || accountSummaries.length > 0)) return

    setCommitIdentityAccountsLoading(true)
    setCoAuthorAccountsAttempted(true)

    try {
      const result = await api.listGitHubAccounts()
      if (result.ok) {
        const mergedAccounts = mergeGitHubAccounts(accountSummaries, result.data)
        setCoAuthorAccounts(mergedAccounts)
        saveCachedGitHubAccounts(mergedAccounts)
        setNotice(`Loaded ${mergedAccounts.length} GitHub account${mergedAccounts.length === 1 ? '' : 's'} for commit identity.`)
      } else if (force) {
        setNotice(result.error.message)
      }
    } catch (error) {
      if (force) setNotice(error instanceof Error ? error.message : 'Could not load GitHub accounts.')
    } finally {
      setCommitIdentityAccountsLoading(false)
    }
  }

  const toggleCoAuthor = (contributor: CoAuthor) => {
    if (isCoAuthorSelected(commitCoAuthors, contributor)) {
      setCommitCoAuthors(removeCoAuthor(commitCoAuthors, contributor))
      return
    }

    const entry = `${contributor.name} <${contributor.email}>`
    setCommitCoAuthors(commitCoAuthors.trim() ? `${commitCoAuthors.trim()}\n${entry}` : entry)
    setCoAuthorFilter('')
  }

  const coAuthorQuery = coAuthorFilter.trim().toLowerCase()
  const selectedCommitIdentityEmail = localUserEmail.trim().toLowerCase()
  const commitIdentityOptions = buildCommitIdentityOptions(
    snapshot,
    gitConfig,
    localUserName,
    localUserEmail,
    accountSummaries,
    [],
    rememberedIdentities
  )
  const selectedCommitIdentity = commitIdentityOptions.find((identity) => identity.email.toLowerCase() === selectedCommitIdentityEmail)
    ?? commitIdentityOptions[0]
  const selectedCommitIdentityKey = selectedCommitIdentity?.email.toLowerCase() ?? selectedCommitIdentityEmail
  const selectedCommitIdentityName = selectedCommitIdentity?.name || localUserName.trim() || 'Git author'
  const selectedCommitIdentityEmailText = selectedCommitIdentity?.email || localUserEmail.trim() || 'No email configured'
  const selectedCommitIdentityAvatar = commitIdentityAvatarUrl(selectedCommitIdentity)
  const githubIdentityLabel = githubCliStatus?.username
    ? `Git credential: ${githubCliStatus.username}`
    : 'GitHub credential not loaded'
  const coAuthorSuggestions = filterOwnCoAuthorSuggestions(
    buildCoAuthorSuggestions([], repositoryAccessCoAuthors, githubCoAuthors, coAuthorQuery),
    commitIdentityOptions.length > 0 ? commitIdentityOptions : identityCoAuthors,
    accountSummaries
  )
  const commitOperationBusy = busy || stagingBusy
  const commitTooltip = actionTooltip('Commit staged changes', 'Commit blocked', commitActionState, busy, stagingBusy)
  const amendTooltip = actionTooltip('Amend the previous commit with current staged changes', 'Amend blocked', amendCommitActionState, busy, stagingBusy)
  const commitAndPushTooltip = actionTooltip('Commit staged changes and push to the upstream branch', 'Commit & push blocked', commitAndPushActionState, busy, stagingBusy)
  const commitGeneratePolicyBlocked =
    Boolean(snapshot) &&
    snapshot?.status.merge.operation === 'none' &&
    (snapshot?.status.counts.conflicted ?? 0) === 0 &&
    (snapshot?.status.counts.staged ?? 0) > 0 &&
    !canGenerateCommitText
  const commitGeneratePolicyActionBlocked = !busy && !stagingBusy && commitGeneratePolicyBlocked
  const commitGenerateBlockedReason = (() => {
    if (busy) return 'Another repository operation is running.'
    if (stagingBusy) return 'Staging is still updating. Wait for the staged files to settle.'
    if (!snapshot) return 'Open a repository before generating commit text.'
    if (snapshot.status.merge.operation !== 'none') return 'Finish or abort the current merge operation before generating commit text.'
    if (snapshot.status.counts.conflicted > 0) return 'Resolve conflicted files before generating commit text.'
    if (snapshot.status.counts.staged === 0) return 'Stage at least one change before generating commit text.'
    if (!canGenerateCommitText) return `${assistantPolicyBlockedLabel('commit_message', assistantPolicy)} Open Review or Settings to enable commit drafts.`
    return ''
  })()
  const commitGenerateTooltip = commitGenerateBlockedReason || 'Generate commit text with the selected AI assistant'

  const handleGenerateCommitText = () => {
    if (commitGenerateBlockedReason) {
      setNotice(commitGenerateBlockedReason)
      if (commitGeneratePolicyActionBlocked) onOpenReview()
      return
    }

    void generateCommitText()
  }

  const notifyBlocked = (title: string, reasons: string[]) => {
    setNotice(reasons.length > 0 ? `${title}: ${reasons.join(' Â· ')}` : title)
  }

  const notifyStagingBusy = () => {
    setNotice('Staging is still updating. Commit actions will unlock when the index is ready.')
  }

  const selectCommitIdentity = async (identity: CoAuthor) => {
    const name = identity.name.trim()
    const email = identity.email.trim()
    if (!api || !currentRepoPath || busy || commitIdentitySaving || !name || !email) return false
    if (email.toLowerCase() === selectedCommitIdentityEmail && name === localUserName.trim()) return true

    setCommitIdentitySaving(true)
    try {
      const result = await api.setLocalGitIdentity({ repoPath: currentRepoPath, name, email })
      if (result.ok) {
        setLocalUserName(name)
        setLocalUserEmail(email)
        setRememberedIdentities(rememberIdentity(name, email, identity.login))
        setNotice(`Commit identity set to ${name} <${email}>.`)
        return true
      }

      setNotice(result.error.message)
      return false
    } finally {
      setCommitIdentitySaving(false)
    }
  }

  return (
    <>
      <div
        className="commit-resize-handle"
        role="separator"
        aria-label="Resize commit composer"
        aria-orientation="horizontal"
        aria-valuemin={minCommitComposerHeight}
        aria-valuemax={maxCommitComposerHeight}
        aria-valuenow={commitComposerHeight}
        tabIndex={0}
        onPointerDown={startCommitComposerResize}
        onKeyDown={handleCommitComposerResizeKeyDown}
      >
        <span />
      </div>

      <div className="commit-box" style={commitComposerStyle}>
        <div className="commit-summary-row">
          <details
            className="commit-identity-menu"
            ref={commitIdentityMenuRef}
            onToggle={(event) => {
              if (event.currentTarget.open) void loadCommitIdentityAccounts(false)
            }}
          >
            <summary
              title={`Committing as ${selectedCommitIdentityName} <${selectedCommitIdentityEmailText}>`}
              aria-label={`Committing as ${selectedCommitIdentityName}`}
            >
              <CommitIdentityAvatar avatarUrl={selectedCommitIdentityAvatar} />
            </summary>
            <div className="commit-identity-popover">
              <div className="commit-identity-current">
                <CommitIdentityAvatar avatarUrl={selectedCommitIdentityAvatar} large />
                <div>
                  <strong>Committing as {selectedCommitIdentityName}</strong>
                  <span>Email: {selectedCommitIdentityEmailText}</span>
                  <small>{githubIdentityLabel}</small>
                </div>
              </div>
              <div className="commit-identity-options" aria-label="Commit author identities">
                {commitIdentityOptions.length > 0 ? commitIdentityOptions.map((identity) => {
                  const selected = identity.email.toLowerCase() === selectedCommitIdentityKey
                  const avatarUrl = commitIdentityAvatarUrl(identity)

                  return (
                    <button
                      type="button"
                      key={identity.email}
                      className={selected ? 'commit-identity-option active' : 'commit-identity-option'}
                      title={`Use ${identity.name} <${identity.email}> for the next commits in this repository. Source: ${identity.meta}.`}
                      aria-pressed={selected}
                      disabled={busy || commitIdentitySaving}
                      onClick={() => {
                        void selectCommitIdentity(identity).then((saved) => {
                          if (saved && commitIdentityMenuRef.current) commitIdentityMenuRef.current.open = false
                        })
                      }}
                    >
                      <CommitIdentityAvatar avatarUrl={avatarUrl} />
                      <span>
                        <strong>{identity.name}</strong>
                        <small>{identity.email}</small>
                      </span>
                      {selected && <Check size={14} />}
                    </button>
                  )
                }) : (
                  <div className="commit-identity-empty">No commit identity configured yet.</div>
                )}
              </div>
              <div className="commit-identity-actions">
                <button type="button" onClick={() => {
                  if (commitIdentityMenuRef.current) commitIdentityMenuRef.current.open = false
                  setViewMode('config')
                }}>
                  <Settings size={15} />
                  Open git settings
                </button>
                <button
                  type="button"
                  className="secondary"
                  title="Refresh cached GitHub accounts and emails"
                  disabled={commitIdentityAccountsLoading}
                  onClick={() => { void loadCommitIdentityAccounts(true) }}
                >
                  <RefreshCw className={commitIdentityAccountsLoading ? 'spin' : undefined} size={15} />
                  Refresh
                </button>
              </div>
            </div>
          </details>
          <input
            id="commit-title"
            aria-label="Commit title"
            value={commitTitle}
            onChange={(event) => setCommitTitle(event.target.value)}
            placeholder="Summary (required)"
          />
          <button
            type="button"
            className={commitGenerateBlockedReason ? 'commit-generate blocked' : 'commit-generate'}
            title={commitGenerateTooltip}
            aria-label="Generate commit text"
            aria-disabled={Boolean(commitGenerateBlockedReason)}
            onClick={handleGenerateCommitText}
          >
            <Bot size={16} />
          </button>
        </div>
        <textarea
          id="commit-description"
          aria-label="Commit description"
          value={commitDescription}
          onChange={(event) => setCommitDescription(event.target.value)}
          placeholder="Description"
        />
        {coAuthorsVisible && (
          <div className="coauthor-box">
            <textarea
              id="commit-coauthors"
              className="commit-coauthors"
              aria-label="Commit co-authors"
              value={commitCoAuthors}
              onChange={(event) => setCommitCoAuthors(event.target.value)}
              placeholder="Co-authors: Name <email>, one per line"
            />
            <input
              className="coauthor-filter"
              value={coAuthorFilter}
              onChange={(event) => setCoAuthorFilter(event.target.value)}
              placeholder="Search people with repository access and owner organization..."
              aria-label="Search people with repository access and owner organization members"
            />
            {(coAuthorSuggestions.length > 0 || githubCoAuthorsLoading) && (
              <div className="coauthor-suggestions">
                {coAuthorSuggestions.map((contributor) => {
                  const selected = isCoAuthorSelected(commitCoAuthors, contributor)
                  const meta = coAuthorMeta(contributor)

                  return (
                    <button
                      type="button"
                      key={`${contributor.source ?? 'coauthor'}:${contributor.organization ?? ''}:${contributor.login ?? ''}:${contributor.email}`}
                      className={selected ? 'coauthor-chip selected' : 'coauthor-chip'}
                      aria-label={coAuthorButtonLabel(contributor, selected)}
                      aria-pressed={selected}
                      onClick={() => toggleCoAuthor(contributor)}
                    >
                      {selected
                        ? <Check size={13} />
                        : contributor.avatarUrl
                          ? <img className="coauthor-avatar" src={contributor.avatarUrl} alt="" />
                          : <Users size={13} />}
                      <span className="coauthor-chip-text">
                        <strong>{contributor.name}</strong>
                        <small>{meta}</small>
                      </span>
                    </button>
                  )
                })}
                {githubCoAuthorsLoading && <span className="coauthor-searching">Searching GitHub...</span>}
              </div>
            )}
          </div>
        )}
        <div className="commit-actions">
          <IconButton
            active={coAuthorsVisible}
            icon={<Users size={16} />}
            label="Author tools"
            title={coAuthorsVisible ? 'Hide author tools' : 'Author tools'}
            onClick={() => setShowCoAuthors((value) => !value)}
          />
          <button className="icon-button" type="button" title="Review changes" aria-label="Review changes" onClick={onOpenReview}>
            <ShieldCheck size={16} />
          </button>
          <button
            type="button"
            className={commitActionState.enabled && !commitOperationBusy ? undefined : 'blocked'}
            title={commitTooltip}
            aria-disabled={commitOperationBusy || !commitActionState.enabled}
            onClick={() => {
              if (busy) return
              if (stagingBusy) {
                notifyStagingBusy()
                return
              }
              if (!commitActionState.enabled) {
                notifyBlocked('Commit blocked', commitActionState.reasons)
                return
              }
              void commitChanges()
            }}
          >
            <GitCommitHorizontal size={17} />
            Commit
          </button>
          <button
            type="button"
            className={amendCommitActionState.enabled && !commitOperationBusy ? 'danger-button' : 'danger-button blocked'}
            title={amendTooltip}
            aria-disabled={commitOperationBusy || !amendCommitActionState.enabled}
            onClick={() => {
              if (busy) return
              if (stagingBusy) {
                notifyStagingBusy()
                return
              }
              if (!amendCommitActionState.enabled) {
                notifyBlocked('Amend blocked', amendCommitActionState.reasons)
                return
              }
              void amendLastCommit()
            }}
          >
            <Pencil size={17} />
            Amend last
          </button>
          <button
            type="button"
            className={commitAndPushActionState.enabled && !commitOperationBusy ? 'secondary' : 'secondary blocked'}
            title={commitAndPushTooltip}
            aria-disabled={commitOperationBusy || !commitAndPushActionState.enabled}
            onClick={async () => {
              if (busy) return
              if (stagingBusy) {
                notifyStagingBusy()
                return
              }
              if (!commitAndPushActionState.enabled) {
                notifyBlocked('Commit & push blocked', commitAndPushActionState.reasons)
                return
              }
              const committed = await commitChanges('Committing and pushing...')
              if (committed && currentRepoPath) {
                await runSnapshotAction('Push complete.', () => api!.push(currentRepoPath), 'Committing and pushing...')
              }
            }}
          >
            <UploadCloud size={17} />
            Commit & push
          </button>
        </div>
      </div>
    </>
  )
}
