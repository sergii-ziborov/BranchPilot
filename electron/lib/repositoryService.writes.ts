import {
  promises as fs
} from 'node:fs'
import path from 'node:path'
import type {
  ApplyPatchRequest,
  ExportPatchRequest,
  ExportedPatch,
  RepositorySnapshot
} from '../../src/shared/branchPilot.js'
import {
  BranchPilotUserError
} from './errors.js'
import {
  assertPatchFileExists,
  normalizePatchInputPath,
  normalizePatchOutputPath,
  normalizePatchScope
} from './repositoryService.helpers.js'
import {
  RepositoryServiceQueries
} from './repositoryService.queries.js'

export class RepositoryServiceWrites extends RepositoryServiceQueries {
  async fetch(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.assertHasAnyRemote(rootPath)
    await this.git(rootPath, ['fetch', '--all', '--prune'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async pull(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.assertCurrentBranch(rootPath, 'pull')
    await this.assertHasAnyRemote(rootPath)
    await this.assertHasUpstream(rootPath, 'pulling')
    // --autostash: uncommitted changes are stashed before the pull and restored
    // after, so a dirty working tree no longer turns a pull into a hard error.
    await this.git(rootPath, ['pull', '--ff-only', '--autostash'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async push(repoPath: string): Promise<RepositorySnapshot> {
    const rootPath = await this.resolveRepositoryRoot(repoPath)
    await this.assertCurrentBranch(rootPath, 'push')
    await this.assertHasAnyRemote(rootPath)
    await this.assertHasUpstream(rootPath, 'pushing')
    await this.git(rootPath, ['push'], { timeoutMs: 120_000 })
    return this.getSnapshot(rootPath)
  }

  async exportPatch(request: ExportPatchRequest): Promise<ExportedPatch> {
    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const outputPath = normalizePatchOutputPath(request.outputPath)
    const scope = normalizePatchScope(request.scope)
    const args = ['diff', '--binary', '--no-ext-diff']

    if (scope === 'staged') {
      args.push('--cached')
    } else {
      args.push('HEAD')
    }

    const result = await this.git(rootPath, args, {
      allowedExitCodes: [0, 1],
      timeoutMs: 120_000
    })
    const patch = result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`

    if (!patch.trim()) {
      throw new BranchPilotUserError('empty_patch', scope === 'staged'
        ? 'No staged changes are available to export.'
        : 'No tracked working tree changes are available to export.')
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, patch, 'utf8')

    return {
      path: outputPath,
      fileName: path.basename(outputPath),
      scope,
      bytes: Buffer.byteLength(patch)
    }
  }

  async applyPatch(request: ApplyPatchRequest): Promise<RepositorySnapshot> {
    if (!request.confirmed) {
      throw new BranchPilotUserError('confirmation_required', 'Applying a patch requires explicit confirmation.')
    }

    const rootPath = await this.resolveRepositoryRoot(request.repoPath)
    const patchPath = normalizePatchInputPath(request.patchPath)

    await assertPatchFileExists(patchPath)
    await this.assertNoActiveOperation(rootPath)
    await this.assertNoConflicts(rootPath, 'applying a patch')
    await this.git(rootPath, ['apply', '--check', '--whitespace=nowarn', patchPath], { timeoutMs: 120_000 })
    await this.git(rootPath, ['apply', '--whitespace=nowarn', patchPath], { timeoutMs: 120_000 })

    return this.getSnapshot(rootPath)
  }

}
