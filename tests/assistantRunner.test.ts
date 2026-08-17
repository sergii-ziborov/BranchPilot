import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkAssistantStatuses,
  generateCommitMessage,
  generatePullRequestText,
  listAssistantStatuses
} from '../electron/assistants/assistantRunner'
import {
  AssistantTestRunner,
  cleanupAssistantTempRoots,
  createStagedRepository,
  createTempRepository,
  git
} from './support/assistantRunnerTestSupport'

describe('assistant commit message generation', () => {
  afterEach(cleanupAssistantTempRoots)

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

  it('summarizes noisy Codex usage-limit health failures with reset time', async () => {
    const runner = new AssistantTestRunner({
      available: ['codex'],
      failingAssistants: ['codex'],
      assistantFailureOutput: [
        '2026-07-07T08:36:20.372660Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\\"OAuth\\", error=\\"invalid_token\\"" })',
        "ERROR You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:52 AM.",
        "ERROR You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:52 AM."
      ].join('\n')
    })

    const statuses = await checkAssistantStatuses(runner)
    const codex = statuses.find((status) => status.id === 'codex')

    expect(codex).toEqual(expect.objectContaining({
      detected: true,
      state: 'unavailable'
    }))
    expect(codex?.message).toContain("You've hit your usage limit - resets 11:52 AM")
    expect(codex?.message).not.toContain('rmcp::transport')
    expect(codex?.message).not.toContain('invalid_token')
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
    expect(runner.assistantInvocations[0].args).toEqual(expect.arrayContaining(['--tools', '""']))
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


  it('reports a signed-out CLI with the sign-in step instead of a generic failure', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      failingAssistants: ['claude'],
      assistantFailureOutput: 'Not logged in · Please run /login'
    })

    await expect(generateCommitMessage(runner, { repoPath, assistant: 'claude' })).rejects.toMatchObject({
      code: 'assistant_signed_out',
      message: 'Claude Code is not signed in. Run "claude" in a terminal and sign in with /login, then try again.'
    })
  })

  it('falls back to Codex in auto mode when Claude is signed out', async () => {
    const repoPath = createStagedRepository()
    const runner = new AssistantTestRunner({
      available: ['claude', 'codex'],
      failingAssistants: ['claude'],
      assistantFailureOutput: 'Not logged in · Please run /login'
    })

    const result = await generateCommitMessage(runner, { repoPath, assistant: 'auto' })

    expect(result.assistant).toBe('codex')
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

})
