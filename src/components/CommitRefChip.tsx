import { GitBranch, Tag } from 'lucide-react'

/** An icon+label ref chip for a commit's tag or branch, styled to match commit hover refs. */
export function CommitRefChip({
  kind,
  label,
  iconSize = 12
}: {
  kind: 'tag' | 'branch'
  label: string
  iconSize?: number
}) {
  return (
    <span className={`commit-hover-ref ${kind}`}>
      {kind === 'tag' ? <Tag size={iconSize} /> : <GitBranch size={iconSize} />}
      {label}
    </span>
  )
}
