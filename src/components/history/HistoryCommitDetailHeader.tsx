import { Copy, ExternalLink, Eye, GitCommitHorizontal, Trash2 } from 'lucide-react'
import type { BranchPilotApi, CommitDetails, RepositorySnapshot } from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import { HistoryCommitDescription } from './HistoryCommitDescription'

interface HistoryCommitDetailHeaderProps {
  snapshot: RepositorySnapshot | null
  commitDetails: CommitDetails | null
  busy: boolean
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  selectedCommitFilePath: string | null
  selectedCommitProviderUrl: string | null
  openExternalLink: (url: string | undefined, label?: string) => void
  applyCommitOperation: (kind: 'revert' | 'cherry-pick' | 'reset' | 'reset-hard', commitSha?: string) => void | Promise<void>
  openCommitFilePreview: (filePath: string) => void
}

export function HistoryCommitDetailHeader({
  snapshot,
  commitDetails,
  busy,
  api,
  currentRepoPath,
  selectedCommitFilePath,
  selectedCommitProviderUrl,
  openExternalLink,
  applyCommitOperation,
  openCommitFilePreview
}: HistoryCommitDetailHeaderProps) {
  const copySelectedCommitSha = () => {
    if (!commitDetails) return
    void navigator.clipboard.writeText(commitDetails.sha)
  }

  const openSelectedCommitPreview = () => {
    if (!commitDetails) return
    const path =
      selectedCommitFilePath ??
      commitDetails.files.find((file) => file.status !== 'deleted')?.path ??
      commitDetails.files[0]?.path
    if (path) openCommitFilePreview(path)
  }

  return (
    <div className="history-commit-header">
      <div className="history-commit-headline">
        <div>
          <h2>{commitDetails?.subject ?? 'Commit details'}</h2>
          <p>
            {commitDetails
              ? `${commitDetails.shortSha} · ${commitDetails.authorName} · ${formatDate(commitDetails.authoredAt)}`
              : 'Select a commit'}
          </p>
          {commitDetails && (
            <button type="button" className="history-commit-inline-copy" title="Copy full commit SHA" aria-label="Copy full commit SHA" onClick={copySelectedCommitSha}>
              <Copy size={13} />
              Copy SHA
            </button>
          )}
        </div>
        <div className="panel-actions">
          {commitDetails && commitDetails.files.length > 0 && (
            <div className="diff-file-actions" aria-label="History commit preview actions">
              <button
                type="button"
                className="preview"
                title="Open this commit in BranchPilot preview"
                onClick={openSelectedCommitPreview}
                disabled={!api || !currentRepoPath}
              >
                <Eye size={15} />
                Preview
              </button>
            </div>
          )}
          {selectedCommitProviderUrl && (
            <button
              type="button"
              className="secondary icon-button"
              title="Open commit in provider"
              aria-label="Open commit in provider"
              onClick={() => openExternalLink(selectedCommitProviderUrl, 'Commit link')}
              disabled={busy}
            >
              <ExternalLink size={17} />
            </button>
          )}
          <button
            type="button"
            className="secondary icon-button"
            title="Copy full commit SHA"
            aria-label="Copy full commit SHA"
            onClick={copySelectedCommitSha}
            disabled={!commitDetails}
          >
            <Copy size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Cherry-pick commit"
            aria-label="Cherry-pick commit"
            onClick={() => applyCommitOperation('cherry-pick')}
            disabled={!commitDetails || busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
          >
            <GitCommitHorizontal size={17} />
          </button>
          <button
            className="danger-button icon-button"
            type="button"
            title="Revert commit"
            aria-label="Revert commit"
            onClick={() => applyCommitOperation('revert')}
            disabled={!commitDetails || busy || Boolean(snapshot?.status.counts.conflicted) || snapshot?.status.merge.operation !== 'none'}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      <HistoryCommitDescription commitDetails={commitDetails} />
      {commitDetails && !(commitDetails.containingBranches.length === 1 && commitDetails.containingBranches[0] === snapshot?.summary.currentBranch) && commitDetails.containingBranches.length > 0 && (
        <div className="commit-branch-strip">
          <span>Contained in</span>
          <div>
            {commitDetails.containingBranches.map((branch) => (
              <strong key={branch}>{branch}</strong>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
