import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { DiffLine } from '../../shared/branchPilot'
import { renderSegs, shouldWordDiff, wordDiff } from '../../lib/wordDiff'
import type { DiffLineEditorTarget } from './diffViewTypes'

/** Word-level highlight map for the unified view: line index → highlighted content. */
export function buildUnifiedWordDiff(lines: DiffLine[], lang: string): Map<number, ReactNode> {
  const map = new Map<number, ReactNode>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].type !== 'remove') {
      i += 1
      continue
    }
    const removeStart = i
    while (i < lines.length && lines[i].type === 'remove') i += 1
    const addStart = i
    while (i < lines.length && lines[i].type === 'add') i += 1
    const pairs = Math.min(addStart - removeStart, i - addStart)
    for (let k = 0; k < pairs; k++) {
      const oldLine = lines[removeStart + k]
      const newLine = lines[addStart + k]
      if (!shouldWordDiff(oldLine.content, newLine.content)) continue
      const { oldSegs, newSegs } = wordDiff(oldLine.content, newLine.content)
      map.set(removeStart + k, renderSegs(oldSegs, lang, 'del'))
      map.set(addStart + k, renderSegs(newSegs, lang, 'add'))
    }
  }
  return map
}

export function targetIsInlineControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, input, select, textarea, [role="button"]'))
}

export function eventIsInLineSelectGutter(event: ReactMouseEvent<HTMLElement>): boolean {
  const content = event.currentTarget.querySelector('.line-content')
  return content instanceof HTMLElement && event.clientX < content.getBoundingClientRect().left
}

export function browserSelectionForLine(lineContent: string): Pick<DiffLineEditorTarget, 'column' | 'selectionText'> {
  const selected = window.getSelection()?.toString().replace(/\r\n?/g, '\n').trim()
  if (!selected) return {}

  const candidates = [
    selected,
    ...selected.split('\n').map((line) => line.trim()).filter(Boolean)
  ]
  const match = candidates.find((candidate) => candidate.length > 0 && lineContent.includes(candidate))
  if (!match) return { selectionText: selected }

  return {
    selectionText: match,
    column: lineContent.indexOf(match) + 1
  }
}

export function hasActiveTextSelection(): boolean {
  return Boolean(window.getSelection()?.toString().trim())
}

export function diffLinePrefix(line: DiffLine): string {
  if (line.type === 'add') return '+'
  if (line.type === 'remove') return '-'
  if (line.type === 'meta') return '\\'
  return ' '
}

export function formatLineNumber(lineNumber?: number): string {
  return lineNumber ? String(lineNumber) : ''
}
