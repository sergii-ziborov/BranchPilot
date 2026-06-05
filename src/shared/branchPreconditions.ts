import type { InProgressOperation, RepositorySnapshot } from './branchPilot.js'

export interface BranchDraftActionInput {
  snapshot: RepositorySnapshot | null
  intent: string
  assistantAllowed: boolean
}

export interface CreateBranchActionInput {
  snapshot: RepositorySnapshot | null
  branchName: string
}

export interface BranchActionState {
  enabled: boolean
  reasons: string[]
}

export type BranchComposerSummaryTone = 'ready' | 'blocked' | 'neutral'

export interface BranchComposerSummaryItem {
  label: string
  value: string
  tone: BranchComposerSummaryTone
}

export interface BranchComposerSummaryInput extends BranchDraftActionInput {
  branchName: string
  description: string
}

export function getBranchDraftActionState(input: BranchDraftActionInput): BranchActionState {
  const reasons: string[] = []

  if (!input.snapshot) {
    reasons.push('Open a repository.')
  } else if (!input.intent.trim() && input.snapshot.status.counts.changed === 0) {
    reasons.push('Add an intent or create local changes for assistant context.')
  }

  if (!input.assistantAllowed) {
    reasons.push('Enable branch draft generation in Assistant Policy.')
  }

  return {
    enabled: reasons.length === 0,
    reasons
  }
}

export function getCreateBranchActionState(input: CreateBranchActionInput): BranchActionState {
  const reasons: string[] = []
  const snapshot = input.snapshot
  const branchName = input.branchName.trim()

  if (!snapshot) {
    reasons.push('Open a repository.')
  } else {
    const operation = snapshot.status.merge.operation

    if (operation !== 'none') {
      reasons.push(`Finish or abort the ${operationLabel(operation)} before creating a branch.`)
    }

    if (snapshot.branches.some((branch) => branch.name === branchName)) {
      reasons.push('Choose a branch name that does not already exist.')
    }
  }

  if (!branchName) {
    reasons.push('Add a branch name.')
  } else if (!isSafeBranchName(branchName)) {
    reasons.push('Use a safe Git branch name without spaces or special ref characters.')
  }

  return {
    enabled: reasons.length === 0,
    reasons
  }
}

export function getBranchComposerSummary(input: BranchComposerSummaryInput): BranchComposerSummaryItem[] {
  const snapshot = input.snapshot
  const branchName = input.branchName.trim()
  const description = input.description.trim()
  const createState = getCreateBranchActionState({
    snapshot,
    branchName
  })
  const draftState = getBranchDraftActionState(input)

  return [
    {
      label: 'Context',
      value: branchContextLabel(snapshot, input.intent),
      tone: draftState.enabled ? 'ready' : 'blocked'
    },
    {
      label: 'Name',
      value: branchNameLabel(snapshot, branchName, createState),
      tone: createState.enabled ? 'ready' : 'blocked'
    },
    {
      label: 'Description',
      value: description ? 'Will be saved locally' : 'Optional local metadata',
      tone: description ? 'ready' : 'neutral'
    },
    {
      label: 'AI policy',
      value: input.assistantAllowed ? 'Draft generation allowed' : 'Draft generation blocked',
      tone: input.assistantAllowed ? 'ready' : 'blocked'
    }
  ]
}

function branchContextLabel(snapshot: RepositorySnapshot | null, intent: string): string {
  if (!snapshot) return 'Open a repository'
  if (intent.trim()) return 'Intent provided'
  if (snapshot.status.counts.changed > 0) {
    const changeCount = snapshot.status.counts.changed
    return `${changeCount} local change${changeCount === 1 ? '' : 's'} available`
  }

  return 'Add intent or local changes'
}

function branchNameLabel(
  snapshot: RepositorySnapshot | null,
  branchName: string,
  createState: BranchActionState
): string {
  if (!snapshot) return 'Open a repository'
  if (!branchName) return 'Required'
  if (snapshot.branches.some((branch) => branch.name === branchName)) return 'Already exists'
  if (!createState.enabled && createState.reasons.some((reason) => reason.startsWith('Use a safe Git branch name'))) {
    return 'Unsafe Git ref'
  }

  return branchName
}

function isSafeBranchName(branchName: string): boolean {
  return branchName.length > 0
    && !branchName.startsWith('-')
    && !branchName.startsWith('/')
    && !branchName.endsWith('/')
    && !branchName.endsWith('.')
    && branchName !== '@'
    && !branchName.includes('\0')
    && !branchName.includes(' ')
    && !branchName.includes('..')
    && !branchName.includes('//')
    && !branchName.includes('@{')
    && !/[~^:?*[\]\\]/.test(branchName)
}

function operationLabel(operation: InProgressOperation): string {
  if (operation === 'cherry-pick') return 'cherry-pick'
  return operation
}
