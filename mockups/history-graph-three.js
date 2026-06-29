import * as THREE from '../node_modules/three/build/three.module.js'

const ROW_HEIGHT = 34
const GRAPH_WIDTH = 132
const GRAPH_PADDING_X = 18
const LANE_GAP = 12
const LINE_WIDTH = 2
const NODE_RADIUS = 3.8
const COLORS = {
  trunk: '#ffb000',
  lanes: ['#58a6ff', '#ff4da6', '#27e89a', '#a371f7', '#4dd0e1', '#ff7a59', '#b8f566', '#d2a8ff'],
  nodeRing: '#111827',
  nodeHalo: '#8b949e'
}

const stage = document.getElementById('stage')
const layer = document.getElementById('graph-layer')
const rowsElement = document.getElementById('rows')
const statusElement = document.getElementById('status')

function rowY(index) {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2
}

function laneX(column) {
  return GRAPH_PADDING_X + (column / 2) * LANE_GAP
}

function graphColor(key) {
  if (/^#[0-9a-f]{6}$/iu.test(String(key))) return key
  if (key === 'trunk') return COLORS.trunk
  const match = /^lane-(\d+)$/u.exec(key || '')
  const index = match ? Number(match[1]) : 0
  return COLORS.lanes[index % COLORS.lanes.length]
}

function uniqueParents(commit) {
  return [...new Set(commit.parentShas || [])].filter(Boolean)
}

function buildRows(commits) {
  const graphRows = []
  commits.forEach((commit, index) => {
    const y = rowY(index)
    const nextY = index < commits.length - 1 ? rowY(index + 1) : y + ROW_HEIGHT
    graphRows.push({
      text: (commit.graphPrefix || '*').replace(/\s+$/u, '') || '*',
      tokens: commit.graphPrefixTokens || [],
      y,
      commit
    })

    const afterLines = commit.graphAfter || []
    afterLines.forEach((line, lineIndex) => {
      const t = (lineIndex + 1) / (afterLines.length + 1)
      graphRows.push({
        text: line.replace(/\s+$/u, ''),
        tokens: commit.graphAfterTokens?.[lineIndex] || [],
        y: y + (nextY - y) * t,
        commit: null
      })
    })
  })
  return graphRows
}

function previousLaneColumn(column) {
  return Math.max(0, column - (column % 2 === 0 ? 2 : 1))
}

function nextLaneColumn(column) {
  return column + (column % 2 === 0 ? 2 : 1)
}

function isMergeNode(row, column) {
  return Boolean(row?.commit && row.text[column] === '*' && uniqueParents(row.commit).length > 1)
}

function slashEndpoints(token) {
  if (token.ch === '\\') {
    return token.column % 2 === 0
      ? { fromColumn: Math.max(0, token.column - 2), toColumn: token.column }
      : { fromColumn: Math.max(0, token.column - 1), toColumn: token.column + 1 }
  }

  if (token.ch === '/') {
    return token.column % 2 === 0
      ? { fromColumn: token.column, toColumn: Math.max(0, token.column - 2) }
      : { fromColumn: token.column + 1, toColumn: Math.max(0, token.column - 1) }
  }

  return token.column % 2 === 0
    ? { fromColumn: token.column, toColumn: token.column + 2 }
    : { fromColumn: Math.max(0, token.column - 1), toColumn: token.column + 1 }
}

function buildGraph(commits) {
  const graphRows = buildRows(commits)
  const segments = []
  const nodes = []
  const fallbackColumnColors = new Map([[0, 'trunk']])

  function addSegment(fromColumn, toColumn, fromY, toY, colorKey, shape = 'line') {
    if (toY <= fromY) return
    segments.push({ fromColumn, toColumn, fromY, toY, colorKey, shape })
  }

  function tokenColor(token) {
    if (token.color) {
      fallbackColumnColors.set(token.column, token.color)
      return token.color
    }

    if (!fallbackColumnColors.has(token.column)) {
      fallbackColumnColors.set(token.column, token.column === 0 ? 'trunk' : `lane-${Math.max(0, Math.floor(token.column / 2) - 1)}`)
    }

    return fallbackColumnColors.get(token.column)
  }

  graphRows.forEach((row, rowIndex) => {
    const previousRow = graphRows[rowIndex - 1]
    const nextRow = graphRows[rowIndex + 1]
    const topY = previousRow ? row.y - (row.y - previousRow.y) / 2 : Math.max(0, row.y - ROW_HEIGHT / 2)
    const bottomY = nextRow ? row.y + (nextRow.y - row.y) / 2 : row.y + ROW_HEIGHT / 2

    for (const token of row.tokens) {
      const char = token.ch
      const colorKey = tokenColor(token)

      if (char === '|' || char === '*') {
        addSegment(token.column, token.column, topY, bottomY, colorKey)

        if (char === '*') {
          nodes.push({
            column: token.column,
            y: row.y,
            colorKey,
            merge: row.commit ? uniqueParents(row.commit).length > 1 : false
          })
        }
        continue
      }

      if (char === '\\') {
        const { fromColumn, toColumn } = slashEndpoints(token)
        addSegment(fromColumn, toColumn, topY, bottomY, colorKey, 'curve')
        fallbackColumnColors.set(toColumn, colorKey)
        continue
      }

      if (char === '/') {
        const { fromColumn, toColumn } = slashEndpoints(token)
        addSegment(fromColumn, toColumn, topY, bottomY, colorKey, 'curve')
        fallbackColumnColors.set(toColumn, colorKey)
        continue
      }

      if (char === '_' || char === '-') {
        const { fromColumn, toColumn } = slashEndpoints(token)
        addSegment(fromColumn, toColumn, row.y, row.y + 0.01, colorKey, 'line')
        fallbackColumnColors.set(toColumn, colorKey)
      }
    }
  })

  return { segments, nodes, graphRows }
}

function makePolylineMesh(points, width, color, z = 0) {
  const positions = []
  const indices = []
  const half = width / 2

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy) || 1
    const nx = (-dy / length) * half
    const ny = (dx / length) * half
    positions.push(point.x - nx, point.y - ny, z, point.x + nx, point.y + ny, z)
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const base = index * 2
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.98, side: THREE.DoubleSide }))
}

function curvePoints(fromX, fromY, toX, toY) {
  if (Math.abs(fromX - toX) < 0.1) return [{ x: fromX, y: fromY }, { x: toX, y: toY }]

  const midY = fromY + (toY - fromY) * 0.5
  const curve = new THREE.CubicBezierCurve(
    new THREE.Vector2(fromX, fromY),
    new THREE.Vector2(fromX, midY),
    new THREE.Vector2(toX, midY),
    new THREE.Vector2(toX, toY)
  )
  return curve.getPoints(18).map((point) => ({ x: point.x, y: point.y }))
}

function addCircle(scene, x, y, radius, color, z = 2) {
  const geometry = new THREE.CircleGeometry(radius, 28)
  const material = new THREE.MeshBasicMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  scene.add(mesh)
}

function renderGraph(commits) {
  const totalHeight = Math.max(ROW_HEIGHT, commits.length * ROW_HEIGHT)
  document.documentElement.style.setProperty('--graph-width', `${GRAPH_WIDTH}px`)
  stage.style.height = `${Math.min(window.innerHeight - 90, totalHeight)}px`
  rowsElement.style.height = `${totalHeight}px`
  layer.style.height = `${totalHeight}px`

  rowsElement.replaceChildren(...commits.map((commit, index) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `row${index === 0 ? ' selected' : ''}`
    row.style.border = '0'
    row.style.width = '100%'
    row.style.padding = '0'
    row.style.margin = '0'
    row.style.color = 'inherit'
    row.style.background = index === 0 ? 'var(--selected)' : 'transparent'
    row.style.textAlign = 'left'
    row.innerHTML = `
      <span></span>
      <span class="row-text">
        <span class="subject">${escapeHtml(commit.subject)}</span>
        <span class="meta">${escapeHtml(commit.shortSha)} · ${escapeHtml(commit.authorName)} · ${new Date(commit.date).toLocaleString()}</span>
      </span>
    `
    return row
  }))

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(0, GRAPH_WIDTH, totalHeight, 0, -100, 100)
  camera.position.z = 10
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(GRAPH_WIDTH, totalHeight, false)
  layer.replaceChildren(renderer.domElement)

  const graph = buildGraph(commits)
  graph.segments.forEach((segment) => {
    const fromX = laneX(segment.fromColumn)
    const toX = laneX(segment.toColumn)
    const points = segment.shape === 'curve'
      ? curvePoints(fromX, segment.fromY, toX, segment.toY)
      : [{ x: fromX, y: segment.fromY }, { x: toX, y: segment.toY }]
    scene.add(makePolylineMesh(points, LINE_WIDTH, graphColor(segment.colorKey), 0))
  })

  graph.nodes.forEach((node) => {
    const x = laneX(node.column)
    addCircle(scene, x, node.y, NODE_RADIUS + 2.2, COLORS.nodeRing, 3)
    addCircle(scene, x, node.y, NODE_RADIUS + 1.2, '#0d1117', 4)
    addCircle(scene, x, node.y, NODE_RADIUS, graphColor(node.colorKey), 5)
    if (node.merge) addCircle(scene, x, node.y, NODE_RADIUS - 2.1, '#0d1117', 6)
  })

  renderer.render(scene, camera)
  statusElement.textContent = `${commits.length} commits · ${graph.segments.length} graph segments · ${graph.nodes.length} nodes`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

fetch('./history-graph-sample.json')
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  .then((data) => renderGraph(data.commits || []))
  .catch((error) => {
    statusElement.textContent = `Could not load sample: ${error.message}`
    rowsElement.innerHTML = '<div class="empty">Run node mockups/export-history-graph-sample.cjs first, then serve this folder over HTTP.</div>'
  })
