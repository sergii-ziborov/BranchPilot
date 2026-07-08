import { existsSync } from 'node:fs'
import path from 'node:path'

// Resolve a direct git binary once at startup. A PATH shim adds real spawn cost:
// on Windows scoop's shims\git.exe forwards to the real binary (~500ms-2s per spawn),
// and on macOS /usr/bin/git proxies through Apple's developer tools (xcrun) and can be
// slow or prompt on first run. Pointing straight at the real binary avoids that. Falls
// back to bare 'git' (PATH resolution) when no known direct path exists.
export const GIT_EXECUTABLE = resolveGitExecutable()
export const WHICH_EXECUTABLE = process.platform === 'win32' ? 'where' : '/usr/bin/which'

function resolveGitExecutable(): string {
  if (process.platform === 'win32') {
    return findWindowsGitExecutable() ?? 'git'
  }

  if (process.platform === 'darwin') {
    return findMacGitExecutable() ?? 'git'
  }

  return findUnixGitExecutable() ?? 'git'
}

function findWindowsGitExecutable(): string | undefined {
  const home = process.env.USERPROFILE ?? process.env.HOME
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'cmd', 'git.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'),
    home && path.join(home, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
    home && path.join(home, 'scoop', 'apps', 'git', 'current', 'bin', 'git.exe')
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => existsSync(candidate))
}

function findMacGitExecutable(): string | undefined {
  // Prefer a real Homebrew git over Apple's /usr/bin/git shim.
  const candidates = [
    '/opt/homebrew/bin/git', // Apple Silicon Homebrew
    '/usr/local/bin/git',    // Intel Homebrew / manual installs
    '/usr/bin/git'           // Apple Command Line Tools (last resort)
  ]

  return candidates.find((candidate) => existsSync(candidate))
}

function findUnixGitExecutable(): string | undefined {
  const candidates = [
    '/usr/bin/git',
    '/usr/local/bin/git',
    '/bin/git'
  ]

  return candidates.find((candidate) => existsSync(candidate))
}
export const WINDOWS_GIT_CREDENTIAL_HELPER = 'manager'

export function gitArgsWithCredentialManager(args: string[]): string[] {
  return process.platform === 'win32' && !usesCredentialHelperOverride(args)
    ? [...gitCredentialManagerConfigArgs(), ...args]
    : args
}

export function gitArgsWithNonInteractiveCredentialManager(args: string[]): string[] {
  return process.platform === 'win32'
    ? [
        ...gitCredentialManagerConfigArgs(),
        '-c', 'credential.interactive=false',
        ...args
      ]
    : args
}

export function isGitExecutable(command: string): boolean {
  if (command === GIT_EXECUTABLE) {
    return true
  }

  return process.platform === 'win32' && /(?:^|[\\/])git(?:\.exe)?$/i.test(command)
}

export function normalizeNativePath(filePath: string): string {
  if (process.platform !== 'win32') {
    return filePath
  }

  return /^[a-z]:[\\/]/i.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('//')
    ? path.normalize(filePath)
    : filePath
}

function usesCredentialHelperOverride(args: string[]): boolean {
  return args.some((arg, index) =>
    arg === `credential.helper=${WINDOWS_GIT_CREDENTIAL_HELPER}`
    || (arg === '-c' && args[index + 1]?.startsWith('credential.helper='))
  )
}

function gitCredentialManagerConfigArgs(): string[] {
  return [
    '-c', 'credential.helper=',
    '-c', `credential.helper=${WINDOWS_GIT_CREDENTIAL_HELPER}`
  ]
}
