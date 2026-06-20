import type { ReactNode } from 'react'
import { highlight } from './highlight'

type Seg = { text: string; changed: boolean }

function tokenize(s: string): string[] {
  return s.match(/(\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]+)/g) ?? []
}

/** Token-level diff of two strings via LCS. Returns the changed segments per side. */
export function wordDiff(oldStr: string, newStr: string): { oldSegs: Seg[]; newSegs: Seg[] } {
  const a = tokenize(oldStr)
  const b = tokenize(newStr)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const oldSegs: Seg[] = []
  const newSegs: Seg[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      oldSegs.push({ text: a[i], changed: false })
      newSegs.push({ text: b[j], changed: false })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      oldSegs.push({ text: a[i], changed: true })
      i++
    } else {
      newSegs.push({ text: b[j], changed: true })
      j++
    }
  }
  while (i < n) {
    oldSegs.push({ text: a[i], changed: true })
    i++
  }
  while (j < m) {
    newSegs.push({ text: b[j], changed: true })
    j++
  }
  return { oldSegs, newSegs }
}

/** Only word-diff lines that are similar enough; otherwise the whole line just changed. */
export function shouldWordDiff(oldStr: string, newStr: string): boolean {
  if (!oldStr.trim() || !newStr.trim()) return false
  const a = tokenize(oldStr)
  const b = tokenize(newStr)
  if (a.length === 0 || b.length === 0) return false
  const setB = new Set(b)
  let common = 0
  for (const t of a) if (setB.has(t)) common += 1
  return common / Math.max(a.length, b.length) >= 0.3
}

/** Render segments with syntax highlighting; changed runs get a word-level background. */
export function renderSegs(segs: Seg[], lang: string, side: 'add' | 'del'): ReactNode {
  const cls = side === 'add' ? 'word-add' : 'word-del'
  const out: ReactNode[] = []
  let buf = ''
  let changed = false
  let key = 0
  const flush = () => {
    if (!buf) return
    out.push(
      changed ? (
        <span key={key++} className={cls}>
          {highlight(buf, lang)}
        </span>
      ) : (
        <span key={key++}>{highlight(buf, lang)}</span>
      ),
    )
    buf = ''
  }
  for (const s of segs) {
    if (s.changed !== changed) {
      flush()
      changed = s.changed
    }
    buf += s.text
  }
  flush()
  return out
}
