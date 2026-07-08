export const HEX_BYTES_PER_ROW = 16
export const HEX_CHUNK_BYTES = 16 * 1024
export const HEX_SEARCH_MATCH_LIMIT = 500

export interface HexEditorRow {
  offset: number
  bytes: number[]
}

export interface HexBytePreview {
  filePath: string
  byteSize: number
  startOffset: number
  endOffset: number
  hasMore: boolean
  fullFileLoaded: boolean
}

export interface HexSearchMatch {
  offset: number
  length: number
}

export function bytesFromBase64(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return window.btoa(binary)
}

export function bytesToHexText(bytes: Uint8Array): string {
  const rows: string[] = []
  for (let offset = 0; offset < bytes.length; offset += HEX_BYTES_PER_ROW) {
    rows.push(Array.from(bytes.subarray(offset, offset + HEX_BYTES_PER_ROW), byteToHex).join(' '))
  }
  return rows.join('\n')
}

export function parseHexText(hexText: string): { bytes: Uint8Array | null; error: string | null } {
  const normalized = hexText.replace(/\s+/g, '')
  if (!normalized) return { bytes: new Uint8Array(), error: null }
  if (/[^0-9a-f]/i.test(normalized)) return { bytes: null, error: 'Hex can contain only 0-9 and A-F bytes.' }
  if (normalized.length % 2 !== 0) return { bytes: null, error: 'Hex byte stream has an odd number of digits.' }

  const bytes = new Uint8Array(normalized.length / 2)
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16)
  }
  return { bytes, error: null }
}

export function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}

export function normalizeHexByteDraft(rawDraft: string): string {
  return rawDraft.trim().replace(/[^0-9a-f]/gi, '').slice(0, 2).toLowerCase()
}

export function asciiFromByte(byte: number): string {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'
}

export function hexEditorRows(bytes: Uint8Array, startOffset = 0): HexEditorRow[] {
  const rows: HexEditorRow[] = []
  for (let offset = 0; offset < bytes.length; offset += HEX_BYTES_PER_ROW) {
    rows.push({
      offset: startOffset + offset,
      bytes: Array.from(bytes.subarray(offset, offset + HEX_BYTES_PER_ROW))
    })
  }
  return rows
}

export function offsetToHex(offset: number): string {
  return Math.max(0, Math.floor(offset)).toString(16).padStart(8, '0')
}

export function alignHexOffset(offset: number): number {
  return Math.floor(Math.max(0, offset) / HEX_BYTES_PER_ROW) * HEX_BYTES_PER_ROW
}

export function parseHexOffsetDraft(rawDraft: string): number | null {
  const draft = rawDraft.trim()
  if (!draft) return null
  if (/^0x[0-9a-f]+$/i.test(draft)) return Number.parseInt(draft.slice(2), 16)
  if (/[a-f]/i.test(draft) && /^[0-9a-f]+$/i.test(draft)) return Number.parseInt(draft, 16)
  if (/^\d+$/.test(draft)) return Number.parseInt(draft, 10)
  return null
}

export function bytesForHexSearch(rawQuery: string): Uint8Array | null {
  const query = rawQuery.trim()
  if (!query) return null
  const compactHex = query.replace(/(?:0x|[\s,_-])/gi, '')
  if (compactHex.length >= 2 && compactHex.length % 2 === 0 && /^[0-9a-f]+$/i.test(compactHex)) {
    const bytes = new Uint8Array(compactHex.length / 2)
    for (let index = 0; index < compactHex.length; index += 2) {
      bytes[index / 2] = Number.parseInt(compactHex.slice(index, index + 2), 16)
    }
    return bytes
  }

  const asciiBytes = new Uint8Array(query.length)
  for (let index = 0; index < query.length; index += 1) {
    const code = query.charCodeAt(index)
    if (code > 0xff) return null
    asciiBytes[index] = code
  }
  return asciiBytes
}

export function findHexSearchMatches(bytes: Uint8Array | null, query: string, startOffset: number): HexSearchMatch[] {
  const needle = bytesForHexSearch(query)
  if (!bytes || !needle || needle.length === 0 || needle.length > bytes.length) return []

  const matches: HexSearchMatch[] = []
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    let matched = true
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (bytes[index + needleIndex] !== needle[needleIndex]) {
        matched = false
        break
      }
    }
    if (!matched) continue
    matches.push({ offset: startOffset + index, length: needle.length })
    if (matches.length >= HEX_SEARCH_MATCH_LIMIT) break
  }
  return matches
}

export function hexByteInMatch(offset: number, matches: HexSearchMatch[]): boolean {
  return matches.some((match) => offset >= match.offset && offset < match.offset + match.length)
}
