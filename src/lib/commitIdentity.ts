import type { CoAuthor, GitConfigSnapshot, GitHubAccountSummary, RepositorySnapshot } from '../shared/branchPilot'

export interface CommitIdentityOption extends CoAuthor {
  meta: string
}

export interface RememberedIdentity {
  name: string
  email: string
  login?: string
}

const GITHUB_ACCOUNTS_CACHE_KEY = 'branchpilot:github-accounts:v1'
const COMMIT_IDENTITIES_CACHE_KEY = 'branchpilot:commit-identities:v1'

function identityKey(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function gitHubNoreplyLogin(email: string | undefined): string {
  return identityKey(email).match(/^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/)?.[1] ?? ''
}

function isGitHubAccountSummary(value: unknown): value is GitHubAccountSummary {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<GitHubAccountSummary>
  return (
    typeof record.login === 'string' &&
    typeof record.label === 'string' &&
    (record.type === 'user' || record.type === 'organization') &&
    typeof record.url === 'string' &&
    (record.emails === undefined || Array.isArray(record.emails)) &&
    (record.avatarUrl === undefined || typeof record.avatarUrl === 'string')
  )
}

function githubAvatarUrl(login: string | undefined): string | undefined {
  const normalized = login?.trim()
  return normalized ? `https://github.com/${encodeURIComponent(normalized)}.png?size=64` : undefined
}

export function buildCoAuthorSuggestions(
  identityContributors: CoAuthor[],
  repositoryContributors: CoAuthor[],
  githubContributors: CoAuthor[],
  query: string
): CoAuthor[] {
  const suggestions = new Map<string, CoAuthor>()

  for (const contributor of [...identityContributors, ...repositoryContributors, ...githubContributors]) {
    if (query && ![
      contributor.name,
      contributor.email,
      contributor.login ?? '',
      contributor.organization ?? ''
    ].some((value) => value.toLowerCase().includes(query))) {
      continue
    }

    const key = contributor.email.toLowerCase()
    if (!suggestions.has(key)) suggestions.set(key, contributor)
  }

  return [...suggestions.values()].slice(0, 100)
}

export function filterOwnCoAuthorSuggestions(
  suggestions: CoAuthor[],
  identities: CoAuthor[],
  accounts: GitHubAccountSummary[]
): CoAuthor[] {
  const ownEmails = new Set(identities.map((identity) => identityKey(identity.email)).filter(Boolean))
  const ownNames = new Set(identities.map((identity) => identityKey(identity.name)).filter(Boolean))
  const ownLogins = new Set([
    ...identities.map((identity) => identity.login),
    ...accounts.filter((account) => account.type === 'user').map((account) => account.login)
  ].map(identityKey).filter(Boolean))

  for (const identity of identities) {
    const noreplyLogin = gitHubNoreplyLogin(identity.email)
    if (noreplyLogin) ownLogins.add(noreplyLogin)
  }

  for (const account of accounts) {
    if (account.type !== 'user') continue
    for (const email of account.emails ?? []) {
      const noreplyLogin = gitHubNoreplyLogin(email)
      if (noreplyLogin) ownLogins.add(noreplyLogin)
    }
  }

  return suggestions.filter((contributor) => {
    const email = identityKey(contributor.email)
    if (email && ownEmails.has(email)) return false

    const noreplyLogin = gitHubNoreplyLogin(contributor.email)
    if (noreplyLogin && ownLogins.has(noreplyLogin)) return false

    const name = identityKey(contributor.name)
    if (name && ownNames.has(name)) return false

    const login = identityKey(contributor.login)
    if (login && ownLogins.has(login)) return false

    for (const ownLogin of ownLogins) {
      if (email.includes(`+${ownLogin}@users.noreply.github.com`)) return false
    }

    return true
  })
}

export function coAuthorSourceLabel(contributor: CoAuthor): string {
  if (contributor.source === 'identity') return contributor.login ? `@${contributor.login} email` : 'Commit identity'
  if (contributor.source === 'collaborator') return 'Repository access'
  if (contributor.organization) return `${contributor.organization} member`
  if (contributor.source === 'github') return 'GitHub'
  return 'Repository'
}

export function buildIdentityCoAuthors(
  localUserName: string,
  localUserEmail: string,
  accounts: GitHubAccountSummary[]
): CoAuthor[] {
  const identities = new Map<string, CoAuthor>()
  const localEmail = localUserEmail.trim()
  const localName = localUserName.trim() || localEmail

  if (localEmail) {
    identities.set(localEmail.toLowerCase(), {
      name: localName,
      email: localEmail,
      source: 'identity'
    })
  }

  for (const account of accounts) {
    if (account.type !== 'user') continue

    for (const email of account.emails ?? []) {
      const normalizedEmail = email.trim()
      if (!normalizedEmail) continue

      const key = normalizedEmail.toLowerCase()
      if (identities.has(key)) continue

      identities.set(key, {
        name: account.label || account.login,
        email: normalizedEmail,
        login: account.login,
        profileUrl: account.url,
        avatarUrl: account.avatarUrl ?? githubAvatarUrl(account.login),
        source: 'identity'
      })
    }
  }

  return [...identities.values()]
}

export function mergeGitHubAccounts(...groups: GitHubAccountSummary[][]): GitHubAccountSummary[] {
  const merged = new Map<string, GitHubAccountSummary>()

  for (const accounts of groups) {
    for (const account of accounts) {
      const key = `${account.type}:${account.login.toLowerCase()}`
      const existing = merged.get(key)

      if (!existing) {
        merged.set(key, { ...account, emails: [...(account.emails ?? [])] })
        continue
      }

      const emails = new Map<string, string>()
      for (const email of [...(existing.emails ?? []), ...(account.emails ?? [])]) {
        const trimmed = email.trim()
        if (trimmed) emails.set(trimmed.toLowerCase(), trimmed)
      }

      merged.set(key, {
        ...existing,
        ...account,
        emails: [...emails.values()]
      })
    }
  }

  return [...merged.values()]
}

export function loadCachedGitHubAccounts(): GitHubAccountSummary[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(GITHUB_ACCOUNTS_CACHE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isGitHubAccountSummary)
  } catch {
    return []
  }
}

export function saveCachedGitHubAccounts(accounts: GitHubAccountSummary[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(GITHUB_ACCOUNTS_CACHE_KEY, JSON.stringify(accounts))
  } catch {
    // Cache is a convenience only; ignore quota/private-mode failures.
  }
}

export function loadRememberedIdentities(): RememberedIdentity[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(COMMIT_IDENTITIES_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (value): value is RememberedIdentity =>
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as RememberedIdentity).name === 'string' &&
        typeof (value as RememberedIdentity).email === 'string'
    )
  } catch {
    return []
  }
}

export function rememberIdentity(name: string, email: string, login?: string): RememberedIdentity[] {
  const normalizedEmail = email.trim()
  if (typeof window === 'undefined' || !normalizedEmail) return loadRememberedIdentities()
  const emailKey = normalizedEmail.toLowerCase()
  const next = [
    ...loadRememberedIdentities().filter((identity) => identity.email.trim().toLowerCase() !== emailKey),
    { name: name.trim() || normalizedEmail, email: normalizedEmail, login: login?.trim() || undefined }
  ]
  try {
    window.localStorage.setItem(COMMIT_IDENTITIES_CACHE_KEY, JSON.stringify(next))
  } catch {
    // Cache is a convenience only; ignore quota/private-mode failures.
  }
  return next
}

export function commitIdentityAvatarUrl(identity: CoAuthor | undefined): string | undefined {
  if (!identity) return undefined
  return identity.avatarUrl ?? githubAvatarUrl(identity.login)
}

export function buildCommitIdentityOptions(
  snapshot: RepositorySnapshot | null,
  gitConfig: GitConfigSnapshot | null,
  localUserName: string,
  localUserEmail: string,
  accounts: GitHubAccountSummary[],
  repositoryContributors: CoAuthor[],
  rememberedIdentities: RememberedIdentity[]
): CommitIdentityOption[] {
  const identities = new Map<string, CommitIdentityOption>()
  const knownNames = new Set<string>()
  const knownEmails = new Set<string>()
  const knownLogins = new Set<string>()
  const userAccounts = accounts.filter((account) => account.type === 'user')
  const fallbackUserAccount = userAccounts.length === 1 ? userAccounts[0] : undefined
  const accountForEmail = (email: string | undefined): GitHubAccountSummary | undefined => {
    const emailKey = identityKey(email)
    if (!emailKey) return undefined

    const exactEmailAccount = userAccounts.find((account) =>
      (account.emails ?? []).some((accountEmail) => identityKey(accountEmail) === emailKey)
    )
    if (exactEmailAccount) return exactEmailAccount

    const noreplyLogin = gitHubNoreplyLogin(email)
    if (noreplyLogin) {
      return userAccounts.find((account) => identityKey(account.login) === noreplyLogin)
    }

    return undefined
  }

  const addIdentity = (name: string | undefined, email: string | undefined, meta: string, account?: GitHubAccountSummary) => {
    const normalizedEmail = email?.trim()
    if (!normalizedEmail) return

    const key = identityKey(normalizedEmail)
    knownEmails.add(key)
    const matchedAccount = account ?? accountForEmail(normalizedEmail) ?? fallbackUserAccount

    const normalizedName = name?.trim() || matchedAccount?.label || matchedAccount?.login || normalizedEmail
    knownNames.add(identityKey(normalizedName))
    if (matchedAccount?.login) knownLogins.add(identityKey(matchedAccount.login))

    if (meta === 'Repository history email') return

    if (identities.has(key)) return

    identities.set(key, {
      name: normalizedName,
      email: normalizedEmail,
      login: matchedAccount?.login,
      profileUrl: matchedAccount?.url,
      avatarUrl: matchedAccount?.avatarUrl ?? githubAvatarUrl(matchedAccount?.login),
      source: 'identity',
      meta
    })
  }
  const matchesKnownIdentity = (name: string | undefined, email: string | undefined, login?: string): boolean => {
    const emailKey = identityKey(email)
    const nameKey = identityKey(name)
    const loginKey = identityKey(login)
    return Boolean(
      (emailKey && knownEmails.has(emailKey)) ||
      (nameKey && knownNames.has(nameKey)) ||
      (loginKey && knownLogins.has(loginKey))
    )
  }

  for (const account of accounts) {
    knownNames.add(identityKey(account.label))
    knownLogins.add(identityKey(account.login))

    if (account.type !== 'user') continue

    for (const email of account.emails ?? []) {
      addIdentity(account.label || account.login, email, `${account.login} GitHub email`, account)
    }
  }

  addIdentity(gitConfig?.localUserName, gitConfig?.localUserEmail, 'Repository git config')
  addIdentity(snapshot?.summary.gitUserName, snapshot?.summary.gitUserEmail, 'Effective git identity')
  addIdentity(gitConfig?.effectiveUserName, gitConfig?.effectiveUserEmail, 'Effective git identity')
  addIdentity(gitConfig?.globalUserName, gitConfig?.globalUserEmail, 'Global git config')
  addIdentity(localUserName, localUserEmail, 'Current edit')

  for (const identity of rememberedIdentities) {
    addIdentity(identity.name, identity.email, 'Identity you commit as')
  }

  for (const contributor of repositoryContributors) {
    if (matchesKnownIdentity(contributor.name, contributor.email, contributor.login)) {
      addIdentity(contributor.name, contributor.email, 'Repository history email')
    }
  }

  return [...identities.values()]
}

export function isCoAuthorSelected(selectedText: string, contributor: CoAuthor): boolean {
  const selected = selectedText.toLowerCase()
  const email = contributor.email.toLowerCase()
  if (selected.includes(email)) return true

  const login = contributor.login?.toLowerCase()
  return Boolean(login && selected.includes(`+${login}@users.noreply.github.com`))
}

export function removeCoAuthor(selectedText: string, contributor: CoAuthor): string {
  const email = contributor.email.toLowerCase()
  const login = contributor.login?.toLowerCase()

  return selectedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const normalized = line.toLowerCase()
      if (!normalized) return false
      if (normalized.includes(email)) return false
      if (login && normalized.includes(`+${login}@users.noreply.github.com`)) return false
      return true
    })
    .join('\n')
}

export function coAuthorMeta(contributor: CoAuthor): string {
  const source = contributor.organization
    ? contributor.organization
    : coAuthorSourceLabel(contributor)

  return `${source} · ${contributor.email}`
}

export function coAuthorButtonLabel(contributor: CoAuthor, selected: boolean): string {
  const action = selected ? 'Remove co-author' : 'Add co-author'
  const login = contributor.login ? `, GitHub ${contributor.login}` : ''
  const organization = contributor.organization ? `, organization ${contributor.organization}` : ''

  return `${action} ${contributor.name} <${contributor.email}>${login}${organization}`
}
