import type { DiffFile } from '../shared/branchPilot'

/** Build a `git apply --cached` patch that stages only the selected +/- lines. */
export function buildStagePatch(files: DiffFile[], selected: Set<string>): string {
  let out = ''
  files.forEach((file, fi) => {
    const hunkPatches: string[] = []
    file.hunks.forEach((hunk, hi) => {
      const body: string[] = []
      let oldCount = 0
      let newCount = 0
      let hasSelected = false
      hunk.lines.forEach((line, li) => {
        const sel = selected.has(`${fi}:${hi}:${li}`)
        if (line.type === 'context') {
          body.push(` ${line.content}`)
          oldCount += 1
          newCount += 1
        } else if (line.type === 'add') {
          if (sel) {
            body.push(`+${line.content}`)
            newCount += 1
            hasSelected = true
          }
        } else if (line.type === 'remove') {
          if (sel) {
            body.push(`-${line.content}`)
            oldCount += 1
            hasSelected = true
          } else {
            body.push(` ${line.content}`)
            oldCount += 1
            newCount += 1
          }
        }
      })
      if (!hasSelected) return
      hunkPatches.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${body.join('\n')}`)
    })
    if (hunkPatches.length === 0) return
    const a = file.oldPath ?? file.newPath
    const b = file.newPath
    const oldHeader = file.oldPath ? `--- a/${a}` : '--- /dev/null'
    const modeHeader = file.oldPath ? '' : 'new file mode 100644\n'
    out += `diff --git a/${a} b/${b}\n${modeHeader}${oldHeader}\n+++ b/${b}\n${hunkPatches.join('\n')}\n`
  })
  return out
}

/** Build a patch that can be reverse-applied to the index to exclude selected staged lines. */
export function buildUnstagePatch(files: DiffFile[], selected: Set<string>): string {
  let out = ''
  files.forEach((file, fi) => {
    const hunkPatches: string[] = []
    file.hunks.forEach((hunk, hi) => {
      const body: string[] = []
      let oldCount = 0
      let newCount = 0
      let hasSelected = false
      hunk.lines.forEach((line, li) => {
        const sel = selected.has(`${fi}:${hi}:${li}`)
        if (line.type === 'context') {
          body.push(` ${line.content}`)
          oldCount += 1
          newCount += 1
        } else if (line.type === 'add') {
          if (sel) {
            body.push(`+${line.content}`)
            newCount += 1
            hasSelected = true
          } else {
            body.push(` ${line.content}`)
            oldCount += 1
            newCount += 1
          }
        } else if (line.type === 'remove' && sel) {
          body.push(`-${line.content}`)
          oldCount += 1
          hasSelected = true
        }
      })
      if (!hasSelected) return
      hunkPatches.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${body.join('\n')}`)
    })
    if (hunkPatches.length === 0) return
    const a = file.oldPath ?? file.newPath
    const b = file.newPath
    const oldHeader = file.oldPath ? `--- a/${a}` : '--- /dev/null'
    const modeHeader = file.oldPath ? '' : 'new file mode 100644\n'
    out += `diff --git a/${a} b/${b}\n${modeHeader}${oldHeader}\n+++ b/${b}\n${hunkPatches.join('\n')}\n`
  })
  return out
}
