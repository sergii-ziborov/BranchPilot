import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateBranchDescription,
  generateBranchDraft,
  generateLinkedInProject,
  generateRepositoryStarter
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
