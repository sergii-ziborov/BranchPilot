import { describe, expect, it } from 'vitest'
import { createProjectMemoryMcpConfig } from '../electron/mcp/config'
import { parseMcpServerArgs } from '../electron/mcp/server'

describe('BranchPilot MCP Project Memory bridge', () => {
  it('creates a Codex MCP command and TOML config without mutating Codex settings', async () => {
    const config = await createProjectMemoryMcpConfig({
      memoryDir: '/Users/example/Library/Application Support/BranchPilot/project-memory',
      activityDir: '/Users/example/Library/Application Support/BranchPilot/activity-log',
      wikiDir: '/Users/example/Library/Application Support/BranchPilot/project-wiki',
      repoPath: '/Users/example/dev/BranchPilot',
      serverPath: '/Users/example/dev/BranchPilot/dist-electron/electron/mcp/server.js'
    })

    expect(config.codexCommand).toContain('codex mcp add branchpilot -- node')
    expect(config.codexCommand).toContain('--memory-dir')
    expect(config.codexCommand).toContain('--activity-dir')
    expect(config.codexCommand).toContain('--wiki-dir')
    expect(config.wikiDir).toContain('/project-wiki')
    expect(config.codexToml).toContain('[mcp_servers.branchpilot]')
    expect(config.codexToml).toContain('--wiki-dir')
    expect(config.codexToml).toContain('default_tools_approval_mode = "auto"')
    expect(config.serverExists).toBe(false)
  })

  it('requires --memory-dir when parsing server args', () => {
    expect(() => parseMcpServerArgs(['--repo', '/repo'])).toThrow('Missing required --memory-dir')
    expect(parseMcpServerArgs(['--memory-dir', '/memory', '--activity-dir', '/activity', '--wiki-dir', '/wiki', '--repo', '/repo'])).toEqual({
      memoryDir: '/memory',
      activityDir: '/activity',
      wikiDir: '/wiki',
      repoPath: '/repo'
    })
  })
})
