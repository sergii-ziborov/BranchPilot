import { useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import type { CommitFileChange } from '../../shared/branchPilot'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { SignalStatus } from '../SignalStatus'

interface HistoryPreviewFileSidebarProps {
  commitShortSha: string
  compareSha: string
  compareLoading: boolean
  compareError: string | null
  compareTargetLabel: string
  intersectingFiles: CommitFileChange[]
  compareFilePaths: Set<string>
  selectedFilePath: string
  onBack: () => void
  openCommitFilePreview: (filePath: string) => void
}

export function HistoryPreviewFileSidebar({
  commitShortSha,
  compareSha,
  compareLoading,
  compareError,
  compareTargetLabel,
  intersectingFiles,
  compareFilePaths,
  selectedFilePath,
  onBack,
  openCommitFilePreview
}: HistoryPreviewFileSidebarProps) {
  const [fileQuery, setFileQuery] = useState('')
  const fileQueryText = fileQuery.trim().toLowerCase()
  const visibleFiles = useMemo(() => (
    fileQueryText
      ? intersectingFiles.filter((file) => `${file.path} ${file.originalPath ?? ''} ${file.status}`.toLowerCase().includes(fileQueryText))
      : intersectingFiles
  ), [fileQueryText, intersectingFiles])

  return (
    <aside className="history-preview-sidebar">
      <button type="button" className="secondary history-preview-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to history
      </button>
      <div className="history-preview-sidebar-title">
        <span>{compareSha ? 'Changed in both targets' : `Changes in ${commitShortSha}`}</span>
        <strong>{compareSha && compareLoading ? '...' : `${intersectingFiles.length} files`}</strong>
      </div>
      <label className="history-preview-search">
        <Search size={15} />
        <input
          value={fileQuery}
          onChange={(event) => setFileQuery(event.target.value)}
          placeholder={compareSha ? 'Search shared changed files' : 'Search changed files'}
        />
      </label>
      <div className="history-preview-file-list">
        {compareSha && compareLoading ? (
          <SignalStatus
            className="history-preview-list-curtain"
            label="Loading compare target"
            detail={compareTargetLabel}
          />
        ) : compareSha && compareError ? (
          <div className="quiet-box danger-text">{compareError}</div>
        ) : visibleFiles.length === 0 ? (
          <div className="quiet-box">
            {compareSha && !fileQueryText ? 'No changed files intersect with this compare target.' : 'No files match this search.'}
          </div>
        ) : visibleFiles.map((file) => {
          const fileTypeIcon = fileTypeIconForPath(file.path)
          const intersects = compareFilePaths.has(file.path)

          return (
            <button
              type="button"
              className={[
                'history-preview-file-row',
                selectedFilePath === file.path ? 'selected' : '',
                intersects ? 'intersects' : ''
              ].filter(Boolean).join(' ')}
              key={`${file.rawStatus}-${file.path}-${file.originalPath ?? ''}`}
              onClick={() => openCommitFilePreview(file.path)}
              title={file.path}
            >
              <span className={`file-status status-${file.status}`}>{fileStatusToken(file.status)}</span>
              <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
                {fileTypeIcon.label}
              </span>
              <span className="file-name">{file.path}</span>
              {intersects && <span className="history-preview-intersection">compare</span>}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
