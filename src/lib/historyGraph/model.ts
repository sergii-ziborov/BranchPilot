export const HISTORY_GRAPH_TRUNK_KEY = 'trunk'
export const HISTORY_GRAPH_BRANCH_COLORS = ['#58a6ff', '#ff7eb6', '#39d98a', '#a78bfa', '#4dd0e1', '#ff7a59', '#b8f566', '#d2a8ff']
export const HISTORY_GRAPH_LANE_WIDTH = 11
export const HISTORY_GRAPH_PADDING_X = 10
export const HISTORY_GRAPH_MAX_WIDTH = 150
export const HISTORY_GRAPH_TEXT_GUTTER = 8
export const HISTORY_GRAPH_NODE_RADIUS = 4
export const HISTORY_GRAPH_LINE_WIDTH = 1.6
export const HISTORY_GRAPH_CURVE_RADIUS = 6
export const HISTORY_GRAPH_HOVER_RADIUS = HISTORY_GRAPH_NODE_RADIUS + 5

export interface HistoryGraphCommit {
  sha: string
  parentShas?: readonly string[] | null
}

interface HistoryGraphLane {
  id: string
  targetSha: string
  colorKey: string
}

export interface HistoryGraphSegment {
  id: string
  fromColumn: number
  toColumn: number
  fromY: number
  toY: number
  colorKey: string
  curve?: boolean
}

export interface HistoryGraphNode {
  id: string
  sha?: string
  column: number
  y: number
  colorKey: string
  merge: boolean
  junction?: boolean
}

export interface HistoryGraphModel {
  segments: HistoryGraphSegment[]
  nodes: HistoryGraphNode[]
  columnCount: number
}

export function historyGraphX(column: number): number {
  return HISTORY_GRAPH_PADDING_X + column * HISTORY_GRAPH_LANE_WIDTH
}

function uniqueParentShas(commit: HistoryGraphCommit): string[] {
  return Array.from(new Set(commit.parentShas ?? [])).filter(Boolean)
}

// Sampled polyline for a graph segment. Straight lanes are a single vertical line;
// a lane that shifts columns bends with a fixed-radius corner localized to the row
// midpoint (VS Code-style) instead of an S-curve spread across the whole row.
export function historyGraphSegmentPoints(segment: HistoryGraphSegment): Array<{ x: number; y: number }> {
  const fromX = historyGraphX(segment.fromColumn)
  const toX = historyGraphX(segment.toColumn)
  if (fromX === toX) {
    return [
      { x: fromX, y: segment.fromY },
      { x: toX, y: segment.toY }
    ]
  }

  const radius = Math.min(HISTORY_GRAPH_CURVE_RADIUS, (segment.toY - segment.fromY) / 2)
  const midY = (segment.fromY + segment.toY) / 2
  const points = [
    { x: fromX, y: segment.fromY },
    { x: fromX, y: midY - radius }
  ]

  const steps = 14
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps
    const inv = 1 - t
    const x = inv ** 3 * fromX + 3 * inv ** 2 * t * fromX + 3 * inv * t ** 2 * toX + t ** 3 * toX
    const y = inv ** 3 * (midY - radius) + 3 * inv ** 2 * t * midY + 3 * inv * t ** 2 * midY + t ** 3 * (midY + radius)
    points.push({ x, y })
  }

  points.push({ x: toX, y: segment.toY })
  return points
}

// Compute lanes directly from parent relationships (one row per commit, VS Code-style)
// instead of parsing git's ASCII `--graph` output, which fanned lanes wide and inserted
// extra continuation rows.
export function buildHistoryGraphModel(commits: readonly HistoryGraphCommit[], rowHeight: number): HistoryGraphModel {
  return buildHistoryGraphModelFromParents(commits, rowHeight)
}

// Each lane keeps a FIXED column for its whole lifetime (git/GitLens-style), so lanes
// render as straight vertical columns and only bend diagonally at a commit dot. Columns
// freed by a finished lane are reused (leftmost-first) instead of shifting everything left.
function buildHistoryGraphModelFromParents(commits: readonly HistoryGraphCommit[], rowHeight: number): HistoryGraphModel {
  const slots: Array<HistoryGraphLane | null> = []
  const segments: HistoryGraphSegment[] = []
  const nodes: HistoryGraphNode[] = []
  let nextLaneIndex = 0
  let nextSegmentIndex = 0
  let nextSlotId = 0
  let maxColumns = 1

  const addSegment = (fromColumn: number, toColumn: number, fromY: number, toY: number, colorKey: string) => {
    if (toY <= fromY) return
    segments.push({
      id: `segment-${nextSegmentIndex++}`,
      fromColumn,
      toColumn,
      fromY,
      toY,
      colorKey,
      curve: fromColumn !== toColumn
    })
  }

  const createLane = (targetSha: string, trunk: boolean): HistoryGraphLane => ({
    id: `slot-${nextSlotId++}`,
    targetSha,
    colorKey: trunk ? HISTORY_GRAPH_TRUNK_KEY : `lane-${nextLaneIndex++}`
  })

  const firstFreeColumn = (): number => {
    const free = slots.findIndex((slot) => slot === null)
    return free === -1 ? slots.length : free
  }

  const placeLane = (lane: HistoryGraphLane, column: number) => {
    slots[column] = lane
    maxColumns = Math.max(maxColumns, column + 1)
  }

  commits.forEach((commit, index) => {
    const y = index * rowHeight + Math.round(rowHeight / 2)
    const topY = y - rowHeight / 2
    const bottomY = y + rowHeight / 2
    const parentShas = uniqueParentShas(commit)

    // Columns whose lane is heading into this commit (usually one; several when branches converge).
    const incomingColumns: number[] = []
    slots.forEach((slot, column) => {
      if (slot?.targetSha === commit.sha) incomingColumns.push(column)
    })

    let currentColumn: number
    let currentLane: HistoryGraphLane
    if (incomingColumns.length > 0) {
      currentColumn = incomingColumns[0]
      currentLane = slots[currentColumn] as HistoryGraphLane
    } else {
      currentColumn = firstFreeColumn()
      currentLane = createLane(commit.sha, index === 0)
      placeLane(currentLane, currentColumn)
      incomingColumns.push(currentColumn)
    }

    // Lanes unrelated to this commit pass straight through the row in their own column.
    slots.forEach((slot, column) => {
      if (!slot || slot.targetSha === commit.sha) return
      addSegment(column, column, topY, bottomY, slot.colorKey)
    })

    // Incoming lines enter the node from above: the node's own lane straight, converging lanes diagonal.
    for (const column of incomingColumns) {
      const lane = slots[column] as HistoryGraphLane
      addSegment(column, currentColumn, topY, y, lane.colorKey)
      if (column !== currentColumn) slots[column] = null
    }

    nodes.push({
      id: `node-${commit.sha}`,
      sha: commit.sha,
      column: currentColumn,
      y,
      colorKey: currentLane.colorKey,
      merge: parentShas.length > 1
    })

    // The current lane is consumed by the node; route each parent out of the bottom half.
    slots[currentColumn] = null
    parentShas.forEach((parentSha, parentIndex) => {
      const existingColumn = slots.findIndex((slot) => slot?.targetSha === parentSha)
      if (existingColumn !== -1) {
        addSegment(currentColumn, existingColumn, y, bottomY, (slots[existingColumn] as HistoryGraphLane).colorKey)
        return
      }
      if (parentIndex === 0) {
        // First parent keeps the lane in the same column so the trunk stays straight.
        const lane: HistoryGraphLane = { id: currentLane.id, targetSha: parentSha, colorKey: currentLane.colorKey }
        placeLane(lane, currentColumn)
        addSegment(currentColumn, currentColumn, y, bottomY, lane.colorKey)
      } else {
        const column = firstFreeColumn()
        const lane = createLane(parentSha, false)
        placeLane(lane, column)
        addSegment(currentColumn, column, y, bottomY, lane.colorKey)
      }
    })

    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop()
  })

  return { segments, nodes, columnCount: maxColumns }
}

export function maxHistoryGraphColumns(commits: readonly HistoryGraphCommit[]): number {
  return buildHistoryGraphModel(commits, 1).columnCount
}

export function historyGraphWidthForColumns(columnCount: number): number {
  return Math.min(
    HISTORY_GRAPH_MAX_WIDTH,
    Math.max(40, HISTORY_GRAPH_PADDING_X * 2 + Math.max(0, columnCount - 1) * HISTORY_GRAPH_LANE_WIDTH)
  )
}

export function historyGraphWidth(commits: readonly HistoryGraphCommit[]): number {
  return historyGraphWidthForColumns(maxHistoryGraphColumns(commits))
}

export function historyGraphTextStarts(graph: HistoryGraphModel, rowCount: number, rowHeight: number): number[] {
  const rightmostColumns = Array.from({ length: rowCount }, (_, index) => graph.nodes[index]?.column ?? 0)

  graph.segments.forEach((segment) => {
    const fromRow = Math.max(0, Math.floor(segment.fromY / rowHeight))
    const toRow = Math.min(rowCount - 1, Math.floor((segment.toY - 0.001) / rowHeight))
    const segmentRightmostColumn = Math.max(segment.fromColumn, segment.toColumn)

    for (let rowIndex = fromRow; rowIndex <= toRow; rowIndex += 1) {
      rightmostColumns[rowIndex] = Math.max(rightmostColumns[rowIndex], segmentRightmostColumn)
    }
  })

  return rightmostColumns.map((column) => historyGraphX(column) + HISTORY_GRAPH_NODE_RADIUS + HISTORY_GRAPH_TEXT_GUTTER)
}

export function historyGraphTextStartForRow(graph: HistoryGraphModel, rowIndex: number, rowHeight: number): number {
  return historyGraphTextStarts(graph, rowIndex + 1, rowHeight)[rowIndex]
}

export function hitHistoryGraphNode(
  graph: HistoryGraphModel,
  rowHeight: number,
  x: number,
  y: number,
  hoverRadius = HISTORY_GRAPH_HOVER_RADIUS
): HistoryGraphNode | null {
  const rowIndex = Math.floor(y / rowHeight)
  const node = graph.nodes[rowIndex]
  if (!node?.sha) return null

  const nodeX = historyGraphX(node.column)
  if (Math.abs(x - nodeX) > hoverRadius || Math.abs(y - node.y) > hoverRadius) return null
  return node
}
