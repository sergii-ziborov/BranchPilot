import {
  HISTORY_GRAPH_BRANCH_COLORS,
  HISTORY_GRAPH_LINE_WIDTH,
  HISTORY_GRAPH_NODE_RADIUS,
  HISTORY_GRAPH_TRUNK_KEY,
  buildHistoryGraphModel,
  historyGraphSegmentPoints,
  historyGraphX,
  type HistoryGraphCommit,
  type HistoryGraphModel,
  type HistoryGraphSegment
} from './model'

interface GraphRgba {
  r: number
  g: number
  b: number
  a: number
}

interface HistoryGraphWebGlState {
  gl: WebGLRenderingContext
  program: WebGLProgram
  buffer: WebGLBuffer
  positionLocation: number
  colorLocation: number
  resolutionLocation: WebGLUniformLocation
}

export interface HistoryGraphRenderColors {
  surface?: string
  panel?: string
  nodeRing?: string
  trunk?: string
  lanes?: readonly string[]
}

export interface HistoryGraphRenderOptions {
  colors?: HistoryGraphRenderColors
  pixelRatio?: number
}

interface HistoryGraphColorContext {
  colors?: HistoryGraphRenderColors
  element?: HTMLElement | null
}

const historyGraphWebGlStates = new WeakMap<HTMLCanvasElement, HistoryGraphWebGlState>()
let graphColorParserContext: CanvasRenderingContext2D | null | undefined

function paletteLaneColor(colors: HistoryGraphRenderColors | undefined, index: number): string | undefined {
  return colors?.lanes?.length ? colors.lanes[index % colors.lanes.length] : undefined
}

function historyGraphColor(key: string | undefined, fallbackIndex = 0, context: HistoryGraphColorContext = {}): string {
  if (/^#[0-9a-f]{6}$/i.test(key ?? '')) return key as string

  const { colors, element } = context
  const cssValue = (name: string, fallback: string) => {
    if (!element) return fallback
    return getComputedStyle(element).getPropertyValue(name).trim() || fallback
  }

  if (key === HISTORY_GRAPH_TRUNK_KEY) {
    return colors?.trunk ?? (element ? cssValue('--history-graph-trunk', '#ffb000') : 'var(--history-graph-trunk, #ffb000)')
  }

  const laneMatch = key?.match(/^lane-(\d+)$/)
  if (laneMatch) {
    const laneColorIndex = Number(laneMatch[1]) % HISTORY_GRAPH_BRANCH_COLORS.length
    const fallback = paletteLaneColor(colors, laneColorIndex) ?? HISTORY_GRAPH_BRANCH_COLORS[laneColorIndex]
    return element
      ? cssValue(`--history-graph-lane-${laneColorIndex + 1}`, fallback)
      : fallback
  }

  const fallbackColorIndex = fallbackIndex % HISTORY_GRAPH_BRANCH_COLORS.length
  const fallback = paletteLaneColor(colors, fallbackColorIndex) ?? HISTORY_GRAPH_BRANCH_COLORS[fallbackColorIndex]
  return element
    ? cssValue(`--history-graph-lane-${fallbackColorIndex + 1}`, fallback)
    : fallback
}

function getGraphColorParserContext(): CanvasRenderingContext2D | null {
  if (graphColorParserContext !== undefined) return graphColorParserContext
  if (typeof document === 'undefined') {
    graphColorParserContext = null
    return graphColorParserContext
  }

  graphColorParserContext = document.createElement('canvas').getContext('2d')
  return graphColorParserContext
}

function parseGraphColor(value: string, alpha = 1): GraphRgba {
  const colorContext = getGraphColorParserContext()
  const normalizedInput = value.trim() || '#000'
  const normalized = (() => {
    if (!colorContext) return normalizedInput
    colorContext.fillStyle = '#000000'
    colorContext.fillStyle = normalizedInput
    return String(colorContext.fillStyle)
  })()

  const rgbaMatch = /^rgba?\(([^)]+)\)$/i.exec(normalized)
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((part) => part.trim())
    return {
      r: Number(parts[0]) / 255,
      g: Number(parts[1]) / 255,
      b: Number(parts[2]) / 255,
      a: parts[3] === undefined ? alpha : Number(parts[3]) * alpha
    }
  }

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized)
  if (hexMatch) {
    const raw = hexMatch[1]
    const hex = raw.length === 3 ? raw.split('').map((char) => `${char}${char}`).join('') : raw
    return {
      r: Number.parseInt(hex.slice(0, 2), 16) / 255,
      g: Number.parseInt(hex.slice(2, 4), 16) / 255,
      b: Number.parseInt(hex.slice(4, 6), 16) / 255,
      a: alpha
    }
  }

  return { r: 0, g: 0, b: 0, a: alpha }
}

function pushGraphVertex(vertices: number[], x: number, y: number, color: GraphRgba) {
  vertices.push(x, y, color.r, color.g, color.b, color.a)
}

function appendGraphLine(vertices: number[], fromX: number, fromY: number, toX: number, toY: number, width: number, color: GraphRgba) {
  const dx = toX - fromX
  const dy = toY - fromY
  const length = Math.hypot(dx, dy)
  if (length < 0.01) return

  const normalX = (-dy / length) * (width / 2)
  const normalY = (dx / length) * (width / 2)
  pushGraphVertex(vertices, fromX - normalX, fromY - normalY, color)
  pushGraphVertex(vertices, fromX + normalX, fromY + normalY, color)
  pushGraphVertex(vertices, toX + normalX, toY + normalY, color)
  pushGraphVertex(vertices, fromX - normalX, fromY - normalY, color)
  pushGraphVertex(vertices, toX + normalX, toY + normalY, color)
  pushGraphVertex(vertices, toX - normalX, toY - normalY, color)
}

function appendGraphCircle(vertices: number[], x: number, y: number, radius: number, color: GraphRgba, steps = 22) {
  for (let index = 0; index < steps; index += 1) {
    const startAngle = (index / steps) * Math.PI * 2
    const endAngle = ((index + 1) / steps) * Math.PI * 2
    pushGraphVertex(vertices, x, y, color)
    pushGraphVertex(vertices, x + Math.cos(startAngle) * radius, y + Math.sin(startAngle) * radius, color)
    pushGraphVertex(vertices, x + Math.cos(endAngle) * radius, y + Math.sin(endAngle) * radius, color)
  }
}

function compileHistoryGraphShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function getHistoryGraphWebGlState(canvas: HTMLCanvasElement): HistoryGraphWebGlState | null {
  const existing = historyGraphWebGlStates.get(canvas)
  if (existing) return existing

  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false
  })
  if (!gl) return null

  const vertexShader = compileHistoryGraphShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 a_position;
      attribute vec4 a_color;
      uniform vec2 u_resolution;
      varying vec4 v_color;

      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        v_color = a_color;
      }
    `
  )
  const fragmentShader = compileHistoryGraphShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying vec4 v_color;

      void main() {
        gl_FragColor = v_color;
      }
    `
  )
  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  if (!program || !buffer) return null

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    return null
  }

  const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
  if (!resolutionLocation) {
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    return null
  }

  const state = {
    gl,
    program,
    buffer,
    positionLocation: gl.getAttribLocation(program, 'a_position'),
    colorLocation: gl.getAttribLocation(program, 'a_color'),
    resolutionLocation
  }
  if (state.positionLocation < 0 || state.colorLocation < 0) return null
  historyGraphWebGlStates.set(canvas, state)
  return state
}

function appendHistoryGraphSegment(vertices: number[], segment: HistoryGraphSegment, color: GraphRgba) {
  const points = historyGraphSegmentPoints(segment)
  for (let index = 0; index < points.length - 1; index += 1) {
    appendGraphLine(vertices, points[index].x, points[index].y, points[index + 1].x, points[index + 1].y, HISTORY_GRAPH_LINE_WIDTH, color)
  }
}

function drawHistoryGraph2d(
  canvas: HTMLCanvasElement,
  graph: HistoryGraphModel,
  width: number,
  height: number,
  surface: string,
  panel: string,
  ring: string,
  colors?: HistoryGraphRenderColors
) {
  const context = canvas.getContext('2d')
  if (!context) return

  context.clearRect(0, 0, width, height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = HISTORY_GRAPH_LINE_WIDTH

  graph.segments.forEach((segment) => {
    const color = historyGraphColor(segment.colorKey, 0, { colors, element: canvas })
    const points = historyGraphSegmentPoints(segment)
    context.globalAlpha = 0.96
    context.strokeStyle = color
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y)
    }
    context.stroke()
  })

  context.globalAlpha = 1
  graph.nodes.forEach((node) => {
    const x = historyGraphX(node.column)
    const color = historyGraphColor(node.colorKey, 0, { colors, element: canvas })
    const radius = node.junction ? HISTORY_GRAPH_NODE_RADIUS - 0.9 : HISTORY_GRAPH_NODE_RADIUS

    if (node.junction) {
      context.fillStyle = surface
      context.strokeStyle = color
      context.lineWidth = 1.7
      context.beginPath()
      context.arc(x, node.y, radius + 0.6, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      return
    }

    context.fillStyle = surface
    context.strokeStyle = ring
    context.lineWidth = 0.8
    context.beginPath()
    context.arc(x, node.y, radius + 1.4, 0, Math.PI * 2)
    context.fill()
    context.stroke()

    context.fillStyle = color
    context.strokeStyle = surface
    context.lineWidth = 2.2
    context.beginPath()
    context.arc(x, node.y, radius, 0, Math.PI * 2)
    context.fill()
    context.stroke()

    if (node.merge) {
      context.fillStyle = panel
      context.beginPath()
      context.arc(x, node.y, 1.9, 0, Math.PI * 2)
      context.fill()
    }
  })
}

export function drawHistoryGraph(
  canvas: HTMLCanvasElement,
  commits: readonly HistoryGraphCommit[],
  width: number,
  rowHeight: number,
  totalHeight: number,
  options: HistoryGraphRenderOptions = {}
) {
  const height = Math.max(totalHeight, rowHeight)
  const pixelRatio = options.pixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  canvas.width = Math.ceil(width * pixelRatio)
  canvas.height = Math.ceil(height * pixelRatio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const graph = buildHistoryGraphModel(commits, rowHeight)
  const styles = options.colors ? null : getComputedStyle(canvas)
  const cssRenderValue = (name: string) => styles?.getPropertyValue(name).trim() || undefined
  const surface = options.colors?.surface ?? cssRenderValue('--surface') ?? cssRenderValue('--panel') ?? '#fff'
  const panel = options.colors?.panel ?? cssRenderValue('--panel') ?? surface
  const ring = options.colors?.nodeRing ?? cssRenderValue('--history-graph-node-ring') ?? 'rgba(127,127,127,0.3)'
  const state = getHistoryGraphWebGlState(canvas)
  if (!state) {
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    drawHistoryGraph2d(canvas, graph, width, height, surface, panel, ring, options.colors)
    return
  }

  const { gl } = state
  const webGlVertices: number[] = []
  graph.segments.forEach((segment) => {
    appendHistoryGraphSegment(
      webGlVertices,
      segment,
      parseGraphColor(historyGraphColor(segment.colorKey, 0, { colors: options.colors, element: canvas }), 0.96)
    )
  })

  const webGlSurface = parseGraphColor(surface)
  const webGlRing = parseGraphColor(ring)
  const webGlPanel = parseGraphColor(panel)
  graph.nodes.forEach((node) => {
    const x = historyGraphX(node.column)
    const nodeColor = parseGraphColor(historyGraphColor(node.colorKey, 0, { colors: options.colors, element: canvas }))
    const radius = node.junction ? HISTORY_GRAPH_NODE_RADIUS - 0.9 : HISTORY_GRAPH_NODE_RADIUS

    if (node.junction) {
      appendGraphCircle(webGlVertices, x, node.y, radius + 1.1, nodeColor, 18)
      appendGraphCircle(webGlVertices, x, node.y, radius - 0.2, webGlSurface, 18)
      return
    }

    appendGraphCircle(webGlVertices, x, node.y, radius + 2, webGlRing)
    appendGraphCircle(webGlVertices, x, node.y, radius + 1.2, webGlSurface)
    appendGraphCircle(webGlVertices, x, node.y, radius, nodeColor)

    if (node.merge) {
      appendGraphCircle(webGlVertices, x, node.y, 1.9, webGlPanel, 14)
    }
  })

  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.useProgram(state.program)
  gl.uniform2f(state.resolutionLocation, width, height)
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(webGlVertices), gl.STREAM_DRAW)
  gl.enableVertexAttribArray(state.positionLocation)
  gl.enableVertexAttribArray(state.colorLocation)
  gl.vertexAttribPointer(state.positionLocation, 2, gl.FLOAT, false, 24, 0)
  gl.vertexAttribPointer(state.colorLocation, 4, gl.FLOAT, false, 24, 8)
  gl.drawArrays(gl.TRIANGLES, 0, webGlVertices.length / 6)
}
