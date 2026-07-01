/** Insertions/deletions stat badges (+N green, -N red) with an optional files-changed label. */
export function DiffStatBadges({
  additions,
  deletions,
  filesChanged,
  hideZero = false,
  label = 'Diff stats'
}: {
  additions: number
  deletions: number
  filesChanged?: number
  hideZero?: boolean
  label?: string
}) {
  const showAdditions = !hideZero || additions > 0
  const showDeletions = !hideZero || deletions > 0
  return (
    <div className="diff-stats" aria-label={label}>
      {typeof filesChanged === 'number' && (
        <span className="files-changed">
          {filesChanged} file{filesChanged === 1 ? '' : 's'} changed
        </span>
      )}
      {showAdditions && <span className="additions">+{additions}</span>}
      {showDeletions && <span className="deletions">-{deletions}</span>}
    </div>
  )
}
