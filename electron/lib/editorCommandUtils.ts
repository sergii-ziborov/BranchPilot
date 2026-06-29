import path from 'node:path'

export function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key]) {
    return env[key]
  }

  const foundKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase())

  return foundKey ? env[foundKey] : undefined
}

export function winJoin(...parts: string[]): string {
  return path.win32.join(...parts)
}

export function posixJoin(...parts: string[]): string {
  return path.posix.join(...parts)
}

export function uniqueCommands(values: Array<string | undefined | false>, platform: NodeJS.Platform): string[] {
  const seen = new Set<string>()
  const commands: string[] = []

  for (const value of values) {
    if (!value) {
      continue
    }

    const key = platform === 'win32' ? value.toLowerCase() : value

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    commands.push(value)
  }

  return commands
}
