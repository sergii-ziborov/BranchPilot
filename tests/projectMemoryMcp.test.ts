import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { ActivityLogService } from '../electron/lib/activityLogService'
import { ProjectMemoryStore } from '../electron/lib/projectMemoryService'
import { createProjectMemoryMcpConfig } from '../electron/mcp/config'
import {
  getAgentActivity,
  getFileOutline,
  loadProjectMemorySnapshot,
  searchFiles,
  searchSymbols
} from '../electron/mcp/memoryQueries'
import { createBranchPilotMcpServer, parseMcpServerArgs } from '../electron/mcp/server'
import type { ProjectMemorySnapshot } from '../src/shared/branchPilot'

const tempRoots: string[] = []

describe('BranchPilot MCP Project Memory bridge', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
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

  it('reports missing and malformed snapshots clearly', async () => {
    const memoryDir = createTempDirectory('branchpilot-mcp-missing-test-')
    const repoPath = '/tmp/missing-repo'

    await expect(loadProjectMemorySnapshot({ memoryDir, repoPath })).rejects.toThrow('No Project Memory snapshot found')

    const { snapshot } = await createStoredSnapshot(memoryDir)
    const storageFile = path.join(memoryDir, `${snapshot.repository.id}.json`)
    writeFileSync(storageFile, '{ malformed json', 'utf8')

    await expect(loadProjectMemorySnapshot({ memoryDir, repoPath: snapshot.repository.rootPath })).rejects.toThrow('malformed')
  })

  it('creates a Codex MCP command and TOML config without mutating Codex settings', async () => {
    const config = await createProjectMemoryMcpConfig({
      memoryDir: '/Users/example/Library/Application Support/BranchPilot/project-memory',
      activityDir: '/Users/example/Library/Application Support/BranchPilot/activity-log',
      repoPath: '/Users/example/dev/BranchPilot',
      serverPath: '/Users/example/dev/BranchPilot/dist-electron/electron/mcp/server.js'
    })

    expect(config.codexCommand).toContain('codex mcp add branchpilot -- node')
    expect(config.codexCommand).toContain('--memory-dir')
    expect(config.codexCommand).toContain('--activity-dir')
    expect(config.codexToml).toContain('[mcp_servers.branchpilot]')
    expect(config.codexToml).toContain('default_tools_approval_mode = "auto"')
    expect(config.serverExists).toBe(false)
  })

  it('registers read-only MCP tools, resources, prompts, and serves project_summary', async () => {
    const { memoryDir, activityDir, repoPath } = await createStoredSnapshot()
    const server = createBranchPilotMcpServer({ memoryDir, activityDir, repoPath })
    const client = new Client({
      name: 'branchpilot-test-client',
      version: '0.0.0'
    })
    const [clientTransport, serverTransport] = createLinkedTransports()

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    expect(client.getInstructions()).toContain('read-only Project Memory')

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'project_summary',
      'search_files',
      'search_symbols',
      'get_file_outline',
      'get_symbol_context',
      'get_recent_commits',
      'get_current_git_state',
      'get_agent_activity'
    ]))
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true)

    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
      'branchpilot://repo/current/summary',
      'branchpilot://repo/current/tree',
      'branchpilot://repo/current/symbols',
      'branchpilot://repo/current/commits',
      'branchpilot://repo/current/activity'
    ]))

    const prompts = await client.listPrompts()
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(expect.arrayContaining([
      'review-current-work',
      'prepare-change-plan',
      'explain-module',
      'summarize-recent-work'
    ]))

    const result = await client.callTool({ name: 'project_summary', arguments: {} })
    const text = getTextResult(result)

    expect(JSON.parse(text)).toMatchObject({
      repository: {
        rootPath: repoPath,
        currentBranch: 'main'
      },
      counts: {
        files: 2,
        symbols: 4,
        recentActivity: 1
      }
    })

    const activityResult = await client.callTool({ name: 'get_agent_activity', arguments: { limit: 10 } })
    expect(JSON.parse(getTextResult(activityResult))).toMatchObject({
      totalCount: 1,
      entries: [
        expect.objectContaining({
          type: 'assistant_review_generated',
          actor: 'assistant'
        })
      ]
    })

    await client.close()
    await server.close()
  })

  it('requires --memory-dir when parsing server args', () => {
    expect(() => parseMcpServerArgs(['--repo', '/repo'])).toThrow('Missing required --memory-dir')
    expect(parseMcpServerArgs(['--memory-dir', '/memory', '--activity-dir', '/activity', '--repo', '/repo'])).toEqual({
      memoryDir: '/memory',
      activityDir: '/activity',
      repoPath: '/repo'
    })
  })
})

async function createStoredSnapshot(memoryDir = createTempDirectory('branchpilot-mcp-memory-test-')) {
  const repoPath = createTempDirectory('branchpilot-mcp-repo-test-')
  const activityDir = createTempDirectory('branchpilot-mcp-activity-test-')
  const snapshot = makeSnapshot(repoPath)
  await new ProjectMemoryStore(memoryDir).write(snapshot)
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

  return {
    memoryDir,
    activityDir,
    repoPath,
    snapshot
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

function createLinkedTransports(): [MemoryTransport, MemoryTransport] {
  const client = new MemoryTransport()
  const server = new MemoryTransport()
  client.peer = server
  server.peer = client
  return [client, server]
}

class MemoryTransport implements Transport {
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

function getTextResult(result: Awaited<ReturnType<Client['callTool']>>): string {
  const first = 'content' in result ? result.content[0] : undefined
  return first?.type === 'text' ? first.text : ''
}

function createTempDirectory(prefix: string) {
  const directoryPath = mkdtempSync(path.join(tmpdir(), prefix))
  tempRoots.push(directoryPath)
  return directoryPath
}

function repositoryId(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 16)
}
