import { useState } from 'react'
import { Bot } from 'lucide-react'
import { assistantPolicyBlockedLabel } from '../../lib/assistantLabels'
import { useCommitComposerResize } from '../../hooks/useCommitComposerResize'
import { CoAuthorSection } from './CoAuthorSection'
import { CommitActionRow } from './CommitActionRow'
import { CommitIdentityMenu } from './CommitIdentityMenu'
import { useCommitIdentityState } from './useCommitIdentityState'
import type { CommitComposerProps } from './CommitComposer.types'

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
  const identityState = useCommitIdentityState({
    api,
    currentRepoPath,
    snapshot,
    gitConfig,
    localUserName,
    setLocalUserName,
    localUserEmail,
    setLocalUserEmail,
    githubAccounts,
    githubCliStatus,
    busy,
    setNotice
  })

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
          <CommitIdentityMenu identityState={identityState} busy={busy} setViewMode={setViewMode} />
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
        <CoAuthorSection
          visible={coAuthorsVisible}
          api={api}
          currentRepoPath={currentRepoPath}
          commitCoAuthors={commitCoAuthors}
          setCommitCoAuthors={setCommitCoAuthors}
          commitIdentityOptions={identityState.commitIdentityOptions}
          identityCoAuthors={identityState.identityCoAuthors}
          accountSummaries={identityState.accountSummaries}
        />
        <CommitActionRow
          busy={busy}
          stagingBusy={stagingBusy}
          commitActionState={commitActionState}
          amendCommitActionState={amendCommitActionState}
          commitAndPushActionState={commitAndPushActionState}
          commitChanges={commitChanges}
          amendLastCommit={amendLastCommit}
          currentRepoPath={currentRepoPath}
          runSnapshotAction={runSnapshotAction}
          api={api}
          setNotice={setNotice}
          onOpenReview={onOpenReview}
          coAuthorsVisible={coAuthorsVisible}
          onToggleCoAuthors={() => setShowCoAuthors((value) => !value)}
        />
      </div>
    </>
  )
}
