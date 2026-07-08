import { describe, expect, it } from 'vitest'
import {
  createLineStream,
  extractClaudeFinalResult,
  parseClaudeLiveEvent,
  parseClaudeStreamEvents,
  parseCodexAgentEvents,
  parseCodexLiveEvent
} from '../electron/assistants/exec/agentEventParsing'

function claudeStreamLine(delta: Record<string, unknown>): string {
  return JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta } })
}

describe('createLineStream', () => {
  it('emits complete lines across chunk boundaries', () => {
    const lines: string[] = []
    const stream = createLineStream((line) => lines.push(line))

    stream.push('{"a":')
    stream.push('1}\n{"b":2}\n{"c"')
    stream.push(':3}')

    expect(lines).toEqual(['{"a":1}', '{"b":2}'])

    stream.flush()

    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })

  it('ignores trailing whitespace-only buffers on flush', () => {
    const lines: string[] = []
    const stream = createLineStream((line) => lines.push(line))

    stream.push('one\n  ')
    stream.flush()

    expect(lines).toEqual(['one'])
  })
})

describe('parseClaudeLiveEvent', () => {
  it('extracts thinking deltas', () => {
    const event = parseClaudeLiveEvent(claudeStreamLine({ type: 'thinking_delta', thinking: 'pondering the diff' }))

    expect(event).toEqual({ type: 'thinking', text: 'pondering the diff' })
  })

  it('extracts text deltas', () => {
    const event = parseClaudeLiveEvent(claudeStreamLine({ type: 'text_delta', text: 'Hello' }))

    expect(event).toEqual({ type: 'text', text: 'Hello' })
  })

  it('skips non-delta stream events', () => {
    const line = JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } })

    expect(parseClaudeLiveEvent(line)).toBeNull()
  })

  it('reports tool use from assistant messages and skips their text', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'already streamed as deltas' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/app.ts' } }
        ]
      }
    })
    const event = parseClaudeLiveEvent(line)

    expect(event?.type).toBe('tool')
    expect(event?.text).toContain('Read')
    expect(event?.text).toContain('src/app.ts')
    expect(event?.text).not.toContain('already streamed')
  })

  it('returns null for assistant messages without tool use', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'plain' }] } })

    expect(parseClaudeLiveEvent(line)).toBeNull()
  })

  it('extracts the final result', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', result: 'All done.' })

    expect(parseClaudeLiveEvent(line)).toEqual({ type: 'result', text: 'All done.' })
  })

  it('passes through non-JSON lines as stdout', () => {
    expect(parseClaudeLiveEvent('plain warning text')).toEqual({ type: 'stdout', text: 'plain warning text' })
  })

  it('ignores blank lines', () => {
    expect(parseClaudeLiveEvent('   ')).toBeNull()
  })
})

describe('extractClaudeFinalResult', () => {
  it('returns the result payload of the last result line', () => {
    const log = [
      claudeStreamLine({ type: 'text_delta', text: 'partial' }),
      JSON.stringify({ type: 'result', result: 'first' }),
      JSON.stringify({ type: 'result', result: 'final answer' })
    ].join('\n')

    expect(extractClaudeFinalResult(log)).toBe('final answer')
  })

  it('returns an empty string when no result line exists', () => {
    expect(extractClaudeFinalResult(claudeStreamLine({ type: 'text_delta', text: 'x' }))).toBe('')
  })
})

describe('parseClaudeStreamEvents', () => {
  it('keeps whole messages and drops stream deltas', () => {
    const log = [
      claudeStreamLine({ type: 'text_delta', text: 'H' }),
      claudeStreamLine({ type: 'text_delta', text: 'i' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }),
      JSON.stringify({ type: 'result', result: 'Hi' })
    ].join('\n')
    const events = parseClaudeStreamEvents(log)

    expect(events.map((event) => event.type)).toEqual(['assistant', 'result'])
    expect(events[0].text).toBe('Hi')
  })
})

describe('codex event parsing', () => {
  it('extracts text from item payloads', () => {
    const event = parseCodexLiveEvent(JSON.stringify({ type: 'item.completed', item: { text: 'ran a command' } }))

    expect(event).toEqual({ type: 'item.completed', text: 'ran a command' })
  })

  it('caps the final event list at 120 entries', () => {
    const log = Array.from({ length: 150 }, (_, index) => JSON.stringify({ type: 'event', text: `entry ${index}` })).join('\n')
    const events = parseCodexAgentEvents(log)

    expect(events).toHaveLength(120)
    expect(events[0].text).toBe('entry 30')
    expect(events[119].text).toBe('entry 149')
  })
})
