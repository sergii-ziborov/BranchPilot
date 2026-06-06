import { describe, expect, it } from 'vitest'
import { CommandRunner } from '../electron/lib/commandRunner'

describe('CommandRunner', () => {
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
