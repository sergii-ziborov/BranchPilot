import { ProvidersView } from '../../views/ProvidersView'
import { useController } from '../../../hooks/AppControllerContext'
import { GitHubRepositoryBrowserHost } from '../hosts/GitHubRepositoryBrowserHost'
import { PullRequestDetailsHost } from '../hosts/PullRequestDetailsHost'

const api = window.branchPilot

interface ProvidersRouteProps {
  onOpenPublishRepository: () => void
}

export function ProvidersRoute({ onOpenPublishRepository }: ProvidersRouteProps) {
  const {
    providers,
    snapshot,
    currentRepoPath,
    busy,
    assistantPolicy,
    githubCliStatus,
    canGeneratePullRequestText,
    canPublishBranch,
    createdPullRequest,
    currentPullRequest,
    pullRequests,
    pullRequestsLoading,
    selectedPullRequestNumber,
    prTitle,
    setPrTitle,
    prDescription,
    setPrDescription,
    prBaseBranch,
    setPrBaseBranch,
    checkoutPullRequest,
    createPullRequest,
    generatePullRequestText,
    loadGitHubPullRequests,
    refreshProvidersPanel,
    connectGitHub,
    selectPullRequest,
    openExternalLink,
    runSnapshotAction,
    setViewMode
  } = useController()

  return (
    <ProvidersView
      onBack={() => setViewMode('changes')}
      providers={providers}
      snapshot={snapshot}
      api={api}
      currentRepoPath={currentRepoPath}
      busy={busy}
      assistantPolicy={assistantPolicy}
      githubCliStatus={githubCliStatus}
      canGeneratePullRequestText={canGeneratePullRequestText}
      canPublishBranch={canPublishBranch}
      createdPullRequest={createdPullRequest}
      currentPullRequest={currentPullRequest}
      pullRequests={pullRequests}
      pullRequestsLoading={pullRequestsLoading}
      selectedPullRequestNumber={selectedPullRequestNumber}
      prTitle={prTitle}
      setPrTitle={setPrTitle}
      prDescription={prDescription}
      setPrDescription={setPrDescription}
      prBaseBranch={prBaseBranch}
      setPrBaseBranch={setPrBaseBranch}
      checkoutPullRequest={checkoutPullRequest}
      createPullRequest={createPullRequest}
      generatePullRequestText={generatePullRequestText}
      loadGitHubPullRequests={loadGitHubPullRequests}
      refreshProvidersPanel={refreshProvidersPanel}
      connectGitHub={connectGitHub}
      selectPullRequest={selectPullRequest}
      openExternalLink={openExternalLink}
      runSnapshotAction={runSnapshotAction}
      onOpenPublishRepository={onOpenPublishRepository}
      renderGitHubRepositoryBrowser={() => <GitHubRepositoryBrowserHost />}
      renderPullRequestDetailsPanel={() => <PullRequestDetailsHost />}
    />
  )
}
