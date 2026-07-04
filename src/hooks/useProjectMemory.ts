import { useMemo, useRef, useState } from 'react'
import type {
  ActivityLogEventType, ActivityLogSnapshot, BranchPilotApi, ProjectMemoryMcpConfig,
  ProjectMemorySnapshot, ProjectWikiPage, ProjectWikiPageId, ProjectWikiSnapshot
} from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import {
  activityEntryCategory, activityMetadataLabel, activityTypeLabel, completedWorkSource
} from '../lib/activityLabels'
import type { ActivityCategory, CompletedWorkItem } from '../lib/activityLabels'
import { formatDate } from '../lib/format'
import type { RequestConfirmation } from '../lib/prompts'

const completedActivityTypes = new Set<ActivityLogEventType>([
  'github_pr_created',
  'daily_review_generated',
  'assistant_linkedin_generated',
  'merge_continued',
  'patch_applied',
  'branch_published'
])

/** Owns Project Memory, Wiki, and activity-log state plus scan/load/copy handlers. */
export function useProjectMemory({
  api,
  currentRepoPath,
  setNotice,
  setError,
  copyToClipboard,
  requestConfirmation
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  copyToClipboard: (text: string, successMessage: string) => Promise<void>
  requestConfirmation: RequestConfirmation
}) {
  const [projectMemory, setProjectMemory] = useState<ProjectMemorySnapshot | null>(null)
  const [projectMemoryMcpConfig, setProjectMemoryMcpConfig] = useState<ProjectMemoryMcpConfig | null>(null)
  const [projectWiki, setProjectWiki] = useState<ProjectWikiSnapshot | null>(null)
  const [selectedProjectWikiPageId, setSelectedProjectWikiPageId] = useState<ProjectWikiPageId>('overview')
  const [wikiLoading, setWikiLoading] = useState(false)
  const [activityLog, setActivityLog] = useState<ActivityLogSnapshot | null>(null)
  const [activityCategory, setActivityCategory] = useState<ActivityCategory>('all')
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [selectedMemoryFilePath, setSelectedMemoryFilePath] = useState<string | null>(null)
  const projectMemoryRequestIdRef = useRef(0)

  const selectedMemoryFile = useMemo(
    () => projectMemory?.files.find((file) => file.path === selectedMemoryFilePath) ?? null,
    [projectMemory, selectedMemoryFilePath]
  )

  const selectedMemorySymbols = useMemo(
    () => projectMemory?.symbols.filter((symbol) => symbol.path === selectedMemoryFilePath) ?? [],
    [projectMemory, selectedMemoryFilePath]
  )

  const selectedMemoryImports = useMemo(
    () => projectMemory?.imports.filter((entry) => entry.path === selectedMemoryFilePath) ?? [],
    [projectMemory, selectedMemoryFilePath]
  )

  const selectedProjectWikiPage = useMemo(
    () => projectWiki?.pages.find((page) => page.id === selectedProjectWikiPageId) ?? projectWiki?.pages[0] ?? null,
    [projectWiki, selectedProjectWikiPageId]
  )

  const filteredActivityEntries = useMemo(
    () => (activityLog?.entries ?? []).filter((entry) => activityCategory === 'all' || activityEntryCategory(entry) === activityCategory),
    [activityCategory, activityLog]
  )

  const completedWorkItems = useMemo<CompletedWorkItem[]>(() => {
    const commitItems = (projectMemory?.recentCommits ?? []).slice(0, 12).map((commit) => ({
      id: `commit-${commit.sha}`,
      title: commit.subject || '(no subject)',
      meta: `${commit.shortSha} · ${commit.authorName} · ${formatDate(commit.authoredAt)}`,
      createdAt: commit.authoredAt,
      source: 'commit' as const
    }))

    const operationItems = (activityLog?.entries ?? [])
      .filter((entry) => entry.status === 'success' && completedActivityTypes.has(entry.type))
      .slice(0, 12)
      .map((entry) => ({
        id: `activity-${entry.id}`,
        title: activityTypeLabel(entry.type),
        meta: `${entry.actor} · ${formatDate(entry.createdAt)}${activityMetadataLabel(entry) ? ` · ${activityMetadataLabel(entry)}` : ''}`,
        createdAt: entry.createdAt,
        source: completedWorkSource(entry.type)
      }))

    return [...commitItems, ...operationItems]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 12)
  }, [activityLog, projectMemory])

  async function loadProjectMemory(repoPath = currentRepoPath) {
    if (!api || !repoPath) return
    const requestId = projectMemoryRequestIdRef.current + 1
    projectMemoryRequestIdRef.current = requestId
    setMemoryLoading(true)
    const [memoryResult, mcpConfigResult, wikiResult, activityResult] = await Promise.all([
      api.getProjectMemory(repoPath),
      api.getProjectMemoryMcpConfig(repoPath),
      api.getProjectWiki(repoPath),
      api.getActivityLog({ repoPath, limit: 120 })
    ])

    if (projectMemoryRequestIdRef.current !== requestId) return

    if (memoryResult.ok) {
      setProjectMemory(memoryResult.data)
    } else {
      setProjectMemory(null)
      setError(memoryResult.error.message)
    }

    if (mcpConfigResult.ok) {
      setProjectMemoryMcpConfig(mcpConfigResult.data)
    } else {
      setProjectMemoryMcpConfig(null)
      setError(mcpConfigResult.error.message)
    }

    if (wikiResult.ok) {
      setProjectWiki(wikiResult.data)
    } else {
      setProjectWiki(null)
      setError(wikiResult.error.message)
    }

    if (activityResult.ok) {
      setActivityLog(activityResult.data)
    } else {
      setActivityLog(null)
      setError(activityResult.error.message)
    }

    setMemoryLoading(false)
  }

  async function generateProjectWiki() {
    if (!api || !currentRepoPath) return
    setWikiLoading(true)
    setError(null)
    const result = await api.generateProjectWiki(currentRepoPath)

    if (result.ok) {
      setProjectMemory(result.data.memory.snapshot)
      setProjectWiki(result.data.wiki)
      setSelectedProjectWikiPageId(result.data.wiki.pages[0]?.id ?? 'overview')
      setNotice(`Project Wiki generated with ${result.data.wiki.pages.length} pages.`)
      void loadProjectMemory(currentRepoPath)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setWikiLoading(false)
  }

  async function scanProjectMemory() {
    if (!api || !currentRepoPath) return
    setMemoryLoading(true)
    setError(null)
    const result = await api.scanProjectMemory(currentRepoPath)

    if (result.ok) {
      setProjectMemory(result.data.snapshot)
      setNotice(`Project Memory scanned ${result.data.scannedFileCount} files in ${result.data.durationMs}ms.`)
      await loadProjectMemory(currentRepoPath)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setMemoryLoading(false)
  }

  async function copyProjectMemoryText(text: string, label: string) {
    await copyToClipboard(text, `${label} copied.`)
  }

  async function copyProjectWikiPage(page: ProjectWikiPage | null) {
    if (!page) return
    await copyProjectMemoryText(page.markdown, `${page.title} wiki page`)
  }

  async function saveProjectWikiPage(page: ProjectWikiPage | null, markdown: string) {
    if (!api || !currentRepoPath || !page) return
    setWikiLoading(true)
    setError(null)
    const result = await api.saveProjectWikiPage({
      repoPath: currentRepoPath,
      pageId: page.id,
      markdown
    })

    if (result.ok) {
      setProjectWiki(result.data)
      setSelectedProjectWikiPageId(page.id)
      setNotice(`${page.title} wiki page saved.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setWikiLoading(false)
  }

  async function pullProjectWikiFromGitHub() {
    if (!api || !currentRepoPath) return
    setWikiLoading(true)
    setError(null)
    const result = await api.pullProjectWikiFromGitHub(currentRepoPath)

    if (result.ok) {
      setProjectWiki(result.data.wiki)
      setSelectedProjectWikiPageId(result.data.wiki.pages[0]?.id ?? 'overview')
      setNotice(result.data.message)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setWikiLoading(false)
  }

  async function pushProjectWikiToGitHub() {
    if (!api || !currentRepoPath) return
    setWikiLoading(true)
    setError(null)
    const result = await api.pushProjectWikiToGitHub(currentRepoPath)

    if (result.ok) {
      setProjectWiki(result.data.wiki)
      setNotice(result.data.message)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setWikiLoading(false)
  }

  async function clearActivityLog() {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation('Clear BranchPilot activity for this repository? This cannot be undone.', {
      title: 'Clear Activity Log',
      confirmLabel: 'Clear log',
      variant: 'danger'
    })

    if (!confirmed) return

    setMemoryLoading(true)
    const result = await api.clearActivityLog(currentRepoPath, confirmed)

    if (result.ok) {
      setActivityLog(result.data)
      setNotice('Activity Log cleared.')
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setMemoryLoading(false)
  }

  return {
    projectMemory, setProjectMemory,
    projectMemoryMcpConfig,
    projectWiki, setProjectWiki,
    selectedProjectWikiPageId, setSelectedProjectWikiPageId, selectedProjectWikiPage,
    wikiLoading,
    activityLog,
    activityCategory, setActivityCategory,
    memoryLoading,
    selectedMemoryFilePath, setSelectedMemoryFilePath,
    selectedMemoryFile, selectedMemorySymbols, selectedMemoryImports,
    filteredActivityEntries, completedWorkItems,
    loadProjectMemory, generateProjectWiki, scanProjectMemory,
    copyProjectMemoryText, copyProjectWikiPage, saveProjectWikiPage,
    pullProjectWikiFromGitHub, pushProjectWikiToGitHub,
    clearActivityLog
  }
}
