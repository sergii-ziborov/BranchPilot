import { useEffect, useState } from 'react'
import { Check, Users } from 'lucide-react'
import type { CoAuthor, GitHubAccountSummary } from '../../shared/branchPilot'
import {
  buildCoAuthorSuggestions,
  coAuthorButtonLabel,
  coAuthorMeta,
  filterOwnCoAuthorSuggestions,
  isCoAuthorSelected,
  removeCoAuthor,
  type CommitIdentityOption
} from '../../lib/commitIdentity'
import type { CommitComposerProps } from './CommitComposer.types'

export type CoAuthorSectionProps = Pick<
  CommitComposerProps,
  'api' | 'currentRepoPath' | 'commitCoAuthors' | 'setCommitCoAuthors'
> & {
  visible: boolean
  commitIdentityOptions: CommitIdentityOption[]
  identityCoAuthors: CoAuthor[]
  accountSummaries: GitHubAccountSummary[]
}

export function CoAuthorSection({
  visible,
  api,
  currentRepoPath,
  commitCoAuthors,
  setCommitCoAuthors,
  commitIdentityOptions,
  identityCoAuthors,
  accountSummaries
}: CoAuthorSectionProps) {
  const [repositoryAccessCoAuthors, setRepositoryAccessCoAuthors] = useState<CoAuthor[]>([])
  const [githubCoAuthors, setGithubCoAuthors] = useState<CoAuthor[]>([])
  const [githubCoAuthorsLoading, setGithubCoAuthorsLoading] = useState(false)
  const [coAuthorFilter, setCoAuthorFilter] = useState('')

  useEffect(() => {
    if (!visible || !currentRepoPath || !api) return
    let cancelled = false
    const load = async () => {
      const merged = new Map<string, CoAuthor>()

      if (typeof api.getGitHubContributors === 'function') {
        const result = await api.getGitHubContributors(currentRepoPath).catch(() => null)
        if (result?.ok) {
          for (const contributor of result.data) {
            merged.set(contributor.email.toLowerCase(), contributor)
          }
        }
      }

      if (!cancelled) setRepositoryAccessCoAuthors([...merged.values()])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [visible, currentRepoPath, api])

  useEffect(() => {
    const query = coAuthorFilter.trim()

    if (!visible || !currentRepoPath || !api) {
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
  }, [api, coAuthorFilter, visible, currentRepoPath])

  const toggleCoAuthor = (contributor: CoAuthor) => {
    if (isCoAuthorSelected(commitCoAuthors, contributor)) {
      setCommitCoAuthors(removeCoAuthor(commitCoAuthors, contributor))
      return
    }

    const entry = `${contributor.name} <${contributor.email}>`
    setCommitCoAuthors(commitCoAuthors.trim() ? `${commitCoAuthors.trim()}\n${entry}` : entry)
    setCoAuthorFilter('')
  }

  if (!visible) return null

  const coAuthorQuery = coAuthorFilter.trim().toLowerCase()
  const coAuthorSuggestions = filterOwnCoAuthorSuggestions(
    buildCoAuthorSuggestions([], repositoryAccessCoAuthors, githubCoAuthors, coAuthorQuery),
    commitIdentityOptions.length > 0 ? commitIdentityOptions : identityCoAuthors,
    accountSummaries
  )

  return (
    <div className="coauthor-box">
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
        placeholder="Search people with repository access and owner organization..."
        aria-label="Search people with repository access and owner organization members"
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
  )
}
