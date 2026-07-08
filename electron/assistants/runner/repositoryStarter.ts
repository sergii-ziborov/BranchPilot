import path from 'node:path'
import type {
  GeneratedRepositoryStarter,
  RepositoryStarterGenerationRequest
} from '../../../src/shared/branchPilot.js'
import { CommandRunner } from '../../lib/commandRunner.js'
import { GIT_EXECUTABLE } from '../../lib/platformExecutables.js'
import {
  MAX_ASSISTANT_STARTER_CONTEXT_BYTES,
  REPOSITORY_STARTER_SCHEMA
} from '../assistantRunner.schemas.js'
import { buildRepositoryStarterPrompt, truncateText } from '../assistantRunner.prompts.js'
import { parseRepositoryStarter } from '../assistantRunner.parsers.js'
import {
  getBranchLabel,
  readFirstExistingFile,
  readOptionalFile,
  resolveRepositoryRoot
} from '../assistantRunner.context.js'
import { runAssistantForRequest } from '../assistantRunner.exec.js'

export async function generateRepositoryStarter(
  runner: CommandRunner,
  request: RepositoryStarterGenerationRequest
): Promise<GeneratedRepositoryStarter> {
  const rootPath = await resolveRepositoryRoot(runner, request.repoPath)
  const repositoryName = request.repositoryName?.trim() || path.basename(rootPath)
  const currentBranch = await getBranchLabel(runner, rootPath)
  const status = await runner.run(GIT_EXECUTABLE, ['status', '--short'], {
    cwd: rootPath,
    timeoutMs: 10_000
  })
  const recentCommits = await runner.run(GIT_EXECUTABLE, [
    'log',
    '--max-count=20',
    '--pretty=format:%h%x00%s%x00%an'
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
  const pyproject = await readOptionalFile(path.join(rootPath, 'pyproject.toml'), 10_000)
  const cargoToml = await readOptionalFile(path.join(rootPath, 'Cargo.toml'), 10_000)
  const goMod = await readOptionalFile(path.join(rootPath, 'go.mod'), 8_000)
  const readme = await readFirstExistingFile(rootPath, ['README.md', 'readme.md', 'README.txt'], 20_000)
  const gitignore = await readOptionalFile(path.join(rootPath, '.gitignore'), 12_000)
  const context = truncateText([
    `Repository: ${repositoryName}`,
    `Current branch: ${currentBranch}`,
    '',
    'Git status:',
    status.stdout || '(clean)',
    '',
    'Recent commits:',
    recentCommits.stdout || '(none)',
    '',
    'Tracked files:',
    trackedFiles.stdout.split('\n').slice(0, 320).join('\n') || '(none)',
    '',
    'package.json:',
    packageJson || '(not found)',
    '',
    'pyproject.toml:',
    pyproject || '(not found)',
    '',
    'Cargo.toml:',
    cargoToml || '(not found)',
    '',
    'go.mod:',
    goMod || '(not found)',
    '',
    'Existing README:',
    readme || '(not found)',
    '',
    'Existing .gitignore:',
    gitignore || '(not found)'
  ].join('\n'), MAX_ASSISTANT_STARTER_CONTEXT_BYTES)
  const prompt = buildRepositoryStarterPrompt({
    repositoryName,
    currentBranch,
    context: context.text,
    truncated: context.truncated
  })
  const { assistant, output } = await runAssistantForRequest(runner, request.assistant, prompt, REPOSITORY_STARTER_SCHEMA)
  const parsed = parseRepositoryStarter(output)

  return {
    ...parsed,
    assistant: assistant.id,
    truncated: context.truncated
  }
}
