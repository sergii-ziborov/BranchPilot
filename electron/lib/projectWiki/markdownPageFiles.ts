import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectWikiPage, ProjectWikiPageId } from '../../../src/shared/branchPilot.js'
import { sanitizeWikiFileName, summarizeMarkdown, titleFromMarkdown } from './wikiText.js'

const WIKI_PAGE_FILE_NAMES: Record<string, string> = {
  overview: 'Home.md',
  module_map: 'Module-Map.md',
  folder_structure: 'Folder-Structure.md',
  technology_map: 'Technology-Map.md',
  important_symbols: 'Important-Symbols.md',
  workflows: 'Workflows.md',
  assistant_policy: 'Assistant-Policy.md',
  recent_timeline: 'Recent-Timeline.md'
}

export async function writeMarkdownPagesToDirectory(
  pages: ProjectWikiPage[],
  directoryPath: string,
  replaceExistingMarkdown: boolean
): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true })

  if (replaceExistingMarkdown) {
    const existingEntries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])

    await Promise.all(existingEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => fs.rm(path.join(directoryPath, entry.name), { force: true }))
    )
  }

  const usedFileNames = new Set<string>()

  for (const page of pages) {
    const fileName = uniqueWikiFileName(page, usedFileNames)
    await fs.writeFile(path.join(directoryPath, fileName), page.markdown.endsWith('\n') ? page.markdown : `${page.markdown}\n`, 'utf8')
  }
}

export async function readMarkdownPages(directoryPath: string): Promise<ProjectWikiPage[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort(compareWikiFileNames)

  const pages: ProjectWikiPage[] = []

  for (const fileName of markdownFiles) {
    const markdown = await fs.readFile(path.join(directoryPath, fileName), 'utf8')
    const title = titleFromMarkdown(markdown) ?? titleFromFileName(fileName)

    pages.push({
      id: pageIdFromFileName(fileName),
      title,
      summary: summarizeMarkdown(markdown),
      markdown
    })
  }

  return pages
}

function uniqueWikiFileName(page: ProjectWikiPage, usedFileNames: Set<string>): string {
  const preferredFileName = WIKI_PAGE_FILE_NAMES[page.id] ?? `${sanitizeWikiFileName(page.title || page.id)}.md`
  const extension = path.extname(preferredFileName) || '.md'
  const baseName = preferredFileName.slice(0, preferredFileName.length - extension.length)
  let candidate = preferredFileName
  let suffix = 2

  while (usedFileNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}-${suffix}${extension}`
    suffix += 1
  }

  usedFileNames.add(candidate.toLowerCase())

  return candidate
}

function compareWikiFileNames(left: string, right: string): number {
  if (left.toLowerCase() === 'home.md') return -1
  if (right.toLowerCase() === 'home.md') return 1

  return left.localeCompare(right)
}

function pageIdFromFileName(fileName: string): ProjectWikiPageId {
  const baseName = fileName.replace(/\.md$/i, '')

  if (/^(home|readme)$/i.test(baseName)) {
    return 'overview'
  }

  return baseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'wiki_page'
}

function titleFromFileName(fileName: string): string {
  const baseName = fileName.replace(/\.md$/i, '')

  if (/^home$/i.test(baseName)) {
    return 'Overview'
  }

  return baseName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}
