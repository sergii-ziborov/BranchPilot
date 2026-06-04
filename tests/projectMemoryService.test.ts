import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandRunner } from '../electron/lib/commandRunner'
import { ProjectMemoryService, ProjectMemoryStore } from '../electron/lib/projectMemoryService'

const tempRoots: string[] = []

describe('ProjectMemoryService', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('scans repository files, stack hints, symbols, imports, and recent commits', async () => {
    const repoPath = createProjectMemoryRepository()
    const service = createService()

    const result = await service.scanProjectMemory(repoPath)
    const snapshot = result.snapshot

    expect(result.scannedFileCount).toBeGreaterThan(0)
    expect(snapshot.repository.name).toBe(path.basename(repoPath))
    expect(snapshot.repository.currentBranch).toBe('main')
    expect(snapshot.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      'package.json',
      'src/App.tsx',
      'src/service.ts'
    ]))
    expect(snapshot.files.map((file) => file.path)).not.toContain('node_modules/ignored.ts')
    expect(snapshot.files.map((file) => file.path)).not.toContain('dist/generated.ts')
    expect(snapshot.stackHints.map((hint) => hint.label)).toEqual(expect.arrayContaining([
      'Node.js',
      'TypeScript',
      'React',
      'Electron',
      'Vite',
      'Vitest'
    ]))
    expect(snapshot.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'src/App.tsx',
        source: 'react'
      })
    ]))
    expect(snapshot.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'App',
        kind: 'component',
        path: 'src/App.tsx',
        exported: true
      }),
      expect.objectContaining({
        name: 'ProjectScanner',
        kind: 'class',
        path: 'src/service.ts',
        exported: true
      }),
      expect.objectContaining({
        name: 'scan',
        kind: 'method',
        parentName: 'ProjectScanner',
        path: 'src/service.ts'
      })
    ]))
    expect(snapshot.recentCommits[0].subject).toBe('Add project memory fixture')
  })

  it('persists and reloads snapshots from app-data storage', async () => {
    const repoPath = createProjectMemoryRepository()
    const storageDir = createTempDirectory('branchpilot-memory-storage-test-')
    const service = new ProjectMemoryService(new CommandRunner(), new ProjectMemoryStore(storageDir))

    await expect(service.getProjectMemory(repoPath)).resolves.toBeNull()

    const scanned = await service.scanProjectMemory(repoPath)
    const reloaded = await new ProjectMemoryService(
      new CommandRunner(),
      new ProjectMemoryStore(storageDir)
    ).getProjectMemory(repoPath)

    expect(reloaded?.repository.id).toBe(scanned.snapshot.repository.id)
    expect(reloaded?.symbols.length).toBe(scanned.snapshot.symbols.length)
  })

  it('returns null for invalid stored JSON', async () => {
    const repoPath = createProjectMemoryRepository()
    const storageDir = createTempDirectory('branchpilot-memory-invalid-test-')
    const service = new ProjectMemoryService(new CommandRunner(), new ProjectMemoryStore(storageDir))
    const scanned = await service.scanProjectMemory(repoPath)
    const storageFile = path.join(storageDir, `${scanned.snapshot.repository.id}.json`)

    expect(readFileSync(storageFile, 'utf8')).toContain('ProjectScanner')
    writeFileSync(storageFile, '{ invalid json', 'utf8')

    await expect(service.getProjectMemory(repoPath)).resolves.toBeNull()
  })
})

function createProjectMemoryRepository() {
  const repoPath = createTempDirectory('branchpilot-memory-repo-test-')
  mkdirSync(path.join(repoPath, 'src'), { recursive: true })
  mkdirSync(path.join(repoPath, 'electron'), { recursive: true })
  mkdirSync(path.join(repoPath, 'node_modules'), { recursive: true })
  mkdirSync(path.join(repoPath, 'dist'), { recursive: true })

  writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
    dependencies: {
      react: '^19.0.0'
    },
    devDependencies: {
      electron: '^42.0.0',
      typescript: '^6.0.0',
      vite: '^8.0.0',
      vitest: '^4.0.0'
    }
  }, null, 2))
  writeFileSync(path.join(repoPath, 'tsconfig.json'), '{}')
  writeFileSync(path.join(repoPath, 'vite.config.ts'), 'export default {}\n')
  writeFileSync(path.join(repoPath, 'electron/main.ts'), 'export const mainProcess = true\n')
  writeFileSync(path.join(repoPath, 'src/App.tsx'), [
    "import React from 'react'",
    "import { ProjectScanner } from './service'",
    '',
    'export function App() {',
    '  return <main />',
    '}',
    '',
    'export const Header = () => <header />',
    'export { ProjectScanner }',
    ''
  ].join('\n'))
  writeFileSync(path.join(repoPath, 'src/service.ts'), [
    'export class ProjectScanner {',
    '  scan(target: string): string {',
    '    return target',
    '  }',
    '}',
    '',
    'export type ScanMode = "full" | "partial"',
    'export const createScanner = () => new ProjectScanner()',
    ''
  ].join('\n'))
  writeFileSync(path.join(repoPath, 'node_modules/ignored.ts'), 'export const ignored = true\n')
  writeFileSync(path.join(repoPath, 'dist/generated.ts'), 'export const generated = true\n')
  writeFileSync(path.join(repoPath, 'binary.dat'), Buffer.from([0, 1, 2, 3]))

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  git(repoPath, ['add', '.'])
  git(repoPath, ['commit', '-m', 'Add project memory fixture'])

  return repoPath
}

function createService() {
  return new ProjectMemoryService(
    new CommandRunner(),
    new ProjectMemoryStore(createTempDirectory('branchpilot-memory-test-'))
  )
}

function createTempDirectory(prefix: string) {
  const directoryPath = mkdtempSync(path.join(tmpdir(), prefix))
  tempRoots.push(directoryPath)
  return directoryPath
}

function git(cwd: string, args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}
