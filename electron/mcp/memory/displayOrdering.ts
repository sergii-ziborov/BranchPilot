import type { ProjectMemoryFile, ProjectMemoryImport } from '../../../src/shared/branchPilot.js'

export function sortFilesForDisplay(files: ProjectMemoryFile[]): ProjectMemoryFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path))
}

export function sortImportsForDisplay(imports: ProjectMemoryImport[]): ProjectMemoryImport[] {
  return [...imports].sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)
}
