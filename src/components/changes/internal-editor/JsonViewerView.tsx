import type { CSSProperties } from 'react'
import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react'
import {
  jsonEditableKind,
  jsonValueSummary,
  type JsonEditCell,
  type JsonTreeNode
} from './jsonTreeUtils'

export interface JsonViewerViewProps {
  textUnavailableMessage: string | null
  draftText: string
  jsonParseResult: { rows: JsonTreeNode[]; expandablePaths: string[]; error: string | null }
  collapsedJsonPaths: Set<string>
  jsonEdit: JsonEditCell | null
  setJsonEdit: (edit: JsonEditCell | null) => void
  skipJsonEditBlurRef: { current: boolean }
  expandAllJson: () => void
  collapseAllJson: () => void
  formatJsonDraft: () => void
  toggleJsonNode: (path: string) => void
  beginJsonEdit: (row: JsonTreeNode) => void
  cancelJsonEdit: () => void
  commitJsonEdit: (edit?: JsonEditCell) => void
}

export function JsonViewerView({
  textUnavailableMessage,
  draftText,
  jsonParseResult,
  collapsedJsonPaths,
  jsonEdit,
  setJsonEdit,
  skipJsonEditBlurRef,
  expandAllJson,
  collapseAllJson,
  formatJsonDraft,
  toggleJsonNode,
  beginJsonEdit,
  cancelJsonEdit,
  commitJsonEdit
}: JsonViewerViewProps) {
  if (textUnavailableMessage) {
    return (
      <div className="changes-editor-mode-message">
        <FileCode2 size={28} />
        <strong>{textUnavailableMessage}</strong>
        <span>JSON text is not available for this file.</span>
      </div>
    )
  }

  if (jsonParseResult.error) {
    return (
      <div className="changes-editor-mode-message danger-text">
        <FileCode2 size={28} />
        <strong>Invalid JSON</strong>
        <span>{jsonParseResult.error}</span>
      </div>
    )
  }

  if (!draftText.trim()) {
    return (
      <div className="changes-editor-mode-message">
        <FileCode2 size={28} />
        <strong>Empty JSON</strong>
        <span>Switch to Code to add content.</span>
      </div>
    )
  }

  const rows = jsonParseResult.rows.slice(0, 2500)

  return (
    <div className="changes-editor-json-viewer">
      <div className="changes-editor-json-toolbar">
        <strong>{jsonParseResult.rows.length} visible node{jsonParseResult.rows.length === 1 ? '' : 's'}</strong>
        <span>{jsonParseResult.expandablePaths.length} collapsible</span>
        <button type="button" onClick={expandAllJson} disabled={collapsedJsonPaths.size === 0}>Expand all</button>
        <button type="button" onClick={collapseAllJson} disabled={jsonParseResult.expandablePaths.length === 0}>Collapse all</button>
        <button type="button" onClick={formatJsonDraft}>Format JSON</button>
      </div>
      <div className="changes-editor-json-tree">
        {rows.map((row) => {
          const summary = jsonValueSummary(row.value)
          const collapsed = collapsedJsonPaths.has(row.path)
          const editableKind = jsonEditableKind(row.value)
          const editing = jsonEdit?.path === row.path

          return (
            <div className="changes-editor-json-row" key={row.path || '$'} style={{ '--json-indent': `${row.depth * 18}px` } as CSSProperties}>
              <span className="changes-editor-json-line-number">{row.lineNumber ?? ''}</span>
              <button
                type="button"
                className="changes-editor-json-toggle"
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.keyName ?? 'root'}`}
                disabled={!row.expandable}
                onClick={() => toggleJsonNode(row.path)}
              >
                {row.expandable ? (collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />) : null}
              </button>
              <span className="changes-editor-json-key">{row.keyName ?? '$'}</span>
              <span className={`changes-editor-json-type type-${summary.type}`}>{summary.type}</span>
              <span className="changes-editor-json-value">
                {editing && jsonEdit ? (
                  jsonEdit.kind === 'boolean' ? (
                    <select
                      className="changes-editor-json-edit"
                      autoFocus
                      value={jsonEdit.value}
                      onChange={(event) => {
                        const nextEdit = { ...jsonEdit, value: event.target.value }
                        setJsonEdit(nextEdit)
                        window.requestAnimationFrame(() => commitJsonEdit(nextEdit))
                      }}
                      onBlur={() => {
                        if (skipJsonEditBlurRef.current) {
                          skipJsonEditBlurRef.current = false
                          return
                        }
                        commitJsonEdit()
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelJsonEdit()
                        }
                      }}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      className="changes-editor-json-edit"
                      autoFocus
                      value={jsonEdit.value}
                      inputMode={jsonEdit.kind === 'number' ? 'decimal' : 'text'}
                      onChange={(event) => setJsonEdit({ ...jsonEdit, value: event.target.value })}
                      onBlur={() => {
                        if (skipJsonEditBlurRef.current) {
                          skipJsonEditBlurRef.current = false
                          return
                        }
                        commitJsonEdit()
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitJsonEdit()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelJsonEdit()
                        }
                      }}
                    />
                  )
                ) : editableKind ? (
                  <button type="button" className="changes-editor-json-value-button" onClick={() => beginJsonEdit(row)} title="Edit JSON value">
                    {summary.preview}
                  </button>
                ) : (
                  summary.preview
                )}
                {row.expandable && collapsed && <small>{row.childCount} hidden</small>}
              </span>
            </div>
          )
        })}
        {jsonParseResult.rows.length > rows.length && (
          <div className="changes-editor-json-more">{jsonParseResult.rows.length - rows.length} more JSON nodes hidden for performance.</div>
        )}
      </div>
    </div>
  )
}
