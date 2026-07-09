import { useEffect, useRef, useState } from 'react'
import type { CodexAgentEvent, CodexAgentResult } from '../../../shared/branchPilot'
import { detectAgentLimit, type QueuedAgentPrompt } from './localAgentSupport'

interface UseAgentQueueOptions {
  codexAgentRunning: boolean
  codexAgentResult: CodexAgentResult | null
  codexAgentError: string | null
  codexAgentLiveEvents: CodexAgentEvent[]
  // Runs one queued prompt: sets the composer text and starts a run with it.
  onRunPrompt: (text: string) => void
}

/**
 * Coordinates a FIFO prompt queue on top of a single-run local agent.
 *
 * A run that finishes (success, stopped, or failed) auto-dequeues the next prompt
 * unless the queue is paused. A usage/token/rate limit detected in the finished
 * run's output pauses the queue with a reason instead of advancing.
 */
export function useAgentQueue({
  codexAgentRunning,
  codexAgentResult,
  codexAgentError,
  codexAgentLiveEvents,
  onRunPrompt
}: UseAgentQueueOptions) {
  const [codexAgentQueue, setCodexAgentQueue] = useState<QueuedAgentPrompt[]>([])
  const [codexAgentQueuePaused, setCodexAgentQueuePaused] = useState(false)
  const [codexAgentQueuePauseReason, setCodexAgentQueuePauseReason] = useState<string | null>(null)

  // Refs mirror the latest state/props so the run-finished effect (keyed only on
  // codexAgentRunning) always reads fresh values without re-subscribing.
  const prevRunningRef = useRef(false)
  const queueRef = useRef(codexAgentQueue)
  const pausedRef = useRef(codexAgentQueuePaused)
  const resultRef = useRef(codexAgentResult)
  const errorRef = useRef(codexAgentError)
  const liveEventsRef = useRef(codexAgentLiveEvents)
  const onRunPromptRef = useRef(onRunPrompt)

  // Mirror the latest state/props into refs after each commit. Declared before
  // the run-finished effect so those values are current when it reads them.
  useEffect(() => {
    queueRef.current = codexAgentQueue
    pausedRef.current = codexAgentQueuePaused
    resultRef.current = codexAgentResult
    errorRef.current = codexAgentError
    liveEventsRef.current = codexAgentLiveEvents
    onRunPromptRef.current = onRunPrompt
  })

  const dequeueAndRun = () => {
    const [next, ...rest] = queueRef.current
    if (!next) return
    setCodexAgentQueue(rest)
    onRunPromptRef.current(next.text)
  }

  const enqueue = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setCodexAgentQueue((current) => [...current, { id: crypto.randomUUID(), text: trimmed }])
  }

  const removeFromQueue = (id: string) => {
    setCodexAgentQueue((current) => current.filter((item) => item.id !== id))
  }

  const clearQueue = () => setCodexAgentQueue([])

  const moveQueueItem = (id: string, direction: 'up' | 'down') => {
    setCodexAgentQueue((current) => {
      const index = current.findIndex((item) => item.id === id)
      if (index === -1) return current
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= current.length) return current
      const next = current.slice()
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  const pauseQueue = () => {
    setCodexAgentQueuePaused(true)
    setCodexAgentQueuePauseReason((current) => current ?? 'Paused manually.')
  }

  const resumeQueue = () => {
    setCodexAgentQueuePaused(false)
    setCodexAgentQueuePauseReason(null)
    // Continue immediately when idle so Resume feels responsive.
    if (!codexAgentRunning && codexAgentQueue.length > 0) {
      dequeueAndRun()
    }
  }

  useEffect(() => {
    const wasRunning = prevRunningRef.current
    prevRunningRef.current = codexAgentRunning
    // Only react on the running -> idle transition (a run just finished).
    if (!wasRunning || codexAgentRunning) return

    const detectionText = [
      resultRef.current?.output ?? '',
      errorRef.current ?? '',
      ...liveEventsRef.current.map((event) => event.text)
    ].join('\n')

    const detection = detectAgentLimit(detectionText)
    if (detection.limited) {
      setCodexAgentQueuePaused(true)
      setCodexAgentQueuePauseReason(detection.reason ?? 'Agent reported a usage or rate limit.')
      return
    }

    if (pausedRef.current || queueRef.current.length === 0) return
    dequeueAndRun()
  }, [codexAgentRunning])

  return {
    codexAgentQueue,
    codexAgentQueueCount: codexAgentQueue.length,
    codexAgentQueuePaused,
    codexAgentQueuePauseReason,
    enqueue,
    removeCodexAgentQueueItem: removeFromQueue,
    clearCodexAgentQueue: clearQueue,
    moveCodexAgentQueueItem: moveQueueItem,
    pauseCodexAgentQueue: pauseQueue,
    resumeCodexAgentQueue: resumeQueue
  }
}
