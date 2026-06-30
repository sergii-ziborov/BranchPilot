import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { toBranchPilotError } from '../electron/lib/errors'
import { registerRepositoryOverviewSpecs } from './repositoryService.overviewSpecs'
import {
  cleanupTempRoots,   createService, createTempRepository,
  git, RecordingCommandRunner, tempRoots
} from './support/repositoryServiceTestSupport'

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

describe('RepositoryService', () => {
  afterEach(cleanupTempRoots)

  registerRepositoryOverviewSpecs()

  it('stages all changes through explicit pathspecs instead of a full-tree add', async () => {
    const repoPath = createTempRepository()
    const runner = new RecordingCommandRunner()
    const service = createService(runner)

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'changed\n')
    writeFileSync(path.join(repoPath, 'new.txt'), 'new\n')

    runner.reset()
    const snapshot = await service.staging.stageAll(repoPath)
    const addCall = runner.calls.find((call) => call.args.includes('add'))

    expect(snapshot.status.counts.staged).toBe(2)
    expect(addCall?.args).toContain('--pathspec-from-file=-')
    expect(addCall?.args).toContain('--pathspec-file-nul')
    expect(addCall?.options.input).toContain('tracked.txt\0')
    expect(addCall?.options.input).toContain('new.txt\0')
  })

  it('stages deleted files through the index without asking Git to scan the working tree path', async () => {
    const repoPath = createTempRepository()
    const runner = new RecordingCommandRunner()
    const service = createService(runner)

    unlinkSync(path.join(repoPath, 'tracked.txt'))

    runner.reset()
    const snapshot = await service.staging.stageAll(repoPath)
    const updateIndexCall = runner.calls.find((call) => call.args.includes('update-index'))
    const addCalls = runner.calls.filter((call) => call.args.includes('add'))

    expect(snapshot.status.counts.staged).toBe(1)
    expect(updateIndexCall?.args).toEqual(['update-index', '--remove', '-z', '--stdin'])
    expect(updateIndexCall?.options.input).toBe('tracked.txt\0')
    expect(addCalls).toHaveLength(0)
    expect(git(repoPath, ['status', '--porcelain'])).toContain('D  tracked.txt')
  })

  it('stages and unstages individual hunks', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
      'line 12',
      ''
    ].join('\n'))
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Expand tracked fixture'])

    writeFileSync(path.join(repoPath, 'tracked.txt'), [
      'line 1',
      'line 2 changed',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 changed',
      'line 11',
      'line 12',
      ''
    ].join('\n'))

    const unstagedDiff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: false })
    expect(unstagedDiff.files[0].hunks).toHaveLength(2)

    await service.staging.stageHunk({
      repoPath,
      filePath: 'tracked.txt',
      patch: unstagedDiff.files[0].hunks[0].patch
    })

    const cachedAfterStage = git(repoPath, ['diff', '--cached', '--', 'tracked.txt'])
    const unstagedAfterStage = git(repoPath, ['diff', '--', 'tracked.txt'])

    expect(cachedAfterStage).toContain('line 2 changed')
    expect(cachedAfterStage).not.toContain('line 10 changed')
    expect(unstagedAfterStage).toContain('line 10 changed')
    expect(unstagedAfterStage).not.toContain('line 2 changed')

    const stagedDiff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: true })
    await service.staging.unstageHunk({
      repoPath,
      filePath: 'tracked.txt',
      patch: stagedDiff.files[0].hunks[0].patch
    })

    expect(git(repoPath, ['diff', '--cached', '--', 'tracked.txt'])).toBe('')
    expect(git(repoPath, ['diff', '--', 'tracked.txt'])).toContain('line 2 changed')
    expect(git(repoPath, ['diff', '--', 'tracked.txt'])).toContain('line 10 changed')
  })

  it('reads repository file content in bounded chunks', async () => {
    const repoPath = createTempRepository()
    const service = createService()
    writeFileSync(path.join(repoPath, 'large.txt'), [
      'first line',
      'second line',
      'third line',
      ''
    ].join('\n'))

    const first = await service.getRepositoryFileChunk({
      repoPath,
      filePath: 'large.txt',
      offset: 0,
      maxBytes: 24
    })

    expect(first.text).toBe('first line\nsecond line\n')
    expect(first.hasMore).toBe(true)
    expect(first.endOffset).toBe(Buffer.byteLength(first.text, 'utf8'))

    const second = await service.getRepositoryFileChunk({
      repoPath,
      filePath: 'large.txt',
      offset: first.endOffset,
      maxBytes: 24
    })

    expect(second.text).toBe('third line\n')
    expect(second.hasMore).toBe(false)
    expect(second.startOffset).toBe(first.endOffset)
  })

  it('can unstage a selected-line patch without removing the rest of the file from the index', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), ['line 1', 'line 2', 'line 3', ''].join('\n'))
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Create tracked fixture'])

    writeFileSync(path.join(repoPath, 'tracked.txt'), ['line 1', 'line 2 staged', 'line 3 staged', ''].join('\n'))
    git(repoPath, ['add', 'tracked.txt'])

    await service.staging.unstageHunk({
      repoPath,
      filePath: 'tracked.txt',
      patch: [
        'diff --git a/tracked.txt b/tracked.txt',
        '--- a/tracked.txt',
        '+++ b/tracked.txt',
        '@@ -1,3 +1,3 @@',
        ' line 1',
        '-line 2',
        '+line 2 staged',
        ' line 3 staged',
        ''
      ].join('\n')
    })

    const cached = git(repoPath, ['diff', '--cached', '--', 'tracked.txt'])
    const unstaged = git(repoPath, ['diff', '--', 'tracked.txt'])

    expect(cached).not.toContain('line 2 staged')
    expect(cached).toContain('line 3 staged')
    expect(unstaged).toContain('line 2 staged')
    expect(unstaged).not.toContain('+line 3 staged')
    expect(unstaged).not.toContain('-line 3')
  })

  it('can ignore whitespace-only changes when previewing a diff', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial  \n')

    const defaultDiff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: false })
    const whitespaceIgnoredDiff = await service.getDiff({
      repoPath,
      filePath: 'tracked.txt',
      staged: false,
      ignoreWhitespace: true
    })

    expect(defaultDiff.text).toContain('+initial  ')
    expect(whitespaceIgnoredDiff.text).toBe('')
    expect(whitespaceIgnoredDiff.files).toEqual([])
  })

  it('reports stale hunk patches as readable Git patch failures', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\nchanged\n')
    const diff = await service.getDiff({ repoPath, filePath: 'tracked.txt', staged: false })
    const patch = diff.files[0].hunks[0].patch

    await service.staging.stageHunk({ repoPath, filePath: 'tracked.txt', patch })

    try {
      await service.staging.stageHunk({ repoPath, filePath: 'tracked.txt', patch })
      throw new Error('Expected stale hunk patch to fail')
    } catch (error) {
      expect(toBranchPilotError(error).code).toBe('git_patch_failed')
    }
  })

  it('truncates large untracked file previews without treating them as parsed diffs', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'large-untracked.txt'), `${'x'.repeat(400_000)}\n`)

    const diff = await service.getDiff({
      repoPath,
      filePath: 'large-untracked.txt',
      staged: false
    })

    expect(diff.tooLarge).toBe(true)
    expect(diff.binary).toBe(false)
    expect(diff.text.length).toBeLessThan(360_000)
    expect(diff.files).toEqual([])
  })

  it('truncates large tracked file diffs before parsing', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), `${'x'.repeat(400_000)}\n`)

    const diff = await service.getDiff({
      repoPath,
      filePath: 'tracked.txt',
      staged: false
    })

    expect(diff.tooLarge).toBe(true)
    expect(diff.binary).toBe(false)
    expect(diff.text.length).toBeLessThanOrEqual(350_000)
    expect(diff.files).toEqual([])
  })

  it('rejects absolute and parent-directory file paths before file Git actions', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    await expect(service.getDiff({
      repoPath,
      filePath: '../tracked.txt',
      staged: false
    })).rejects.toMatchObject({ code: 'invalid_path' })

    await expect(service.staging.stageFile({
      repoPath,
      filePath: path.join(repoPath, 'tracked.txt')
    })).rejects.toMatchObject({ code: 'invalid_path' })
  })

  it('exports and applies a working tree patch with confirmation', async () => {
    const repoPath = createTempRepository()
    const patchRoot = mkdtempSync(path.join(tmpdir(), 'branchpilot-patch-test-'))
    tempRoots.push(patchRoot)
    const patchPath = path.join(patchRoot, 'tracked-change.patch')
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'initial\npatched\n')

    const exported = await service.exportPatch({
      repoPath,
      scope: 'working-tree',
      outputPath: patchPath
    })

    expect(exported).toMatchObject({
      path: patchPath,
      fileName: 'tracked-change.patch',
      scope: 'working-tree'
    })
    expect(exported.bytes).toBeGreaterThan(0)
    expect(readText(patchPath)).toContain('+patched')

    git(repoPath, ['restore', '--', 'tracked.txt'])

    await expect(service.applyPatch({
      repoPath,
      patchPath,
      confirmed: false
    })).rejects.toMatchObject({
      code: 'confirmation_required'
    })

    await expect(service.applyPatch({
      repoPath,
      patchPath: path.join(patchRoot, 'missing.patch'),
      confirmed: true
    })).rejects.toMatchObject({
      code: 'patch_not_found'
    })

    const snapshot = await service.applyPatch({
      repoPath,
      patchPath,
      confirmed: true
    })

    expect(snapshot.status.counts.changed).toBe(1)
    expect(readText(path.join(repoPath, 'tracked.txt'))).toBe('initial\npatched\n')
  })

  it('creates, lists, applies, and drops stashes with untracked files', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'stashed tracked\n')
    writeFileSync(path.join(repoPath, 'untracked.txt'), 'stashed untracked\n')

    const stashed = await service.stash.createStash({
      repoPath,
      message: 'Save WIP fixture',
      includeUntracked: true
    })

    expect(stashed.status.counts.changed).toBe(0)
    expect(git(repoPath, ['status', '--porcelain'])).toBe('')

    const stashes = await service.stash.listStashes(repoPath)
    expect(stashes[0].ref).toBe('stash@{0}')
    expect(stashes[0].message).toContain('Save WIP fixture')

    const applied = await service.stash.applyStash({ repoPath, stashRef: stashes[0].ref })
    expect(applied.status.counts.changed).toBe(2)
    expect(readText(path.join(repoPath, 'tracked.txt'))).toBe('stashed tracked\n')
    expect(readText(path.join(repoPath, 'untracked.txt'))).toBe('stashed untracked\n')

    await expect(service.stash.dropStash({
      repoPath,
      stashRef: stashes[0].ref,
      confirmed: false
    })).rejects.toMatchObject({ code: 'confirmation_required' })

    await service.stash.dropStash({
      repoPath,
      stashRef: stashes[0].ref,
      confirmed: true
    })

    expect(await service.stash.listStashes(repoPath)).toEqual([])
  })

  it('reports conflicts when applying a stash over incompatible work', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'stashed\n')
    await service.stash.createStash({
      repoPath,
      message: 'Conflicting stash',
      includeUntracked: true
    })

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'committed local\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Conflicting local change'])

    try {
      await service.stash.applyStash({ repoPath, stashRef: 'stash@{0}' })
      throw new Error('Expected stash apply to conflict')
    } catch (error) {
      expect(toBranchPilotError(error).code).toBe('git_conflict')
    }
  })

  it('reads commit history, commit details, and commit file diffs', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, 'tracked.txt'), 'history change\n')
    git(repoPath, ['add', 'tracked.txt'])
    git(repoPath, ['commit', '-m', 'Update history fixture'])
    git(repoPath, ['branch', 'feature/history'])

    const history = await service.getHistory(repoPath)
    expect(history[0]).toMatchObject({
      subject: 'Update history fixture',
      authorName: 'BranchPilot Test',
      authorEmail: 'branchpilot@example.com'
    })

    const details = await service.getCommitDetails({
      repoPath,
      commitSha: history[0].sha
    })
    expect(details.files).toEqual([
      {
        path: 'tracked.txt',
        rawStatus: 'M',
        status: 'modified'
      }
    ])
    expect(details.containingBranches).toEqual(expect.arrayContaining(['main', 'feature/history']))

    const diff = await service.getCommitFileDiff({
      repoPath,
      commitSha: history[0].sha,
      filePath: 'tracked.txt'
    })
    expect(diff.text).toContain('+history change')
  })

  it('shows merge commit files and diffs against the first parent', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    git(repoPath, ['switch', '--quiet', '-c', 'feature/merge-details'])
    writeFileSync(path.join(repoPath, 'feature.txt'), 'feature merge line\n')
    git(repoPath, ['add', 'feature.txt'])
    git(repoPath, ['commit', '-m', 'Add feature file'])

    git(repoPath, ['switch', '--quiet', 'main'])
    git(repoPath, ['merge', '--no-ff', 'feature/merge-details', '-m', 'Merge feature details'])
    const mergeSha = git(repoPath, ['rev-parse', 'HEAD'])

    const details = await service.getCommitDetails({
      repoPath,
      commitSha: mergeSha
    })

    expect(details.parentShas).toHaveLength(2)
    expect(details.files).toEqual([
      {
        path: 'feature.txt',
        rawStatus: 'A',
        status: 'added'
      }
    ])

    const diff = await service.getCommitFileDiff({
      repoPath,
      commitSha: mergeSha,
      filePath: 'feature.txt'
    })
    expect(diff.text).toContain('+feature merge line')
  })

  it('reads and updates repository-local Git identity', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    const before = await service.config.getGitConfig(repoPath)
    expect(before.localUserName).toBe('BranchPilot Test')
    expect(before.localUserEmail).toBe('branchpilot@example.com')
    expect(before.defaultBranch).toBe('main')
    expect(before.defaultBranchSource).toBe('local')

    const after = await service.config.setLocalGitIdentity({
      repoPath,
      name: 'BranchPilot Local',
      email: 'local@example.com'
    })

    expect(after.localUserName).toBe('BranchPilot Local')
    expect(after.localUserEmail).toBe('local@example.com')
    expect(git(repoPath, ['config', '--local', '--get', 'user.name'])).toBe('BranchPilot Local')
  })

  it('adds updates and removes remotes with confirmation', async () => {
    const repoPath = createTempRepository()
    const service = createService()
    const firstUrl = 'https://github.com/example/project.git'
    const secondUrl = 'git@github.com:example/project.git'

    expect((await service.config.getGitConfig(repoPath)).remotes).toEqual([])

    const added = await service.config.addRemote({
      repoPath,
      name: 'origin',
      url: firstUrl
    })

    expect(added.remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: firstUrl,
        pushUrl: firstUrl
      }
    ])
    await expect(service.config.addRemote({
      repoPath,
      name: 'origin',
      url: firstUrl
    })).rejects.toMatchObject({ code: 'remote_exists' })

    const updated = await service.config.setRemoteUrl({
      repoPath,
      name: 'origin',
      url: secondUrl
    })

    expect(updated.remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: secondUrl,
        pushUrl: secondUrl
      }
    ])
    git(repoPath, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD'])
    git(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
    expect(await service.config.getGitConfig(repoPath)).toMatchObject({
      defaultBranch: 'trunk',
      defaultBranchSource: 'remote',
      defaultBranchRemote: 'origin'
    })
    await expect(service.config.addRemote({
      repoPath,
      name: '-bad',
      url: firstUrl
    })).rejects.toMatchObject({ code: 'invalid_remote' })
    await expect(service.config.addRemote({
      repoPath,
      name: 'upstream',
      url: ''
    })).rejects.toMatchObject({ code: 'invalid_remote_url' })
    await expect(service.config.removeRemote({
      repoPath,
      name: 'origin',
      confirmed: false
    })).rejects.toMatchObject({ code: 'confirmation_required' })

    const removed = await service.config.removeRemote({
      repoPath,
      name: 'origin',
      confirmed: true
    })

    expect(removed.remotes).toEqual([])
    await expect(service.config.setRemoteUrl({
      repoPath,
      name: 'origin',
      url: firstUrl
    })).rejects.toMatchObject({ code: 'git_no_remote' })
  })

})
