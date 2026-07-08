import type { AssistantId, AssistantStatus, BranchPilotError, CodexAgentEvent, CodexAgentReasoning, CodexAgentSandbox } from '../../../shared/branchPilot'
import { friendlyIpcErrorMessage } from '../../../lib/ipcErrorMessage'
import { CLAUDE_MODEL_OPTIONS, CODEX_MODEL_OPTIONS, assistantStatusLabel } from '../../../lib/assistantLabels'

export const CODEX_AGENT_ATTACHMENT_LIMIT = 8
export const CODEX_AGENT_TEXT_ATTACHMENT_MAX_CHARS = 80_000
const TEXT_ATTACHMENT_FILE_RE = /\.(txt|md|mdx|json|jsonc|ya?ml|toml|ini|env|css|scss|sass|less|html?|xml|svg|csv|tsv|log|diff|patch|m?[jt]sx?|cts|mts|py|go|rs|java|cs|c|cc|cpp|h|hpp|php|rb|swift|kt|kts|vue|svelte|sql|sh|bash|ps1|bat|cmd)$/i

export interface CodexAgentAttachmentDraft {
  id: string
  kind: 'image' | 'text'
  name: string
  mimeType: string
  sizeBytes: number
  dataUrl?: string
  text?: string
  truncated?: boolean
}

export interface LocalAgentCommandContext {
  agentLabel: string
  modelLabel: string
  reasoning: CodexAgentReasoning
  access: CodexAgentSandbox
  filePath?: string
}

export interface LocalAgentCommand {
  id: string
  label: string
  detail: string
  insert: (context: LocalAgentCommandContext) => string
}

export type LocalAgentProvider = 'codex' | 'claude'

export const CODEX_AGENT_REASONING_OPTIONS: Array<{ value: CodexAgentReasoning; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'extra-high', label: 'Extra High' }
]

export const CODEX_AGENT_SANDBOX_OPTIONS: Array<{ value: CodexAgentSandbox; label: string }> = [
  { value: 'read-only', label: 'Read only' },
  { value: 'workspace-write', label: 'Work locally' },
  { value: 'danger-full-access', label: 'Full access' }
]

export const LOCAL_AGENT_PROVIDERS: Array<{ value: LocalAgentProvider; label: string }> = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude' }
]

export const LOCAL_AGENT_COMMANDS: LocalAgentCommand[] = [
  {
    id: 'login',
    label: '/login',
    detail: 'auth check',
    insert: ({ agentLabel }) => `Check ${agentLabel} CLI authentication. If it is not logged in, give me the exact login command and where to run it.`
  },
  {
    id: 'usage',
    label: '/usage',
    detail: 'quota state',
    insert: ({ agentLabel }) => `Check ${agentLabel} usage, quota, and session limit status. Summarize what remains and any reset time you can infer.`
  },
  {
    id: 'status',
    label: '/status',
    detail: 'repo state',
    insert: () => 'Inspect the current repository status, branch, changed files, and immediate risks.'
  },
  {
    id: 'models',
    label: '/models',
    detail: 'model fit',
    insert: ({ agentLabel, modelLabel, reasoning }) => `Evaluate whether ${agentLabel} with ${modelLabel} and ${reasoning} reasoning is appropriate for this task. Recommend a better model only if needed.`
  },
  {
    id: 'permissions',
    label: '/permissions',
    detail: 'access rules',
    insert: ({ access }) => `Explain what the current access rules allow under ${access}, and what you cannot do without changing access.`
  },
  {
    id: 'review',
    label: '/review',
    detail: 'active file',
    insert: ({ filePath }) => `Review ${filePath ? `the active file ${filePath}` : 'the current repository context'} for bugs, risky assumptions, and missing checks.`
  },
  {
    id: 'fix',
    label: '/fix',
    detail: 'make change',
    insert: ({ filePath }) => `Fix the issue in ${filePath ? filePath : 'the relevant files'}, keep the change scoped, and tell me what verification you ran.`
  },
  {
    id: 'test',
    label: '/test',
    detail: 'verify',
    insert: () => 'Run or recommend the smallest useful verification for this change, then summarize the result.'
  },
  {
    id: 'attach',
    label: '/attach',
    detail: 'use files',
    insert: () => 'Use the attached files and images as primary context. Call out anything important you can infer from them.'
  }
]

export function localAgentProviderForAssistant(assistant: AssistantId): LocalAgentProvider {
  return assistant.startsWith('claude') ? 'claude' : 'codex'
}

export function localAgentDefaultAssistant(provider: LocalAgentProvider): AssistantId {
  return provider === 'claude' ? 'claude' : 'codex'
}

export function localAgentModelOptions(provider: LocalAgentProvider) {
  return provider === 'claude' ? CLAUDE_MODEL_OPTIONS : CODEX_MODEL_OPTIONS
}

export function localAgentLabel(provider: LocalAgentProvider): string {
  return provider === 'claude' ? 'Claude' : 'Codex'
}

export function compactAssistantUsage(status: AssistantStatus | null, checking: boolean): string {
  if (checking) return 'checking'
  if (!status) return 'unknown'

  const statusLabel = assistantStatusLabel(status)
  const message = status.message.trim()
  const resetLabel = compactAssistantResetLabel(message)
  const usageMatch = /(usage\s+(?:remaining|left)[^·\n.]*)/i.exec(message)
  const percentMatch = /(\d{1,3}%\s+(?:remaining|left))/i.exec(message)

  if (statusLabel === 'limited') {
    return resetLabel ? `limited - resets ${resetLabel}` : 'limited'
  }

  if (usageMatch) return usageMatch[1].trim()
  if (percentMatch) return percentMatch[1].trim()
  if (status.state === 'ready') return 'ready'
  if (status.state === 'detected') return 'checking'

  return statusLabel
}

export function compactAssistantResetLabel(message: string): string | null {
  const resetMatch =
    /resets?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*\([^)]*\))?)/i.exec(message) ||
    /try again at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*\([^)]*\))?)/i.exec(message) ||
    /resets?\s+(?:at\s+)?([^·\n,.]+)/i.exec(message)
  const value = resetMatch?.[1]?.trim().replace(/[.,;:]+$/g, '').trim()

  return value || null
}

export function slashCommandQuery(prompt: string): string | null {
  const match = /(?:^|\n)\/([a-z-]*)$/i.exec(prompt)
  return match ? match[1].toLowerCase() : null
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })
}

export async function readFileAsTruncatedText(file: File): Promise<{ text: string; truncated: boolean }> {
  const text = await file.text()

  if (text.length <= CODEX_AGENT_TEXT_ATTACHMENT_MAX_CHARS) {
    return { text, truncated: false }
  }

  return {
    text: `${text.slice(0, CODEX_AGENT_TEXT_ATTACHMENT_MAX_CHARS)}\n... ${text.length - CODEX_AGENT_TEXT_ATTACHMENT_MAX_CHARS} more characters truncated`,
    truncated: true
  }
}

export function isImageAttachmentFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
}

export function isTextAttachmentFile(file: File): boolean {
  return file.type.startsWith('text/') ||
    /(?:json|xml|yaml|javascript|typescript|css|html|markdown|csv|toml|x-sh|x-python)/i.test(file.type) ||
    TEXT_ATTACHMENT_FILE_RE.test(file.name)
}

export function filesFromTransferItems(items: DataTransferItemList): File[] {
  return Array.from(items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

export function friendlyAgentErrorMessage(error: BranchPilotError, fallback: string): string {
  const details = compactAgentErrorDetails(error.details ?? '')
  return friendlyIpcErrorMessage(error.message, fallback, details)
}

function compactAgentErrorDetails(details: string): string {
  const trimmed = details.trim()
  const maxLength = 12_000

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength)}\n... ${trimmed.length - maxLength} more characters truncated`
}

const LIVE_AGENT_EVENT_LIMIT = 200
const LIVE_AGENT_EVENT_TEXT_LIMIT = 8_000

export function appendLiveAgentEvents(current: CodexAgentEvent[], incoming: CodexAgentEvent[]): CodexAgentEvent[] {
  const next = current.slice()

  for (const event of incoming) {
    const last = next[next.length - 1]

    // thinking/text arrive as token deltas — merge runs of the same type into one readable block
    if (last && last.type === event.type && (event.type === 'thinking' || event.type === 'text')) {
      next[next.length - 1] = { type: last.type, text: (last.text + event.text).slice(-LIVE_AGENT_EVENT_TEXT_LIMIT) }
    } else {
      next.push(event)
    }
  }

  return next.length > LIVE_AGENT_EVENT_LIMIT ? next.slice(-LIVE_AGENT_EVENT_LIMIT) : next
}

export function liveAgentEventLabel(type: string): string {
  if (type === 'thinking') return 'Thinking'
  if (type === 'text') return 'Response'
  if (type === 'tool') return 'Tool'
  if (type === 'result') return 'Result'
  return type
}
