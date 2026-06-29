import { BulkStageCheckbox } from 'branchpilot'

const noop = () => {}

export const Mixed = () => (
  <BulkStageCheckbox
    state={{ checked: false, mixed: true, disabled: false, action: 'stage_all', label: 'Stage all files', summary: '2 staged / 3 unstaged' }}
    disabled={false}
    changedCount={5}
    onToggle={noop}
  />
)

export const AllStaged = () => (
  <BulkStageCheckbox
    state={{ checked: true, mixed: false, disabled: false, action: 'unstage_all', label: 'Unstage all files', summary: '5 staged / 0 unstaged' }}
    disabled={false}
    changedCount={5}
    onToggle={noop}
  />
)

export const NoChanges = () => (
  <BulkStageCheckbox
    state={{ checked: false, mixed: false, disabled: true, action: 'none', label: 'No bulk staging action available', summary: 'No changes' }}
    disabled
    changedCount={0}
    onToggle={noop}
  />
)
