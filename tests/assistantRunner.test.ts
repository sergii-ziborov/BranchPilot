import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkAssistantStatuses,
  generateBranchDescription,
  generateBranchDraft,
  generateCommitMessage,
  generateLinkedInProject,
  generatePullRequestText,
  generateRepositoryStarter,
  listAssistantStatuses,
  runCodexAgent
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

  it('generates a description for an existing branch from local context', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['codex'],
      assistantOutput: '{"description":"Tracks the branch description generation workflow."}'
    })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'description staged\n')
    git(repoPath, ['add', 'tracked.txt'])

    const result = await generateBranchDescription(runner, {
      repoPath,
      assistant: 'codex',
      branchName: 'main'
    })

    expect(result).toMatchObject({
      branchName: 'main',
      description: 'Tracks the branch description generation workflow.',
      assistant: 'codex',
      truncated: false
    })
    expect(runner.assistantPrompt).toContain('Branch: main')
    expect(runner.assistantPrompt).toContain('+description staged')
  })

  it('generates LinkedIn project fields from repository context', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['claude'],
      assistantOutput: JSON.stringify({
        projectName: 'BranchPilot',
        headline: 'Local-first Git workflow assistant',
        role: 'Desktop app developer',
        startDate: '2026-06',
        endDate: 'Present',
        description: 'Built a local-first desktop Git client with assistant-powered workflow drafting.',
        highlights: ['Implemented Git status and commit workflows', 'Added local assistant integrations'],
        tags: ['Git', 'Electron', 'TypeScript'],
        skills: ['React', 'Electron', 'Git'],
        urlSuggestion: 'https://github.com/example/branchpilot',
        markdown: '# BranchPilot\nLocal-first Git workflow assistant'
      })
    })

    writeFileSync(path.join(repoPath, 'package.json'), '{"dependencies":{"electron":"latest","react":"latest"}}\n')
    writeFileSync(path.join(repoPath, 'README.md'), 'BranchPilot README context\n')
    git(repoPath, ['add', 'package.json', 'README.md'])
    git(repoPath, ['commit', '-m', 'Add project metadata'])

    const result = await generateLinkedInProject(runner, {
      repoPath,
      assistant: 'auto',
      role: 'Creator',
      audience: 'LinkedIn project section',
      customPrompt: 'Avoid product launch tone.'
    })

    expect(result).toMatchObject({
      projectName: 'BranchPilot',
      headline: 'Local-first Git workflow assistant',
      role: 'Desktop app developer',
      startDate: '2026-06',
      endDate: 'Present',
      tags: ['Git', 'Electron', 'TypeScript'],
      skills: ['React', 'Electron', 'Git'],
      assistant: 'claude',
      truncated: false
    })
    expect(runner.assistantPrompt).toContain('LinkedIn Project entry')
    expect(runner.assistantPrompt).toContain('Avoid product launch tone.')
    expect(runner.assistantPrompt).toContain('Add project metadata')
    expect(runner.assistantPrompt).toContain('BranchPilot README context')
    expect(runner.assistantPrompt).toContain('electron')
  })

  it('generates repository starter files including .gitignore', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['codex'],
      assistantOutput: JSON.stringify({
        description: 'A local-first desktop Git client.',
        readme: '# BranchPilot\n\nA local-first desktop Git client.',
        gitignore: 'node_modules/\ndist/\n.env.local\n'
      })
    })

    writeFileSync(path.join(repoPath, 'package.json'), '{"scripts":{"build":"vite build"},"dependencies":{"vite":"latest"}}\n')
    git(repoPath, ['add', 'package.json'])
    git(repoPath, ['commit', '-m', 'Add package metadata'])

    const result = await generateRepositoryStarter(runner, {
      repoPath,
      assistant: 'auto',
      repositoryName: 'BranchPilot'
    })

    expect(result).toMatchObject({
      description: 'A local-first desktop Git client.',
      gitignore: 'node_modules/\ndist/\n.env.local',
      assistant: 'codex',
      truncated: false
    })
    expect(runner.assistantPrompt).toContain('"gitignore":"..."')
    expect(runner.assistantPrompt).toContain('gitignore is required')
    expect(runner.assistantPrompt).toContain('vite build')
  })

  it('rejects branch description generation for missing branches', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['codex'] })

    await expect(generateBranchDescription(runner, {
      repoPath,
      assistant: 'codex',
      branchName: 'feature/missing'
    })).rejects.toMatchObject({
      code: 'invalid_branch'
    })
    expect(runner.assistantInvocations).toHaveLength(0)
  })

  it('rejects invalid branch description assistant output', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({
      available: ['codex'],
      assistantOutput: '{"title":"No description"}'
    })

    await expect(generateBranchDescription(runner, {
      repoPath,
      assistant: 'codex',
      branchName: 'main'
    })).rejects.toMatchObject({
      code: 'assistant_parse_failed'
    })
  })

  it('runs the Codex local agent with sandbox, reasoning, model, and image attachments', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['codex'] })

    await runCodexAgent(runner, {
      repoPath,
      assistant: 'codex:gpt-5',
      prompt: 'Inspect this screenshot.',
      sandbox: 'workspace-write',
      reasoning: 'extra-high',
      images: [{
        name: 'screen.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo='
      }]
    })

    expect(runner.assistantInvocations).toHaveLength(1)
    const invocation = runner.assistantInvocations[0]

    expect(invocation.command).toBe('/tmp/branchpilot-codex')
    expect(path.basename(invocation.cwd ?? '')).toBe(path.basename(repoPath))
    expect(invocation.args).toContain('exec')
    expect(invocation.args).toContain('--model')
    expect(invocation.args).toContain('gpt-5')
    expect(invocation.args).toContain('--sandbox')
    expect(invocation.args).toContain('workspace-write')
    expect(invocation.args).not.toContain('--ask-for-approval')
    expect(invocation.args).toContain('model_reasoning_effort="high"')
    expect(invocation.args).toContain('--image')
    expect(runner.assistantPrompt).toContain('Codex receives attached images through the CLI image channel.')
  })

  it('includes text file attachments in the local agent prompt', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['codex'] })

    await runCodexAgent(runner, {
      repoPath,
      assistant: 'codex',
      prompt: 'Compare this note with the repo.',
      sandbox: 'read-only',
      reasoning: 'medium',
      attachments: [{
        kind: 'text',
        name: 'notes.md',
        mimeType: 'text/markdown',
        sizeBytes: 18,
        text: '# Notes\ncheck this\n'
      }]
    })

    expect(runner.assistantInvocations).toHaveLength(1)
    expect(runner.assistantInvocations[0].args).not.toContain('--image')
    expect(runner.assistantPrompt).toContain('Attachments: 1')
    expect(runner.assistantPrompt).toContain('--- notes.md (text/markdown, 18 bytes) ---')
    expect(runner.assistantPrompt).toContain('# Notes')
  })

  it('runs the Claude local agent with Claude Code access and effort controls', async () => {
    const repoPath = createTempRepository()
    const runner = new AssistantTestRunner({ available: ['claude'] })

    await runCodexAgent(runner, {
      repoPath,
      assistant: 'claude:sonnet',
      prompt: 'Inspect this screenshot.',
      sandbox: 'read-only',
      reasoning: 'extra-high',
      images: [{
        name: 'screen.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo='
      }]
    })

    expect(runner.assistantInvocations).toHaveLength(1)
    const invocation = runner.assistantInvocations[0]

    expect(invocation.command).toBe('/tmp/branchpilot-claude')
    expect(path.basename(invocation.cwd ?? '')).toBe(path.basename(repoPath))
    expect(invocation.args).toContain('--print')
    expect(invocation.args).toContain('--verbose')
    expect(invocation.args).toContain('--model')
    expect(invocation.args).toContain('sonnet')
    expect(invocation.args).toContain('--effort')
    expect(invocation.args).toContain('xhigh')
    expect(invocation.args).toContain('--permission-mode')
    expect(invocation.args).toContain('dontAsk')
    expect(invocation.args).toContain('--allowedTools')
    expect(invocation.args.join(' ')).toContain('Read')
    expect(invocation.args).toContain('--add-dir')
    expect(runner.assistantPrompt).toContain('You are Claude Code running inside BranchPilot')
    expect(runner.assistantPrompt).toContain('Claude image file paths:')
  })

})

