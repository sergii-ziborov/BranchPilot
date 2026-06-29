import { fileStatusToken, fileStatusTone } from '../lib/fileChangeLabels'

type FileStatusTokenStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'conflicted'
  | 'untracked'

/** A 20x20 single-letter Git status badge (M/A/D/R/C/!) tinted per file status. */
export function FileStatusToken({
  status,
  title
}: {
  status: FileStatusTokenStatus
  title?: string
}) {
  const token =
    status === 'conflicted' ? '!' : fileStatusToken(status)
  return (
    <span className={`file-status status-${fileStatusTone(status)}`} title={title} aria-label={title}>
      {token}
    </span>
  )
}
