import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTempRoots,
  createService,
  createTempRepository,
  git
} from './support/repositoryServiceTestSupport'

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

describe('RepositoryService commit operations', () => {
  afterEach(cleanupTempRoots)

  it('commits staged changes with a multiline message', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'changed\n')
    git(repoPath, ['add', 'tracked.txt'])

    const snapshot = await service.commits.commit({
      repoPath,
      title: 'Update tracked file',
      description: 'Adds a second line of commit context.'
    })

    expect(snapshot.status.counts.staged).toBe(0)
    const subject = git(repoPath, ['log', '-1', '--pretty=%s'])
    expect(subject).toBe('Update tracked file')
  })

  it('commits staged changes with co-author trailers', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'coauthored change\n')
    git(repoPath, ['add', 'tracked.txt'])

    await service.commits.commit({
      repoPath,
      title: 'Update with coauthors',
      description: 'Adds commit trailers through BranchPilot.',
      coAuthors: [
        'Ada Lovelace <ada@example.com>',
        'Co-authored-by: Grace Hopper <grace@example.com>'
      ].join('\n')
    })

    const body = git(repoPath, ['log', '-1', '--pretty=%b'])
    expect(body).toContain('Adds commit trailers through BranchPilot.')
    expect(body).toContain('Co-authored-by: Ada Lovelace <ada@example.com>')
    expect(body).toContain('Co-authored-by: Grace Hopper <grace@example.com>')
  })

  it('rejects invalid co-author lines before committing', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'invalid coauthor\n')
    git(repoPath, ['add', 'tracked.txt'])

    await expect(service.commits.commit({
      repoPath,
      title: 'Invalid coauthor',
      description: '',
      coAuthors: 'Not an email'
    })).rejects.toMatchObject({
      code: 'invalid_co_author'
    })
  })

  it('amends the last commit with confirmation and a multiline message', async () => {
    const repoPath = createTempRepository()
    const service = createService()
    const originalHead = git(repoPath, ['rev-parse', 'HEAD'])

    await expect(service.commits.amendCommit({
      repoPath,
      title: 'Blocked amend',
      description: '',
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const snapshot = await service.commits.amendCommit({
      repoPath,
      title: 'Amended initial commit',
      description: 'Keeps the tree and rewrites the commit message.',
      coAuthors: 'Alan Turing <alan@example.com>',
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(git(repoPath, ['rev-parse', 'HEAD'])).not.toBe(originalHead)
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Amended initial commit')
    expect(git(repoPath, ['log', '-1', '--pretty=%b'])).toContain('Keeps the tree')
    expect(git(repoPath, ['log', '-1', '--pretty=%b'])).toContain('Co-authored-by: Alan Turing <alan@example.com>')
  })

  it('reverts a selected commit with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'changed for revert\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Change tracked file'])
    const commitToRevert = git(repoPath, ['rev-parse', 'HEAD'])

    await expect(service.commits.revertCommit({
      repoPath,
      commitSha: commitToRevert,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const snapshot = await service.commits.revertCommit({
      repoPath,
      commitSha: commitToRevert,
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(readText(path.join(repoPath, 'tracked.txt'))).toBe('initial\n')
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Revert "Change tracked file"')
  })

  it('cherry-picks a selected commit with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/pick'])
    writeFileSync(path.join(repoPath, 'picked.txt'), 'picked\n')
    git(repoPath, ['add', 'picked.txt'])
    git(repoPath, ['commit', '-m', 'Add picked file'])
    const commitToPick = git(repoPath, ['rev-parse', 'HEAD'])

    git(repoPath, ['switch', '--quiet', 'main'])

    await expect(service.commits.cherryPickCommit({
      repoPath,
      commitSha: commitToPick,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const snapshot = await service.commits.cherryPickCommit({
      repoPath,
      commitSha: commitToPick,
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(readText(path.join(repoPath, 'picked.txt'))).toBe('picked\n')
    expect(git(repoPath, ['log', '-1', '--pretty=%s'])).toBe('Add picked file')
  })

  it('resets the current branch to a selected commit with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()
    const initialHead = git(repoPath, ['rev-parse', 'HEAD'])

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'reset target\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Temporary reset commit'])

    await expect(service.commits.resetToCommit({
      repoPath,
      commitSha: initialHead,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    const snapshot = await service.commits.resetToCommit({
      repoPath,
      commitSha: initialHead,
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(0)
    expect(git(repoPath, ['rev-parse', 'HEAD'])).toBe(initialHead)
    expect(readText(path.join(repoPath, 'tracked.txt'))).toBe('initial\n')
  })
})
