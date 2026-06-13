import { useState } from 'react'
import type {
  ApiResult, AssistantId, AssistantPolicyStatus, BranchComparison, BranchPilotApi, BranchSummary,
  RepositorySnapshot, TagSummary, WorktreeSummary
} from '../shared/branchPilot'
import { branchPilotErrorText } from '../shared/branchPilot'
import { getBranchComposerSummary, getBranchDraftActionState, getCreateBranchActionState } from '../shared/branchPreconditions'
import { assistantLabel, assistantPolicyAllows, assistantPolicyBlockedLabel } from '../lib/assistantLabels'
import type { RequestConfirmation, RequestTextInput } from '../lib/prompts'
import type { ViewMode } from '../lib/viewMode'

/** Owns branch/tag/worktree composer state and the related Git operations. */
export function useBranches({
  api,
  currentRepoPath,
  snapshot,
  selectedAssistant,
  assistantPolicy,
  setNotice,
  setError,
  runApiAction,
  runSnapshotAction,
  runBusyOperation,
  applySnapshot,
  requestConfirmation,
  requestTextInput,
  setViewMode
}: {
  api: BranchPilotApi | undefined
  currentRepoPath: string | undefined
  snapshot: RepositorySnapshot | null
  selectedAssistant: AssistantId
  assistantPolicy: AssistantPolicyStatus | null
  setNotice: (message: string) => void
  setError: (message: string | null) => void
  runApiAction: <T>(progressLabel: string, action: () => Promise<ApiResult<T>>, onSuccess: (data: T) => void | Promise<void>) => Promise<boolean>
  runSnapshotAction: (label: string, action: () => Promise<ApiResult<RepositorySnapshot>>, progressLabel?: string) => Promise<boolean>
  runBusyOperation: <T>(label: string, action: () => Promise<T>) => Promise<T>
  applySnapshot: (snapshot: RepositorySnapshot, successMessage: string) => void
  requestConfirmation: RequestConfirmation
  requestTextInput: RequestTextInput
  setViewMode: (mode: ViewMode) => void
}) {
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchDescription, setNewBranchDescription] = useState('')
  const [branchDraftGoal, setBranchDraftGoal] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [newWorktreeBranchName, setNewWorktreeBranchName] = useState('')
  const [newWorktreeBaseRef, setNewWorktreeBaseRef] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [newTagMessage, setNewTagMessage] = useState('')
  const [editingBranchName, setEditingBranchName] = useState<string | null>(null)
  const [branchDescriptionDraft, setBranchDescriptionDraft] = useState('')
  const [branchDescriptionGenerating, setBranchDescriptionGenerating] = useState<string | null>(null)
  const [branchComparison, setBranchComparison] = useState<BranchComparison | null>(null)
  const [branchComparisonLoading, setBranchComparisonLoading] = useState<string | null>(null)

  const canGenerateBranchDraft = assistantPolicyAllows(assistantPolicy, 'branch_draft')

  const branchDraftActionState = getBranchDraftActionState({
    snapshot,
    intent: branchDraftGoal,
    assistantAllowed: canGenerateBranchDraft
  })
  const createBranchActionState = getCreateBranchActionState({
    snapshot,
    branchName: newBranchName
  })
  const branchComposerSummary = getBranchComposerSummary({
    snapshot,
    intent: branchDraftGoal,
    assistantAllowed: canGenerateBranchDraft,
    branchName: newBranchName,
    description: newBranchDescription
  })

  async function generateBranchDraft() {
    if (!api || !currentRepoPath) return
    if (!branchDraftActionState.enabled) {
      setNotice(`Branch draft blocked: ${branchDraftActionState.reasons.join(' ')}`)
      return
    }

    if (
      (newBranchName.trim() || newBranchDescription.trim()) &&
      !(await requestConfirmation('Replace the current branch name and description?', {
        title: 'Replace Branch Draft',
        confirmLabel: 'Replace draft'
      }))
    ) {
      return
    }

    await runApiAction('Generating branch draft...', () => api.generateBranchDraft({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      goal: branchDraftGoal.trim() || undefined
    }), (data) => {
      setNewBranchName(data.branchName)
      setNewBranchDescription(data.description)
      setNotice(`Generated branch draft with ${assistantLabel(data.assistant)}${data.truncated ? ' from truncated context' : ''}.`)
    })
  }

  async function createBranch() {
    if (!api || !currentRepoPath) return
    if (!createBranchActionState.enabled) {
      setNotice(`Create branch blocked: ${createBranchActionState.reasons.join(' ')}`)
      return
    }

    const created = await runSnapshotAction('Branch created.', () =>
      api.createBranch({
        repoPath: currentRepoPath,
        branchName: newBranchName,
        description: newBranchDescription
      })
    )

    if (created) {
      setNewBranchName('')
      setNewBranchDescription('')
      setBranchDraftGoal('')
    }
  }

  async function deleteBranch(branch: BranchSummary) {
    if (!api || !currentRepoPath) return
    const confirmed = await requestConfirmation(`Delete local branch ${branch.name}?`, {
      title: 'Delete Branch',
      confirmLabel: 'Delete branch',
      variant: 'danger'
    })
    if (!confirmed) return

    const result = await runBusyOperation('Deleting branch...', () =>
      api.deleteBranch({
        repoPath: currentRepoPath,
        branchName: branch.name,
        confirmed,
        force: false
      })
    )

    if (result.ok) {
      applySnapshot(result.data, 'Branch deleted.')
      return
    }

    if (result.error.code !== 'git_branch_not_merged') {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
      return
    }

    const forceConfirmed = await requestConfirmation(
      `${branch.name} is not fully merged. Force delete it? Commits that exist only on this branch are lost.`,
      {
        title: 'Force Delete Branch',
        confirmLabel: 'Force delete',
        variant: 'danger'
      }
    )

    if (!forceConfirmed) {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
      return
    }

    await runSnapshotAction('Branch force deleted.', () =>
      api.deleteBranch({
        repoPath: currentRepoPath,
        branchName: branch.name,
        confirmed: true,
        force: true
      })
    )
  }

  async function renameBranch(branch: BranchSummary) {
    if (!api || !currentRepoPath) return
    const nextName = (await requestTextInput(`Rename local branch ${branch.name}.`, {
      title: 'Rename Branch',
      confirmLabel: 'Rename',
      defaultValue: branch.name
    }))?.trim()

    if (!nextName) return

    if (nextName === branch.name) {
      setNotice('Rename blocked: choose a different branch name.')
      return
    }

    await runSnapshotAction('Branch renamed.', () =>
      api.renameBranch({
        repoPath: currentRepoPath,
        oldBranchName: branch.name,
        newBranchName: nextName
      })
    )
  }

  async function setBranchUpstream(branch: BranchSummary) {
    if (!api || !currentRepoPath || !snapshot?.summary.remoteName) return
    const defaultUpstream = `${snapshot.summary.remoteName}/${branch.name}`
    const upstream = (await requestTextInput(`Track a remote branch for ${branch.name}.`, {
      title: 'Set Upstream',
      confirmLabel: 'Set upstream',
      defaultValue: defaultUpstream
    }))?.trim()

    if (!upstream) return

    await runSnapshotAction('Branch upstream updated.', () =>
      api.setBranchUpstream({
        repoPath: currentRepoPath,
        branchName: branch.name,
        upstream
      })
    )
  }

  async function compareBranch(branch: BranchSummary) {
    if (!api || !currentRepoPath || branch.current) return

    setBranchComparisonLoading(branch.name)
    setError(null)

    const result = await api.compareBranch({
      repoPath: currentRepoPath,
      targetBranch: branch.name
    })

    if (result.ok) {
      setBranchComparison(result.data)
      setNotice(`Compared ${result.data.targetBranch} against ${result.data.baseBranch}.`)
    } else {
      setBranchComparison(null)
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setBranchComparisonLoading(null)
  }

  async function createTag() {
    if (!api || !currentRepoPath) return

    const tagName = newTagName.trim()
    if (!tagName) {
      setNotice('Create tag blocked: add a tag name.')
      return
    }

    const created = await runSnapshotAction('Tag created.', () =>
      api.createTag({
        repoPath: currentRepoPath,
        tagName,
        message: newTagMessage
      })
    )

    if (created) {
      setNewTagName('')
      setNewTagMessage('')
    }
  }

  async function deleteTag(tag: TagSummary) {
    if (!api || !currentRepoPath) return

    const confirmed = await requestConfirmation(`Delete local tag ${tag.name}?`, {
      title: 'Delete Tag',
      confirmLabel: 'Delete tag',
      variant: 'danger'
    })
    if (!confirmed) return

    await runSnapshotAction('Tag deleted.', () =>
      api.deleteTag({
        repoPath: currentRepoPath,
        tagName: tag.name,
        confirmed
      })
    )
  }

  async function createWorktree() {
    if (!api || !currentRepoPath) return

    const branchName = newWorktreeBranchName.trim()
    if (!branchName) {
      setNotice('Create worktree blocked: add a new branch name.')
      return
    }

    await runApiAction('Creating worktree...', () => api.createWorktree({
      repoPath: currentRepoPath,
      branchName,
      baseRef: newWorktreeBaseRef.trim() || undefined
    }), (data) => {
      if (data) {
        applySnapshot(data, 'Worktree created.')
        setNewWorktreeBranchName('')
      } else {
        setNotice('Worktree creation cancelled.')
      }
    })
  }

  async function openWorktree(worktree: WorktreeSummary) {
    if (!api) return

    await runApiAction('Opening worktree...', () => api.openRepository(worktree.path), (data) => {
      applySnapshot(data, 'Worktree opened.')
      setViewMode('changes')
    })
  }

  async function removeWorktree(worktree: WorktreeSummary) {
    if (!api || !currentRepoPath) return

    const label = worktree.branch ?? worktree.path
    const confirmed = await requestConfirmation(`Remove linked worktree ${label}? Git will refuse if it contains uncommitted changes.`, {
      title: 'Remove Worktree',
      confirmLabel: 'Remove worktree',
      variant: 'danger'
    })
    if (!confirmed) return

    await runSnapshotAction('Worktree removed.', () =>
      api.removeWorktree({
        repoPath: currentRepoPath,
        targetPath: worktree.path,
        confirmed
      })
    )
  }

  function startBranchDescriptionEdit(branch: BranchSummary) {
    setEditingBranchName(branch.name)
    setBranchDescriptionDraft(branch.description ?? '')
  }

  function cancelBranchDescriptionEdit() {
    setEditingBranchName(null)
    setBranchDescriptionDraft('')
  }

  async function saveBranchDescription(branchName: string) {
    if (!api || !currentRepoPath) return

    const saved = await runSnapshotAction('Branch description saved.', () =>
      api.updateBranchDescription({
        repoPath: currentRepoPath,
        branchName,
        description: branchDescriptionDraft
      })
    )

    if (saved) {
      cancelBranchDescriptionEdit()
    }
  }

  async function generateBranchDescription(branch: BranchSummary) {
    if (!api || !currentRepoPath || branchDescriptionGenerating) return
    if (!canGenerateBranchDraft) {
      setNotice(assistantPolicyBlockedLabel('branch_draft', assistantPolicy))
      return
    }

    setBranchDescriptionGenerating(branch.name)
    setError(null)
    const result = await api.generateBranchDescription({
      repoPath: currentRepoPath,
      assistant: selectedAssistant,
      branchName: branch.name
    })

    if (result.ok) {
      setEditingBranchName(branch.name)
      setBranchDescriptionDraft(result.data.description)
      setNotice(`Generated branch description with ${assistantLabel(result.data.assistant)}${result.data.truncated ? ' from truncated context' : ''}. Review and save it.`)
    } else {
      setError(result.error.message)
      setNotice(branchPilotErrorText(result.error))
    }

    setBranchDescriptionGenerating(null)
  }

  return {
    newBranchName, setNewBranchName, newBranchDescription, setNewBranchDescription,
    branchDraftGoal, setBranchDraftGoal, branchFilter, setBranchFilter,
    newWorktreeBranchName, setNewWorktreeBranchName, newWorktreeBaseRef, setNewWorktreeBaseRef,
    tagFilter, setTagFilter, newTagName, setNewTagName, newTagMessage, setNewTagMessage,
    editingBranchName, branchDescriptionDraft, setBranchDescriptionDraft, branchDescriptionGenerating,
    branchComparison, setBranchComparison, branchComparisonLoading,
    canGenerateBranchDraft, branchDraftActionState, createBranchActionState, branchComposerSummary,
    generateBranchDraft, createBranch, deleteBranch, renameBranch, setBranchUpstream, compareBranch,
    createTag, deleteTag, createWorktree, openWorktree, removeWorktree,
    startBranchDescriptionEdit, cancelBranchDescriptionEdit, saveBranchDescription, generateBranchDescription
  }
}
