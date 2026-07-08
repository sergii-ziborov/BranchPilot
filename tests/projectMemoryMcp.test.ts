import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectMemoryStore } from '../electron/lib/projectMemoryService'
import {
  getFileOutline,
  getProjectHealth,
  getProjectWiki,
  loadProjectMemorySnapshot,
  searchFiles,
  searchSymbols
} from '../electron/mcp/memoryQueries'
import type { ProjectMemorySnapshot } from '../src/shared/branchPilot'
import {
  cleanupTempRoots,
  createStoredSnapshot,
  createTempDirectory
} from './support/projectMemoryMcpTestSupport'

describe('BranchPilot MCP Project Memory bridge', () => {
  afterEach(() => {
    cleanupTempRoots()
  })

  it('loads Project Memory snapshots and searches indexed files and symbols', async () => {
    const { memoryDir, repoPath } = await createStoredSnapshot()

    await expect(loadProjectMemorySnapshot({ memoryDir, repoPath })).resolves.toMatchObject({
      repository: {
        rootPath: repoPath,
        currentBranch: 'main'
      }
    })

    await expect(searchFiles({ memoryDir, repoPath, query: 'app', limit: 10 })).resolves.toMatchObject({
      files: [
        expect.objectContaining({ path: 'src/App.tsx' })
      ]
    })
    await expect(searchSymbols({ memoryDir, repoPath, query: 'scanner' })).resolves.toMatchObject({
      symbols: expect.arrayContaining([
        expect.objectContaining({ name: 'ProjectScanner', kind: 'class' }),
        expect.objectContaining({ name: 'createScanner', kind: 'function' })
      ])
    })
    await expect(getFileOutline({ memoryDir, repoPath, path: 'src/service.ts' })).resolves.toMatchObject({
      symbols: expect.arrayContaining([
        expect.objectContaining({ name: 'ProjectScanner' }),
        expect.objectContaining({ name: 'scan', parentName: 'ProjectScanner' })
      ])
    })
  })

  it('summarizes Project Memory health signals for MCP planning', async () => {
    const { memoryDir, repoPath, snapshot } = await createStoredSnapshot()
    const heavySnapshot: ProjectMemorySnapshot = {
      ...snapshot,
      files: [
        ...snapshot.files,
        {
          path: 'src/heavy.ts',
          extension: '.ts',
          sizeBytes: 650_000,
          language: 'TypeScript',
          symbolCount: 90,
          importCount: 32
        },
        {
          path: 'package-lock.json',
          extension: '.json',
          sizeBytes: 294_600,
          language: 'JSON',
          symbolCount: 0,
          importCount: 0
        }
      ],
      symbols: [
        ...snapshot.symbols,
        {
          id: 'src/heavy.ts:1:function:heavyWork',
          name: 'heavyWork',
          kind: 'function',
          path: 'src/heavy.ts',
          line: 1,
          exported: true
        }
      ],
      imports: [
        ...snapshot.imports,
        {
          path: 'src/heavy.ts',
          source: 'react',
          specifiers: ['React'],
          line: 1
        }
      ]
    }

    await new ProjectMemoryStore(memoryDir).write(heavySnapshot)

    const health = await getProjectHealth({ memoryDir, repoPath, limit: 10 })

    expect(health.summary).toMatchObject({
      totalFiles: 4,
      criticalFiles: 1,
      warningFiles: 1
    })
    expect(health.files[0]).toMatchObject({
      path: 'src/heavy.ts',
      severity: 'critical'
    })
    expect(health.files[0].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'large-file',
      'dense-symbols',
      'dense-imports'
    ]))
    expect(health.files).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'package-lock.json',
        severity: 'warning'
      })
    ]))
  })

  it('reports missing and malformed snapshots clearly', async () => {
    const memoryDir = createTempDirectory('branchpilot-mcp-missing-test-')
    const repoPath = '/tmp/missing-repo'

    await expect(loadProjectMemorySnapshot({ memoryDir, repoPath })).rejects.toThrow('No Project Memory snapshot found')

    const { snapshot } = await createStoredSnapshot(memoryDir)
    for (const entry of readdirSync(memoryDir).filter((name) => name.endsWith('.json'))) {
      writeFileSync(path.join(memoryDir, entry), '{ malformed json', 'utf8')
    }

    await expect(loadProjectMemorySnapshot({ memoryDir, repoPath: snapshot.repository.rootPath })).rejects.toThrow('malformed')
  })

  it('reports missing Project Wiki snapshots clearly', async () => {
    const { memoryDir, repoPath } = await createStoredSnapshot()
    const wikiDir = createTempDirectory('branchpilot-mcp-empty-wiki-test-')

    await expect(getProjectWiki({ memoryDir, wikiDir, repoPath })).rejects.toThrow('No Project Wiki snapshot found')
  })
})
