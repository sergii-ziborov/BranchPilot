import { describe, expect, it } from 'vitest'
import { CommandRunner } from '../electron/lib/commandRunner'

describe('CommandRunner', () => {
  it('passes shell metacharacters as literal argv values', async () => {
    const runner = new CommandRunner()
    const result = await runner.run('/bin/echo', ['safe; echo injected'])

    expect(result.stdout.trim()).toBe('safe; echo injected')
  })

  it('redacts provider tokens from stdout and stderr', async () => {
    const runner = new CommandRunner()
    const token = 'ghp_branchpilottesttoken123'
    const result = await runner.run(process.execPath, [
      '-e',
      `process.stdout.write("${token}"); process.stderr.write("token=${token}");`
    ])

    expect(result.stdout).toBe('<redacted>')
    expect(result.stderr).toBe('token=<redacted>')
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
})
