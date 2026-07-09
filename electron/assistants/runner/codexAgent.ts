import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentRunRecord,
  AgentRunSummary,
  CodexAgentAttachment,
  CodexAgentRequest,
  CodexAgentResult
} from '../../../src/shared/branchPilot.js'
import type { AgentRunStore } from '../../lib/agentRunStore.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'
import { truncateText } from '../assistantRunner.prompts.js'
import { getBranchLabel, resolveRepositoryRoot } from '../assistantRunner.context.js'
import {
  runClaudeAgentExec,
  runCodexAgentExec,
  resolveAssistantCandidates,
  type AgentExecStreamOptions
} from '../assistantRunner.exec.js'
import { parseClaudeStreamEvents, parseCodexAgentEvents } from '../exec/agentEventParsing.js'

const MAX_CODEX_AGENT_FILE_BYTES = 120_000
const MAX_CODEX_AGENT_PROMPT_BYTES = 180_000
const MAX_CODEX_AGENT_IMAGES = 6
const MAX_CODEX_AGENT_ATTACHMENTS = 8
const MAX_CODEX_AGENT_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_CODEX_AGENT_ATTACHMENT_TEXT_BYTES = 80_000

export async function runCodexAgent(
  runner: CommandRunner,
  request: CodexAgentRequest,
  stream: AgentExecStreamOptions = {},
  store?: AgentRunStore
): Promise<CodexAgentResult> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const promptText = request.prompt.trim()
  const attachments = normalizeCodexAgentAttachments(request)
  const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image')

  if (!promptText && !request.filePath && attachments.length === 0) {
    throw new BranchPilotUserError('local_agent_prompt_required', 'Enter a prompt, select a file, or attach a file.')
  }

  const assistantBase = request.assistant.startsWith('claude') ? 'claude' : 'codex'
  const requestedAssistant = request.assistant.startsWith('claude') || request.assistant.startsWith('codex')
    ? request.assistant
    : 'codex'
  const assistant = (await resolveAssistantCandidates(runner, requestedAssistant)).find((candidate) => candidate.id === assistantBase)

  if (!assistant) {
    throw new BranchPilotUserError(
      'assistant_not_found',
      assistantBase === 'claude'
        ? 'Claude Code is required for the Claude agent panel.'
        : 'Codex CLI is required for the Codex agent panel.'
    )
  }

  const branch = await getBranchLabel(runner, rootPath)
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const diffStat = await runner.run(GIT_EXECUTABLE, ['diff', '--stat'], {
    cwd: rootPath,
    allowedExitCodes: [0, 1],
    timeoutMs: 20_000
  })
  const images = await writeCodexAgentImages(imageAttachments)
  const previousRuns = await loadRecentAgentRuns(store, rootPath)
  const prompt = buildCodexAgentPrompt({
    assistant: assistant.id,
    branch,
    status: status.stdout,
    diffStat: diffStat.stdout,
    imagePaths: images.paths,
    previousRuns,
    request: {
      ...request,
      attachments
    },
    prompt: promptText
  })
  const startedAt = Date.now()
  const runId = request.runId ?? randomUUID()

  try {
    const result = assistant.id === 'claude'
      ? await runClaudeAgentExec(runner, assistant, {
          rootPath,
          prompt,
          imagePaths: images.paths,
          imageTempDir: images.tempDir,
          sandbox: request.sandbox,
          reasoning: request.reasoning,
          onEvent: stream.onEvent,
          signal: stream.signal
        })
      : await runCodexAgentExec(runner, assistant, {
          rootPath,
          prompt,
          imagePaths: images.paths,
          sandbox: request.sandbox,
          reasoning: request.reasoning,
          onEvent: stream.onEvent,
          signal: stream.signal
        })
    const events = assistant.id === 'claude'
      ? parseClaudeStreamEvents(result.eventLog).slice(-120)
      : parseCodexAgentEvents(result.eventLog)
    const output = result.output || events.map((event) => event.text).filter(Boolean).slice(-3).join('\n\n')

    const stored = await persistAgentRun(store, {
      id: runId,
      repoPath: rootPath,
      assistant: assistant.id,
      modelLabel: assistant.modelLabel,
      prompt: promptText || request.prompt,
      output,
      events,
      sandbox: request.sandbox,
      reasoning: request.reasoning,
      filePath: request.filePath,
      imageCount: images.paths.length,
      attachmentCount: attachments.length,
      durationMs: Date.now() - startedAt,
      status: 'completed',
      verdict: summarizeOutput(output),
      createdAt: new Date().toISOString()
    })

    return {
      assistant: assistant.id,
      modelLabel: assistant.modelLabel,
      output,
      events,
      sandbox: request.sandbox,
      reasoning: request.reasoning,
      imageCount: images.paths.length,
      attachmentCount: attachments.length,
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
      runId: stored?.id ?? runId
    }
  } catch (error) {
    const status = error instanceof BranchPilotUserError && error.code === 'local_agent_cancelled'
      ? 'cancelled'
      : 'failed'

    await persistAgentRun(store, {
      id: runId,
      repoPath: rootPath,
      assistant: assistant.id,
      modelLabel: assistant.modelLabel,
      prompt: promptText || request.prompt,
      output: '',
      events: [],
      sandbox: request.sandbox,
      reasoning: request.reasoning,
      filePath: request.filePath,
      imageCount: images.paths.length,
      attachmentCount: attachments.length,
      durationMs: Date.now() - startedAt,
      status,
      verdict: errorSummary(error, status),
      createdAt: new Date().toISOString()
    })

    throw error
  } finally {
    await fs.rm(images.tempDir, { force: true, recursive: true })
  }
}

async function loadRecentAgentRuns(store: AgentRunStore | undefined, repoPath: string): Promise<AgentRunSummary[]> {
  if (!store) {
    return []
  }

  try {
    return await store.getRecentSummaries(repoPath, 5)
  } catch (error) {
    console.error('Agent run store read failed', error)
    return []
  }
}

async function persistAgentRun(
  store: AgentRunStore | undefined,
  record: AgentRunRecord
): Promise<AgentRunRecord | null> {
  if (!store) {
    return null
  }

  try {
    return await store.append(record)
  } catch (error) {
    console.error('Agent run store write failed', error)
    return null
  }
}

function summarizeOutput(output: string): string | undefined {
  const trimmed = output.trim()

  if (!trimmed) {
    return undefined
  }

  return trimmed.length > 400 ? `...${trimmed.slice(-400)}` : trimmed
}

function errorSummary(error: unknown, status: AgentRunRecord['status']): string {
  if (status === 'cancelled') {
    return 'Agent run was stopped.'
  }

  if (error instanceof BranchPilotUserError || error instanceof Error) {
    return error.message
  }

  return 'Agent run failed.'
}

function buildCodexAgentPrompt(context: {
  assistant: 'claude' | 'codex'
  branch: string
  status: string
  diffStat: string
  imagePaths: string[]
  previousRuns: AgentRunSummary[]
  request: CodexAgentRequest
  prompt: string
}): string {
  const fileText = context.request.fileText
    ? truncateText(context.request.fileText, MAX_CODEX_AGENT_FILE_BYTES)
    : null
  const assistantName = context.assistant === 'claude' ? 'Claude Code' : 'Codex'
  const attachments = normalizeCodexAgentAttachments(context.request)
  const textAttachmentContext = formatCodexAgentTextAttachments(attachments)
  const imageContext = context.imagePaths.length > 0
    ? context.imagePaths.map((imagePath) => `- ${imagePath}`).join('\n')
    : '(none)'
  const basePrompt = [
    `You are ${assistantName} running inside BranchPilot, a local desktop Git client.`,
    'Use the repository working directory as your source of truth. Prefer BranchPilot-provided context first, then inspect files as needed.',
    'Do not push, reset, delete branches, or rewrite history unless the user explicitly requested it in this prompt and the selected sandbox allows it.',
    'When you make changes, summarize what changed and which verification you ran. If you cannot make changes under the sandbox, explain the exact next step.',
    'Provide a concise visible reasoning summary, not hidden chain-of-thought.',
    '',
    `Sandbox: ${context.request.sandbox}`,
    `Reasoning preset requested by user: ${context.request.reasoning}`,
    `Branch: ${context.branch}`,
    `Attachments: ${attachments.length}`,
    `Images attached: ${context.imagePaths.length}`,
    context.assistant === 'claude'
      ? [
          'Claude image file paths:',
          imageContext,
          'Use Read on those image files when the screenshot/photo content matters.'
        ].join('\n')
      : 'Codex receives attached images through the CLI image channel.',
    '',
    'Attached text files:',
    textAttachmentContext,
    '',
    'Git status:',
    context.status.trim() || '(clean)',
    '',
    'Diff stat:',
    context.diffStat.trim() || '(none)',
    '',
    context.request.filePath ? `Active file: ${context.request.filePath}` : 'Active file: (none)',
    fileText
      ? [
          `Active file content${fileText.truncated ? ' (truncated)' : ''}:`,
          fileText.text
        ].join('\n')
      : 'Active file content: (not included)',
    '',
    'Active diagnostics:',
    formatCodexAgentDiagnostics(context.request.diagnostics ?? []),
    ...(context.previousRuns.length > 0
      ? [
          '',
          'Previous agent runs in this repo (most recent first):',
          formatPreviousAgentRuns(context.previousRuns)
        ]
      : []),
    '',
    'User request:',
    context.prompt || '(image/context-only request)'
  ].join('\n')

  return truncateText(basePrompt, MAX_CODEX_AGENT_PROMPT_BYTES).text
}

function formatPreviousAgentRuns(runs: AgentRunSummary[]): string {
  return runs
    .slice(0, 5)
    .map((run) => {
      const when = formatAgentRunTimestamp(run.createdAt)
      const promptPreview = shortenAgentRunText(run.prompt, 140) || '(no prompt)'
      const verdictPreview = run.verdict ? ` -> ${shortenAgentRunText(run.verdict, 160)}` : ''

      return `- [${run.status}] ${when} ${run.assistant}: ${promptPreview}${verdictPreview}`
    })
    .join('\n')
}

function shortenAgentRunText(text: string, maxLength: number): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim()

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function formatAgentRunTimestamp(createdAt: string): string {
  const timestamp = Date.parse(createdAt)

  if (Number.isNaN(timestamp)) {
    return 'unknown time'
  }

  const diffMs = Date.now() - timestamp

  if (diffMs < 0) {
    return 'just now'
  }

  const minutes = Math.round(diffMs / 60_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)

  if (hours < 24) return `${hours}h ago`

  const days = Math.round(hours / 24)

  return `${days}d ago`
}

function formatCodexAgentDiagnostics(diagnostics: CodexAgentRequest['diagnostics']): string {
  if (!diagnostics?.length) return '(none)'

  return diagnostics
    .slice(0, 20)
    .map((diagnostic) => `- ${diagnostic.source} ${diagnostic.lineNumber}:${diagnostic.column} ${diagnostic.message}`)
    .join('\n')
}

function normalizeCodexAgentAttachments(request: Pick<CodexAgentRequest, 'attachments' | 'images'>): CodexAgentAttachment[] {
  const attachments = (request.attachments ?? []).slice(0, MAX_CODEX_AGENT_ATTACHMENTS)

  if (attachments.length > 0) {
    return attachments
  }

  return (request.images ?? []).slice(0, MAX_CODEX_AGENT_IMAGES).map((image) => ({
    kind: 'image',
    name: image.name,
    mimeType: image.mimeType,
    dataUrl: image.dataUrl
  }))
}

function formatCodexAgentTextAttachments(attachments: CodexAgentAttachment[]): string {
  const textAttachments = attachments.filter((attachment) => attachment.kind === 'text')

  if (textAttachments.length === 0) {
    return '(none)'
  }

  return textAttachments
    .slice(0, MAX_CODEX_AGENT_ATTACHMENTS)
    .map((attachment) => {
      const content = truncateText(attachment.text ?? '', MAX_CODEX_AGENT_ATTACHMENT_TEXT_BYTES)
      const sizeLabel = typeof attachment.sizeBytes === 'number' ? `, ${attachment.sizeBytes} bytes` : ''

      return [
        `--- ${attachment.name} (${attachment.mimeType || 'text/plain'}${sizeLabel}${content.truncated ? ', truncated' : ''}) ---`,
        content.text || '(empty file)'
      ].join('\n')
    })
    .join('\n\n')
}

async function writeCodexAgentImages(images: CodexAgentAttachment[]): Promise<{ tempDir: string; paths: string[] }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-codex-images-'))
  const paths: string[] = []

  try {
    for (const [index, image] of (images ?? []).slice(0, MAX_CODEX_AGENT_IMAGES).entries()) {
      const parsed = parseCodexAgentImage(image)
      const fileName = `${String(index + 1).padStart(2, '0')}-${safeAttachmentName(image.name, parsed.extension)}`
      const filePath = path.join(tempDir, fileName)

      await fs.writeFile(filePath, parsed.buffer)
      paths.push(filePath)
    }

    return { tempDir, paths }
  } catch (error) {
    await fs.rm(tempDir, { force: true, recursive: true })
    throw error
  }
}

function parseCodexAgentImage(image: CodexAgentAttachment): { buffer: Buffer; extension: string } {
  const declaredMime = image.mimeType.trim().toLowerCase()
  const match = /^data:(image\/[-+.\w]+);base64,(?<data>.+)$/i.exec(image.dataUrl ?? '')
  const mimeType = match?.[1].toLowerCase() || declaredMime

  if (!mimeType.startsWith('image/')) {
    throw new BranchPilotUserError('codex_agent_invalid_attachment', 'Agent attachments must be images.')
  }

  const base64 = match?.groups?.data ?? image.dataUrl ?? ''
  const buffer = Buffer.from(base64, 'base64')

  if (buffer.length === 0) {
    throw new BranchPilotUserError('codex_agent_invalid_attachment', 'Agent image attachment is empty.')
  }

  if (buffer.length > MAX_CODEX_AGENT_IMAGE_BYTES) {
    throw new BranchPilotUserError(
      'codex_agent_attachment_too_large',
      'One agent image is too large.',
      'Keep each image under 8 MB.'
    )
  }

  return {
    buffer,
    extension: extensionForMimeType(mimeType)
  }
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg'
  if (mimeType.includes('webp')) return '.webp'
  if (mimeType.includes('gif')) return '.gif'
  if (mimeType.includes('bmp')) return '.bmp'
  if (mimeType.includes('svg')) return '.svg'
  return '.png'
}

function safeAttachmentName(name: string, extension: string): string {
  const baseName = path.basename(name || 'image', path.extname(name || 'image'))
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image'

  return `${baseName}${extension}`
}

