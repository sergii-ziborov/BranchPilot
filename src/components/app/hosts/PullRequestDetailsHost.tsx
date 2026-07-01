import { PullRequestDetailsPanel } from '../../ProvidersPanels'
import { useController } from '../../../hooks/AppControllerContext'

export function PullRequestDetailsHost() {
  const {
    selectedPullRequestDetails,
    selectedPullRequestChecks,
    selectedPullRequestDiff,
    selectedPullRequestNumber,
    selectedPullRequestFilePath,
    setSelectedPullRequestFilePath,
    pullRequestDetailsLoading,
    selectedPullRequestDiffResult,
    busy,
    githubCliStatus,
    loadPullRequestDetails,
    openExternalLink
  } = useController()

  return (
    <PullRequestDetailsPanel
      selectedPullRequestDetails={selectedPullRequestDetails}
      selectedPullRequestChecks={selectedPullRequestChecks}
      selectedPullRequestDiff={selectedPullRequestDiff}
      selectedPullRequestNumber={selectedPullRequestNumber}
      selectedPullRequestFilePath={selectedPullRequestFilePath}
      setSelectedPullRequestFilePath={setSelectedPullRequestFilePath}
      pullRequestDetailsLoading={pullRequestDetailsLoading}
      selectedPullRequestDiffResult={selectedPullRequestDiffResult}
      busy={busy}
      githubCliStatus={githubCliStatus}
      loadPullRequestDetails={loadPullRequestDetails}
      openExternalLink={openExternalLink}
    />
  )
}
