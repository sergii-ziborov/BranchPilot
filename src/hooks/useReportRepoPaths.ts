import { useEffect, useState } from 'react'

const REPORT_REPO_PATHS_STORAGE_KEY = 'bp-report-repo-paths'

export function useReportRepoPaths() {
  const [selectedReportRepoPaths, setSelectedReportRepoPathsState] = useState<string[]>(readStoredReportRepoPaths)

  useEffect(() => {
    try {
      localStorage.setItem(REPORT_REPO_PATHS_STORAGE_KEY, JSON.stringify(selectedReportRepoPaths))
    } catch {
      /* ignore */
    }
  }, [selectedReportRepoPaths.join('\n')])

  function updateReportRepoPaths(paths: string[]) {
    setSelectedReportRepoPathsState(normalizeReportRepoPaths(paths))
  }

  return {
    selectedReportRepoPaths,
    setSelectedReportRepoPathsState,
    updateReportRepoPaths
  }
}

function readStoredReportRepoPaths(): string[] {
  if (typeof localStorage === 'undefined') return []

  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_REPO_PATHS_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? normalizeReportRepoPaths(parsed.filter((value): value is string => typeof value === 'string')) : []
  } catch {
    return []
  }
}

function normalizeReportRepoPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const path of paths) {
    const trimmed = path.trim()
    if (!trimmed) continue

    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized
}
