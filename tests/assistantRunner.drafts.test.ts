import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateBranchDescription,
  generateBranchDraft,
  generateLinkedInProject,
  generateRepositoryStarter,
  runCodexAgent
} from '../electron/assistants/assistantRunner'
import {
  AssistantTestRunner,
  cleanupAssistantTempRoots,
  createTempRepository,
  git
} from './support/assistantRunnerTestSupport'

describe('assistant draft generation', () => {
  afterEach(cleanupAssistantTempRoots)

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

})

describe('assistant local agent runs', () => {
  afterEach(cleanupAssistantTempRoots)

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
