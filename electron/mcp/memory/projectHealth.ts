import type { ProjectMemoryFile, ProjectMemorySnapshot } from '../../../src/shared/branchPilot.js'
import type { MemoryQueryOptions } from './queryOptions.js'
import { normalizeLimit } from './queryPrimitives.js'
import { loadProjectMemorySnapshot } from './snapshotStore.js'

export type ProjectHealthSeverity = 'critical' | 'warning' | 'notice' | 'healthy'

export interface ProjectHealthOptions extends MemoryQueryOptions {
  limit?: number
  minimumSeverity?: ProjectHealthSeverity
  includeHealthy?: boolean
}

export interface ProjectHealthIssue {
  code: string
  severity: Exclude<ProjectHealthSeverity, 'healthy'>
  title: string
  detail: string
}

export interface ProjectHealthFileReport {
  path: string
  extension: string
  language?: string
  sizeBytes: number
  symbolCount: number
  importCount: number
  exportedSymbolCount: number
  externalImportCount: number
  severity: ProjectHealthSeverity
  score: number
  issues: ProjectHealthIssue[]
}

export async function getProjectHealth(options: ProjectHealthOptions) {
  const snapshot = await loadProjectMemorySnapshot(options)
  const context = buildProjectHealthContext(snapshot)
  const reports = snapshot.files.map((file) => buildProjectHealthFileReport(file, context))
  const minimumSeverity = options.minimumSeverity ?? (options.includeHealthy ? 'healthy' : 'notice')
  const filteredReports = reports
    .filter((report) => options.includeHealthy || report.severity !== 'healthy')
    .filter((report) => severityRank(report.severity) >= severityRank(minimumSeverity))
    .sort((left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      right.score - left.score ||
      left.path.localeCompare(right.path)
    )
    .slice(0, normalizeLimit(options.limit))

  const reportedFiles = reports.filter((report) => report.severity !== 'healthy')

  return {
    scannedAt: snapshot.scannedAt,
    repository: snapshot.repository,
    summary: {
      totalFiles: reports.length,
      reportedFiles: reportedFiles.length,
      healthyFiles: reports.length - reportedFiles.length,
      criticalFiles: reports.filter((report) => report.severity === 'critical').length,
      warningFiles: reports.filter((report) => report.severity === 'warning').length,
      noticeFiles: reports.filter((report) => report.severity === 'notice').length,
      totalIssues: reports.reduce((total, report) => total + report.issues.length, 0),
      criticalIssues: countIssuesBySeverity(reports, 'critical'),
      warningIssues: countIssuesBySeverity(reports, 'warning'),
      noticeIssues: countIssuesBySeverity(reports, 'notice')
    },
    files: filteredReports
  }
}

interface ProjectHealthContext {
  exportedSymbolsByPath: Map<string, number>
  externalImportsByPath: Map<string, number>
}

function buildProjectHealthContext(snapshot: ProjectMemorySnapshot): ProjectHealthContext {
  const exportedSymbolsByPath = new Map<string, number>()
  const externalImportsByPath = new Map<string, number>()

  for (const symbol of snapshot.symbols) {
    if (!symbol.exported) continue
    exportedSymbolsByPath.set(symbol.path, (exportedSymbolsByPath.get(symbol.path) ?? 0) + 1)
  }

  for (const entry of snapshot.imports) {
    if (!isExternalImport(entry.source)) continue
    externalImportsByPath.set(entry.path, (externalImportsByPath.get(entry.path) ?? 0) + 1)
  }

  return {
    exportedSymbolsByPath,
    externalImportsByPath
  }
}

function buildProjectHealthFileReport(
  file: ProjectMemoryFile,
  context: ProjectHealthContext
): ProjectHealthFileReport {
  const issues: ProjectHealthIssue[] = []
  const fileName = file.path.split('/').pop()?.toLowerCase() ?? file.path.toLowerCase()
  const exportedSymbolCount = context.exportedSymbolsByPath.get(file.path) ?? 0
  const externalImportCount = context.externalImportsByPath.get(file.path) ?? 0
  const generated = isGeneratedOrLockFile(fileName, file.path)

  if (generated && file.sizeBytes >= 128 * 1024) {
    issues.push({
      code: 'large-generated-file',
      severity: 'warning',
      title: 'Large generated or lock file',
      detail: `${formatBytes(file.sizeBytes)} is usually better treated as generated context. Inspect deliberately before changing.`
    })
  } else if (file.sizeBytes >= 512 * 1024) {
    issues.push({
      code: 'large-file',
      severity: 'critical',
      title: 'Very large file',
      detail: `${formatBytes(file.sizeBytes)} may be chunked or slow to inspect. Prefer targeted reads and tests.`
    })
  } else if (file.sizeBytes >= 128 * 1024) {
    issues.push({
      code: 'large-file',
      severity: 'warning',
      title: 'Large file',
      detail: `${formatBytes(file.sizeBytes)} can hide wide impact and is easier to review in chunks.`
    })
  }

  if (file.symbolCount >= 80) {
    issues.push({
      code: 'dense-symbols',
      severity: 'critical',
      title: 'Dense symbol surface',
      detail: `${file.symbolCount} indexed symbols suggest a broad behavior surface in one file.`
    })
  } else if (file.symbolCount >= 35) {
    issues.push({
      code: 'dense-symbols',
      severity: 'warning',
      title: 'Many symbols',
      detail: `${file.symbolCount} indexed symbols can make edits harder to reason about.`
    })
  }

  if (file.importCount >= 30) {
    issues.push({
      code: 'dense-imports',
      severity: 'critical',
      title: 'High dependency pressure',
      detail: `${file.importCount} imports mean changes may couple many modules or packages.`
    })
  } else if (file.importCount >= 15) {
    issues.push({
      code: 'dense-imports',
      severity: 'warning',
      title: 'Import-heavy file',
      detail: `${file.importCount} imports are worth checking before editing.`
    })
  }

  if (externalImportCount >= 20) {
    issues.push({
      code: 'external-import-pressure',
      severity: 'warning',
      title: 'Many external imports',
      detail: `${externalImportCount} package imports can increase integration and upgrade risk.`
    })
  }

  if (exportedSymbolCount >= 20) {
    issues.push({
      code: 'wide-export-surface',
      severity: 'warning',
      title: 'Wide export surface',
      detail: `${exportedSymbolCount} exported symbols can be consumed from many places.`
    })
  } else if (exportedSymbolCount >= 8) {
    issues.push({
      code: 'wide-export-surface',
      severity: 'notice',
      title: 'Notable export surface',
      detail: `${exportedSymbolCount} exported symbols make this a useful file to inspect during planning.`
    })
  }

  if (!generated && isEntrypointFile(fileName, file.path)) {
    issues.push({
      code: 'entrypoint',
      severity: 'notice',
      title: 'Entrypoint or routed surface',
      detail: 'Changes here can affect startup, routing, rendering, or application composition.'
    })
  }

  if (!generated && isConfigFile(fileName, file.path)) {
    issues.push({
      code: 'configuration',
      severity: 'notice',
      title: 'Configuration surface',
      detail: 'Small changes here can affect tooling, builds, tests, or runtime behavior.'
    })
  }

  const severity = fileSeverity(issues)
  const score = severityRank(severity) * 1000 +
    Math.round(file.sizeBytes / 1024) +
    file.symbolCount * 5 +
    file.importCount * 4 +
    exportedSymbolCount * 6 +
    externalImportCount * 3

  return {
    path: file.path,
    extension: file.extension,
    language: file.language,
    sizeBytes: file.sizeBytes,
    symbolCount: file.symbolCount,
    importCount: file.importCount,
    exportedSymbolCount,
    externalImportCount,
    severity,
    score,
    issues
  }
}

function fileSeverity(issues: ProjectHealthIssue[]): ProjectHealthSeverity {
  if (issues.some((issue) => issue.severity === 'critical')) return 'critical'
  if (issues.some((issue) => issue.severity === 'warning')) return 'warning'
  if (issues.some((issue) => issue.severity === 'notice')) return 'notice'
  return 'healthy'
}

function countIssuesBySeverity(
  reports: ProjectHealthFileReport[],
  severity: Exclude<ProjectHealthSeverity, 'healthy'>
): number {
  return reports.reduce(
    (total, report) => total + report.issues.filter((issue) => issue.severity === severity).length,
    0
  )
}

function severityRank(severity: ProjectHealthSeverity): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  if (severity === 'notice') return 1
  return 0
}

function isGeneratedOrLockFile(fileName: string, filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|composer\.lock|cargo\.lock|poetry\.lock)$/.test(normalized) ||
    /\.(min\.js|map|lock|snap)$/.test(fileName) ||
    /(^|\/)(dist|build|coverage|vendor|node_modules)\//.test(normalized)
}

function isEntrypointFile(fileName: string, filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return /^(main|index|app|router|routes|layout|page|server|client)\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte)$/.test(fileName) ||
    /(^|\/)(main|index|app|router|routes|layout|page)\.(tsx|ts|jsx|js|mjs|cjs)$/.test(normalized)
}

function isConfigFile(fileName: string, filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.(ts|js|mjs|cjs)|eslint\.config\.(ts|js|mjs|cjs)|knip\.json|prettier[^/]*|tailwind\.config\.(ts|js|mjs|cjs))$/.test(normalized) ||
    /\.(config|rc)\.(ts|js|json|jsonc|mjs|cjs)$/.test(fileName)
}

function isExternalImport(source: string): boolean {
  return Boolean(source) && !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('@/') && !source.startsWith('#')
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${bytes} B`
}
