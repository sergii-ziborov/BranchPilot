import { promises as fs } from 'node:fs'
import type { ProjectMemoryMcpConfig } from '../../src/shared/branchPilot.js'

interface ProjectMemoryMcpConfigInput {
  memoryDir: string
  activityDir: string
  wikiDir: string
  repoPath: string
  serverPath: string
}

export async function createProjectMemoryMcpConfig(input: ProjectMemoryMcpConfigInput): Promise<ProjectMemoryMcpConfig> {
  const args = [
    input.serverPath,
    '--memory-dir',
    input.memoryDir,
    '--activity-dir',
    input.activityDir,
    '--wiki-dir',
    input.wikiDir,
    '--repo',
    input.repoPath
  ]

  return {
    memoryDir: input.memoryDir,
    activityDir: input.activityDir,
    wikiDir: input.wikiDir,
    serverPath: input.serverPath,
    repoPath: input.repoPath,
    codexCommand: [
      'codex',
      'mcp',
      'add',
      'branchpilot',
      '--',
      'node',
      ...args
    ].map(shellQuote).join(' '),
    codexToml: [
      '[mcp_servers.branchpilot]',
      'command = "node"',
      `args = ${tomlStringArray(args)}`,
      'startup_timeout_sec = 10',
      'tool_timeout_sec = 30',
      'default_tools_approval_mode = "auto"',
      'enabled = true'
    ].join('\n'),
    serverExists: await pathExists(input.serverPath)
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "'\\''")}'`
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
