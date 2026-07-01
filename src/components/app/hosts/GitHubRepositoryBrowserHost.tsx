import { GitHubRepositoryBrowser } from '../../ProvidersPanels'
import { useController } from '../../../hooks/AppControllerContext'

export function GitHubRepositoryBrowserHost() {
  const {
    githubCliStatus,
    githubRepositories,
    githubAccounts,
    githubAccountsLoading,
    githubRepoLoading,
    githubRepoOwner,
    setGithubRepoOwner,
    githubRepoQuery,
    setGithubRepoQuery,
    githubRepoVisibility,
    setGithubRepoVisibility,
    githubRepoLimit,
    busy,
    loadGitHubAccounts,
    loadGitHubRepositories,
    cloneGitHubRepository,
    openExternalLink
  } = useController()

  return (
    <GitHubRepositoryBrowser
      githubCliStatus={githubCliStatus}
      githubRepositories={githubRepositories}
      githubAccounts={githubAccounts}
      githubAccountsLoading={githubAccountsLoading}
      githubRepoLoading={githubRepoLoading}
      githubRepoOwner={githubRepoOwner}
      setGithubRepoOwner={setGithubRepoOwner}
      githubRepoQuery={githubRepoQuery}
      setGithubRepoQuery={setGithubRepoQuery}
      githubRepoVisibility={githubRepoVisibility}
      setGithubRepoVisibility={setGithubRepoVisibility}
      githubRepoLimit={githubRepoLimit}
      busy={busy}
      loadGitHubAccounts={loadGitHubAccounts}
      loadGitHubRepositories={loadGitHubRepositories}
      cloneGitHubRepository={cloneGitHubRepository}
      openExternalLink={openExternalLink}
    />
  )
}
