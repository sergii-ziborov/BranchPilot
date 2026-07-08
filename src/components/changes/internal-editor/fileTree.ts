import type { RepositoryFileEntry } from '../../../shared/branchPilot'

export interface FileTreeFolder {
  name: string
  path: string
  files: RepositoryFileEntry[]
  children: FileTreeFolder[]
}

interface MutableFileTreeFolder extends FileTreeFolder {
  children: MutableFileTreeFolder[]
  childMap: Map<string, MutableFileTreeFolder>
}

function createFileTreeFolder(name: string, path: string): MutableFileTreeFolder {
  return {
    name,
    path,
    files: [],
    children: [],
    childMap: new Map()
  }
}

export function fileDisplayName(filePath: string, folderPath: string): string {
  return folderPath ? filePath.slice(folderPath.length + 1) : filePath
}

function comparePathPart(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
}

function sortFileTreeFolder(folder: MutableFileTreeFolder) {
  folder.files.sort((left, right) => {
    const byName = comparePathPart(fileDisplayName(left.path, folder.path), fileDisplayName(right.path, folder.path))
    return byName || comparePathPart(left.path, right.path)
  })
  folder.children.sort((left, right) => comparePathPart(left.name, right.name) || comparePathPart(left.path, right.path))
  folder.children.forEach(sortFileTreeFolder)
}

export function buildRepositoryFileTree(files: RepositoryFileEntry[]): FileTreeFolder {
  const root = createFileTreeFolder('', '')

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length <= 1) {
      root.files.push(file)
      continue
    }

    let folder = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index]
      const path = parts.slice(0, index + 1).join('/')
      let child = folder.childMap.get(name)
      if (!child) {
        child = createFileTreeFolder(name, path)
        folder.childMap.set(name, child)
        folder.children.push(child)
      }
      folder = child
    }

    folder.files.push(file)
  }

  sortFileTreeFolder(root)
  return root
}
