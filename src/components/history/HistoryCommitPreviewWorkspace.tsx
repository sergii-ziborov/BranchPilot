import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import type { BranchPilotApi, CommitDetails, CommitSummary, DiffResult } from '../../shared/branchPilot'
import { formatDate } from '../../lib/format'
import { fileStatusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { DiffPreview } from '../DiffView'
import { HistoryFilePreview, type HistoryFilePreviewModel } from './HistoryFilePreview'

interface HistoryCommitPreviewWorkspaceProps {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  history: CommitSummary[]
  commitDetails: CommitDetails
  preview: HistoryFilePreviewModel
  onBack: () => void
  openCommitFilePreview: (filePath: string) => void
}

function commitSearchText(commit: CommitSummary): string {
  return `${commit.shortSha} ${commit.sha} ${commit.subject} ${commit.authorName} ${commit.authorEmail} ${commit.authoredAt}`.toLowerCase()
}

export function HistoryCommitPreviewWorkspace({
  api,
  currentRepoPath,
  history,
  commitDetails,
  preview,
  onBack,
  openCommitFilePreview
}: HistoryCommitPreviewWorkspaceProps) {
  const [fileQuery, setFileQuery] = useState('')
  const [compareQuery, setCompareQuery] = useState('')
  const [compareSha, setCompareSha] = useState('')
  const [compareDetails, setCompareDetails] = useState<CommitDetails | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareDiff, setCompareDiff] = useState<DiffResult | null>(null)
  const [compareDiffLoading, setCompareDiffLoading] = useState(false)
  const [compareDiffError, setCompareDiffError] = useState<string | null>(null)
  const compareDetailsRequestRef = useRef(0)
  const compareDiffRequestRef = useRef(0)

  const compareFilePaths = useMemo(
    () => new Set((compareDetails?.files ?? []).map((file) => file.path)),
    [compareDetails]
  )
  const fileQueryText = fileQuery.trim().toLowerCase()
  const visibleFiles = useMemo(() => (
    fileQueryText
      ? commitDetails.files.filter((file) => `${file.path} ${file.originalPath ?? ''} ${file.status}`.toLowerCase().includes(fileQueryText))
      : commitDetails.files
  ), [commitDetails.files, fileQueryText])
  const compareQueryText = compareQuery.trim().toLowerCase()
  const compareCandidates = useMemo(() => history
    .filter((commit) => commit.sha !== commitDetails.sha)
    .filter((commit) => !compareQueryText || commitSearchText(commit).includes(compareQueryText))
    .slice(0, 80), [compareQueryText, commitDetails.sha, history])
  const selectedCompareSummary = history.find((commit) => commit.sha === compareSha) ?? null
  const selectedFileInCompare = Boolean(compareSha && compareFilePaths.has(preview.filePath))

  useEffect(() => {
    const requestId = compareDetailsRequestRef.current + 1
    compareDetailsRequestRef.current = requestId
    setCompareDetails(null)
    setCompareError(null)
    setCompareDiff(null)
    setCompareDiffError(null)

    if (!compareSha || !api || !currentRepoPath) {
      setCompareLoading(false)
      return
    }

    setCompareLoading(true)
    void api
      .getCommitDetails({ repoPath: currentRepoPath, commitSha: compareSha })
      .then((result) => {
        if (compareDetailsRequestRef.current !== requestId) return
        setCompareLoading(false)
        if (result.ok) {
          setCompareDetails(result.data)
          return
        }
        setCompareError(result.error.message || result.error.details || 'Failed to load compare commit.')
      })
      .catch((error) => {
        if (compareDetailsRequestRef.current !== requestId) return
        setCompareLoading(false)
        setCompareError(error instanceof Error ? error.message : 'Failed to load compare commit.')
      })
  }, [api, compareSha, currentRepoPath])

  useEffect(() => {
    const requestId = compareDiffRequestRef.current + 1
    compareDiffRequestRef.current = requestId
    setCompareDiff(null)
    setCompareDiffError(null)

    if (!compareSha || !api || !currentRepoPath || !selectedFileInCompare) {
      setCompareDiffLoading(false)
      return
    }

    setCompareDiffLoading(true)
    void api
      .getCommitFileCompareDiff({
        repoPath: currentRepoPath,
        commitSha: commitDetails.sha,
        compareCommitSha: compareSha,
        filePath: preview.filePath
      })
      .then((result) => {
        if (compareDiffRequestRef.current !== requestId) return
        setCompareDiffLoading(false)
        if (result.ok) {
          setCompareDiff(result.data)
          return
        }
        setCompareDiffError(result.error.message || result.error.details || 'Failed to compare this file.')
      })
      .catch((error) => {
        if (compareDiffRequestRef.current !== requestId) return
        setCompareDiffLoading(false)
        setCompareDiffError(error instanceof Error ? error.message : 'Failed to compare this file.')
      })
  }, [api, compareSha, commitDetails.sha, currentRepoPath, preview.filePath, selectedFileInCompare])

  return (
    <section className="history-preview-workspace">
      <aside className="history-preview-sidebar">
        <button type="button" className="secondary history-preview-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to history
        </button>
        <div className="history-preview-sidebar-title">
          <span>Changes in {commitDetails.shortSha}</span>
          <strong>{commitDetails.files.length} files</strong>
        </div>
        <label className="history-preview-search">
          <Search size={15} />
          <input
            value={fileQuery}
            onChange={(event) => setFileQuery(event.target.value)}
            placeholder="Search changed files"
          />
        </label>
        <div className="history-preview-file-list">
          {visibleFiles.length === 0 ? (
            <div className="quiet-box">No files match this search.</div>
          ) : visibleFiles.map((file) => {
            const fileTypeIcon = fileTypeIconForPath(file.path)
            const intersects = compareFilePaths.has(file.path)

            return (
              <button
                type="button"
                className={[
                  'history-preview-file-row',
                  preview.filePath === file.path ? 'selected' : '',
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

      <div className="history-preview-main">
        <header className="history-preview-header">
          <div>
            <h3>{commitDetails.subject || 'Commit preview'}</h3>
            <p>
              {commitDetails.shortSha} | {commitDetails.authorName} | {formatDate(commitDetails.authoredAt)}
            </p>
          </div>
          <div className="history-preview-compare">
            <label>
              <Search size={14} />
              <input
                value={compareQuery}
                onChange={(event) => setCompareQuery(event.target.value)}
                placeholder="Search commit to compare"
              />
            </label>
            <select
              value={compareSha}
              onChange={(event) => setCompareSha(event.target.value)}
              title="Choose commit to compare against"
            >
              <option value="">Full file at this commit</option>
              {compareCandidates.map((commit) => (
                <option key={commit.sha} value={commit.sha}>
                  {commit.shortSha} - {commit.subject || '(no subject)'}
                </option>
              ))}
            </select>
          </div>
        </header>

        {compareSha && (
          <div className="history-preview-compare-status">
            {compareLoading ? (
              <span>Loading compare commit...</span>
            ) : compareError ? (
              <span className="danger-text">{compareError}</span>
            ) : selectedCompareSummary ? (
              <span>
                Comparing against {selectedCompareSummary.shortSha}
                {selectedFileInCompare ? ' | this file changed in both commits' : ' | this file is not in that commit change set'}
              </span>
            ) : (
              <span>Choose a commit to compare.</span>
            )}
          </div>
        )}

        {compareSha && selectedFileInCompare ? (
          compareDiffLoading ? (
            <div className="quiet-box">Loading comparison diff.</div>
          ) : compareDiffError ? (
            <div className="quiet-box danger-text">{compareDiffError}</div>
          ) : (
            <DiffPreview diff={compareDiff} />
          )
        ) : (
          <HistoryFilePreview
            preview={preview}
            onBack={onBack}
            onCopyContent={() => preview.content && !preview.content.binary && navigator.clipboard.writeText(preview.content.text)}
            onCopyPath={() => navigator.clipboard.writeText(preview.filePath)}
            onCopySha={() => navigator.clipboard.writeText(preview.commitSha)}
            showBack={false}
          />
        )}
      </div>
    </section>
  )
}
