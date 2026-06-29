import type { DiffResult } from '../../shared/branchPilot'
import { highlight, langFromPath } from '../../lib/highlight'

function lineParts(line: string): { className: string; marker: string; content: string; highlightContent: boolean } {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { className: 'marker-add', marker: '+', content: line.slice(1), highlightContent: true }
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return { className: 'marker-remove', marker: '-', content: line.slice(1), highlightContent: true }
  }

  return { className: 'marker-base', marker: ' ', content: line, highlightContent: false }
}

export function RawDiffPreview({ diff }: { diff: DiffResult }) {
  const lang = langFromPath(diff.filePath)

  return (
    <pre className="diff-preview">
      {diff.tooLarge && (
        <code className="line marker-base">
          <span> </span>
          Diff truncated for performance.
        </code>
      )}
      {diff.text.split('\n').map((line, index) => {
        const parts = lineParts(line)

        return (
          <code className={`line ${parts.className}`} key={`${index}-${line.slice(0, 20)}`}>
            <span>{parts.marker}</span>
            {parts.highlightContent ? highlight(parts.content, lang) : parts.content}
          </code>
        )
      })}
    </pre>
  )
}
