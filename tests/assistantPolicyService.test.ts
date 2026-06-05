import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  allowedActionsForMode,
  AssistantPolicyService,
  buildAssistantPolicyStatus
} from '../electron/lib/assistantPolicyService'
import { SettingsStore } from '../electron/lib/settingsStore'
import type { AssistantActionKind } from '../src/shared/branchPilot'

const tempRoots: string[] = []

describe('AssistantPolicyService', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('uses suggest-only as the per-repository default', async () => {
    const service = createService()
    const status = await service.getAssistantPolicy('/repo/default')

    expect(status.settings).toMatchObject({
      repoPath: '/repo/default',
      mode: 'suggest-only',
      updatedAt: ''
    })
    expect(status.allowedActions).toEqual(['commit_message', 'pull_request_text', 'review_report', 'branch_draft'])
    expect(status.lockedModes).toEqual(['allow-local-commands', 'allow-file-edits'])
  })

  it('persists and reloads policy updates per repository path', async () => {
    const settingsPath = path.join(createTempDirectory(), 'settings.json')
    const firstService = new AssistantPolicyService(new SettingsStore(settingsPath))

    const updated = await firstService.setAssistantPolicy({
      repoPath: '/repo/a',
      mode: 'review-only'
    })

    expect(updated.settings.mode).toBe('review-only')
    expect(updated.settings.updatedAt).not.toBe('')

    const secondService = new AssistantPolicyService(new SettingsStore(settingsPath))

    await expect(secondService.getAssistantPolicy('/repo/a')).resolves.toMatchObject({
      settings: {
        repoPath: '/repo/a',
        mode: 'review-only'
      },
      allowedActions: ['review_report']
    })
    await expect(secondService.getAssistantPolicy('/repo/b')).resolves.toMatchObject({
      settings: {
        repoPath: '/repo/b',
        mode: 'suggest-only'
      }
    })
  })

  it('allows and blocks assistant actions by mode', async () => {
    const service = createService()
    const repoPath = '/repo/modes'

    await service.setAssistantPolicy({ repoPath, mode: 'disabled' })
    await expectAllowed(service, repoPath, [])
    await expect(service.assertActionAllowed(repoPath, 'review_report')).rejects.toMatchObject({
      code: 'assistant_policy_blocked',
      message: 'Assistant review is blocked by this repository policy.'
    })

    await service.setAssistantPolicy({ repoPath, mode: 'review-only' })
    await expectAllowed(service, repoPath, ['review_report'])
    await expect(service.assertActionAllowed(repoPath, 'commit_message')).rejects.toMatchObject({
      code: 'assistant_policy_blocked'
    })
    await expect(service.assertActionAllowed(repoPath, 'pull_request_text')).rejects.toMatchObject({
      code: 'assistant_policy_blocked'
    })

    await expect(service.assertActionAllowed(repoPath, 'branch_draft')).rejects.toMatchObject({
      code: 'assistant_policy_blocked'
    })

    await service.setAssistantPolicy({ repoPath, mode: 'suggest-only' })
    await expectAllowed(service, repoPath, ['commit_message', 'pull_request_text', 'review_report', 'branch_draft'])
  })

  it('does not allow locked future modes to expand permissions in v1', async () => {
    const service = createService()

    await expect(service.setAssistantPolicy({
      repoPath: '/repo/locked',
      mode: 'allow-local-commands'
    })).rejects.toMatchObject({
      code: 'assistant_policy_mode_locked'
    })
    await expect(service.setAssistantPolicy({
      repoPath: '/repo/locked',
      mode: 'allow-file-edits'
    })).rejects.toMatchObject({
      code: 'assistant_policy_mode_locked'
    })

    expect(allowedActionsForMode('allow-local-commands')).toEqual(['commit_message', 'pull_request_text', 'review_report', 'branch_draft'])
    expect(allowedActionsForMode('allow-file-edits')).toEqual(['commit_message', 'pull_request_text', 'review_report', 'branch_draft'])
    expect(buildAssistantPolicyStatus({
      repoPath: '/repo/manual',
      mode: 'allow-file-edits',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }).allowedActions).toEqual(['commit_message', 'pull_request_text', 'review_report', 'branch_draft'])
  })

  it('rejects missing repository paths cleanly', async () => {
    const service = createService()

    await expect(service.getAssistantPolicy('  ')).rejects.toMatchObject({
      code: 'invalid_repository_path'
    })
    await expect(service.setAssistantPolicy({
      repoPath: '',
      mode: 'suggest-only'
    })).rejects.toMatchObject({
      code: 'invalid_repository_path'
    })
  })
})

async function expectAllowed(service: AssistantPolicyService, repoPath: string, actions: AssistantActionKind[]) {
  const allActions: AssistantActionKind[] = ['commit_message', 'pull_request_text', 'review_report', 'branch_draft']

  for (const action of allActions) {
    const assertion = expect(service.assertActionAllowed(repoPath, action))

    if (actions.includes(action)) {
      await assertion.resolves.toMatchObject({
        settings: { repoPath }
      })
    } else {
      await assertion.rejects.toMatchObject({
        code: 'assistant_policy_blocked'
      })
    }
  }
}

function createService() {
  return new AssistantPolicyService(new SettingsStore(path.join(createTempDirectory(), 'settings.json')))
}

function createTempDirectory() {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'branchpilot-assistant-policy-test-'))
  tempRoots.push(directoryPath)
  return directoryPath
}
