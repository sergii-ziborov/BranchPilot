import { useState } from 'react'
import { ChoiceOptionCard } from 'branchpilot'

export const SwitchBranchChanges = () => {
  const [leaveChanges, setLeaveChanges] = useState(false)
  return (
    <div className="switch-options" role="group" aria-label="Pending changes">
      <ChoiceOptionCard
        title="Bring my changes to release/2.4"
        description="Your in-progress work will follow you to the other branch."
        selected={!leaveChanges}
        onSelect={() => setLeaveChanges(false)}
      />
      <ChoiceOptionCard
        title="Leave my changes on main"
        description="Your work will be stashed on this branch for you to return to later."
        selected={leaveChanges}
        onSelect={() => setLeaveChanges(true)}
      />
    </div>
  )
}

export const CreateBranchPlacement = () => {
  const [mode, setMode] = useState<'move' | 'leave'>('move')
  return (
    <div className="switch-options" role="group" aria-label="Current file changes">
      <ChoiceOptionCard
        title="Move current changes to the new branch"
        description="Switch to feature/login-rework and keep 3 changed files with it."
        selected={mode === 'move'}
        onSelect={() => setMode('move')}
      />
      <ChoiceOptionCard
        title="Leave current changes here"
        description="Create feature/login-rework from origin/main, but stay on main so the files remain here."
        selected={mode === 'leave'}
        onSelect={() => setMode('leave')}
      />
    </div>
  )
}

export const DisabledOption = () => (
  <div className="switch-options" role="group" aria-label="Merge strategy">
    <ChoiceOptionCard
      title="Squash and merge"
      description="Combine all 7 commits into a single commit on main."
      selected
    />
    <ChoiceOptionCard
      title="Rebase and merge"
      description="Unavailable while the branch has merge conflicts."
      selected={false}
      disabled
    />
  </div>
)
