import { DashboardView } from '../../views/DashboardView'
import { useController } from '../../../hooks/AppControllerContext'

export function DashboardRoute() {
  const {
    repositoryDashboard,
    repositoryRhythm,
    contributorStats,
    dashboardRepositoryFilter,
    setDashboardRepositoryFilter,
    currentPullRequest,
    githubCliStatus,
    pullRequests,
    dashboardLoading,
    busy,
    loadRepositoryDashboard,
    openRepository,
    setViewMode,
    openExternalLink,
    allReposMode
  } = useController()

  return (
    <div className="dashboard-stack">
      <DashboardView
        repositoryDashboard={repositoryDashboard}
        repositoryRhythm={repositoryRhythm}
        contributorStats={contributorStats}
        dashboardRepositoryFilter={dashboardRepositoryFilter}
        setDashboardRepositoryFilter={setDashboardRepositoryFilter}
        currentPullRequest={currentPullRequest}
        githubCliStatus={githubCliStatus}
        pullRequests={pullRequests}
        dashboardLoading={dashboardLoading}
        busy={busy}
        loadRepositoryDashboard={loadRepositoryDashboard}
        openRepository={openRepository}
        setViewMode={setViewMode}
        openExternalLink={openExternalLink}
        allReposMode={allReposMode}
      />
    </div>
  )
}
