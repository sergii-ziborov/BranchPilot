import type {
  ActivityLogEntry,
  ProjectMemorySymbol,
  ProjectWikiPage,
  ProjectWikiPageId
} from '../../../src/shared/branchPilot.js'

export function titleFromPageId(pageId: ProjectWikiPageId): string {
  return pageId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

export function titleFromMarkdown(markdown: string): string | null {
  const heading = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '))

  return heading?.replace(/^#\s+/, '').trim() || null
}

export function summarizeMarkdown(markdown: string): string {
  const line = markdown
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith('#') && !entry.startsWith('```'))

  if (!line) {
    return 'Markdown wiki page.'
  }

  return stripMarkdown(line).slice(0, 140)
}

function stripMarkdown(value: string): string {
  return value
    .replace(/[`*_~[\]]/g, '')
    .replace(/\(([^)]+)\)/g, '$1')
    .replace(/^[-*]\s+/, '')
    .trim()
}

export function sanitizeWikiFileName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized || 'Wiki-Page'
}

export function createPage(id: ProjectWikiPageId, title: string, summary: string, markdown: string): ProjectWikiPage {
  return {
    id,
    title,
    summary,
    markdown
  }
}

export function listOrEmpty(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ['- No indexed data available.']
}

export function symbolLabel(symbol: ProjectMemorySymbol): string {
  return symbol.parentName ? `${symbol.parentName}.${symbol.name}` : symbol.name
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function activityTypeLabel(type: ActivityLogEntry['type']): string {
  return type
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
