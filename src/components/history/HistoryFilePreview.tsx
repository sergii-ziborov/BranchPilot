import { ArrowLeft, Copy, FileCode2, Hash } from 'lucide-react'
import type { CommitFileContentResult } from '../../shared/branchPilot'
import { highlight, langFromPath } from '../../lib/highlight'

export interface HistoryFilePreviewModel {
  commitSha: string
  shortSha: string
  filePath: string
  loading: boolean
  error: string | null
  content: CommitFileContentResult | null
}

interface HistoryFilePreviewProps {
  preview: HistoryFilePreviewModel
  onBack: () => void
  onCopyContent: () => void
  onCopyPath: () => void
  onCopySha: () => void
  showBack?: boolean
}

function previewLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized

  return trimmed ? trimmed.split('\n') : ['']
}

export function HistoryFilePreview({
  preview,
  onBack,
  onCopyContent,
  onCopyPath,
  onCopySha,
  showBack = true
}: HistoryFilePreviewProps) {
  const content = preview.content
  const lines = content && !content.binary ? previewLines(content.text) : []
  const lang = langFromPath(preview.filePath)

  return (
    <div className="history-file-preview">
      <div className="history-file-preview-toolbar">
        {showBack && (
          <button type="button" className="secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to history
          </button>
        )}
        <div className="history-file-preview-title">
          <FileCode2 size={16} />
          <div>
            <strong title={preview.filePath}>{preview.filePath}</strong>
            <span title={preview.commitSha}>
              {preview.shortSha} at selected commit
            </span>
          </div>
        </div>
        <div className="history-file-preview-actions">
          <button type="button" className="secondary icon-button" title="Copy full commit SHA" aria-label="Copy full commit SHA" onClick={onCopySha}>
            <Hash size={15} />
          </button>
          <button type="button" className="secondary icon-button" title="Copy file path" aria-label="Copy file path" onClick={onCopyPath}>
            <Copy size={15} />
          </button>
          <button type="button" className="secondary" onClick={onCopyContent} disabled={!content || content.binary || preview.loading}>
            <Copy size={15} />
            Copy content
          </button>
        </div>
      </div>

      <div className="history-file-preview-body">
        {preview.loading ? (
          <div className="quiet-box">Loading file from commit.</div>
        ) : preview.error ? (
          <div className="quiet-box danger-text">{preview.error}</div>
        ) : content?.binary ? (
          <div className="quiet-box">This commit file is binary, so BranchPilot cannot show it as text.</div>
        ) : content ? (
          <>
            {content.tooLarge && <div className="history-file-preview-note">Preview truncated for performance.</div>}
            <pre className="history-file-code diff-preview">
              {lines.map((line, index) => (
                <code className="history-file-code-line" key={`${index}-${line.slice(0, 20)}`}>
                  <span className="history-file-line-number">{index + 1}</span>
                  <span className="history-file-line-source">{highlight(line, lang)}</span>
                </code>
              ))}
            </pre>
          </>
        ) : (
          <div className="quiet-box">No file preview loaded.</div>
        )}
      </div>
    </div>
  )
}
