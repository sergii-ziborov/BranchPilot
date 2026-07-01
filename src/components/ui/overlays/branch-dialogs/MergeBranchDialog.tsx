import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { MergeBranchCandidate } from '../../../../lib/mergeCandidates'

/** GitHub-Desktop-style "choose a branch to merge into <current>" dialog. */
export function MergeBranchDialog({
  currentBranch,
  branches,
  busy,
  onCancel,
  onMerge
}: {
  currentBranch: string
  branches: MergeBranchCandidate[]
  busy: boolean
  onCancel: () => void
  onMerge: (branchName: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const query = filter.trim().toLowerCase()
  const options = branches.filter((branch) => {
    const haystack = `${branch.name} ${branch.label} ${branch.kind}`.toLowerCase()
    return branch.name !== currentBranch && (!query || haystack.includes(query))
  })

  return (
    <div className="confirmation-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-branch-title">
        <div>
          <h2 id="merge-branch-title">Merge into {currentBranch}</h2>
          <p>Choose a branch to merge into <strong>{currentBranch}</strong>.</p>
          <input
            className="text-prompt-input"
            autoFocus
            value={filter}
            placeholder="Filter branches"
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="merge-branch-list">
            {options.length === 0 ? (
              <p className="shell-dropdown-empty">No other branches to merge.</p>
            ) : (
              options.map((branch) => (
                <button
                  type="button"
                  key={branch.name}
                  className={selected === branch.name ? 'merge-branch-item active' : 'merge-branch-item'}
                  onClick={() => setSelected(branch.name)}
                >
                  <GitBranch size={14} />
                  <span>{branch.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="confirmation-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={!selected || busy} onClick={() => selected && onMerge(selected)}>
            Merge into {currentBranch}
          </button>
        </div>
      </section>
    </div>
  )
}
