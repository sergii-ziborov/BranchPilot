import { BookOpen, Cable, CalendarDays, Database } from 'lucide-react'
import { LinkedinIcon } from '../../BrandIcons'
import { BackToChanges } from '../../BackToChanges'
import { DailyView, ReportScopeMenu } from '../../views/DailyView'
import { LinkedInView } from '../../views/LinkedInView'
import { McpSetupView, MemoryView, ProjectWikiView } from '../../views/MemoryView'
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
    copyLinkedInTags,
    projectMemory,
    memoryLoading,
    loadProjectMemory,
    scanProjectMemory,
    activityLog,
    projectMemoryMcpConfig,
    copyProjectMemoryText,
    projectWiki,
    wikiLoading,
    generateProjectWiki,
    selectedProjectWikiPage,
    setSelectedProjectWikiPageId,
    copyProjectWikiPage,
    saveProjectWikiPage,
    pullProjectWikiFromGitHub,
    pushProjectWikiToGitHub,
    completedWorkItems,
    clearActivityLog,
    activityCategory,
    setActivityCategory,
    filteredActivityEntries,
    selectedMemoryFilePath,
    setSelectedMemoryFilePath,
    selectedMemoryFile,
    selectedMemorySymbols,
    selectedMemoryImports,
    selectedAssistant,
    setSelectedAssistant,
    assistants,
    assistantsChecking,
    checkAssistants
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
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'memory'}
            className={viewMode === 'memory' ? 'active' : ''}
            onClick={() => setViewMode('memory')}
          >
            <Database size={15} />
            Memory
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'wiki'}
            className={viewMode === 'wiki' ? 'active' : ''}
            onClick={() => setViewMode('wiki')}
          >
            <BookOpen size={15} />
            Project Wiki
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'mcp'}
            className={viewMode === 'mcp' ? 'active' : ''}
            onClick={() => setViewMode('mcp')}
          >
            <Cable size={15} />
            MCP
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
      {viewMode === 'memory' && (
        <MemoryView
          projectMemory={projectMemory}
          memoryLoading={memoryLoading}
          loadProjectMemory={loadProjectMemory}
          scanProjectMemory={scanProjectMemory}
          activityLog={activityLog}
          completedWorkItems={completedWorkItems}
          clearActivityLog={clearActivityLog}
          activityCategories={['all', 'git', 'assistant', 'provider', 'memory']}
          activityCategory={activityCategory}
          setActivityCategory={setActivityCategory}
          filteredActivityEntries={filteredActivityEntries}
          selectedMemoryFilePath={selectedMemoryFilePath}
          setSelectedMemoryFilePath={setSelectedMemoryFilePath}
          selectedMemoryFile={selectedMemoryFile}
          selectedMemorySymbols={selectedMemorySymbols}
          selectedMemoryImports={selectedMemoryImports}
        />
      )}
      {viewMode === 'wiki' && (
        <ProjectWikiView
          projectWiki={projectWiki}
          projectMemory={projectMemory}
          memoryLoading={memoryLoading}
          wikiLoading={wikiLoading}
          generateProjectWiki={generateProjectWiki}
          selectedProjectWikiPage={selectedProjectWikiPage}
          setSelectedProjectWikiPageId={setSelectedProjectWikiPageId}
          copyProjectWikiPage={copyProjectWikiPage}
          saveProjectWikiPage={saveProjectWikiPage}
          pullProjectWikiFromGitHub={pullProjectWikiFromGitHub}
          pushProjectWikiToGitHub={pushProjectWikiToGitHub}
          selectedAssistant={selectedAssistant}
          setSelectedAssistant={setSelectedAssistant}
          assistants={assistants}
          assistantsChecking={assistantsChecking}
          checkAssistants={checkAssistants}
        />
      )}
      {viewMode === 'mcp' && (
        <McpSetupView
          projectMemoryMcpConfig={projectMemoryMcpConfig}
          projectMemory={projectMemory}
          projectWiki={projectWiki}
          activityLog={activityLog}
          copyProjectMemoryText={copyProjectMemoryText}
        />
      )}
    </div>
  )
}
