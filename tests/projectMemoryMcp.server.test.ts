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

    const instructions = client.getInstructions() ?? ''
    expect(instructions).toContain('read-only')
    expect(instructions).toContain('Project Memory')
    // Code-structure/search work is delegated to the repo-lens server.
    expect(instructions).toContain('repo-lens')

    const tools = await client.listTools()
    const toolNames = tools.tools.map((tool) => tool.name)
    expect(toolNames).toEqual(expect.arrayContaining([
      'project_summary',
      'get_project_health',
      'get_live_overview',
      'get_recent_commits',
      'get_current_git_state',
      'get_repository_status',
      'list_repository_refs',
      'list_repository_files',
      'read_repository_file',
      'get_repository_diff',
      'get_ci_status',
      'get_pull_request',
      'list_pull_requests',
      'search_commit_history',
      'get_commit_details',
      'get_file_history',
      'get_repository_blame',
      'get_agent_activity',
      'record_session_note',
      'get_project_wiki',
      'get_wiki_page'
    ]))
    // Structure/search tools now belong to the repo-lens "graphify" server and must not be re-added here.
    for (const removed of ['search_files', 'search_symbols', 'get_file_outline', 'get_symbol_context', 'search_repository_text']) {
      expect(toolNames).not.toContain(removed)
    }
    // record_session_note is the single write tool (BranchPilot's own ledger); everything else stays read-only.
    expect(tools.tools.filter((tool) => tool.name !== 'record_session_note').every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.tools.find((tool) => tool.name === 'record_session_note')?.annotations?.readOnlyHint).toBe(false)
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

    // Deep paging: a startLine past line 1 must still resolve (regression guard for large-file paging).
    const pagedResult = await client.callTool({ name: 'read_repository_file', arguments: { path: 'src/App.tsx', startLine: 4, maxLines: 2 } })
    expect(JSON.parse(getTextResult(pagedResult))).toMatchObject({
      startLine: 4,
      lineCount: 2,
      hasMore: true,
      text: expect.stringContaining('data-changed')
    })

    const diffResult = await client.callTool({ name: 'get_repository_diff', arguments: { path: 'src/App.tsx', maxBytes: 20000 } })
    expect(JSON.parse(getTextResult(diffResult))).toMatchObject({
      diff: expect.stringContaining('data-changed')
    })

    // Untracked files never appear in git diff output, so working-tree diffs must list them explicitly.
    writeFileSync(path.join(repoPath, 'notes.md'), '# scratch notes\n')

    const nameOnlyDiff = await client.callTool({ name: 'get_repository_diff', arguments: { format: 'name-only' } })
    expect(JSON.parse(getTextResult(nameOnlyDiff))).toMatchObject({
      format: 'name-only',
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'src/App.tsx' })
      ]),
      untracked: expect.arrayContaining(['notes.md']),
      untrackedCount: 1
    })

    const statDiff = await client.callTool({ name: 'get_repository_diff', arguments: { format: 'stat', path: 'src/App.tsx' } })
    const statPayload = JSON.parse(getTextResult(statDiff))
    expect(statPayload).toMatchObject({ format: 'stat', stat: expect.stringContaining('App.tsx') })
    expect(statPayload.diff).toBeUndefined()

    const overviewResult = await client.callTool({ name: 'get_live_overview', arguments: {} })
    expect(JSON.parse(getTextResult(overviewResult))).toMatchObject({
      branch: { name: 'main' },
      clean: false,
      refs: expect.objectContaining({ localBranchCount: 1 }),
      recentCommits: [expect.objectContaining({ subject: 'Add MCP fixture' })],
      health: expect.objectContaining({ summary: expect.objectContaining({ totalFiles: 2 }) })
    })

    const historyResult = await client.callTool({ name: 'search_commit_history', arguments: { limit: 5 } })
    const history = JSON.parse(getTextResult(historyResult))
    expect(history.commits[0]).toMatchObject({
      subject: 'Add MCP fixture'
    })

    const authoredResult = await client.callTool({ name: 'search_commit_history', arguments: { author: 'BranchPilot Test', limit: 5 } })
    expect(JSON.parse(getTextResult(authoredResult)).commits).toHaveLength(1)

    const unmatchedAuthorResult = await client.callTool({ name: 'search_commit_history', arguments: { author: 'Nobody Anywhere', limit: 5 } })
    expect(JSON.parse(getTextResult(unmatchedAuthorResult)).commits).toHaveLength(0)

    const beforeEpochResult = await client.callTool({ name: 'search_commit_history', arguments: { until: '2000-01-01', limit: 5 } })
    expect(JSON.parse(getTextResult(beforeEpochResult)).commits).toHaveLength(0)

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

    const recentActivityResult = await client.callTool({ name: 'get_agent_activity', arguments: { since: '2000-01-01', limit: 10 } })
    expect(JSON.parse(getTextResult(recentActivityResult)).entries).toHaveLength(1)

    const ancientActivityResult = await client.callTool({ name: 'get_agent_activity', arguments: { until: '2000-01-01', limit: 10 } })
    expect(JSON.parse(getTextResult(ancientActivityResult)).entries).toHaveLength(0)

    // Session journal round-trip: a crashed/new session must be able to see what earlier work started.
    const noteResult = await client.callTool({ name: 'record_session_note', arguments: { title: 'Full vitest run', phase: 'started', detail: 'npx vitest run' } })
    expect(JSON.parse(getTextResult(noteResult))).toMatchObject({
      recorded: true,
      entry: expect.objectContaining({ type: 'assistant_session_note', actor: 'assistant', status: 'success' })
    })

    const noteReadback = await client.callTool({ name: 'get_agent_activity', arguments: { types: ['assistant_session_note'], limit: 10 } })
    expect(JSON.parse(getTextResult(noteReadback)).entries).toEqual([
      expect.objectContaining({
        title: 'Full vitest run',
        metadata: expect.objectContaining({ phase: 'started', detail: 'npx vitest run' })
      })
    ])

    const wikiResult = await client.callTool({ name: 'get_project_wiki', arguments: {} })
    expect(JSON.parse(getTextResult(wikiResult))).toMatchObject({
      pages: expect.arrayContaining([
        expect.objectContaining({ id: 'overview', title: 'Overview' })
      ])
    })

    // The fixture repo has no GitHub remote (and CI may lack gh entirely) — the GitHub tools must fail
    // with a clean tool error, not crash the server.
    const prResult = await client.callTool({ name: 'get_pull_request', arguments: {} })
    expect(prResult.isError).toBe(true)

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
