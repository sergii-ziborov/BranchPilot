import type { KeyboardEvent as ReactKeyboardEvent, UIEvent as ReactUIEvent } from 'react'
import { FileCode2, Search } from 'lucide-react'
import { SignalStatus } from '../../SignalStatus'
import { formatBytes } from './editorPrimitives'
import {
  HEX_BYTES_PER_ROW,
  HEX_SEARCH_MATCH_LIMIT,
  asciiFromByte,
  byteToHex,
  hexByteInMatch,
  offsetToHex,
  type HexBytePreview,
  type HexEditorRow,
  type HexSearchMatch
} from './hexUtils'

export interface HexEditorViewProps {
  selectedPath: string
  hexLoading: boolean
  hexError: string | null
  hexBytes: HexBytePreview | null
  hexFullFileLoaded: boolean
  hexChunkEditable: boolean
  hexPreviewRows: HexEditorRow[]
  parsedHexDraft: { bytes: Uint8Array | null; error: string | null }
  activeHexByteIndex: number
  activeHexByte: number | null
  activeHexAscii: string
  activeHexRowOffset: number
  hexByteDraft: string
  hexOffsetDraft: string
  hexSearchQuery: string
  activeHexSearchIndex: number
  hexSearchMatches: HexSearchMatch[]
  hexTableBodyRef: { current: HTMLDivElement | null }
  setHexOffsetDraft: (value: string) => void
  setHexSearchQuery: (value: string) => void
  setActiveHexSearchIndex: (value: number) => void
  jumpHexChunk: (direction: 'previous' | 'next') => void
  goToHexOffset: () => void
  goToHexSearchMatch: (direction: 'previous' | 'next') => void
  selectHexByte: (index: number) => void
  updateHexByteDraft: (index: number, rawDraft: string) => void
  commitHexByteDraft: (index: number, rawDraft: string) => boolean
  handleHexByteInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>, index: number) => void
  hexByteChanged: (index: number, byte: number) => boolean
  syncHexScroll: (event: ReactUIEvent<HTMLDivElement>) => void
}

export function HexEditorView({
  selectedPath,
  hexLoading,
  hexError,
  hexBytes,
  hexFullFileLoaded,
  hexChunkEditable,
  hexPreviewRows,
  parsedHexDraft,
  activeHexByteIndex,
  activeHexByte,
  activeHexAscii,
  activeHexRowOffset,
  hexByteDraft,
  hexOffsetDraft,
  hexSearchQuery,
  activeHexSearchIndex,
  hexSearchMatches,
  hexTableBodyRef,
  setHexOffsetDraft,
  setHexSearchQuery,
  setActiveHexSearchIndex,
  jumpHexChunk,
  goToHexOffset,
  goToHexSearchMatch,
  selectHexByte,
  updateHexByteDraft,
  commitHexByteDraft,
  handleHexByteInputKeyDown,
  hexByteChanged,
  syncHexScroll
}: HexEditorViewProps) {
  if (hexLoading && !hexBytes) {
    return (
      <SignalStatus
        className="changes-editor-file-curtain changes-editor-file-curtain-static"
        label="Loading hex"
        detail={selectedPath}
      />
    )
  }

  if (hexError) {
    return (
      <div className="changes-editor-mode-message danger-text">
        <FileCode2 size={28} />
        <strong>Hex unavailable</strong>
        <span>{hexError}</span>
      </div>
    )
  }

  return (
    <div className="changes-editor-hex-shell">
      <div className="changes-editor-hex-meta">
        <strong>
          {hexBytes
            ? `${formatBytes(hexBytes.startOffset)}-${formatBytes(hexBytes.endOffset)} of ${formatBytes(hexBytes.byteSize)}`
            : 'Hex bytes not loaded yet'}
        </strong>
        {activeHexByte === null ? (
          <span>No byte selected</span>
        ) : (
          <span className="changes-editor-hex-selection">
            <b>Offset</b>
            <code>{offsetToHex(activeHexByteIndex)}</code>
            <b>Hex</b>
            <code>{byteToHex(activeHexByte)}</code>
            <b>Dec</b>
            <code>{activeHexByte}</code>
            <b>ASCII</b>
            <code>{activeHexAscii}</code>
          </span>
        )}
        {parsedHexDraft.bytes && (
          <em>{hexLoading ? 'loading chunk...' : hexFullFileLoaded ? `${parsedHexDraft.bytes.length} bytes in draft` : 'editable chunk'}</em>
        )}
      </div>
      <div className="changes-editor-hex-controls">
        <button
          type="button"
          onClick={() => jumpHexChunk('previous')}
          disabled={hexLoading || !hexBytes || hexBytes.startOffset <= 0}
        >
          Previous chunk
        </button>
        <button
          type="button"
          onClick={() => jumpHexChunk('next')}
          disabled={hexLoading || !hexBytes || !hexBytes.hasMore}
        >
          Next chunk
        </button>
        <label>
          <span>Offset</span>
          <input
            value={hexOffsetDraft}
            placeholder="00000000"
            spellCheck={false}
            onChange={(event) => setHexOffsetDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                goToHexOffset()
              }
            }}
          />
        </label>
        <button type="button" onClick={goToHexOffset} disabled={hexLoading || !hexBytes}>
          Go
        </button>
        <label className="changes-editor-hex-search">
          <Search size={14} />
          <input
            value={hexSearchQuery}
            placeholder="Search hex / ASCII"
            spellCheck={false}
            onChange={(event) => {
              setHexSearchQuery(event.currentTarget.value)
              setActiveHexSearchIndex(-1)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                goToHexSearchMatch(event.shiftKey ? 'previous' : 'next')
              }
            }}
          />
          <small>
            {hexSearchQuery.trim()
              ? `${activeHexSearchIndex >= 0 ? activeHexSearchIndex + 1 : 0}/${hexSearchMatches.length}${hexSearchMatches.length >= HEX_SEARCH_MATCH_LIMIT ? '+' : ''}`
              : '0/0'}
          </small>
        </label>
        <button type="button" onClick={() => goToHexSearchMatch('previous')} disabled={hexSearchMatches.length === 0}>
          Prev
        </button>
        <button type="button" onClick={() => goToHexSearchMatch('next')} disabled={hexSearchMatches.length === 0}>
          Next
        </button>
      </div>
      {parsedHexDraft.error && (
        <div className="changes-editor-hex-error">{parsedHexDraft.error}</div>
      )}
      <div className="changes-editor-hex-table">
        <header>
          <span>offset</span>
          <span>hex bytes</span>
          <span>ascii</span>
        </header>
        <div className="changes-editor-hex-table-body" ref={hexTableBodyRef} onScroll={syncHexScroll}>
          {hexPreviewRows.length === 0 ? (
            <div className="changes-editor-hex-empty">Empty file</div>
          ) : hexPreviewRows.map((row) => {
            const activeRow = row.offset === activeHexRowOffset && activeHexByteIndex < row.offset + row.bytes.length
            return (
              <div
                className={['changes-editor-hex-row', activeRow ? 'active' : ''].filter(Boolean).join(' ')}
                key={row.offset}
              >
                <button
                  type="button"
                  className="changes-editor-hex-offset"
                  onClick={() => selectHexByte(row.offset)}
                  aria-label={`Select row at offset ${row.offset.toString(16).padStart(8, '0')}`}
                >
                  {row.offset.toString(16).padStart(8, '0')}
                </button>
                <div className="changes-editor-hex-byte-grid" role="row">
                  {Array.from({ length: HEX_BYTES_PER_ROW }, (_, column) => {
                    const byte = row.bytes[column]
                    const byteIndex = row.offset + column
                    if (byte === undefined) {
                      return <span className="changes-editor-hex-byte-cell empty" key={column} aria-hidden="true" />
                    }

                    const active = byteIndex === activeHexByteIndex
                    const changed = hexByteChanged(byteIndex, byte)
                    const matched = hexByteInMatch(byteIndex, hexSearchMatches)
                    const className = [
                      'changes-editor-hex-byte-cell',
                      active ? 'active' : '',
                      matched ? 'search-match' : '',
                      changed ? 'changed' : ''
                    ].filter(Boolean).join(' ')

                    if (active && hexChunkEditable) {
                      return (
                        <input
                          className={className}
                          key={column}
                          value={hexByteDraft}
                          maxLength={2}
                          autoFocus
                          spellCheck={false}
                          aria-label={`Byte ${byteIndex.toString(16).padStart(8, '0')} hex value`}
                          onChange={(event) => updateHexByteDraft(byteIndex, event.currentTarget.value)}
                          onBlur={(event) => commitHexByteDraft(byteIndex, event.currentTarget.value)}
                          onFocus={(event) => event.currentTarget.select()}
                          onKeyDown={(event) => handleHexByteInputKeyDown(event, byteIndex)}
                        />
                      )
                    }

                    return (
                      <button
                        type="button"
                        className={className}
                        key={column}
                        onClick={() => selectHexByte(byteIndex)}
                        aria-label={`Select byte ${byteIndex.toString(16).padStart(8, '0')}`}
                      >
                        {byteToHex(byte)}
                      </button>
                    )
                  })}
                </div>
                <div className="changes-editor-hex-ascii-grid" aria-label={`ASCII row ${row.offset.toString(16).padStart(8, '0')}`}>
                  {Array.from({ length: HEX_BYTES_PER_ROW }, (_, column) => {
                    const byte = row.bytes[column]
                    const byteIndex = row.offset + column
                    if (byte === undefined) {
                      return <span className="changes-editor-hex-ascii-cell empty" key={column} aria-hidden="true" />
                    }

                    const active = byteIndex === activeHexByteIndex
                    const changed = hexByteChanged(byteIndex, byte)
                    const matched = hexByteInMatch(byteIndex, hexSearchMatches)
                    return (
                      <button
                        type="button"
                        className={[
                          'changes-editor-hex-ascii-cell',
                          active ? 'active' : '',
                          matched ? 'search-match' : '',
                          changed ? 'changed' : ''
                        ].filter(Boolean).join(' ')}
                        key={column}
                        onClick={() => selectHexByte(byteIndex)}
                        aria-label={`Select ASCII byte ${byteIndex.toString(16).padStart(8, '0')}`}
                      >
                        {asciiFromByte(byte)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        {hexBytes && !hexFullFileLoaded && (
          <p>
            Viewing {formatBytes(hexBytes.startOffset)}-{formatBytes(hexBytes.endOffset)} of {formatBytes(hexBytes.byteSize)}.
            Edit bytes in this chunk, jump by offset, or load adjacent chunks.
          </p>
        )}
      </div>
      {hexLoading && hexBytes && (
        <SignalStatus
          compact
          className="changes-editor-hex-loading"
          label="Loading hex chunk"
          detail={`${formatBytes(hexBytes.startOffset)}-${formatBytes(hexBytes.endOffset)} of ${formatBytes(hexBytes.byteSize)}`}
        />
      )}
    </div>
  )
}
