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

export type EditorTreeRow =
  | { kind: 'folder'; folder: FileTreeFolder; depth: number; key: string }
  | { kind: 'file'; file: RepositoryFileEntry; displayName: string; depth: number; key: string }

// Flatten the folder tree into the exact visual row order that a recursive render would
// produce (root files, then each folder header followed by its files, then its children).
// A flat list is what the windowing hook needs so only the visible rows are ever mounted.
export function flattenFileTree(tree: FileTreeFolder): EditorTreeRow[] {
  const rows: EditorTreeRow[] = []

  for (const file of tree.files) {
    rows.push({ kind: 'file', file, displayName: file.path, depth: 0, key: `file:${file.path}` })
  }

  const walk = (folder: FileTreeFolder, depth: number) => {
    rows.push({ kind: 'folder', folder, depth, key: `folder:${folder.path}` })
    for (const file of folder.files) {
      rows.push({
        kind: 'file',
        file,
        displayName: fileDisplayName(file.path, folder.path),
        depth: depth + 1,
        key: `file:${file.path}`
      })
    }
    for (const child of folder.children) {
      walk(child, depth + 1)
    }
  }

  for (const child of tree.children) {
    walk(child, 0)
  }

  return rows
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
