import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectMemoryStackHint } from '../../../src/shared/branchPilot.js'

interface PackageMetadata {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

export async function getStackHints(rootPath: string): Promise<ProjectMemoryStackHint[]> {
  const hints = new Map<string, ProjectMemoryStackHint>()
  const packageMetadata = await readPackageMetadata(rootPath)

  if (packageMetadata) {
    addHint(hints, 'node', 'Node.js', 'package.json')
  }

  if (await pathExists(path.join(rootPath, 'tsconfig.json')) || hasPackage(packageMetadata, 'typescript')) {
    addHint(hints, 'typescript', 'TypeScript', 'tsconfig.json / package.json')
  }

  if (hasPackage(packageMetadata, 'react')) {
    addHint(hints, 'react', 'React', 'package.json')
  }

  if (hasPackage(packageMetadata, 'electron') || await pathExists(path.join(rootPath, 'electron'))) {
    addHint(hints, 'electron', 'Electron', 'package.json / electron directory')
  }

  if (hasPackage(packageMetadata, 'vite') || await pathExists(path.join(rootPath, 'vite.config.ts'))) {
    addHint(hints, 'vite', 'Vite', 'package.json / vite config')
  }

  if (hasPackage(packageMetadata, 'vitest')) {
    addHint(hints, 'vitest', 'Vitest', 'package.json')
  }

  return [...hints.values()]
}

async function readPackageMetadata(rootPath: string): Promise<PackageMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(rootPath, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PackageMetadata>

    return {
      dependencies: parsed.dependencies ?? {},
      devDependencies: parsed.devDependencies ?? {}
    }
  } catch {
    return null
  }
}

function hasPackage(metadata: PackageMetadata | null, packageName: string): boolean {
  return Boolean(metadata?.dependencies[packageName] || metadata?.devDependencies[packageName])
}

function addHint(hints: Map<string, ProjectMemoryStackHint>, id: string, label: string, source: string): void {
  hints.set(id, { id, label, source })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
