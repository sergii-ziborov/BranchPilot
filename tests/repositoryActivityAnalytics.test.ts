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

  it('adds contributor profile, avatar, and search metadata', async () => {
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
    expect(stats[1]?.profileSearchUrl).toContain('github.com/search')
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
