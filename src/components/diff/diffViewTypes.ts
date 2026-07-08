import type { DiffLine } from '../../shared/branchPilot'
import type { ChangeDiffMode } from '../../shared/changeStaging'

export type DiffMode = ChangeDiffMode
export type DiffDisplayMode = 'unified' | 'split'
export type DiffContextDirection = 'up' | 'down'

export interface DiffLineEditorTarget {
  filePath: string
  line?: number
  column?: number
  selectionText?: string
  lineText?: string
}

export interface DiffLineContextMenuTarget extends DiffLineEditorTarget {
  x: number
  y: number
  selectedLineCount?: number
  selectedLinePatch?: string
  selectedLineStaged?: boolean
}

export interface DiffContextLoadRequest {
  filePath: string
  staged: boolean
  lineStart: number
  maxLines: number
}

export interface ExtraContextEntry {
  above: DiffLine[]
  below: DiffLine[]
  totalLines?: number
}

export type ExtraContextMap = Record<string, ExtraContextEntry>
