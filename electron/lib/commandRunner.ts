import { spawn, type ChildProcess } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { gitArgsWithCredentialManager, isGitExecutable } from './platformExecutables.js'

export interface CommandRunOptions {
  cwd?: string
  input?: string
  timeoutMs?: number
  allowedExitCodes?: number[]
  maxOutputBytes?: number
  onStdout?: (chunk: string) => void
  signal?: AbortSignal
}

export interface CommandRunResult {
  command: string
  args: string[]
  cwd?: string
  exitCode: number
  stdout: string
  stderr: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
  cancelled?: boolean
  durationMs: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const SAFE_ENV_KEYS = [
  'ALLUSERSPROFILE',
  'APPDATA',
  'ComSpec',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'Path',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'SHELL',
  'SystemDrive',
  'SystemRoot',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USER',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
  'LANG',
  'LC_ALL',
  'SSH_AUTH_SOCK',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'DISPLAY',
  'NVM_HOME',
  'NVM_SYMLINK',
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
    const maxOutputBytes = normalizeMaxOutputBytes(options.maxOutputBytes)
    const spawnArgs = isGitExecutable(command) ? gitArgsWithCredentialManager(args) : args
    const safeEnv = buildSafeEnv()
    const spawnRequest = buildSpawnRequest(command, spawnArgs, safeEnv)

    const result = await new Promise<CommandRunResult>((resolve, reject) => {
      const child = spawn(spawnRequest.command, spawnRequest.args, {
        cwd: options.cwd,
        env: safeEnv,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: spawnRequest.windowsVerbatimArguments
      })

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let stdoutTruncated = false
      let stderrTruncated = false
      let timedOut = false
      let cancelled = false

      const timeout = setTimeout(() => {
        timedOut = true
        killProcessTree(child)
      }, timeoutMs)

      const onAbort = () => {
        cancelled = true
        killProcessTree(child)
      }

      if (options.signal?.aborted) {
        onAbort()
      } else {
        options.signal?.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        const appended = appendLimitedOutput(stdout, chunk, stdoutBytes, maxOutputBytes)
        stdout = appended.text
        stdoutBytes = appended.bytes
        stdoutTruncated = stdoutTruncated || appended.truncated
        options.onStdout?.(chunk)
      })

      child.stderr.on('data', (chunk: string) => {
        const appended = appendLimitedOutput(stderr, chunk, stderrBytes, maxOutputBytes)
        stderr = appended.text
        stderrBytes = appended.bytes
        stderrTruncated = stderrTruncated || appended.truncated
      })

      child.on('error', (error) => {
        clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
        reject(error)
      })

      child.on('close', (exitCode) => {
        clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
        const stderrNote = timedOut
          ? `${stderr}\nCommand timed out after ${timeoutMs}ms.`
          : cancelled
            ? `${stderr}\nCommand was cancelled.`
            : stderr
        const safeResult: CommandRunResult = {
          command,
          args: spawnArgs,
          cwd: options.cwd,
          exitCode: exitCode ?? 1,
          stdout: redact(stdout),
          stderr: redact(stderrNote),
          stdoutTruncated,
          stderrTruncated,
          cancelled,
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

function killProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    child.kill('SIGTERM')
    return
  }

  if (process.platform === 'win32') {
    // SIGTERM only reaches the direct child (often a cmd.exe wrapper); taskkill /T kills the whole tree.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' }).on('error', () => {
      child.kill('SIGTERM')
    })
    return
  }

  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }, 3_000).unref()
}

function buildSpawnRequest(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (process.platform !== 'win32' || !isWindowsBatchCommand(command)) {
    return { command, args }
  }

  return {
    command: env.ComSpec ?? env.comspec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', buildWindowsBatchCommandLine(command, args)],
    windowsVerbatimArguments: true
  }
}

function isWindowsBatchCommand(command: string): boolean {
  return /\.(?:cmd|bat)$/i.test(command)
}

function buildWindowsBatchCommandLine(command: string, args: string[]): string {
  return ['call', quoteWindowsCmdArgument(command), ...args.map(quoteWindowsCmdArgument)].join(' ')
}

function quoteWindowsCmdArgument(value: string): string {
  return `"${value.replaceAll('%', '%%').replaceAll('"', '""')}"`
}

function buildSafeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}

  for (const key of SAFE_ENV_KEYS) {
    const value = getEnvValue(key)

    if (value) {
      env[key] = value
    }
  }

  if (process.platform === 'win32') {
    const pathValue = buildWindowsPath(env.PATH ?? env.Path)

    env.PATH = pathValue
    env.Path = pathValue
  }

  delete env.ELECTRON_RUN_AS_NODE

  return env
}

function getEnvValue(key: string): string | undefined {
  if (process.env[key]) {
    return process.env[key]
  }

  const foundKey = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === key.toLowerCase())

  return foundKey ? process.env[foundKey] : undefined
}

function buildWindowsPath(currentPath?: string): string {
  const separator = ';'
  const parts = (currentPath ?? '').split(separator).filter(Boolean)
  const appData = getEnvValue('APPDATA')
  const nvmHome = getEnvValue('NVM_HOME')
  const nvmSymlink = getEnvValue('NVM_SYMLINK')
  const userProfile = getEnvValue('USERPROFILE')
  const additions = [
    appData ? `${appData}\\npm` : undefined,
    userProfile ? `${userProfile}\\scoop\\shims` : undefined,
    userProfile ? `${userProfile}\\scoop\\apps\\yarn\\current\\global\\node_modules\\.bin` : undefined,
    nvmHome ? `${nvmHome}\\nodejs\\nodejs` : undefined,
    nvmSymlink,
    userProfile ? `${userProfile}\\.vscode\\extensions` : undefined,
    ...findWindowsCodexPathAdditions(userProfile)
  ].filter((part): part is string => Boolean(part))

  for (const addition of additions) {
    if (!parts.some((part) => part.toLowerCase() === addition.toLowerCase())) {
      parts.push(addition)
    }
  }

  return parts.join(separator)
}

function findWindowsCodexPathAdditions(userProfile?: string): string[] {
  if (!userProfile) {
    return []
  }

  const roots = [
    `${userProfile}\\.vscode\\extensions`,
    `${userProfile}\\.vscode-insiders\\extensions`,
    `${userProfile}\\.cursor\\extensions`
  ]
  const paths: string[] = []

  for (const root of roots) {
    let entries: string[]

    try {
      entries = readdirSync(root)
    } catch {
      continue
    }

    for (const entry of entries.sort().reverse()) {
      if (!/^openai\.chatgpt-/i.test(entry)) {
        continue
      }

      paths.push(`${root}\\${entry}\\bin\\windows-x86_64`)
      paths.push(`${root}\\${entry}\\bin\\windows-arm64`)
    }
  }

  return paths
}

function normalizeMaxOutputBytes(value?: number): number | undefined {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return undefined
  }

  return Math.floor(value)
}

function appendLimitedOutput(current: string, chunk: string, currentBytes: number, maxBytes?: number): {
  text: string
  bytes: number
  truncated: boolean
} {
  const chunkBytes = Buffer.byteLength(chunk)

  if (!maxBytes) {
    return {
      text: current + chunk,
      bytes: currentBytes + chunkBytes,
      truncated: false
    }
  }

  if (currentBytes >= maxBytes) {
    return {
      text: current,
      bytes: currentBytes,
      truncated: chunkBytes > 0
    }
  }

  const remainingBytes = maxBytes - currentBytes

  if (chunkBytes <= remainingBytes) {
    return {
      text: current + chunk,
      bytes: currentBytes + chunkBytes,
      truncated: false
    }
  }

  return {
    text: current + Buffer.from(chunk).subarray(0, remainingBytes).toString('utf8'),
    bytes: maxBytes,
    truncated: true
  }
}

export function redact(text: string): string {
  return text
    .replace(/github_pat_[A-Za-z0-9_]+/g, '<redacted>')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '<redacted>')
    .replace(/x-access-token:[^@\s]+/g, 'x-access-token:<redacted>')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(/(api[_-]?key=)[^\s]+/gi, '$1<redacted>')
    .replace(/(secret=)[^\s]+/gi, '$1<redacted>')
    .replace(/(password=)[^\s]+/gi, '$1<redacted>')
    .replace(/(token=)[^\s]+/gi, '$1<redacted>')
}
