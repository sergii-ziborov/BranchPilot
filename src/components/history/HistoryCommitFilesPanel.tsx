import type { CommitDetails, DiffResult, ImagePreview } from '../../shared/branchPilot'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { DiffPreview } from '../DiffView'

interface HistoryFileMenu {
  x: number
  y: number
  path: string
}

interface HistoryCommitFilesPanelProps {
  commitDetails: CommitDetails | null
  selectedCommitFilePath: string | null
  commitFileDiff: DiffResult | null
  commitImagePreview: ImagePreview | null
  loadCommitFileDiff: (commitSha: string, filePath: string) => void | Promise<void>
  openCommitFilePreview: (filePath: string) => void
  setFileMenu: (menu: HistoryFileMenu | null) => void
}

export function HistoryCommitFilesPanel({
  commitDetails,
  selectedCommitFilePath,
  commitFileDiff,
  commitImagePreview,
  loadCommitFileDiff,
  openCommitFilePreview,
  setFileMenu
}: HistoryCommitFilesPanelProps) {
  return (
    <div className="history-detail-grid">
      <div className="commit-file-column">
        <div className="commit-file-list-heading">
          {commitDetails ? `${commitDetails.files.length} changed file${commitDetails.files.length === 1 ? '' : 's'}` : 'Files'}
        </div>
        <div className="commit-file-list">
          {commitDetails && commitDetails.files.length === 0 && <div className="quiet-box">No changed files.</div>}
          {commitDetails?.files.map((file) => {
            const fileTypeIcon = fileTypeIconForPath(file.path)

            return (
              <button
                className={selectedCommitFilePath === file.path ? 'commit-file-row selected' : 'commit-file-row'}
                type="button"
                key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}
                onClick={() => commitDetails && loadCommitFileDiff(commitDetails.sha, file.path)}
                onDoubleClick={() => openCommitFilePreview(file.path)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setFileMenu({ x: event.clientX, y: event.clientY, path: file.path })
                }}
                title={file.path}
              >
                <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
                <span className="file-label">
                  <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
                    {fileTypeIcon.label}
                  </span>
                  <span className="file-name">{file.path}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="commit-diff-column">
        <DiffPreview diff={commitFileDiff} imagePreview={commitImagePreview} />
      </div>
    </div>
  )
}
