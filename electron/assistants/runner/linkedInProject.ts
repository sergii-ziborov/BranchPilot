import path from 'node:path'
import type {
  GeneratedLinkedInProject,
  LinkedInProjectGenerationRequest
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'
import {
  LINKEDIN_PROJECT_SCHEMA,
  MAX_ASSISTANT_LINKEDIN_CONTEXT_BYTES
} from '../assistantRunner.schemas.js'
import { buildLinkedInProjectPrompt, truncateText } from '../assistantRunner.prompts.js'
import { parseLinkedInProject } from '../assistantRunner.parsers.js'
import {
  getBranchLabel,
  readFirstExistingFile,
  readOptionalFile,
  resolveRepositoryRoot
} from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

export async function generateLinkedInProject(
  runner: CommandRunner,
  request: LinkedInProjectGenerationRequest
): Promise<GeneratedLinkedInProject> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const repositoryName = path.basename(rootPath)
  const currentBranch = await getBranchLabel(runner, rootPath)
  const remote = await runner.run(GIT_EXECUTABLE, ['remote', 'get-url', 'origin'], {
    cwd: rootPath,
    allowedExitCodes: [0, 2],
    timeoutMs: 10_000
  })
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--max-count=25',
    '--date=format:%Y-%m',
    '--pretty=format:%h%x00%s%x00%an%x00%ad'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const commitDates = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--reverse',
    '--date=format:%Y-%m',
    '--pretty=format:%ad'
  ], {
    cwd: rootPath,
    allowedExitCodes: [0, 128],
    timeoutMs: 30_000
  })
  const trackedFiles = await runner.run(GIT_EXECUTABLE, ['ls-files'], {
    cwd: rootPath,
    allowedExitCodes: [0],
    timeoutMs: 30_000
  })
  const packageJson = await readOptionalFile(path.join(rootPath, 'package.json'), 12_000)
  const readme = await readFirstExistingFile(rootPath, ['README.md', 'readme.md', 'README.txt'], 20_000)
  const dates = commitDates.stdout.split('\n').map((date) => date.trim()).filter(Boolean)
  const context = truncateText([
    `Repository: ${repositoryName}`,
    `Current branch: ${currentBranch}`,
    `Remote URL: ${remote.stdout.trim() || '(none)'}`,
    `Suggested project URL: ${request.projectUrl?.trim() || remote.stdout.trim() || '(none)'}`,
    `Preferred role: ${request.role?.trim() || '(infer from repository context)'}`,
    `Audience: ${request.audience?.trim() || 'LinkedIn project section'}`,
    `User generation preferences: ${request.customPrompt?.trim() || '(default BranchPilot LinkedIn project style)'}`,
    `Suggested date range: ${dates[0] ?? '(unknown start)'} to ${dates[dates.length - 1] ?? 'Present'}`,
    '',
    'Git status:',
    status.stdout || '(clean)',
    '',
    'Recent commits:',
    recentCommits.stdout || '(none)',
    '',
    'Tracked files:',
    trackedFiles.stdout.split('\n').slice(0, 240).join('\n') || '(none)',
    '',
    'package.json:',
    packageJson || '(not found)',
    '',
    'README:',
    readme || '(not found)'
  ].join('\n'), MAX_ASSISTANT_LINKEDIN_CONTEXT_BYTES)
  const prompt = buildLinkedInProjectPrompt({
    repositoryName,
    currentBranch,
    context: context.text,
    truncated: context.truncated,
    customPrompt: request.customPrompt
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, LINKEDIN_PROJECT_SCHEMA)
  const parsed = parseLinkedInProject(output)

  return {
    ...parsed,
    assistant: assistant.id,
    truncated: context.truncated
  }
}
