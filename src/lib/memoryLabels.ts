import type { ProjectMemoryFile } from '../shared/branchPilot'
import { formatBytes } from './format'

/** Compact metadata line for a Project Memory file (language, size, symbols, imports). */
export function memoryFileMeta(file: ProjectMemoryFile): string {
  const parts = [
    (file.language ?? file.extension) || 'file',
    formatBytes(file.sizeBytes),
    `${file.symbolCount} symbols`
  ]

  if (file.importCount > 0) {
    parts.push(`${file.importCount} imports`)
  }

  return parts.join(' · ')
}
