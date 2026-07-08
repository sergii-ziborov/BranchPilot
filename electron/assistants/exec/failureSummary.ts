import { BranchPilotUserError } from '../../lib/errors.js'

export function assistantHealthErrorMessage(error: unknown): string {
  if (error instanceof BranchPilotUserError) {
    const details = error.details ? summarizeAssistantFailure(error.details) : ''

    return details
      ? `${error.message} ${details}`
      : error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Assistant health check failed.'
}

export function summarizeAssistantFailure(output: string): string {
  const usageSummary = summarizeAssistantUsageLimit(output)

  if (usageSummary) {
    return usageSummary
  }

  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const importantLines = lines.filter((line) =>
    /^ERROR[:\s]/i.test(line) ||
    /auth|login|token|subscription|disabled|invalid_request|invalid_json_schema|quota|rate limit|usage|remaining|resets?/i.test(line)
  )
  const summary = (importantLines.length > 0 ? importantLines : lines.slice(-8)).join('\n')

  return summary.slice(0, 2_000)
}

function summarizeAssistantUsageLimit(output: string): string | undefined {
  const text = normalizeAssistantOutputText(output)

  if (!text) {
    return undefined
  }

  const reset = extractAssistantResetLabel(text)

  if (/session limit/i.test(text)) {
    return assistantLimitSummary("You've hit your session limit", reset)
  }

  if (/usage limit/i.test(text)) {
    return assistantLimitSummary("You've hit your usage limit", reset)
  }

  if (/rate limit/i.test(text)) {
    return assistantLimitSummary('Rate limit reached', reset)
  }

  if (/\bquota\b/i.test(text)) {
    return assistantLimitSummary('Quota limit reached', reset)
  }

  const remaining = /((?:usage\s+(?:remaining|left)|remaining\s+usage)[^.\n]*)/i.exec(text)?.[1]?.trim() ||
    /(\d{1,3}%\s+(?:remaining|left))/i.exec(text)?.[1]?.trim()

  return remaining || undefined
}

function assistantLimitSummary(message: string, reset?: string): string {
  return reset ? `${message} - resets ${reset}` : message
}

function normalizeAssistantOutputText(output: string): string {
  return output
    .replaceAll('\\n', '\n')
    .replaceAll('\\"', '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAssistantResetLabel(text: string): string | undefined {
  const value =
    extractResetValue(text, /resets?\s+(?:at\s+)?(?<value>\d{4}-\d{2}-\d{2}[T\s][\d:.+-]+Z?)/i) ||
    extractResetValue(text, /(?:try again|retry|available again)\s+(?:at|after)\s+(?<value>\d{4}-\d{2}-\d{2}[T\s][\d:.+-]+Z?)/i) ||
    extractResetValue(text, /resets?\s+(?:at\s+)?(?<value>\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*\([^)]*\))?)/i) ||
    extractResetValue(text, /(?:try again|retry|available again)\s+(?:at|after)\s+(?<value>\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*\([^)]*\))?)/i) ||
    extractResetValue(text, /resets?\s+(?:at\s+)?(?<value>[^.\n]+)/i)

  return value ? normalizeAssistantResetValue(value) : undefined
}

function extractResetValue(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.groups?.value
}

function normalizeAssistantResetValue(value: string): string {
  const clean = value
    .trim()
    .replace(/^["'`]+|["'`)]+$/g, '')
    .replace(/[.,;:]+$/g, '')
    .trim()
  const timeZone = localTimeZoneLabel()

  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const timestamp = Date.parse(clean)

    if (!Number.isNaN(timestamp)) {
      const formatted = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(timeZone ? { timeZone } : {})
      }).format(new Date(timestamp))

      return timeZone ? `${formatted} (${timeZone})` : formatted
    }
  }

  if (/\b(?:am|pm)\b/i.test(clean) && !/\([^)]*\)\s*$/.test(clean) && timeZone) {
    return `${clean} (${timeZone})`
  }

  return clean
}

function localTimeZoneLabel(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}
