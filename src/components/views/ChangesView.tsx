import { useEffect, useRef, useState, type RefObject } from 'react'
import { Archive, Bot, Check, Clock3, Code2, Columns2, Copy, FolderOpen, GitCommitHorizontal, GitPullRequest, ListFilter, Maximize2, Minimize2, MinusSquare, Pencil, Pilcrow, PlusSquare, Rows3, Save, Search, ShieldCheck, Terminal, Trash2, UploadCloud, Users, X } from 'lucide-react'
import type {
  ApiResult, BranchPilotApi, CoAuthor, ContributorStat, DiffHunk, DiffResult, ImagePreview,
  FileChange, GitConfigSnapshot, GitHubAccountSummary, GitHubCliStatus, PatchScope, RepositorySnapshot
} from '../../shared/branchPilot'
import type { ChangeDiffMode } from '../../shared/changeStaging'
import type { ViewMode } from '../../lib/viewMode'
import { getBulkStageToggleState, getDefaultChangeDiffMode } from '../../shared/changeStaging'
import { ViewSwitch } from '../ViewSwitch'
import { getAmendCommitActionState, getCommitActionState, getCommitAndPushActionState } from '../../shared/commitPreconditions'
import { useVirtualList } from '../../hooks/useVirtualList'
import { changeLabel, statusToken } from '../../lib/fileChangeLabels'
import { fileTypeIconForPath } from '../../lib/fileTypeIcons'
import { DiffPreview } from '../DiffView'
import { BulkStageCheckbox, StageCheckbox } from '../StageCheckbox'
import { useWorkflowPaneResize } from '../../hooks/useWorkflowPaneResize'

function actionTooltip(actionLabel: string, blockedLabel: string, state: { enabled: boolean; reasons: string[] }, busy: boolean): string {
  if (busy) return 'Another repository operation is running.'
  if (state.enabled) return actionLabel
  return `${blockedLabel}: ${state.reasons.join(' ')}`
}

function buildRepoFilePath(repoPath: string, filePath: string): string {
  const separator = repoPath.includes('\\') ? '\\' : '/'
  const root = repoPath.replace(/[\\/]+$/, '')
  const relativePath = filePath.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator)
  return `${root}${separator}${relativePath}`
}

function buildRepoFileDirectory(repoPath: string, filePath: string): string {
  const targetPath = buildRepoFilePath(repoPath, filePath)
  const lastSlash = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'))
  return lastSlash > 0 ? targetPath.slice(0, lastSlash) : repoPath
}

function changeStageState(change: FileChange): 'conflict' | 'partial' | 'staged' | 'untracked' | 'unstaged' {
  if (change.conflicted) return 'conflict'
  if (change.staged && (change.unstaged || change.untracked)) return 'partial'
  if (change.staged) return 'staged'
  if (change.untracked) return 'untracked'
  return 'unstaged'
}

function changeStageStateLabel(change: FileChange): string {
  const stageState = changeStageState(change)
  if (stageState === 'conflict') return 'Conflict, resolve before staging'
  if (stageState === 'partial') return 'Partially included in commit'
  if (stageState === 'staged') return 'Included in commit'
  if (stageState === 'untracked') return 'Untracked, not included in commit'
  return 'Not included in commit'
}

function buildCoAuthorSuggestions(
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

function filterOwnCoAuthorSuggestions(
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

  return suggestions.filter((contributor) => {
    const email = identityKey(contributor.email)
    if (email && ownEmails.has(email)) return false

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

function coAuthorSourceLabel(contributor: CoAuthor): string {
  if (contributor.source === 'identity') return contributor.login ? `@${contributor.login} email` : 'Commit identity'
  if (contributor.organization) return `${contributor.organization} member`
  if (contributor.source === 'github') return 'GitHub'
  return 'Repository'
}

function buildIdentityCoAuthors(
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
        source: 'identity'
      })
    }
  }

  return [...identities.values()]
}

function mergeGitHubAccounts(...groups: GitHubAccountSummary[][]): GitHubAccountSummary[] {
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

interface CommitIdentityOption extends CoAuthor {
  meta: string
}

type ChangeSearchMode = 'path' | 'content' | 'all'

function identityKey(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function gitHubNoreplyLogin(email: string | undefined): string {
  return identityKey(email).match(/^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/)?.[1] ?? ''
}

function buildCommitIdentityOptions(
  snapshot: RepositorySnapshot | null,
  gitConfig: GitConfigSnapshot | null,
  localUserName: string,
  localUserEmail: string,
  accounts: GitHubAccountSummary[],
  contributorStats: ContributorStat[],
  repositoryContributors: CoAuthor[]
): CommitIdentityOption[] {
  const identities = new Map<string, CommitIdentityOption>()
  const knownNames = new Set<string>()
  const knownEmails = new Set<string>()
  const knownLogins = new Set<string>()
  const isKnownGitHubNoreplyEmail = (email: string | undefined): boolean => {
    const login = gitHubNoreplyLogin(email)
    return Boolean(login && knownLogins.has(login))
  }
  const addIdentity = (name: string | undefined, email: string | undefined, meta: string, account?: GitHubAccountSummary) => {
    const normalizedEmail = email?.trim()
    if (!normalizedEmail) return

    const key = identityKey(normalizedEmail)
    const historyAliasOnly = meta === 'Repository history email' && isKnownGitHubNoreplyEmail(normalizedEmail)
    knownEmails.add(key)

    const normalizedName = name?.trim() || account?.label || account?.login || normalizedEmail
    knownNames.add(identityKey(normalizedName))
    if (account?.login) knownLogins.add(identityKey(account.login))
    if (historyAliasOnly) return

    if (identities.has(key)) return

    identities.set(key, {
      name: normalizedName,
      email: normalizedEmail,
      login: account?.login,
      profileUrl: account?.url,
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

  for (const contributor of repositoryContributors) {
    if (matchesKnownIdentity(contributor.name, contributor.email, contributor.login)) {
      addIdentity(contributor.name, contributor.email, 'Repository history email')
    }
  }

  for (const contributor of contributorStats) {
    const statEmails = new Set((contributor.emails ?? [contributor.email]).map(identityKey).filter(Boolean))
    const statNames = new Set([
      contributor.name,
      ...(contributor.aliases ?? []).map((alias) => alias.name)
    ].map(identityKey).filter(Boolean))
    const statLogin = identityKey(contributor.login)
    const statMatchesKnownIdentity = (
      matchesKnownIdentity(contributor.name, contributor.email, contributor.login) ||
      (statLogin && knownLogins.has(statLogin)) ||
      [...statEmails].some((email) => knownEmails.has(email)) ||
      [...statNames].some((name) => knownNames.has(name))
    )

    if (!statMatchesKnownIdentity) continue

    for (const alias of contributor.aliases ?? []) {
      addIdentity(alias.name, alias.email, 'Repository history email')
    }

    for (const email of contributor.emails ?? []) {
      addIdentity(contributor.name, email, 'Repository history email')
    }
  }

  return [...identities.values()]
}

function isCoAuthorSelected(selectedText: string, contributor: CoAuthor): boolean {
  const selected = selectedText.toLowerCase()
  const email = contributor.email.toLowerCase()
  if (selected.includes(email)) return true

  const login = contributor.login?.toLowerCase()
  return Boolean(login && selected.includes(`+${login}@users.noreply.github.com`))
}

function removeCoAuthor(selectedText: string, contributor: CoAuthor): string {
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

function coAuthorMeta(contributor: CoAuthor): string {
  const source = contributor.organization
    ? contributor.organization
    : coAuthorSourceLabel(contributor)

  return `${source} · ${contributor.email}`
}

function coAuthorButtonLabel(contributor: CoAuthor, selected: boolean): string {
  const action = selected ? 'Remove co-author' : 'Add co-author'
  const login = contributor.login ? `, GitHub ${contributor.login}` : ''
  const organization = contributor.organization ? `, organization ${contributor.organization}` : ''

  return `${action} ${contributor.name} <${contributor.email}>${login}${organization}`
}

export function ChangesView({
  snapshot, counts, busy, itemHeight,
  changeFilter, setChangeFilter,
  changeSearchMode, setChangeSearchMode, changeContentIndexing,
  filteredChanges, virtualChanges,
  changesActionsMenuRef, closeChangesActionsMenu,
  createQuickStash, canCreateStash,
  exportPatch, applyPatch,
  bulkStageToggleState, toggleBulkStage, toggleChangeStage,
  selectedFilePath, setSelectedFilePath, setDiffMode, setViewMode,
  commitTitle, setCommitTitle, commitDescription, setCommitDescription,
  commitCoAuthors, setCommitCoAuthors,
  gitConfig, localUserName, setLocalUserName, localUserEmail, setLocalUserEmail,
  githubAccounts, githubCliStatus,
  setNotice, onOpenReview, onOpenStash, stashCount,
  generateCommitText, canGenerateCommitText,
  commitActionState, commitAndPushActionState, amendCommitActionState,
  commitChanges, amendLastCommit,
  currentRepoPath, runSnapshotAction, api,
  selectedChange, selectedDiffStats, discardSelected,
  diffMode, diffDisplayMode, setDiffDisplayMode, diffIgnoreWhitespace, setDiffIgnoreWhitespace,
  diffExpanded, setDiffExpanded,
  diff, imagePreview, stageSelectedHunk, unstageSelectedHunk, discardSelectedHunk, discardSelectedLines
}: {
  snapshot: RepositorySnapshot | null
  counts: RepositorySnapshot['status']['counts'] | undefined
  busy: boolean
  itemHeight: number
  changeFilter: string
  setChangeFilter: (value: string) => void
  changeSearchMode: ChangeSearchMode
  setChangeSearchMode: (mode: ChangeSearchMode) => void
  changeContentIndexing: boolean
  filteredChanges: FileChange[]
  virtualChanges: ReturnType<typeof useVirtualList<FileChange>>
  changesActionsMenuRef: RefObject<HTMLDetailsElement | null>
  closeChangesActionsMenu: () => void
  createQuickStash: () => void | Promise<void>
  canCreateStash: boolean
  exportPatch: (scope?: PatchScope) => void | Promise<void>
  applyPatch: () => void | Promise<void>
  bulkStageToggleState: ReturnType<typeof getBulkStageToggleState>
  toggleBulkStage: () => void | Promise<void>
  toggleChangeStage: (change: FileChange) => void | Promise<void>
  selectedFilePath: string | null
  setSelectedFilePath: (path: string) => void
  setDiffMode: (mode: ChangeDiffMode) => void
  setViewMode: (mode: ViewMode) => void
  commitTitle: string
  setCommitTitle: (value: string) => void
  commitDescription: string
  setCommitDescription: (value: string) => void
  commitCoAuthors: string
  setCommitCoAuthors: (value: string) => void
  gitConfig: GitConfigSnapshot | null
  localUserName: string
  setLocalUserName: (value: string) => void
  localUserEmail: string
  setLocalUserEmail: (value: string) => void
  githubAccounts: GitHubAccountSummary[]
  githubCliStatus: GitHubCliStatus | null
  setNotice: (message: string) => void
  onOpenReview: () => void
  onOpenStash: () => void
  stashCount: number
  generateCommitText: () => void | Promise<void>
  canGenerateCommitText: boolean
  commitActionState: ReturnType<typeof getCommitActionState>
  commitAndPushActionState: ReturnType<typeof getCommitAndPushActionState>
  amendCommitActionState: ReturnType<typeof getAmendCommitActionState>
  commitChanges: () => Promise<boolean>
  amendLastCommit: () => void | Promise<boolean>
  currentRepoPath: string | undefined
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>) => boolean | void | Promise<boolean>
  api: BranchPilotApi | undefined
  selectedChange: FileChange | null
  selectedDiffStats: { additions: number; deletions: number } | null
  discardSelected: (change?: FileChange | null) => void | Promise<void>
  diffMode: ChangeDiffMode
  diffDisplayMode: 'unified' | 'split'
  setDiffDisplayMode: (mode: 'unified' | 'split') => void
  diffIgnoreWhitespace: boolean
  setDiffIgnoreWhitespace: (value: boolean) => void
  diffExpanded: boolean
  setDiffExpanded: (value: boolean) => void
  diff: DiffResult | null
  imagePreview: ImagePreview | null
  stageSelectedHunk: (hunk: DiffHunk) => void
  unstageSelectedHunk: (hunk: DiffHunk) => void
  discardSelectedHunk: (hunk: DiffHunk) => void
  discardSelectedLines: (patch: string) => void
}) {
  const totalChanges = snapshot?.status.changes.length ?? 0
  const { containerRef: changesContainerRef, onScroll: changesScroll, window: changesWindow, items: changesItems } = virtualChanges
  const {
    gridRef: splitGridRef,
    paneWidth: changesPaneWidth,
    splitStyle,
    startPaneResize: startChangesPaneResize,
    handleSplitKeyDown,
    minPaneWidth,
    maxPaneWidth
  } = useWorkflowPaneResize()
  const [showCoAuthors, setShowCoAuthors] = useState(false)
  const coAuthorsVisible = showCoAuthors
  const [contributors, setContributors] = useState<CoAuthor[]>([])
  const [githubCoAuthors, setGithubCoAuthors] = useState<CoAuthor[]>([])
  const [coAuthorAccounts, setCoAuthorAccounts] = useState<GitHubAccountSummary[]>([])
  const [githubCoAuthorsLoading, setGithubCoAuthorsLoading] = useState(false)
  const [coAuthorFilter, setCoAuthorFilter] = useState('')
  const [commitIdentitySaving, setCommitIdentitySaving] = useState(false)
  const [commitIdentityStats, setCommitIdentityStats] = useState<ContributorStat[]>([])
  const [coAuthorAccountsAttempted, setCoAuthorAccountsAttempted] = useState(false)
  const patchActionsMenuRef = useRef<HTMLDetailsElement>(null)
  const accountSummaries = mergeGitHubAccounts(githubAccounts, coAuthorAccounts)
  const identityCoAuthors = buildIdentityCoAuthors(
    localUserName,
    localUserEmail,
    accountSummaries
  )

  useEffect(() => {
    if (!coAuthorsVisible || !currentRepoPath || !api) return
    let cancelled = false
    const load = async () => {
      const merged = new Map<string, CoAuthor>()
      const seenNames = new Set<string>()
      // GitHub contributors first (carry avatars + @login), then fill gaps from git log.
      if (typeof api.getGitHubContributors === 'function') {
        const result = await api.getGitHubContributors(currentRepoPath).catch(() => null)
        if (result?.ok) {
          for (const contributor of result.data) {
            merged.set(contributor.email.toLowerCase(), contributor)
            if (contributor.login) seenNames.add(contributor.login.toLowerCase())
          }
        }
      }
      if (typeof api.getContributors === 'function') {
        const result = await api.getContributors(currentRepoPath).catch(() => null)
        if (result?.ok) {
          for (const contributor of result.data) {
            const key = contributor.email.toLowerCase()
            if (merged.has(key) || seenNames.has(contributor.name.toLowerCase())) continue
            merged.set(key, { ...contributor, source: 'repository' })
          }
        }
      }
      if (typeof api.searchGitHubCoAuthors === 'function') {
        const result = await api.searchGitHubCoAuthors({ repoPath: currentRepoPath, query: '', limit: 100 }).catch(() => null)
        if (result?.ok) {
          for (const contributor of result.data) {
            const key = contributor.email.toLowerCase()
            if (merged.has(key)) continue
            merged.set(key, contributor)
          }
        }
      }
      if (!cancelled) setContributors([...merged.values()])
    }
    void load()
    return () => { cancelled = true }
  }, [coAuthorsVisible, currentRepoPath, api])

  useEffect(() => {
    setCoAuthorAccountsAttempted(false)
  }, [githubCliStatus?.authenticated, githubCliStatus?.authProvider, githubCliStatus?.username])

  useEffect(() => {
    if (!api || coAuthorAccounts.length > 0 || coAuthorAccountsAttempted) return
    let cancelled = false
    setCoAuthorAccountsAttempted(true)

    void api.listGitHubAccounts()
      .then((result) => {
        if (!cancelled && result.ok) setCoAuthorAccounts(result.data)
      })
      .catch(() => {
        if (!cancelled) setCoAuthorAccounts([])
      })

    return () => { cancelled = true }
  }, [api, coAuthorAccounts.length, coAuthorAccountsAttempted])

  useEffect(() => {
    if (!api || !currentRepoPath || typeof api.getContributorStats !== 'function') {
      setCommitIdentityStats([])
      return
    }

    let cancelled = false

    void api.getContributorStats({ repoPath: currentRepoPath, window: 'all' })
      .then((result) => {
        if (!cancelled) setCommitIdentityStats(result.ok ? result.data : [])
      })
      .catch(() => {
        if (!cancelled) setCommitIdentityStats([])
      })

    return () => { cancelled = true }
  }, [api, currentRepoPath])

  useEffect(() => {
    const query = coAuthorFilter.trim()

    if (!coAuthorsVisible || !currentRepoPath || !api) {
      setGithubCoAuthors([])
      setGithubCoAuthorsLoading(false)
      return
    }

    if (query.length < 2) {
      setGithubCoAuthors([])
      setGithubCoAuthorsLoading(false)
      return
    }

    let cancelled = false
    setGithubCoAuthorsLoading(true)

    const timeout = window.setTimeout(() => {
      void api.searchGitHubCoAuthors({ repoPath: currentRepoPath, query, limit: 100 })
        .then((result) => {
          if (!cancelled) setGithubCoAuthors(result.ok ? result.data : [])
        })
        .catch(() => {
          if (!cancelled) setGithubCoAuthors([])
        })
        .finally(() => {
          if (!cancelled) setGithubCoAuthorsLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [api, coAuthorFilter, coAuthorsVisible, currentRepoPath])

  const toggleCoAuthor = (contributor: CoAuthor) => {
    if (isCoAuthorSelected(commitCoAuthors, contributor)) {
      setCommitCoAuthors(removeCoAuthor(commitCoAuthors, contributor))
      return
    }

    const entry = `${contributor.name} <${contributor.email}>`
    setCommitCoAuthors(commitCoAuthors.trim() ? `${commitCoAuthors.trim()}\n${entry}` : entry)
    setCoAuthorFilter('')
  }

  const coAuthorQuery = coAuthorFilter.trim().toLowerCase()
  const selectedCommitIdentityEmail = localUserEmail.trim().toLowerCase()
  const commitIdentityOptions = buildCommitIdentityOptions(
    snapshot,
    gitConfig,
    localUserName,
    localUserEmail,
    accountSummaries,
    commitIdentityStats,
    contributors
  )
  const coAuthorSuggestions = filterOwnCoAuthorSuggestions(
    buildCoAuthorSuggestions(
      [],
      contributors,
      githubCoAuthors,
      coAuthorQuery
    ),
    commitIdentityOptions.length > 0 ? commitIdentityOptions : identityCoAuthors,
    accountSummaries
  )
  const commitTooltip = actionTooltip('Commit staged changes', 'Commit blocked', commitActionState, busy)
  const amendTooltip = actionTooltip('Amend the previous commit with current staged changes', 'Amend blocked', amendCommitActionState, busy)
  const commitAndPushTooltip = actionTooltip('Commit staged changes and push to the upstream branch', 'Commit & push blocked', commitAndPushActionState, busy)
  const commitGenerateBlockedReason = (() => {
    if (busy) return 'Another repository operation is running.'
    if (!snapshot) return 'Open a repository before generating commit text.'
    if (snapshot.status.merge.operation !== 'none') return 'Finish or abort the current merge operation before generating commit text.'
    if (snapshot.status.counts.conflicted > 0) return 'Resolve conflicted files before generating commit text.'
    if (snapshot.status.counts.staged === 0) return 'Stage at least one change before generating commit text.'
    if (!canGenerateCommitText) return 'Commit text generation is blocked by assistant policy.'
    return ''
  })()
  const commitGenerateTooltip = commitGenerateBlockedReason || 'Generate commit text with the selected AI assistant'
  const handleGenerateCommitText = () => {
    if (commitGenerateBlockedReason) {
      setNotice(commitGenerateBlockedReason)
      return
    }

    void generateCommitText()
  }

  const notifyBlocked = (title: string, reasons: string[]) => {
    setNotice(reasons.length > 0 ? `${title}: ${reasons.join(' · ')}` : title)
  }

  const selectCommitIdentity = async (identity: CoAuthor) => {
    const name = identity.name.trim()
    const email = identity.email.trim()
    if (!api || !currentRepoPath || busy || commitIdentitySaving || !name || !email) return false
    if (email.toLowerCase() === selectedCommitIdentityEmail && name === localUserName.trim()) return true

    setCommitIdentitySaving(true)
    try {
      const result = await api.setLocalGitIdentity({ repoPath: currentRepoPath, name, email })
      if (result.ok) {
        setLocalUserName(name)
        setLocalUserEmail(email)
        setNotice(`Commit identity set to ${name} <${email}>.`)
        return true
      } else {
        setNotice(result.error.message)
        return false
      }
    } finally {
      setCommitIdentitySaving(false)
    }
  }

  const [diffMenu, setDiffMenu] = useState<{ x: number; y: number; change: FileChange | null } | null>(null)

  useEffect(() => {
    if (!diffMenu) return
    const close = () => setDiffMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDiffMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [diffMenu])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const menu = patchActionsMenuRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const stageSelectedFile = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void runSnapshotAction('File staged.', () => api!.stageFile({ repoPath: currentRepoPath, filePath: change.path }))
  }

  const unstageSelectedFile = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void runSnapshotAction('File unstaged.', () => api!.unstageFile({ repoPath: currentRepoPath, filePath: change.path }))
  }

  const discardFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    void discardSelected(change)
  }

  const openInEditorFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void api.openInEditor({ targetPath: buildRepoFilePath(currentRepoPath, change.path) }).then((result) => {
      setNotice(result.ok ? result.data.message || 'File opened in editor.' : result.error.message)
    })
  }

  const openTerminalFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void api.openTerminal(buildRepoFileDirectory(currentRepoPath, change.path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Terminal opened.' : result.error.message)
    })
  }

  const showInFileManagerFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath || !api) return
    void api.showItemInFolder(buildRepoFilePath(currentRepoPath, change.path)).then((result) => {
      setNotice(result.ok ? result.data.message || 'Shown in file manager.' : result.error.message)
    })
  }

  const copyPathFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change || !currentRepoPath) return
    void navigator.clipboard.writeText(buildRepoFilePath(currentRepoPath, change.path))
  }

  const copyNameFromMenu = () => {
    const change = diffMenu?.change ?? selectedChange
    setDiffMenu(null)
    if (!change) return
    void navigator.clipboard.writeText(change.path.split('/').pop() ?? change.path)
  }

  const noChanges = totalChanges === 0
  const contextMenuChange = diffMenu?.change ?? selectedChange
  const canDiscardSelectedFile = Boolean(selectedChange && (selectedChange.unstaged || selectedChange.untracked))
  const changeSearchModeLabel = changeSearchMode === 'path' ? 'Name' : changeSearchMode === 'content' ? 'Diff' : 'All'
  const closePatchActionsMenu = () => {
    if (patchActionsMenuRef.current) patchActionsMenuRef.current.open = false
  }

  return (
    <section className="content-grid changes-workflow-grid" ref={splitGridRef} style={splitStyle}>
      <div className="changes-panel changes-panel-compact">
        <ViewSwitch viewMode="changes" setViewMode={setViewMode} changedCount={counts?.changed ?? 0} />
        <div className="change-filter-bar change-filter-bar-compact">
          <details className="changes-actions-menu search-filter-menu" ref={changesActionsMenuRef}>
            <summary title="Search scope" aria-label="Search scope">
              <ListFilter size={16} />
              {changeSearchModeLabel}
            </summary>
            <div className="changes-actions-popover search-filter-popover">
              <button
                type="button"
                className={changeSearchMode === 'path' ? 'active' : undefined}
                onClick={() => {
                  setChangeSearchMode('path')
                  closeChangesActionsMenu()
                }}
              >
                Name
              </button>
              <button
                type="button"
                className={changeSearchMode === 'content' ? 'active' : undefined}
                onClick={() => {
                  setChangeSearchMode('content')
                  closeChangesActionsMenu()
                }}
              >
                Diff
              </button>
              <button
                type="button"
                className={changeSearchMode === 'all' ? 'active' : undefined}
                onClick={() => {
                  setChangeSearchMode('all')
                  closeChangesActionsMenu()
                }}
              >
                All
              </button>
            </div>
          </details>
          <label className="change-filter-input" htmlFor="change-filter">
            <Search size={16} />
            <input
              id="change-filter"
              value={changeFilter}
              onChange={(event) => setChangeFilter(event.target.value)}
              placeholder="Search changed files"
            />
          </label>
          <details className="changes-actions-menu patch-actions-menu" ref={patchActionsMenuRef}>
            <summary title="Patch actions" aria-label="Patch actions">
              <UploadCloud size={16} />
            </summary>
            <div className="changes-actions-popover patch-actions-popover">
              <div className="changes-actions-section">
                <span>Export patch</span>
                <button
                  type="button"
                  onClick={() => {
                    closePatchActionsMenu()
                    void exportPatch('working-tree')
                  }}
                  disabled={busy || !snapshot}
                >
                  <Copy size={15} />
                  Working tree
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closePatchActionsMenu()
                    void exportPatch('staged')
                  }}
                  disabled={busy || !snapshot || !counts?.staged}
                >
                  <Copy size={15} />
                  Staged changes
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  closePatchActionsMenu()
                  void applyPatch()
                }}
                disabled={busy || !snapshot || snapshot.status.merge.operation !== 'none'}
              >
                <UploadCloud size={15} />
                Apply patch
              </button>
            </div>
          </details>
          <button
            type="button"
            className="icon-button search-toolbar-button"
            title="Stash changes"
            aria-label="Stash changes"
            onClick={() => { void createQuickStash() }}
            disabled={busy || !canCreateStash}
          >
            <Save size={16} />
          </button>
          {changeContentIndexing && changeSearchMode !== 'path' && changeFilter && <span>Indexing diffs...</span>}
          {changeFilter && (
            <button type="button" className="secondary" onClick={() => setChangeFilter('')}>
              <X size={15} />
              Clear
            </button>
          )}
        </div>

        <div className="change-list-header">
          <BulkStageCheckbox
            state={bulkStageToggleState}
            disabled={busy}
            changedCount={totalChanges}
            onToggle={toggleBulkStage}
          />
        </div>

        <div className="change-list virtual-list-viewport" ref={changesContainerRef} onScroll={changesScroll}>
          {snapshot?.status.changes.length === 0 ? (
            <div className="quiet-box">Working tree is clean.</div>
          ) : filteredChanges.length === 0 ? (
            <div className="quiet-box">No changed files match this search.</div>
          ) : (
            <div className="virtual-list-spacer" style={{ height: changesWindow.totalHeight }}>
              {changesItems.map(({ item: change, index }) => {
                const isSelected = selectedFilePath === change.path
                const stageState = changeStageState(change)
                const stageLabel = changeStageStateLabel(change)
                const fileTypeIcon = fileTypeIconForPath(change.path)

                return (
                <div
                  className="virtual-list-item"
                  key={change.path}
                  style={{ transform: `translateY(${index * itemHeight}px)` }}
                >
                  <div
                    className={isSelected ? 'change-row selected' : 'change-row'}
                    data-stage-state={stageState}
                    aria-selected={isSelected}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setDiffMenu({ x: event.clientX, y: event.clientY, change })
                    }}
                  >
                    <StageCheckbox
                      change={change}
                      disabled={busy || change.conflicted}
                      onToggle={toggleChangeStage}
                    />
                    <button
                      className="change-select"
                      type="button"
                      title={`${change.path} · ${stageLabel} · ${changeLabel(change)}`}
                      aria-label={`${change.path}, ${stageLabel}, ${changeLabel(change)}`}
                      onClick={() => {
                        setSelectedFilePath(change.path)
                        setDiffMode(getDefaultChangeDiffMode(change))
                      }}
                    >
                      <span className="file-label">
                        <span className={`file-type-icon file-type-${fileTypeIcon.tone}`} title={fileTypeIcon.title} aria-hidden="true">
                          {fileTypeIcon.label}
                        </span>
                        <span className="file-name">{change.path}</span>
                      </span>
                      <span className="change-row-badges">
                        <span className={`file-status status-${change.status}`} title={stageLabel} aria-label={stageLabel}>
                          {statusToken(change)}
                        </span>
                      </span>
                    </button>
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </div>

        {stashCount > 0 && (
          <button type="button" className="stash-bar" onClick={onOpenStash} title="View stashed changes">
            <Archive size={16} />
            <span className="stash-bar-label">Stashed changes</span>
            <span className="stash-bar-count">{stashCount}</span>
          </button>
        )}

        <div className="commit-box">
          <div className="commit-summary-row">
            <input
              id="commit-title"
              aria-label="Commit title"
              value={commitTitle}
              onChange={(event) => setCommitTitle(event.target.value)}
              placeholder="Summary (required)"
            />
            <button
              type="button"
              className={commitGenerateBlockedReason ? 'commit-generate blocked' : 'commit-generate'}
              title={commitGenerateTooltip}
              aria-label="Generate commit text"
              aria-disabled={Boolean(commitGenerateBlockedReason)}
              onClick={handleGenerateCommitText}
            >
              <Bot size={16} />
              Generate
            </button>
          </div>
          <textarea
            id="commit-description"
            aria-label="Commit description"
            value={commitDescription}
            onChange={(event) => setCommitDescription(event.target.value)}
            placeholder="Description"
          />
          {coAuthorsVisible && (
            <div className="coauthor-box">
              {commitIdentityOptions.length > 0 && (
                <div className="commit-author-strip" aria-label="Commit author identity">
                  <span className="commit-author-label">Commit as</span>
                  <div className="commit-author-options">
                    {commitIdentityOptions.map((identity) => {
                      const selected = identity.email.toLowerCase() === selectedCommitIdentityEmail
                      const title = `Use ${identity.name} <${identity.email}> for the next commits in this repository. Source: ${identity.meta}.`

                      return (
                        <button
                          type="button"
                          key={identity.email}
                          className={selected ? 'commit-author-chip active' : 'commit-author-chip'}
                          title={title}
                          aria-pressed={selected}
                          disabled={busy || commitIdentitySaving}
                          onClick={() => { void selectCommitIdentity(identity) }}
                        >
                          <span className="commit-author-dot" />
                          <span>
                            <strong>{identity.name}</strong>
                            <small>{identity.email}</small>
                          </span>
                          {selected && <Check size={13} />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <textarea
                id="commit-coauthors"
                className="commit-coauthors"
                aria-label="Commit co-authors"
                value={commitCoAuthors}
                onChange={(event) => setCommitCoAuthors(event.target.value)}
                placeholder="Co-authors: Name <email>, one per line"
              />
              <input
                className="coauthor-filter"
                value={coAuthorFilter}
                onChange={(event) => setCoAuthorFilter(event.target.value)}
                placeholder="Search contributors and organization members..."
                aria-label="Search contributors and GitHub organization members"
              />
              {(coAuthorSuggestions.length > 0 || githubCoAuthorsLoading) && (
                <div className="coauthor-suggestions">
                  {coAuthorSuggestions.map((contributor) => {
                    const selected = isCoAuthorSelected(commitCoAuthors, contributor)
                    const meta = coAuthorMeta(contributor)

                    return (
                      <button
                        type="button"
                        key={`${contributor.source ?? 'coauthor'}:${contributor.organization ?? ''}:${contributor.login ?? ''}:${contributor.email}`}
                        className={selected ? 'coauthor-chip selected' : 'coauthor-chip'}
                        aria-label={coAuthorButtonLabel(contributor, selected)}
                        aria-pressed={selected}
                        onClick={() => toggleCoAuthor(contributor)}
                      >
                        {selected
                          ? <Check size={13} />
                          : contributor.avatarUrl
                            ? <img className="coauthor-avatar" src={contributor.avatarUrl} alt="" />
                            : <Users size={13} />}
                        <span className="coauthor-chip-text">
                          <strong>{contributor.name}</strong>
                          <small>{meta}</small>
                        </span>
                      </button>
                    )
                  })}
                  {githubCoAuthorsLoading && <span className="coauthor-searching">Searching GitHub...</span>}
                </div>
              )}
            </div>
          )}
          <div className="commit-actions">
            <button
              className={coAuthorsVisible ? 'icon-button active' : 'icon-button'}
              type="button"
              title={coAuthorsVisible ? 'Hide author tools' : 'Author tools'}
              aria-label="Author tools"
              aria-pressed={coAuthorsVisible}
              onClick={() => setShowCoAuthors((value) => !value)}
            >
              <Users size={16} />
            </button>
            <button className="icon-button" type="button" title="Review changes" aria-label="Review changes" onClick={onOpenReview}>
              <ShieldCheck size={16} />
            </button>
            <button
              type="button"
              className={commitActionState.enabled ? undefined : 'blocked'}
              title={commitTooltip}
              aria-disabled={busy || !commitActionState.enabled}
              onClick={() => {
                if (busy) return
                if (!commitActionState.enabled) {
                  notifyBlocked('Commit blocked', commitActionState.reasons)
                  return
                }
                void commitChanges()
              }}
            >
              <GitCommitHorizontal size={17} />
              Commit
            </button>
            <button
              type="button"
              className={amendCommitActionState.enabled ? 'danger-button' : 'danger-button blocked'}
              title={amendTooltip}
              aria-disabled={busy || !amendCommitActionState.enabled}
              onClick={() => {
                if (busy) return
                if (!amendCommitActionState.enabled) {
                  notifyBlocked('Amend blocked', amendCommitActionState.reasons)
                  return
                }
                void amendLastCommit()
              }}
            >
              <Pencil size={17} />
              Amend last
            </button>
            <button
              type="button"
              className={commitAndPushActionState.enabled ? 'secondary' : 'secondary blocked'}
              title={commitAndPushTooltip}
              aria-disabled={busy || !commitAndPushActionState.enabled}
              onClick={async () => {
                if (busy) return
                if (!commitAndPushActionState.enabled) {
                  notifyBlocked('Commit & push blocked', commitAndPushActionState.reasons)
                  return
                }
                const committed = await commitChanges()
                if (committed && currentRepoPath) {
                  await runSnapshotAction('Push complete.', () => api!.push(currentRepoPath))
                }
              }}
            >
              <UploadCloud size={17} />
              Commit & push
            </button>
          </div>
        </div>
      </div>

      <div
        className="changes-splitter"
        role="separator"
        aria-label="Resize changes and diff panes"
        aria-orientation="vertical"
        aria-valuemin={minPaneWidth}
        aria-valuemax={maxPaneWidth}
        aria-valuenow={changesPaneWidth}
        tabIndex={0}
        onPointerDown={startChangesPaneResize}
        onKeyDown={handleSplitKeyDown}
      >
        <span />
      </div>

      <div
        className="diff-panel"
        onContextMenu={(event) => {
          if (!selectedChange) return
          event.preventDefault()
          setDiffMenu({ x: event.clientX, y: event.clientY, change: selectedChange })
        }}
      >
        {noChanges ? (
        <div className="no-changes">
          <div className="no-changes-hero">
            <span className="no-changes-icon"><GitCommitHorizontal size={26} /></span>
            <h2>No local changes</h2>
            <p>There are no uncommitted changes in this repository. Here are a few things you can do next.</p>
          </div>
          <div className="no-changes-cards">
            <button type="button" className="no-changes-card" disabled={!currentRepoPath || busy || !api} onClick={() => currentRepoPath && api && void api.openInEditor({ targetPath: currentRepoPath })}>
              <Code2 size={18} />
              <span className="no-changes-card-text">
                <strong>Open in your editor</strong>
                <span>Edit files in your configured editor.</span>
              </span>
            </button>
            <button type="button" className="no-changes-card" onClick={() => setViewMode('history')}>
              <Clock3 size={18} />
              <span className="no-changes-card-text">
                <strong>Review history</strong>
                <span>Browse past commits on this branch.</span>
              </span>
            </button>
            <button type="button" className="no-changes-card" onClick={() => setViewMode('providers')}>
              <GitPullRequest size={18} />
              <span className="no-changes-card-text">
                <strong>Pull requests</strong>
                <span>Open or create a pull request.</span>
              </span>
            </button>
          </div>
        </div>
        ) : (
        <>
        <div className="panel-heading diff-heading">
          <div className="diff-heading-main">
            <h2>Diff</h2>
            <p>{selectedChange?.path ?? 'Select a changed file'}</p>
            {selectedDiffStats && (
              <div className="diff-stats" aria-label="Selected file diff stats">
                <span className="additions">+{selectedDiffStats.additions}</span>
                <span className="deletions">-{selectedDiffStats.deletions}</span>
              </div>
            )}
          </div>
          <div className="panel-actions diff-controls">
            {selectedChange && (
              <div className="diff-file-actions" aria-label="Selected file actions">
                <button
                  type="button"
                  className="danger"
                  title={canDiscardSelectedFile ? (selectedChange.untracked ? 'Delete this untracked file' : 'Discard unstaged changes in this file') : 'Unstage this file before discarding staged-only changes'}
                  onClick={discardFromMenu}
                  disabled={busy || !api || !currentRepoPath || !canDiscardSelectedFile}
                >
                  <Trash2 size={15} />
                  {selectedChange.untracked ? 'Delete' : 'Discard'}
                </button>
              </div>
            )}
            <button
              type="button"
              className={diffIgnoreWhitespace ? 'icon-button active' : 'icon-button'}
              title="Ignore whitespace-only changes"
              aria-label="Ignore whitespace"
              aria-pressed={diffIgnoreWhitespace}
              onClick={() => setDiffIgnoreWhitespace(!diffIgnoreWhitespace)}
            >
              <Pilcrow size={16} />
            </button>
            <button
              type="button"
              className={diffExpanded ? 'icon-button active' : 'icon-button'}
              title={diffExpanded ? 'Collapse diff context' : 'Show more context'}
              aria-label={diffExpanded ? 'Collapse diff context' : 'Show more context'}
              aria-pressed={diffExpanded}
              onClick={() => setDiffExpanded(!diffExpanded)}
              disabled={!selectedChange}
            >
              {diffExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <div className="segmented diff-display-toggle" aria-label="Diff display mode">
              <button
                className={diffDisplayMode === 'unified' ? 'active' : ''}
                type="button"
                title="Unified diff (single column)"
                aria-label="Unified diff"
                onClick={() => setDiffDisplayMode('unified')}
              >
                <Rows3 size={16} />
              </button>
              <button
                className={diffDisplayMode === 'split' ? 'active' : ''}
                type="button"
                title="Split diff (side by side)"
                aria-label="Split diff"
                onClick={() => setDiffDisplayMode('split')}
              >
                <Columns2 size={16} />
              </button>
            </div>
          </div>
        </div>

        <DiffPreview
          diff={diff}
          imagePreview={imagePreview}
          mode={diffMode}
          displayMode={diffDisplayMode}
          expanded={diffExpanded}
          busy={busy}
          onStageHunk={stageSelectedHunk}
          onUnstageHunk={unstageSelectedHunk}
          onDiscardHunk={discardSelectedHunk}
          onStageLines={(patch) => {
            if (!currentRepoPath || !selectedChange || !api) return
            void runSnapshotAction('Selected lines staged.', () => api.stageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch }))
          }}
          onUnstageLines={(patch) => {
            if (!currentRepoPath || !selectedChange || !api) return
            void runSnapshotAction('Selected lines unstaged.', () => api.unstageHunk({ repoPath: currentRepoPath, filePath: selectedChange.path, patch }))
          }}
          onDiscardLines={discardSelectedLines}
          onExpandContext={() => setDiffExpanded(true)}
        />
        </>
        )}

        {diffMenu && contextMenuChange && (
          <div className="context-menu" role="menu" style={{ top: diffMenu.y, left: diffMenu.x }}>
            <button
              type="button"
              role="menuitem"
              title="Stage all changes in this file"
              onClick={stageSelectedFile}
              disabled={busy || (!contextMenuChange.unstaged && !contextMenuChange.untracked)}
            >
              <PlusSquare size={15} />
              Stage file
            </button>
            <button
              type="button"
              role="menuitem"
              title="Unstage this file"
              onClick={unstageSelectedFile}
              disabled={busy || !contextMenuChange.staged}
            >
              <MinusSquare size={15} />
              Unstage file
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              title={contextMenuChange.untracked ? 'Delete this untracked file' : 'Discard changes to this file'}
              onClick={discardFromMenu}
              disabled={busy || (!contextMenuChange.unstaged && !contextMenuChange.untracked)}
            >
              <Trash2 size={15} />
              {contextMenuChange.untracked ? 'Delete file' : 'Discard changes'}
            </button>
            <div className="context-menu-separator" role="separator" />
            <button type="button" role="menuitem" title="Open this file in your editor" onClick={openInEditorFromMenu} disabled={busy || !api}>
              <Code2 size={15} />
              Open in editor
            </button>
            <button type="button" role="menuitem" title="Open a terminal in this file's folder" onClick={openTerminalFromMenu} disabled={busy || !api}>
              <Terminal size={15} />
              Open in terminal
            </button>
            <button type="button" role="menuitem" title="Show this file in the file manager" onClick={showInFileManagerFromMenu} disabled={busy || !api}>
              <FolderOpen size={15} />
              Show in file manager
            </button>
            <div className="context-menu-separator" role="separator" />
            <button type="button" role="menuitem" title="Copy the absolute file path" onClick={copyPathFromMenu}>
              <Copy size={15} />
              Copy path
            </button>
            <button type="button" role="menuitem" title="Copy the file name" onClick={copyNameFromMenu}>
              <Copy size={15} />
              Copy file name
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
