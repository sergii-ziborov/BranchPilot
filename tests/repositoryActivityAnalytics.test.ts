import { describe, expect, it } from 'vitest'
import type { CommandRunResult } from '../electron/lib/commandRunner'
import { RepositoryActivityAnalytics, type ActivityAnalyticsKernel } from '../electron/lib/repositoryService.activityAnalytics'

describe('RepositoryActivityAnalytics', () => {
  it('filters contributor stats by time window and preserves same-email aliases', async () => {
    const kernel = new FakeActivityKernel([
      'Sergii Ziborov\tsergii@example.com\t2026-06-22',
      'Serhii Ziborov\tsergii@example.com\t2026-06-21',
      'Andrey Motoshkov\tandrey@example.com\t2026-06-20'
    ].join('\n'))
    const analytics = new RepositoryActivityAnalytics(kernel)

    const stats = await analytics.getContributorStats({ repoPath: '/repo', window: 'week' })

    expect(kernel.lastGitArgs).toContain('--since=1 week ago')
    expect(stats[0]).toMatchObject({
      email: 'sergii@example.com',
      commits: 2,
      share: 2 / 3
    })
    expect(stats[0]?.aliases?.map((alias) => alias.name)).toEqual(['Sergii Ziborov', 'Serhii Ziborov'])
  })

  it('filters day contributor stats by the selected calendar date', async () => {
    const kernel = new FakeActivityKernel([
      'Sergii Ziborov\tsergii@example.com\t2026-06-16'
    ].join('\n'))
    const analytics = new RepositoryActivityAnalytics(kernel)

    await analytics.getContributorStats({ repoPath: '/repo', window: 'day', date: '2026-06-16' })

    expect(kernel.lastGitArgs).toContain('--since=2026-06-16 00:00:00')
    expect(kernel.lastGitArgs).toContain('--before=2026-06-17 00:00:00')
    expect(kernel.lastGitArgs).not.toContain('--since=1 day ago')
  })

  it('groups the same contributor across multiple commit emails', async () => {
    const kernel = new FakeActivityKernel([
      'Sergii Ziborov\tsergii.ziborov@gmail.com\t2026-06-22',
      'Sergii Ziborov\tsergii@edgehawk.io\t2026-06-21',
      'Andrey Motoshkov\tandrey@example.com\t2026-06-20'
    ].join('\n'))
    const analytics = new RepositoryActivityAnalytics(kernel)

    const stats = await analytics.getContributorStats({ repoPath: '/repo', window: 'all' })

    expect(stats).toHaveLength(2)
    expect(stats[0]).toMatchObject({
      name: 'Sergii Ziborov',
      email: 'sergii.ziborov@gmail.com',
      emails: ['sergii.ziborov@gmail.com', 'sergii@edgehawk.io'],
      commits: 2,
      share: 2 / 3
    })
    expect(stats[0]?.aliases?.map((alias) => alias.email)).toEqual([
      'sergii.ziborov@gmail.com',
      'sergii@edgehawk.io'
    ])
  })

  it('adds contributor profile only when GitHub identity is known', async () => {
    const kernel = new FakeActivityKernel([
      'octocat\t123+octocat@users.noreply.github.com\t2026-06-22',
      'Sergii Ziborov\tsergii@example.com\t2026-06-21'
    ].join('\n'))
    const analytics = new RepositoryActivityAnalytics(kernel)

    const stats = await analytics.getContributorStats({ repoPath: '/repo', window: 'all' })

    expect(stats[0]).toMatchObject({
      login: 'octocat',
      profileUrl: 'https://github.com/octocat',
      avatarUrl: 'https://github.com/octocat.png?size=96'
    })
    expect(stats[1]?.avatarUrl).toMatch(/^https:\/\/www\.gravatar\.com\/avatar\/.+\?s=96&d=identicon$/)
    expect(stats[1]?.profileUrl).toBeUndefined()
  })
})

class FakeActivityKernel implements ActivityAnalyticsKernel {
  lastGitArgs: string[] = []

  constructor(private readonly log: string) {}

  async resolveRepositoryRoot(selectedPath: string): Promise<string> {
    return selectedPath
  }

  async getRecentRepositories() {
    return []
  }

  async getConfig() {
    return undefined
  }

  async git(cwd: string, args: string[]): Promise<CommandRunResult> {
    this.lastGitArgs = args

    return {
      command: 'git',
      args,
      cwd,
      exitCode: 0,
      stdout: this.log,
      stderr: '',
      durationMs: 1
    }
  }
}
