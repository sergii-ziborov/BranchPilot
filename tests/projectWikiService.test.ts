import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityLogService } from '../electron/lib/activityLogService'
import { CommandRunner } from '../electron/lib/commandRunner'
import { GIT_EXECUTABLE, normalizeNativePath } from '../electron/lib/platformExecutables'
import { ProjectMemoryService, ProjectMemoryStore } from '../electron/lib/projectMemoryService'
import { ProjectWikiService, ProjectWikiStore } from '../electron/lib/projectWikiService'

const tempRoots: string[] = []

describe('ProjectWikiService', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('generates readable local wiki pages from Project Memory and activity', async () => {
    const repoPath = createProjectWikiRepository()
    const rootPath = git(repoPath, ['rev-parse', '--show-toplevel'])
    const activityLogService = createActivityLogService()
    const service = createProjectWikiService(activityLogService)

    await activityLogService.append({
      repoPath: rootPath,
      type: 'assistant_review_generated',
      actor: 'assistant',
      status: 'success',
      title: 'Assistant review generated',
      metadata: { mode: 'security', findings: 2 }
    })

    await expect(service.getProjectWiki(repoPath)).resolves.toBeNull()

    const result = await service.generateProjectWiki(repoPath)
    const wiki = result.wiki

    expect(result.memory.scannedFileCount).toBeGreaterThan(0)
    expect(wiki.repository.rootPath).toBe(normalizeNativePath(rootPath))
    expect(wiki.pages.map((page) => page.id)).toEqual([
      'overview',
      'module_map',
      'important_symbols',
      'workflows',
      'assistant_policy',
      'recent_timeline'
    ])
    expect(wiki.pages.find((page) => page.id === 'overview')?.markdown).toContain('React')
    expect(wiki.pages.find((page) => page.id === 'important_symbols')?.markdown).toContain('ProjectScanner')
    expect(wiki.pages.find((page) => page.id === 'workflows')?.markdown).toContain('Assistant Review')
    expect(wiki.pages.find((page) => page.id === 'recent_timeline')?.markdown).toContain('Assistant Review Generated')
    expect(existsSync(path.join(repoPath, 'docs/wiki'))).toBe(false)
  })

  it('persists and reloads wiki snapshots from app-data storage', async () => {
    const repoPath = createProjectWikiRepository()
    const activityLogService = createActivityLogService()
    const storageDir = createTempDirectory('branchpilot-wiki-storage-test-')
    const memoryDir = createTempDirectory('branchpilot-wiki-reload-memory-test-')
    const service = createProjectWikiService(activityLogService, storageDir, memoryDir)

    const generated = await service.generateProjectWiki(repoPath)
    const reloaded = await createProjectWikiService(activityLogService, storageDir, memoryDir).getProjectWiki(repoPath)

    expect(reloaded?.generatedAt).toBe(generated.wiki.generatedAt)
    expect(reloaded?.pages.length).toBe(6)
  })

  it('rejects invalid repository paths before generation', async () => {
    const service = createProjectWikiService(createActivityLogService())

    await expect(service.generateProjectWiki('   ')).rejects.toMatchObject({
      code: 'invalid_repository_path'
    })
  })
})

function createProjectWikiService(
  activityLogService: ActivityLogService,
  wikiDir = createTempDirectory('branchpilot-wiki-test-'),
  memoryDir = createTempDirectory('branchpilot-wiki-memory-test-')
) {
  return new ProjectWikiService(
    new ProjectMemoryService(
      new CommandRunner(),
      new ProjectMemoryStore(memoryDir)
    ),
    activityLogService,
    new ProjectWikiStore(wikiDir)
  )
}

function createActivityLogService() {
  return new ActivityLogService(createTempDirectory('branchpilot-wiki-activity-test-'))
}

function createProjectWikiRepository() {
  const repoPath = createTempDirectory('branchpilot-wiki-repo-test-')
  mkdirSync(path.join(repoPath, 'src'), { recursive: true })
  mkdirSync(path.join(repoPath, 'electron/lib'), { recursive: true })

  writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
    dependencies: {
      react: '^19.0.0'
    },
    devDependencies: {
      electron: '^42.0.0',
      typescript: '^6.0.0',
      vite: '^8.0.0'
    }
  }, null, 2))
  writeFileSync(path.join(repoPath, 'src/App.tsx'), [
    "import React from 'react'",
    "import { ProjectScanner } from './service'",
    '',
    'export function App() {',
    '  return <main />',
    '}',
    '',
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
    'export function createScanner() {',
    '  return new ProjectScanner()',
    '}',
    ''
  ].join('\n'))
  writeFileSync(path.join(repoPath, 'electron/lib/repositoryService.ts'), 'export const repositoryService = true\n')

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  git(repoPath, ['add', '.'])
  git(repoPath, ['commit', '-m', 'Add wiki fixture'])

  return repoPath
}

function createTempDirectory(prefix: string) {
  const directoryPath = mkdtempSync(path.join(tmpdir(), prefix))
  tempRoots.push(directoryPath)
  return directoryPath
}

function git(cwd: string, args: string[]) {
  return execFileSync(GIT_EXECUTABLE, args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}
