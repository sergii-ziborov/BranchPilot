import { fileTypeIconForPath } from '../lib/fileTypeIcons'

/** A small mono-label file-type monogram badge (TS/JS/JSON…) resolved from a file path. */
export function FileTypeIcon({ path }: { path: string }) {
  const icon = fileTypeIconForPath(path)
  return (
    <span className={`file-type-icon file-type-${icon.tone}`} title={icon.title} aria-hidden="true">
      {icon.label}
    </span>
  )
}
