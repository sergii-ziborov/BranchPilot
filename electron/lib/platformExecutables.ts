import path from 'node:path'

export const GIT_EXECUTABLE = process.platform === 'win32' ? 'git' : '/usr/bin/git'
export const WHICH_EXECUTABLE = process.platform === 'win32' ? 'where' : '/usr/bin/which'
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
