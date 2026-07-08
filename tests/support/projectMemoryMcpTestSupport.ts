import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { ActivityLogService } from '../../electron/lib/activityLogService'
import { GIT_EXECUTABLE } from '../../electron/lib/platformExecutables'
import { ProjectMemoryStore } from '../../electron/lib/projectMemoryService'
import { ProjectWikiStore } from '../../electron/lib/projectWikiService'
import { getAgentActivity, getWikiPage } from '../../electron/mcp/memoryQueries'
import type { ProjectMemorySnapshot, ProjectWikiSnapshot } from '../../src/shared/branchPilot'

const tempRoots: string[] = []

export function cleanupTempRoots() {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
}

export async function createStoredSnapshot(memoryDir = createTempDirectory('branchpilot-mcp-memory-test-')) {
  const repoPath = createTempDirectory('branchpilot-mcp-repo-test-')
  const activityDir = createTempDirectory('branchpilot-mcp-activity-test-')
  const wikiDir = createTempDirectory('branchpilot-mcp-wiki-test-')
  createGitRepositoryFixture(repoPath)
  const snapshot = makeSnapshot(repoPath)
  await new ProjectMemoryStore(memoryDir).write(snapshot)
  await new ProjectWikiStore(wikiDir).write(makeWikiSnapshot(snapshot))
  await new ActivityLogService(activityDir).append({
    repoPath,
    type: 'assistant_review_generated',
    actor: 'assistant',
    status: 'success',
    title: 'Assistant review generated',
    metadata: {
      mode: 'security',
      findings: 2
    }
  })

  await expect(getAgentActivity({ memoryDir, activityDir, repoPath })).resolves.toMatchObject({
    totalCount: 1
  })
  await expect(getWikiPage({ memoryDir, wikiDir, repoPath, pageId: 'overview' })).resolves.toMatchObject({
    page: {
      id: 'overview'
    }
  })

  return {
    memoryDir,
    activityDir,
    wikiDir,
    repoPath,
    snapshot
  }
}

function createGitRepositoryFixture(repoPath: string) {
  mkdirSync(path.join(repoPath, 'src'), { recursive: true })
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
    'export function createScanner() {',
    '  return new ProjectScanner()',
    '}',
    ''
  ].join('\n'))

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  git(repoPath, ['add', '.'])
  git(repoPath, ['commit', '-m', 'Add MCP fixture'])
}

function makeWikiSnapshot(snapshot: ProjectMemorySnapshot): ProjectWikiSnapshot {
  return {
    version: 1,
    generatedAt: '2026-06-04T09:00:00.000Z',
    sourceMemoryScannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    pages: [
      {
        id: 'overview',
        title: 'Overview',
        summary: 'Repository overview.',
        markdown: '# Overview\n\n- BranchPilot MCP wiki fixture.'
      },
      {
        id: 'module_map',
        title: 'Module Map',
        summary: 'Module map.',
        markdown: '# Module Map'
      }
    ]
  }
}

function makeSnapshot(repoPath: string): ProjectMemorySnapshot {
  return {
    version: 1,
    scannedAt: '2026-06-04T08:00:00.000Z',
    repository: {
      id: repositoryId(repoPath),
      rootPath: repoPath,
      name: path.basename(repoPath),
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/branchpilot.git'
    },
    files: [
      {
        path: 'src/App.tsx',
        extension: '.tsx',
        sizeBytes: 1200,
        language: 'React TSX',
        symbolCount: 1,
        importCount: 1
      },
      {
        path: 'src/service.ts',
        extension: '.ts',
        sizeBytes: 900,
        language: 'TypeScript',
        symbolCount: 3,
        importCount: 0
      }
    ],
    symbols: [
      {
        id: 'src/App.tsx:4:component:App',
        name: 'App',
        kind: 'component',
        path: 'src/App.tsx',
        line: 4,
        exported: true
      },
      {
        id: 'src/service.ts:1:class:ProjectScanner',
        name: 'ProjectScanner',
        kind: 'class',
        path: 'src/service.ts',
        line: 1,
        exported: true
      },
      {
        id: 'src/service.ts:2:method:ProjectScanner.scan',
        name: 'scan',
        kind: 'method',
        path: 'src/service.ts',
        line: 2,
        exported: false,
        parentName: 'ProjectScanner'
      },
      {
        id: 'src/service.ts:7:function:createScanner',
        name: 'createScanner',
        kind: 'function',
        path: 'src/service.ts',
        line: 7,
        exported: true
      }
    ],
    imports: [
      {
        path: 'src/App.tsx',
        source: 'react',
        specifiers: ['React'],
        line: 1
      }
    ],
    stackHints: [
      {
        id: 'typescript',
        label: 'TypeScript',
        source: 'tsconfig.json'
      },
      {
        id: 'react',
        label: 'React',
        source: 'package.json'
      }
    ],
    recentCommits: [
      {
        sha: '1111111111111111111111111111111111111111',
        shortSha: '1111111',
        subject: 'Add MCP fixture',
        authorName: 'BranchPilot Test',
        authorEmail: 'branchpilot@example.com',
        authoredAt: '2026-06-04T08:00:00.000Z'
      }
    ]
  }
}

export function createLinkedTransports(): [MemoryTransport, MemoryTransport] {
  const client = new MemoryTransport()
  const server = new MemoryTransport()
  client.peer = server
  server.peer = client
  return [client, server]
}

export class MemoryTransport implements Transport {
  peer?: MemoryTransport
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    queueMicrotask(() => this.peer?.onmessage?.(message))
  }

  async close(): Promise<void> {
    this.onclose?.()
  }
}

export function getTextResult(result: Awaited<ReturnType<Client['callTool']>>): string {
  const first = 'content' in result ? result.content[0] : undefined
  return first?.type === 'text' ? first.text : ''
}

export function createTempDirectory(prefix: string) {
  const directoryPath = mkdtempSync(path.join(tmpdir(), prefix))
  tempRoots.push(directoryPath)
  return directoryPath
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}

function git(cwd: string, args: string[]) {
  return execFileSync(GIT_EXECUTABLE, args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}
