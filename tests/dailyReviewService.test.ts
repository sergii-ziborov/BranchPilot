import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityLogService } from '../electron/lib/activityLogService'
import { CommandRunner } from '../electron/lib/commandRunner'
import { DailyReviewService } from '../electron/lib/dailyReviewService'
import { RepositoryService } from '../electron/lib/repositoryService'
import { SettingsStore } from '../electron/lib/settingsStore'

const tempRoots: string[] = []

describe('DailyReviewService', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('summarizes current-day commits, worktree state, sync state, and activity', async () => {
    const repoPath = createTempRepository()
    const rootPath = git(repoPath, ['rev-parse', '--show-toplevel'])
    const activityLogService = createActivityLogService()
    const service = createDailyReviewService(activityLogService)

    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
    git(repoPath, ['add', 'feature.txt'])
    git(repoPath, ['commit', '-m', 'Add daily feature'])
    writeFileSync(path.join(repoPath, 'tracked.txt'), 'staged work\n')
    writeFileSync(path.join(repoPath, 'scratch.txt'), 'scratch\n')
    git(repoPath, ['add', 'tracked.txt'])
    await activityLogService.append({
      repoPath: rootPath,
      type: 'assistant_review_generated',
      actor: 'assistant',
      status: 'success',
      title: 'Assistant review generated',
      metadata: { mode: 'security', findings: 1 }
    })

    const report = await service.generateDailyReview({
      repoPath,
      date: localDateKey(new Date())
    })

    expect(report.repositoryName).toBe(path.basename(repoPath))
    expect(report.stats.commits).toBeGreaterThanOrEqual(2)
    expect(report.stats.changed).toBe(2)
    expect(report.stats.staged).toBe(1)
    expect(report.stats.untracked).toBe(1)
    expect(report.stats.activities).toBe(1)
    expect(report.sections.find((section) => section.id === 'commits')?.items.join('\n')).toContain('Add daily feature')
    expect(report.sections.find((section) => section.id === 'worktree')?.items.join('\n')).toContain('tracked.txt')
    expect(report.sections.find((section) => section.id === 'worktree')?.items.join('\n')).toContain('scratch.txt')
    expect(report.sections.find((section) => section.id === 'activity')?.items.join('\n')).toContain('Assistant Review Generated')
    expect(report.actionItems.map((item) => item.title)).toEqual(expect.arrayContaining([
      'Commit staged changes',
      'Review local changes'
    ]))
    expect(report.markdown).toContain('# Daily Review')
    expect(report.markdown).toContain('Add daily feature')
    expect(report.markdown).toContain('Assistant Review Generated')
  })

  it('reports an empty historical day without inventing actions', async () => {
    const repoPath = createTempRepository()
    const service = createDailyReviewService(createActivityLogService())

    const report = await service.generateDailyReview({
      repoPath,
      date: '1999-01-01'
    })

    expect(report.stats.commits).toBe(0)
    expect(report.stats.changed).toBe(0)
    expect(report.stats.activities).toBe(0)
    expect(report.actionItems).toEqual([])
    expect(report.sections.find((section) => section.id === 'commits')?.items).toEqual([
      'No commits recorded for this date.'
    ])
    expect(report.markdown).toContain('No immediate local actions detected.')
  })

  it('rejects invalid date input', async () => {
    const repoPath = createTempRepository()
    const service = createDailyReviewService(createActivityLogService())

    await expect(service.generateDailyReview({
      repoPath,
      date: 'today'
    })).rejects.toMatchObject({
      code: 'invalid_daily_review_date'
    })
    await expect(service.generateDailyReview({
      repoPath,
      date: '2026-99-99'
    })).rejects.toMatchObject({
      code: 'invalid_daily_review_date'
    })
  })
})

function createDailyReviewService(activityLogService: ActivityLogService) {
  const settingsDir = createTempDirectory('branchpilot-daily-settings-test-')
  return new DailyReviewService(
    new RepositoryService(
      new CommandRunner(),
      new SettingsStore(path.join(settingsDir, 'settings.json'))
    ),
    activityLogService
  )
}

function createActivityLogService() {
  return new ActivityLogService(createTempDirectory('branchpilot-daily-activity-test-'))
}

function createTempRepository() {
  const repoPath = createTempDirectory('branchpilot-daily-repo-test-')

  git(repoPath, ['init', '-b', 'main'])
  git(repoPath, ['config', 'user.name', 'BranchPilot Test'])
  git(repoPath, ['config', 'user.email', 'branchpilot@example.com'])
  writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\n')
  git(repoPath, ['add', 'tracked.txt'])
  git(repoPath, ['commit', '-m', 'Initial commit'])

  return repoPath
}

function createTempDirectory(prefix: string) {
  const directoryPath = mkdtempSync(path.join(tmpdir(), prefix))
  tempRoots.push(directoryPath)
  return directoryPath
}

function localDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function git(cwd: string, args: string[]) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8'
  }).trim()
}
