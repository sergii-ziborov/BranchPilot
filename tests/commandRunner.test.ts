import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CommandRunner } from '../electron/lib/commandRunner'

describe('CommandRunner', () => {
  it('passes shell metacharacters as literal argv values', async () => {
    const runner = new CommandRunner()
    const result = await runner.run(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      'safe; echo injected'
    ])

    expect(result.stdout.trim()).toBe('safe; echo injected')
  })

  it('redacts provider tokens from stdout and stderr', async () => {
    const runner = new CommandRunner()
    const token = 'ghp_branchpilottesttoken123'
    const result = await runner.run(process.execPath, [
      '-e',
      `process.stdout.write("${token}\\nAuthorization: Bearer secret-bearer"); process.stderr.write("token=${token}\\napi_key=secret-key\\nsecret=raw-secret");`
    ])

    expect(result.stdout).toBe('<redacted>\nAuthorization: Bearer <redacted>')
    expect(result.stderr).toBe('token=<redacted>\napi_key=<redacted>\nsecret=<redacted>')
  })

  it('caps stdout and stderr while preserving truncation flags', async () => {
    const runner = new CommandRunner()
    const result = await runner.run(process.execPath, [
      '-e',
      'process.stdout.write("a".repeat(16)); process.stderr.write("b".repeat(12));'
    ], {
      maxOutputBytes: 5
    })

    expect(result.stdout).toBe('aaaaa')
    expect(result.stderr).toBe('bbbbb')
    expect(result.stdoutTruncated).toBe(true)
    expect(result.stderrTruncated).toBe(true)
  })

  const itOnWindows = process.platform === 'win32' ? it : it.skip

  itOnWindows('runs Windows cmd shims from paths with spaces', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'branchpilot command runner '))
    const shimPath = path.join(tempDir, 'editor shim.cmd')
    await fs.writeFile(shimPath, '@echo off\r\necho %~1\r\n', 'utf8')

    try {
      const runner = new CommandRunner()
      const result = await runner.run(shimPath, ['safe literal'])

      expect(result.stdout.trim()).toBe('safe literal')
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
