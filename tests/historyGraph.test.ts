import { describe, expect, it } from 'vitest'
import {
  HISTORY_GRAPH_NODE_RADIUS,
  HISTORY_GRAPH_TEXT_GUTTER,
  buildHistoryGraphModel,
  historyGraphTextStartForRow,
  historyGraphTextStarts,
  historyGraphX
} from '../src/lib/historyGraph'

describe('history graph layout', () => {
  it('starts commit labels after the active lanes for each row', () => {
    const commits = [
      { sha: 'merge', parentShas: ['main', 'branch'] },
      { sha: 'main', parentShas: ['base'] },
      { sha: 'branch', parentShas: ['base'] },
      { sha: 'base', parentShas: [] }
    ]
    const rowHeight = 46
    const graph = buildHistoryGraphModel(commits, rowHeight)
    const row0Start = historyGraphTextStartForRow(graph, 0, rowHeight)
    const row1Start = historyGraphTextStartForRow(graph, 1, rowHeight)
    const starts = historyGraphTextStarts(graph, commits.length, rowHeight)

    expect(row0Start).toBe(historyGraphX(1) + HISTORY_GRAPH_NODE_RADIUS + HISTORY_GRAPH_TEXT_GUTTER)
    expect(row1Start).toBeGreaterThan(historyGraphX(0) + HISTORY_GRAPH_NODE_RADIUS + HISTORY_GRAPH_TEXT_GUTTER)
    expect(starts[0]).toBe(row0Start)
    expect(starts[1]).toBe(row1Start)
  })
})
