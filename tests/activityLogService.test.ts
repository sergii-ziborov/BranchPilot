import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityLogService, sanitizeMetadata } from '../electron/lib/activityLogService'

const tempRoots: string[] = []

describe('ActivityLogService', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('appends and reads repository activity entries newest first', async () => {
    const service = createService()
    const repoPath = '/repo/activity'

    await service.append({
      repoPath,
      type: 'repository_opened',
      actor: 'user',
      status: 'success',
      title: 'Repository opened',
      metadata: { branch: 'main' }
    })
    await service.append({
      repoPath,
      type: 'assistant_review_generated',
      actor: 'assistant',
      status: 'success',
      title: 'Assistant review generated',
      metadata: { mode: 'security', findings: 2 }
    })

    const snapshot = await service.getActivityLog({ repoPath, limit: 10 })

    expect(snapshot.totalCount).toBe(2)
    expect(snapshot.entries[0]).toMatchObject({
      type: 'assistant_review_generated',
      actor: 'assistant',
      metadata: { mode: 'security', findings: 2 }
    })
    await expect(service.getActivityLog({ repoPath, actor: 'assistant' })).resolves.toMatchObject({
      totalCount: 1
    })
  })

  it('trims old entries with retention limit', async () => {
    const service = createService()
    const repoPath = '/repo/retention'

    for (let index = 0; index < 510; index += 1) {
      await service.append({
        repoPath,
        type: 'git_pushed',
        actor: 'user',
        status: 'success',
        title: `Pushed ${index}`,
        metadata: { index }
      })
    }

    const snapshot = await service.getActivityLog({ repoPath, limit: 600 })

    expect(snapshot.totalCount).toBe(500)
    expect(snapshot.entries[0].metadata.index).toBe(509)
    expect(snapshot.entries.at(-1)?.metadata.index).toBe(10)
  })

  it('returns an empty log for missing or corrupt JSON', async () => {
    const directoryPath = createTempDirectory()
    const service = new ActivityLogService(directoryPath)

    await expect(service.getActivityLog({ repoPath: '/repo/missing' })).resolves.toMatchObject({
      entries: [],
      totalCount: 0
    })

    await service.append({
      repoPath: '/repo/bad',
      type: 'repository_opened',
      actor: 'user',
      status: 'success',
      title: 'Repository opened'
    })
    const [logFile] = readdirSync(directoryPath).filter((file) => file.endsWith('.json'))
    writeFileSync(path.join(directoryPath, logFile), '{ bad json', 'utf8')

    await expect(service.getActivityLog({ repoPath: '/repo/bad' })).resolves.toMatchObject({
      entries: [],
      totalCount: 0
    })
  })

  it('requires confirmation before clearing activity', async () => {
    const service = createService()
    const repoPath = '/repo/clear'

    await service.append({
      repoPath,
      type: 'commit_created',
      actor: 'user',
      status: 'success',
      title: 'Commit created'
    })

    await expect(service.clearActivityLog(repoPath, false)).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    await expect(service.clearActivityLog(repoPath, true)).resolves.toMatchObject({
      entries: [],
      totalCount: 0
    })
  })

  it('redacts secret-like metadata values', () => {
    expect(sanitizeMetadata({
      token: 'token=ghp_secretvalue',
      password: 'password=hunter2',
      authorization: 'Authorization: Bearer abc123',
      safe: 'branch main'
    })).toEqual({
      token: 'token=<redacted>',
      password: 'password=<redacted>',
      authorization: 'Authorization: Bearer <redacted>',
      safe: 'branch main'
    })
  })
})

function createService() {
  return new ActivityLogService(createTempDirectory())
}

function createTempDirectory() {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-activity-test-'))
  tempRoots.push(directoryPath)
  return directoryPath
}
