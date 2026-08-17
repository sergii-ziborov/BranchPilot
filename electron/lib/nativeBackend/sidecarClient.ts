import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Wire error from the Rust core. `unsupported` means "use the console path". */
export interface SidecarError {
  code: string
  message: string
}

export class SidecarUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SidecarUnavailable'
  }
}

export class SidecarRequestError extends Error {
  readonly code: string

  constructor(error: SidecarError) {
    super(error.message)
    this.name = 'SidecarRequestError'
    this.code = error.code
  }

  /** The Rust core proved it cannot answer exactly; the console path can. */
  get isUnsupported(): boolean {
    return this.code === 'unsupported'
  }
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
}

const REQUEST_TIMEOUT_MS = 30_000
const BINARY_NAME = process.platform === 'win32' ? 'branchpilot-sidecar.exe' : 'branchpilot-sidecar'

/**
 * Long-lived stdio client for the Rust backend.
 *
 * The process is kept alive precisely because that is where the speed comes
 * from: repositories, pack indexes, commit-graphs and index snapshots stay warm
 * between requests, which a per-call `git` spawn can never do. A crashed or
 * missing binary is never fatal — every caller falls back to the console path.
 */
export class SidecarClient {
  private child?: ChildProcessWithoutNullStreams
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private unavailable?: SidecarUnavailable

  constructor(private readonly binaryPath = resolveSidecarBinary()) {}

  /** True when a sidecar binary exists and has not failed to start. */
  get available(): boolean {
    return Boolean(this.binaryPath) && !this.unavailable
  }

  /** True once a process is running; nothing is cached before that. */
  private get started(): boolean {
    return Boolean(this.child)
  }

  async request<T>(op: string, params: Record<string, unknown>): Promise<T> {
    const child = this.ensureStarted()
    const id = this.nextId++

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new SidecarUnavailable(`Native backend timed out on ${op}.`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, op, params })}\n`)
    })
  }

  /**
   * Drop every warm repository so the next read sees new refs and objects.
   *
   * Writes arrive with the working directory of whichever Git command ran,
   * which is not always the cache key, so freshness is bought by clearing all
   * of them rather than by guessing which entry went stale.
   */
  async invalidateAll(): Promise<void> {
    if (!this.available || !this.started) return

    try {
      await this.request('git.invalidateAll', {})
    } catch {
      // Invalidation is an optimisation hint; a failure only costs freshness on
      // a path that already falls back when it cannot answer.
    }
  }

  stop(): void {
    this.child?.stdin.end()
    this.child?.kill()
    this.child = undefined
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.unavailable) {
      throw this.unavailable
    }

    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child
    }

    if (!this.binaryPath) {
      this.unavailable = new SidecarUnavailable('Native backend binary was not found.')
      throw this.unavailable
    }

    try {
      this.child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      this.unavailable = new SidecarUnavailable('Native backend failed to start.', { cause: error })
      throw this.unavailable
    }

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.consume(chunk))
    this.child.on('error', (error) => this.fail(new SidecarUnavailable('Native backend crashed.', { cause: error })))
    this.child.on('exit', () => this.fail(new SidecarUnavailable('Native backend exited.')))

    return this.child
  }

  private consume(chunk: string): void {
    this.buffer += chunk

    let newline = this.buffer.indexOf('\n')

    while (newline !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      newline = this.buffer.indexOf('\n')

      if (line.trim()) {
        this.settle(line)
      }
    }
  }

  private settle(line: string): void {
    let message: { id: number; ok: boolean; result?: unknown; error?: SidecarError }

    try {
      message = JSON.parse(line)
    } catch {
      return
    }

    const request = this.pending.get(message.id)

    if (!request) return

    this.pending.delete(message.id)
    clearTimeout(request.timer)

    if (message.ok) {
      request.resolve(message.result)
    } else {
      request.reject(new SidecarRequestError(message.error ?? { code: 'unknown', message: 'Native backend failed.' }))
    }
  }

  /** Reject everything in flight; the process is restarted on the next call. */
  private fail(error: SidecarUnavailable): void {
    this.child = undefined
    this.buffer = ''

    for (const [id, request] of this.pending) {
      this.pending.delete(id)
      clearTimeout(request.timer)
      request.reject(error)
    }
  }
}

/** Packaged builds ship the binary in resources; dev builds use cargo output. */
function resolveSidecarBinary(): string | undefined {
  const candidates = [
    process.env.BRANCHPILOT_SIDECAR_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, BINARY_NAME) : undefined,
    path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)), 'native', 'target', 'release', BINARY_NAME)
  ]

  return candidates.find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate as string))
}
