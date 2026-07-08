import { useEffect, useState } from 'react'
import type { CoAuthor, GitHubAccountSummary } from '../../shared/branchPilot'
import {
  buildCommitIdentityOptions,
  buildIdentityCoAuthors,
  commitIdentityAvatarUrl,
  loadCachedGitHubAccounts,
  loadRememberedIdentities,
  mergeGitHubAccounts,
  rememberIdentity,
  saveCachedGitHubAccounts,
  type CommitIdentityOption,
  type RememberedIdentity
} from '../../lib/commitIdentity'
import type { CommitComposerProps } from './CommitComposer.types'

export type CommitIdentityStateProps = Pick<
  CommitComposerProps,
  | 'api'
  | 'currentRepoPath'
  | 'snapshot'
  | 'gitConfig'
  | 'localUserName'
  | 'setLocalUserName'
  | 'localUserEmail'
  | 'setLocalUserEmail'
  | 'githubAccounts'
  | 'githubCliStatus'
  | 'busy'
  | 'setNotice'
>

export interface CommitIdentityState {
  accountSummaries: GitHubAccountSummary[]
  identityCoAuthors: CoAuthor[]
  commitIdentityOptions: CommitIdentityOption[]
  selectedCommitIdentityKey: string
  selectedCommitIdentityName: string
  selectedCommitIdentityEmailText: string
  selectedCommitIdentityAvatar: string | undefined
  githubIdentityLabel: string
  commitIdentitySaving: boolean
  commitIdentityAccountsLoading: boolean
  loadCommitIdentityAccounts: (force?: boolean) => Promise<void>
  selectCommitIdentity: (identity: CoAuthor) => Promise<boolean>
}

export function useCommitIdentityState({
  api,
  currentRepoPath,
  snapshot,
  gitConfig,
  localUserName,
  setLocalUserName,
  localUserEmail,
  setLocalUserEmail,
  githubAccounts,
  githubCliStatus,
  busy,
  setNotice
}: CommitIdentityStateProps): CommitIdentityState {
  const [coAuthorAccounts, setCoAuthorAccounts] = useState<GitHubAccountSummary[]>(() => loadCachedGitHubAccounts())
  const [commitIdentitySaving, setCommitIdentitySaving] = useState(false)
  const [commitIdentityAccountsLoading, setCommitIdentityAccountsLoading] = useState(false)
  const [coAuthorAccountsAttempted, setCoAuthorAccountsAttempted] = useState(() => loadCachedGitHubAccounts().length > 0)
  const [rememberedIdentities, setRememberedIdentities] = useState<RememberedIdentity[]>(() => loadRememberedIdentities())
  const accountSummaries = mergeGitHubAccounts(githubAccounts, coAuthorAccounts)
  const identityCoAuthors = buildIdentityCoAuthors(localUserName, localUserEmail, accountSummaries)

  useEffect(() => {
    const name = snapshot?.summary.gitUserName
    const email = snapshot?.summary.gitUserEmail
    if (name && email) setRememberedIdentities(rememberIdentity(name, email))
  }, [snapshot?.summary.gitUserName, snapshot?.summary.gitUserEmail])

  useEffect(() => {
    if (githubAccounts.length === 0) return
    const mergedAccounts = mergeGitHubAccounts(coAuthorAccounts, githubAccounts)
    setCoAuthorAccounts(mergedAccounts)
    saveCachedGitHubAccounts(mergedAccounts)
    setCoAuthorAccountsAttempted(true)
  }, [githubAccounts])

  const loadCommitIdentityAccounts = async (force = false) => {
    if (!api || commitIdentityAccountsLoading) return
    if (!force && (coAuthorAccountsAttempted || accountSummaries.length > 0)) return

    setCommitIdentityAccountsLoading(true)
    setCoAuthorAccountsAttempted(true)

    try {
      const result = await api.listGitHubAccounts()
      if (result.ok) {
        const mergedAccounts = mergeGitHubAccounts(accountSummaries, result.data)
        setCoAuthorAccounts(mergedAccounts)
        saveCachedGitHubAccounts(mergedAccounts)
        setNotice(`Loaded ${mergedAccounts.length} GitHub account${mergedAccounts.length === 1 ? '' : 's'} for commit identity.`)
      } else if (force) {
        setNotice(result.error.message)
      }
    } catch (error) {
      if (force) setNotice(error instanceof Error ? error.message : 'Could not load GitHub accounts.')
    } finally {
      setCommitIdentityAccountsLoading(false)
    }
  }

  const selectedCommitIdentityEmail = localUserEmail.trim().toLowerCase()
  const commitIdentityOptions = buildCommitIdentityOptions(
    snapshot,
    gitConfig,
    localUserName,
    localUserEmail,
    accountSummaries,
    [],
    rememberedIdentities
  )
  const selectedCommitIdentity = commitIdentityOptions.find((identity) => identity.email.toLowerCase() === selectedCommitIdentityEmail)
    ?? commitIdentityOptions[0]
  const selectedCommitIdentityKey = selectedCommitIdentity?.email.toLowerCase() ?? selectedCommitIdentityEmail
  const selectedCommitIdentityName = selectedCommitIdentity?.name || localUserName.trim() || 'Git author'
  const selectedCommitIdentityEmailText = selectedCommitIdentity?.email || localUserEmail.trim() || 'No email configured'
  const selectedCommitIdentityAvatar = commitIdentityAvatarUrl(selectedCommitIdentity)
  const githubIdentityLabel = githubCliStatus?.username
    ? `Git credential: ${githubCliStatus.username}`
    : 'GitHub credential not loaded'

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
        setRememberedIdentities(rememberIdentity(name, email, identity.login))
        setNotice(`Commit identity set to ${name} <${email}>.`)
        return true
      }

      setNotice(result.error.message)
      return false
    } finally {
      setCommitIdentitySaving(false)
    }
  }

  return {
    accountSummaries,
    identityCoAuthors,
    commitIdentityOptions,
    selectedCommitIdentityKey,
    selectedCommitIdentityName,
    selectedCommitIdentityEmailText,
    selectedCommitIdentityAvatar,
    githubIdentityLabel,
    commitIdentitySaving,
    commitIdentityAccountsLoading,
    loadCommitIdentityAccounts,
    selectCommitIdentity
  }
}
