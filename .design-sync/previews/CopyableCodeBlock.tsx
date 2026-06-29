import { CopyableCodeBlock } from 'branchpilot'

export const CliCommand = () => (
  <CopyableCodeBlock
    title="CLI command"
    code="codex mcp add project-memory -- node /Users/sergii/branchpilot/dist/mcp/server.js"
    copyLabel="Copy"
  />
)

export const ConfigToml = () => (
  <CopyableCodeBlock
    title="config.toml"
    code={`[mcp_servers.project-memory]
command = "node"
args = ["/Users/sergii/branchpilot/dist/mcp/server.js"]`}
    copyLabel="Copy"
  />
)

export const MarkdownPreview = () => (
  <CopyableCodeBlock
    variant="preview"
    title="Architecture Overview"
    copyLabel="Copy Markdown"
    code={`# Architecture Overview

BranchPilot is an Electron + React 19 desktop app.

- **electron/** — main process, IPC handlers, git services
- **src/** — React renderer (views, hooks, shared types)

Generated from Project Memory.`}
  />
)

export const NothingSelected = () => (
  <CopyableCodeBlock
    variant="preview"
    title="Wiki page"
    copyLabel="Copy Markdown"
    copyDisabled
    code="Select a wiki page."
  />
)
