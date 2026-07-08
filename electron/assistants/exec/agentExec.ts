import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  CodexAgentEvent,
  CodexAgentReasoning,
  CodexAgentSandbox
} from '../../../src/shared/branchPilot.js'
import { CommandExecutionError, CommandRunner } from '../../lib/commandRunner.js'
import { BranchPilotUserError } from '../../lib/errors.js'
import { ResolvedAssistantRunner } from '../assistantRunner.runners.js'
import {
  createLineStream,
  extractClaudeFinalResult,
  parseClaudeLiveEvent,
  parseClaudeStreamEvents,
  parseCodexLiveEvent
} from './agentEventParsing.js'

const AGENT_EXEC_TIMEOUT_MS = 900_000

export interface AgentExecStreamOptions {
  onEvent?: (event: CodexAgentEvent) => void
  signal?: AbortSignal
}

export async function runCodexAgentExec(
  runner: CommandRunner,
  assistant: ResolvedAssistantRunner,
  options: {
    rootPath: string
    prompt: string
    imagePaths: string[]
    sandbox: CodexAgentSandbox
    reasoning: CodexAgentReasoning
  } & AgentExecStreamOptions
): Promise<{ output: string; eventLog: string }> {
  if (assistant.id !== 'codex') {
    throw new BranchPilotUserError('assistant_not_found', 'Codex CLI is required for the Codex agent panel.')
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot-codex-agent-'))
  const outputPath = path.join(tempDir, 'last-message.txt')
  const modelArgs = assistant.model ? ['--model', assistant.model] : []
  const reasoningArgs = ['--config', `model_reasoning_effort="${codexReasoningEffort(options.reasoning)}"`]
  const imageArgs = options.imagePaths.flatMap((imagePath) => ['--image', imagePath])
  const lineStream = options.onEvent
    ? createLineStream((line) => {
        const event = parseCodexLiveEvent(line)

        if (event) options.onEvent?.(event)
      })
    : undefined

  try {
    const result = await runAgentCommand(runner, assistant.executablePath, [
      'exec',
      ...modelArgs,
      ...reasoningArgs,
      '--sandbox',
      options.sandbox,
      '--cd',
      options.rootPath,
      '--skip-git-repo-check',
      '--json',
      '--color',
      'never',
      '--output-last-message',
      outputPath,
      ...imageArgs,
      '-'
    ], {
      cwd: options.rootPath,
      prompt: options.prompt,
      lineStream,
      signal: options.signal
    })
    let output = ''

    try {
      output = await fs.readFile(outputPath, 'utf8')
    } catch {
      output = ''
    }

    return {
      output: output.trim() || result.stdout.trim(),
      eventLog: result.stdout
    }
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true })
  }
}

export async function runClaudeAgentExec(
  runner: CommandRunner,
  assistant: ResolvedAssistantRunner,
  options: {
    rootPath: string
    prompt: string
    imagePaths: string[]
    imageTempDir: string
    sandbox: CodexAgentSandbox
    reasoning: CodexAgentReasoning
  } & AgentExecStreamOptions
): Promise<{ output: string; eventLog: string }> {
  if (assistant.id !== 'claude') {
    throw new BranchPilotUserError('assistant_not_found', 'Claude Code is required for the Claude agent panel.')
  }

  const modelArgs = assistant.model ? ['--model', assistant.model] : []
  const imageDirArgs = options.imagePaths.length > 0 ? ['--add-dir', options.imageTempDir] : []
  const lineStream = options.onEvent
    ? createLineStream((line) => {
        const event = parseClaudeLiveEvent(line)

        if (event) options.onEvent?.(event)
      })
    : undefined
  const result = await runAgentCommand(runner, assistant.executablePath, [
    ...modelArgs,
    '--print',
    '--input-format',
    'text',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--effort',
    claudeReasoningEffort(options.reasoning),
    ...imageDirArgs,
    ...claudeAccessArgs(options.sandbox)
  ], {
    cwd: options.rootPath,
    prompt: options.prompt,
    lineStream,
    signal: options.signal
  })
  const finalResult = extractClaudeFinalResult(result.stdout)
  const parsedEvents = parseClaudeStreamEvents(result.stdout)

  return {
    output: finalResult || parsedEvents.map((event) => event.text).filter(Boolean).slice(-3).join('\n\n') || result.stdout.trim(),
    eventLog: result.stdout
  }
}

async function runAgentCommand(
  runner: CommandRunner,
  executablePath: string,
  args: string[],
  options: {
    cwd: string
    prompt: string
    lineStream?: ReturnType<typeof createLineStream>
    signal?: AbortSignal
  }
) {
  try {
    const result = await runner.run(executablePath, args, {
      cwd: options.cwd,
      input: options.prompt,
      timeoutMs: AGENT_EXEC_TIMEOUT_MS,
      onStdout: options.lineStream ? (chunk) => options.lineStream?.push(chunk) : undefined,
      signal: options.signal
    })

    options.lineStream?.flush()

    return result
  } catch (error) {
    options.lineStream?.flush()

    if (error instanceof CommandExecutionError && error.result.cancelled) {
      throw new BranchPilotUserError('local_agent_cancelled', 'Agent run was stopped.')
    }

    throw error
  }
}

function codexReasoningEffort(reasoning: CodexAgentReasoning): string {
  if (reasoning === 'light') return 'low'
  if (reasoning === 'medium') return 'medium'
  return 'high'
}

function claudeReasoningEffort(reasoning: CodexAgentReasoning): string {
  if (reasoning === 'light') return 'low'
  if (reasoning === 'medium') return 'medium'
  if (reasoning === 'high') return 'high'
  return 'xhigh'
}

function claudeAccessArgs(sandbox: CodexAgentSandbox): string[] {
  if (sandbox === 'danger-full-access') {
    return ['--dangerously-skip-permissions']
  }

  const readTools = [
    'Read',
    'Glob',
    'Grep',
    'LS',
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git show:*)'
  ]

  if (sandbox === 'read-only') {
    return [
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      readTools.join(',')
    ]
  }

  return [
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    [
      ...readTools,
      'Edit',
      'MultiEdit',
      'Write',
      'Bash(npm test:*)',
      'Bash(npm run lint:*)',
      'Bash(npm run build:*)',
      'Bash(node:*)'
    ].join(',')
  ]
}
