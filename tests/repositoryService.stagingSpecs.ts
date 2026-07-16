import path from 'node:path'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  createService,
  createTempRepository,
  git,
  PoisonPathCommandRunner
} from './support/repositoryServiceTestSupport'

const POISON_PATH = 'zz-poison.css'
// A real Windows reserved device name. On Windows the Win32 layer can't create it
// via fs, so the on-disk cases below are skipped there; the string-only check runs everywhere.
const RESERVED_PATH = 'NUL.css'
const onlyWhereCreatable = it.skipIf(process.platform === 'win32')

export function registerRepositoryStagingSpecs() {
  it('stage all skips an un-stageable file instead of aborting the whole batch', async () => {
    const repoPath = createTempRepository()
    const service = createService(new PoisonPathCommandRunner(POISON_PATH))

    writeFileSync(path.join(repoPath, 'good1.txt'), 'one\n')
    writeFileSync(path.join(repoPath, 'good2.txt'), 'two\n')
    writeFileSync(path.join(repoPath, 'good3.txt'), 'three\n')
    writeFileSync(path.join(repoPath, POISON_PATH), 'poison\n')

    const snapshot = await service.staging.stageAll(repoPath)

    // The three good files stage; the poisoned file is isolated and left unstaged.
    expect(snapshot.status.counts.staged).toBe(3)
    const poison = snapshot.status.changes.find((change) => change.path === POISON_PATH)
    expect(poison?.staged ?? false).toBe(false)
    expect(git(repoPath, ['diff', '--cached', '--name-only'])).not.toContain(POISON_PATH)
  })

  it('stage all still fails loudly when nothing could be staged', async () => {
    const repoPath = createTempRepository()
    const service = createService(new PoisonPathCommandRunner(POISON_PATH))

    writeFileSync(path.join(repoPath, POISON_PATH), 'poison\n')

    await expect(service.staging.stageAll(repoPath)).rejects.toThrow()
  })

  it('unstage all skips an un-restorable file instead of aborting the whole batch', async () => {
    const repoPath = createTempRepository()
    const service = createService(new PoisonPathCommandRunner(POISON_PATH))

    writeFileSync(path.join(repoPath, 'good1.txt'), 'one\n')
    writeFileSync(path.join(repoPath, 'good2.txt'), 'two\n')
    writeFileSync(path.join(repoPath, POISON_PATH), 'poison\n')
    // Stage everything with real git so the poisoned file is staged before we test.
    git(repoPath, ['add', '-A'])

    const snapshot = await service.staging.unstageAll(repoPath)

    // The good files unstage; the poisoned file is isolated and stays staged.
    expect(snapshot.status.counts.staged).toBe(1)
    const poison = snapshot.status.changes.find((change) => change.path === POISON_PATH)
    expect(poison?.staged ?? false).toBe(true)
  })

  it('stage file rejects a Windows reserved name with an actionable error', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    // The string check short-circuits before Git runs, so this holds on every platform.
    await expect(service.staging.stageFile({ repoPath, filePath: RESERVED_PATH }))
      .rejects.toThrow(/reserved Windows device name/i)
  })

  onlyWhereCreatable('stage all surfaces reserved names specifically, not a generic git error', async () => {
    const repoPath = createTempRepository()
    const service = createService(new PoisonPathCommandRunner(RESERVED_PATH))

    writeFileSync(path.join(repoPath, RESERVED_PATH), 'reserved\n')

    await expect(service.staging.stageAll(repoPath)).rejects.toThrow(/reserved Windows device name/i)
  })

  onlyWhereCreatable('delete untracked file removes a reserved name via fs, bypassing git clean', async () => {
    const repoPath = createTempRepository()
    const service = createService()

    writeFileSync(path.join(repoPath, RESERVED_PATH), 'reserved\n')

    const snapshot = await service.staging.deleteUntrackedFile({ repoPath, filePath: RESERVED_PATH, confirmed: true })

    expect(existsSync(path.join(repoPath, RESERVED_PATH))).toBe(false)
    expect(snapshot.status.changes.some((change) => change.path === RESERVED_PATH)).toBe(false)
  })

  it('snapshot read survives a failing phantom staged-add prune', async () => {
    const repoPath = createTempRepository()
    // Stage a new file, then delete it from disk: git reports it as staged-add
    // (A) + worktree-deleted (D) + missing, which triggers pruneMissingStagedAdds.
    writeFileSync(path.join(repoPath, POISON_PATH), 'phantom\n')
    git(repoPath, ['add', POISON_PATH])
    unlinkSync(path.join(repoPath, POISON_PATH))

    const service = createService(new PoisonPathCommandRunner(POISON_PATH))

    // The prune's `git restore --staged` fails, but that must not fail the whole
    // snapshot read — the change simply stays in the status un-pruned.
    const snapshot = await service.getSnapshot(repoPath)
    expect(snapshot.status.changes.some((change) => change.path === POISON_PATH)).toBe(true)
  })
}
