import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createBranchPilotMcpServer } from '../electron/mcp/server'
import {
  cleanupTempRoots,
  createLinkedTransports,
  createStoredSnapshot,
  getTextResult
} from './support/projectMemoryMcpTestSupport'

describe('BranchPilot MCP Project Memory bridge', () => {
  afterEach(() => {
    cleanupTempRoots()
  })

  it('registers read-only MCP tools, resources, prompts, and serves project_summary', async () => {
    const { memoryDir, activityDir, wikiDir, repoPath } = await createStoredSnapshot()
    writeFileSync(path.join(repoPath, 'src/App.tsx'), [
      "import React from 'react'",
      "import { ProjectScanner } from './service'",
      '',
      'export function App() {',
      '  return <main data-changed="true" />',
      '}',
      '',
      'export { ProjectScanner }',
      ''
    ].join('\n'))

    const server = createBranchPilotMcpServer({ memoryDir, activityDir, wikiDir, repoPath })
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
      'get_project_health',
      'search_files',
      'search_symbols',
      'get_file_outline',
      'get_symbol_context',
      'get_recent_commits',
      'get_current_git_state',
      'get_repository_status',
      'list_repository_refs',
      'list_repository_files',
      'read_repository_file',
      'search_repository_text',
      'get_repository_diff',
      'search_commit_history',
      'get_commit_details',
      'get_file_history',
      'get_repository_blame',
      'get_agent_activity',
      'get_project_wiki',
      'get_wiki_page'
    ]))
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true)

    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
      'branchpilot://repo/current/summary',
      'branchpilot://repo/current/health',
      'branchpilot://repo/current/live-status',
      'branchpilot://repo/current/worktree',
      'branchpilot://repo/current/refs',
      'branchpilot://repo/current/diff',
      'branchpilot://repo/current/tree',
      'branchpilot://repo/current/symbols',
      'branchpilot://repo/current/commits',
      'branchpilot://repo/current/activity',
      'branchpilot://repo/current/wiki'
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

    const healthResult = await client.callTool({ name: 'get_project_health', arguments: { limit: 5 } })
    expect(JSON.parse(getTextResult(healthResult))).toMatchObject({
      repository: {
        rootPath: repoPath,
        currentBranch: 'main'
      },
      summary: {
        totalFiles: 2
      }
    })

    const statusResult = await client.callTool({ name: 'get_repository_status', arguments: {} })
    expect(JSON.parse(getTextResult(statusResult))).toMatchObject({
      branch: {
        name: 'main'
      },
      counts: {
        changed: 1
      }
    })

    const refsResult = await client.callTool({ name: 'list_repository_refs', arguments: {} })
    expect(JSON.parse(getTextResult(refsResult))).toMatchObject({
      localBranches: expect.arrayContaining([
        expect.objectContaining({ name: 'main' })
      ])
    })

    const filesResult = await client.callTool({ name: 'list_repository_files', arguments: { query: 'src', limit: 10 } })
    expect(JSON.parse(getTextResult(filesResult))).toMatchObject({
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'src/App.tsx' }),
        expect.objectContaining({ path: 'src/service.ts' })
      ])
    })

    const fileResult = await client.callTool({ name: 'read_repository_file', arguments: { path: 'src/App.tsx', maxLines: 20 } })
    expect(JSON.parse(getTextResult(fileResult))).toMatchObject({
      path: 'src/App.tsx',
      text: expect.stringContaining('data-changed')
    })

    const searchResult = await client.callTool({ name: 'search_repository_text', arguments: { query: 'ProjectScanner', limit: 10 } })
    expect(JSON.parse(getTextResult(searchResult))).toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: 'src/App.tsx' })
      ])
    })

    const diffResult = await client.callTool({ name: 'get_repository_diff', arguments: { path: 'src/App.tsx', maxBytes: 20000 } })
    expect(JSON.parse(getTextResult(diffResult))).toMatchObject({
      diff: expect.stringContaining('data-changed')
    })

    const historyResult = await client.callTool({ name: 'search_commit_history', arguments: { limit: 5 } })
    const history = JSON.parse(getTextResult(historyResult))
    expect(history.commits[0]).toMatchObject({
      subject: 'Add MCP fixture'
    })

    const commitResult = await client.callTool({ name: 'get_commit_details', arguments: { ref: 'HEAD', maxBytes: 20000 } })
    expect(JSON.parse(getTextResult(commitResult))).toMatchObject({
      commit: {
        subject: 'Add MCP fixture'
      },
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'src/App.tsx' })
      ])
    })

    const fileHistoryResult = await client.callTool({ name: 'get_file_history', arguments: { path: 'src/service.ts', limit: 5 } })
    expect(JSON.parse(getTextResult(fileHistoryResult))).toMatchObject({
      commits: expect.arrayContaining([
        expect.objectContaining({ subject: 'Add MCP fixture' })
      ])
    })

    const blameResult = await client.callTool({ name: 'get_repository_blame', arguments: { path: 'src/service.ts', startLine: 1, lineCount: 2 } })
    expect(JSON.parse(getTextResult(blameResult))).toMatchObject({
      lines: expect.arrayContaining([
        expect.objectContaining({ author: 'BranchPilot Test' })
      ])
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

    const wikiResult = await client.callTool({ name: 'get_project_wiki', arguments: {} })
    expect(JSON.parse(getTextResult(wikiResult))).toMatchObject({
      pages: expect.arrayContaining([
        expect.objectContaining({ id: 'overview', title: 'Overview' })
      ])
    })

    const wikiPageResult = await client.callTool({ name: 'get_wiki_page', arguments: { pageId: 'overview' } })
    expect(JSON.parse(getTextResult(wikiPageResult))).toMatchObject({
      page: {
        id: 'overview',
        markdown: expect.stringContaining('# Overview')
      }
    })

    await client.close()
    await server.close()
  })
})
