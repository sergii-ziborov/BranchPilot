export function shortPath(value: string): string {
  const parts = value.split('/').filter(Boolean)

  if (parts.length <= 4) {
    return value
  }

  return `.../${parts.slice(-3).join('/')}`
}
