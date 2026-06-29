import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateReviewReport } from '../electron/assistants/assistantRunner'
import {
  AssistantTestRunner,
  cleanupAssistantTempRoots,
  createStagedRepository,
  createTempRepository,
  git,
  reviewOutput
} from './support/assistantRunnerTestSupport'

describe('assistant review generation', () => {
  afterEach(cleanupAssistantTempRoots)

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
