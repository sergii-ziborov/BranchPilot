import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect } from 'vitest'
import { CommandRunner, type CommandRunOptions, type CommandRunResult } from '../../electron/lib/commandRunner'
import { RepositoryService } from '../../electron/lib/repositoryService'
import { SettingsStore } from '../../electron/lib/settingsStore'

export const tempRoots: string[] = []

export function cleanupTempRoots() {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
}

export function createTempRepository() {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-test-'))
  tempRoots.push(repoPath)

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Initial commit'])

  return repoPath
}

export function createConflictedRepository() {
  const repoPath = createTempRepository()

  git(repoPath, ['switch', '--quiet', '-c', 'feature'])
  writeFileSync(path.join(repoPath, 'conflict.txt'), 'feature\n')
  git(repoPath, ['add', 'conflict.txt'])
  git(repoPath, ['commit', '-m', 'Feature change'])

  git(repoPath, ['switch', '--quiet', 'main'])
  writeFileSync(path.join(repoPath, 'conflict.txt'), 'main\n')
  git(repoPath, ['add', 'conflict.txt'])
  git(repoPath, ['commit', '-m', 'Main change'])

  const merge = spawnSync('/usr/bin/git', ['merge', 'feature'], {
    cwd: repoPath,
    encoding: 'utf8'
  })

  expect(merge.status).toBe(1)

  return repoPath
}

export function createMergeConflictReadyRepository() {
  const repoPath = createTempRepository()

  git(repoPath, ['switch', '--quiet', '-c', 'feature/conflict'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'feature\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Feature conflict change'])

  git(repoPath, ['switch', '--quiet', 'main'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'main\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Main conflict change'])

  return repoPath
}

export function createRebaseConflictReadyRepository() {
  const repoPath = createTempRepository()

  git(repoPath, ['switch', '--quiet', '-c', 'feature/rebase-conflict'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'feature\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Feature rebase conflict change'])

  git(repoPath, ['switch', '--quiet', 'main'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'main\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Main rebase conflict change'])

  git(repoPath, ['switch', '--quiet', 'feature/rebase-conflict'])

  return repoPath
}

export function createRemoteBackedRepository() {
  const repoPath = createTempRepository()
  const remotePath = mkdtempSync(path.join(tmpdir(), 'branchpilot-remote-test-'))
  tempRoots.push(remotePath)

  git(remotePath, ['init', '--bare'])
  git(repoPath, ['remote', 'add', 'origin', remotePath])

  return { repoPath, remotePath }
}

export function cloneRemote(remotePath: string) {
  const clonePath = mkdtempSync(path.join(tmpdir(), 'branchpilot-clone-test-'))
  tempRoots.push(clonePath)

  git(tmpdir(), ['clone', '--quiet', '--branch', 'main', remotePath, clonePath])
  git(clonePath, ['config', 'user.name', 'BranchPilot Clone'])
  git(clonePath, ['config', 'user.email', 'clone@example.com'])

  return clonePath
}

export function createService(runner: CommandRunner = new CommandRunner()) {
  const settingsDir = mkdtempSync(path.join(tmpdir(), 'branchpilot-settings-test-'))
  tempRoots.push(settingsDir)

  return new RepositoryService(
    runner,
    new SettingsStore(path.join(settingsDir, 'settings.json'))
  )
}

export class RecordingCommandRunner extends CommandRunner {
  calls: Array<{ command: string; args: string[]; options: CommandRunOptions }> = []

  async run(command: string, args: string[], options: CommandRunOptions = {}): Promise<CommandRunResult> {
    this.calls.push({ command, args, options })
    return super.run(command, args, options)
  }

  reset() {
    this.calls = []
  }
}

export function git(cwd: string, args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}

export function gitWithEnv(cwd: string, args: string[], env: Record<string, string>) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  }).trim()
}
