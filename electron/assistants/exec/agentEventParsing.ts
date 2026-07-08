import type { CodexAgentEvent } from '../../../src/shared/branchPilot.js'

const MAX_EVENT_TEXT_CHARS = 4_000

/**
 * Buffers stdout chunks and emits complete NDJSON lines as they arrive,
 * so agent CLIs can be parsed live instead of after process exit.
 */
export function createLineStream(onLine: (line: string) => void): { push: (chunk: string) => void; flush: () => void } {
  let buffer = ''

  return {
    push(chunk: string) {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')

      while (newlineIndex !== -1) {
        onLine(buffer.slice(0, newlineIndex))
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
      }
    },
    flush() {
      if (buffer.trim()) {
        onLine(buffer)
      }

      buffer = ''
    }
  }
}

export function parseCodexAgentEvents(eventLog: string): CodexAgentEvent[] {
  const events: CodexAgentEvent[] = []

  for (const line of eventLog.split('\n')) {
    const event = parseCodexLiveEvent(line)

    if (event) {
      events.push(event)
    }
  }

  return events.slice(-120)
}

export function parseCodexLiveEvent(line: string): CodexAgentEvent | null {
  const trimmed = line.trim()

  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const type = String(parsed.type ?? parsed.event ?? parsed.kind ?? 'event')
    const text = extractCodexEventText(parsed)

    return text ? { type, text: text.slice(0, MAX_EVENT_TEXT_CHARS) } : null
  } catch {
    return { type: 'stdout', text: trimmed.slice(0, MAX_EVENT_TEXT_CHARS) }
  }
}

export function extractCodexEventText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  const direct = record.text ?? record.delta ?? record.summary ?? record.output ?? record.result

  if (typeof direct === 'string') return direct.trim()

  if (record.message && typeof record.message === 'object') {
    return extractCodexEventText(record.message)
  }

  if (Array.isArray(record.content)) {
    return record.content.map(extractCodexEventText).filter(Boolean).join('\n').trim()
  }

  if (record.item && typeof record.item === 'object') {
    return extractCodexEventText(record.item)
  }

  if (record.msg && typeof record.msg === 'object') {
    return extractCodexEventText(record.msg)
  }

  if (String(record.type ?? '').toLowerCase().includes('error')) {
    return JSON.stringify(record)
  }

  return ''
}

export function parseClaudeStreamEvents(eventLog: string): CodexAgentEvent[] {
  const events: CodexAgentEvent[] = []

  for (const line of eventLog.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>

      // stream_event deltas are live-feed noise; the final list keeps whole messages only.
      if (parsed.type === 'stream_event') continue

      const text = extractClaudeStreamText(parsed)

      if (text) events.push({ type: String(parsed.type ?? 'event'), text })
    } catch {
      events.push({ type: 'stdout', text: trimmed })
    }
  }

  return events
}

/**
 * Live view of a Claude Code stream-json line: thinking/text deltas as they
 * are generated, tool invocations, and the final result. Whole-message
 * "assistant" lines are skipped because their text already streamed as deltas.
 */
export function parseClaudeLiveEvent(line: string): CodexAgentEvent | null {
  const trimmed = line.trim()

  if (!trimmed) return null

  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return { type: 'stdout', text: trimmed.slice(0, MAX_EVENT_TEXT_CHARS) }
  }

  if (parsed.type === 'stream_event') {
    const streamEvent = asRecord(parsed.event)
    const delta = asRecord(streamEvent?.delta)

    if (typeof delta?.thinking === 'string' && delta.thinking) {
      return { type: 'thinking', text: delta.thinking }
    }

    if (typeof delta?.text === 'string' && delta.text) {
      return { type: 'text', text: delta.text }
    }

    return null
  }

  if (parsed.type === 'assistant') {
    const toolUses = collectClaudeToolUses(parsed)

    return toolUses ? { type: 'tool', text: toolUses } : null
  }

  if (parsed.type === 'result') {
    const text = typeof parsed.result === 'string' ? parsed.result : extractClaudeStreamText(parsed)

    return text ? { type: 'result', text: text.slice(0, MAX_EVENT_TEXT_CHARS) } : null
  }

  return null
}

export function extractClaudeFinalResult(eventLog: string): string {
  for (const line of eventLog.split('\n').reverse()) {
    const trimmed = line.trim()

    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>

      if (parsed.type === 'result' && typeof parsed.result === 'string') {
        return parsed.result.trim()
      }
    } catch {
      continue
    }
  }

  return ''
}

export function extractClaudeStreamText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  const direct = record.text ?? record.result ?? record.summary

  if (typeof direct === 'string') return direct.trim()

  if (record.message && typeof record.message === 'object') {
    return extractClaudeStreamText(record.message)
  }

  if (Array.isArray(record.content)) {
    return record.content.map(extractClaudeStreamText).filter(Boolean).join('\n').trim()
  }

  return ''
}

function collectClaudeToolUses(parsed: Record<string, unknown>): string {
  const message = asRecord(parsed.message)
  const content = Array.isArray(message?.content) ? message.content : []

  return content
    .map((block) => {
      const record = asRecord(block)

      if (record?.type !== 'tool_use') return ''

      const name = typeof record.name === 'string' ? record.name : 'tool'
      const input = record.input ? JSON.stringify(record.input).slice(0, 200) : ''

      return input ? `${name} ${input}` : name
    })
    .filter(Boolean)
    .join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
