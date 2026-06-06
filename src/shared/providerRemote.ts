export type ProviderRemoteKind = 'github' | 'gitlab' | 'bitbucket' | 'unknown' | 'none'

export interface ProviderRemoteSummary {
  kind: ProviderRemoteKind
  label: string
  host?: string
  owner?: string
  repository?: string
  supported: boolean
  message: string
}

const providerHosts: Record<Exclude<ProviderRemoteKind, 'unknown' | 'none'>, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org'
}

export function getProviderRemoteSummary(remoteUrl: string | null | undefined): ProviderRemoteSummary {
  const parsed = parseRemoteUrl(remoteUrl)

  if (!parsed) {
    return {
      kind: 'none',
      label: 'No remote',
      supported: false,
      message: 'Add a Git remote before provider workflows are available.'
    }
  }

  const kind = providerKindForHost(parsed.host)
  const label = providerLabel(kind)
  const repository = parsed.repository

  if (kind === 'unknown') {
    return {
      kind,
      label: parsed.host,
      host: parsed.host,
      owner: parsed.owner,
      repository,
      supported: false,
      message: 'This remote host is not supported by BranchPilot provider workflows yet.'
    }
  }

  return {
    kind,
    label,
    host: parsed.host,
    owner: parsed.owner,
    repository,
    supported: kind === 'github',
    message: providerMessage(kind)
  }
}

function parseRemoteUrl(remoteUrl: string | null | undefined) {
  const trimmed = remoteUrl?.trim()
  if (!trimmed) return null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsedUrl = new URL(trimmed)
      return remoteParts(parsedUrl.hostname, parsedUrl.pathname)
    } catch {
      return null
    }
  }

  const sshScpMatch = /^(?:[^@\s]+@)?(?<host>[^:\s]+):(?<path>[^\\\s]+)$/.exec(trimmed)

  if (sshScpMatch?.groups) {
    return remoteParts(sshScpMatch.groups.host, sshScpMatch.groups.path)
  }

  return null
}

function remoteParts(host: string, rawPath: string) {
  const segments = rawPath
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) return null

  const repository = stripGitSuffix(segments.at(-1) ?? '')
  const owner = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined

  return {
    host: host.toLowerCase(),
    owner,
    repository
  }
}

function providerKindForHost(host: string): ProviderRemoteKind {
  if (host === providerHosts.github) return 'github'
  if (host === providerHosts.gitlab) return 'gitlab'
  if (host === providerHosts.bitbucket) return 'bitbucket'
  return 'unknown'
}

function providerLabel(kind: ProviderRemoteKind): string {
  if (kind === 'github') return 'GitHub'
  if (kind === 'gitlab') return 'GitLab'
  if (kind === 'bitbucket') return 'Bitbucket'
  if (kind === 'none') return 'No remote'
  return 'Unknown provider'
}

function providerMessage(kind: ProviderRemoteKind): string {
  if (kind === 'github') return 'GitHub PR workflows are available when authentication and branch preconditions pass.'
  if (kind === 'gitlab') return 'GitLab remote detected. Native merge request workflows remain planned.'
  return 'Bitbucket remote detected. Native pull request workflows remain planned.'
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}
