import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CommandExecutionError,
  type CommandRunOptions,
  type CommandRunResult,
  CommandRunner
} from '../electron/lib/commandRunner'
import {
  checkAssistantStatuses,
  generateBranchDraft,
  generateCommitMessage,
  generatePullRequestText,
  generateReviewReport,
  listAssistantStatuses
} from '../electron/assistants/assistantRunner'

const tempRoots: string[] = []

describe('assistant commit message generation', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('uses staged diff context and excludes unstaged content', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: '{"title":"Update tracked file","description":"Uses the staged file content."}'
    })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'staged\n')
    git(repoPath, ['add', 'tracked.txt'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'unstaged\n')

    const result = await generateCommitMessage(runner, { repoPath, assistant: 'auto' })

    expect(result).toMatchObject({
      title: 'Update tracked file',
      description: 'Uses the staged file content.',
      assistant: 'claude',
      truncated: false
    })
    expect(runner.assistantPrompt).toContain('+staged')
    expect(runner.assistantPrompt).not.toContain('+unstaged')
  })

  it('lists assistant path detection without running generation', async () => {
    const runner = new AssistantTestRunner({ available: ['claude'] })

    const statuses = await listAssistantStatuses(runner)

    expect(statuses).toEqual([
      expect.objectContaining({
        id: 'claude',
        detected: true,
        state: 'detected'
      }),
      expect.objectContaining({
        id: 'codex',
        detected: false,
        state: 'missing'
      })
    ])
    expect(runner.assistantInvocations).toHaveLength(0)
  })

  it('checks assistant health with ready, unavailable, and missing states', async () => {
    const runner = new AssistantTestRunner({
      available: ['claude'],
      failingAssistants: ['claude']
    })

    const statuses = await checkAssistantStatuses(runner)

    expect(statuses).toEqual([
      expect.objectContaining({
        id: 'claude',
        detected: true,
        state: 'unavailable',
        message: expect.stringContaining('Claude Code failed to generate text')
      }),
      expect.objectContaining({
        id: 'codex',
        detected: false,
        state: 'missing'
      })
    ])
    expect(runner.assistantInvocations).toHaveLength(1)
  })

  it('marks assistant health ready when minimal JSON generation succeeds', async () => {
    const runner = new AssistantTestRunner({ available: ['codex'] })

    const statuses = await checkAssistantStatuses(runner)

    expect(statuses.find((status) => status.id === 'codex')).toEqual(expect.objectContaining({
      detected: true,
      state: 'ready',
      message: 'Codex is ready for BranchPilot generation.'
    }))
  })

  it('rejects generation when nothing is staged', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['claude'] })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'unstaged only\n')

    await expect(generateCommitMessage(runner, { repoPath, assistant: 'auto' })).rejects.toMatchObject({
      code: 'nothing_staged'
    })
    expect(runner.assistantInvocations).toHaveLength(0)
  })

  it('runs Claude in non-interactive print mode without repository cwd', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({ available: ['claude'] })

    await generateCommitMessage(runner, { repoPath, assistant: 'claude' })

    expect(runner.assistantInvocations[0]).toMatchObject({
      command: '/tmp/branchpilot-claude'
    })
    expect(runner.assistantInvocations[0].args).toContain('--print')
    expect(runner.assistantInvocations[0].args).toContain('--tools')
    expect(runner.assistantInvocations[0].cwd).not.toBe(repoPath)
  })

  it('runs Codex exec with read-only sandbox outside the repository', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({ available: ['codex'] })

    const result = await generateCommitMessage(runner, { repoPath, assistant: 'codex' })

    expect(result.assistant).toBe('codex')
    expect(runner.assistantInvocations[0]).toMatchObject({
      command: '/tmp/branchpilot-codex'
    })
    expect(runner.assistantInvocations[0].args).toEqual(expect.arrayContaining([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--output-schema'
    ]))
    expect(runner.assistantInvocations[0].cwd).not.toBe(repoPath)
  })

  it('falls back to Codex in auto mode when Claude is unavailable', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({ available: ['codex'] })

    const result = await generateCommitMessage(runner, { repoPath, assistant: 'auto' })

    expect(result.assistant).toBe('codex')
  })

  it('falls back to Codex in auto mode when Claude execution fails', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({
      available: ['claude', 'codex'],
      failingAssistants: ['claude']
    })

    const result = await generateCommitMessage(runner, { repoPath, assistant: 'auto' })

    expect(result.assistant).toBe('codex')
    expect(runner.assistantInvocations.map((invocation) => invocation.command)).toEqual([
      '/tmp/branchpilot-claude',
      '/tmp/branchpilot-codex'
    ])
  })

  it('does not fall back when a specifically requested assistant fails', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({
      available: ['claude', 'codex'],
      failingAssistants: ['claude']
    })

    await expect(generateCommitMessage(runner, { repoPath, assistant: 'claude' })).rejects.toMatchObject({
      code: 'assistant_failed'
    })
    expect(runner.assistantInvocations.map((invocation) => invocation.command)).toEqual(['/tmp/branchpilot-claude'])
  })


  it('returns a parse error for invalid assistant output', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: 'not json'
    })

    await expect(generateCommitMessage(runner, { repoPath, assistant: 'auto' })).rejects.toMatchObject({
      code: 'assistant_parse_failed'
    })
  })

  it('marks oversized staged diffs as truncated', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['claude'] })

    writeFileSync(path.join(repoPath, 'tracked.txt'), `${'x'.repeat(90_000)}\n`)
    git(repoPath, ['add', 'tracked.txt'])

    const result = await generateCommitMessage(runner, { repoPath, assistant: 'auto' })

    expect(result.truncated).toBe(true)
    expect(runner.assistantPrompt).toContain('Diff truncated: yes')
  })

  it('generates pull request text from branch commits and committed diff only', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: '{"title":"Add PR workflow","description":"Summarizes the feature branch."}'
    })

    git(repoPath, ['switch', '--quiet', '-c', 'feature/pr-text'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'feature\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Add feature work'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'unstaged\n')

    const result = await generatePullRequestText(runner, { repoPath, assistant: 'auto' })

    expect(result).toMatchObject({
      title: 'Add PR workflow',
      description: 'Summarizes the feature branch.',
      assistant: 'claude',
      baseBranch: 'main',
      headBranch: 'feature/pr-text',
      commitCount: 1
    })
    expect(runner.assistantPrompt).toContain('Add feature work')
    expect(runner.assistantPrompt).toContain('+feature')
    expect(runner.assistantPrompt).not.toContain('+unstaged')
  })

  it('uses origin HEAD as the default pull request base when available', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['claude'] })
    const mainSha = git(repoPath, ['rev-parse', 'main'])

    git(repoPath, ['update-ref', 'refs/remotes/origin/trunk', mainSha])
    git(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
    git(repoPath, ['switch', '--quiet', '-c', 'feature/origin-head'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'origin head base\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Use origin head'])

    const result = await generatePullRequestText(runner, { repoPath, assistant: 'auto' })

    expect(result.baseBranch).toBe('trunk')
    expect(runner.assistantPrompt).toContain('Base branch: trunk')
  })

  it('returns a parse error for invalid pull request assistant output', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: 'not json'
    })

    git(repoPath, ['switch', '--quiet', '-c', 'feature/bad-output'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'feature\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Feature bad output'])

    await expect(generatePullRequestText(runner, { repoPath, assistant: 'auto' })).rejects.toMatchObject({
      code: 'assistant_parse_failed'
    })
  })

  it('generates branch draft from intent and local working tree context', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: '{"branchName":"feature/policy-ui","description":"Adds a policy-aware branch workflow."}'
    })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'branch staged\n')
    git(repoPath, ['add', 'tracked.txt'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'branch unstaged\n')

    const result = await generateBranchDraft(runner, {
      repoPath,
      assistant: 'auto',
      goal: 'Improve assistant policy UI'
    })

    expect(result).toMatchObject({
      branchName: 'feature/policy-ui',
      description: 'Adds a policy-aware branch workflow.',
      assistant: 'claude',
      truncated: false
    })
    expect(runner.assistantPrompt).toContain('Improve assistant policy UI')
    expect(runner.assistantPrompt).toContain('+branch staged')
    expect(runner.assistantPrompt).toContain('+branch unstaged')
  })

  it('requires branch draft context before invoking an assistant', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['claude'] })

    await expect(generateBranchDraft(runner, { repoPath, assistant: 'auto' })).rejects.toMatchObject({
      code: 'no_branch_context'
    })
    expect(runner.assistantInvocations).toHaveLength(0)
  })

  it('rejects invalid generated branch names', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: '{"branchName":"bad branch name","description":"Invalid branch."}'
    })

    await expect(generateBranchDraft(runner, {
      repoPath,
      assistant: 'auto',
      goal: 'Create invalid branch output'
    })).rejects.toMatchObject({
      code: 'assistant_parse_failed'
    })
  })

  it('reviews staged changes without including unstaged diff content', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: reviewOutput('Staged review complete.')
    })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'staged\n')
    git(repoPath, ['add', 'tracked.txt'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'unstaged\n')

    const report = await generateReviewReport(runner, {
      repoPath,
      assistant: 'auto',
      mode: 'consistency',
      scope: 'staged'
    })

    expect(report).toMatchObject({
      summary: 'Staged review complete.',
      mode: 'consistency',
      scope: 'staged',
      assistant: 'claude',
      truncated: false
    })
    expect(report.findings[0]).toMatchObject({
      severity: 'medium',
      title: 'Review finding'
    })
    expect(runner.assistantPrompt).toContain('architecture boundary')
    expect(runner.assistantPrompt).toContain('+staged')
    expect(runner.assistantPrompt).not.toContain('+unstaged')
  })

  it('reviews unstaged changes without including staged-only file content', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: reviewOutput('Unstaged review complete.')
    })

    writeFileSync(path.join(repoPath, 'other.txt'), 'initial other\n')
    git(repoPath, ['add', 'other.txt'])
    git(repoPath, ['commit', '-m', 'Add other file'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'staged only\n')
    git(repoPath, ['add', 'tracked.txt'])
    writeFileSync(path.join(repoPath, 'other.txt'), 'unstaged only\n')

    await generateReviewReport(runner, {
      repoPath,
      assistant: 'auto',
      mode: 'quality',
      scope: 'unstaged'
    })

    expect(runner.assistantPrompt).toContain('likely bugs')
    expect(runner.assistantPrompt).toContain('+unstaged only')
    expect(runner.assistantPrompt).not.toContain('+staged only')
  })

  it('reviews branch changes against origin HEAD when available', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: reviewOutput('Branch review complete.')
    })
    const mainSha = git(repoPath, ['rev-parse', 'main'])

    git(repoPath, ['update-ref', 'refs/remotes/origin/trunk', mainSha])
    git(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
    git(repoPath, ['switch', '--quiet', '-c', 'feature/review'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'branch review\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Review branch work'])

    const report = await generateReviewReport(runner, {
      repoPath,
      assistant: 'auto',
      mode: 'security',
      scope: 'branch'
    })

    expect(report.scope).toBe('branch')
    expect(runner.assistantPrompt).toContain('Base branch: trunk')
    expect(runner.assistantPrompt).toContain('Review branch work')
    expect(runner.assistantPrompt).toContain('unsafe shell/process execution')
    expect(runner.assistantPrompt).toContain('+branch review')
  })

  it('returns readable errors for invalid review output and empty review scopes', async () => {
    const invalidRepo = createStagedRepository()
    const invalidRunner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: 'not json'
    })

    await expect(generateReviewReport(invalidRunner, {
      repoPath: invalidRepo,
      assistant: 'auto',
      mode: 'security',
      scope: 'staged'
    })).rejects.toMatchObject({ code: 'assistant_parse_failed' })

    const emptyRepo = createTempRepository()
    const emptyRunner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: reviewOutput('Should not run.')
    })

    await expect(generateReviewReport(emptyRunner, {
      repoPath: emptyRepo,
      assistant: 'auto',
      mode: 'consistency',
      scope: 'staged'
    })).rejects.toMatchObject({ code: 'no_review_changes' })
    expect(emptyRunner.assistantInvocations).toHaveLength(0)
  })

  it('marks oversized review diffs as truncated and keeps Codex read-only', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['codex'],
      assistantOutput: reviewOutput('Large review complete.')
    })

    writeFileSync(path.join(repoPath, 'tracked.txt'), `${'x'.repeat(130_000)}\n`)
    git(repoPath, ['add', 'tracked.txt'])

    const report = await generateReviewReport(runner, {
      repoPath,
      assistant: 'codex',
      mode: 'quality',
      scope: 'staged'
    })

    expect(report.truncated).toBe(true)
    expect(runner.assistantPrompt).toContain('Diff truncated: yes')
    expect(runner.assistantInvocations[0].command).toBe('/tmp/branchpilot-codex')
    expect(runner.assistantInvocations[0].args).toEqual(expect.arrayContaining(['--sandbox', 'read-only']))
    expect(runner.assistantInvocations[0].cwd).not.toBe(repoPath)
  })
})

interface AssistantTestRunnerOptions {
  available: Array<'claude' | 'codex'>
  failingAssistants?: Array<'claude' | 'codex'>
  assistantOutput?: string
}

class AssistantTestRunner extends CommandRunner {
  assistantPrompt = ''
  assistantInvocations: Array<{ command: string; args: string[]; cwd?: string }> = []

  constructor(private readonly options: AssistantTestRunnerOptions) {
    super()
  }

  override async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    if (command === '/usr/bin/which') {
      const executable = args[0] as 'claude' | 'codex'

      if (this.options.available.includes(executable)) {
        return makeResult(command, args, `/tmp/branchpilot-${executable}\n`, '', options.cwd)
      }

      throw new CommandExecutionError(`${executable} not found`, makeResult(command, args, '', 'not found', options.cwd, 1))
    }

    if (command === '/tmp/branchpilot-claude' || command === '/tmp/branchpilot-codex') {
      const assistant = command.endsWith('claude') ? 'claude' : 'codex'
      this.assistantPrompt = options.input ?? ''
      this.assistantInvocations.push({ command, args, cwd: options.cwd })

      if (this.options.failingAssistants?.includes(assistant)) {
        throw new CommandExecutionError(`${assistant} failed`, makeResult(command, args, '', `${assistant} failed`, options.cwd, 1))
      }

      return makeResult(
        command,
        args,
        this.options.assistantOutput ?? '{"title":"Generate commit text","description":"Summarizes staged changes."}',
        '',
        options.cwd
      )
    }

    return super.run(command, args, options)
  }
}

function createTempRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-assistant-test-'))
  tempRoots.push(repoPath)

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Initial commit'])

  return repoPath
}

function createStagedRepository() {
  const repoPath = createTempRepository()
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'staged\n')
  git(repoPath, ['add', 'tracked.txt'])
  return repoPath
}

function reviewOutput(summary: string) {
  return JSON.stringify({
    summary,
    findings: [
      {
        severity: 'medium',
        title: 'Review finding',
        details: 'A concrete review finding.',
        filePath: 'tracked.txt',
        line: 1,
        recommendation: 'Inspect the change before merging.'
      }
    ]
  })
}

function git(cwd: string, args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}

function makeResult(
  command: string,
  args: string[],
  stdout: string,
  stderr: string,
  cwd?: string,
  exitCode = 0
): CommandRunResult {
  return {
    command,
    args,
    cwd,
    exitCode,
    stdout,
    stderr,
    durationMs: 1
  }
}
