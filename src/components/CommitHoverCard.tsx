import { Copy, ExternalLink } from 'lucide-react'
import type { MouseEventHandler } from 'react'
import type { CommitCard } from '../shared/branchPilot'
import { formatDate, formatRelativeTime } from '../lib/format'
import { commitHoverPlacement } from '../lib/commitHoverPlacement'
import { CommitRefChip } from './CommitRefChip'

export interface CommitHoverCardAnchor {
  sha: string
  x: number
  y: number
}

interface CommitHoverCardProps {
  anchor: CommitHoverCardAnchor
  card: CommitCard | null
  providerUrl: string | null
  avatarBroken: boolean
  onAvatarError: () => void
  onMouseEnter: MouseEventHandler<HTMLDivElement>
  onMouseLeave: MouseEventHandler<HTMLDivElement>
  onOpenProvider: () => void
}

function commitHoverInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

function hoverCardPosition(anchor: CommitHoverCardAnchor) {
  return commitHoverPlacement(anchor, {
    width: window.innerWidth,
    height: window.innerHeight
  })
}

export function CommitHoverCard({
  anchor,
  card,
  providerUrl,
  avatarBroken,
  onAvatarError,
  onMouseEnter,
  onMouseLeave,
  onOpenProvider
}: CommitHoverCardProps) {
  const position = hoverCardPosition(anchor)
  const { placement, ...style } = position

  return (
    <div
      className={`commit-hover-card commit-hover-card-${placement}`}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {card ? (
        <>
          <div className="commit-hover-head">
            {card.avatarUrl && !avatarBroken ? (
              <img className="commit-hover-avatar" src={card.avatarUrl} alt="" onError={onAvatarError} />
            ) : (
              <span className="commit-hover-avatar commit-hover-avatar-fallback">{commitHoverInitials(card.authorName)}</span>
            )}
            <div className="commit-hover-author">
              <strong>{card.authorName || 'Unknown'}</strong>
              <span title={formatDate(card.authoredAt)}>{formatRelativeTime(card.authoredAt)}</span>
            </div>
            <button type="button" className="commit-hover-head-copy" title="Copy full SHA" aria-label="Copy full SHA" onClick={() => navigator.clipboard.writeText(card.sha)}>
              <Copy size={13} />
            </button>
          </div>
          <div className="commit-hover-message">
            <strong>{card.subject || '(no subject)'}</strong>
            {card.body && <p>{card.body}</p>}
          </div>
          <div className="commit-hover-stats">
            <span>{card.filesChanged} file{card.filesChanged === 1 ? '' : 's'} changed</span>
            {card.insertions > 0 && <span className="add">+{card.insertions}</span>}
            {card.deletions > 0 && <span className="del">&minus;{card.deletions}</span>}
          </div>
          {(card.tags.length > 0 || card.branches.length > 0) && (
            <div className="commit-hover-refs">
              {card.tags.map((tag) => (
                <CommitRefChip kind="tag" label={tag} key={`tag-${tag}`} />
              ))}
              {card.branches.map((branch) => (
                <CommitRefChip kind="branch" label={branch} key={`branch-${branch}`} />
              ))}
            </div>
          )}
          <div className="commit-hover-foot">
            <code>{card.shortSha}</code>
            <button type="button" title="Copy full SHA" onClick={() => navigator.clipboard.writeText(card.sha)}>
              <Copy size={13} />
            </button>
            {providerUrl && (
              <button type="button" className="commit-hover-open" onClick={onOpenProvider}>
                <ExternalLink size={13} />
                Open
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="commit-hover-loading">Loading commit...</div>
      )}
    </div>
  )
}
