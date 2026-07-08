import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { FileLineSearchTarget } from './editorStateTypes'

interface EditorFileSearchFieldProps {
  fileSearchInputRef: { current: HTMLInputElement | null }
  fileSearchQuery: string
  setFileSearchQuery: (query: string) => void
  handleFileSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  disabled: boolean
  fileLineSearchTarget: FileLineSearchTarget | null
  activeSearchIndex: number
  fileSearchMatchCount: number
  fileSearchOverflow: boolean
  focusFileLineSearchTarget: () => boolean
  activateSearchMatch: (index: number) => void
}

export function EditorFileSearchField({
  fileSearchInputRef,
  fileSearchQuery,
  setFileSearchQuery,
  handleFileSearchKeyDown,
  disabled,
  fileLineSearchTarget,
  activeSearchIndex,
  fileSearchMatchCount,
  fileSearchOverflow,
  focusFileLineSearchTarget,
  activateSearchMatch
}: EditorFileSearchFieldProps) {
  return (
    <label className="changes-editor-file-search">
      <Search size={15} />
      <input
        ref={fileSearchInputRef}
        value={fileSearchQuery}
        onChange={(event) => setFileSearchQuery(event.target.value)}
        onKeyDown={handleFileSearchKeyDown}
        placeholder="Search in file / :line"
        title="Search text, or jump to a line with 120, :120, #120, or :120:5"
        disabled={disabled}
      />
      {fileSearchQuery && (
        <button type="button" title="Clear file search" aria-label="Clear file search" onClick={() => setFileSearchQuery('')}>
          <X size={14} />
        </button>
      )}
      <span className="changes-editor-search-count">
        {fileLineSearchTarget
          ? `line ${fileLineSearchTarget.lineNumber}${fileLineSearchTarget.column > 0 ? `:${fileLineSearchTarget.column + 1}` : ''}`
          : fileSearchQuery.trim()
          ? `${activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0}/${fileSearchMatchCount}${fileSearchOverflow ? '+' : ''}`
          : '0/0'}
      </span>
      <button type="button" title={fileLineSearchTarget ? 'Go to line' : 'Previous match'} aria-label={fileLineSearchTarget ? 'Go to line' : 'Previous match'} disabled={!fileLineSearchTarget && fileSearchMatchCount === 0} onClick={() => (fileLineSearchTarget ? focusFileLineSearchTarget() : activateSearchMatch(activeSearchIndex < 0 ? -1 : activeSearchIndex - 1))}>
        <ChevronUp size={14} />
      </button>
      <button type="button" title={fileLineSearchTarget ? 'Go to line' : 'Next match'} aria-label={fileLineSearchTarget ? 'Go to line' : 'Next match'} disabled={!fileLineSearchTarget && fileSearchMatchCount === 0} onClick={() => (fileLineSearchTarget ? focusFileLineSearchTarget() : activateSearchMatch(activeSearchIndex < 0 ? 0 : activeSearchIndex + 1))}>
        <ChevronDown size={14} />
      </button>
    </label>
  )
}
