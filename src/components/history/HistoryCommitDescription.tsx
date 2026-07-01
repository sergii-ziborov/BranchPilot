import type { CommitDetails } from '../../shared/branchPilot'

interface HistoryCommitDescriptionProps {
  commitDetails: CommitDetails | null
}

function describeLineCount(body: string): string {
  const lines = body.split(/\r\n|\r|\n/).length

  return `${lines} line${lines === 1 ? '' : 's'}`
}

export function HistoryCommitDescription({ commitDetails }: HistoryCommitDescriptionProps) {
  const body = commitDetails?.body.trim() ?? ''

  return (
    <section className={body ? 'history-commit-description' : 'history-commit-description empty'}>
      <header>
        <span>Description</span>
        <strong>{body ? describeLineCount(body) : commitDetails ? 'No body' : 'Waiting'}</strong>
      </header>
      <div className="history-commit-description-body">
        {body || (commitDetails
          ? 'No commit description was recorded. Use the changed files and diff below to inspect what this commit touches.'
          : 'Select a commit to see its message, changed files, and previewable diff.')}
      </div>
    </section>
  )
}
