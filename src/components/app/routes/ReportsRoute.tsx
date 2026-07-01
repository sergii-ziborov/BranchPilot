import { CalendarDays } from 'lucide-react'
import { LinkedinIcon } from '../../BrandIcons'
import { BackToChanges } from '../../BackToChanges'
import { DailyView, ReportScopeMenu } from '../../views/DailyView'
import { LinkedInView } from '../../views/LinkedInView'
import { useController } from '../../../hooks/AppControllerContext'

export function ReportsRoute() {
  const {
    snapshot,
    viewMode,
    setViewMode,
    dailyReviewDate,
    setDailyReviewDate,
    runDailyReview,
    dailyReviewLoading,
    dailyReview,
    contributionGraph,
    contributionGraphLoading,
    contributorStats,
    contributorStatsLoading,
    githubAccounts,
    contributorWindow,
    setContributorWindow,
    copyDailyReviewMarkdown,
    recentRepositories,
    selectedReportRepoPaths,
    updateReportRepoPaths,
    allReposMode,
    currentRepoPath,
    openExternalLink,
    generateLinkedInProject,
    busy,
    linkedinLoading,
    canGenerateLinkedInProject,
    linkedinProject,
    updateLinkedInProject,
    linkedinHighlightsText,
    setLinkedinHighlightsText,
    linkedinTagsText,
    setLinkedinTagsText,
    linkedinSkillsText,
    setLinkedinSkillsText,
    linkedinRole,
    setLinkedInRole,
    linkedinAudience,
    setLinkedInAudience,
    linkedinProjectUrl,
    setLinkedInProjectUrl,
    linkedinCustomPrompt,
    setLinkedInCustomPrompt,
    resetLinkedInPrompt,
    copyLinkedInMarkdown,
    copyLinkedInTags
  } = useController()

  return (
    <div className="reports-stack">
      <div className="reports-topbar">
        <BackToChanges onClick={() => setViewMode('changes')} />
        <div className="reports-switch" role="tablist" aria-label="Reports">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'daily'}
            className={viewMode === 'daily' ? 'active' : ''}
            onClick={() => setViewMode('daily')}
          >
            <CalendarDays size={15} />
            Daily review
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'linkedin'}
            className={viewMode === 'linkedin' ? 'active' : ''}
            onClick={() => setViewMode('linkedin')}
          >
            <LinkedinIcon size={15} />
            LinkedIn
          </button>
        </div>
        {viewMode === 'daily' && (
          <div className="reports-scope-controls">
            <ReportScopeMenu
              snapshot={snapshot}
              recentRepositories={recentRepositories}
              selectedReportRepoPaths={selectedReportRepoPaths}
              updateReportRepoPaths={updateReportRepoPaths}
              allReposMode={allReposMode}
              currentRepoPath={currentRepoPath}
            />
          </div>
        )}
      </div>
      {viewMode === 'daily' && (
        <DailyView
          dailyReviewDate={dailyReviewDate}
          setDailyReviewDate={setDailyReviewDate}
          runDailyReview={runDailyReview}
          dailyReviewLoading={dailyReviewLoading}
          dailyReview={dailyReview}
          contributionGraph={contributionGraph}
          contributionGraphLoading={contributionGraphLoading}
          contributorStats={contributorStats}
          contributorStatsLoading={contributorStatsLoading}
          githubAccounts={githubAccounts}
          contributorWindow={contributorWindow}
          setContributorWindow={setContributorWindow}
          copyDailyReviewMarkdown={copyDailyReviewMarkdown}
          recentRepositories={recentRepositories}
          selectedReportRepoPaths={selectedReportRepoPaths}
          allReposMode={allReposMode}
          currentRepoPath={currentRepoPath}
          openExternalLink={openExternalLink}
        />
      )}
      {viewMode === 'linkedin' && (
        <LinkedInView
          generateLinkedInProject={generateLinkedInProject}
          snapshot={snapshot}
          busy={busy}
          linkedinLoading={linkedinLoading}
          canGenerateLinkedInProject={canGenerateLinkedInProject}
          linkedinProject={linkedinProject}
          updateLinkedInProject={updateLinkedInProject}
          linkedinHighlightsText={linkedinHighlightsText}
          setLinkedinHighlightsText={setLinkedinHighlightsText}
          linkedinTagsText={linkedinTagsText}
          setLinkedinTagsText={setLinkedinTagsText}
          linkedinSkillsText={linkedinSkillsText}
          setLinkedinSkillsText={setLinkedinSkillsText}
          linkedinRole={linkedinRole}
          setLinkedInRole={setLinkedInRole}
          linkedinAudience={linkedinAudience}
          setLinkedInAudience={setLinkedInAudience}
          linkedinProjectUrl={linkedinProjectUrl}
          setLinkedInProjectUrl={setLinkedInProjectUrl}
          linkedinCustomPrompt={linkedinCustomPrompt}
          setLinkedInCustomPrompt={setLinkedInCustomPrompt}
          resetLinkedInPrompt={resetLinkedInPrompt}
          copyLinkedInMarkdown={copyLinkedInMarkdown}
          copyLinkedInTags={copyLinkedInTags}
        />
      )}
    </div>
  )
}
