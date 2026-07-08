import type { MemoryQueryOptions, WikiPageOptions } from './queryOptions.js'
import { loadProjectWikiSnapshot } from './snapshotStore.js'

export async function getProjectWiki(options: MemoryQueryOptions) {
  const wiki = await loadProjectWikiSnapshot(options)

  return {
    generatedAt: wiki.generatedAt,
    sourceMemoryScannedAt: wiki.sourceMemoryScannedAt,
    repository: wiki.repository,
    pages: wiki.pages.map((page) => ({
      id: page.id,
      title: page.title,
      summary: page.summary
    }))
  }
}

export async function getWikiPage(options: WikiPageOptions) {
  const wiki = await loadProjectWikiSnapshot(options)
  const page = wiki.pages.find((candidate) => candidate.id === options.pageId)

  if (!page) {
    throw new Error(`Project Wiki page "${options.pageId}" was not found.`)
  }

  return {
    generatedAt: wiki.generatedAt,
    sourceMemoryScannedAt: wiki.sourceMemoryScannedAt,
    repository: wiki.repository,
    page
  }
}
