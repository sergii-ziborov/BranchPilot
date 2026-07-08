import { formatBytes } from './editorPrimitives'
import type { ChunkedTextPreview } from './editorTypes'
import type {
  EditorIndentInfo,
  EditorLineEnding,
  EditorLineEndingInfo,
  EditorSelectionStatus
} from './editorStateTypes'

interface EditorStatusBarProps {
  editorSelection: EditorSelectionStatus
  editorIndentSelectValue: string
  editorIndent: EditorIndentInfo
  updateEditorIndent: (value: string) => void
  editorLineEnding: EditorLineEndingInfo
  updateEditorLineEnding: (next: Exclude<EditorLineEnding, 'Mixed'>) => void
  chunkedTextActive: boolean
  chunkedTextPreview: ChunkedTextPreview | null
}

export function EditorStatusBar({
  editorSelection,
  editorIndentSelectValue,
  editorIndent,
  updateEditorIndent,
  editorLineEnding,
  updateEditorLineEnding,
  chunkedTextActive,
  chunkedTextPreview
}: EditorStatusBarProps) {
  return (
    <footer className="changes-editor-status-bar">
      <span className="changes-editor-status-position">
        Ln {editorSelection.lineNumber}, Col {editorSelection.column}
        {editorSelection.selectedChars > 0 && ` (${editorSelection.selectedChars} selected${editorSelection.selectedLines > 1 ? `, ${editorSelection.selectedLines} lines` : ''})`}
      </span>
      <label>
        <span>Indent</span>
        <select
          value={editorIndentSelectValue}
          onChange={(event) => updateEditorIndent(event.currentTarget.value)}
          title="Change indentation for the active file or chunk"
        >
          {editorIndent.kind === 'mixed' && <option value="mixed">Mixed</option>}
          {editorIndent.kind === 'none' && <option value="none">None</option>}
          <option value="spaces-2">Spaces: 2</option>
          <option value="spaces-4">Spaces: 4</option>
          <option value="spaces-8">Spaces: 8</option>
          <option value="tabs">Tabs</option>
        </select>
      </label>
      <label>
        <span>EOL</span>
        <select
          value={editorLineEnding.kind}
          onChange={(event) => {
            const next = event.currentTarget.value as EditorLineEnding
            if (next !== 'Mixed') updateEditorLineEnding(next)
          }}
          title="Change line endings for the active file or chunk"
        >
          {editorLineEnding.kind === 'Mixed' && <option value="Mixed">Mixed</option>}
          <option value="LF">LF</option>
          <option value="CRLF">CRLF</option>
          {editorLineEnding.kind === 'CR' && <option value="CR">CR</option>}
        </select>
      </label>
      <span title="Editor text is handled as UTF-8">UTF-8</span>
      {chunkedTextActive && (
        <span title="Status and conversions apply to the loaded chunk">
          Chunk {formatBytes(chunkedTextPreview?.startOffset ?? 0)}-{formatBytes(chunkedTextPreview?.endOffset ?? 0)}
        </span>
      )}
    </footer>
  )
}
