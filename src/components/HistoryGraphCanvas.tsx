import { useEffect, useRef, type CSSProperties } from 'react'
import { drawHistoryGraph, type HistoryGraphCommit } from '../lib/historyGraph'

interface HistoryGraphCanvasProps {
  commits: readonly HistoryGraphCommit[]
  width: number
  rowHeight: number
  totalHeight: number
}

export function HistoryGraphCanvas({
  commits,
  width,
  rowHeight,
  totalHeight
}: HistoryGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const height = Math.max(totalHeight, rowHeight)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawHistoryGraph(canvas, commits, width, rowHeight, height)
  }, [commits, height, rowHeight, width])

  if (commits.length === 0) {
    return <span className="history-graph-canvas" style={{ '--history-graph-width': `${width}px`, height } as CSSProperties} aria-hidden="true" />
  }

  return (
    <canvas
      ref={canvasRef}
      className="history-graph-canvas"
      style={{ '--history-graph-width': `${width}px`, height } as CSSProperties}
      aria-hidden="true"
    />
  )
}
