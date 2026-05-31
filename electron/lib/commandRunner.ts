import { spawn } from 'node:child_process'

export interface CommandRunOptions {
  cwd?: string
  input?: string
  timeoutMs?: number
  allowedExitCodes?: number[]
}

export interface CommandRunResult {
  command: string
  args: string[]
  cwd?: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const SAFE_ENV_KEYS = [
  'HOME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
  'LANG',
  'LC_ALL',
  'SSH_AUTH_SOCK',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'DISPLAY',
  'XPC_SERVICE_NAME'
]

export class CommandExecutionError extends Error {
  code = 'command_failed'

  constructor(
    message: string,
    public result: CommandRunResult
  ) {
    super(message)
  }
}

export class CommandRunner {
  async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    const startedAt = Date.now()
    const allowedExitCodes = options.allowedExitCodes ?? [0]
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const result = await new Promise<CommandRunResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: buildSafeEnv(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })

      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      child.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })

      child.on('close', (exitCode) => {
        clearTimeout(timeout)
        const safeResult: CommandRunResult = {
          command,
          args,
          cwd: options.cwd,
          exitCode: exitCode ?? 1,
          stdout: redact(stdout),
          stderr: redact(timedOut ? `${stderr}\nCommand timed out after ${timeoutMs}ms.` : stderr),
          durationMs: Date.now() - startedAt
        }

        resolve(safeResult)
      })

      if (options.input) {
        child.stdin.write(options.input)
      }

      child.stdin.end()
    })

    if (!allowedExitCodes.includes(result.exitCode)) {
      throw new CommandExecutionError(
        `${command} ${args.join(' ')} failed with exit code ${result.exitCode}`,
        result
      )
    }

    return result
  }
}

function buildSafeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}

  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) {
      env[key] = process.env[key]
    }
  }

  return env
}

export function redact(text: string): string {
  return text
    .replace(/github_pat_[A-Za-z0-9_]+/g, '<redacted>')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '<redacted>')
    .replace(/x-access-token:[^@\s]+/g, 'x-access-token:<redacted>')
    .replace(/(password=)[^\s]+/gi, '$1<redacted>')
    .replace(/(token=)[^\s]+/gi, '$1<redacted>')
}
